import { ExtToWebviewMessage, WebviewToExtMessage } from '../src/shared/messages';
import { Camera } from './canvas/camera';
import { Renderer } from './canvas/renderer';
import { Interaction } from './interaction';
import { ViewModel } from './viewModel';

declare function acquireVsCodeApi(): {
    postMessage(message: WebviewToExtMessage): void;
};

const vscode = acquireVsCodeApi();

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const camera = new Camera();
const viewModel = new ViewModel();
const renderer = new Renderer(canvas, camera, viewModel);

const PERSIST_DEBOUNCE_MS = 400;
let persistTimeout: number | undefined;

function persistNow(): void {
    if (persistTimeout !== undefined) {
        window.clearTimeout(persistTimeout);
        persistTimeout = undefined;
    }
    vscode.postMessage({
        type: 'persistView',
        view: viewModel.buildPersistedView({ x: camera.x, y: camera.y, scale: camera.scale }),
    });
}

function persistSoon(): void {
    if (persistTimeout !== undefined) {
        window.clearTimeout(persistTimeout);
    }
    persistTimeout = window.setTimeout(() => {
        persistTimeout = undefined;
        persistNow();
    }, PERSIST_DEBOUNCE_MS);
}

/** Bereits angefragte Typen nicht erneut anfragen (verhindert Request-Schleifen). */
const requestedTypeIds = new Set<string>();

function requestMissingTypes(typeIds: string[]): void {
    const toRequest = typeIds.filter((id) => !requestedTypeIds.has(id));
    if (toRequest.length === 0) {
        return;
    }
    for (const id of toRequest) {
        requestedTypeIds.add(id);
    }
    vscode.postMessage({ type: 'requestTypes', typeIds: toRequest });
}

/** Startpunkt-Typen, für die bereits Halter angefragt wurden. */
const requestedHolderIds = new Set<string>();

/**
 * Fragt Halter für alle Startpunkte an, die noch keine haben.
 * force = true verwirft den Cache (nach Modell-Änderungen können sich
 * Halter-Beziehungen in beliebigen Dateien geändert haben).
 */
function syncHolders(force = false): void {
    if (force) {
        requestedHolderIds.clear();
    }
    const wanted = [...viewModel.pinnedPositions.keys()].filter((id) => !requestedHolderIds.has(id));
    if (wanted.length === 0) {
        return;
    }
    for (const id of wanted) {
        requestedHolderIds.add(id);
    }
    vscode.postMessage({ type: 'requestHolders', typeIds: wanted });
}

/** Typen, für die bereits Subtypen angefragt wurden. */
const requestedSubtypeIds = new Set<string>();

/**
 * Fragt Subtypen für alle sichtbaren Element-Typen an, die noch keine haben
 * (für die Subtyp-Geister unter abstrakten Klassen/Interfaces).
 * force = true verwirft den Cache (extends/implements kann sich ändern).
 */
function syncSubtypes(force = false): void {
    if (force) {
        requestedSubtypeIds.clear();
    }
    const visibleTypeIds = new Set<string>();
    for (const element of viewModel.elements.values()) {
        visibleTypeIds.add(element.typeId);
    }
    const wanted = [...visibleTypeIds].filter((id) => !requestedSubtypeIds.has(id));
    if (wanted.length === 0) {
        return;
    }
    for (const id of wanted) {
        requestedSubtypeIds.add(id);
    }
    vscode.postMessage({ type: 'requestSubtypes', typeIds: wanted });
}

new Interaction(canvas, camera, renderer, viewModel, {
    openFile: (typeId, member) => vscode.postMessage({ type: 'openFile', typeId, member }),
    requestMissingTypes,
    persistSoon,
    syncHolders,
    syncSubtypes,
});

