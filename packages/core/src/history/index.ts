/**
 * Historical runs, deltas, CI gating, report export, and notifications. The
 * pieces compose: snapshot a run → store it → compare against a baseline →
 * evaluate a CI policy / render a report / raise notifications.
 */
export { buildSnapshot, snapshotRun, type SnapshotOptions } from "./snapshot";
export { createJsonRunStore, defaultHistoryDir, type RunStore } from "./store";
export { compareRuns, hasCriticalFailure, tally } from "./delta";
export { evaluateCiPolicy, loadCiPolicy } from "./ci";
export { renderReport, type ReportFormat, type ReportInput } from "./report";
export { buildNotifications } from "./notify";
export { readGitInfo, type GitInfo } from "./git";
