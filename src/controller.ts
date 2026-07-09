import * as vscode from 'vscode';
import { ModelStore } from './analyzer/modelStore';
import { CanvasPanel } from './panel/canvasPanel';
import { JavaType, SourceRange, TypeHolder, TypeSubtype } from './shared/javaModel';
import { emptyView, PersistedView, WebviewToExtMessage } from './shared/messages';
import { ViewPersistence } from './state/persistence';
import { WorkspaceIndex } from './workspace/workspaceIndex';

const REPARSE_DEBOUNCE_MS = 400;
const CAPTURE_VIEW_TIMEOUT_MS = 800;
const CANVAS_FILE_FILTERS = { 'Java Structure Canvas': ['javacanvas.json', 'json'] };

/**
 * Verbindet Editor-Ereignisse, Analyse-Modell und Canvas-Webview.
 */
export class CanvasController implements vscode.Disposable {
    private readonly disposables: vscode.Disposable[] = [];
    private readonly reparseTimers = new Map<string, NodeJS.Timeout>();
    private webviewReady = false;
    /** Kompletter Workspace bereits geparst? (nötig für die Halter-Rückwärtssuche) */
    private workspaceParsed = false;
    /** Duplikat-Warnung bereits gezeigt? (einmal pro Sitzung) */
    private duplicatesWarned = false;
    /** Warten auf die nächste persistView-Meldung (für "Speichern als Datei"). */
    private viewWaiters: ((view: PersistedView) => void)[] = [];

    public constructor(
        private readonly panel: CanvasPanel,
        private readonly store: ModelStore,
        private readonly index: WorkspaceIndex,
        private readonly persistence: ViewPersistence,
    ) {
        this.disposables.push(
            panel.onDidReceiveMessage((message) => void this.handleMessage(message)),
            panel.onDidDispose(() => {
                this.webviewReady = false;
            }),
            vscode.workspace.onDidChangeTextDocument((event) => this.handleDocumentChanged(event)),
            // neue/gelöschte Dateien: beim nächsten requestHolders erneut über den Index gehen
            index.onDidChange(() => {
                this.workspaceParsed = false;
            }),
        );
    }

    public openCanvas(): void {
        this.panel.show();
    }

    private async handleMessage(message: WebviewToExtMessage): Promise<void> {
        switch (message.type) {
            case 'ready':
                await this.sendInit();
                break;
            case 'openFile':
                await this.openFile(message.typeId, message.member);
                break;
            case 'persistView': {
                await this.persistence.save(message.view);
                const waiters = this.viewWaiters;
                this.viewWaiters = [];
                for (const waiter of waiters) {
                    waiter(message.view);
                }
                break;
            }
            case 'requestTypes':
                await this.sendRequestedTypes(message.typeIds);
                break;
            case 'dropFiles':
                await this.handleDropFiles(message.uris, message.x, message.y);
                break;
            case 'requestHolders':
                await this.sendHolders(message.typeIds);
                break;
            case 'requestSubtypes':
                await this.sendSubtypes(message.typeIds);
                break;
        }
    }

    private async sendInit(): Promise<void> {
        await this.index.init();
        const view = this.persistence.load();
        for (const pinned of view.pinned) {
            this.store.ensureTypeLoaded(pinned.typeId);
        }

        this.webviewReady = true;
        this.panel.postMessage({
            type: 'init',
            types: this.store.getAllTypes(),
            view,
        });
    }

    /** Parst eine Datei (bevorzugt aus dem Editor-Puffer) und liefert ihre Typ-IDs. */
    private parseFile(fsPath: string): string[] {
        try {
            const document = vscode.workspace.textDocuments.find((doc) => doc.uri.fsPath === fsPath);
            if (document) {
                this.store.parseFileContent(fsPath, document.getText());
            } else {
                this.store.parseFileFromDisk(fsPath);
            }
        } catch (error) {
            console.warn(`JavaStructureAnalyser: Parsen fehlgeschlagen für ${fsPath}`, error);
        }
        return this.store.getTypeIdsForFile(fsPath);
    }

    /** Per Drag&Drop abgelegte Dateien parsen und als Startpunkte ans Webview melden. */
    private async handleDropFiles(uris: string[], x: number, y: number): Promise<void> {
        await this.index.init();
        const types: JavaType[] = [];
        const seen = new Set<string>();
        for (const raw of uris) {
            const fsPath = toFsPath(raw);
            if (!fsPath || !fsPath.toLowerCase().endsWith('.java')) {
                continue;
            }
            for (const typeId of this.parseFile(fsPath)) {
                if (seen.has(typeId)) {
                    continue;
                }
                seen.add(typeId);
                const type = this.store.getType(typeId);
                if (type) {
                    types.push(type);
                }
            }
        }
        if (types.length === 0) {
            void vscode.window.showInformationMessage(
                'Java Structure: In den abgelegten Dateien wurden keine Java-Typen gefunden.',
            );
            return;
        }
        this.panel.postMessage({ type: 'dropResult', types, x, y });
    }

