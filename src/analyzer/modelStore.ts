import * as fs from 'fs';
import { JavaType, TypeHolder, TypeSubtype } from '../shared/javaModel';
import { computeHolders } from './holders';
import { ModelBuilder, resolveParsedFile } from './modelBuilder';
import { ParserService } from './parserService';
import { computeSubtypes } from './subtypes';
import { ResolveContext, resolveTypeName, TypeIndex } from './typeResolver';

export interface FileParseResult {
    upserted: JavaType[];
    removedTypeIds: string[];
}

/**
 * Hält das geparste Modell aller bekannten Dateien und koordiniert
 * Parser, ModelBuilder und Typauflösung. vscode-frei (Node-testbar).
 */
export class ModelStore {
    private readonly builder = new ModelBuilder();
    private readonly typesById = new Map<string, JavaType>();
    private readonly typeIdsByFile = new Map<string, string[]>();

    public constructor(
        private readonly parser: ParserService,
        private readonly index: TypeIndex,
        private readonly toDisplayPath: (fsPath: string) => string,
    ) {}

    public getType(typeId: string): JavaType | undefined {
        return this.typesById.get(typeId);
    }

    public getAllTypes(): JavaType[] {
        return [...this.typesById.values()];
    }

    public getTypeIdsForFile(fsPath: string): string[] {
        return this.typeIdsByFile.get(fsPath) ?? [];
    }

    public isFileParsed(fsPath: string): boolean {
        return this.typeIdsByFile.has(fsPath);
    }

    /** Welche geladenen Typen halten den Zieltyp (Feld oder new in Methode)? */
    public computeHolders(targetTypeId: string): TypeHolder[] {
        return computeHolders(this.typesById.values(), targetTypeId);
    }

    /** Welche geladenen Typen beerben/implementieren den Zieltyp direkt? */
    public computeSubtypes(targetTypeId: string): TypeSubtype[] {
        return computeSubtypes(this.typesById.values(), targetTypeId);
    }

    /** Parst Dateiinhalt (Editor-Text oder Diskinhalt) und aktualisiert das Modell. */
    public parseFileContent(fsPath: string, content: string): FileParseResult {
        const tree = this.parser.parse(content);
        const parsed = this.builder.build(tree, fsPath, this.toDisplayPath(fsPath));
        tree.delete();

        const context: ResolveContext = {
            packageName: parsed.packageName,
            imports: parsed.imports,
            wildcardImports: parsed.wildcardImports,
        };
        resolveParsedFile(parsed, (name) => resolveTypeName(name, context, this.index));

        const previousIds = this.typeIdsByFile.get(fsPath) ?? [];
        const currentIds = parsed.types.map((type) => type.id);
        const removedTypeIds = previousIds.filter((id) => !currentIds.includes(id));
        for (const removedId of removedTypeIds) {
            this.typesById.delete(removedId);
        }
        for (const type of parsed.types) {
            this.typesById.set(type.id, type);
        }
        this.typeIdsByFile.set(fsPath, currentIds);

        return { upserted: parsed.types, removedTypeIds };
    }

    /** Liest die Datei vom Datenträger und parst sie. */
    public parseFileFromDisk(fsPath: string): FileParseResult {
        const content = fs.readFileSync(fsPath, 'utf8');
        return this.parseFileContent(fsPath, content);
    }

    /** Stellt sicher, dass ein Typ geladen ist (z. B. gepinnt, aber Datei geschlossen). */
    public ensureTypeLoaded(typeId: string): JavaType | undefined {
        const existing = this.typesById.get(typeId);
        if (existing) {
            return existing;
        }
        const entry = this.index.byFqn(typeId);
        if (!entry || !fs.existsSync(entry.fsPath)) {
            return undefined;
        }
        this.parseFileFromDisk(entry.fsPath);
        return this.typesById.get(typeId);
    }

    /** Entfernt das Modell einer gelöschten Datei. */
    public removeFile(fsPath: string): string[] {
        const ids = this.typeIdsByFile.get(fsPath) ?? [];
        for (const id of ids) {
            this.typesById.delete(id);
        }
        this.typeIdsByFile.delete(fsPath);
        return ids;
    }
}
