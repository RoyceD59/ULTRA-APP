import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';

const messageSchema = z.object({
  id: z.string(), role: z.enum(['user', 'assistant']), content: z.string(),
  suggestions: z.array(z.string()).optional(), rating: z.enum(['up', 'down']).optional(),
  noRating: z.boolean().optional(), retryOf: z.string().optional(),
  feedbackToken: z.string().optional(),
});
const contextSchema = z.object({
  productName: z.string().optional(), daysRemaining: z.number().finite().optional(),
  waterSource: z.string().optional(), lastCheckIn: z.string().optional(),
  cleanCount: z.number().finite().optional(),
});
const conversationSchema = z.object({
  id: z.string(), createdAt: z.number().finite(), updatedAt: z.number().finite(),
  messages: z.array(messageSchema), filterContext: contextSchema,
  pendingTurnId: z.string().optional(),
});
export type ChatMessage = z.infer<typeof messageSchema>;
export type ChatFilterContext = z.infer<typeof contextSchema>;
export type ChatConversation = z.infer<typeof conversationSchema>;
export const CHAT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const CHAT_HISTORY_LIMIT = 5;

export function chatConversationsKey(userId: number): string {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('Chat history requires a signed-in account.');
  return `uc_chat_conversations_${userId}`;
}

export function pruneConversations(conversations: ChatConversation[], now = Date.now()): ChatConversation[] {
  const seen = new Set<string>();
  return conversations
    .filter(c => c.createdAt >= now - CHAT_RETENTION_MS && c.createdAt <= now &&
      c.updatedAt >= c.createdAt && c.updatedAt <= now && c.messages.some(m => m.role === 'user'))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true; })
    .slice(0, CHAT_HISTORY_LIMIT);
}

// Serialize read/modify/write across screen mounts, including rapid back/open.
const queues = new Map<string, Promise<unknown>>();
function enqueue<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(action);
  queues.set(key, next);
  void next.finally(() => { if (queues.get(key) === next) queues.delete(key); }).catch(() => undefined);
  return next;
}

async function read(key: string): Promise<ChatConversation[]> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('Saved chat history is unreadable.');
  const valid: ChatConversation[] = [];
  for (const value of parsed) {
    const result = conversationSchema.safeParse(value);
    if (!result.success) throw new Error('Saved chat history is unreadable.');
    valid.push(result.data);
  }
  return valid;
}

export function loadConversations(userId: number): Promise<ChatConversation[]> {
  const key = chatConversationsKey(userId);
  return enqueue(key, async () => {
    const saved = await read(key);
    const recent = pruneConversations(saved);
    if (JSON.stringify(saved) !== JSON.stringify(recent)) {
      await AsyncStorage.setItem(key, JSON.stringify(recent));
    }
    return recent;
  });
}

export function saveConversation(userId: number, conversation: ChatConversation): Promise<ChatConversation[]> {
  const key = chatConversationsKey(userId);
  // Capture before waiting in the queue; callers may change screens meanwhile.
  const snapshot = conversationSchema.parse(conversation);
  return enqueue(key, async () => {
    const saved = await read(key);
    const recent = pruneConversations([snapshot, ...saved.filter(c => c.id !== snapshot.id)]);
    await AsyncStorage.setItem(key, JSON.stringify(recent));
    return recent;
  });
}