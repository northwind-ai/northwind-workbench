import type {
  FailureAnalysisInput,
  FailureCategory,
  FailureKind,
} from "./types";

/**
 * Deterministic failure classification. Maps a normalized failure onto a
 * (category, kind) pair using — in priority order — its structured signals, its
 * originating check id, then text patterns. Pure: same input → same class.
 *
 * Signals are trusted first because the normalizer extracts them from the
 * richest available source (e.g. the runtime engine's `failureClass`), so text
 * matching is only a fallback for crash logs and unstructured sources.
 */

export interface Classification {
  category: FailureCategory;
  kind: FailureKind;
}

const CATEGORY_OF: Record<FailureKind, FailureCategory> = {
  missing_dependency: "dependency",
  peer_mismatch: "dependency",
  version_conflict: "dependency",
  esm_cjs_mismatch: "module",
  broken_exports: "module",
  import_failure: "module",
  circular_dependency: "architecture",
  boundary_violation: "architecture",
  overcoupling: "architecture",
  runtime_exception: "runtime",
  timeout: "runtime",
  memory_spike: "runtime",
  missing_build_artifact: "build",
  ts_compile_failure: "build",
  env_missing: "infra",
  config_invalid: "infra",
  unknown: "unknown",
};

/** Resolve the family for a kind (single source of truth). */
export function categoryOf(kind: FailureKind): FailureCategory {
  return CATEGORY_OF[kind];
}

const FAILURE_CLASS_KIND: Record<string, FailureKind> = {
  MISSING_DEPENDENCY: "missing_dependency",
  ESM_CJS_MISMATCH: "esm_cjs_mismatch",
  EXPORT_RESOLUTION_FAILURE: "broken_exports",
  IMPORT_RESOLUTION_FAILURE: "missing_build_artifact",
  SYNTAX_FAILURE: "ts_compile_failure",
  RUNTIME_EXCEPTION: "runtime_exception",
};

const CHECK_KIND: Record<string, FailureKind> = {
  missing_peer_dependencies: "peer_mismatch",
  dependency_version_shape: "version_conflict",
  exports_map_check: "broken_exports",
  module_resolution_check: "missing_build_artifact",
  main_module_exists: "missing_build_artifact",
  entrypoint_exists: "missing_build_artifact",
  types_entry_exists: "missing_build_artifact",
  browser_compatibility_check: "import_failure",
  package_json_valid: "config_invalid",
  scenario_runner_check: "runtime_exception",
};

/** Ordered text probes — first match wins. Used only as a last resort. */
const TEXT_PROBES: Array<[RegExp, FailureKind]> = [
  [
    /cannot find (?:module|package)|module not found|MODULE_NOT_FOUND/i,
    "missing_dependency",
  ],
  [/peer dep|unmet peer|peerDependenc/i, "peer_mismatch"],
  [
    /ERR_REQUIRE_ESM|cannot use import statement|require\(\) of ES Module|exports is not defined|__dirname is not defined/i,
    "esm_cjs_mismatch",
  ],
  [/circular|cycle|dependency cycle/i, "circular_dependency"],
  [/boundary|may not depend on|forbidden dependency/i, "boundary_violation"],
  [/exports\b.*(map|field)|ERR_PACKAGE_PATH_NOT_EXPORTED/i, "broken_exports"],
  [/timed? ?out|timeout|ETIMEDOUT/i, "timeout"],
  [/heap out of memory|allocation failed|memory/i, "memory_spike"],
  [/TS\d{3,5}|type error|is not assignable|tsc/i, "ts_compile_failure"],
  [
    /no such file|ENOENT|not built|missing.*(dist|build|artifact)/i,
    "missing_build_artifact",
  ],
  [/env(?:ironment)? var|process\.env|is not set|is required/i, "env_missing"],
  [/invalid (?:config|json)|failed to parse|SyntaxError/i, "config_invalid"],
  [
    /version (?:conflict|mismatch)|incompatible version|ERESOLVE/i,
    "version_conflict",
  ],
];

/** Classify a normalized failure into (category, kind). Never throws. */
export function classifyFailure(input: FailureAnalysisInput): Classification {
  const s = input.context.signals ?? {};

  // 1) Structured signals — the most trustworthy.
  if (s.cyclePath && s.cyclePath.length > 0) return wrap("circular_dependency");
  if (s.boundary) return wrap("boundary_violation");
  if (s.envVar) return wrap("env_missing");
  if (s.missingModule) return wrap("missing_dependency");
  if (s.unresolvedPeers && s.unresolvedPeers.length > 0)
    return wrap("peer_mismatch");
  if (s.nodeBuiltins && s.nodeBuiltins.length > 0)
    return wrap("import_failure");
  if (
    typeof s.durationMs === "number" &&
    (s.failureClass === "TIMEOUT" || /timeout/i.test(input.title))
  )
    return wrap("timeout");
  if (
    typeof s.memoryBytes === "number" &&
    s.memoryBytes > 0 &&
    /memory/i.test(input.title)
  )
    return wrap("memory_spike");
  if (s.failureClass && FAILURE_CLASS_KIND[s.failureClass])
    return wrap(FAILURE_CLASS_KIND[s.failureClass]!);
  if (s.unresolvedEntries && s.unresolvedEntries.length > 0)
    return wrap("missing_build_artifact");

  // 2) Originating check id.
  const byCheck = input.context.checkId
    ? CHECK_KIND[input.context.checkId]
    : undefined;
  if (byCheck) return wrap(byCheck);

  // 3) Text patterns over title + detail + evidence.
  const haystack = [
    input.title,
    input.detail ?? "",
    ...(input.context.evidence ?? []),
  ].join("\n");
  for (const [re, kind] of TEXT_PROBES) {
    if (re.test(haystack)) return wrap(kind);
  }

  return wrap("unknown");
}

function wrap(kind: FailureKind): Classification {
  return { category: categoryOf(kind), kind };
}
