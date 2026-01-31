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
import { pluginState } from './core/state';
import { handleMessage } from './handlers/message-handler';
import { getGroupsWithPermissions } from './services/group-service';
import { runCleanupAndNotify, runCleanupForGroup, getLastCleanupResult, getCleanupStats } from './services/cleanup-service';
import { startGlobalCronJob, startGroupCronJob, stopAllCronJobs, stopCronJob, reloadAllCronJobs, getCronJobStatus, isValidCronExpression } from './services/cron-service';

/** 框架配置 UI Schema，NapCat WebUI 会读取此导出来展示配置面板 */
export let plugin_config_ui: PluginConfigSchema = [];

/** 路由前缀，防止与其他插件冲突 */
const ROUTE_PREFIX = '/clear';

/**
 * 插件初始化函数
 * 负责加载配置、注册 WebUI 路由、启动定时任务
 */
const plugin_init = async (ctx: NapCatPluginContext) => {
    try {
        pluginState.initFromContext(ctx);
        pluginState.loadConfig(ctx);
        pluginState.log('info', `初始化开始 | name=${ctx.pluginName}, router=${Boolean((ctx as any).router)}`);
        pluginState.logDebug('配置加载完成');

        // 生成配置 schema 并导出
        const schema = initConfigUI(ctx);
        plugin_config_ui = schema;

        // 注册 WebUI 路由
        try {
            // 为避免多处拼接前缀，这里包装一个带前缀的 router
            const prefixedRouter = (() => {
                const base = (ctx as any).router;
                const prefix = ROUTE_PREFIX;
                const wrapPath = (p: string) => {
                    if (!p) return prefix;
                    return p.startsWith('/') ? `${prefix}${p}` : `${prefix}/${p}`;
                };
                return {
                    get: (p: string, ...args: any[]) => base.get(wrapPath(p), ...args),
                    post: (p: string, ...args: any[]) => base.post(wrapPath(p), ...args),
                    static: (p: string, dir: string) => base.static(wrapPath(p), dir),
                    page: (opts: any) => base.page(opts),
                };
            })();

            // 静态资源目录
            prefixedRouter.static('/static', 'webui');

            // 插件信息脚本
            prefixedRouter.get('/static/plugin-info.js', (_req: any, res: any) => {
                try {
                    res.type('application/javascript');
                    res.send(`window.__PLUGIN_NAME__ = ${JSON.stringify(ctx.pluginName)};`);
                } catch (e) {
                    res.status(500).send('// failed to generate plugin-info');
                }
            });

            // 基础信息接口
            prefixedRouter.get('/info', (_req: any, res: any) => {
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
            prefixedRouter.get('/status', (_req: any, res: any) => {
                const uptime = pluginState.getUptime();
                res.json({
                    code: 0,
                    data: {
                        pluginName: pluginState.pluginName,
                        uptime,
                        uptimeFormatted: pluginState.getUptimeFormatted(),
                        config: pluginState.getConfig(),
                        platform: process.platform,
                        arch: process.arch
                    }
                });
            });

            // 配置读取接口
            prefixedRouter.get('/config', (_req: any, res: any) => {
                res.json({ code: 0, data: pluginState.getConfig() });
            });

            // 群列表接口
            prefixedRouter.get('/groups', async (_req: any, res: any) => {
                try {
                    const data = await getGroupsWithPermissions(ctx);
                    res.json({ code: 0, data });
                } catch (e) {
                    pluginState.log('error', '获取群列表失败:', e);
                    res.status(500).json({ code: -1, message: String(e) });
                }
            });

            // 配置保存接口
            prefixedRouter.post('/config', async (req: any, res: any) => {
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
                        pluginState.log('warn', `配置校验失败: ${errors.join(', ')}`);
                        return res.status(400).json({ code: -1, message: '配置校验失败', errors });
                    }

                    pluginState.setConfig(ctx, newCfg);
                    reloadAllCronJobs(ctx);
                    pluginState.log('info', '配置已保存');
                    res.json({ code: 0, message: 'Config saved' });
                } catch (err) {
                    pluginState.log('error', '保存配置失败:', err);
                    res.status(500).json({ code: -1, message: String(err) });
                }
            });

            // 定时任务状态接口
            prefixedRouter.get('/cron/status', (_req: any, res: any) => {
                try {
                    const status = getCronJobStatus();
                    res.json({ code: 0, data: status });
                } catch (e) {
                    pluginState.log('error', '获取定时任务状态失败:', e);
                    res.status(500).json({ code: -1, message: String(e) });
                }
            });

            // 更新群定时任务配置
            prefixedRouter.post('/groups/:id/cron', async (req: any, res: any) => {
                try {
                    const groupId = String(req.params?.id || '');
                    if (!groupId) return res.status(400).json({ code: -1, message: 'missing group id' });

                    const cronConfig = req.body || {};
                    pluginState.updateGroupConfig(ctx, groupId, cronConfig);

                    const groupConfig = pluginState.config.groupConfigs?.[groupId];
                    if (groupConfig?.enabled) {
                        startGroupCronJob(ctx, groupId);
                    } else {
                        stopCronJob(`group_${groupId}`);
                    }

                    pluginState.log('info', `群 ${groupId} 定时任务配置已更新`);
                    res.json({ code: 0, message: 'Group cron config updated', data: { group_id: groupId, config: groupConfig } });
                } catch (e) {
                    pluginState.log('error', '更新群定时任务配置失败:', e);
                    res.status(500).json({ code: -1, message: String(e) });
                }
            });

            // 获取群定时任务配置
            prefixedRouter.get('/groups/:id/cron', (req: any, res: any) => {
                try {
                    const groupId = String(req.params?.id || '');
                    if (!groupId) return res.status(400).json({ code: -1, message: 'missing group id' });

                    const groupConfig = pluginState.config.groupConfigs?.[groupId] || {};
                    res.json({ code: 0, data: groupConfig });
                } catch (e) {
                    pluginState.log('error', '获取群定时任务配置失败:', e);
                    res.status(500).json({ code: -1, message: String(e) });
                }
            });

            // 手动触发群清理
            prefixedRouter.post('/groups/:id/cleanup', async (req: any, res: any) => {
                try {
                    const groupId = String(req.params?.id || '');
                    if (!groupId) return res.status(400).json({ code: -1, message: 'missing group id' });

                    const body = req.body || {};
                    const dryRun = body.dryRun !== undefined ? Boolean(body.dryRun) : undefined;
                    const notify = body.notify !== false;

                    pluginState.log('info', `手动触发群 ${groupId} 清理 | dryRun=${dryRun}, notify=${notify}`);

                    let result;
                    if (notify) {
                        result = await runCleanupAndNotify(ctx, groupId, dryRun);
                    } else {
                        result = await runCleanupForGroup(ctx, groupId, dryRun);
                    }

                    res.json({ code: 0, data: result });
                } catch (e) {
                    pluginState.log('error', '手动清理群失败:', e);
                    res.status(500).json({ code: -1, message: String(e) });
                }
            });

            // 获取群清理结果
            prefixedRouter.get('/groups/:id/cleanup/result', (req: any, res: any) => {
                try {
                    const groupId = String(req.params?.id || '');
                    if (!groupId) return res.status(400).json({ code: -1, message: 'missing group id' });

                    const result = getLastCleanupResult(groupId);
                    res.json({ code: 0, data: result || null });
                } catch (e) {
                    pluginState.log('error', '获取清理结果失败:', e);
                    res.status(500).json({ code: -1, message: String(e) });
                }
            });

            // 清理统计接口
            prefixedRouter.get('/cleanup/stats', (_req: any, res: any) => {
                try {
                    const stats = getCleanupStats();
                    res.json({ code: 0, data: stats });
                } catch (e) {
                    pluginState.log('error', '获取清理统计失败:', e);
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
            pluginState.log('info', `路由注册完成 | ${routes.length} 个路由`);
            pluginState.logDebug(`路由列表: ${routes.join(', ')}`);
        } catch (e) {
            pluginState.log('warn', '注册 WebUI 路由失败（环境可能不支持）', e);
        }

        // 启动定时任务
        try {
            reloadAllCronJobs(ctx);
            pluginState.logDebug('定时任务调度已启动');
        } catch (e) {
            pluginState.log('error', '启动定时任务调度失败:', e);
        }

        pluginState.log('info', '插件初始化完成');
    } catch (error) {
        pluginState.log('error', '插件初始化失败:', error);
    }
};

/**
 * 消息处理函数
 * 当收到群消息时触发，用于未来扩展（如管理员命令）
 */
const plugin_onmessage = async (ctx: NapCatPluginContext, event: OB11Message) => {
    if (!pluginState.config.enabled) return;
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
        pluginState.log('info', '插件已卸载，定时任务已停止');
    } catch (e) {
        pluginState.log('warn', '停止定时任务时出错:', e);
    }
};

/** 获取当前配置 */
export const plugin_get_config = async (ctx: NapCatPluginContext) => {
    return pluginState.getConfig();
};

/** 设置配置（完整替换） */
export const plugin_set_config = async (ctx: NapCatPluginContext, config: any) => {
    pluginState.saveConfig(ctx, config);
    pluginState.log('info', '配置已通过 API 更新');
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
        pluginState.setConfig(ctx, { [key]: value } as any);
        pluginState.logDebug(`配置项 ${key} 已更新`);
    } catch (err) {
        pluginState.log('error', `更新配置项 ${key} 失败:`, err);
    }

    try {
        reloadAllCronJobs(ctx);
    } catch (err) {
        pluginState.log('error', '重新加载定时任务失败:', err);
    }
};

export {
    plugin_init,
    plugin_onmessage,
    plugin_cleanup
};
