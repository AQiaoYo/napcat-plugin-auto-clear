import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';

// 简单的 API 封装（方便后续扩展）
export async function callAction(
    ctx: NapCatPluginContext,
    action: Parameters<NapCatPluginContext['actions']['call']>[0],
    payload: Parameters<NapCatPluginContext['actions']['call']>[1]
) {
    return ctx.actions.call(action, payload, ctx.adapterName, ctx.pluginManager.config);
}
