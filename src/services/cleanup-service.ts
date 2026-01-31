/**
 * 清理服务
 * 负责扫描群成员并踢出不活跃的"鱼干"成员
 */

import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import { pluginState } from '../core/state';
import type { CleanupResult, KickedMember, FailedKick, CleanupStats } from '../types';

/** 存储最近一次清理结果（用于 API 查询） */
const lastCleanupResults: Map<string, CleanupResult> = new Map();

/**
 * 获取群成员列表
 */
async function getGroupMembers(ctx: NapCatPluginContext, groupId: string): Promise<any[]> {
    try {
        const members = await ctx.actions.call('get_group_member_list', {
            group_id: Number(groupId)
        }, ctx.adapterName, ctx.pluginManager.config);
        return Array.isArray(members) ? members : [];
    } catch (error) {
        pluginState.log('error', `获取群 ${groupId} 成员列表失败:`, error);
        return [];
    }
}

/**
 * 获取群信息
 */
async function getGroupInfo(ctx: NapCatPluginContext, groupId: string): Promise<{ group_name: string; member_count: number } | null> {
    try {
        const info = await ctx.actions.call('get_group_info', {
            group_id: Number(groupId)
        }, ctx.adapterName, ctx.pluginManager.config);
        return info || null;
    } catch (error) {
        pluginState.log('error', `获取群 ${groupId} 信息失败:`, error);
        return null;
    }
}

/**
 * 获取机器人自己的QQ号
 */
async function getBotId(ctx: NapCatPluginContext): Promise<string | null> {
    try {
        const login = await ctx.actions.call('get_login_info', {}, ctx.adapterName, ctx.pluginManager.config);
        return login?.user_id ? String(login.user_id) : null;
    } catch (error) {
        pluginState.log('error', '获取机器人 QQ 号失败:', error);
        return null;
    }
}

/**
 * 踢出群成员
 */
async function kickGroupMember(ctx: NapCatPluginContext, groupId: string, userId: string): Promise<boolean> {
    try {
        await ctx.actions.call('set_group_kick', {
            group_id: Number(groupId),
            user_id: Number(userId),
            reject_add_request: false
        }, ctx.adapterName, ctx.pluginManager.config);
        return true;
    } catch (error) {
        pluginState.log('error', `踢出群成员失败 | 群=${groupId}, 用户=${userId}`, error);
        return false;
    }
}

/**
 * 发送群消息
 */
async function sendGroupMessage(ctx: NapCatPluginContext, groupId: string, message: string): Promise<boolean> {
    try {
        await ctx.actions.call('send_group_msg', {
            group_id: Number(groupId),
            message: message
        }, ctx.adapterName, ctx.pluginManager.config);
        return true;
    } catch (error) {
        pluginState.log('error', `发送群消息失败 | 群=${groupId}`, error);
        return false;
    }
}

/**
 * 计算成员不活跃天数
 */
