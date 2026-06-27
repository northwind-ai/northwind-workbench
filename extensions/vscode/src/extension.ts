import * as vscode from "vscode";
import { AnalysisService } from "./analysis";
import { DiagnosticsManager } from "./diagnostics";
import { PackageHoverProvider } from "./hover";
import { FixActionProvider } from "./codeActions";
import { registerCommands } from "./commands";
import {
  WorkbenchTreeProvider,
  buildOverview,
  buildFailures,
  buildGraph,
  buildFixes,
} from "./views";

/**
 * Extension entry point. Wires the analysis service (which reuses Package
 * Workbench core) to the editor surfaces: diagnostics, hovers, quick fixes, the
 * sidebar, and commands. Heavy work runs in the background; edits trigger a
 * debounced refresh so the editor never blocks.
 */

const SOURCE_SELECTOR: Array<{ language: string; scheme: string }> = [
  { language: "typescript", scheme: "file" },
  { language: "typescriptreact", scheme: "file" },
  { language: "javascript", scheme: "file" },
  { language: "javascriptreact", scheme: "file" },
];

export function activate(context: vscode.ExtensionContext): void {
  const folder = vscode.workspace.workspaceFolders?.[0];
  const output = vscode.window.createOutputChannel("Package Workbench");
  context.subscriptions.push(output);

  if (!folder) {
    output.appendLine("No workspace folder open — Package Workbench is idle.");
    return;
  }
  const workspaceRoot = folder.uri.fsPath;
  const analysis = new AnalysisService(workspaceRoot, output);
  context.subscriptions.push(analysis);

  // Diagnostics + hovers + quick fixes.
  context.subscriptions.push(new DiagnosticsManager(analysis));
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      SOURCE_SELECTOR,
      new PackageHoverProvider(analysis),
    ),
  );
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      [
        { language: "json", scheme: "file", pattern: "**/package.json" },
        ...SOURCE_SELECTOR,
      ],
      new FixActionProvider(analysis),
      {
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
      },
    ),
  );

  // Sidebar views.
  const overview = new WorkbenchTreeProvider(() => buildOverview(analysis));
  const failures = new WorkbenchTreeProvider(() => buildFailures(analysis));
  const graph = new WorkbenchTreeProvider(() => buildGraph(analysis));
  const fixes = new WorkbenchTreeProvider(() => buildFixes(analysis));
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("pwOverview", overview),
    vscode.window.registerTreeDataProvider("pwFailures", failures),
    vscode.window.registerTreeDataProvider("pwGraph", graph),
    vscode.window.registerTreeDataProvider("pwFixes", fixes),
  );
  const refreshViews = (): void => {
    overview.refresh();
    failures.refresh();
    graph.refresh();
    fixes.refresh();
  };
  context.subscriptions.push(analysis.onDidChange(() => refreshViews()));

  // Commands.
  registerCommands(context, { analysis, workspaceRoot, output, refreshViews });

  // Background re-analysis on save (debounced) — keeps the editor responsive.
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      const cfg = vscode.workspace.getConfiguration("packageWorkbench");
      if (!cfg.get<boolean>("autoAnalyze", true)) return;
      if (!isRelevant(doc)) return;
      analysis.scheduleRefresh(cfg.get<number>("debounceMs", 800));
    }),
  );

  // Initial analysis in the background (lazy — never blocks activation).
  void analysis.analyze();
}

export function deactivate(): void {
  /* subscriptions are disposed by VS Code */
}

function isRelevant(doc: vscode.TextDocument): boolean {
  return (
    doc.fileName.endsWith("package.json") ||
    /\.(?:m|c)?[jt]sx?$/.test(doc.fileName)
  );
}
