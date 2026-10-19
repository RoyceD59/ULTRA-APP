import { existsSync } from 'node:fs';

/** Explicit operator override, Replit provisioned browser, or Playwright's pinned browser. */
export function browserExecutablePath() {
  return process.env.CHROMIUM_PATH
    || (existsSync('/repl/tools/bin/chromium') ? '/repl/tools/bin/chromium' : undefined);
}
