/**
 * 状态管理模块
 * 负责配置的持久化存储和读取
 */

import fs from 'fs';
import path from 'path';
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import { DEFAULT_CONFIG, getDefaultConfig } from '../config';
import type { PluginConfig, GroupCronConfig, CleanupStats } from '../types';

/** 当前运行时配置 */
export let currentConfig: PluginConfig = { ...DEFAULT_CONFIG };

/** 类型守卫：判断是否为对象 */
function isObject(v: unknown): v is Record<string, unknown> {
    return v !== null && typeof v === 'object';
}

/**
 * 配置清洗函数
 * 确保从文件读取的配置符合预期类型
 */
function sanitizeConfig(raw: unknown): PluginConfig {
    if (!isObject(raw)) return getDefaultConfig();
    const base = getDefaultConfig();
    const out: PluginConfig = { ...base };

    // enabled
    if (typeof (raw as Record<string, unknown>)['enabled'] === 'boolean') {
        out.enabled = (raw as Record<string, unknown>)['enabled'] as boolean;
    }

    // globalCron
    if (typeof (raw as Record<string, unknown>)['globalCron'] === 'string') {
        out.globalCron = (raw as Record<string, unknown>)['globalCron'] as string;
    }

    // inactiveDays
    if (typeof (raw as Record<string, unknown>)['inactiveDays'] === 'number') {
        out.inactiveDays = (raw as Record<string, unknown>)['inactiveDays'] as number;
    }

    // dryRun
    if (typeof (raw as Record<string, unknown>)['dryRun'] === 'boolean') {
        out.dryRun = (raw as Record<string, unknown>)['dryRun'] as boolean;
    }

    // groupConfigs
    const rawGroupConfigs = (raw as Record<string, unknown>)['groupConfigs'];
    if (isObject(rawGroupConfigs)) {
        out.groupConfigs = {};
        for (const groupId of Object.keys(rawGroupConfigs as Record<string, unknown>)) {
            const groupConfig = (rawGroupConfigs as Record<string, unknown>)[groupId];
            if (isObject(groupConfig)) {
                const cfg: GroupCronConfig = {};
                if (typeof (groupConfig as Record<string, unknown>)['enabled'] === 'boolean') {
                    cfg.enabled = (groupConfig as Record<string, unknown>)['enabled'] as boolean;
                }
                if (typeof (groupConfig as Record<string, unknown>)['cron'] === 'string') {
                    cfg.cron = (groupConfig as Record<string, unknown>)['cron'] as string;
                }
                if (typeof (groupConfig as Record<string, unknown>)['inactiveDays'] === 'number') {
                    cfg.inactiveDays = (groupConfig as Record<string, unknown>)['inactiveDays'] as number;
                }
                if (typeof (groupConfig as Record<string, unknown>)['dryRun'] === 'boolean') {
                    cfg.dryRun = (groupConfig as Record<string, unknown>)['dryRun'] as boolean;
                }
                if (Array.isArray((groupConfig as Record<string, unknown>)['protectedMembers'])) {
                    cfg.protectedMembers = ((groupConfig as Record<string, unknown>)['protectedMembers'] as unknown[])
                        .filter(v => typeof v === 'string') as string[];
                }
                if (typeof (groupConfig as Record<string, unknown>)['lastCleanup'] === 'number') {
                    cfg.lastCleanup = (groupConfig as Record<string, unknown>)['lastCleanup'] as number;
                }
                if (typeof (groupConfig as Record<string, unknown>)['lastCleanupCount'] === 'number') {
                    cfg.lastCleanupCount = (groupConfig as Record<string, unknown>)['lastCleanupCount'] as number;
                }
                out.groupConfigs![groupId] = cfg;
            }
        }
    }

    // cleanupStats
    const rawStats = (raw as Record<string, unknown>)['cleanupStats'];
    if (isObject(rawStats)) {
        out.cleanupStats = {
            totalCleanups: typeof rawStats['totalCleanups'] === 'number' ? rawStats['totalCleanups'] as number : 0,
            totalKicked: typeof rawStats['totalKicked'] === 'number' ? rawStats['totalKicked'] as number : 0,
            lastCleanupTime: typeof rawStats['lastCleanupTime'] === 'number' ? rawStats['lastCleanupTime'] as number : undefined,
            groupStats: isObject(rawStats['groupStats']) ? rawStats['groupStats'] as CleanupStats['groupStats'] : {}
        };
    }

    return out;
}

/** 从文件加载配置 */
export function loadConfig(ctx: NapCatPluginContext) {
    try {
        if (typeof ctx?.configPath === 'string' && fs.existsSync(ctx.configPath)) {
            const raw = JSON.parse(fs.readFileSync(ctx.configPath, 'utf-8'));
            currentConfig = { ...getDefaultConfig(), ...sanitizeConfig(raw) };
            ctx.logger?.debug && ctx.logger.debug('📄 已加载本地配置', { path: ctx.configPath, config: currentConfig });
        } else {
            // 配置文件不存在则写入默认配置
            currentConfig = getDefaultConfig();
            saveConfig(ctx, currentConfig);
            ctx.logger?.debug && ctx.logger.debug('📄 配置文件不存在，已创建默认配置', { path: ctx?.configPath });
        }
    } catch (error) {
        ctx.logger?.error && ctx.logger.error('❌ 加载配置失败，使用默认配置:', error);
        currentConfig = getDefaultConfig();
    }
}

/** 保存配置到文件 */
export function saveConfig(ctx: NapCatPluginContext, config: PluginConfig) {
    try {
        const configDir = path.dirname(String(ctx.configPath || './'));
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }
        fs.writeFileSync(String(ctx.configPath || path.join(configDir, 'config.json')), JSON.stringify(config, null, 2), 'utf-8');
        currentConfig = { ...config };
        ctx.logger?.debug && ctx.logger.debug('💾 配置已保存', { path: ctx.configPath });
    } catch (error) {
        ctx.logger?.error && ctx.logger.error('❌ 保存配置失败:', error);
    }
}

/** 获取当前配置的副本 */
export function getConfig(): PluginConfig {
    return { ...currentConfig };
}

/** 合并并设置配置 */
export function setConfig(ctx: NapCatPluginContext | undefined, config: Partial<PluginConfig>) {
    const merged = { ...currentConfig, ...config } as PluginConfig;
    if (ctx) saveConfig(ctx, merged);
    else currentConfig = merged;
}
