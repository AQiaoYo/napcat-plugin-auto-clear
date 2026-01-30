import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import { getConfig } from '../core/state';

// 简单内存存储：最近一次扫描结果，key = groupId
const lastScanResults: Record<string, Array<Record<string, any>>> = {};
let scheduler: NodeJS.Timeout | null = null;

/**
 * 扫描单个群并返回候选清理成员（dry-run）
 * 策略：使用 get_group_member_list 或 get_group_member_info 中的 last_sent_time 字段。
 */
export async function runScanForGroup(ctx: NapCatPluginContext, groupId: string) {
    try {
        if (!ctx.actions) return [];

        // 获取成员列表
        const members: any[] = await ctx.actions.call('get_group_member_list', { group_id: String(groupId), no_cache: false }, ctx.adapterName, ctx.pluginManager.config);

        // currentConfig 与白名单判断
        const cfg = getConfig();
        if (!cfg.enabled) return [];
        const whitelist = cfg.whitelist || {};
        if (!whitelist[String(groupId)]) {
            // 此群未加入白名单，按用户要求不会执行清理。返回空候选
            lastScanResults[String(groupId)] = [];
            return [];
        }

        // 读取群配置的inactiveDays，没有则用全局默认
        const groupConfig = cfg.groupConfigs?.[groupId] || {};
        const inactiveDays = groupConfig.inactiveDays || cfg.inactiveDays || 30;
        const INACTIVITY_MS = inactiveDays * 24 * 60 * 60 * 1000;

        // 找到机器人自身 id 以排除
        let botId: string | undefined;
        try {
            const login = await ctx.actions.call('get_login_info', {}, ctx.adapterName, ctx.pluginManager.config);
            botId = login && login.user_id ? String(login.user_id) : undefined;
        } catch (e) {
            // ignore
        }

        const now = Date.now();

        const candidates: Array<Record<string, any>> = [];

        for (const m of members || []) {
            const userId = String(m.user_id || m.userId || m.uid || '');
            if (userId === botId) continue; // 忽略机器人自身

            // 跳过 owner/admin
            const role = m.role || m.user_role || m.role_name || '';
            if (role === 'owner' || role === 'admin') continue;

            // 若无法获得 lastActive，则使用 join_time 作为保守估计（不作为清理理由）
            const joinTime = m.join_time ? Number(m.join_time) * 1000 : (m.join_time_ms ? Number(m.join_time_ms) : 0);

            // last_sent_time 字段常见于 OneBot 实现
            let lastSent = m.last_sent_time || m.last_sent || m.last_sent_at || 0;
            // 如果 last_sent_time 为 0，按 API 约定用 join_time（joinTime 已是 ms）
            if ((!lastSent || lastSent === 0) && joinTime) lastSent = Math.floor(joinTime / 1000);

            let lastActive = 0;
            if (typeof lastSent === 'number' && lastSent > 0) lastActive = lastSent * 1000; // assume seconds -> ms
            // 某些实现可能直接返回 ms
            if (lastActive === 0 && typeof m.last_active === 'number') lastActive = m.last_active;

            const inactiveMs = lastActive ? (now - lastActive) : (joinTime ? (now - joinTime) : Infinity);

            if (inactiveMs >= INACTIVITY_MS) {
                candidates.push({
                    user_id: userId,
                    nickname: m.nickname || m.card || m.name || m.remark || '',
                    last_active_ts: lastActive || null,
                    join_time_ts: joinTime || null,
                    inactive_days: Math.floor(inactiveMs / (24 * 60 * 60 * 1000)),
                    reason: lastActive ? `最后发言 ${Math.floor(inactiveMs / (24 * 60 * 60 * 1000))} 天前` : '无发言记录'
                });
            }
        }

        // 保存最后扫描结果
        lastScanResults[String(groupId)] = candidates;
        return candidates;
    } catch (error) {
        ctx.logger?.error('runScanForGroup error:', error);
        lastScanResults[String(groupId)] = [];
        return [];
    }
}

export function getLastScanResults(groupId: string) {
    return lastScanResults[String(groupId)] || [];
}

export function startScheduler(ctx: NapCatPluginContext, intervalMs = 24 * 60 * 60 * 1000) {
    // 先停止已有
    stopScheduler();
    // 每次 interval 触发一次全局扫描（只对 whitelist 中的群做 dry-run）
    scheduler = setInterval(async () => {
        try {
            const cfg = getConfig();
            if (!cfg.enabled) return;
            const wl = cfg.whitelist || {};
            for (const groupId of Object.keys(wl)) {
                if (!wl[groupId]) continue;
                // eslint-disable-next-line no-await-in-loop
                await runScanForGroup(ctx, groupId);
                ctx.logger?.info(`自动扫描完成（dry-run）: group=${groupId}`);
            }
        } catch (e) {
            ctx.logger?.error('自动扫描任务出错:', e);
        }
    }, intervalMs);
}

export function stopScheduler() {
    if (scheduler) {
        clearInterval(scheduler);
        scheduler = null;
    }
}
