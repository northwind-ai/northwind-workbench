/**
 * The engine-isolation layer: a typed protocol, a transport-agnostic host
 * (process manager), the worker runtime, and the task handler. The Electron app
 * provides a `utilityProcess` transport + worker entry; everything here is
 * Electron-free and unit-testable over the in-process transport.
 */
export {
  EngineError,
  type EnginePhase,
  type EngineTaskType,
  type EngineTaskMap,
  type EnginePayload,
  type EngineResult,
  type EngineErrorType,
  type EngineProgress,
  type WorkerInbound,
  type WorkerOutbound,
} from "./protocol";
export {
  createTaskHandler,
  CancelledError,
  type TaskHandler,
  type TaskContext,
  type TaskHandlerOptions,
} from "./task-handler";
export { attachEngineWorker, type WorkerPort } from "./worker-runtime";
export {
  createInProcessTransport,
  type EngineTransport,
  type TransportFactory,
  type InProcessTransport,
} from "./transport";
export {
  EngineHost,
  type EngineHostOptions,
  type EngineHostState,
  type EngineHostStatus,
  type RequestOptions,
} from "./manager";
