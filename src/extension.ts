import * as path from 'path';
import * as vscode from 'vscode';
import { ModelStore } from './analyzer/modelStore';
import { ParserService } from './analyzer/parserService';
import { CanvasController } from './controller';
import { CanvasPanel } from './panel/canvasPanel';
import { ViewPersistence } from './state/persistence';
import { WorkspaceIndex } from './workspace/workspaceIndex';

interface Services {
    controller: CanvasController;
    store: ModelStore;
    index: WorkspaceIndex;
}

let servicesPromise: Promise<Services> | undefined;

async function ensureServices(context: vscode.ExtensionContext): Promise<Services> {
    servicesPromise ??= (async () => {
        const parser = new ParserService();
        await parser.init(path.join(context.extensionUri.fsPath, 'dist'));

        const index = new WorkspaceIndex();
        const store = new ModelStore(parser, index, (fsPath) => vscode.workspace.asRelativePath(fsPath));
        const panel = new CanvasPanel(context.extensionUri);
        const persistence = new ViewPersistence(context.workspaceState);
        const controller = new CanvasController(panel, store, index, persistence);

        context.subscriptions.push(panel, index, controller);
        return { controller, store, index };
    })();
    return servicesPromise;
}

export function activate(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('javaStructureAnalyser.openCanvas', async () => {
            const services = await ensureServices(context);
            services.controller.openCanvas();
        }),
        vscode.commands.registerCommand('javaStructureAnalyser.saveCanvas', async () => {
            const services = await ensureServices(context);
            await services.controller.saveCanvasToFile();
        }),
        vscode.commands.registerCommand('javaStructureAnalyser.loadCanvas', async () => {
            const services = await ensureServices(context);
            await services.controller.loadCanvasFromFile();
        }),
        vscode.commands.registerCommand('javaStructureAnalyser.dumpModel', async () => {
            const services = await ensureServices(context);
            await services.index.init();
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'java') {
                void vscode.window.showInformationMessage('Java Structure: Bitte eine Java-Datei aktivieren.');
                return;
            }
            const result = services.store.parseFileContent(editor.document.uri.fsPath, editor.document.getText());
            const channel = vscode.window.createOutputChannel('Java Structure Analyser');
            channel.appendLine(JSON.stringify(result.upserted, null, 2));
            channel.show();
        }),
    );
}

export function deactivate(): void {
    servicesPromise = undefined;
}