window.addEventListener('message', (event: MessageEvent<ExtToWebviewMessage>) => {
    const message = event.data;
    switch (message.type) {
        case 'init': {
            const result = viewModel.initFromView(message.types, message.view);
            camera.x = message.view.viewport.x;
            camera.y = message.view.viewport.y;
            camera.scale = message.view.viewport.scale;
            renderer.invalidateLayouts();
            requestMissingTypes(result.missingTypeIds);
            syncHolders(true);
            syncSubtypes(true);
            renderer.resize();
            break;
        }
        case 'modelUpdate': {
            for (const type of message.upsertTypes) {
                requestedTypeIds.delete(type.id);
            }
            const upsertResult = viewModel.upsertTypes(message.upsertTypes);
            const removeResult = viewModel.removeTypes(message.removedTypeIds);
            renderer.invalidateLayouts();
            requestMissingTypes([...upsertResult.missingTypeIds, ...removeResult.missingTypeIds]);
            syncHolders(true);
            syncSubtypes(true);
            renderer.scheduleDraw();
            break;
        }
        case 'dropResult': {
            const result = viewModel.addStartPoints(message.types, message.x, message.y);
            renderer.invalidateLayouts();
            requestMissingTypes(result.missingTypeIds);
            syncHolders();
            syncSubtypes();
            persistSoon();
            renderer.scheduleDraw();
            break;
        }
        case 'holdersUpdate': {
            const result = viewModel.upsertTypes(message.holderTypes);
            viewModel.mergeHolders(message.holders);
            renderer.invalidateLayouts();
            requestMissingTypes(result.missingTypeIds);
            syncSubtypes();
            renderer.scheduleDraw();
            break;
        }
        case 'subtypesUpdate': {
            const result = viewModel.upsertTypes(message.subtypeTypes);
            viewModel.mergeSubtypes(message.subtypes);
            renderer.invalidateLayouts();
            requestMissingTypes(result.missingTypeIds);
            // neue Typen können ausstehende Realisierungen materialisiert haben
            syncSubtypes();
            renderer.scheduleDraw();
            break;
        }
        case 'requestPersist': {
            persistNow();
            break;
        }
    }
});

// --- Drag&Drop: Java-Dateien (VSCode-Explorer oder OS) als Startpunkte ablegen ---

/** Liest abgelegte Datei-URIs/-Pfade aus den verschiedenen Mime-Typen, die VSCode setzt. */
function extractDroppedUris(dataTransfer: DataTransfer | null): string[] {
    if (!dataTransfer) {
        return [];
    }
    const fromLines = (text: string): string[] =>
        text
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0 && !line.startsWith('#'));

    const uriList = dataTransfer.getData('text/uri-list') || dataTransfer.getData('application/vnd.code.uri-list');
    if (uriList) {
        return fromLines(uriList);
    }
    // VSCode-Explorer-Drags: 'codefiles' bzw. 'resourceurls' = JSON-Arrays
    for (const mime of ['resourceurls', 'codefiles']) {
        const raw = dataTransfer.getData(mime);
        if (!raw) {
            continue;
        }
        try {
            const parsed: unknown = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                const entries = parsed.filter((entry): entry is string => typeof entry === 'string');
                if (entries.length > 0) {
                    return entries;
                }
            }
        } catch {
            // ignorieren, nächsten Mime-Typ versuchen
        }
    }
    const plain = dataTransfer.getData('text/plain');
    return plain ? fromLines(plain) : [];
}

canvas.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
    }
});

canvas.addEventListener('drop', (event) => {
    event.preventDefault();
    const uris = extractDroppedUris(event.dataTransfer);
    if (uris.length === 0) {
        return;
    }
    const rect = canvas.getBoundingClientRect();
    const world = camera.toWorld(event.clientX - rect.left, event.clientY - rect.top);
    vscode.postMessage({ type: 'dropFiles', uris, x: world.x, y: world.y });
});

window.addEventListener('resize', () => renderer.resize());

// Theme-Wechsel: VSCode stempelt data-vscode-theme-kind auf das body-Element
new MutationObserver(() => renderer.refreshPalette()).observe(document.body, {
    attributes: true,
    attributeFilter: ['data-vscode-theme-kind', 'class'],
});

renderer.resize();
vscode.postMessage({ type: 'ready' });
