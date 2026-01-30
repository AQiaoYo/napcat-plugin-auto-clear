import fs from 'fs';
import path from 'path';
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import { DEFAULT_CONFIG, getDefaultConfig } from '../config';
import type { PluginConfig, GroupCronConfig } from '../types';

// 当前运行时配置（由 loadConfig / saveConfig 管理）
export let currentConfig: PluginConfig = { ...DEFAULT_CONFIG };

function isObject(v: unknown): v is Record<string, unknown> {
    return v !== null && typeof v === 'object';
}

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
                if (typeof (groupConfig as Record<string, unknown>)['message'] === 'string') {
                    cfg.message = (groupConfig as Record<string, unknown>)['message'] as string;
                }
                if (typeof (groupConfig as Record<string, unknown>)['inactiveDays'] === 'number') {
                    cfg.inactiveDays = (groupConfig as Record<string, unknown>)['inactiveDays'] as number;
                }
                out.groupConfigs![groupId] = cfg;
            }
        }
    }

    return out;
}

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

export function getConfig(): PluginConfig {
    return { ...currentConfig };
}

export function setConfig(ctx: NapCatPluginContext | undefined, config: Partial<PluginConfig>) {
    // 合并并保存
    const merged = { ...currentConfig, ...config } as PluginConfig;
    if (ctx) saveConfig(ctx, merged);
    else currentConfig = merged;
}
