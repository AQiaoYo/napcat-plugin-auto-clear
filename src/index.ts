// @ts-ignore
import type { PluginModule, NapCatPluginContext, PluginConfigSchema, PluginConfigUIController } from 'napcat-types/napcat-onebot/network/plugin-manger';
// @ts-ignore
import type { OB11Message } from 'napcat-types/napcat-onebot';
// @ts-ignore
import { EventType } from 'napcat-types/napcat-onebot/event/index';

import { initConfigUI } from './config';
import { loadConfig, saveConfig, getConfig, updateConfigField, setGroupWhitelist } from './core/state';
import { handleMessage } from './handlers/message-handler';
import { getGroupsWithPermissions } from './services/group-service';
import { runScanForGroup, getLastScanResults, startScheduler, stopScheduler } from './services/cleanup-service';
import { startGlobalCronJob, startGroupCronJob, stopAllCronJobs, reloadAllCronJobs, getCronJobStatus, isValidCronExpression } from './services/cron-service';

// 导出框架期望的变量名，框架在加载模块时会读取此导出用于展示配置 UI
export let plugin_config_ui: PluginConfigSchema = [];

const plugin_init = async (ctx: NapCatPluginContext) => {
    try {
        // 诊断日志：打印 pluginName、router 与 configPath，帮助定位 WebUI 路由注册问题
        ctx.logger.info(`🔎 plugin_init: name=${ctx.pluginName}, router=${Boolean(ctx.router)}, configPath=${String(ctx.configPath)}`);

        loadConfig(ctx);
        // 生成配置 schema 并导出，让 NapCat WebUI 能读取到最新 schema
        const schema = initConfigUI(ctx);
        plugin_config_ui = schema;
        // 注册静态资源与扩展页面，供 NapCat WebUI 加载
        try {
            // 在 NapCat 中，ctx.router 提供静态与页面注册能力
            // static('/static', 'webui') 会把插件目录下的 src/webui 作为静态目录暴露
            ctx.router.static('/static', 'webui');
            // 提供一个小脚本，页面可以通过相对路径加载来获得宿主注入的 pluginName（提高仪表盘识别率）
            ctx.router.get('/static/plugin-info.js', (_req: any, res: any) => {
                try {
                    res.type('application/javascript');
                    res.send(`window.__PLUGIN_NAME__ = ${JSON.stringify(ctx.pluginName)};`);
                } catch (e) {
                    // 忽略
                    res.status(500).send('// failed to generate plugin-info');
                }
            });

            // 提供一个简单的 info 接口，供探测使用
            ctx.router.get('/info', (_req: any, res: any) => {
                res.json({ code: 0, data: { pluginName: ctx.pluginName } });
            });
            ctx.router.page({
                path: 'dashboard',
                title: '插件仪表盘',
                icon: '📊',
                htmlFile: 'webui/dashboard.html',
                description: '查看插件运行状态与当前配置'
            });
            // 注册简单的 API 路由，供扩展页面使用（/status, /config）
            ctx.router.get('/status', (_req: any, res: any) => {
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

            ctx.router.get('/config', (_req: any, res: any) => {
                res.json({ code: 0, data: getConfig() });
            });

            // 返回群列表及当前机器人在各群的权限信息
            ctx.router.get('/groups', async (_req: any, res: any) => {
                try {
                    const data = await getGroupsWithPermissions(ctx);
                    res.json({ code: 0, data });
                } catch (e) {
                    res.status(500).json({ code: -1, message: String(e) });
                }
            });

            // 更新某个群的白名单开关（body: { group_id: string, enabled: boolean }）
            ctx.router.post('/groups/whitelist', async (req: any, res: any) => {
                try {
                    const body = req.body || {};
                    const groupId = String(body.group_id || body.groupId || body.id || '');
                    const enabled = Boolean(body.enabled === true || body.enabled === 'true');
                    if (!groupId) return res.status(400).json({ code: -1, message: 'missing group_id' });
                    // 持久化到配置
                    const { setGroupWhitelist } = await import('./core/state');
                    setGroupWhitelist(ctx, groupId, enabled);
                    res.json({ code: 0, message: 'ok', data: { group_id: groupId, enabled } });
                } catch (e) {
                    ctx.logger.error('设置群白名单失败:', e);
                    res.status(500).json({ code: -1, message: String(e) });
                }
            });

            // 手动触发扫描（dry-run）并返回候选
            ctx.router.post('/groups/:id/scan', async (req: any, res: any) => {
                try {
                    const groupId = String(req.params?.id || req.body?.group_id || req.body?.id || '');
                    if (!groupId) return res.status(400).json({ code: -1, message: 'missing group id' });
                    const result = await runScanForGroup(ctx, groupId);
                    res.json({ code: 0, data: result });
                } catch (e) {
                    ctx.logger.error('手动扫描失败:', e);
                    res.status(500).json({ code: -1, message: String(e) });
                }
            });

            // 获取最近一次扫描结果
            ctx.router.get('/groups/:id/candidates', async (req: any, res: any) => {
                try {
                    const groupId = String(req.params?.id || '');
                    if (!groupId) return res.status(400).json({ code: -1, message: 'missing group id' });
                    const r = getLastScanResults(groupId);
                    res.json({ code: 0, data: r });
                } catch (e) {
                    ctx.logger.error('获取扫描结果失败:', e);
                    res.status(500).json({ code: -1, message: String(e) });
                }
            });

            ctx.router.post('/config', async (req: any, res: any) => {
                try {
                    const newCfg = req.body || {};
                    // 输入校验
                    const errors: string[] = [];

                    // 全局cron校验
                    if (newCfg.globalCron !== undefined && newCfg.globalCron !== null && String(newCfg.globalCron).trim() !== '') {
                        if (!isValidCronExpression(String(newCfg.globalCron))) {
                            errors.push('globalCron: 无效的 cron 表达式（仅支持 node-cron，5 或 6 字段，不能包含 ?）');
                        }
                    }

                    // 已移除 globalTargetQQ: 通知将直接发送到群内

                    // 全局 inactiveDays 校验（可选，若提供须为 >=1 的整数）
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
                        return res.status(400).json({ code: -1, message: '配置校验失败', errors });
                    }

                    // 保存并持久化
                    await saveConfig(ctx, { ...getConfig(), ...newCfg });
                    // 重新加载定时任务
                    reloadAllCronJobs(ctx);
                    res.json({ code: 0, message: 'Config saved' });
                } catch (err) {
                    ctx.logger.error('保存配置 via /config 失败:', err);
                    res.status(500).json({ code: -1, message: String(err) });
                }
            });

            // 获取定时任务状态
            ctx.router.get('/cron/status', (_req: any, res: any) => {
                try {
                    const status = getCronJobStatus();
                    res.json({ code: 0, data: status });
                } catch (e) {
                    ctx.logger.error('获取定时任务状态失败:', e);
                    res.status(500).json({ code: -1, message: String(e) });
                }
            });

            // 更新群的定时任务配置
            ctx.router.post('/groups/:id/cron', async (req: any, res: any) => {
                try {
                    const groupId = String(req.params?.id || '');
                    if (!groupId) return res.status(400).json({ code: -1, message: 'missing group id' });

                    const cronConfig = req.body || {};
                    const currentConfig = getConfig();

                    // 更新群配置
                    const groupConfigs = { ...(currentConfig.groupConfigs || {}) };
                    groupConfigs[groupId] = {
                        ...groupConfigs[groupId],
                        ...cronConfig
                    };

                    // 保存配置
                    await saveConfig(ctx, {
                        ...currentConfig,
                        groupConfigs
                    });

                    // 重新启动该群的定时任务
                    startGroupCronJob(ctx, groupId);

                    res.json({ code: 0, message: 'Group cron config updated', data: { group_id: groupId, config: groupConfigs[groupId] } });
                } catch (e) {
                    ctx.logger.error('更新群定时任务配置失败:', e);
                    res.status(500).json({ code: -1, message: String(e) });
                }
            });

            // 获取群的定时任务配置
            ctx.router.get('/groups/:id/cron', (req: any, res: any) => {
                try {
                    const groupId = String(req.params?.id || '');
                    if (!groupId) return res.status(400).json({ code: -1, message: 'missing group id' });

                    const currentConfig = getConfig();
                    const groupConfig = currentConfig.groupConfigs?.[groupId] || {};

                    res.json({ code: 0, data: groupConfig });
                } catch (e) {
                    ctx.logger.error('获取群定时任务配置失败:', e);
                    res.status(500).json({ code: -1, message: String(e) });
                }
            });
            ctx.logger.debug('🔗 WebUI 页面与静态资源已注册');
            // 记录已注册的路由（仅用于诊断）
            try {
                const routes = ['static:/static', 'page:/dashboard', 'get:/status', 'get:/config', 'post:/config', 'get:/static/plugin-info.js', 'get:/info'];
                ctx.logger.info(`🛣️ 已尝试注册路由: ${routes.join(', ')}`);
            } catch (e) {
                // ignore
            }
        } catch (e) {
            ctx.logger.debug('⚠️ 注册 WebUI 路由失败（环境可能不支持或 ctx.router 不存在）', e);
        }
        // 启动自动扫描调度（dry-run），每天一次；仅在支持 ctx.actions 时有意义
        try {
            startScheduler(ctx);
        } catch (e) {
            ctx.logger.error('启动自动扫描调度失败:', e);
        }

        // 启动定时任务调度
        try {
            reloadAllCronJobs(ctx);
        } catch (e) {
            ctx.logger.error('启动定时任务调度失败:', e);
        }
        ctx.logger.info(`✅ ${ctx.pluginName} 插件初始化完成`);
        const current = getConfig();
    } catch (error) {
        ctx.logger.error('❌ 插件初始化失败:', error);
    }
};

const plugin_onmessage = async (ctx: NapCatPluginContext, event: OB11Message) => {
    const current = getConfig();
    if (!current.enabled) return;
    if (event.post_type !== EventType.MESSAGE || !event.raw_message) return;
    // 插件当前只通过 enabled 开关控制行为，如需更多调试请在代码中添加日志
    await handleMessage(ctx, event as OB11Message);
};

const plugin_cleanup = async (ctx: NapCatPluginContext) => {
    ctx.logger.info(`🔌 ${ctx.pluginName} 插件已卸载`);
    try {
        stopScheduler();
    } catch (e) {
        ctx.logger.debug('停止扫描调度失败', e);
    }
    try {
        stopAllCronJobs();
    } catch (e) {
        ctx.logger.debug('停止定时任务失败', e);
    }
};

export const plugin_get_config = async (ctx: NapCatPluginContext) => {
    return getConfig();
};

export const plugin_set_config = async (ctx: NapCatPluginContext, config: any) => {
    saveConfig(ctx, config);
    ctx.logger.info('🔧 配置已更新:', config);
};

export const plugin_on_config_change = async (
    ctx: NapCatPluginContext,
    ui: PluginConfigUIController,
    key: string,
    value: any,
    currentConfig?: Record<string, any>
) => {
    const current = getConfig();

    try {
        // 持久化单项变更
        await updateConfigField(ctx, key as any, value);
    } catch (err) {
        ctx.logger.error('❌ 更新配置失败:', err);
    }

    // 配置变化时重新加载定时任务
    try {
        reloadAllCronJobs(ctx);
    } catch (err) {
        ctx.logger.error('重新加载定时任务失败:', err);
    }

    // 当前仅保留一个开关，无需动态显示/隐藏其他字段
};

export {
    plugin_init,
    plugin_onmessage,
    plugin_cleanup
};
