import * as vscode from "vscode";
import type { AnalysisService } from "./analysis";
import { APPLY_FIX_COMMAND } from "./codeActions";

/**
 * The Package Workbench sidebar: Overview / Failures / Dependency Graph / Fixes.
 * A single generic tree provider renders plain `TreeNode` trees produced by pure
 * builder functions reading the cached analysis — so the views never re-derive
 * anything from core.
 */

export interface TreeNode {
  label: string;
  description?: string;
  tooltip?: string;
  icon?: string;
  command?: vscode.Command;
  contextValue?: string;
  children?: TreeNode[];
}

export class WorkbenchTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    TreeNode | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly build: () => TreeNode[]) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      node.label,
      node.children?.length
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None,
    );
    item.description = node.description;
    item.tooltip = node.tooltip;
    if (node.icon) item.iconPath = new vscode.ThemeIcon(node.icon);
    item.command = node.command;
    item.contextValue = node.contextValue;
    return item;
  }

  getChildren(node?: TreeNode): vscode.ProviderResult<TreeNode[]> {
    return node ? (node.children ?? []) : this.build();
  }
}

const openFile = (path: string): vscode.Command => ({
  command: "vscode.open",
  title: "Open",
  arguments: [vscode.Uri.file(path)],
});
const scoreIcon = (score: number): string =>
  score >= 80 ? "pass-filled" : score >= 60 ? "warning" : "error";

export function buildOverview(analysis: AnalysisService): TreeNode[] {
  const a = analysis.getAnalysis();
  if (!a)
    return [
      {
        label: "Not analyzed yet",
        description: 'Run "Analyze Workspace"',
        icon: "info",
      },
    ];
  const nodes: TreeNode[] = [];

  if (a.stack) {
    nodes.push({
      label: "Workspace",
      description: `${a.stack.detected.map((d) => d.adapter).join(" + ")} · ${a.stack.packageManager}`,
      icon: "tools",
    });
  }
  const s = a.run.summary;
  nodes.push({
    label: "Health",
    description: `${s.averageScore}/100 · ${s.passed} pass · ${s.warned} warn · ${s.failed} fail`,
    icon: "pulse",
  });

  const packages: TreeNode[] = [...a.run.reports]
    .sort((x, y) => x.score - y.score)
    .map((r) => ({
      label: r.package.name,
      description: `${r.score}/100`,
      icon: scoreIcon(r.score),
      tooltip: `${r.package.runtime} · ${r.status}`,
      command: openFile(r.package.packageJsonPath),
      contextValue: "pwPackage",
    }));
  nodes.push({
    label: "Packages",
    description: String(packages.length),
    children: packages,
  });
  return nodes;
}

export function buildFailures(analysis: AnalysisService): TreeNode[] {
  const a = analysis.getAnalysis();
  if (!a) return [{ label: "Not analyzed yet", icon: "info" }];
  const failing = a.run.reports.filter((r) =>
    r.checks.some((c) => c.status === "fail" || c.status === "warn"),
  );
  if (failing.length === 0) return [{ label: "No failures 🎉", icon: "pass" }];

  return failing.map((r) => ({
    label: r.package.name,
    description: `${r.checks.filter((c) => c.status === "fail").length} fail`,
    icon: "error",
    command: openFile(r.package.packageJsonPath),
    children: r.checks
      .filter((c) => c.status === "fail" || c.status === "warn")
      .map((c) => ({
        label: c.summary,
        description: c.checkId,
        icon: c.status === "fail" ? "error" : "warning",
        tooltip: c.details,
      })),
  }));
}

export function buildGraph(analysis: AnalysisService): TreeNode[] {
  const a = analysis.getAnalysis();
  if (!a?.graph) return [{ label: "Not analyzed yet", icon: "info" }];
  const g = a.graph;
  const nodes: TreeNode[] = [
    {
      label: "Graph health",
      description: `${g.health.score}/100 (${g.health.grade})`,
      icon: "pulse",
    },
  ];

  if (g.cycles.length) {
    nodes.push({
      label: "Cycles",
      description: String(g.cycles.length),
      icon: "error",
      children: g.cycles.map((c) => ({
        label: c.cycle.join(" → "),
        description: c.severity,
        icon: "circle-slash",
      })),
    });
  }
  if (g.violations.length) {
    nodes.push({
      label: "Boundary violations",
      description: String(g.violations.length),
      icon: "warning",
      children: g.violations.map((v) => ({
        label: `${v.from} → ${v.to}`,
        description: v.rule,
      })),
    });
  }
  const top = [...g.nodes]
    .sort((x, y) => y.metrics.fanIn - x.metrics.fanIn)
    .slice(0, 8);
  nodes.push({
    label: "Most depended-on",
    children: top.map((n) => ({
      label: n.name,
      description: `${n.metrics.fanIn} in / ${n.metrics.fanOut} out`,
    })),
  });
  return nodes;
}

export function buildFixes(analysis: AnalysisService): TreeNode[] {
  const a = analysis.getAnalysis();
  if (!a) return [{ label: "Not analyzed yet", icon: "info" }];
  const { candidates, summary } = a.fixPlan;
  if (candidates.length === 0)
    return [{ label: "No fixable issues", icon: "pass" }];

  const group = (
    safety: "safe" | "review_required" | "dangerous",
    label: string,
    icon: string,
  ): TreeNode | null => {
    const items = candidates.filter((c) => c.safety === safety);
    if (items.length === 0) return null;
    return {
      label,
      description: String(items.length),
      icon,
      children: items.map((c) => ({
        label: c.title,
        description: c.problem,
        tooltip: c.description,
        icon:
          safety === "safe"
            ? "check"
            : safety === "review_required"
              ? "eye"
              : "circle-slash",
        contextValue: safety === "dangerous" ? "pwFixSuggest" : "pwFixApply",
        command:
          safety === "dangerous"
            ? undefined
            : { command: APPLY_FIX_COMMAND, title: "Apply", arguments: [c] },
      })),
    };
  };

  return [
    `${summary.safe} safe · ${summary.reviewRequired} review · ${summary.dangerous} suggest-only`,
  ]
    .map((label) => ({ label, icon: "wrench" }) as TreeNode)
    .concat(
      [
        group("safe", "Safe (click to apply)", "check"),
        group("review_required", "Review required", "eye"),
        group("dangerous", "Suggest-only", "circle-slash"),
      ].filter(Boolean) as TreeNode[],
    );
}
