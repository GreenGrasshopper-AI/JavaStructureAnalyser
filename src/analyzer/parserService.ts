import * as fs from 'fs';
import * as path from 'path';
import { Language, Parser, Tree } from 'web-tree-sitter';

/**
 * Kapselt web-tree-sitter (WASM). Läuft im Extension-Host (Node),
 * bewusst ohne vscode-Import, damit Node-Smoke-Tests möglich sind.
 */
export class ParserService {
    private parser: Parser | undefined;

    /**
     * @param wasmDir Verzeichnis mit tree-sitter.wasm und tree-sitter-java.wasm
     *                (im Bundle: dist/)
     */
    public async init(wasmDir: string): Promise<void> {
        if (this.parser) {
            return;
        }
        await Parser.init({
            locateFile: (file: string) => path.join(wasmDir, file),
        });
        const grammarBytes = fs.readFileSync(path.join(wasmDir, 'tree-sitter-java.wasm'));
        const language = await Language.load(new Uint8Array(grammarBytes));
        this.parser = new Parser();
        this.parser.setLanguage(language);
    }

    public parse(text: string): Tree {
        if (!this.parser) {
            throw new Error('ParserService not initialized');
        }
        const tree = this.parser.parse(text);
        if (!tree) {
            throw new Error('tree-sitter returned no tree');
        }
        return tree;
    }
}
