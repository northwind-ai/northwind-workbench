import type {
  AssertionOperator,
  AssertionResult,
  ScenarioAssertion,
  ScenarioRunnerContext,
} from "@package-workbench/plugin-sdk";

/**
 * The assertion engine. Pure, dependency-free evaluation of a single
 * {@link ScenarioAssertion} against a scenario's produced value, with detailed,
 * human-readable failure messages.
 */

/** Read a dot/bracket path (`data.items.0.id`, `a[0].b`) out of a value. */
export function getPath(value: unknown, path?: string): unknown {
  if (!path) return value;
  const parts = path
    .replace(/\[(\w+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);
  let cur: unknown = value;
  for (const part of parts) {
    if (cur == null) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Structural deep-equality (handles primitives, arrays, plain objects). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a == null || b == null) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ak = Object.keys(a as object);
    const bk = Object.keys(b as object);
    if (ak.length !== bk.length) return false;
    return ak.every((k) =>
      deepEqual(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
      ),
    );
  }
  return false;
}

function typeName(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function render(v: unknown): string {
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "function") return "[function]";
  if (v === undefined) return "undefined";
  try {
    const s = JSON.stringify(v);
    return s && s.length > 120 ? s.slice(0, 117) + "…" : (s ?? String(v));
  } catch {
    return String(v);
  }
}

interface Verdict {
  ok: boolean;
  message: string;
}

function evaluateOperator(
  operator: AssertionOperator,
  actual: unknown,
  expected: unknown,
  fn: ScenarioAssertion["fn"],
  ctx: ScenarioRunnerContext,
  label: string,
): Verdict {
  switch (operator) {
    case "equals":
      return {
        ok: deepEqual(actual, expected),
        message: `Expected ${label} to equal ${render(expected)}, actual: ${render(actual)}`,
      };
    case "exists":
      return {
        ok: actual !== undefined && actual !== null,
        message: `Expected ${label} to exist, actual: ${render(actual)}`,
      };
    case "type_is":
      return {
        ok: typeName(actual) === expected,
        message: `Expected ${label} to be of type ${render(expected)}, actual type: ${typeName(actual)}`,
      };
    case "array_length": {
      const len = Array.isArray(actual) ? actual.length : NaN;
      return {
        ok: len === expected,
        message: `Expected ${label} to have length ${render(expected)}, actual: ${Number.isNaN(len) ? "not an array" : len}`,
      };
    }
    case "greater_than":
      return {
        ok:
          typeof actual === "number" &&
          typeof expected === "number" &&
          actual > expected,
        message: `Expected ${label} > ${render(expected)}, actual: ${render(actual)}`,
      };
    case "less_than":
      return {
        ok:
          typeof actual === "number" &&
          typeof expected === "number" &&
          actual < expected,
        message: `Expected ${label} < ${render(expected)}, actual: ${render(actual)}`,
      };
    case "contains": {
      let ok = false;
      if (typeof actual === "string") ok = actual.includes(String(expected));
      else if (Array.isArray(actual))
        ok = actual.some((x) => deepEqual(x, expected));
      else if (actual && typeof actual === "object")
        ok = Object.prototype.hasOwnProperty.call(actual, String(expected));
      return {
        ok,
        message: `Expected ${label} to contain ${render(expected)}, actual: ${render(actual)}`,
      };
    }
    case "custom_function": {
      if (typeof fn !== "function")
        return {
          ok: false,
          message: `custom_function assertion on ${label} has no fn`,
        };
      try {
        const r = fn(actual, ctx);
        if (r === true)
          return { ok: true, message: `Custom assertion on ${label} passed` };
        return {
          ok: false,
          message:
            typeof r === "string" ? r : `Custom assertion on ${label} failed`,
        };
      } catch (e) {
        return {
          ok: false,
          message: `Custom assertion on ${label} threw: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    }
    default:
      return { ok: false, message: `Unknown operator "${operator as string}"` };
  }
}

/** Evaluate one assertion against the scenario output. */
export function evaluateAssertion(
  assertion: ScenarioAssertion,
  output: unknown,
  ctx: ScenarioRunnerContext,
): AssertionResult {
  const actual = getPath(output, assertion.path);
  const label = assertion.path ? `"${assertion.path}"` : "the result";
  const verdict = evaluateOperator(
    assertion.operator,
    actual,
    assertion.expected,
    assertion.fn,
    ctx,
    label,
  );
  return {
    ok: verdict.ok,
    operator: assertion.operator,
    path: assertion.path,
    expected: assertion.expected,
    actual,
    message:
      assertion.message && !verdict.ok
        ? `${assertion.message} (${verdict.message})`
        : verdict.message,
  };
}
