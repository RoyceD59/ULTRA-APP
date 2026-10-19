import type { AgentToken, AlisonChatPage } from "@workspace/api-client-react";
import { apiUrl } from "@/lib/api-base";

export class AlisonMachineApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AlisonMachineApiError";
  }
}

async function readResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok) {
    throw new AlisonMachineApiError(
      response.status,
      typeof body?.error === "string" ? body.error : "service_unavailable",
    );
  }
  if (!body || typeof body !== "object") {
    throw new AlisonMachineApiError(502, "invalid_response");
  }
  return body;
}

export function alisonConnectionHelp(error: unknown): string {
  if (!(error instanceof AlisonMachineApiError)) {
    return "Could not reach the API. Check your connection and try again; you do not need to rotate the secret.";
  }
  if (error.message === "invalid_scope" || error.message === "insufficient_scope") {
    return "This client does not have alison.read. Ask an administrator to use Create Alison viewer in Agent operations. Rotating the secret does not add scopes.";
  }
  if (error.status === 401) {
    return "The client ID or secret was not accepted. Use the matching pair from Agent operations in this environment. Check that the client is active and not expired; a rotated or lost secret must be replaced.";
  }
  if (error.status === 429) return "Too many connection attempts. Wait one minute, then try again.";
  if (error.status === 403) return "This client is not permitted to view Alison conversations. Ask an administrator to check its alison.read scope.";
  if (error.status === 404) return "The Alison access endpoint is unavailable. Check that ProjectHub is connected to the correct API environment.";
  return "The Alison access service is unavailable or returned an unexpected response. Try again later; do not replace working credentials for a service error.";
}

export async function issueAlisonMachineToken(
  clientId: string,
  clientSecret: string,
): Promise<AgentToken> {
  const form = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "alison.read",
  });
  const response = await fetch(apiUrl("/oauth/token"), {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${clientId.trim()}:${clientSecret.trim()}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  const token = await readResponse<AgentToken>(response);
  if (typeof token.access_token !== "string" || !token.access_token
    || token.token_type !== "Bearer" || !Number.isFinite(token.expires_in) || token.expires_in <= 0
    || typeof token.scope !== "string") {
    throw new AlisonMachineApiError(502, "invalid_response");
  }
  if (!token.scope.split(/\s+/).includes("alison.read")) {
    throw new AlisonMachineApiError(403, "insufficient_scope");
  }
  return token;
}

export async function listAlisonMachineChats(
  accessToken: string,
  cursor?: string,
  signal?: AbortSignal,
): Promise<AlisonChatPage> {
  const params = new URLSearchParams({ limit: "20" });
  if (cursor) params.set("cursor", cursor);
  const response = await fetch(apiUrl(`/integrations/v1/alison/chats?${params}`), {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal,
  });
  return readResponse<AlisonChatPage>(response);
}