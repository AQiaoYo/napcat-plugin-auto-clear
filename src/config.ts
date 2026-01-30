import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import type { PluginConfig } from './types';

// 默认配置
export const DEFAULT_CONFIG: PluginConfig = {
    // 仅保留一个全局开关与按群白名单
    enabled: true,
    whitelist: {}
};

// 初始化 WebUI 配置 schema
export function initConfigUI(ctx: NapCatPluginContext) {
    // 使用 NapCat 提供的构建器生成 schema 并返回，调用方负责将其挂载到导出的变量上
    const schema = ctx.NapCatConfig.combine(
        ctx.NapCatConfig.html(`
            <div style="padding: 16px; background: #f5f8ff; border-radius: 8px; margin-bottom: 20px;">
                <h3 style="margin: 0; color: #2d3748;">🧹 自动清理不活跃群成员</h3>
                <p style="margin: 8px 0 0; color: #718096; font-size: 14px;">启用后，插件将定期扫描群成员并移除长期不活跃的账号（清理规则由插件内部策略决定）。</p>
                <p style="margin: 6px 0 0; color: #718096; font-size: 12px;">注：请确保插件有足够权限执行移除操作；使用前建议在测试群验证。</p>
            </div>
        `),
        // 仅保留启用开关，设置为响应式字段以便变更立即生效并持久化
        ctx.NapCatConfig.boolean('enabled', '启用自动清理', DEFAULT_CONFIG.enabled, '开启后插件会按计划扫描并清理长期不活跃的群成员', true)
    );

    return schema;
}

export function getDefaultConfig(): PluginConfig {
    return { ...DEFAULT_CONFIG };
}
