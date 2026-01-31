/**
 * NapCat 自动清理不活跃群成员插件
 * 
 * 功能：
 * - 定时扫描群成员活跃度
 * - 自动清理长期不活跃的"鱼干"成员
 * - 提供 WebUI 仪表盘查看状态和配置
 * 
 * @author AQiaoYo
 * @license MIT
 */

// @ts-ignore - NapCat 类型定义
import type { PluginModule, NapCatPluginContext, PluginConfigSchema, PluginConfigUIController } from 'napcat-types/napcat-onebot/network/plugin-manger';
// @ts-ignore - NapCat 消息类型
import type { OB11Message } from 'napcat-types/napcat-onebot';
// @ts-ignore - NapCat 事件类型
import { EventType } from 'napcat-types/napcat-onebot/event/index';

import { initConfigUI } from './config';
import { loadConfig, saveConfig, getConfig, setConfig } from './core/state';
import { handleMessage } from './handlers/message-handler';
import { getGroupsWithPermissions } from './services/group-service';
import { runCleanupAndNotify, runCleanupForGroup, getLastCleanupResult, getCleanupStats } from './services/cleanup-service';
import { startGlobalCronJob, startGroupCronJob, stopAllCronJobs, stopCronJob, reloadAllCronJobs, getCronJobStatus, isValidCronExpression } from './services/cron-service';

/** 框架配置 UI Schema，NapCat WebUI 会读取此导出来展示配置面板 */
export let plugin_config_ui: PluginConfigSchema = [];

/** 路由前缀，防止与其他插件冲突 */
const ROUTE_PREFIX = '/clear';

/** 日志前缀 */
const LOG_TAG = '[AutoClear]';

/**
 * 插件初始化函数
 * 负责加载配置、注册 WebUI 路由、启动定时任务
 */
