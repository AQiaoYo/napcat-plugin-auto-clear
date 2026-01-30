import * as cron from 'node-cron';
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import { getConfig } from '../core/state';
import type { GroupCronConfig } from '../types';

// 存储活跃的cron任务
const activeCronJobs: Map<string, cron.ScheduledTask> = new Map();

/**
 * 验证cron表达式是否有效
 */
export function isValidCronExpression(cronExpression: string): boolean {
    if (!cronExpression || typeof cronExpression !== 'string') {
        return false;
    }

    // 基本格式检查：应该有5或6个字段
    const parts = cronExpression.trim().split(/\s+/);
    if (parts.length < 5 || parts.length > 6) {
        return false;
    }

    // 禁止任何字段包含?字符，且每个字段都不应为空
    for (const part of parts) {
        if (!part || part.length === 0 || part.includes('?')) {
            return false;
        }
    }

    return true;
}

/**
 * 获取有效的cron表达式，如果无效则返回默认值
 */
function getValidCronExpression(cronExpression: string): string {
    return isValidCronExpression(cronExpression) ? cronExpression : '*/30 * * * * *';
}

/**
 * 启动全局定时任务
 */
export function startGlobalCronJob(ctx: NapCatPluginContext) {
    const config = getConfig();

    if (!config.enabled || !config.globalCron) {
        ctx.logger?.info('全局定时任务未启用或未配置 globalCron');
        return;
    }

    // 验证cron表达式
    const validCron = getValidCronExpression(config.globalCron || '');
    if (validCron !== (config.globalCron || '')) {
        ctx.logger?.warn(`无效的cron表达式 "${config.globalCron}"，使用默认值 "${validCron}"`);
    }

    ctx.logger?.info(`准备启动全局定时任务，cron: "${validCron}"`);

    try {
        // 停止已存在的全局任务
        stopCronJob('global');

        const job = cron.schedule(validCron, async () => {
            await executeGlobalCronTask(ctx);
        });

        activeCronJobs.set('global', job);
        ctx.logger?.info(`全局定时任务已启动: ${validCron}`);
    } catch (error) {
        ctx.logger?.error(`启动全局定时任务失败, cron: "${validCron}":`, error);
    }
}

/**
 * 启动指定群的定时任务
 */
export function startGroupCronJob(ctx: NapCatPluginContext, groupId: string) {
    const config = getConfig();
    const groupConfig = config.groupConfigs?.[groupId];

    if (!config.enabled || !groupConfig?.enabled) {
        return;
    }

    // 使用群配置或回退到全局配置
    const cronExpression = groupConfig.cron || config.globalCron || '';

    // 验证cron表达式
    const validCron = getValidCronExpression(cronExpression);

    if (!validCron) {
        ctx.logger?.info(`群 ${groupId} 定时任务未启用或cron表达式无效`);
        return;
    }

    if (validCron !== cronExpression) {
        ctx.logger?.warn(`群 ${groupId} 无效的cron表达式 "${cronExpression}"，使用默认值 "${validCron}"`);
    }

    try {
        // 停止已存在的群任务
        stopCronJob(`group_${groupId}`);

        const job = cron.schedule(validCron, async () => {
            await executeGroupCronTask(ctx, groupId);
        });

        activeCronJobs.set(`group_${groupId}`, job);
        ctx.logger?.info(`群 ${groupId} 定时任务已启动: ${validCron}`);
    } catch (error) {
        ctx.logger?.error(`启动群 ${groupId} 定时任务失败:`, error);
    }
}

/**
 * 停止指定cron任务
 */
export function stopCronJob(jobId: string) {
    const job = activeCronJobs.get(jobId);
    if (job) {
        job.stop();
        activeCronJobs.delete(jobId);
    }
}

/**
 * 停止所有cron任务
 */
export function stopAllCronJobs() {
    for (const [jobId, job] of activeCronJobs) {
        job.stop();
    }
    activeCronJobs.clear();
}

/**
 * 重新加载所有定时任务
 */
export function reloadAllCronJobs(ctx: NapCatPluginContext) {
    stopAllCronJobs();

    const config = getConfig();
    if (!config.enabled) {
        return;
    }

    // 启动全局任务
    startGlobalCronJob(ctx);

    // 启动所有群任务
    if (config.groupConfigs) {
        for (const groupId of Object.keys(config.groupConfigs)) {
            startGroupCronJob(ctx, groupId);
        }
    }
}

/**
 * 执行全局定时任务
 */
async function executeGlobalCronTask(ctx: NapCatPluginContext) {
    const config = getConfig();

    // 全局定时任务触发时，遍历所有群配置并在各群内发送扫描结果（dry-run 风格），不再使用私聊通知
    if (!config.groupConfigs) return;

    for (const groupId of Object.keys(config.groupConfigs)) {
        try {
            const gc = config.groupConfigs[groupId] || {};
            if (!gc.enabled) continue;
            await executeGroupCronTask(ctx, groupId);
        } catch (e) {
            ctx.logger?.error(`全局定时任务处理群 ${groupId} 时出错:`, e);
        }
    }
}

/**
 * 执行群定时任务
 */
async function executeGroupCronTask(ctx: NapCatPluginContext, groupId: string) {
    try {
        // 获取最新扫描结果
        const { runScanForGroup } = await import('./cleanup-service');
        const candidates = await runScanForGroup(ctx, groupId);
        let msg = '';
        if (candidates.length === 0) {
            msg = '本群暂无长时间未发言成员。';
        } else {
            msg = `以下成员长时间未发言（超过阈值）：\n`;
            candidates.slice(0, 10).forEach((u, idx) => {
                msg += `${idx + 1}. ${u.nickname || u.user_id}（${u.user_id}） 不活跃${u.inactive_days}天\n`;
            });
            if (candidates.length > 10) {
                msg += `……等${candidates.length}人`;
            }
        }

        // 直接在群内发送通知（不进行私聊）
        const groupIdNum = Number(groupId);
        if (!Number.isFinite(groupIdNum) || groupIdNum <= 0) {
            ctx.logger?.error(`群 ${groupId} 定时任务失败: 无效的 groupId`);
            return;
        }
        await ctx.actions.call('send_group_msg', {
            group_id: groupIdNum,
            message: msg
        }, ctx.adapterName, ctx.pluginManager.config);
        ctx.logger?.info(`群 ${groupId} 定时任务执行成功，发送群消息`);
    } catch (error) {
        ctx.logger?.error(`执行群 ${groupId} 定时任务失败:`, error);
    }
}

/**
 * 获取活跃的cron任务状态
 */
export function getCronJobStatus() {
    const status: Record<string, boolean> = {};
    for (const [jobId] of activeCronJobs) {
        status[jobId] = true;
    }
    return status;
}