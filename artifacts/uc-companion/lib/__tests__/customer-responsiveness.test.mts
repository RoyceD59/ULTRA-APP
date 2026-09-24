import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { cartBackDestination, featuredState } from '../customerScreenState.ts';
import { chatFailureMessage, completedChatHistory } from '../chatTurn.ts';

test('basket returns through existing history, otherwise goes to the shop', () => {
  assert.equal(cartBackDestination(true), 'back');
  assert.equal(cartBackDestination(false), '/(tabs)/products');
});

test('featured products have independent loading, error, empty and ready states', () => {
  assert.equal(featuredState(true, false, 0), 'loading');
  assert.equal(featuredState(false, true, 0), 'error');
  assert.equal(featuredState(false, false, 0), 'empty');
  assert.equal(featuredState(false, false, 1), 'ready');
});

test('chat retry sends only completed turns and one unanswered question', () => {
  const messages = [
    { id: 'greeting', role: 'assistant' as const, content: 'Hello', noRating: true },
    { id: 'u1', role: 'user' as const, content: 'Question one' },
    { id: 'a1', role: 'assistant' as const, content: 'Answer one' },
    { id: 'u2', role: 'user' as const, content: 'Question two' },
  ];
  const history = [...completedChatHistory(messages), { role: 'user' as const, content: 'Question two' }];
  assert.deepEqual(history.map(m => m.content), ['Question one', 'Answer one', 'Question two']);
  assert.match(chatFailureMessage(Object.assign(new Error('aborted'), { name: 'AbortError' })), /too long/);
  assert.match(chatFailureMessage({ status: 401 }), /Sign in/);
  assert.match(chatFailureMessage({ status: 429 }), /wait a minute/);
});

test('unsupported endorsements are absent from shared badges and other screen source', () => {
  for (const path of ['components/TrustBadges.tsx', 'app/(tabs)/index.tsx', 'app/product/[id].tsx']) {
    const source = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').replace(/\\n/g, ' ');
    assert.doesNotMatch(source, /Ghana\s*Olympics|WHO\s*Compliant|Unilever\s*Partner/i);
  }
  const badges = readFileSync(new URL('../../components/TrustBadges.tsx', import.meta.url), 'utf8');
  assert.match(badges, /ISO 9001/);
  assert.match(badges, /BPA/);
});