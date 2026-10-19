/**
 * Bound the entire request, including the response body. Aborting only the
 * initial fetch would still leave a stalled JSON response spinning forever.
 */
export async function whatsappRequest<T>(
  url: string,
  options: RequestInit,
  timeoutMessage: string,
  timeoutMs = 20_000,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, cache: "no-store" });
    if (response.status === 401) throw new Error("Session expired");
    const body = await response.json() as T & { error?: string | { message?: string } };
    if (!response.ok) {
      const message = typeof body.error === "string" ? body.error : body.error?.message;
      throw new Error(message || "WhatsApp request failed. Retry.");
    }
    return body;
  } catch (error) {
    if (controller.signal.aborted) throw new Error(timeoutMessage);
    if (error instanceof Error && error.message === "Session expired") throw error;
    if (error instanceof SyntaxError || error instanceof TypeError) {
      throw new Error("Could not reach the WhatsApp service. Check your connection and retry.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}