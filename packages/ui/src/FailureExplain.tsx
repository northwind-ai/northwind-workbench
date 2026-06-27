import { useState } from "react";
import type {
  HealthCheckResult,
  PackageManager,
} from "@package-workbench/core";
import { explainFailure } from "./errors";

export interface FailureExplainProps {
  result: HealthCheckResult;
  packageManager?: PackageManager;
}

/**
 * A friendly error surface: failure type, root cause, a copy-pasteable fix, and
 * the raw logs tucked behind a disclosure — instead of dumping a stack trace.
 */
export function FailureExplain({
  result,
  packageManager = "pnpm",
}: FailureExplainProps) {
  const e = explainFailure(result, packageManager);
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyFix = (): void => {
    if (!e.likelyFix) return;
    void navigator.clipboard?.writeText(e.likelyFix).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="pw-explain">
      <div className="pw-explain__type">{e.type}</div>
      <p className="pw-explain__cause">{e.rootCause}</p>
      {e.likelyFix && (
        <div className="pw-explain__fix">
          <span className="pw-muted">Likely fix</span>
          <code>{e.likelyFix}</code>
          <button className="pw-explain__copy" onClick={copyFix}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
      {e.raw && e.raw.length > 0 && (
        <div className="pw-explain__raw">
          <button
            className="pw-explain__rawtoggle"
            onClick={() => setShowRaw((s) => !s)}
          >
            {showRaw ? "▾" : "▸"} Raw logs
          </button>
          {showRaw && <pre className="pw-log">{e.raw.join("\n\n")}</pre>}
        </div>
      )}
    </div>
  );
}
