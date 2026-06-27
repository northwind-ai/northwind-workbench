import { useState } from "react";
import type { WorkspaceStack } from "@package-workbench/core";

/**
 * Shows the detected workspace adapter stack — "Detected: pnpm workspace · Nx
 * project graph · TypeScript" — with confidence, the capabilities each adapter
 * provides, and advisory notes (unsupported features + suggested fixes) behind a
 * disclosure. Pure + presentational.
 */

export interface WorkspaceStackBadgeProps {
  stack: WorkspaceStack | null;
}

const ADAPTER_LABEL: Record<string, string> = {
  nx: "Nx",
  turbo: "Turborepo",
  pnpm: "pnpm",
  yarn: "Yarn",
  bun: "Bun",
  npm: "npm",
  "single-package": "Single package",
};

export function WorkspaceStackBadge({ stack }: WorkspaceStackBadgeProps) {
  const [open, setOpen] = useState(false);
  if (!stack) return null;

  const pct = Math.round(stack.confidence * 100);
  return (
    <div className="pw-stack">
      <button
        className="pw-stack__summary"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="pw-stack__label">Detected:</span>
        {stack.detected.map((d) => (
          <span
            key={d.adapter}
            className={`pw-stack__chip${d.adapter === stack.primary ? " is-primary" : ""}`}
          >
            {ADAPTER_LABEL[d.adapter] ?? d.adapter}
          </span>
        ))}
        {stack.isSinglePackage && (
          <span className="pw-stack__chip is-single">single-package mode</span>
        )}
        <span className="pw-stack__conf">{pct}%</span>
        <span className="pw-stack__chev">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="pw-stack__detail">
          <div className="pw-stack__caps">
            <strong>Capabilities</strong>
            <ul>
              {Object.entries(stack.capabilities).map(([cap, providers]) => (
                <li key={cap}>
                  <code>{cap}</code> —{" "}
                  {(providers ?? [])
                    .map((p) => ADAPTER_LABEL[p] ?? p)
                    .join(", ")}
                </li>
              ))}
            </ul>
          </div>
          {stack.notes.length > 0 && (
            <div className="pw-stack__notes">
              <strong>Notes &amp; suggestions</strong>
              <ul>
                {stack.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
