import { customFetch } from "./custom-fetch";
import type { RestockSubmissionInput, RestockSubmissionReceipt } from "./generated/api.schemas";

/**
 * Small customer-only entrypoint. Types come from the OpenAPI generator; this
 * module must not import the admin React-query client into the mobile bundle.
 */
export const submitUcRestockRequest = (
  body: RestockSubmissionInput, options?: RequestInit,
): Promise<RestockSubmissionReceipt> => customFetch("/api/uc/restock-requests", {
  ...options,
  method: "POST",
  headers: { "Content-Type": "application/json", ...options?.headers },
  body: JSON.stringify(body),
});
