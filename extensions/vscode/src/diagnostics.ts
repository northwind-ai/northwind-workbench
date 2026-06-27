import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import * as vscode from "vscode";
import type { AnalysisService, WorkspaceAnalysis } from "./analysis";
import {
  diagnosticsForPackageJson,
  diagnosticsForSource,
  type DiagnosticDescriptor,
  type DiagSeverity,
} from "./translate";

/**
 * Publishes Package Workbench findings into the VS Code Problems panel via a
 * dedicated DiagnosticCollection. All mapping logic lives in the pure `translate`
 * layer; this file is the thin `vscode` adapter (descriptor → vscode.Diagnostic).
 */

const SEVERITY: Record<DiagSeverity, vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
};

export class DiagnosticsManager {
  private readonly collection: vscode.DiagnosticCollection;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(analysis: AnalysisService) {
    this.collection =
      vscode.languages.createDiagnosticCollection("package-workbench");
    this.disposables.push(this.collection);
    this.disposables.push(analysis.onDidChange((a) => this.refresh(a)));
  }

  private refresh(a: WorkspaceAnalysis | null): void {
    this.collection.clear();
    if (!a) return;

    for (const report of a.run.reports) {
      const pkgJsonPath = report.package.packageJsonPath;
      const text = safeRead(pkgJsonPath);
      if (text != null) {
        const descriptors = diagnosticsForPackageJson(
          report,
          a.graph,
          text,
          pkgJsonPath,
        );
        this.publish(pkgJsonPath, descriptors);
      }

      // Source-file diagnostics: only the few files intel flagged (cheap, precise).
      const usage = a.intel?.usage.find(
        (u) => u.packageId === report.package.id,
      );
      for (const stale of usage?.staleReExports ?? []) {
        const abs = join(report.package.root, stale.file);
        const srcText = safeRead(abs);
        if (srcText == null) continue;
        const rel = relative(report.package.root, abs).replace(/\\/g, "/");
        this.publish(
          abs,
          diagnosticsForSource(abs, a.intel, report.package.id, rel, srcText),
        );
      }
    }
  }

  private publish(file: string, descriptors: DiagnosticDescriptor[]): void {
    if (descriptors.length === 0) return;
    const diagnostics = descriptors.map((d) => {
      const diag = new vscode.Diagnostic(
        new vscode.Range(
          d.range.startLine,
          d.range.startCol,
          d.range.endLine,
          d.range.endCol,
        ),
        d.message,
        SEVERITY[d.severity],
      );
      diag.code = d.code;
      diag.source = d.source;
      return diag;
    });
    this.collection.set(vscode.Uri.file(file), diagnostics);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}

function safeRead(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}
