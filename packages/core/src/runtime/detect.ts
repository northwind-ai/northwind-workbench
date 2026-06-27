import type {
  PackageInfo,
  PackageManifest,
  PackageRuntime,
  RuntimeDetectionReport,
  RuntimeSignal,
  RuntimeTarget,
} from "@package-workbench/plugin-sdk";
import { exportsDotConditions } from "./resolve";

/**
 * Infer where a package is *meant* to run, from manifest + (optionally) source
 * signals, and how strongly the evidence agrees (a 0..1 confidence). This drives
 * which matrix cells are "intended" vs incidental.
 */

/** Dependency-name → runtime hints. First match wins per package. */
const DEP_HINTS: Array<{
  test: RegExp;
  points: PackageRuntime;
  weight: number;
  detail: string;
}> = [
  {
    test: /^electron$/,
    points: "electron",
    weight: 6,
    detail: "depends on electron",
  },
  {
    test: /^(next|nuxt|@remix-run\/)/,
    points: "universal",
    weight: 4,
    detail: "full-stack framework (SSR + browser)",
  },
  {
    test: /^(react|react-dom|vue|svelte|preact|solid-js|@angular\/core)$/,
    points: "browser",
    weight: 4,
    detail: "UI framework dependency",
  },
  {
    test: /^(express|koa|fastify|@nestjs\/core|hapi|@hapi\/hapi)$/,
    points: "node",
    weight: 4,
    detail: "server framework dependency",
  },
  {
    test: /^(commander|yargs|inquirer|ora|chalk)$/,
    points: "node",
    weight: 2,
    detail: "CLI tooling dependency",
  },
  {
    test: /^(@aws-sdk\/|pg|mysql2|mongodb|ioredis|better-sqlite3)/,
    points: "node",
    weight: 3,
    detail: "server/database dependency",
  },
];

const RUNTIME_BUCKETS: PackageRuntime[] = [
  "node",
  "browser",
  "electron",
  "edge",
  "universal",
];

function pushDepSignals(
  deps: Record<string, string>,
  kind: "dependencies" | "devDependencies",
  signals: RuntimeSignal[],
): void {
  const devWeight = kind === "devDependencies" ? 0.4 : 1;
  for (const name of Object.keys(deps)) {
    for (const hint of DEP_HINTS) {
      if (hint.test.test(name)) {
        signals.push({
          source: kind,
          points: hint.points,
          weight: hint.weight * devWeight,
          detail: `${name}: ${hint.detail}`,
        });
        break;
      }
    }
  }
}

/** Collect weighted runtime signals from the manifest alone. */
export function manifestSignals(m: PackageManifest): RuntimeSignal[] {
  const signals: RuntimeSignal[] = [];

  pushDepSignals(m.dependencies ?? {}, "dependencies", signals);
  pushDepSignals(m.devDependencies ?? {}, "devDependencies", signals);

  if (m.browser != null)
    signals.push({
      source: "browser-field",
      points: "browser",
      weight: 5,
      detail: '"browser" field present',
    });
  if (m.bin != null)
    signals.push({
      source: "bin-field",
      points: "node",
      weight: 4,
      detail: '"bin" field present (CLI)',
    });
  if (m.engines?.node)
    signals.push({
      source: "engines",
      points: "node",
      weight: 2,
      detail: `engines.node ${m.engines.node}`,
    });

  const dot = exportsDotConditions(m.exports);
  if (dot?.browser)
    signals.push({
      source: "exports",
      points: "browser",
      weight: 4,
      detail: 'exports has a "browser" condition',
    });
  if (dot?.node)
    signals.push({
      source: "exports",
      points: "node",
      weight: 3,
      detail: 'exports has a "node" condition',
    });
  const exportsJson = m.exports ? JSON.stringify(m.exports) : "";
  if (/"(worker|edge-light|deno)"/.test(exportsJson))
    signals.push({
      source: "exports",
      points: "edge",
      weight: 3,
      detail: "exports targets an edge/worker runtime",
    });

  const scriptBlob = Object.values(m.scripts ?? {}).join(" ");
  if (/\belectron\b/.test(scriptBlob))
    signals.push({
      source: "scripts",
      points: "electron",
      weight: 3,
      detail: "scripts invoke electron",
    });
  if (/\bnext\b/.test(scriptBlob))
    signals.push({
      source: "scripts",
      points: "universal",
      weight: 2,
      detail: "scripts invoke next",
    });

  return signals;
}

