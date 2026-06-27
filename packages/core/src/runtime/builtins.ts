/**
 * The Node.js built-in module catalogue, split by how badly each one breaks in a
 * browser. `HARD_BROWSER_BREAKERS` have no meaningful browser shim and turn a
 * browser target red; the rest are Node-only too but bundlers routinely polyfill
 * them, so their presence is a warning, not a hard failure.
 */

/** No browser equivalent — using these means the code cannot run in a browser. */
export const HARD_BROWSER_BREAKERS: ReadonlySet<string> = new Set([
  "fs",
  "fs/promises",
  "child_process",
  "net",
  "tls",
  "dns",
  "dgram",
  "cluster",
  "worker_threads",
  "vm",
  "v8",
  "inspector",
  "repl",
  "readline",
  "perf_hooks",
  "async_hooks",
  "http",
  "https",
  "http2",
  "os",
  "module",
]);

/** Node-only but commonly polyfilled by bundlers (browserify-style shims). */
export const POLYFILLABLE_BUILTINS: ReadonlySet<string> = new Set([
  "path",
  "util",
  "events",
  "stream",
  "buffer",
  "string_decoder",
  "querystring",
  "url",
  "crypto",
  "zlib",
  "assert",
  "constants",
  "punycode",
  "process",
  "timers",
  "console",
]);

/** Everything Node treats as a built-in (used for resolution classification). */
export const NODE_BUILTINS: ReadonlySet<string> = new Set([
  ...HARD_BROWSER_BREAKERS,
  ...POLYFILLABLE_BUILTINS,
  "tty",
  "sys",
  "wasi",
  "diagnostics_channel",
  "trace_events",
]);

/** Normalise a specifier to its built-in name, or null if it isn't a built-in. */
export function builtinName(specifier: string): string | null {
  const bare = specifier.startsWith("node:") ? specifier.slice(5) : specifier;
  if (NODE_BUILTINS.has(bare)) return bare;
  // `fs/promises` etc. — match on the head segment as a fallback.
  const head = bare.split("/")[0]!;
  if (NODE_BUILTINS.has(head)) return bare;
  return null;
}

/** Classify a built-in's browser impact. */
export function browserImpact(name: string): "hard" | "polyfillable" {
  const head = name.split("/")[0]!;
  if (HARD_BROWSER_BREAKERS.has(name) || HARD_BROWSER_BREAKERS.has(head))
    return "hard";
  return "polyfillable";
}
