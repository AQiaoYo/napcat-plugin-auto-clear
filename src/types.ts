import type { PluginConfigSchema, PluginConfigUIController } from 'napcat-types/napcat-onebot/network/plugin-manger';

// 插件配置类型
export interface PluginConfig {
    // 当前配置：
    // enabled - 全局开关：是否启用自动清理功能
    // whitelist - 按群的开关，只有当某个群被设置为 true 时，才会在该群执行清理操作
    enabled: boolean;
    whitelist?: Record<string, boolean>;
}

// 导出配置 UI 容器（导出对象的属性可被各模块修改，避免对 import 绑定重新赋值）
// 导出一个空的 plugin_config_ui 变量，框架会读取它作为插件的配置 schema（可被运行时替换）
export let plugin_config_ui: PluginConfigSchema = [];

export type { PluginConfigSchema, PluginConfigUIController };
