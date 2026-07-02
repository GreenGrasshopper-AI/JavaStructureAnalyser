import * as vscode from 'vscode';
import { analyseJavaDocument, buildGraphForClass, JavaDocumentAnalysis } from './javaAnalyzer';
import { getGraphWebviewHtml } from './graphWebview';

const PINNED_NODES_KEY = 'javaStructureAnalyser.pinnedNodes';
const MAX_WORKSPACE_JAVA_FILES = 5000;

export function activate(context: vscode.ExtensionContext): void {
  const command = vscode.commands.registerCommand('javaStructureAnalyser.openGraph', async () => {
    const panel = JavaStructureAnalyserPanel.createOrShow(context);
    await panel.refresh();
  });

  context.subscriptions.push(
    command,
    vscode.window.onDidChangeActiveTextEditor(async () => {
      await JavaStructureAnalyserPanel.current?.refresh();
    }),
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      if (document.languageId === 'java') {
        await JavaStructureAnalyserPanel.current?.refresh();
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

  async refresh(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'java') {
      this.panel.webview.html = getGraphWebviewHtml(undefined, createNonce());
      return;
    }

    const currentDocument = analyseJavaDocument(editor.document.uri.fsPath, editor.document.getText());
    const workspaceAnalyses = await analyseWorkspaceJavaDocuments(editor.document);
    const allDocuments = mergeAnalyses(currentDocument, workspaceAnalyses);
    const graph = buildGraphForClass(currentDocument, allDocuments, this.pinnedNodes);
    this.panel.webview.html = getGraphWebviewHtml(graph, createNonce());
  }

  dispose(): void {
    JavaStructureAnalyserPanel.current = undefined;
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }
}

async function analyseWorkspaceJavaDocuments(activeDocument: vscode.TextDocument): Promise<JavaDocumentAnalysis[]> {
  const files = await vscode.workspace.findFiles(
    '**/*.java',
    '**/{node_modules,.git,target,build,out,dist}/**',
    MAX_WORKSPACE_JAVA_FILES
  );

  const analyses: JavaDocumentAnalysis[] = [];
  for (const file of files) {
    try {
      if (file.fsPath === activeDocument.uri.fsPath) {
        analyses.push(analyseJavaDocument(activeDocument.uri.fsPath, activeDocument.getText()));
        continue;
      }

      const bytes = await vscode.workspace.fs.readFile(file);
      const source = new TextDecoder('utf-8').decode(bytes);
      analyses.push(analyseJavaDocument(file.fsPath, source));
    } catch (error) {
      console.warn(`Java Structure Analyser skipped ${file.fsPath}:`, error);
    }
  }

  return analyses;
}

function mergeAnalyses(currentDocument: JavaDocumentAnalysis, documents: JavaDocumentAnalysis[]): JavaDocumentAnalysis[] {
  const byPath = new Map<string, JavaDocumentAnalysis>();
  byPath.set(currentDocument.filePath, currentDocument);
  for (const document of documents) {
    byPath.set(document.filePath, document);
  }
  return Array.from(byPath.values());
}

function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let i = 0; i < 32; i += 1) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return value;
}
