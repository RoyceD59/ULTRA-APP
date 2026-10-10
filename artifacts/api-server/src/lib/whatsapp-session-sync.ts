import { setTimeout as sleep } from "node:timers/promises";

export const SESSION_UPLOAD_BACKOFF_MS = Object.freeze([1_000, 2_000, 4_000] as const);
export type UploadFailureCategory = "network" | "rate_limit" | "server" | "request_timeout" | "permanent";
export interface SessionSyncEvent {
  operation: "whatsapp_session_backup";
  status: "retrying" | "failed" | "recovered";
  attempt: number;
  category: UploadFailureCategory;
  delayMs?: number;
}
export interface SessionSyncDependencies {
  isCurrent: () => boolean;
  signal: AbortSignal;
  listFiles: () => Promise<string[]>;
  readFile: (name: string) => Promise<Uint8Array>;
  saveFile: (name: string, contents: Uint8Array) => Promise<void>;
  log: (event: SessionSyncEvent) => void;
  wait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
}
export interface SessionSyncResult {
  uploaded: number;
  failed: number;
  obsolete: number;
}

const NETWORK_CODES = new Set([
  "ECONNRESET", "ECONNREFUSED", "ECONNABORTED", "ETIMEDOUT", "EAI_AGAIN",
  "EPIPE", "ENETUNREACH", "EHOSTUNREACH", "EPROTO",
  "ERR_SSL_UNEXPECTED_EOF_WHILE_READING", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET",
]);

/** Inspect finite status/code fields only. Never return/log error text or URLs. */
export function uploadFailureCategory(error: unknown): UploadFailureCategory {
  let value = error;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 4 && value && typeof value === "object" && !seen.has(value); depth++) {
    seen.add(value);
    const detail = value as { code?: unknown; status?: unknown; statusCode?: unknown;
      response?: { status?: unknown }; cause?: unknown };
    const status = [detail.response?.status, detail.statusCode, detail.status, detail.code]
      .find(candidate => typeof candidate === "number" && Number.isInteger(candidate)
        && candidate >= 400 && candidate <= 599);
    if (status === 429) return "rate_limit";
    if (status === 408) return "request_timeout";
    if (typeof status === "number") return status >= 500 ? "server" : "permanent";
    if (typeof detail.code === "string" && NETWORK_CODES.has(detail.code)) return "network";
    value = detail.cause;
  }
  return "permanent";
}

/**
 * Retry failed files within the existing serialized credential-write queue.
 * All admitted writes settle before returning, even if another file fails.
 * Nothing here accesses a real bucket, filesystem, socket, account or logger.
 */
export async function syncSessionFiles(deps: SessionSyncDependencies): Promise<SessionSyncResult> {
  const current = () => !deps.signal.aborted && deps.isCurrent();
  const wait = deps.wait ?? ((delayMs, signal) => sleep(delayMs, undefined, { signal }));
  if (!current()) return { uploaded: 0, failed: 0, obsolete: 0 };
  let names: string[];
  try { names = await deps.listFiles(); }
  catch (error) {
    if (!current()) return { uploaded: 0, failed: 0, obsolete: 0 };
    // A new auth directory may not exist yet; it is not an upload failure.
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { uploaded: 0, failed: 0, obsolete: 0 };
    }
    deps.log({ operation: "whatsapp_session_backup", status: "failed", attempt: 0, category: "permanent" });
    return { uploaded: 0, failed: 1, obsolete: 0 };
  }
  const results = await Promise.allSettled(names.map(async name => {
    let lastCategory: UploadFailureCategory = "permanent";
    for (let attempt = 1; attempt <= SESSION_UPLOAD_BACKOFF_MS.length + 1; attempt++) {
      if (!current()) return "obsolete";
      let contents: Uint8Array;
      try { contents = await deps.readFile(name); }
      catch {
        if (!current()) return "obsolete";
        deps.log({ operation: "whatsapp_session_backup", status: "failed", attempt, category: "permanent" });
        return "failed";
      }
      if (!current()) return "obsolete";
      try {
        // Never abandon/race a started save: Disconnect must be able to drain it.
        await deps.saveFile(name, contents);
        if (!current()) return "obsolete";
        if (attempt > 1) {
          deps.log({ operation: "whatsapp_session_backup", status: "recovered", attempt, category: lastCategory });
        }
        return "uploaded";
      } catch (error) {
        if (!current()) return "obsolete";
        lastCategory = uploadFailureCategory(error);
        const delayMs = SESSION_UPLOAD_BACKOFF_MS[attempt - 1];
        if (lastCategory === "permanent" || delayMs === undefined) {
          deps.log({ operation: "whatsapp_session_backup", status: "failed", attempt, category: lastCategory });
          return "failed";
        }
        deps.log({ operation: "whatsapp_session_backup", status: "retrying", attempt, category: lastCategory, delayMs });
        try { await wait(delayMs, deps.signal); }
        catch {
          if (current()) {
            deps.log({ operation: "whatsapp_session_backup", status: "failed", attempt, category: "permanent" });
            return "failed";
          }
          return "obsolete";
        }
      }
    }
    return "failed";
  }));
  const result: SessionSyncResult = { uploaded: 0, failed: 0, obsolete: 0 };
  for (const item of results) {
    if (item.status === "fulfilled") {
      if (item.value === "uploaded") result.uploaded++;
      else if (item.value === "obsolete") result.obsolete++;
      else result.failed++;
    } else {
      // Defensive dependency failure: still wait for all other writes to settle.
      result.failed++;
      deps.log({ operation: "whatsapp_session_backup", status: "failed", attempt: 0, category: "permanent" });
    }
  }
  return result;
}