    /** Halter-Rückwärtssuche; parst dafür beim ersten Mal den gesamten Workspace. */
    private async sendHolders(typeIds: string[]): Promise<void> {
        await this.index.init();
        this.ensureWorkspaceParsed();
        const holders: Record<string, TypeHolder[]> = {};
        const holderTypes = new Map<string, JavaType>();
        for (const typeId of typeIds) {
            const list = this.store.computeHolders(typeId);
            holders[typeId] = list;
            for (const holder of list) {
                const type = this.store.getType(holder.holderTypeId);
                if (type) {
                    holderTypes.set(type.id, type);
                }
            }
        }
        this.panel.postMessage({ type: 'holdersUpdate', holders, holderTypes: [...holderTypes.values()] });
    }

    /** Subtyp-Suche; parst dafür (wie die Halter-Suche) beim ersten Mal den gesamten Workspace. */
    private async sendSubtypes(typeIds: string[]): Promise<void> {
        await this.index.init();
        this.ensureWorkspaceParsed();
        const subtypes: Record<string, TypeSubtype[]> = {};
        const subtypeTypes = new Map<string, JavaType>();
        for (const typeId of typeIds) {
            const list = this.store.computeSubtypes(typeId);
            subtypes[typeId] = list;
            for (const subtype of list) {
                const type = this.store.getType(subtype.subtypeId);
                if (type) {
                    subtypeTypes.set(type.id, type);
                }
            }
        }
        this.panel.postMessage({ type: 'subtypesUpdate', subtypes, subtypeTypes: [...subtypeTypes.values()] });
    }

    private ensureWorkspaceParsed(): void {
        if (this.workspaceParsed) {
            return;
        }
        for (const entry of this.index.allEntries()) {
            // Eine bereits geladene FQN (z. B. per Drag&Drop oder Expansion) nicht durch
            // eine andere Dateiversion überschreiben — sonst wird das Modell bei doppelten
            // Klassennamen inkonsistent (Halter kennen Felder, die der gezeichnete Typ nicht hat).
            if (this.store.isFileParsed(entry.fsPath) || this.store.getType(entry.fqn)) {
                continue;
            }
            this.parseFile(entry.fsPath);
        }
        this.warnAboutDuplicateFqns();
        this.workspaceParsed = true;
    }

    /** Einmalige Warnung, wenn mehrere Dateien denselben Typ deklarieren (Backup-Kopien). */
    private warnAboutDuplicateFqns(): void {
        if (this.duplicatesWarned) {
            return;
        }
        const duplicates = this.index.duplicateFqns();
        if (duplicates.length === 0) {
            return;
        }
        this.duplicatesWarned = true;
        const names = duplicates.slice(0, 5).map((duplicate) => duplicate.fqn).join(', ');
        const more = duplicates.length > 5 ? ` (+${duplicates.length - 5} weitere)` : '';
        void vscode.window.showWarningMessage(
            `Java Structure: Mehrere Dateien deklarieren denselben Typ (${names}${more}). ` +
                'Pro Typ wird eine Datei verwendet; doppelte Kopien (z. B. Backups/Archive) können ' +
                'zu fehlenden Feldern oder falschen Haltern führen.',
        );
    }

    private handleDocumentChanged(event: vscode.TextDocumentChangeEvent): void {
        if (!this.webviewReady || event.document.languageId !== 'java' || event.document.uri.scheme !== 'file') {
            return;
        }
        const fsPath = event.document.uri.fsPath;
        const existing = this.reparseTimers.get(fsPath);
        if (existing) {
            clearTimeout(existing);
        }
        this.reparseTimers.set(
            fsPath,
            setTimeout(() => {
                this.reparseTimers.delete(fsPath);
                try {
                    const result = this.store.parseFileContent(fsPath, event.document.getText());
                    this.panel.postMessage({
                        type: 'modelUpdate',
                        upsertTypes: result.upserted,
                        removedTypeIds: result.removedTypeIds,
                    });
                } catch (error) {
                    console.warn(`JavaStructureAnalyser: Re-Parse fehlgeschlagen für ${fsPath}`, error);
                }
            }, REPARSE_DEBOUNCE_MS),
        );
    }

    private async sendRequestedTypes(typeIds: string[]): Promise<void> {
        await this.index.init();
        const found: JavaType[] = [];
        for (const typeId of typeIds) {
            const type = this.store.ensureTypeLoaded(typeId);
            if (type) {
                found.push(type);
            }
        }
        if (found.length > 0) {
            this.panel.postMessage({ type: 'modelUpdate', upsertTypes: found, removedTypeIds: [] });
        }
    }

