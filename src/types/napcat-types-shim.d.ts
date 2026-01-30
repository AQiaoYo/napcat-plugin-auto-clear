/**
 * Local shim to avoid TypeScript compiling the upstream `napcat-types` TS sources.
 *
 * The published `napcat-types` package contains .ts sources which the project's
 * TypeScript build currently tries to type-check and fails on. This file tells
 * the compiler to treat imports from `napcat-types` and any subpath as `any`.
 *
 * This is a stopgap to unblock local development. A better long-term fix is to
 * publish proper .d.ts for the dependency or use a release that ships only
 * declaration files.
 */

declare module "napcat-types" {
    const value: any;
    export = value;
}

// Support imports like 'napcat-types/napcat-onebot/...' etc.
declare module "napcat-types/*" {
    const value: any;
    export = value;
}