const plugin_init = async (ctx: NapCatPluginContext) => {
    // 记录启动时间，用于计算运行时长
    (ctx as any).__startTime = Date.now();
    
    try {
        ctx.logger.info(`${LOG_TAG} 初始化开始 | name=${ctx.pluginName}, router=${Boolean(ctx.router)}`);

        loadConfig(ctx);
        ctx.logger.debug(`${LOG_TAG} 配置加载完成`);

        // 生成配置 schema 并导出
        const schema = initConfigUI(ctx);
        plugin_config_ui = schema;

        // 注册 WebUI 路由
        try {
            // 静态资源目录
            ctx.router.static(`${ROUTE_PREFIX}/static`, 'webui');

            // 插件信息脚本
            ctx.router.get(`${ROUTE_PREFIX}/static/plugin-info.js`, (_req: any, res: any) => {
                try {
                    res.type('application/javascript');
                    res.send(`window.__PLUGIN_NAME__ = ${JSON.stringify(ctx.pluginName)};`);
                } catch (e) {
                    res.status(500).send('// failed to generate plugin-info');
                }
            });

            // 基础信息接口
            ctx.router.get(`${ROUTE_PREFIX}/info`, (_req: any, res: any) => {
                res.json({ code: 0, data: { pluginName: ctx.pluginName } });
            });

            // 仪表盘页面
            ctx.router.page({
                path: 'clear-dashboard',
                title: '清理插件仪表盘',
                icon: '🧹',
                htmlFile: 'webui/dashboard.html',
                description: '查看插件运行状态与当前配置'
            });

            // 状态接口
            ctx.router.get(`${ROUTE_PREFIX}/status`, (_req: any, res: any) => {
                const uptime = Date.now() - (ctx.__startTime || Date.now());
                res.json({
                    code: 0,
                    data: {
                        pluginName: ctx.pluginName,
                        uptime,
                        uptimeFormatted: `${Math.floor(uptime / 1000)}s`,
                        config: getConfig(),
                        platform: process.platform,
                        arch: process.arch
                    }
                });
            });

            // 配置读取接口
            ctx.router.get(`${ROUTE_PREFIX}/config`, (_req: any, res: any) => {
                res.json({ code: 0, data: getConfig() });
            });

            // 群列表接口
            ctx.router.get(`${ROUTE_PREFIX}/groups`, async (_req: any, res: any) => {
                try {
                    const data = await getGroupsWithPermissions(ctx);
                    res.json({ code: 0, data });
                } catch (e) {
                    ctx.logger.error(`${LOG_TAG} 获取群列表失败:`, e);
                    res.status(500).json({ code: -1, message: String(e) });
                }
            });

            // 配置保存接口
            ctx.router.post(`${ROUTE_PREFIX}/config`, async (req: any, res: any) => {
                try {
                    const newCfg = req.body || {};
                    const errors: string[] = [];

                    // 全局 cron 校验
                    if (newCfg.globalCron !== undefined && newCfg.globalCron !== null && String(newCfg.globalCron).trim() !== '') {
                        if (!isValidCronExpression(String(newCfg.globalCron))) {
                            errors.push('globalCron: 无效的 cron 表达式（仅支持 node-cron，5 或 6 字段，不能包含 ?）');
                        }
                    }

                    // 全局 inactiveDays 校验
                    if (newCfg.inactiveDays !== undefined && newCfg.inactiveDays !== null && newCfg.inactiveDays !== '') {
                        const v = Number(newCfg.inactiveDays);
                        if (!Number.isInteger(v) || v < 1) errors.push('inactiveDays: 必须为大于等于 1 的整数');
                    }

                    // 群配置校验
                    if (newCfg.groupConfigs !== undefined && newCfg.groupConfigs !== null) {
                        if (typeof newCfg.groupConfigs !== 'object') {
                            errors.push('groupConfigs: 必须为对象，键为群 ID');
                        } else {
                            for (const [gid, gc] of Object.entries(newCfg.groupConfigs || {})) {
                                if (!gid) continue;
                                if (gc && typeof gc === 'object') {
                                    if (gc.cron !== undefined && gc.cron !== null && String(gc.cron).trim() !== '') {
                                        if (!isValidCronExpression(String(gc.cron))) {
                                            errors.push(`groupConfigs.${gid}.cron: 无效的 cron 表达式`);
                                        }
                                    }
                                    if (gc.inactiveDays !== undefined && gc.inactiveDays !== null && gc.inactiveDays !== '') {
                                        const iv = Number(gc.inactiveDays);
                                        if (!Number.isInteger(iv) || iv < 1) errors.push(`groupConfigs.${gid}.inactiveDays: 必须为大于等于 1 的整数`);
                                    }
                                } else {
                                    errors.push(`groupConfigs.${gid}: 必须为对象`);
                                }
                            }
                        }
                    }

                    if (errors.length > 0) {
                        ctx.logger.warn(`${LOG_TAG} 配置校验失败: ${errors.join(', ')}`);
                        return res.status(400).json({ code: -1, message: '配置校验失败', errors });
                    }

                    await saveConfig(ctx, { ...getConfig(), ...newCfg });
                    reloadAllCronJobs(ctx);
                    ctx.logger.info(`${LOG_TAG} 配置已保存`);
                    res.json({ code: 0, message: 'Config saved' });
                } catch (err) {
                    ctx.logger.error(`${LOG_TAG} 保存配置失败:`, err);
                    res.status(500).json({ code: -1, message: String(err) });
                }
            });

            // 定时任务状态接口
            ctx.router.get(`${ROUTE_PREFIX}/cron/status`, (_req: any, res: any) => {
                try {
                    const status = getCronJobStatus();
                    res.json({ code: 0, data: status });
                } catch (e) {
                    ctx.logger.error(`${LOG_TAG} 获取定时任务状态失败:`, e);
                    res.status(500).json({ code: -1, message: String(e) });
                }
            });

            // 更新群定时任务配置
            ctx.router.post(`${ROUTE_PREFIX}/groups/:id/cron`, async (req: any, res: any) => {
                try {
                    const groupId = String(req.params?.id || '');
                    if (!groupId) return res.status(400).json({ code: -1, message: 'missing group id' });

                    const cronConfig = req.body || {};
                    const currentConfig = getConfig();

                    const groupConfigs = { ...(currentConfig.groupConfigs || {}) };
                    groupConfigs[groupId] = {
                        ...groupConfigs[groupId],
                        ...cronConfig
                    };

                    await saveConfig(ctx, { ...currentConfig, groupConfigs });

                    if (groupConfigs[groupId]?.enabled) {
                        startGroupCronJob(ctx, groupId);
                    } else {
                        stopCronJob(`group_${groupId}`);
                    }

                    ctx.logger.info(`${LOG_TAG} 群 ${groupId} 定时任务配置已更新`);
                    res.json({ code: 0, message: 'Group cron config updated', data: { group_id: groupId, config: groupConfigs[groupId] } });
                } catch (e) {
                    ctx.logger.error(`${LOG_TAG} 更新群定时任务配置失败:`, e);
                    res.status(500).json({ code: -1, message: String(e) });
                }
            });

            // 获取群定时任务配置
            ctx.router.get(`${ROUTE_PREFIX}/groups/:id/cron`, (req: any, res: any) => {
                try {
                    const groupId = String(req.params?.id || '');
                    if (!groupId) return res.status(400).json({ code: -1, message: 'missing group id' });

                    const currentConfig = getConfig();
                    const groupConfig = currentConfig.groupConfigs?.[groupId] || {};
                    res.json({ code: 0, data: groupConfig });
                } catch (e) {
                    ctx.logger.error(`${LOG_TAG} 获取群定时任务配置失败:`, e);
                    res.status(500).json({ code: -1, message: String(e) });
                }
            });

            // 手动触发群清理
            ctx.router.post(`${ROUTE_PREFIX}/groups/:id/cleanup`, async (req: any, res: any) => {
                try {
                    const groupId = String(req.params?.id || '');
                    if (!groupId) return res.status(400).json({ code: -1, message: 'missing group id' });

                    const body = req.body || {};
                    const dryRun = body.dryRun !== undefined ? Boolean(body.dryRun) : undefined;
                    const notify = body.notify !== false;

                    ctx.logger.info(`${LOG_TAG} 手动触发群 ${groupId} 清理 | dryRun=${dryRun}, notify=${notify}`);

                    let result;
                    if (notify) {
                        result = await runCleanupAndNotify(ctx, groupId, dryRun);
                    } else {
                        result = await runCleanupForGroup(ctx, groupId, dryRun);
                    }

                    res.json({ code: 0, data: result });
                } catch (e) {
                    ctx.logger.error(`${LOG_TAG} 手动清理群失败:`, e);
                    res.status(500).json({ code: -1, message: String(e) });
                }
            });

            // 获取群清理结果
            ctx.router.get(`${ROUTE_PREFIX}/groups/:id/cleanup/result`, (req: any, res: any) => {
                try {
                    const groupId = String(req.params?.id || '');
                    if (!groupId) return res.status(400).json({ code: -1, message: 'missing group id' });

                    const result = getLastCleanupResult(groupId);
                    res.json({ code: 0, data: result || null });
                } catch (e) {
                    ctx.logger.error(`${LOG_TAG} 获取清理结果失败:`, e);
                    res.status(500).json({ code: -1, message: String(e) });
                }
            });

            // 清理统计接口
            ctx.router.get(`${ROUTE_PREFIX}/cleanup/stats`, (_req: any, res: any) => {
                try {
                    const stats = getCleanupStats();
                    res.json({ code: 0, data: stats });
                } catch (e) {
                    ctx.logger.error(`${LOG_TAG} 获取清理统计失败:`, e);
                    res.status(500).json({ code: -1, message: String(e) });
                }
            });

            // 记录已注册的路由
            const routes = [
                `static:${ROUTE_PREFIX}/static`,
                `page:/clear-dashboard`,
                `get:${ROUTE_PREFIX}/status`,
                `get:${ROUTE_PREFIX}/config`,
                `post:${ROUTE_PREFIX}/config`,
                `get:${ROUTE_PREFIX}/static/plugin-info.js`,
                `get:${ROUTE_PREFIX}/info`,
                `get:${ROUTE_PREFIX}/groups`,
                `get:${ROUTE_PREFIX}/cron/status`,
                `post:${ROUTE_PREFIX}/groups/:id/cron`,
                `get:${ROUTE_PREFIX}/groups/:id/cron`,
                `post:${ROUTE_PREFIX}/groups/:id/cleanup`,
                `get:${ROUTE_PREFIX}/groups/:id/cleanup/result`,
                `get:${ROUTE_PREFIX}/cleanup/stats`
            ];
            ctx.logger.info(`${LOG_TAG} 路由注册完成 | ${routes.length} 个路由`);
            ctx.logger.debug(`${LOG_TAG} 路由列表: ${routes.join(', ')}`);
        } catch (e) {
            ctx.logger.warn(`${LOG_TAG} 注册 WebUI 路由失败（环境可能不支持）`, e);
        }

        // 启动定时任务
        try {
            reloadAllCronJobs(ctx);
            ctx.logger.debug(`${LOG_TAG} 定时任务调度已启动`);
        } catch (e) {
            ctx.logger.error(`${LOG_TAG} 启动定时任务调度失败:`, e);
        }

        ctx.logger.info(`${LOG_TAG} 插件初始化完成`);
    } catch (error) {
        ctx.logger.error(`${LOG_TAG} 插件初始化失败:`, error);
    }
};

