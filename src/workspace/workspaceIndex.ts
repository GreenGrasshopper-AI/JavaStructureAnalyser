import * as path from 'path';
import * as vscode from 'vscode';
import { TypeIndex, TypeIndexEntry } from '../analyzer/typeResolver';
import { isPreferredPath } from './pathPreference';

const EXCLUDE_GLOB = '{**/node_modules/**,**/target/**,**/build/**,**/bin/**,**/out/**,**/.git/**}';
const PACKAGE_REGEX = /^\s*package\s+([\w.]+)\s*;/m;

/** Ein FQN, den mehrere Dateien deklarieren (z. B. Backup-/Archiv-Kopien). */
export interface DuplicateFqn {
    fqn: string;
    fsPaths: string[];
}

/**
 * Kennt alle .java-Dateien des Workspace und leitet daraus FQN-Kandidaten ab
 * (Konvention: Dateiname = Top-Level-Typname). Hält sich über einen
 * FileSystemWatcher aktuell. Deklarieren mehrere Dateien denselben FQN
 * (Backup-Kopien), wird pro FQN eine kanonische Datei bevorzugt, damit das
 * Modell konsistent bleibt.
 */
export class WorkspaceIndex implements TypeIndex, vscode.Disposable {
    private readonly entriesByFqn = new Map<string, TypeIndexEntry[]>();
    private readonly entriesBySimpleName = new Map<string, TypeIndexEntry[]>();
    private readonly fqnByFsPath = new Map<string, string>();
    private watcher: vscode.FileSystemWatcher | undefined;
    private initPromise: Promise<void> | undefined;

    private readonly changeEmitter = new vscode.EventEmitter<void>();
    public readonly onDidChange = this.changeEmitter.event;

    public init(): Promise<void> {
        this.initPromise ??= this.doInit();
        return this.initPromise;
    }

    private async doInit(): Promise<void> {
        const files = await vscode.workspace.findFiles('**/*.java', EXCLUDE_GLOB);
        await Promise.all(files.map((uri) => this.indexFile(uri)));

        this.watcher = vscode.workspace.createFileSystemWatcher('**/*.java');
        this.watcher.onDidCreate(async (uri) => {
            await this.indexFile(uri);
            this.changeEmitter.fire();
        });
        this.watcher.onDidChange(async (uri) => {
            await this.indexFile(uri);
            this.changeEmitter.fire();
        });
        this.watcher.onDidDelete((uri) => {
            this.removeFile(uri.fsPath);
            this.changeEmitter.fire();
        });
    }

    private async indexFile(uri: vscode.Uri): Promise<void> {
        let content: string;
        try {
            const bytes = await vscode.workspace.fs.readFile(uri);
            content = Buffer.from(bytes).toString('utf8');
        } catch {
            return;
        }
        const packageName = PACKAGE_REGEX.exec(content)?.[1] ?? '';
        const simpleName = path.basename(uri.fsPath, '.java');
        const fqn = packageName ? `${packageName}.${simpleName}` : simpleName;

        this.removeFile(uri.fsPath);
        const entry: TypeIndexEntry = { fqn, simpleName, fsPath: uri.fsPath };
        addToList(this.entriesByFqn, fqn, entry);
        addToList(this.entriesBySimpleName, simpleName, entry);
        this.fqnByFsPath.set(uri.fsPath, fqn);
    }

    private removeFile(fsPath: string): void {
        const fqn = this.fqnByFsPath.get(fsPath);
        if (!fqn) {
            return;
        }
        this.fqnByFsPath.delete(fsPath);
        removeFromList(this.entriesByFqn, fqn, fsPath);
        removeFromList(this.entriesBySimpleName, path.basename(fsPath, '.java'), fsPath);
    }

    /** Kanonischer Repräsentant eines FQN (bevorzugte Datei bei Duplikaten). */
    public byFqn(fqn: string): TypeIndexEntry | undefined {
        const list = this.entriesByFqn.get(fqn);
        if (!list || list.length === 0) {
            return undefined;
        }
        return list.reduce((best, entry) => (isPreferredPath(entry.fsPath, best.fsPath) ? entry : best));
    }

    /** Ein Repräsentant pro FQN (für die Workspace-weite Halter-Suche). */
    public allEntries(): TypeIndexEntry[] {
        const result: TypeIndexEntry[] = [];
        for (const fqn of this.entriesByFqn.keys()) {
            const entry = this.byFqn(fqn);
            if (entry) {
                result.push(entry);
            }
        }
        return result;
    }

    public bySimpleName(simpleName: string): TypeIndexEntry[] {
        return this.entriesBySimpleName.get(simpleName) ?? [];
    }

    /** FQNs, die von mehreren Dateien deklariert werden (Backup-/Archiv-Kopien). */
    public duplicateFqns(): DuplicateFqn[] {
        const duplicates: DuplicateFqn[] = [];
        for (const [fqn, list] of this.entriesByFqn) {
            if (list.length > 1) {
                duplicates.push({ fqn, fsPaths: list.map((entry) => entry.fsPath) });
            }
        }
        return duplicates;
    }

    public dispose(): void {
        this.watcher?.dispose();
        this.changeEmitter.dispose();
    }
}

function addToList(map: Map<string, TypeIndexEntry[]>, key: string, entry: TypeIndexEntry): void {
    const list = map.get(key) ?? [];
    if (!list.some((candidate) => candidate.fsPath === entry.fsPath)) {
        list.push(entry);
    }
    map.set(key, list);
}

function removeFromList(map: Map<string, TypeIndexEntry[]>, key: string, fsPath: string): void {
    const list = (map.get(key) ?? []).filter((candidate) => candidate.fsPath !== fsPath);
    if (list.length > 0) {
        map.set(key, list);
    } else {
        map.delete(key);
    }
}
