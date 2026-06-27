import * as vscode from "vscode";
import type { AnalysisService } from "./analysis";
import {
  extractImportSpecifier,
  hoverCardForPackage,
  packageForSpecifier,
  renderHoverMarkdown,
} from "./translate";

/**
 * Hover provider: hovering an internal package import shows its health card
 * (score, runtime, warnings). Pure logic is in `translate`; this just locates the
 * specifier under the cursor and renders Markdown.
 */
export class PackageHoverProvider implements vscode.HoverProvider {
  constructor(private readonly analysis: AnalysisService) {}

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.ProviderResult<vscode.Hover> {
    const a = this.analysis.getAnalysis();
    if (!a) return null;

    const line = document.lineAt(position.line).text;
    const specifier = extractImportSpecifier(line);
    if (!specifier) return null;

    const report = packageForSpecifier(a.run, specifier);
    if (!report) return null;

    const card = hoverCardForPackage(report, a.graph);
    const md = new vscode.MarkdownString(renderHoverMarkdown(card));
    md.isTrusted = true;
    return new vscode.Hover(md);
  }
}