/**
 * 消息处理函数
 * 当收到群消息时触发，用于未来扩展（如管理员命令）
 */
const plugin_onmessage = async (ctx: NapCatPluginContext, event: OB11Message) => {
    const current = getConfig();
    if (!current.enabled) return;
    if (event.post_type !== EventType.MESSAGE || !event.raw_message) return;
    await handleMessage(ctx, event as OB11Message);
};

/**
 * 插件卸载函数
 * 负责清理资源、停止定时任务
 */
const plugin_cleanup = async (ctx: NapCatPluginContext) => {
    try {
        stopAllCronJobs();
        ctx.logger.info(`${LOG_TAG} 插件已卸载，定时任务已停止`);
    } catch (e) {
        ctx.logger.warn(`${LOG_TAG} 停止定时任务时出错:`, e);
    }
};

/** 获取当前配置 */
export const plugin_get_config = async (ctx: NapCatPluginContext) => {
    return getConfig();
};

/** 设置配置（完整替换） */
export const plugin_set_config = async (ctx: NapCatPluginContext, config: any) => {
    saveConfig(ctx, config);
    ctx.logger.info(`${LOG_TAG} 配置已通过 API 更新`);
};

/**
 * 配置变更回调
 * 当 WebUI 中修改配置时触发，自动保存并重载定时任务
 */
export const plugin_on_config_change = async (
    ctx: NapCatPluginContext,
    ui: PluginConfigUIController,
    key: string,
    value: any,
    currentConfig?: Record<string, any>
) => {
    try {
        await setConfig(ctx, { [key]: value } as any);
        ctx.logger.debug(`${LOG_TAG} 配置项 ${key} 已更新`);
    } catch (err) {
        ctx.logger.error(`${LOG_TAG} 更新配置项 ${key} 失败:`, err);
    }

    try {
        reloadAllCronJobs(ctx);
    } catch (err) {
        ctx.logger.error(`${LOG_TAG} 重新加载定时任务失败:`, err);
    }
};

export {
    plugin_init,
    plugin_onmessage,
    plugin_cleanup
};
