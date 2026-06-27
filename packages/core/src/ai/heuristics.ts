import type { PackageManager } from "@package-workbench/plugin-sdk";
import { classifyFailure } from "./classify";
import type {
  Evidence,
  FailureAnalysisInput,
  FailureKind,
  FixSuggestion,
  RootCauseHypothesis,
  ValidationStep,
} from "./types";

/**
 * The deterministic root-cause engine. Given a normalized failure it produces
 * one or more ranked {@link RootCauseHypothesis} — each with the concrete
 * evidence behind it, a confidence derived from how strong that evidence is, the
 * steps to validate it, and prioritized fast + structural fixes.
 *
 * This is the *required* offline brain of the assistant. It never invents
 * confidence: a hypothesis built from a hard signal (an extracted module name, a
 * cycle path) scores high; one built only from a check id or loose text scores
 * low and says so. No network, no model, fully reproducible.
 */

// ---- Confidence vocabulary ---------------------------------------------------

/**
 * Calibrated confidence bands. We deliberately keep them coarse and honest:
 *  - `certain`  — a hard structural signal pins the cause (e.g. the missing
 *                 module name was extracted from the error).
 *  - `likely`   — strong signal but some ambiguity remains.
 *  - `plausible`— classified by check id / one weak signal.
 *  - `weak`     — only loose text matching; we say so.
 */
const CONFIDENCE = {
  certain: 0.94,
  likely: 0.8,
  plausible: 0.6,
  weak: 0.35,
} as const;

// ---- Package-manager-aware commands -----------------------------------------

function addCmd(
  pm: PackageManager | undefined,
  pkgs: string[],
  filter?: string,
): string {
  const list = pkgs.join(" ");
  switch (pm) {
    case "npm":
      return `npm install ${list}${filter ? ` -w ${filter}` : ""}`;
    case "yarn":
      return `yarn${filter ? ` workspace ${filter}` : ""} add ${list}`;
    case "bun":
      return `bun add ${list}`;
    default:
      return `pnpm add ${list}${filter ? ` --filter ${filter}` : ""}`;
  }
}

function installCmd(pm: PackageManager | undefined): string {
  return pm === "npm"
    ? "npm install"
    : pm === "yarn"
      ? "yarn install"
      : pm === "bun"
        ? "bun install"
        : "pnpm install";
}

function buildCmd(pm: PackageManager | undefined, filter?: string): string {
  if (filter && pm === "pnpm") return `pnpm --filter ${filter} build`;
  if (filter && pm === "npm") return `npm run build -w ${filter}`;
  return pm === "npm"
    ? "npm run build"
    : pm === "yarn"
      ? "yarn build"
      : pm === "bun"
        ? "bun run build"
        : "pnpm build";
}

// ---- Evidence helpers --------------------------------------------------------

/** Cite the first N evidence lines, tagged with provenance. */
function citeEvidence(
  input: FailureAnalysisInput,
  source = "check",
  limit = 4,
): Evidence[] {
  const lines = (input.context.evidence ?? [])
    .filter((l) => l.trim().length > 0)
    .slice(0, limit);
  return lines.map((text) => ({ source, text }));
}

function cite(source: string, text: string): Evidence {
  return { source, text };
}

// ---- The per-kind hypothesis builders ---------------------------------------

type Builder = (
  input: FailureAnalysisInput,
) => RootCauseHypothesis | RootCauseHypothesis[] | null;

