import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import { getConfig } from '../core/state';

// 返回群列表及机器人在每个群的权限信息
export async function getGroupsWithPermissions(ctx: NapCatPluginContext) {
    try {
        if (!ctx.actions) return [];

        // 获取群列表
        const groups: any[] = await ctx.actions.call('get_group_list', {}, ctx.adapterName, ctx.pluginManager.config);

        // 获取当前登录号（机器人）
        const login: any = await ctx.actions.call('get_login_info', {}, ctx.adapterName, ctx.pluginManager.config);
        const botId = login && login.user_id ? String(login.user_id) : undefined;

        const out: any[] = [];

        for (const g of groups || []) {
            const groupId = g.group_id || g.groupId || String(g.id || g.group_id);
            let role = 'unknown';
            try {
                if (botId) {
                    const member = await ctx.actions.call('get_group_member_info', { group_id: String(groupId), user_id: String(botId) }, ctx.adapterName, ctx.pluginManager.config);
                    if (member && member.role) role = member.role;
                }
            } catch (e) {
                // 忽略单群查询错误
            }

            const canKick = role === 'owner' || role === 'admin';
            const canBan = role === 'owner' || role === 'admin';
            const cfg = getConfig();
            const whitelist = cfg.whitelist || {};
            const whitelisted = Boolean(whitelist[String(groupId)] === true);

            out.push({
                group_id: String(groupId),
                group_name: g.group_name || g.name || g.title || '',
                member_count: g.member_count || g.count || 0,
                role,
                canKick,
                canBan,
                whitelisted
            });
        }

        return out;
    } catch (error) {
        ctx.logger?.error('getGroupsWithPermissions error:', error);
        return [];
    }
}
