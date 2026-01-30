import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';

/**
 * 发送回复消息封装
 */
export async function sendReply(
    ctx: NapCatPluginContext,
    messageType: 'private' | 'group',
    content: string,
    groupId?: number,
    userId?: number
) {
    try {
        await ctx.actions.call(
            messageType === 'group' ? 'send_group_msg' : 'send_private_msg',
            {
                ...(messageType === 'group' ? { group_id: String(groupId) } : { user_id: String(userId) }),
                message: content
            },
            ctx.adapterName,
            ctx.pluginManager.config
        );
    } catch (error) {
        ctx.logger.error('❌ 发送消息失败:', error);
    }
}
