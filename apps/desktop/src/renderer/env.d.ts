/// <reference types="vite/client" />
import type { WorkbenchApi } from "../shared/ipc";

declare global {
  interface Window {
    /** Injected by preload via contextBridge. The renderer's only privileged API. */
    workbench: WorkbenchApi;
  }
}

export {};
