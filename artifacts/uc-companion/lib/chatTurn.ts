export interface ChatTurnMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  noRating?: boolean;
}

/** Never send greeting, failure notices, or an unanswered user turn as model context. */
export function completedChatHistory(messages: ChatTurnMessage[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  const history = messages.filter(m => m.id !== 'greeting' && !m.noRating)
    .map(({ role, content }) => ({ role, content }));
  while (history.at(-1)?.role === 'user') history.pop();
  return history;
}

export function chatFailureMessage(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') return 'Alison took too long to respond. Check your connection and try again.';
  if (error && typeof error === 'object' && 'status' in error) {
    if (error.status === 401) return 'Your session has expired. Sign in again to ask Alison.';
    if (error.status === 429) return 'Too many messages right now. Please wait a minute before retrying.';
  }
  return 'Alison is unavailable right now. Check your connection and try again, or contact UCFilters support at 0717774049.';
}