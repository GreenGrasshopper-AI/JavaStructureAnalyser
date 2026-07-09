const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** Kopiert die tree-sitter-Laufzeit und die Java-Grammatik nach dist/. */
function copyWasmFiles() {
    fs.mkdirSync('dist', { recursive: true });
    const wasmSources = [
        path.join('node_modules', 'web-tree-sitter', 'tree-sitter.wasm'),
        path.join('node_modules', 'tree-sitter-wasms', 'out', 'tree-sitter-java.wasm'),
    ];
    for (const source of wasmSources) {
        const target = path.join('dist', path.basename(source));
        fs.copyFileSync(source, target);
    }
}

const extensionConfig = {
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'dist/extension.js',
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    sourcemap: !production,
    minify: production,
    // CJS-Build von web-tree-sitter erzwingen (ESM-Build bricht gebündelt an import.meta.url)
    alias: {
        'web-tree-sitter': path.resolve(__dirname, 'node_modules', 'web-tree-sitter', 'tree-sitter.cjs'),
    },
};

const webviewConfig = {
    entryPoints: ['webview/main.ts'],
    bundle: true,
    outfile: 'dist/webview.js',
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    sourcemap: !production,
    minify: production,
};

async function main() {
    copyWasmFiles();
    if (watch) {
        const extensionContext = await esbuild.context(extensionConfig);
        const webviewContext = await esbuild.context(webviewConfig);
        await Promise.all([extensionContext.watch(), webviewContext.watch()]);
        console.log('[esbuild] watching…');
    } else {
        await Promise.all([esbuild.build(extensionConfig), esbuild.build(webviewConfig)]);
        console.log('[esbuild] build done');
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
