## 目标

为 AI 编程代理提供立即可用的、与本仓库紧密相关的上下文：架构要点、开发/构建流程、约定与关键集成点，便于自动完成改进、修复与小功能。

## 一句话概览

这是一个面向 NapCat 的插件（TypeScript，ESM），使用 Vite 打包到 `dist/index.mjs` 作为插件入口；主要职责是基于定时任务清理不活跃群成员并提供一个 WebUI（`src/webui/dashboard.html`）。

## 关键文件与边界

- `src/index.ts` — 插件入口，导出生命周期函数：`plugin_init`, `plugin_onmessage`, `plugin_cleanup`, 以及 `plugin_get_config`/`plugin_set_config`/`plugin_on_config_change`。在 `plugin_init` 中会注册 `ctx.router` 的静态资源与 API 路径。
- `src/config.ts` — 负责生成 NapCat WebUI 的配置 schema（`plugin_config_ui`）。
- `src/core/state.ts` — 持久化与读取插件配置（groupConfigs 等）。注意：按群白名单功能已下线，相关路由已移除。
- `src/services/` — 业务服务集合（`cron-service.ts`, `cleanup-service.ts`, `group-service.ts`, `data-service.ts`, `api-service.ts` 等）。注意：扫描/清理的历史实现已下线，`cleanup-service.ts` 当前为安全的空实现；新的定时任务仅发送配置的消息。
- `src/handlers/` — 事件处理逻辑（如 `message-handler.ts`）。
- `src/webui/dashboard.html` — 仪表盘页面，前端通过 `/api/Plugin/ext/{pluginName}/...` 或插件注册的相对路径访问后端 API。页面会尝试读取 `window.__PLUGIN_NAME__`（由 `plugin_init` 中注册的 `plugin-info.js` 提供），并通过 `webui_token` 支持 bearer 授权。

## 运行与构建（开发者流程）

- 安装依赖：`pnpm install`（仓库 README 中建议）。
- 类型检查：`npx tsc --noEmit`。
- 构建产物（供 NapCat 加载）：`pnpm run build`（使用 Vite，输出到 `dist/`，入口为 `dist/index.mjs`）。
- 本地调试提示：NapCat 环境提供 `ctx`（包含 `logger`, `router`, `configPath`, `actions.call` 等）。可编写小脚本模拟 `ctx` 并直接 import `dist/index.mjs` 调用 `plugin_init`/`plugin_onmessage` 做回归验证。

## 项目约定与注意点（对 Agent 的具体提示）

- ESM 模块：`package.json` 中 `type: "module"`，打包和导入请保持 ESM 风格。
- WebUI 与路由：`plugin_init` 会调用 `ctx.router.static('/static', 'webui')` 并注册页面 `dashboard`，因此静态文件应放在 `src/webui`（构建时保持相对目录结构）。
- 导出 `plugin_config_ui`：代码会在运行时更新 `plugin_config_ui`（`src/index.ts`），NapCat WebUI 读取这个变量以展示配置面板。不要删除该导出。
- Cron 表达式规则：项目使用 `node-cron`，校验逻辑在 `src/services/cron-service.ts` / `src/index.ts` 的 `/config` 路由中；表达式必须为 5 或 6 字段，且不能包含 `?`。在修改相关逻辑时请参考现有校验函数 `isValidCronExpression`。
- 配置保存流程：前端将配置 POST 到 `/config`，服务器端在保存前会做字段校验（globalCron、inactiveDays、groupConfigs 等），保存后会调用 `reloadAllCronJobs(ctx)` 以使改动生效。
- 白名单开关：按群白名单功能已下线，相关路由（如 `/groups/whitelist`）已移除；后端配置仍可能保留历史字段，但 UI 不再提供白名单开关。

## 典型任务示例（直接可用）

- 新增一个 API 路由：在 `plugin_init` 内使用 `ctx.router.get/post(...)`；保持返回结构 `{ code: 0, data: ... }` 或在错误时返回 `code: -1` 并合适的 HTTP 状态码，参见已有路由风格（`/status`, `/groups`, `/config`）。
- 手动触发群扫描（dry-run）：已下线，`/groups/:id/scan` 路由已移除，`runScanForGroup` 在 `cleanup-service.ts` 中保留为空实现以保证兼容性。

## 与外部系统的集成要点

- NapCat 平台：插件以 `dist/index.mjs` 被载入，平台会提供 `ctx`。确保不要在静态构建中引用 Node-only 的 CJS-only API。
- WebUI 前端期望的 API base：`/api/Plugin/ext/{pluginName}`，`dashboard.html` 会尝试探测可用的 base 路径并调用 `/status`、`/groups`、`/config` 等端点，且支持通过 URL 参数 `webui_token` 注入 Bearer token。

## 变更/PR 指南（对 Agent 的自动 PR 建议）

- 小改动（修复 bug /增强校验）：修改对应 `src/services/*` 或 `src/core/state.ts`，补充单元测试（若添加测试框架）。保持输出接口不变（HTTP JSON shape）。
- UI 变更：同时修改 `src/webui/dashboard.html` 的前端请求和服务器端 `ctx.router` 的对应路由，确保前端 `authFetch` 使用 `webui_token`。优先保留向后兼容的 API。

## 还需人工确认的点

- 我未在仓库中找到 `.github/copilot-instructions.md` 的历史版本；如果你已在其它渠道维护过代理规则，请把它们贴上来我会合并。
- 是否偏好中文/英文注释或提交消息（当前仓库 README 用中文，默认我使用中文）。

---
如需，我可以把上述要点拆成更详细的“自动修复”/“添加测试”/“添加模拟 ctx 脚本”三项可执行任务并提交 PR。请告诉我你希望先做哪一项。
