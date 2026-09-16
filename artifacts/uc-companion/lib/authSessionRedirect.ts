export function shouldRedirectToLogin(
  previousToken: string | null,
  currentToken: string | null,
): boolean {
  return previousToken !== null && currentToken === null;
}