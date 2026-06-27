import * as vscode from "vscode";
import type { FixCandidate } from "@package-workbench/core";
import type { AnalysisService } from "./analysis";
import { fixesForFile } from "./translate";

/**
 * Quick fixes: surfaces the Auto Fix engine's candidates as VS Code code actions
 * on the relevant file. Safe + review fixes get an action; dangerous fixes are
 * never offered as an auto-apply (only the Refactor Architect suggests those).
 *
 * Selecting an action runs the hidden `applyFixCandidate` command, which applies
 * the patch through core's atomic engine (backups + rollback).
 */
export const APPLY_FIX_COMMAND = "packageWorkbench.applyFixCandidate";

export class FixActionProvider implements vscode.CodeActionProvider {
  constructor(private readonly analysis: AnalysisService) {}

  provideCodeActions(
    document: vscode.TextDocument,
  ): vscode.ProviderResult<vscode.CodeAction[]> {
    const a = this.analysis.getAnalysis();
    if (!a) return [];

    const candidates = fixesForFile(a.fixPlan, document.uri.fsPath);
    return candidates.map((c) => this.toAction(c));
  }

  private toAction(candidate: FixCandidate): vscode.CodeAction {
    const verb =
      candidate.safety === "safe" ? "Apply safe fix" : "Apply fix (review)";
    const action = new vscode.CodeAction(
      `${verb}: ${candidate.title}`,
      vscode.CodeActionKind.QuickFix,
    );
    action.command = {
      command: APPLY_FIX_COMMAND,
      title: verb,
      arguments: [candidate],
    };
    action.isPreferred = candidate.safety === "safe";
    return action;
  }
}
