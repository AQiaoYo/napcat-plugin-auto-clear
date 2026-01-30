import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import type { PluginConfig } from './types';

// 默认配置
export const DEFAULT_CONFIG: PluginConfig = {
    // 仅保留一个全局开关与按群白名单
    enabled: true,
    // whiteList 已下线，保留空结构以向后兼容
    whitelist: {},

    // 新增：定时任务默认配置
    globalCron: '*/30 * * * * *', // 每30秒一次（测试用）
    groupConfigs: {}
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
        // 全局开关
        ctx.NapCatConfig.boolean('enabled', '启用自动清理', DEFAULT_CONFIG.enabled, '开启后插件会按计划扫描并清理长期不活跃的群成员', true),

        // 全局定时任务配置
        ctx.NapCatConfig.html(`
            <div style="padding: 12px; background: #fff3cd; border-radius: 6px; margin: 16px 0; border-left: 4px solid #ffc107;">
                <h4 style="margin: 0 0 8px; color: #856404;">⏰ 定时任务配置</h4>
                <p style="margin: 0; color: #856404; font-size: 13px;">配置定时发送测试消息的计划任务</p>
            </div>
        `),
        ctx.NapCatConfig.text('globalCron', '全局Cron表达式', DEFAULT_CONFIG.globalCron, 'cron表达式，格式：分 时 日 月 周（例如：0 8 * * * 表示每天早上8点）', true),
        ctx.NapCatConfig.number('inactiveDays', '默认不活跃天数', 30, '成员多少天未发言视为不活跃（可被群单独配置覆盖）', true)
    );

    return schema;
}

export function getDefaultConfig(): PluginConfig {
    return { ...DEFAULT_CONFIG };
}
