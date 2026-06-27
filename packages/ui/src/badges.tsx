import type { ReactNode } from "react";
import type {
  Confidence,
  HealthCheckStatus,
  RuntimeStatus,
} from "@package-workbench/core";

const CONFIDENCE_COLOR: Record<Confidence, string> = {
  high: "#1f9d55",
  medium: "#d97706",
  low: "#9ca3af",
};

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  return (
    <span
      className="pw-pill"
      style={{ background: CONFIDENCE_COLOR[confidence] }}
      title="Confidence in this score"
    >
      {confidence} confidence
    </span>
  );
}

const CHECK_COLOR: Record<HealthCheckStatus, string> = {
  pass: "#1f9d55",
  warn: "#d97706",
  fail: "#dc2626",
  skip: "#9ca3af",
  unknown: "#6366f1",
};

const CHECK_LABEL: Record<HealthCheckStatus, string> = {
  pass: "Pass",
  warn: "Warn",
  fail: "Fail",
  skip: "Skip",
  unknown: "Unknown",
};

export function StatusBadge({ status }: { status: HealthCheckStatus }) {
  return (
    <span
      className="pw-check__badge"
      style={{ background: CHECK_COLOR[status] }}
    >
      {CHECK_LABEL[status]}
    </span>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="pw-tag">{children}</span>;
}

export const RUNTIME_STATUS_COLOR: Record<RuntimeStatus, string> = {
  pass: "#1f9d55",
  warn: "#d97706",
  fail: "#dc2626",
  unknown: "#9ca3af",
};

const RUNTIME_STATUS_LABEL: Record<RuntimeStatus, string> = {
  pass: "PASS",
  warn: "WARN",
  fail: "FAIL",
  unknown: "—",
};

/** Pill for a single runtime-target verdict (PASS/WARN/FAIL/—). */
export function RuntimeStatusBadge({ status }: { status: RuntimeStatus }) {
  return (
    <span
      className="pw-rt__badge"
      style={{ background: RUNTIME_STATUS_COLOR[status] }}
    >
      {RUNTIME_STATUS_LABEL[status]}
    </span>
  );
}
