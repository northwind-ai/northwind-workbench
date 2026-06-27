# Scenarios

Scenarios are **executable smoke tests** a plugin contributes for the packages it
understands. Where health checks prove a package is well-formed, scenarios prove it
_does something_ — import it, call a function, validate the output. The pass rate folds
into the health score (heavily — a package whose smoke tests fail is broken in practice).

## Anatomy

```ts
import { defineScenario } from "@package-workbench/plugin-sdk";

export const basicImport = defineScenario({
  id: "revenue:opportunities",
  title: "Revenue report returns opportunities",
  timeoutMs: 10_000,
  assertions: [
    { path: "opportunities", operator: "type_is", expected: "array" },
    {
      path: "opportunities",
      operator: "array_length",
      expected: 3,
      message: "expected 3 seeded opportunities",
    },
    { path: "total", operator: "greater_than", expected: 0 },
  ],
  async run(ctx) {
    ctx.log(`analyzing ${ctx.package.name}`);
    const mod = await import(
      /* the built entry */ ctx.package.root + "/dist/index.js"
    );
    return mod.buildRevenueReport(SAMPLE_INPUT);
  },
});
```

`run(ctx)` does the work and returns the value the `assertions` are evaluated against.
A scenario can also just `throw` to fail, or use `custom_function` assertions.

### `ScenarioRunnerContext`

| Field       | Purpose                                               |
| ----------- | ----------------------------------------------------- |
| `package`   | the `PackageInfo` under test                          |
| `workspace` | the surrounding `WorkspaceInfo`                       |
| `host`      | the capability-limited `PluginContext` (fs/exec/json) |
| `signal`    | aborts on timeout/cancel — honour it for long work    |
| `log(msg)`  | append a line to the scenario's captured log          |

## Assertions

| Operator          | `expected` means               | Example                                                  |
| ----------------- | ------------------------------ | -------------------------------------------------------- | --- | --------------------- |
| `equals`          | the value (deep-equal)         | `{ path: 'name', operator: 'equals', expected: 'core' }` |
| `exists`          | —                              | `{ path: 'data', operator: 'exists' }`                   |
| `type_is`         | a type name (`array`/`null`/…) | `{ path: 'xs', operator: 'type_is', expected: 'array' }` |
| `array_length`    | the length                     | `{ path: 'xs', operator: 'array_length', expected: 2 }`  |
| `greater_than`    | the lower bound                | `{ path: 'n', operator: 'greater_than', expected: 0 }`   |
| `less_than`       | the upper bound                | `{ path: 'n', operator: 'less_than', expected: 100 }`    |
| `contains`        | substring / element / key      | `{ operator: 'contains', expected: 'world' }`            |
| `custom_function` | uses `fn(actual, ctx)`         | `{ operator: 'custom_function', fn: (v) => v > 0         |     | 'must be positive' }` |

`path` is an optional dot/bracket path (`data.items.0.id`); omit it to assert against the
whole value. Failures read like:

```
Assertion failed:
Expected "opportunityCount" > 0, actual: 0
```

## Running scenarios

Because scenarios execute code, they run only when explicitly requested:

```bash
package-workbench scenarios <path>            # run all, JSON output
package-workbench scenarios <path> --pretty   # progress + logs + failures
package-workbench scenarios <path> -p @scope/pkg
```

A plain `scan` reports how many scenarios are available without running them
(`scenario_runner_check`); the desktop **Scenario Runner** tab runs all or one with live
progress, durations, and logs.

### Execution model

- **Categorised failures**: `setup` / `runtime` / `assertion` / `timeout` / `cancelled`.
- **Timeouts**: per-scenario (`timeoutMs`), enforced by aborting `ctx.signal`.
- **Cancellation**: pass an `AbortSignal`; in-flight scenarios abort, the rest are skipped.
- **Parallelism**: `runScenarios(..., { concurrency: 4 })` (default is sequential).
- **Telemetry**: duration and a best-effort heap delta per scenario.

Scenarios run **in-process** (the v1 trust model, identical to plugins). The documented
upgrade path is to run them in a `utilityProcess`/`worker_thread` for isolation.
