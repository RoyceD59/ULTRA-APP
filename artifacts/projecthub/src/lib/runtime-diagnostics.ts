import { createRuntimeReporter, diagnosticRoute, diagnosticBrowser, installWebRuntimeDiagnostics, setRuntimeReadReporter } from "@workspace/api-client-react/config";
import { apiUrl } from "./api-base";

export const projecthubReporter = createRuntimeReporter({
  endpoint: apiUrl("/diagnostics"),
  context: () => ({
    app: "projecthub", environment: import.meta.env.VITE_PREVIEW_SAFE_MODE === "1" ? "preview" : import.meta.env.PROD ? "production" : "development",
    platform: "web", browser: diagnosticBrowser(navigator.userAgent),
    release: import.meta.env.PROD ? import.meta.env.VITE_RUNTIME_RELEASE : "development",
    routeClass: diagnosticRoute(window.location.pathname),
  }),
});
let installed = false;
export function installProjecthubDiagnostics() {
  if (installed) return () => {};
  installed = true;
  const removeWeb = installWebRuntimeDiagnostics(projecthubReporter);
  const removeRead = setRuntimeReadReporter(projecthubReporter);
  return () => { removeWeb(); removeRead(); installed = false; };
}