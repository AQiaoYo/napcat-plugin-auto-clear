/**
 * 消息处理器
 * 保留消息处理入口，用于未来扩展（如管理员命令或状态查询）
 */

import { EventType } from 'napcat-types/napcat-onebot/event/index';
import type { OB11Message } from 'napcat-types/napcat-onebot';
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import { pluginState } from '../core/state';

/** 处理收到的消息 */
export async function handleMessage(ctx: NapCatPluginContext, event: OB11Message) {
    try {
        if (!pluginState.config.enabled) return;

        // 当前仅记录调试日志，未来可扩展命令处理
        if (event && event.post_type === EventType.MESSAGE) {
            pluginState.logDebug(`收到消息（已忽略）| id=${event.message_id}`);
        }
    } catch (err) {
        pluginState.log('error', '消息处理异常:', err);
    }
}
