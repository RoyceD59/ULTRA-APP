import { Platform } from "react-native";
import { createRuntimeReporter, diagnosticBrowser, diagnosticRoute, installWebRuntimeDiagnostics, installNativeRuntimeDiagnostics, setRuntimeReadReporter } from "@workspace/api-client-react/config";
import { getApiBase } from "./apiBase";

let currentRoute = "other" as ReturnType<typeof diagnosticRoute>;
export function setDiagnosticRoute(path: string) { currentRoute = diagnosticRoute(path); }
export const companionReporter = createRuntimeReporter({
  endpoint: `${getApiBase()}/api/diagnostics`,
  context: () => ({
    app: "companion",
    environment: process.env.EXPO_PUBLIC_PREVIEW_SAFE_MODE === "1" ? "preview" : process.env.NODE_ENV === "production" ? "production" : "development",
    platform: Platform.OS === "web" || Platform.OS === "android" || Platform.OS === "ios" ? Platform.OS : "other",
    browser: Platform.OS === "web" ? diagnosticBrowser(navigator.userAgent) : "native",
    // This is the same static build ID used by manifests and build-info.json.
    release: process.env.NODE_ENV === "production" ? process.env.EXPO_PUBLIC_COMPANION_BUILD_ID || "unknown" : "development",
    routeClass: Platform.OS === "web" ? diagnosticRoute(window.location.pathname) : currentRoute,
  }),
});
let installed = false;
let rejectionTrackerInstalled = false;
export function installCompanionDiagnostics() {
  if (installed) return () => {};
  installed = true;
  const removeRead = setRuntimeReadReporter(companionReporter);
  let removeRuntime = () => {};
  if (Platform.OS === "web") removeRuntime = installWebRuntimeDiagnostics(companionReporter);
  else {
    const runtime = globalThis as typeof globalThis & {
      ErrorUtils?: NonNullable<Parameters<typeof installNativeRuntimeDiagnostics>[1]["errorUtils"]>;
      HermesInternal?: NonNullable<Parameters<typeof installNativeRuntimeDiagnostics>[1]["rejectionTracker"]>;
    };
    const tracker = process.env.NODE_ENV === "production" && !rejectionTrackerInstalled &&
      typeof runtime.HermesInternal?.enablePromiseRejectionTracker === "function" ? runtime.HermesInternal : undefined;
    removeRuntime = installNativeRuntimeDiagnostics(companionReporter, { errorUtils: runtime.ErrorUtils, rejectionTracker: tracker });
    if (tracker) rejectionTrackerInstalled = true;
  }
  return () => { removeRead(); removeRuntime(); installed = false; };
}