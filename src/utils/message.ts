// 已移除旧配置字段（prefix/autoReply）。保留工具文件以便将来扩展。
export function trimCommandPrefix(_raw: string, _prefix: string, _cmd: string) {
    // 不再基于插件配置处理命令前缀，返回空字符串表示无匹配。
    return '';
}
