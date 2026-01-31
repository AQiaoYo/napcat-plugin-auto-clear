# NapCat 插件开发通用架构模板指南

> 基于 `napcat-plugin-auto-clear` 的最佳实践架构，融合了单例状态管理、服务分层、WebUI 前后端分离等高级特性。

---

## 1. 为什么选择此架构？

本模板采用**分层架构**与**单例状态管理**，解决了传统插件开发中常见的痛点：
- ❌ `ctx` 上下文到处传递，代码混乱
- ❌ 配置管理分散，类型不安全
- ❌ 路由冲突，WebUI 接口难维护
- ❌ 业务逻辑与框架代码耦合

本架构优势：
- ✅ **全类型安全**：从配置到接口的完整 TypeScript 支持
- ✅ **状态单例**：任意文件通过 `pluginState` 即可获取 logger、config 和 actions
- ✅ **路由隔离**：自动处理 URL 前缀，避免插件间冲突
- ✅ **逻辑分层**：Handler -> Service -> Core 清晰的职责划分

---

## 2. 项目结构详解

```text
src/
├── core/
│   └── state.ts          # 核心状态机 (单例模式)
│                         # 负责：Config 加载/保存、Logger 封装、Context 持有
├── handlers/
│   └── message-handler.ts # 消息入口 (主要逻辑不要写在这里，调用 Service)
├── services/
│   ├── xxx-service.ts    # 业务逻辑层 (纯粹的业务代码)
│   └── cron-service.ts   # 定时任务管理
├── webui/
│   └── dashboard.html    # 前端页面 (Vue/React/原生HTML均可)
├── config.ts             # 配置 Schema 定义 (WebUI 界面描述)
├── index.ts              # 插件入口 (生命周期 + 路由注册)
└── types.ts              # 所有类型定义 (Config, API Response 等)
```

---

## 3. 快速开始：如何基于本模板开发

### 第一步：克隆与重命名
1. 复制整个项目目录。
2. 修改 `package.json` 中的 `name`, `description`, `author`。
3. 全局搜索替换（Ctrl+Shift+H）：
   - 将 `AutoClear` 替换为你的插件类名（如 `MyPlugin`）。
   - 将 `napcat-plugin-auto-clear` 替换为你的插件ID。
4. 修改 `src/index.ts` 中的 `ROUTE_PREFIX` 为你的插件路由前缀（如 `/my-plugin`）。

### 第二步：定义配置 (Configuration)
1. **定义类型**：在 `src/types.ts` 的 `PluginConfig` 接口中添加你的配置项。
2. **设置默认值**：在 `src/config.ts` 的 `DEFAULT_CONFIG` 中添加默认值。
3. **编写 UI Schema**：在 `src/config.ts` 的 `initConfigUI` 函数中，使用 `ctx.NapCatConfig` 添加对应的 UI 控件。
   > **技巧**：可以使用 `plugin_config_controller` (如果已实现) 来控制配置项的动态显示/隐藏。

### 第三步：编写业务 (Services)
在 `src/services/` 下创建新的服务文件，例如 `ai-service.ts`：

```typescript
import { pluginState } from '../core/state';

export async function chatWithAI(userId: string, text: string) {
    // 1. 获取配置
    const apiKey = pluginState.config.apiKey;
    
    // 2. 打印日志
    pluginState.log('info', `正在回复用户 ${userId}`);
    
    // 3. 调用 API
    // return ...
}
```

### 第三步：注册接口 (WebUI Router)
在 `src/index.ts` 的 `plugin_init` 中添加 Express 路由：

```typescript
// GET /your-prefix/api/hello
prefixedRouter.get('/api/hello', (req, res) => {
    try {
        const data = MyService.getData();
        res.json({ code: 0, data });
    } catch (e) {
        pluginState.log('error', 'API Error', e);
        res.status(500).json({ code: -1, message: String(e) });
    }
});
```

### 第四步：前端开发 (WebUI 拓展接口 - 可选)
1. 修改 `src/webui/dashboard.html`。
2. 页面加载时会自动注入 `window.__PLUGIN_NAME__`。
3. 请求后端 API 时，请务必使用 **相对路径** 或 **拼接 Base URL**：
   ```javascript
   // 前端代码示例
   const baseUrl = `/api/Plugin/ext/${window.__PLUGIN_NAME__}${ROUTE_PREFIX}`;
   fetch(`${baseUrl}/api/hello?webui_token=${token}`);
   ```

### 第五步：处理消息
在 `src/handlers/message-handler.ts` 中调用你的 Service：

```typescript
export async function handleMessage(ctx: NapCatPluginContext, event: OB11Message) {
    if (!pluginState.config.enabled) return;
    
    // 简单的指令解析示例
    if (event.raw_message === '#功能') {
        await MyService.doSomething(ctx, event.group_id);
    }
}
```

---

## 4. 核心模式参考

### 4.1 全局状态访问 (`pluginState`)
无需传递 `ctx`，在任何地方均可使用：

```typescript
import { pluginState } from '../core/state';

// 获取配置
const isDryRun = pluginState.config.dryRun;

// 记录日志 (自动带上前缀)
pluginState.log('warn', '这是一条警告');

// 调用 OneBot API
await pluginState.actions.call('send_group_msg', { ... }, pluginState.adapterName, ...);

// 获取运行时长
const uptime = pluginState.getUptime();
```

### 4.2 配置热重载
架构已内置配置监听逻辑：
1. 用户在 WebUI 修改配置。
2. 触发 `plugin_on_config_change`。
3. 自动调用 `pluginState.setConfig` 更新内存和文件。
4. 如果你有定时任务，可在 `src/index.ts` 的回调中添加 `reloadAllCronJobs(ctx)`。

### 4.3 健壮的类型断言
在读取未知数据（如 JSON文件或 API请求体）时，请模仿 `src/core/state.ts` 中的 `sanitizeConfig` 模式：

```typescript
// 不要直接使用 (raw as Any).key
// 推荐做法：
const r = raw as Record<string, unknown>;
if (typeof r.enabled === 'boolean') {
    config.enabled = r.enabled;
}
```

---

## 5. 常用 OneBot API 速查

- **发送群消息**: `send_group_msg` ({ group_id, message })
- **发送私聊**: `send_private_msg` ({ user_id, message })
- **撤回消息**: `delete_msg` ({ message_id })
- **获取群成员**: `get_group_member_info` ({ group_id, user_id })
- **踢人**: `set_group_kick` ({ group_id, user_id, reject_add_request })

---

## 6. 发布检查清单

- [ ] `package.json` 版本号已更新
- [ ] `src/index.ts` 中的路由前缀已修改
- [ ] 所有无用的示例代码已清理
- [ ] 运行 `pnpm run build` 成功
- [ ] 检查 `dist/index.mjs` 是否生成
