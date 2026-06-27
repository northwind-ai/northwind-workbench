import { spawn } from "node:child_process";
import * as vscode from "vscode";
import {
  applyFix,
  undoLast,
  defaultBackupDir,
  createFailureAssistant,
  fromPackageReport,
  renderExplanationText,
  type FixCandidate,
} from "@package-workbench/core";
import {
  createChatEngine,
  renderAnswerText,
  type WorkbenchKnowledge,
} from "@package-workbench/chat-engine";
import type { AnalysisService } from "./analysis";
import { fixesForPackage, packageForFile } from "./translate";
import { APPLY_FIX_COMMAND } from "./codeActions";

/**
 * Command handlers. Each reuses core directly (failure assistant, atomic
 * auto-fix) and refreshes the cached analysis afterwards. No analysis logic lives
 * here — only editor orchestration.
 */

export interface CommandDeps {
  analysis: AnalysisService;
  workspaceRoot: string;
  output: vscode.OutputChannel;
  refreshViews: () => void;
}

export function registerCommands(
  context: vscode.ExtensionContext,
  deps: CommandDeps,
): void {
  const { analysis, workspaceRoot, output, refreshViews } = deps;
  const reg = (id: string, fn: (...args: any[]) => any) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg("packageWorkbench.analyzeWorkspace", async () => {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: "Package Workbench: analyzing…",
      },
      () => analysis.analyze(),
    );
    refreshViews();
    const a = analysis.getAnalysis();
    if (a)
      void vscode.window.showInformationMessage(
        `Package Workbench: ${a.run.summary.averageScore}/100 · ${a.run.summary.failed} failing package(s).`,
      );
  });

  reg("packageWorkbench.analyzeCurrentPackage", async () => {
    const report = currentPackage(analysis);
    if (!report)
      return void vscode.window.showWarningMessage(
        "No Package Workbench package for the active file.",
      );
    const fails = report.checks.filter((c) => c.status === "fail").length;
    void vscode.window.showInformationMessage(
      `${report.package.name}: ${report.score}/100 (${report.status})${fails ? ` · ${fails} failing check(s)` : ""}.`,
    );
  });

  reg("packageWorkbench.explainFailure", async () => {
    const report = currentPackage(analysis);
    if (!report)
      return void vscode.window.showWarningMessage(
        "No package for the active file.",
      );
    const inputs = fromPackageReport(report);
    if (inputs.length === 0)
      return void vscode.window.showInformationMessage(
        `${report.package.name} has no failures to explain.`,
      );
    const assistant = createFailureAssistant({ memory: workspaceRoot });
    const explanations = await assistant.analyzeMany(inputs);
    output.appendLine(`\n=== Explain: ${report.package.name} ===`);
    for (const e of explanations)
      output.appendLine(renderExplanationText(e) + "\n");
    output.show(true);
  });

  reg("packageWorkbench.applySafeFix", async () => {
    const report = currentPackage(analysis);
    const a = analysis.getAnalysis();
    if (!report || !a)
      return void vscode.window.showWarningMessage(
        "No package for the active file.",
      );
    const safe = fixesForPackage(a.fixPlan, report.package.id).filter(
      (c) => c.safety === "safe",
    );
    if (safe.length === 0)
      return void vscode.window.showInformationMessage(
        "No safe fixes for this package.",
      );
    let applied = 0;
    for (const c of safe)
      applied += (await applyCandidate(c, workspaceRoot, false)) ? 1 : 0;
    await analysis.analyze();
    refreshViews();
    void vscode.window.showInformationMessage(
      `Applied ${applied} safe fix(es). Re-run analysis to confirm.`,
    );
  });

  // Hidden: invoked by code actions + the Fixes view.
  reg(APPLY_FIX_COMMAND, async (candidate: FixCandidate) => {
    const allowReview = vscode.workspace
      .getConfiguration("packageWorkbench")
      .get<boolean>("applyReviewFixes", false);
    const ok = await applyCandidate(candidate, workspaceRoot, allowReview);
    if (ok) {
      await analysis.analyze();
      refreshViews();
      const undo = await vscode.window.showInformationMessage(
        `Applied: ${candidate.title}`,
        "Undo",
      );
      if (undo === "Undo") {
        await undoLast(defaultBackupDir(workspaceRoot));
        await analysis.analyze();
        refreshViews();
      }
    } else {
      void vscode.window.showWarningMessage(
        `Could not apply "${candidate.title}" (it may require review, or the file changed).`,
      );
    }
  });

  reg("packageWorkbench.askChat", async () => {
    const a = analysis.getAnalysis();
    if (!a)
      return void vscode.window.showWarningMessage(
        "Analyze the workspace first, then ask a question.",
      );
    const question = await vscode.window.showInputBox({
      prompt: "Ask Package Workbench about this repo",
      placeHolder: "e.g. What should I refactor first?",
    });
    if (!question) return;
    // Reuse the cached analysis as chat knowledge — no re-gather.
    const knowledge: WorkbenchKnowledge = {
      run: a.run,
      graph: a.graph,
      intel: a.intel,
      refactor: a.refactor,
      fixPlan: a.fixPlan,
    };
    const { answer } = await createChatEngine(knowledge).ask(question);
    output.appendLine(`\nQ: ${question}`);
    output.appendLine(renderAnswerText(answer));
    output.show(true);
  });

  reg("packageWorkbench.openDesktop", () => launchDesktop(workspaceRoot));
  reg("packageWorkbench.openPackageInDesktop", () => {
    const report = currentPackage(analysis);
    launchDesktop(report?.package.root ?? workspaceRoot);
  });
}

async function applyCandidate(
  candidate: FixCandidate,
  workspaceRoot: string,
  allowReview: boolean,
): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await applyFix(candidate, {
    backupDir: defaultBackupDir(workspaceRoot),
    backupId: `vscode-${now.replace(/[:.]/g, "-")}-${candidate.id.replace(/[^a-zA-Z0-9]/g, "_")}`,
    allowReview,
    now: () => now,
  });
  return result.applied;
}

function currentPackage(analysis: AnalysisService) {
  const a = analysis.getAnalysis();
  const file = vscode.window.activeTextEditor?.document.uri.fsPath;
  if (!a || !file) return null;
  return packageForFile(a.run, file);
}

function launchDesktop(target: string): void {
  const exe = vscode.workspace
    .getConfiguration("packageWorkbench")
    .get<string>("desktopAppPath", "");
  if (!exe) {
    void vscode.window.showInformationMessage(
      'Set "packageWorkbench.desktopAppPath" to launch the desktop app, or open it manually.',
    );
    return;
  }
  try {
    spawn(exe, [target], { detached: true, stdio: "ignore" }).unref();
  } catch (err) {
    void vscode.window.showErrorMessage(
      `Could not launch desktop app: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
