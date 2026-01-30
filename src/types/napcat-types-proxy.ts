// Lightweight runtime shim for the parts of `napcat-types` our plugin imports.
// Exports are typed as `any` to avoid depending on the upstream package's .ts
// sources during local type-checking. This is a pragmatic, temporary measure.

export type PluginModule = any;
export type NapCatPluginContext = any;
export type PluginConfigSchema = any;
export type PluginConfigUIController = any;
export type OB11Message = any;
export type OB11EmitEventContent = any;

// EventType is used at runtime checks like `event.post_type !== EventType.MESSAGE`.
// Provide a minimal shape so code can reference `EventType.MESSAGE`.
export const EventType: { MESSAGE: string } = { MESSAGE: 'message' } as any;

// Re-export a catch-all to make additional imports succeed.
export const __napcat_types_any: any = {};

export default __napcat_types_any;
