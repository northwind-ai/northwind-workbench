import type {
  HealthCheckResult,
  PackageManager,
} from "@package-workbench/core";

/**
 * Turns a raw failing check into a human explanation: what failed, the likely
 * root cause, a concrete suggested fix, and the raw logs kept out of the way.
 * Pure + deterministic so it's easy to test and reuse in CLI/desktop.
 */

export interface FailureExplanation {
  /** Short failure type, e.g. "Missing dependency". */
  type: string;
  /** Plain-language root cause. */
  rootCause: string;
  /** A copy-pasteable fix, when we can suggest one. */
  likelyFix?: string;
  /** Raw evidence (stack traces, stderr) — shown collapsed. */
  raw?: string[];
}

function addCommand(pm: PackageManager, pkgs: string[]): string {
  const list = pkgs.join(" ");
  switch (pm) {
    case "npm":
      return `npm install ${list}`;
    case "yarn":
      return `yarn add ${list}`;
    case "bun":
      return `bun add ${list}`;
    default:
      return `pnpm add ${list}`;
  }
}

const RUNTIME_CLASS_HELP: Record<string, { type: string; rootCause: string }> =
  {
    MISSING_DEPENDENCY: {
      type: "Missing dependency",
      rootCause:
        "The package imports a module that is not installed or declared.",
    },
    ESM_CJS_MISMATCH: {
      type: "ESM/CJS mismatch",
      rootCause:
        "The module system declared in package.json does not match the code (e.g. CommonJS in an ES module).",
    },
    SYNTAX_FAILURE: {
      type: "Syntax error",
      rootCause: "The entry file (or something it loads) failed to parse.",
    },
    IMPORT_RESOLUTION_FAILURE: {
      type: "Entry not found",
      rootCause:
        "The declared entry point could not be resolved — the package may not be built.",
    },
    EXPORT_RESOLUTION_FAILURE: {
      type: "Blocked by exports map",
      rootCause: 'The "exports" map did not permit loading the requested path.',
    },
    RUNTIME_EXCEPTION: {
      type: "Runtime exception",
      rootCause: "The module threw while its top-level code ran.",
    },
  };

/** Explain a failing (or warning) check result. `pm` tailors install suggestions. */
export function explainFailure(
  result: HealthCheckResult,
  pm: PackageManager = "pnpm",
): FailureExplanation {
  const raw = result.evidence?.length ? result.evidence : undefined;
  const text = `${result.summary} ${result.details ?? ""}`;

  switch (result.checkId) {
    case "runtime_import_check": {
      const cls = (text.match(/\b([A-Z_]+)\b/) ?? [])[1] ?? "RUNTIME_EXCEPTION";
      const help =
        RUNTIME_CLASS_HELP[cls] ?? RUNTIME_CLASS_HELP.RUNTIME_EXCEPTION!;
      const missing = (text.match(/Missing module:\s*(\S+)/) ??
        text.match(/Cannot find (?:package|module) ['"]([^'"]+)['"]/) ??
        [])[1];
      const fix =
        cls === "MISSING_DEPENDENCY" && missing
          ? addCommand(pm, [missing])
          : cls === "IMPORT_RESOLUTION_FAILURE"
            ? "Run the package build, then re-check."
            : cls === "ESM_CJS_MISMATCH"
              ? 'Align "type" + file extensions, or the import/require exports conditions.'
              : undefined;
      return {
        type: help.type,
        rootCause: help.rootCause,
        likelyFix: fix,
        raw,
      };
    }

    case "missing_peer_dependencies": {
      const peers = (result.evidence ?? [])
        .map((e) => e.split("@")[0])
        .filter(Boolean) as string[];
      return {
        type: "Missing peer dependency",
        rootCause:
          "Required peer dependencies are not resolvable where this package is consumed.",
        likelyFix: peers.length ? addCommand(pm, peers) : undefined,
        raw,
      };
    }

    case "module_resolution_check":
    case "main_module_exists":
    case "entrypoint_exists":
      return {
        type: "Entry not found",
        rootCause:
          "A declared entry point does not exist on disk — the package was likely not built.",
        likelyFix: "Run the build script, then re-check.",
        raw,
      };

    case "exports_map_check":
      return {
        type: "Invalid exports map",
        rootCause:
          'The package.json "exports" map is malformed or points at missing files.',
        likelyFix:
          'Fix the "exports" field so every target resolves to a real file.',
        raw,
      };

    case "browser_compatibility_check": {
      const builtins = (text.match(/built-ins?:?\s*([a-z_,\s]+)/i) ??
        [])[1]?.trim();
      return {
        type: "Browser incompatibility",
        rootCause: `Source uses Node built-ins${builtins ? ` (${builtins})` : ""} that don't exist in the browser.`,
        likelyFix:
          "Guard Node-only code or provide a browser-safe implementation.",
        raw,
      };
    }

    case "package_json_valid":
      return {
        type: "Invalid package.json",
        rootCause: "package.json is missing or contains invalid JSON.",
        likelyFix: "Fix the JSON syntax in package.json.",
        raw,
      };

    case "scenario_runner_check":
      return {
        type: "Scenario failure",
        rootCause: "One or more smoke-test scenarios failed at runtime.",
        raw,
      };

    case "types_entry_exists":
      return {
        type: "Missing type declarations",
        rootCause: 'The declared "types" file does not exist.',
        likelyFix:
          'Emit declarations (tsc --declaration) or fix the "types" path.',
        raw,
      };

    default:
      return { type: result.label, rootCause: result.summary, raw };
  }
}
