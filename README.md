# napcat-plugin-auto-clear

一个 NapCat 插件示例：自动回复与基础配置管理（演示用）。

## 快速开始（在本地开发）

先确保你已安装 Node.js 与 pnpm。然后在仓库根目录运行：

```powershell
pnpm install
pnpm run build      # 使用 Vite 打包产物到 dist/
npx tsc --noEmit   # 运行类型检查
```

- 构建产物位于 `dist/index.mjs`，这是插件的入口文件（ESM）。

## 在 NapCat 中测试

NapCat 的插件加载方式可能依赖于其运行时/目录结构：

1. 将 `dist/index.mjs` 复制到 NapCat 插件目录（或 NapCat 的插件加载路径下的子目录），并确保插件元数据（如 package.json / manifest）满足 NapCat 要求。
2. 启动 NapCat，或在 NapCat 的管理面板中加载/重载该插件。
3. 在插件初始化后，你可以在 NapCat 的插件配置界面中看到配置项：
   - `enabled`：启用/禁用插件（启用后会按计划扫描并清理长期不活跃的群成员）。

4. 本插件默认以定时任务为主，不再通过消息触发自动回复。如需管理员命令或即时操作，请提出具体需求以便我添加对应的控制接口。

## 本地模拟（可选）

如果你需要在本地做快速模拟：

- 编写一个小脚本模拟 NapCat 提供的 `ctx` 对象（包含 `logger`, `configPath`, `actions.call` 等），然后直接导入 `dist/index.mjs` 并调用 `plugin_init`、`plugin_onmessage` 等生命周期函数。

这比完整运行 NapCat 容器简单，但仅用于功能回归验证。

## 代码/开发指南

- 类型检查：`npx tsc --noEmit`
- 构建：`pnpm run build`

## 后续改进

- 为 UI 字段添加运行时验证（当前仅一个布尔开关，暂无额外验证需求）。
- 增加单元测试与集成测试，模拟 ctx 与 OneBot 行为。

---

如果你需要我为你生成一个本地模拟脚本（自动构造 ctx 并演练几条消息），我可以继续完成。