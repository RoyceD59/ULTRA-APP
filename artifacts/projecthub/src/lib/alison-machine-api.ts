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
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) {
    throw new AlisonMachineApiError(
      response.status,
      body.error ?? `Machine request failed (${response.status})`,
    );
  }
  return body;
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
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  return readResponse<AgentToken>(response);
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