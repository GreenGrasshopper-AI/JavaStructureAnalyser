import * as vscode from 'vscode';
import { ExtToWebviewMessage, WebviewToExtMessage } from '../shared/messages';

/**
 * Verwaltet das WebviewPanel mit dem selbst gezeichneten Canvas
 * (eine Instanz; erneutes Öffnen holt das Panel in den Vordergrund).
 */
export class CanvasPanel implements vscode.Disposable {
    private panel: vscode.WebviewPanel | undefined;
    private readonly disposables: vscode.Disposable[] = [];

    private readonly messageEmitter = new vscode.EventEmitter<WebviewToExtMessage>();
    public readonly onDidReceiveMessage = this.messageEmitter.event;

    private readonly disposeEmitter = new vscode.EventEmitter<void>();
    public readonly onDidDispose = this.disposeEmitter.event;

    public constructor(private readonly extensionUri: vscode.Uri) {}

    public get isOpen(): boolean {
        return this.panel !== undefined;
    }

    public show(): void {
        if (this.panel) {
            this.panel.reveal(undefined, true);
            return;
        }
        this.panel = vscode.window.createWebviewPanel(
            'javaStructureAnalyser.canvas',
            'Java Structure Canvas',
            { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')],
            },
        );
        this.panel.webview.html = this.buildHtml(this.panel.webview);
        this.panel.webview.onDidReceiveMessage(
            (message: WebviewToExtMessage) => this.messageEmitter.fire(message),
            undefined,
            this.disposables,
        );
        this.panel.onDidDispose(
            () => {
                this.panel = undefined;
                this.disposeEmitter.fire();
            },
            undefined,
            this.disposables,
        );
    }

    public postMessage(message: ExtToWebviewMessage): void {
        void this.panel?.webview.postMessage(message);
    }

    private buildHtml(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.js'));
        const nonce = getNonce();
        return `<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Java Structure Canvas</title>
    <style>
        html, body { height: 100%; margin: 0; padding: 0; overflow: hidden; }
        #canvas { display: block; width: 100vw; height: 100vh; cursor: grab; }
    </style>
</head>
<body>
    <canvas id="canvas"></canvas>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    public dispose(): void {
        this.panel?.dispose();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.messageEmitter.dispose();
        this.disposeEmitter.dispose();
    }
}

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
