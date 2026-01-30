import { EventType } from 'napcat-types/napcat-onebot/event/index';
import type { OB11Message } from 'napcat-types/napcat-onebot';
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import { getConfig } from '../core/state';

// 目前插件主要负责定时清理不活跃群成员，消息处理不承担清理逻辑。
// 此处保留一个简洁的消息处理入口，用于未来扩展（如管理员命令或状态查询）。
export async function handleMessage(ctx: NapCatPluginContext, event: OB11Message) {
    try {
        const cfg = getConfig();
        if (!cfg.enabled) return; // 未启用则不处理

        // 当前不实现自动回复逻辑；保留最小日志以便调试
        if (event && event.post_type === EventType.MESSAGE) {
            ctx.logger.debug?.('收到消息（已忽略，因为插件以定时任务为主）', { id: event.message_id });
        }
    } catch (err) {
        ctx.logger.error('handleMessage 处理异常:', err);
    }
}
