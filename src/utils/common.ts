export function ensureString(v: any) {
    if (v === undefined || v === null) return undefined;
    return String(v);
}
