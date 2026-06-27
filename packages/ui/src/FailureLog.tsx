import type { HealthCheckResult } from "@package-workbench/core";

/** Renders captured evidence (stderr, stack traces) for a check. */
export function FailureLog({ result }: { result: HealthCheckResult }) {
  if (!result.evidence?.length) return null;
  return (
    <pre className="pw-log" role="log" aria-label={`${result.checkId} output`}>
      {result.evidence.join("\n\n")}
    </pre>
  );
}
