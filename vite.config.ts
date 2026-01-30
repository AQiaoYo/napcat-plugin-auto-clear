import { resolve } from 'path';
import { defineConfig } from 'vite';
import nodeResolve from '@rollup/plugin-node-resolve';
import { builtinModules } from 'module';
import fs from 'fs';

const nodeModules = [
    ...builtinModules,
    ...builtinModules.map((m) => `node:${m}`),
].flat();

export default defineConfig({
    resolve: {
        conditions: ['node', 'default'],
    },
    build: {
        sourcemap: false,
        target: 'esnext',
        minify: false,
        lib: {
            entry: resolve(__dirname, 'src/index.ts'),
            formats: ['es'],
            fileName: () => 'index.mjs',
        },
        rollupOptions: {
            external: [...nodeModules],
            output: {
                inlineDynamicImports: true,
            },
        },
        outDir: 'dist',
        emptyDirBeforeWrite: true,
    },
    plugins: [nodeResolve(), copyAssetsPlugin()],
});

function copyAssetsPlugin() {
    return {
        name: 'copy-assets-to-dist',
        writeBundle() {
            try {
                const distDir = resolve(__dirname, 'dist');
                const packageJsonSrc = resolve(__dirname, 'package.json');
                const webuiSrc = resolve(__dirname, 'src', 'webui');

                // ensure dist exists
                if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });

                // copy package.json into dist
                try {
                    if (fs.existsSync(packageJsonSrc)) {
                        const packageJsonDest = resolve(distDir, 'package.json');
                        fs.copyFileSync(packageJsonSrc, packageJsonDest);
                        console.log(`[copy-assets-to-dist] copied package.json to ${packageJsonDest}`);
                    }
                } catch (err) {
                    console.warn('[copy-assets-to-dist] failed to copy package.json:', err);
                }

                // copy webui directory into dist/webui
                try {
                    if (fs.existsSync(webuiSrc)) {
                        const destWebui = resolve(distDir, 'webui');
                        copyDirRecursive(webuiSrc, destWebui);
                        console.log(`[copy-assets-to-dist] copied webui to ${destWebui}`);
                    }
                } catch (err) {
                    console.warn('[copy-assets-to-dist] failed to copy webui:', err);
                }
            } catch (e) {
                console.error('[copy-assets-to-dist] error:', e);
            }
        }
    };
}

function copyDirRecursive(src: string, dest: string): void {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = resolve(src, entry.name);
        const destPath = resolve(dest, entry.name);
        if (entry.isDirectory()) {
            copyDirRecursive(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}
