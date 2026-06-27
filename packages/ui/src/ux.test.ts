import { describe, expect, it } from "vitest";
import {
  assemblePackageInfo,
  buildReport,
  type HealthCheckResult,
  type PackageHealthReport,
} from "@package-workbench/core";
import { fuzzyMatch, fuzzyRank } from "./fuzzy";
import { explainFailure } from "./errors";
import {
  applyFilters,
  countActiveFilters,
  emptyFilter,
  matchesQuery,
} from "./filter";
import { appReducer, canTransition, initialAppState } from "./appState";
import { filterCommands, groupCommands, type Command } from "./commands";
import { nextThemePreference, resolveTheme } from "./theme";

// ---- fuzzy ------------------------------------------------------------------

describe("fuzzyMatch", () => {
  it("matches a subsequence and records indices", () => {
    const m = fuzzyMatch("rsw", "Rescan Workspace");
    expect(m).not.toBeNull();
    expect(m!.indices.length).toBe(3);
  });
  it("returns null when characters are missing/out of order", () => {
    expect(fuzzyMatch("zzz", "Open Repository")).toBeNull();
  });
  it("ranks boundary + contiguous matches higher", () => {
    const ranked = fuzzyRank(
      "graph",
      ["Open Dependency Graph", "paragraph helper"],
      (s) => s,
    );
    expect(ranked[0]!.item).toBe("Open Dependency Graph");
  });
  it("empty query matches everything", () => {
    expect(fuzzyMatch("", "anything")).toEqual({ score: 0, indices: [] });
  });
});

// ---- errors -----------------------------------------------------------------

function check(
  checkId: string,
  summary: string,
  extra: Partial<HealthCheckResult> = {},
): HealthCheckResult {
  return {
    checkId,
    label: checkId,
    status: "fail",
    severity: "high",
    summary,
    ...extra,
  };
}

describe("explainFailure", () => {
  it("suggests an install for a missing dependency", () => {
    const e = explainFailure(
      check(
        "runtime_import_check",
        "MISSING_DEPENDENCY: Cannot find package 'zod'",
        { details: "Missing module: zod" },
      ),
      "pnpm",
    );
    expect(e.type).toBe("Missing dependency");
    expect(e.likelyFix).toBe("pnpm add zod");
  });
  it("uses the right package manager", () => {
    const e = explainFailure(
      check("missing_peer_dependencies", "1 peer not resolvable", {
        evidence: ["react@^18"],
      }),
      "npm",
    );
    expect(e.likelyFix).toBe("npm install react");
  });
  it("explains an entry-not-found as a build issue", () => {
    const e = explainFailure(
      check("module_resolution_check", "1/1 declared target(s) do not resolve"),
    );
    expect(e.type).toBe("Entry not found");
    expect(e.likelyFix).toMatch(/build/i);
  });
});

// ---- filtering --------------------------------------------------------------

function report(
  name: string,
  score: number,
  status: PackageHealthReport["status"],
  deps: Record<string, string> = {},
): PackageHealthReport {
  const pkg = assemblePackageInfo({
    root: `/${name}`,
    packageJsonPath: `/${name}/package.json`,
    manifest: { name, version: "1.0.0", dependencies: deps },
  });
  const r = buildReport(
    pkg,
    [
      {
        checkId: "x",
        label: "x",
        status: status === "pass" ? "pass" : "fail",
        severity: "high",
        summary: "boom zod",
      },
    ],
    "T",
  );
  return { ...r, score, status };
}

describe("filtering", () => {
  const reports = [
    report("@x/a", 90, "pass", { lodash: "^4" }),
    report("@x/b", 40, "fail"),
    report("@x/c", 75, "warn"),
  ];

  it("filters by status", () => {
    expect(
      applyFilters(reports, { ...emptyFilter, status: "failing" }).map(
        (r) => r.package.name,
      ),
    ).toEqual(["@x/b"]);
  });
  it("filters by score range", () => {
    expect(applyFilters(reports, { ...emptyFilter, minScore: 70 }).length).toBe(
      2,
    );
  });
  it("searches dependency names", () => {
    expect(matchesQuery(reports[0]!, "lodash")).toBe(true);
    expect(matchesQuery(reports[1]!, "lodash")).toBe(false);
  });
  it("searches failure messages", () => {
    expect(applyFilters(reports, { ...emptyFilter, query: "zod" }).length).toBe(
      2,
    ); // b + c have fail checks
  });
  it("counts active filters", () => {
    expect(
      countActiveFilters({
        ...emptyFilter,
        status: "failing",
        runtimeFailures: true,
      }),
    ).toBe(2);
  });
});

// ---- state machine ----------------------------------------------------------

describe("appReducer", () => {
  it("walks the happy path idle → scanning → ready", () => {
    let s = initialAppState;
    s = appReducer(s, { type: "SCAN_START" });
    expect(s.status).toBe("scanning");
    s = appReducer(s, { type: "SCAN_DONE" });
    expect(s.status).toBe("ready");
  });
  it("captures errors and recovers", () => {
    let s = appReducer(
      { status: "scanning", error: null },
      { type: "SCAN_ERROR", message: "nope" },
    );
    expect(s.status).toBe("error");
    expect(s.error).toBe("nope");
    s = appReducer(s, { type: "SCAN_START" });
    expect(s.status).toBe("scanning");
  });
  it("ignores illegal transitions", () => {
    const s = appReducer(initialAppState, { type: "RUN_DONE" });
    expect(s.status).toBe("idle");
  });
  it("reports legality", () => {
    expect(canTransition("ready", "RUN_START")).toBe(true);
    expect(canTransition("idle", "RUN_START")).toBe(false);
  });
});

// ---- commands ---------------------------------------------------------------

describe("commands", () => {
  const noop = () => {};
  const cmds: Command[] = [
    { id: "open", title: "Open Repository", group: "Actions", run: noop },
    {
      id: "graph",
      title: "Open Dependency Graph",
      group: "Navigation",
      keywords: ["deps"],
      run: noop,
    },
    {
      id: "theme",
      title: "Toggle Theme",
      group: "View",
      run: noop,
      disabled: true,
    },
  ];
  it("fuzzy-filters and drops disabled commands", () => {
    expect(cmds.filter((c) => !c.disabled).length).toBe(2);
    expect(filterCommands(cmds, "graph")[0]!.id).toBe("graph");
    expect(filterCommands(cmds, "").every((c) => !c.disabled)).toBe(true);
  });
  it("groups commands in a stable order", () => {
    const groups = groupCommands(filterCommands(cmds, ""));
    expect(groups[0]!.group).toBe("Actions");
  });
});

// ---- theme ------------------------------------------------------------------

describe("theme", () => {
  it("resolves system to the OS preference", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
  it("cycles light → dark → system", () => {
    expect(nextThemePreference("light")).toBe("dark");
    expect(nextThemePreference("dark")).toBe("system");
    expect(nextThemePreference("system")).toBe("light");
  });
});
