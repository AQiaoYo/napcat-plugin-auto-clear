/**
 * 定时任务服务
 * 负责管理 cron 定时清理任务的启动、停止和调度
 */

import * as cron from 'node-cron';
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import { getConfig } from '../core/state';
import type { GroupCronConfig } from '../types';
import { runCleanupAndNotify } from './cleanup-service';

/** 日志前缀 */
const LOG_TAG = '[AutoClear]';

/** 存储活跃的 cron 任务 */
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
        ctx.logger?.debug(`${LOG_TAG} 全局定时任务未启用或未配置`);
        return;
    }

    const validCron = getValidCronExpression(config.globalCron || '');
    if (validCron !== (config.globalCron || '')) {
        ctx.logger?.warn(`${LOG_TAG} 无效的 cron 表达式 "${config.globalCron}"，使用默认值 "${validCron}"`);
    }

    try {
        stopCronJob('global');

        const job = cron.schedule(validCron, async () => {
            await executeGlobalCronTask(ctx);
        });

        activeCronJobs.set('global', job);
        ctx.logger?.info(`${LOG_TAG} 全局定时任务已启动 | cron=${validCron}`);
    } catch (error) {
        ctx.logger?.error(`${LOG_TAG} 启动全局定时任务失败 | cron=${validCron}`, error);
    }
}

/**
 * 启动指定群的定时任务
 */
export function startGroupCronJob(ctx: NapCatPluginContext, groupId: string) {
    const config = getConfig();
    const groupConfig = config.groupConfigs?.[groupId];

    if (!config.enabled || !groupConfig?.enabled) {
        stopCronJob(`group_${groupId}`);
        return;
    }

    const cronExpression = groupConfig.cron || config.globalCron || '';
    const validCron = getValidCronExpression(cronExpression);

    if (!validCron) {
        ctx.logger?.debug(`${LOG_TAG} 群 ${groupId} 定时任务未启用或 cron 表达式无效`);
        return;
    }

    if (validCron !== cronExpression) {
        ctx.logger?.warn(`${LOG_TAG} 群 ${groupId} 无效的 cron 表达式 "${cronExpression}"，使用默认值 "${validCron}"`);
    }

    try {
        stopCronJob(`group_${groupId}`);

        const job = cron.schedule(validCron, async () => {
            await executeGroupCronTask(ctx, groupId);
        });

        activeCronJobs.set(`group_${groupId}`, job);
        ctx.logger?.info(`${LOG_TAG} 群 ${groupId} 定时任务已启动 | cron=${validCron}`);
    } catch (error) {
        ctx.logger?.error(`${LOG_TAG} 启动群 ${groupId} 定时任务失败:`, error);
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
    if (!config.groupConfigs) return;

    ctx.logger?.debug(`${LOG_TAG} 全局定时任务触发`);

    for (const groupId of Object.keys(config.groupConfigs)) {
        try {
            const gc = config.groupConfigs[groupId] || {};
            if (!gc.enabled) continue;
            await executeGroupCronTask(ctx, groupId);
        } catch (e) {
            ctx.logger?.error(`${LOG_TAG} 全局定时任务处理群 ${groupId} 时出错:`, e);
        }
    }
}

/**
 * 执行群定时任务 - 清理不活跃成员
 */
async function executeGroupCronTask(ctx: NapCatPluginContext, groupId: string) {
    try {
        ctx.logger?.info(`${LOG_TAG} 群 ${groupId} 定时清理任务触发`);
        
        const groupIdNum = Number(groupId);
        if (!Number.isFinite(groupIdNum) || groupIdNum <= 0) {
            ctx.logger?.error(`${LOG_TAG} 群 ${groupId} 定时任务失败: 无效的 groupId`);
            return;
        }

        const result = await runCleanupAndNotify(ctx, groupId);
        
        ctx.logger?.info(`${LOG_TAG} 群 ${groupId} 定时清理完成 | 不活跃=${result.inactiveMembers}, ${result.dryRun ? '试运行模式' : `已清理=${result.kickedMembers}`}`);
    } catch (error) {
        ctx.logger?.error(`${LOG_TAG} 执行群 ${groupId} 定时清理任务失败:`, error);
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