const BUILDERS: Partial<Record<FailureKind, Builder>> = {
  missing_dependency: (input) => {
    const mod = input.context.signals?.missingModule;
    const pm = input.context.packageManager;
    const pkg = input.context.packageName;
    const evidence: Evidence[] = [];
    if (mod)
      evidence.push(cite("signal", `Unresolved module specifier: ${mod}`));
    evidence.push(...citeEvidence(input, "stack"));
    const fixes: FixSuggestion[] = mod
      ? [
          {
            kind: "fast",
            title: `Declare and install ${mod}`,
            command: addCmd(pm, [mod], pkg),
            priority: 100,
          },
          {
            kind: "structural",
            title:
              "Add the import to this package's dependencies in package.json",
            detail: `Add "${mod}" to "dependencies" so the requirement travels with the package, not just the lockfile.`,
            files: ["package.json"],
            priority: 60,
          },
        ]
      : [
          {
            kind: "fast",
            title: "Reinstall workspace dependencies",
            command: installCmd(pm),
            priority: 70,
          },
        ];
    return {
      ...base("missing_dependency", input),
      cause: mod
        ? `${pkg ?? "The package"} imports ${mod} but does not declare it as a dependency.`
        : "The package imports a module that is not installed or declared.",
      rationale:
        "This commonly occurs after moving validation/util logic across package boundaries: the import survives but the dependency declaration is left behind in the original package.",
      evidence,
      confidence: CONFIDENCE[mod ? "certain" : "plausible"],
      validation: [
        mod
          ? step(
              `Confirm the import exists`,
              `grep -rn "${mod}" ${relSrc(input)}`,
            )
          : step("Inspect the failing import in the stack trace"),
        step(
          "Confirm it is absent from package.json",
          `node -e "console.log(require('./package.json').dependencies?.['${mod ?? "<pkg>"}'] ?? 'NOT DECLARED')"`,
        ),
      ],
      fixes,
    };
  },

  peer_mismatch: (input) => {
    const peers = input.context.signals?.unresolvedPeers ?? [];
    const pm = input.context.packageManager;
    const names = peers.map((p) => p.split("@")[0]!).filter(Boolean);
    return {
      ...base("peer_mismatch", input),
      cause: peers.length
        ? `Required peer dependenc${peers.length > 1 ? "ies" : "y"} ${peers.join(", ")} ${peers.length > 1 ? "are" : "is"} not resolvable where this package is consumed.`
        : "A required peer dependency is unmet.",
      rationale:
        "Peers are provided by the consumer, not bundled. A version range that the host app does not satisfy (or simply has not installed) surfaces here.",
      evidence: peers.length
        ? peers.map((p) => cite("signal", `Unresolved peer: ${p}`))
        : citeEvidence(input),
      confidence: CONFIDENCE[peers.length ? "likely" : "plausible"],
      validation: [
        step(
          "Check the installed version against the required range",
          names[0]
            ? `${pm === "pnpm" ? "pnpm" : "npm"} why ${names[0]}`
            : "pnpm why <peer>",
        ),
      ],
      fixes: [
        names.length
          ? {
              kind: "fast",
              title: `Install the peer(s) in the consuming app`,
              command: addCmd(pm, names),
              priority: 90,
            }
          : null,
        {
          kind: "structural",
          title: "Widen or correct the peerDependencies range",
          detail:
            "If the peer is genuinely compatible, broaden the range in package.json; if not, pin the consumer to a supported version.",
          files: ["package.json"],
          priority: 50,
        },
      ].filter(Boolean) as FixSuggestion[],
    };
  },

  version_conflict: (input) => ({
    ...base("version_conflict", input),
    cause: "Two packages require incompatible versions of the same dependency.",
    rationale:
      "Divergent version ranges across the workspace force the resolver to keep multiple copies — or fail outright (ERESOLVE).",
    evidence: citeEvidence(input),
    confidence: CONFIDENCE.plausible,
    validation: [
      step(
        "Inspect who requires the conflicting versions",
        "pnpm why <dependency>",
      ),
    ],
    fixes: [
      {
        kind: "fast",
        title: "Dedupe the dependency",
        command:
          input.context.packageManager === "npm" ? "npm dedupe" : "pnpm dedupe",
        priority: 70,
      },
      {
        kind: "structural",
        title: "Align version ranges across packages",
        detail:
          "Pin the shared dependency to a single range (or hoist it to the root) so every package agrees.",
        files: ["package.json"],
        priority: 60,
      },
    ],
  }),

  esm_cjs_mismatch: (input) => ({
    ...base("esm_cjs_mismatch", input),
    cause:
      "The module system declared in package.json does not match how the code is written or consumed.",
    rationale:
      'A `"type": "module"` package with CommonJS code (or vice-versa), or an ESM-only dependency required from CJS, throws ERR_REQUIRE_ESM / "Cannot use import statement".',
    evidence: [
      ...(input.context.signals?.moduleType
        ? [
            cite(
              "manifest",
              `package.json "type": "${input.context.signals.moduleType}"`,
            ),
          ]
        : []),
      ...citeEvidence(input, "stack"),
    ],
    confidence:
      CONFIDENCE[
        input.context.signals?.failureClass === "ESM_CJS_MISMATCH"
          ? "likely"
          : "plausible"
      ],
    validation: [
      step(
        "Confirm the declared module type",
        `node -e "console.log(require('./package.json').type ?? 'commonjs')"`,
      ),
      step("Check the offending file's syntax matches that type"),
    ],
    fixes: [
      {
        kind: "fast",
        title: 'Align "type" and file extensions',
        detail:
          'Set package.json "type" to match the code, or rename files to .mjs/.cjs to be explicit.',
        files: ["package.json"],
        priority: 80,
      },
      {
        kind: "structural",
        title: "Ship dual exports",
        detail:
          'Provide both import and require conditions in the "exports" map so either consumer works.',
        files: ["package.json"],
        priority: 55,
      },
    ],
  }),

  broken_exports: (input) => ({
    ...base("broken_exports", input),
    cause:
      'The package.json "exports" map is malformed or points at files that do not exist.',
    rationale:
      'A subpath or condition in "exports" resolves to a missing target, so Node refuses the import even when the file is built.',
    evidence: citeEvidence(input),
    confidence: CONFIDENCE.likely,
    validation: [
      step(
        "List declared export targets and check each exists",
        `node -e "console.log(JSON.stringify(require('./package.json').exports, null, 2))"`,
      ),
    ],
    fixes: [
      {
        kind: "fast",
        title: 'Fix the "exports" targets',
        detail:
          "Point every condition (import/require/types) at a file that exists after build.",
        files: ["package.json"],
        priority: 85,
      },
      {
        kind: "structural",
        title: "Add a CI check that resolves every export",
        detail:
          "Run module-resolution validation in CI so a broken exports map fails fast.",
        priority: 40,
      },
    ],
  }),

  import_failure: (input) => {
    const builtins = input.context.signals?.nodeBuiltins ?? [];
    return {
      ...base("import_failure", input),
      cause: builtins.length
        ? `Source uses Node built-in(s) (${builtins.join(", ")}) that do not exist in the target environment.`
        : "An import could not be loaded in the target environment.",
      rationale:
        "Browser/edge targets have no Node core modules; importing one (directly or transitively) breaks at load time.",
      evidence: builtins.length
        ? builtins.map((b) => cite("signal", `Node built-in used: ${b}`))
        : citeEvidence(input),
      confidence: CONFIDENCE[builtins.length ? "likely" : "plausible"],
      validation: [
        step(
          "Find where the built-in is imported",
          builtins[0]
            ? `grep -rn "${builtins[0]}" ${relSrc(input)}`
            : undefined,
        ),
      ],
      fixes: [
        {
          kind: "fast",
          title: "Guard or polyfill the Node-only code path",
          detail:
            'Gate Node built-ins behind a runtime check, or provide a browser-safe implementation via the "browser" field/conditional export.',
          priority: 75,
        },
        {
          kind: "structural",
          title: "Split platform-specific code",
          detail:
            "Extract Node-only logic into a separate entry so browser bundles never reach it.",
          priority: 50,
        },
      ],
    };
  },

  circular_dependency: (input) => {
    const path = input.context.signals?.cyclePath ?? [];
    const weakest =
      path.length >= 2 ? `${path[path.length - 1]} → ${path[0]}` : undefined;
    return {
      ...base("circular_dependency", input),
      cause: path.length
        ? `Packages form a dependency cycle: ${path.join(" → ")}${path.length > 1 ? " → " + path[0] : ""}.`
        : "A circular dependency was introduced between packages.",
      rationale:
        'Cycles make load order undefined and break incremental builds. They usually appear when a shared type or helper is imported "back up" the layering.',
      evidence: path.length
        ? [cite("graph", `Cycle: ${path.join(" → ")}`)]
        : citeEvidence(input, "graph"),
      confidence: CONFIDENCE[path.length ? "certain" : "plausible"],
      validation: [
        step(
          "Confirm the cycle and find the back-edge",
          "package-workbench graph . --pretty",
        ),
      ],
      fixes: [
        weakest
          ? {
              kind: "structural",
              title: `Break the back-edge ${weakest}`,
              detail: `Invert the dependency: extract the shared piece into a lower-level package both can depend on, or move the import.`,
              priority: 90,
            }
          : {
              kind: "structural",
              title: "Break the cycle by extracting shared code",
              priority: 90,
            },
        {
          kind: "fast",
          title: "Use a type-only import if it is only types",
          detail:
            "If the back-edge is purely types, `import type { … }` erases the runtime edge that forms the cycle.",
          priority: 65,
        },
      ],
    };
  },

  boundary_violation: (input) => {
    const b = input.context.signals?.boundary;
    return {
      ...base("boundary_violation", input),
      cause: b
        ? `${b.from} depends on ${b.to}, which the architecture rule "${b.rule}" forbids.`
        : "A dependency crosses a forbidden architectural boundary.",
      rationale:
        "Layering rules keep low-level packages from reaching into higher-level ones. A new import that violates a rule erodes the architecture.",
      evidence: b
        ? [cite("graph", `${b.from} → ${b.to} (rule: ${b.rule})`)]
        : citeEvidence(input, "graph"),
      confidence: CONFIDENCE[b ? "likely" : "plausible"],
      validation: [
        step(
          "Locate the offending import",
          b ? `grep -rn "${b.to}" ${b.from}/src` : undefined,
        ),
      ],
      fixes: [
        {
          kind: "structural",
          title: "Remove or invert the forbidden dependency",
          detail: b
            ? `Move the shared code so ${b.from} no longer needs to import ${b.to}, or route through an allowed package.`
            : "Re-route the dependency through an allowed package.",
          priority: 85,
        },
        {
          kind: "fast",
          title: "Confirm the rule is still intended",
          detail:
            "If the boundary is outdated, update the rule in workbench.config — but prefer fixing the code.",
          priority: 30,
        },
      ],
    };
  },

  overcoupling: (input) => ({
    ...base("overcoupling", input),
    cause:
      "A package has an unusually high number of dependents or dependencies (a coupling hotspot).",
    rationale:
      "High fan-in/fan-out concentrates risk: any change ripples widely and the package becomes hard to evolve.",
    evidence: citeEvidence(input, "graph"),
    confidence: CONFIDENCE.plausible,
    validation: [
      step(
        "Inspect the package's centrality and dependents",
        "package-workbench graph . --pretty",
      ),
    ],
    fixes: [
      {
        kind: "structural",
        title: "Split the package along its seams",
        detail:
          "Extract cohesive subsets so consumers depend only on what they use.",
        priority: 60,
      },
    ],
  }),

  runtime_exception: (input) => {
    const errType = input.context.signals?.errorType;
    const file = input.context.signals?.offendingFile;
    return {
      ...base("runtime_exception", input),
      cause: errType
        ? `The module threw a ${errType} while executing.`
        : "The module threw while its top-level (or scenario) code ran.",
      rationale:
        "The package loads but fails when exercised — a logic error, a bad assumption about input, or an unhandled edge case.",
      evidence: [
        ...(file ? [cite("stack", `Offending file: ${file}`)] : []),
        ...citeEvidence(input, "stack"),
      ],
      confidence: CONFIDENCE[errType ? "likely" : "plausible"],
      validation: [
        step(
          file
            ? `Open ${file} at the throwing frame`
            : "Open the throwing frame from the stack trace",
        ),
      ],
      fixes: [
        {
          kind: "fast",
          title: "Add a guard / fix the throwing code path",
          files: file ? [file] : undefined,
          priority: 70,
        },
        {
          kind: "structural",
          title: "Add a scenario reproducing this input",
          detail:
            "Lock the fix in with a smoke-test scenario so it cannot regress.",
          priority: 45,
        },
      ],
    };
  },

  timeout: (input) => ({
    ...base("timeout", input),
    cause: `Execution exceeded its time budget${input.context.signals?.durationMs ? ` (${input.context.signals.durationMs}ms)` : ""}.`,
    rationale:
      "A scenario or import hung — often an un-awaited promise, a real network/IO call, or an infinite loop.",
    evidence: citeEvidence(input),
    confidence: CONFIDENCE.plausible,
    validation: [
      step(
        "Re-run with a higher timeout to confirm it completes, then profile the slow path",
      ),
    ],
    fixes: [
      {
        kind: "fast",
        title: "Mock external IO in the scenario",
        detail:
          "Scenarios should not hit the network; stub it so timing is deterministic.",
        priority: 65,
      },
      {
        kind: "structural",
        title: "Fix the un-awaited / unbounded operation",
        priority: 60,
      },
    ],
  }),

  memory_spike: (input) => ({
    ...base("memory_spike", input),
    cause: `Execution allocated an abnormal amount of memory${input.context.signals?.memoryBytes ? ` (${Math.round((input.context.signals.memoryBytes ?? 0) / 1e6)}MB)` : ""}.`,
    rationale:
      "A leak or an unbounded buffer — accumulating in a loop, retaining large objects, or loading everything into memory at once.",
    evidence: citeEvidence(input),
    confidence: CONFIDENCE.plausible,
    validation: [
      step(
        "Profile the heap during the scenario (node --inspect / --heap-prof)",
      ),
    ],
    fixes: [
      {
        kind: "structural",
        title: "Stream or bound the allocation",
        detail: "Process data incrementally instead of buffering it all.",
        priority: 60,
      },
    ],
  }),

  missing_build_artifact: (input) => {
    const entries = input.context.signals?.unresolvedEntries ?? [];
    const pm = input.context.packageManager;
    const pkg = input.context.packageName;
    return {
      ...base("missing_build_artifact", input),
      cause: entries.length
        ? `Declared entr${entries.length > 1 ? "ies" : "y"} (${entries.join(", ")}) point at files that do not exist.`
        : "A declared entry point resolves to a missing file — the package was likely not built.",
      rationale:
        "package.json points at compiled output (e.g. dist/index.js) that has not been produced yet, so consumers cannot resolve it.",
      evidence: entries.length
        ? entries.map((e) => cite("manifest", `Declared but missing: ${e}`))
        : citeEvidence(input),
      confidence: CONFIDENCE[entries.length ? "likely" : "plausible"],
      validation: [
        step(
          "Confirm the output is absent",
          entries[0]
            ? `ls ${entries[0]} || echo MISSING`
            : "ls dist || echo MISSING",
        ),
      ],
      fixes: [
        {
          kind: "fast",
          title: "Build the package",
          command: buildCmd(pm, pkg),
          priority: 90,
        },
        {
          kind: "structural",
          title:
            "Ensure the build runs before consumers in CI / turbo pipeline",
          detail:
            "Add a build dependency so artifacts always exist before resolution checks.",
          priority: 50,
        },
      ],
    };
  },

  ts_compile_failure: (input) => ({
    ...base("ts_compile_failure", input),
    cause:
      "TypeScript failed to compile (a type error or a syntax error in the source).",
    rationale:
      "A type mismatch or parse error stops the build; downstream artifacts never get produced.",
    evidence: citeEvidence(input),
    confidence: CONFIDENCE.plausible,
    validation: [step("Reproduce the exact diagnostic", "tsc --noEmit")],
    fixes: [
      {
        kind: "fast",
        title: "Fix the reported type/syntax error",
        priority: 80,
      },
    ],
  }),

  env_missing: (input) => {
    const v = input.context.signals?.envVar;
    return {
      ...base("env_missing", input),
      cause: v
        ? `Environment variable ${v} is referenced but not set.`
        : "A required environment variable is missing.",
      rationale:
        "Config is read from the environment; an unset variable surfaces as a crash or a misconfiguration at startup.",
      evidence: v
        ? [cite("signal", `Referenced env var: ${v}`)]
        : citeEvidence(input),
      confidence: CONFIDENCE[v ? "likely" : "plausible"],
      validation: [
        step(
          "Confirm it is unset",
          v
            ? `node -e "console.log(process.env.${v} ?? 'UNSET')"`
            : "printenv | grep <VAR>",
        ),
      ],
      fixes: [
        {
          kind: "fast",
          title: v
            ? `Set ${v} (locally and in CI secrets)`
            : "Set the required variable",
          detail: v
            ? `Add ${v} to .env for local dev and to the CI/CD secret store.`
            : undefined,
          files: [".env"],
          priority: 85,
        },
        {
          kind: "structural",
          title: "Validate required env at startup",
          detail:
            "Fail fast with a clear message listing all missing variables instead of crashing deep in the code.",
          priority: 50,
        },
      ],
    };
  },

  config_invalid: (input) => ({
    ...base("config_invalid", input),
    cause:
      input.context.checkId === "package_json_valid"
        ? "package.json is missing or contains invalid JSON."
        : "A configuration file is malformed.",
    rationale:
      "A parse error in config makes every downstream check unreliable, so it is reported first.",
    evidence: citeEvidence(input),
    confidence: CONFIDENCE.likely,
    validation: [
      step(
        "Validate the JSON",
        `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"`,
      ),
    ],
    fixes: [
      {
        kind: "fast",
        title: "Fix the JSON syntax",
        files: ["package.json"],
        priority: 95,
      },
    ],
  }),
};

