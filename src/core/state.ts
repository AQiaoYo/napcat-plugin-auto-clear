import fs from 'fs';
import path from 'path';
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import { DEFAULT_CONFIG, getDefaultConfig } from '../config';
import type { PluginConfig } from '../types';

// 当前运行时配置（由 loadConfig / saveConfig 管理）
export let currentConfig: PluginConfig = { ...DEFAULT_CONFIG };

function isObject(v: unknown): v is Record<string, unknown> {
    return v !== null && typeof v === 'object';
}

function sanitizeConfig(raw: unknown): PluginConfig {
    if (!isObject(raw)) return getDefaultConfig();
    const base = getDefaultConfig();
    const out: PluginConfig = { ...base };

    // 仅保留 enabled 字段的校验与赋值
    if (typeof (raw as Record<string, unknown>)['enabled'] === 'boolean') {
        out.enabled = (raw as Record<string, unknown>)['enabled'] as boolean;
    }

    // whitelist: optional map of group_id -> boolean
    const rawWhitelist = (raw as Record<string, unknown>)['whitelist'];
    if (isObject(rawWhitelist)) {
        out.whitelist = {};
        for (const k of Object.keys(rawWhitelist as Record<string, unknown>)) {
            if (typeof (rawWhitelist as Record<string, unknown>)[k] === 'boolean') {
                out.whitelist[k] = Boolean((rawWhitelist as Record<string, unknown>)[k]);
            }
        }
    }

    // 新增：定时任务配置校验
    if (typeof (raw as Record<string, unknown>)['globalCron'] === 'string') {
        out.globalCron = (raw as Record<string, unknown>)['globalCron'] as string;
    }
    if (typeof (raw as Record<string, unknown>)['globalMessage'] === 'string') {
        out.globalMessage = (raw as Record<string, unknown>)['globalMessage'] as string;
    }
    if (typeof (raw as Record<string, unknown>)['globalTargetQQ'] === 'string') {
        out.globalTargetQQ = (raw as Record<string, unknown>)['globalTargetQQ'] as string;
    }

    // groupConfigs: optional map of group_id -> GroupCronConfig
    const rawGroupConfigs = (raw as Record<string, unknown>)['groupConfigs'];
    if (isObject(rawGroupConfigs)) {
        out.groupConfigs = {};
        for (const groupId of Object.keys(rawGroupConfigs as Record<string, unknown>)) {
            const groupConfig = (rawGroupConfigs as Record<string, unknown>)[groupId];
            if (isObject(groupConfig)) {
                out.groupConfigs[groupId] = {};
                const config = out.groupConfigs[groupId];

                if (typeof (groupConfig as Record<string, unknown>)['enabled'] === 'boolean') {
                    config.enabled = (groupConfig as Record<string, unknown>)['enabled'] as boolean;
                }
                if (typeof (groupConfig as Record<string, unknown>)['cron'] === 'string') {
                    config.cron = (groupConfig as Record<string, unknown>)['cron'] as string;
                }
                if (typeof (groupConfig as Record<string, unknown>)['message'] === 'string') {
                    config.message = (groupConfig as Record<string, unknown>)['message'] as string;
                }
                if (typeof (groupConfig as Record<string, unknown>)['targetQQ'] === 'string') {
                    config.targetQQ = (groupConfig as Record<string, unknown>)['targetQQ'] as string;
                }
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
            ctx.logger.debug('📄 已加载本地配置', { path: ctx.configPath, config: currentConfig });
        } else {
            // 配置文件不存在则写入默认配置
            currentConfig = getDefaultConfig();
            saveConfig(ctx, currentConfig);
            ctx.logger.debug('📄 配置文件不存在，已创建默认配置', { path: ctx?.configPath });
        }
    } catch (error) {
        ctx.logger.error('❌ 加载配置失败，使用默认配置:', error);
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
        ctx.logger.debug('💾 配置已保存', { path: ctx.configPath });
    } catch (error) {
        ctx.logger.error('❌ 保存配置失败:', error);
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

export function updateConfigField(ctx: NapCatPluginContext | undefined, key: keyof PluginConfig, value: unknown) {
    const next = { ...currentConfig } as any;
    next[key] = value;
    if (ctx) saveConfig(ctx, next);
    else currentConfig = next;
}

// 专门设置某个群的白名单开关（持久化）
export function setGroupWhitelist(ctx: NapCatPluginContext | undefined, groupId: string, enabled: boolean) {
    const next = { ...currentConfig } as PluginConfig;
    next.whitelist = { ...(next.whitelist || {}) };
    if (enabled) next.whitelist[groupId] = true;
    else delete next.whitelist[groupId];
    if (ctx) saveConfig(ctx, next);
    else currentConfig = next;
}