function calculateInactiveDays(lastSpeakTime: number): number {
    if (!lastSpeakTime || lastSpeakTime <= 0) {
        // 如果没有发言记录，视为非常久没发言
        return 9999;
    }
    const now = Date.now();
    const lastSpeak = lastSpeakTime * 1000; // 转换为毫秒
    const diffMs = now - lastSpeak;
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * 格式化时间戳为可读日期
 */
function formatTimestamp(timestamp: number): string {
    if (!timestamp || timestamp <= 0) return '从未发言';
    const date = new Date(timestamp * 1000);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * 执行群清理操作
 * @param ctx 插件上下文
 * @param groupId 群ID
 * @param forceDryRun 强制试运行模式（可选）
 * @returns 清理结果
 */
export async function runCleanupForGroup(
    ctx: NapCatPluginContext,
    groupId: string,
    forceDryRun?: boolean
): Promise<CleanupResult> {
    const groupConfig = pluginState.getGroupConfig(groupId);

    // 确定不活跃天数阈值
    const inactiveDaysThreshold = groupConfig.inactiveDays;

    // 确定是否为试运行模式
    const isDryRun = forceDryRun !== undefined ? forceDryRun : groupConfig.dryRun;

    // 获取受保护的成员列表
    const protectedMembers = new Set(groupConfig.protectedMembers || []);

    // 获取群信息
    const groupInfo = await getGroupInfo(ctx, groupId);
    const groupName = groupInfo?.group_name || `群${groupId}`;

    // 获取机器人QQ号（不踢自己）
    const botId = await getBotId(ctx);

    // 获取群成员列表
    const members = await getGroupMembers(ctx, groupId);

    const result: CleanupResult = {
        groupId,
        groupName,
        totalMembers: members.length,
        inactiveMembers: 0,
        kickedMembers: 0,
        kickedList: [],
        failedList: [],
        dryRun: isDryRun,
        timestamp: Date.now()
    };

    if (members.length === 0) {
        pluginState.log('warn', `群 ${groupId} 成员列表为空，跳过清理`);
        return result;
    }

    pluginState.log('info', `开始扫描群 ${groupId} (${groupName}) | 成员=${members.length}, 阈值=${inactiveDaysThreshold}天, 模式=${isDryRun ? '试运行' : '实际执行'}`);

    const inactiveList: Array<{
        userId: string;
        nickname: string;
        lastSpeakTime: number;
        inactiveDays: number;
        role: string;
    }> = [];

    // 扫描不活跃成员
    for (const member of members) {
        const userId = String(member.user_id || member.userId || '');
        const nickname = member.nickname || member.card || member.nick || `用户${userId}`;
        const role = member.role || 'member';
        const lastSpeakTime = member.last_sent_time || member.lastSentTime || 0;

        // 跳过机器人自己
        if (botId && userId === botId) {
            continue;
        }

        // 跳过管理员和群主
        if (role === 'owner' || role === 'admin') {
            continue;
        }

        // 跳过受保护的成员
        if (protectedMembers.has(userId)) {
            continue;
        }

        const inactiveDays = calculateInactiveDays(lastSpeakTime);

        if (inactiveDays >= inactiveDaysThreshold) {
            inactiveList.push({
                userId,
                nickname,
                lastSpeakTime,
                inactiveDays,
                role
            });
        }
    }

    result.inactiveMembers = inactiveList.length;

    pluginState.log('info', `群 ${groupId} 扫描完成 | 不活跃成员=${inactiveList.length}`);

    // 执行踢人操作
    if (!isDryRun && inactiveList.length > 0) {
        for (const inactive of inactiveList) {
            const success = await kickGroupMember(ctx, groupId, inactive.userId);

            if (success) {
                result.kickedMembers++;
                result.kickedList.push({
                    userId: inactive.userId,
                    nickname: inactive.nickname,
                    lastSpeakTime: inactive.lastSpeakTime,
                    inactiveDays: inactive.inactiveDays
                });
                pluginState.log('info', `已踢出: ${inactive.nickname} (${inactive.userId}) | 不活跃 ${inactive.inactiveDays} 天`);
            } else {
                result.failedList.push({
                    userId: inactive.userId,
                    nickname: inactive.nickname,
                    reason: '踢人失败'
                });
            }

            // 添加小延迟，避免操作过快
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    } else if (isDryRun && inactiveList.length > 0) {
        // 试运行模式，记录但不实际踢人
        for (const inactive of inactiveList) {
            result.kickedList.push({
                userId: inactive.userId,
                nickname: inactive.nickname,
                lastSpeakTime: inactive.lastSpeakTime,
                inactiveDays: inactive.inactiveDays
            });
        }
        result.kickedMembers = 0; // 试运行模式不计入实际踢人数
    }    // 保存结果
    lastCleanupResults.set(groupId, result);

    // 更新配置中的统计数据
    await updateCleanupStats(ctx, groupId, result);

    return result;
}

/**
 * 更新清理统计数据
 */
async function updateCleanupStats(ctx: NapCatPluginContext, groupId: string, result: CleanupResult): Promise<void> {
    try {
        const config = pluginState.config;

        // 初始化统计对象
        if (!config.cleanupStats) {
            config.cleanupStats = {
                totalCleanups: 0,
                totalKicked: 0,
                groupStats: {}
            };
        }

        // 更新全局统计
        config.cleanupStats.totalCleanups++;
        config.cleanupStats.totalKicked += result.kickedMembers;
        config.cleanupStats.lastCleanupTime = result.timestamp;

        // 更新群统计
        if (!config.cleanupStats.groupStats) {
            config.cleanupStats.groupStats = {};
        }

        if (!config.cleanupStats.groupStats[groupId]) {
            config.cleanupStats.groupStats[groupId] = {
                totalCleanups: 0,
                totalKicked: 0
            };
        }

        config.cleanupStats.groupStats[groupId].totalCleanups++;
        config.cleanupStats.groupStats[groupId].totalKicked += result.kickedMembers;
        config.cleanupStats.groupStats[groupId].lastCleanupTime = result.timestamp;
        config.cleanupStats.groupStats[groupId].lastCleanupCount = result.kickedMembers;

        // 更新群配置中的上次清理信息
        if (!config.groupConfigs) {
            config.groupConfigs = {};
        }
        if (!config.groupConfigs[groupId]) {
            config.groupConfigs[groupId] = {};
        }
        config.groupConfigs[groupId].lastCleanup = result.timestamp;
        config.groupConfigs[groupId].lastCleanupCount = result.dryRun ? result.inactiveMembers : result.kickedMembers;

        // 保存配置
        pluginState.saveConfig(ctx, config);
    } catch (error) {
        pluginState.log('error', '更新清理统计数据失败:', error);
    }
}/**
 * 生成清理结果消息
 */
export function generateCleanupMessage(result: CleanupResult): string {
    const lines: string[] = [];

    if (result.dryRun) {
        lines.push(`🔍 【试运行】群成员活跃度扫描完成`);
    } else {
        lines.push(`🧹 群成员清理完成`);
    }

    lines.push(`📊 群名: ${result.groupName}`);
    lines.push(`👥 总成员: ${result.totalMembers} 人`);
    lines.push(`💤 不活跃成员: ${result.inactiveMembers} 人`);

    if (!result.dryRun) {
        lines.push(`✅ 已清理: ${result.kickedMembers} 条鱼干`);
        if (result.failedList.length > 0) {
            lines.push(`❌ 清理失败: ${result.failedList.length} 人`);
        }
    } else {
        lines.push(`⚠️ 试运行模式，未实际踢人`);
        if (result.kickedList.length > 0) {
            lines.push(`📋 如执行将清理 ${result.kickedList.length} 条鱼干`);
        }
    }

    // 如果有踢出的成员，列出前5个
    if (result.kickedList.length > 0) {
        lines.push('');
        lines.push(`📝 ${result.dryRun ? '待清理' : '已清理'}名单（前5）:`);
        const showList = result.kickedList.slice(0, 5);
        for (const member of showList) {
            const lastSpeak = formatTimestamp(member.lastSpeakTime);
            lines.push(`  · ${member.nickname} - ${member.inactiveDays}天未发言`);
        }
        if (result.kickedList.length > 5) {
            lines.push(`  ... 等共 ${result.kickedList.length} 人`);
        }
    }

    return lines.join('\n');
}

/**
 * 执行清理并发送结果消息
 */
export async function runCleanupAndNotify(
    ctx: NapCatPluginContext,
    groupId: string,
    forceDryRun?: boolean
): Promise<CleanupResult> {
    const result = await runCleanupForGroup(ctx, groupId, forceDryRun);

    // 只有当有不活跃成员时才发送消息
    if (result.inactiveMembers > 0 || result.kickedMembers > 0) {
        const message = generateCleanupMessage(result);
        await sendGroupMessage(ctx, groupId, message);
    } else {
        // 没有不活跃成员，发送简短消息
        await sendGroupMessage(ctx, groupId, `✨ 群成员活跃度检查完成，没有发现需要清理的鱼干~`);
    }

    return result;
}

/**
 * 获取最近一次清理结果
 */
export function getLastCleanupResult(groupId: string): CleanupResult | undefined {
    return lastCleanupResults.get(groupId);
}

/**
 * 获取所有清理结果
 */
export function getAllCleanupResults(): Map<string, CleanupResult> {
    return new Map(lastCleanupResults);
}

/**
 * 获取清理统计数据
 */
export function getCleanupStats(): CleanupStats {
    return pluginState.config.cleanupStats || {
        totalCleanups: 0,
        totalKicked: 0,
        groupStats: {}
    };
}
