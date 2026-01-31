/**
 * 消息处理器
 * 保留消息处理入口，用于未来扩展（如管理员命令或状态查询）
 */

import { EventType } from 'napcat-types/napcat-onebot/event/index';
import type { OB11Message } from 'napcat-types/napcat-onebot';
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import { getConfig } from '../core/state';

/** 日志前缀 */
const LOG_TAG = '[AutoClear]';

/** 处理收到的消息 */
export async function handleMessage(ctx: NapCatPluginContext, event: OB11Message) {
    try {
        const cfg = getConfig();
        if (!cfg.enabled) return;

        // 当前仅记录调试日志，未来可扩展命令处理
        if (event && event.post_type === EventType.MESSAGE) {
            ctx.logger.debug?.(`${LOG_TAG} 收到消息（已忽略）| id=${event.message_id}`);
        }
    } catch (err) {
        ctx.logger.error(`${LOG_TAG} 消息处理异常:`, err);
    }
}
