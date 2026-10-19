/** Recognize permanent Google authorization failures, not network/permission errors. */
export function needsGoogleReconnect(error: unknown): boolean {
  if (typeof error === "string") {
    return /\binvalid_grant\b|GOOGLE_RECONNECT_REQUIRED|token (?:has been )?(?:expired (?:or |and ))?revoked|refresh token (?:is )?(?:invalid|expired)/i.test(error);
  }
  if (!error || typeof error !== "object") return false;
  const value = error as {
    message?: unknown;
    code?: unknown;
    response?: { data?: { error?: unknown; error_description?: unknown } };
  };
  return [value.message, value.code, value.response?.data?.error, value.response?.data?.error_description]
    .some((part) => typeof part === "string" && needsGoogleReconnect(part));
}

export const GOOGLE_RECONNECT_MESSAGE =
  "GOOGLE_RECONNECT_REQUIRED: Your Google account needs to be reconnected. Reconnect Google account to resume contacts sync.";

export function buildSheetSyncFailureEmail(params: {
  sheetLabel: string;
  errorMessage: string;
  errorAt: Date;
  contactsUrl: string;
}): { subject: string; text: string } {
  const reconnect = needsGoogleReconnect(params.errorMessage);
  return {
    subject: reconnect
      ? `Reconnect Google account — ${params.sheetLabel}`
      : `⚠️ Google Sheets sync failed — ${params.sheetLabel}`,
    text: [
      `The daily Google Sheets contacts sync failed at ${params.errorAt.toUTCString()}.`,
      "",
      `Sheet: ${params.sheetLabel}`,
      reconnect ? "Your Google account needs to be reconnected. Google access was revoked or the refresh token is no longer valid."
        : `Error: ${params.errorMessage}`,
      "",
      ...(reconnect ? [
        `Reconnect Google account: ${params.contactsUrl}?reconnectGoogle=1`,
        "Sign in to ProjectHub if prompted, then choose Reconnect Google account. Your connected sheet will be kept.",
        "Once connected, choose Sync now to resume contacts sync.",
      ] : [
        "Please check that the sheet is still published and the URL is correct.",
        "You can re-run the sync from the ProjectHub Contacts page once the issue is resolved.",
      ]),
    ].join("\n"),
  };
}