// ---- Generic fallback --------------------------------------------------------

function fallback(input: FailureAnalysisInput): RootCauseHypothesis {
  return {
    ...base("unknown", input),
    cause: input.detail ?? input.title,
    rationale:
      "No high-confidence pattern matched. The explanation below is summarized directly from the failure, with low confidence — treat it as a starting point, not a diagnosis.",
    evidence: citeEvidence(input),
    confidence: CONFIDENCE.weak,
    validation: [
      step("Read the raw evidence and reproduce the failure locally"),
    ],
    fixes: [],
  };
}

// ---- Builders shared scaffolding --------------------------------------------

function base(
  kind: FailureKind,
  input: FailureAnalysisInput,
): Pick<RootCauseHypothesis, "category" | "kind"> {
  const c = classifyFailure(input);
  // The builder declares its own kind; the category follows that kind.
  return { category: categoryFor(kind) ?? c.category, kind };
}

function categoryFor(
  kind: FailureKind,
): RootCauseHypothesis["category"] | null {
  // Local copy to avoid a circular import with classify's CATEGORY_OF.
  const map: Record<string, RootCauseHypothesis["category"]> = {
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
  return map[kind] ?? null;
}

function step(description: string, command?: string): ValidationStep {
  return command ? { description, command } : { description };
}

function relSrc(input: FailureAnalysisInput): string {
  return input.context.packageName ? `${input.context.packageName}/src` : "src";
}

// ---- Public API --------------------------------------------------------------

/**
 * Generate ranked root-cause hypotheses for a normalized failure. Always returns
 * at least one (a low-confidence fallback) so callers never special-case empty.
 * Sorted highest-confidence first; fixes within each are sorted by priority.
 */
export function generateHypotheses(
  input: FailureAnalysisInput,
): RootCauseHypothesis[] {
  const { kind } = classifyFailure(input);
  const builder = BUILDERS[kind];
  let produced: RootCauseHypothesis[] = [];

  if (builder) {
    const result = builder(input);
    produced = result ? (Array.isArray(result) ? result : [result]) : [];
  }

  // A missing-dependency failure inside an ESM package is also plausibly an
  // ESM/CJS interop issue — offer it as a secondary, lower-confidence angle.
  if (
    kind === "missing_dependency" &&
    input.context.signals?.moduleType === "module" &&
    BUILDERS.esm_cjs_mismatch
  ) {
    const alt = BUILDERS.esm_cjs_mismatch(input);
    if (alt && !Array.isArray(alt))
      produced.push({ ...alt, confidence: Math.min(alt.confidence, 0.4) });
  }

  if (produced.length === 0) produced = [fallback(input)];

  for (const h of produced) h.fixes.sort((a, b) => b.priority - a.priority);
  produced.sort((a, b) => b.confidence - a.confidence);
  return produced;
}
