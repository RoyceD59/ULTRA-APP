import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';
import ts from 'typescript';
import { ApiError } from '../apiError.ts';
import {
  DELETED_ACCOUNT_ERROR,
  PASSWORD_RESET_SESSION_ERROR,
  handleRejectedSessionResponse,
  setRejectedSessionHandler,
} from '../deletedAccountResponse.js';

// Run the real useApi error parser with only the hook boundary replaced.
const source = readFileSync(new URL('../useApi.ts', import.meta.url), 'utf8');
const start = source.indexOf('  const throwResponseError =');
const end = source.indexOf('  const get =', start);
assert.ok(start >= 0 && end > start);
const parser = ts.transpileModule(
  `${source.slice(start, end)}\nreturn throwResponseError;`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;
const throwResponseError = new Function(
  'useCallback', 'ApiError', 'handleRejectedSessionResponse', 'token', parser,
)(
  (callback: unknown) => callback, ApiError, handleRejectedSessionResponse, 'request-token',
) as (response: Response) => Promise<never>;

let unregister: (() => void) | undefined;
afterEach(() => { unregister?.(); });

for (const message of [DELETED_ACCOUNT_ERROR, PASSWORD_RESET_SESSION_ERROR, 'Unauthorized']) {
  test(`useApi passes the exact parsed ${message} response to session handling`, async () => {
    const tokens: string[] = [];
    unregister = setRejectedSessionHandler(async token => { tokens.push(token); });
    await assert.rejects(
      throwResponseError(new Response(JSON.stringify({ error: message }), {
        status: 401, headers: { 'Content-Type': 'application/json' },
      })),
      (error: ApiError) => error.status === 401 && error.body.error === message,
    );
    assert.deepEqual(tokens, message === 'Unauthorized' ? [] : ['request-token']);
  });
}