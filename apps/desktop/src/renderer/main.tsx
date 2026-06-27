import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import "@package-workbench/ui/styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("#root not found");

// Surface unhandled renderer errors to the main-process log, never silently.
window.addEventListener(
  "error",
  (e) =>
    void window.workbench?.logError?.(
      "renderer",
      `${e.message} @ ${e.filename}:${e.lineno}`,
    ),
);
window.addEventListener(
  "unhandledrejection",
  (e) =>
    void window.workbench?.logError?.(
      "renderer",
      `Unhandled rejection: ${String(e.reason)}`,
    ),
);

createRoot(container).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
