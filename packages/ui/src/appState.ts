/**
 * The app-level finite state machine, as a pure reducer. The desktop's Zustand
 * store delegates transitions here so they can be unit-tested without React or
 * Electron. Illegal transitions are rejected (the state is returned unchanged),
 * so the UI can never wedge into an impossible state.
 */

export type AppStatus =
  | "idle"
  | "selecting_repo"
  | "scanning"
  | "ready"
  | "running_checks"
  | "error";

export type AppEvent =
  | { type: "CHOOSE_REPO" } // user clicked Open Repository
  | { type: "CANCEL" } // dismissed the picker
  | { type: "SCAN_START" }
  | { type: "SCAN_DONE" }
  | { type: "SCAN_ERROR"; message: string }
  | { type: "RUN_START" }
  | { type: "RUN_DONE" }
  | { type: "RESET" };

export interface AppMachineState {
  status: AppStatus;
  error: string | null;
}

export const initialAppState: AppMachineState = { status: "idle", error: null };

/** Allowed transitions: status → events it accepts. */
const TRANSITIONS: Record<
  AppStatus,
  Partial<Record<AppEvent["type"], AppStatus>>
> = {
  idle: { CHOOSE_REPO: "selecting_repo", SCAN_START: "scanning" },
  selecting_repo: { SCAN_START: "scanning", CANCEL: "idle" },
  scanning: { SCAN_DONE: "ready", SCAN_ERROR: "error" },
  ready: {
    SCAN_START: "scanning",
    RUN_START: "running_checks",
    CHOOSE_REPO: "selecting_repo",
  },
  running_checks: { RUN_DONE: "ready", SCAN_ERROR: "error" },
  error: {
    CHOOSE_REPO: "selecting_repo",
    SCAN_START: "scanning",
    RESET: "idle",
  },
};

/** Apply an event. Returns the next state, or the same state if the event is illegal. */
export function appReducer(
  state: AppMachineState,
  event: AppEvent,
): AppMachineState {
  if (event.type === "RESET") return initialAppState;
  const next = TRANSITIONS[state.status][event.type];
  if (!next) return state; // illegal transition — ignore
  return {
    status: next,
    error: event.type === "SCAN_ERROR" ? event.message : null,
  };
}

/** Can this event fire from the current status? */
export function canTransition(
  status: AppStatus,
  eventType: AppEvent["type"],
): boolean {
  if (eventType === "RESET") return true;
  return Boolean(TRANSITIONS[status][eventType]);
}

/** Whether the app is mid-flight (used to show progress / disable actions). */
export const isBusyStatus = (status: AppStatus): boolean =>
  status === "scanning" || status === "running_checks";
