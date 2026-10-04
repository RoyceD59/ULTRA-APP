import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  CHAT_RETENTION_MS, chatConversationsKey, loadConversations,
  pruneConversations, saveConversation, type ChatConversation,
} from '../chatConversations';

const storage = AsyncStorage as unknown as {
  _storage: Map<string, string>; _reset(): void;
  _setGates(gates: { get?: () => Promise<void>; set?: () => Promise<void> }): void;
};
function conversation(id = 'one', time = Date.now() - 1000): ChatConversation {
  return {
    id, createdAt: time, updatedAt: time,
    messages: [
      { id: 'greeting', role: 'assistant', content: 'Hello', noRating: true },
      { id: 'question', role: 'user', content: 'When should I replace it?' },
      { id: 'answer', role: 'assistant', content: 'Check your cartridge.', rating: 'up', suggestions: ['How do I clean it?'] },
    ],
    filterContext: { productName: 'Original filter', waterSource: 'borehole', cleanCount: 2, daysRemaining: 5, lastCheckIn: '2026-10-01' },
  };
}

describe('recent Alison conversations', () => {
  beforeEach(() => storage._reset());

  it('round trips messages, ratings, suggestions and the original filter snapshot after reopening', async () => {
    const saved = conversation();
    await saveConversation(42, saved);
    assert.deepEqual(await loadConversations(42), [saved]);
  });

  it('keeps accounts isolated and never uses a guest or shared key', async () => {
    await saveConversation(42, conversation());
    assert.deepEqual(await loadConversations(43), []);
    assert.throws(() => chatConversationsKey(0));
    assert.throws(() => chatConversationsKey(NaN));
  });

  it('retains the five most recently updated conversations without duplicates', async () => {
    for (let i = 0; i < 7; i++) await saveConversation(42, conversation(String(i), Date.now() - 10000 + i));
    const first = conversation('0', Date.now() - 10000);
    first.updatedAt = Date.now();
    await saveConversation(42, first);
    assert.deepEqual((await loadConversations(42)).map(c => c.id), ['0', '6', '5', '4', '3']);
  });

  it('prunes by original creation date, including chats recently resumed', async () => {
    const now = Date.now();
    const expired = conversation('expired', now - CHAT_RETENTION_MS - 1);
    expired.updatedAt = now;
    const boundary = conversation('boundary', now - CHAT_RETENTION_MS);
    assert.deepEqual(pruneConversations([expired, boundary], now), [boundary]);
    storage._storage.set(chatConversationsKey(42), JSON.stringify([expired, conversation('fresh')]));
    assert.equal((await loadConversations(42)).length, 1);
    assert.equal(JSON.parse(storage._storage.get(chatConversationsKey(42))!).length, 1);
  });

  it('does not fill the history with greeting-only chats', async () => {
    const empty = conversation();
    empty.messages = empty.messages.slice(0, 1);
    await saveConversation(42, empty);
    assert.deepEqual(await loadConversations(42), []);
  });

  it('preserves the turn identity for questions interrupted before a reply', async () => {
    const pending = conversation();
    pending.messages.pop();
    pending.pendingTurnId = 'original-request';
    await saveConversation(42, pending);
    assert.deepEqual(await loadConversations(42), [pending]);
    pending.pendingTurnId = undefined;
    pending.messages.push({ id: 'reply', role: 'assistant', content: 'Recovered reply' });
    await saveConversation(42, pending);
    assert.equal((await loadConversations(42))[0].pendingTurnId, undefined);
  });

  it('serializes rapid saves and reopening so newer messages are not overwritten', async () => {
    const older = conversation();
    const newer = conversation();
    newer.messages.push({ id: 'follow-up', role: 'user', content: 'And cleaning?' });
    const writes = [saveConversation(42, older), saveConversation(42, newer)];
    const reopening = loadConversations(42);
    await Promise.all(writes);
    assert.deepEqual((await reopening)[0].messages, newer.messages);
  });

  it('reports corrupt storage without silently erasing conversations', async () => {
    const key = chatConversationsKey(42);
    storage._storage.set(key, '{broken');
    await assert.rejects(loadConversations(42));
    await assert.rejects(saveConversation(42, conversation()));
    assert.equal(storage._storage.get(key), '{broken');
    storage._storage.set(key, JSON.stringify([{ id: 'bad' }]));
    await assert.rejects(loadConversations(42));
  });

  it('reports storage failures and allows subsequent writes to recover', async () => {
    storage._setGates({ set: async () => { throw new Error('Storage full'); } });
    await assert.rejects(saveConversation(42, conversation()), /Storage full/);
    storage._setGates({});
    await saveConversation(42, conversation());
    assert.equal((await loadConversations(42)).length, 1);
  });
});