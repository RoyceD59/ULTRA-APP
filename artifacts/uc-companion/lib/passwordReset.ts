/** Read the reset token from an Expo Router query parameter. */
export function readResetTokenParam(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}