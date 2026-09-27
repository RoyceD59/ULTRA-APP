/** Read the reset token from an Expo Router query parameter. */
export function readResetTokenParam(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

const DEFAULT_RESET_REQUEST_ERROR = "Something went wrong. Please try again.";

/** Return the API's user-facing reset-request error without allowing a blank message. */
export function getResetRequestError(
  status: number,
  body: { error?: unknown },
): string {
  if (typeof body.error === "string" && body.error.trim()) {
    return body.error;
  }

  return status === 429
    ? "Too many attempts. Please wait a minute before trying again."
    : DEFAULT_RESET_REQUEST_ERROR;
}
