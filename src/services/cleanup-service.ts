// NOTE: cleanup-service 功能已下线。保留空实现以避免直接删除导致运行时错误。
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';

export async function runScanForGroup(_ctx: NapCatPluginContext, _groupId: string) {
    // 已移除扫描逻辑，返回空候选
    return [] as Array<Record<string, any>>;
}

export function getLastScanResults(_groupId: string) {
    return [] as Array<Record<string, any>>;
}

export function startScheduler(_ctx: NapCatPluginContext, _intervalMs = 24 * 60 * 60 * 1000) {
    // no-op
}

export function stopScheduler() {
    // no-op
}
