# napcat-plugin-auto-clear

🧹 NapCat 自动清理不活跃群成员插件 - 定时扫描并清理长期不发言的"鱼干"成员。

## 功能特性

- **定时清理**：支持 cron 表达式配置，自动按计划清理不活跃成员
- **按群配置**：每个群可单独设置清理规则、不活跃天数阈值
- **试运行模式**：先预览将要清理的成员，确认无误后再实际执行
- **白名单保护**：支持设置受保护成员，避免误踢
- **WebUI 仪表盘**：可视化管理界面，查看状态和配置
- **清理统计**：记录历史清理数据，便于追踪

## 快速开始

### 安装

1. 下载 Release 中的 `napcat-plugin-auto-clear.zip`
2. 解压到 NapCat 的 `plugins` 目录
3. 重启 NapCat 或在 WebUI 中启用插件

为什么不直接从 WebUi 中安装呢?

### 从源码构建

```bash
# 安装依赖
pnpm install

# 构建
pnpm run build

# 类型检查（可选）
npx tsc --noEmit
```

构建产物位于 `dist/index.mjs`。

## 配置说明

| 配置项 | 类型 | 默认值 | 说明 |
|-------|------|-------|------|
| `enabled` | boolean | `true` | 全局开关 |
| `globalCron` | string | `0 8 * * *` | 全局 cron 表达式（每天早上8点） |
| `inactiveDays` | number | `30` | 不活跃天数阈值 |
| `dryRun` | boolean | `true` | 试运行模式（只统计不踢人） |

### 群单独配置

每个群可覆盖全局配置：
- `enabled` - 是否启用该群的定时清理
- `cron` - 该群的 cron 表达式
- `inactiveDays` - 该群的不活跃天数阈值
- `protectedMembers` - 受保护成员 QQ 号列表
- `dryRun` - 该群的试运行模式

## API 路由

所有路由带有 `/clear` 前缀，完整路径为 `/api/Plugin/ext/{pluginName}/clear/...`

| 方法 | 路径 | 说明 |
|-----|------|------|
| GET | `/clear/status` | 获取插件状态 |
| GET | `/clear/config` | 获取配置 |
| POST | `/clear/config` | 保存配置 |
| GET | `/clear/groups` | 获取群列表及权限 |
| GET | `/clear/cron/status` | 获取定时任务状态 |
| GET | `/clear/groups/:id/cron` | 获取群定时任务配置 |
| POST | `/clear/groups/:id/cron` | 更新群定时任务配置 |
| POST | `/clear/groups/:id/cleanup` | 手动触发群清理 |
| GET | `/clear/groups/:id/cleanup/result` | 获取上次清理结果 |
| GET | `/clear/cleanup/stats` | 获取清理统计 |

## WebUI 仪表盘

访问路径：`/clear-dashboard`

功能：
- 查看插件运行状态
- 管理群清理配置
- 手动触发清理
- 查看清理历史和统计

## 注意事项

1. **权限要求**：机器人需要有群管理员权限才能踢人
2. **建议先试运行**：首次使用建议开启试运行模式，确认清理名单无误后再关闭
3. **Cron 表达式**：使用 node-cron 格式，5 或 6 字段，不支持 `?` 字符

## 开发

```bash
# 安装依赖
pnpm install

# 开发模式（监听文件变化）
pnpm run watch

# 构建
pnpm run build
```

## 许可证

MIT License
