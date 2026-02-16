/**
 * Renderer Entry Point
 *
 * Bootstraps the React application for the Electron renderer process.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { SettingsProvider } from "./settings";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { CrashReporterProvider } from "./components/CrashReporterProvider";
import "./styles/index.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

const root = createRoot(rootElement);
root.render(
  <StrictMode>
    <CrashReporterProvider>
      <ErrorBoundary>
        <SettingsProvider>
          <App />
        </SettingsProvider>
      </ErrorBoundary>
    </CrashReporterProvider>
  </StrictMode>
);
