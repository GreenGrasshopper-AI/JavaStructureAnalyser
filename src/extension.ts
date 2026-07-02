import * as vscode from 'vscode';
import { analyseJavaDocument, buildGraphForOpenJavaDocuments, JavaDocumentAnalysis } from './javaAnalyzer';
import { getGraphWebviewHtml } from './graphWebview';

const PINNED_NODES_KEY = 'javaStructureAnalyser.pinnedNodes';

export function activate(context: vscode.ExtensionContext): void {
  const command = vscode.commands.registerCommand('javaStructureAnalyser.openGraph', async () => {
    const panel = JavaStructureAnalyserPanel.createOrShow(context);
    await panel.refresh(vscode.window.activeTextEditor?.document);
  });

  context.subscriptions.push(
    command,
    vscode.window.onDidChangeActiveTextEditor(async (editor) => {
      await JavaStructureAnalyserPanel.current?.refresh(editor?.document);
    }),
    vscode.window.tabGroups.onDidChangeTabs(async () => {
      await JavaStructureAnalyserPanel.current?.refresh();
    }),
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      if (document.languageId === 'java') {
        await JavaStructureAnalyserPanel.current?.refresh(document);
      }
    })
  );
}

export function deactivate(): void {
  JavaStructureAnalyserPanel.current?.dispose();
}

class JavaStructureAnalyserPanel {
  static current: JavaStructureAnalyserPanel | undefined;

  private readonly pinnedNodes: Set<string>;
  private readonly disposables: vscode.Disposable[] = [];
  private currentJavaDocumentPath: string | undefined;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext
  ) {
    this.pinnedNodes = new Set(context.globalState.get<string[]>(PINNED_NODES_KEY, []));

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      async (message: { type?: string; nodeId?: string }) => {
        if (message.type !== 'pinNode' || !message.nodeId) {
          return;
        }

        this.pinnedNodes.add(message.nodeId);
        await this.context.globalState.update(PINNED_NODES_KEY, Array.from(this.pinnedNodes).sort());
        await this.refresh();
      },
      null,
      this.disposables
    );
  }

  static createOrShow(context: vscode.ExtensionContext): JavaStructureAnalyserPanel {
    if (JavaStructureAnalyserPanel.current) {
      JavaStructureAnalyserPanel.current.panel.reveal(vscode.ViewColumn.Beside);
      return JavaStructureAnalyserPanel.current;
    }

    const panel = vscode.window.createWebviewPanel(
      'javaStructureAnalyserGraph',
      'Java Structure Analyser',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    JavaStructureAnalyserPanel.current = new JavaStructureAnalyserPanel(panel, context);
    return JavaStructureAnalyserPanel.current;
  }

  async refresh(preferredDocument?: vscode.TextDocument): Promise<void> {
    if (preferredDocument?.languageId === 'java') {
      this.currentJavaDocumentPath = preferredDocument.uri.fsPath;
    } else {
      const activeDocument = vscode.window.activeTextEditor?.document;
      if (activeDocument?.languageId === 'java') {
        this.currentJavaDocumentPath = activeDocument.uri.fsPath;
      }
    }

    const openJavaDocuments = await analyseOpenJavaEditorDocuments(preferredDocument);
    const currentDocument = selectCurrentDocument(openJavaDocuments, this.currentJavaDocumentPath);

    if (!currentDocument) {
      this.panel.webview.html = getGraphWebviewHtml(undefined, createNonce());
      return;
    }

    this.currentJavaDocumentPath = currentDocument.filePath;
    const graph = buildGraphForOpenJavaDocuments(currentDocument, openJavaDocuments, this.pinnedNodes);
    this.panel.webview.html = getGraphWebviewHtml(graph, createNonce());
  }

  dispose(): void {
    JavaStructureAnalyserPanel.current = undefined;
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }
}

async function analyseOpenJavaEditorDocuments(preferredDocument?: vscode.TextDocument): Promise<JavaDocumentAnalysis[]> {
  const analyses: JavaDocumentAnalysis[] = [];
  const seen = new Set<string>();

  for (const uri of getOpenTextTabUris()) {
    const key = uri.toString();
    if (seen.has(key) || !isJavaLikeUri(uri)) {
      continue;
    }
    seen.add(key);

    try {
      const document = await getTextDocument(uri, preferredDocument);
      if (document.languageId !== 'java' && !isJavaLikeUri(document.uri)) {
        continue;
      }
      analyses.push(analyseJavaDocument(document.uri.fsPath, document.getText()));
    } catch (error) {
      console.warn(`Java Structure Analyser skipped ${uri.toString()}:`, error);
    }
  }

  return analyses;
}

function getOpenTextTabUris(): vscode.Uri[] {
  const uris: vscode.Uri[] = [];

  for (const tabGroup of vscode.window.tabGroups.all) {
    for (const tab of tabGroup.tabs) {
      if (tab.input instanceof vscode.TabInputText) {
        uris.push(tab.input.uri);
      }
    }
  }

  return uris;
}

async function getTextDocument(uri: vscode.Uri, preferredDocument?: vscode.TextDocument): Promise<vscode.TextDocument> {
  if (preferredDocument?.uri.toString() === uri.toString()) {
    return preferredDocument;
  }

  const alreadyOpen = vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString());
  if (alreadyOpen) {
    return alreadyOpen;
  }

  return vscode.workspace.openTextDocument(uri);
}

function selectCurrentDocument(
  documents: JavaDocumentAnalysis[],
  currentJavaDocumentPath: string | undefined
): JavaDocumentAnalysis | undefined {
  return documents.find((document) => document.filePath === currentJavaDocumentPath) ?? documents[0];
}

function isJavaLikeUri(uri: vscode.Uri): boolean {
  return uri.fsPath.toLowerCase().endsWith('.java');
}

function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let i = 0; i < 32; i += 1) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return value;
}
