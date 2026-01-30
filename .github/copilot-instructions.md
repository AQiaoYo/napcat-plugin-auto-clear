# NapCat Auto-Clear Plugin - AI Coding Guidelines

## Architecture Overview
This is a **NapCat OneBot plugin** for automatically cleaning inactive QQ group members. Built as an ESM TypeScript module with a service-oriented architecture.

**Key Components:**
- `src/index.ts` - Plugin lifecycle hooks (init/message/cleanup) + WebUI API routes
- `src/core/state.ts` - JSON-based configuration persistence
- `src/services/cleanup-service.ts` - Core business logic (dry-run scanning)
- `src/services/cron-service.ts` - Cron job scheduling and execution
- `src/services/group-service.ts` - Group permission management
- `src/webui/dashboard.html` - Management dashboard UI

## Essential Patterns

### Plugin Lifecycle
```typescript
// Always export these exact function names - NapCat calls them directly
export const plugin_init = async (ctx: NapCatPluginContext) => { /* setup */ };
export const plugin_onmessage = async (ctx, event: OB11Message) => { /* handle messages */ };
export const plugin_cleanup = async (ctx) => { /* cleanup */ };
```

### OneBot API Calls
```typescript
// Use ctx.actions.call() for all OneBot interactions
const members = await ctx.actions.call('get_group_member_list', { group_id: groupId }, ctx.adapterName, ctx.pluginManager.config);
```

### Configuration Management
```typescript
// Always use the state module for config - never access currentConfig directly
import { getConfig, saveConfig } from './core/state';
const config = getConfig(); // Returns current config
saveConfig(ctx, newConfig); // Persists to JSON file
```

### Cron Job Scheduling
```typescript
// Use cron-service for all scheduled tasks
import { startGlobalCronJob, startGroupCronJob, reloadAllCronJobs } from './services/cron-service';

// Start global cron job
startGlobalCronJob(ctx);

// Start group-specific cron job
startGroupCronJob(ctx, groupId);

// Reload all cron jobs after config changes
reloadAllCronJobs(ctx);
```

### Dry-Run Design
- Plugin **never actually removes members** - only identifies candidates
- All cleanup logic returns candidate arrays for manual review
- Scheduled scans run daily but only log results

## Development Workflow

### Build & Test
```bash
pnpm install
pnpm run build        # Vite build to dist/index.mjs (ESM)
npx tsc --noEmit     # Type checking only
pnpm run watch       # Development with file watching
```

### Plugin Testing
1. Copy `dist/index.mjs` and `dist/package.json` to NapCat plugins directory
2. Access WebUI at `/dashboard` for configuration
3. Use REST endpoints: `/groups`, `/groups/:id/scan`, `/config`, `/cron/status`

### Key Files to Reference
- `src/config.ts` - Configuration schema generation
- `vite.config.ts` - Build configuration (ES module compatible with __dirname fix)
- `src/webui/dashboard.html` - UI implementation example

## Code Style Conventions

### Error Handling
```typescript
try {
    // OneBot calls can fail - always wrap in try/catch
    const result = await ctx.actions.call('some_action', params, ctx.adapterName, ctx.pluginManager.config);
} catch (error) {
    ctx.logger.error('Operation failed:', error);
}
```

### Service Organization
- Business logic goes in `services/` directory
- Each service exports async functions
- Services receive `ctx` parameter for API access
- Use `getConfig()` for configuration access

### WebUI Integration
- Routes registered in `plugin_init` via `ctx.router`
- Static assets served from `src/webui/` (copied to `dist/webui/` by Vite)
- API endpoints return `{ code: 0, data: ... }` format
- HTML uses CSS custom properties for theming

## Common Pitfalls

- **Don't modify `currentConfig` directly** - use state module functions
- **Always check `ctx.actions` exists** before API calls
- **Handle OneBot API failures gracefully** - network/bot permission issues are common
- **Use absolute paths** in Vite config for reliable builds
- **Test in actual NapCat environment** - local simulation is limited
- **Cron expressions must be validated** - invalid cron will throw errors
- **Group configs fallback to global** - empty group config uses global settings
- **ES module __dirname issue** - vite config includes rollup plugin to replace __dirname with process.cwd() for node-cron compatibility

## Extension Points

### Adding New Features
1. Add configuration fields in `src/config.ts` and `src/types.ts`
2. Implement business logic in appropriate `services/` file
3. Add WebUI routes in `src/index.ts` plugin_init
4. Update dashboard HTML if needed

### Adding Commands
- Extend `src/handlers/message-handler.ts` for message-based features
- Use `event.raw_message` for command parsing
- Check `getConfig().enabled` before processing

### Adding Scheduled Tasks
- Use `setInterval` in `cleanup-service.ts` for recurring tasks
- Store timer references for cleanup in `plugin_cleanup`
- Respect global `enabled` config flag

### Cron Job Management
- Add cron job types in `src/types.ts`
- Implement job logic in `cron-service.ts`
- Register jobs in `plugin_init`
- Clean up jobs in `plugin_cleanup`
- **Validate cron expressions** - use `isValidCronExpression()` and `getValidCronExpression()` functions
- **Handle undefined config values** - always provide fallback empty strings for optional config fields</content>
<parameter name="filePath">d:\napcat-plugin-auto-clear\.github\copilot-instructions.md