/** Signals derived from Node built-ins actually imported in source. */
export function builtinSignals(hardBuiltins: string[]): RuntimeSignal[] {
  if (hardBuiltins.length === 0) return [];
  return [
    {
      source: "imports",
      points: "node",
      weight: 3,
      detail: `imports Node built-ins (${hardBuiltins.slice(0, 4).join(", ")}${hardBuiltins.length > 4 ? "…" : ""})`,
    },
  ];
}

function esmCjsTargets(m: PackageManifest): { esm: boolean; cjs: boolean } {
  const exportsJson = m.exports ? JSON.stringify(m.exports) : "";
  const hasImportCond = /"import"/.test(exportsJson);
  const hasRequireCond = /"require"/.test(exportsJson);
  const esm =
    m.type === "module" ||
    typeof m.module === "string" ||
    hasImportCond ||
    /\.mjs"/.test(exportsJson);
  const cjs =
    m.type !== "module" || hasRequireCond || /\.cjs"/.test(exportsJson);
  // A package always supports at least the system its `type` implies.
  return { esm: esm || m.type === "module", cjs: cjs || m.type !== "module" };
}

/** Decide the concrete intended targets from the primary runtime + manifest. */
function intendedTargets(
  primary: PackageRuntime,
  m: PackageManifest,
  signals: RuntimeSignal[],
): RuntimeTarget[] {
  const targets = new Set<RuntimeTarget>();
  const { esm, cjs } = esmCjsTargets(m);

  const browserish =
    primary === "browser" ||
    primary === "universal" ||
    signals.some((s) => s.points === "browser");
  const nodeish =
    primary === "node" ||
    primary === "universal" ||
    primary === "electron" ||
    primary === "unknown" ||
    m.bin != null ||
    m.engines?.node != null ||
    !browserish;
  const electronish =
    primary === "electron" || signals.some((s) => s.points === "electron");

  if (nodeish) {
    if (esm) targets.add("node_esm");
    if (cjs) targets.add("node_cjs");
    if (!esm && !cjs) targets.add("node_cjs");
  }
  if (browserish) targets.add("browser");
  if (electronish) {
    targets.add("electron_main");
    targets.add("electron_renderer");
  }

  if (targets.size === 0) targets.add(esm ? "node_esm" : "node_cjs");
  return [...targets];
}

/** Full runtime detection. `hardBuiltins` are Node built-ins found in source (optional). */
export function detectRuntime(
  pkg: PackageInfo,
  hardBuiltins: string[] = [],
): RuntimeDetectionReport {
  const signals = [
    ...manifestSignals(pkg.manifest),
    ...builtinSignals(hardBuiltins),
  ];

  const weights = new Map<PackageRuntime, number>();
  for (const b of RUNTIME_BUCKETS) weights.set(b, 0);
  for (const s of signals)
    weights.set(s.points, (weights.get(s.points) ?? 0) + s.weight);

  let primary: PackageRuntime = "unknown";
  let top = 0;
  let total = 0;
  for (const [bucket, w] of weights) {
    total += w;
    if (w > top) {
      top = w;
      primary = bucket;
    }
  }

  // Confidence: how dominant the winner is, scaled down when evidence is thin.
  let confidence = total === 0 ? 0.1 : top / total;
  if (signals.length === 1) confidence = Math.min(confidence, 0.6);
  if (signals.length >= 3 && top / total > 0.6)
    confidence = Math.min(1, confidence + 0.1);
  confidence = Math.round(confidence * 100) / 100;

  // No signals at all but a manifest with entries → assume a universal library.
  if (
    primary === "unknown" &&
    (pkg.manifest.main || pkg.manifest.module || pkg.manifest.exports)
  ) {
    primary = "universal";
  }

  return {
    primary,
    intended: intendedTargets(primary, pkg.manifest, signals),
    confidence,
    signals,
  };
}
