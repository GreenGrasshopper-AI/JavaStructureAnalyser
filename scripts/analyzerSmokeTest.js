// Bündelt den TS-Smoke-Test nach dist/ und führt ihn aus (Node, ohne VSCode).
const esbuild = require('esbuild');
const path = require('path');

esbuild.buildSync({
    entryPoints: [path.join(__dirname, 'smokeEntry.ts')],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outfile: path.join(__dirname, '..', 'dist', 'smokeTest.js'),
    sourcemap: 'inline',
    // CJS-Build von web-tree-sitter erzwingen (wie in esbuild.js)
    alias: {
        'web-tree-sitter': path.join(__dirname, '..', 'node_modules', 'web-tree-sitter', 'tree-sitter.cjs'),
    },
});

require('../dist/smokeTest.js');