    private async openFile(typeId: string, member?: { kind: 'method' | 'field'; name: string }): Promise<void> {
        const type = this.store.getType(typeId) ?? this.store.ensureTypeLoaded(typeId);
        if (!type) {
            return;
        }
        let range: SourceRange = type.nameRange;
        if (member?.kind === 'method') {
            const method = type.methods.find((candidate) => candidate.name === member.name);
            range = method?.declRange ?? range;
        } else if (member?.kind === 'field') {
            const field = type.fields.find((candidate) => candidate.name === member.name);
            range = field?.declRange ?? range;
        }
        const selection = new vscode.Range(range.startLine, range.startCol, range.endLine, range.endCol);
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(type.filePath));
        await vscode.window.showTextDocument(document, {
            viewColumn: vscode.ViewColumn.One,
            preview: true,
            selection,
        });
    }

    /**
     * Liefert den aktuellen View-State: frisch vom Webview, wenn es offen ist,
     * sonst der zuletzt persistierte Stand.
     */
    private captureCurrentView(): Promise<PersistedView> {
        if (!this.panel.isOpen || !this.webviewReady) {
            return Promise.resolve(this.persistence.load());
        }
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                this.viewWaiters = this.viewWaiters.filter((waiter) => waiter !== onView);
                resolve(this.persistence.load());
            }, CAPTURE_VIEW_TIMEOUT_MS);
            const onView = (view: PersistedView): void => {
                clearTimeout(timeout);
                resolve(view);
            };
            this.viewWaiters.push(onView);
            this.panel.postMessage({ type: 'requestPersist' });
        });
    }

    public async saveCanvasToFile(): Promise<void> {
        const view = await this.captureCurrentView();
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
        const target = await vscode.window.showSaveDialog({
            defaultUri: workspaceFolder
                ? vscode.Uri.joinPath(workspaceFolder, 'mentales-modell.javacanvas.json')
                : undefined,
            filters: CANVAS_FILE_FILTERS,
            title: 'Structure Canvas speichern',
        });
        if (!target) {
            return;
        }
        const json = JSON.stringify(view, null, 2);
        await vscode.workspace.fs.writeFile(target, Buffer.from(json, 'utf8'));
        void vscode.window.showInformationMessage(
            `Java Structure: Canvas gespeichert (${vscode.workspace.asRelativePath(target)})`,
        );
    }

    public async loadCanvasFromFile(): Promise<void> {
        const selection = await vscode.window.showOpenDialog({
            canSelectMany: false,
            filters: CANVAS_FILE_FILTERS,
            title: 'Structure Canvas laden',
        });
        const source = selection?.[0];
        if (!source) {
            return;
        }
        let view: PersistedView;
        try {
            const bytes = await vscode.workspace.fs.readFile(source);
            view = this.validateView(JSON.parse(Buffer.from(bytes).toString('utf8')));
        } catch (error) {
            void vscode.window.showErrorMessage(
                `Java Structure: Datei konnte nicht geladen werden (${error instanceof Error ? error.message : String(error)})`,
            );
            return;
        }
        await this.persistence.save(view);
        this.panel.show();
        if (this.webviewReady) {
            await this.sendInit();
        }
        // andernfalls lädt das Webview den persistierten Stand über seine 'ready'-Meldung
    }

    /** Minimal-Validierung einer geladenen Canvas-Datei; wirft bei fremdem Format. */
    private validateView(raw: unknown): PersistedView {
        const candidate = raw as Partial<PersistedView> | null;
        if (!candidate || typeof candidate !== 'object' || candidate.version !== 1 || !Array.isArray(candidate.pinned)) {
            throw new Error('keine gültige Java-Structure-Canvas-Datei');
        }
        return {
            ...emptyView(),
            ...candidate,
            version: 1,
            viewport: { ...emptyView().viewport, ...(candidate.viewport ?? {}) },
        };
    }

    public dispose(): void {
        for (const timer of this.reparseTimers.values()) {
            clearTimeout(timer);
        }
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }
}

/**
 * Wandelt einen gedropten Eintrag (URI oder roher Pfad) in einen fsPath.
 * Ein-Buchstaben-"Schemata" sind Windows-Laufwerksbuchstaben, keine URIs.
 */
function toFsPath(raw: string): string | undefined {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
        return undefined;
    }
    try {
        if (/^[a-z][a-z0-9+.-]+:/i.test(trimmed)) {
            return vscode.Uri.parse(trimmed).fsPath;
        }
        return trimmed;
    } catch {
        return undefined;
    }
}
