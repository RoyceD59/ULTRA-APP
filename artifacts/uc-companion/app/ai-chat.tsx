/**
 * Alison — Ultra-Clear AI Water Assistant
 *
 * Features:
 *  - Named "Alison", consultative/needs-finding personality
 *  - Follow-up suggestion chips after every AI reply
 *  - Auto-complete chips above input bar while typing
 *  - Animated typing indicator
 *  - 👍 / 👎 rating on every AI bubble → thumbs-down auto-retries
 *  - Rated answers sent to /api/uc/ai/chat-feedback (knowledge base)
 *  - Context-aware greeting when opened from Filter Tracker
 */
import React, {
  useState, useRef, useEffect, useCallback, useMemo,
} from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  FlatList, KeyboardAvoidingView, Platform, Animated, Easing, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '@/hooks/useColors';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useApi } from '@/hooks/useApi';
import { useAuth } from '@/context/AuthContext';
import { chatFailureMessage, completedChatHistory } from '@/lib/chatTurn';
import * as Haptics from 'expo-haptics';
import * as Crypto from 'expo-crypto';
import { trackEvent } from '@/lib/analytics';
import {
  loadConversations, saveConversation,
  type ChatConversation, type ChatMessage, type ChatFilterContext,
} from '@/lib/chatConversations';

// ── Types ─────────────────────────────────────────────────────────────────────

type Rating = 'up' | 'down';

type Message = ChatMessage;
type FilterContext = ChatFilterContext;

// ── Autocomplete pool ─────────────────────────────────────────────────────────

const AUTOCOMPLETE_POOL = [
  "Why does my water smell like chlorine?",
  "Is borehole water safe to drink?",
  "How do I know when to replace my filter?",
  "Why is my filter flow slow?",
  "What's the best filter for Nairobi mains water?",
  "How do I clean my filter cartridge?",
  "Does the Sweet Home filter remove fluoride?",
  "How often should I replace the Survivor Straw cartridge?",
  "Does Nairobi water have heavy metals?",
  "What filter is best for a family of 4?",
  "Can I use my filter with borehole water?",
  "Why does filtered water still taste off?",
  "How do I install the Sweet Home faucet filter?",
  "What is reverse osmosis and do I need it?",
  "How does rainy season affect my filter?",
  "What shower filter do you recommend?",
  "How do I book a water quality test?",
  "What is the EcoSmart Elite good for?",
  "How long does the bottle cartridge last?",
  "Can I filter rainwater with a bottle filter?",
];

// ── Link parser ───────────────────────────────────────────────────────────────
// Splits message text into plain text segments and markdown-style links
// so product/call/WhatsApp links Alison emits can render as tappable buttons.

type MsgPart =
  | { t: 'text'; v: string }
  | { t: 'link'; label: string; href: string };

function parseMessageContent(content: string): MsgPart[] {
  const parts: MsgPart[] = [];
  // Match [label](href) — Alison uses product:ID, tel:, and https://wa.me/
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) parts.push({ t: 'text', v: content.slice(last, m.index) });
    parts.push({ t: 'link', label: m[1], href: m[2] });
    last = m.index + m[0].length;
  }
  if (last < content.length) parts.push({ t: 'text', v: content.slice(last) });
  return parts;
}

// ── Greeting helpers ──────────────────────────────────────────────────────────

const GENERIC_GREETING =
  "Hi, I'm Alison 👋 — Ultra-Clear's water guide.\n\nI'm here to help you get clean, safe water at home or on the go. Tell me a bit about your situation — what kind of water do you use, or what problem are you trying to solve? I'll point you in the right direction.";

function buildContextGreeting(ctx: FilterContext): string {
  const parts: string[] = [];
  if (ctx.productName)   parts.push(`your **${ctx.productName}**`);
  if (ctx.daysRemaining !== undefined) {
    parts.push(ctx.daysRemaining > 0
      ? `${ctx.daysRemaining} day${ctx.daysRemaining === 1 ? '' : 's'} left on the cartridge`
      : 'a cartridge that\'s overdue for replacement');
  }
  if (ctx.waterSource) {
    const labels: Record<string, string> = {
      mains: 'Nairobi mains water', borehole: 'borehole water',
      surface: 'surface/rainwater', mixed: 'mixed mains + borehole',
    };
    parts.push(labels[ctx.waterSource] ?? ctx.waterSource);
  }
  const context = parts.length > 0 ? `I can see you have ${parts.join(', ')}. ` : '';
  return `Hi, I'm Alison 👋\n\n${context}What's on your mind? Whether it's water taste, filter performance, or when to replace — I'm here to help.`;
}

function buildInitialSuggestions(ctx: FilterContext): string[] {
  if (ctx.productName) {
    return [
      `How do I clean my ${ctx.productName}?`,
      ctx.waterSource === 'borehole'
        ? 'Does my filter handle iron in borehole water?'
        : 'Why does my water still taste of chlorine?',
      'When should I replace my cartridge?',
    ];
  }
  return [
    "What filter suits Nairobi mains water?",
    "Is borehole water safe to drink?",
    "Help me pick a filter for my home",
  ];
}

// ── Animated typing dots ──────────────────────────────────────────────────────

function TypingDots({ color }: { color: string }) {
  const dots = [
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
  ];

  useEffect(() => {
    const anims = dots.map((dot, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(dot, { toValue: 1, duration: 300, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0, duration: 300, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.delay(480 - i * 160),
        ])
      )
    );
    Animated.parallel(anims).start();
    return () => anims.forEach(a => a.stop());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.typingRow}>
      {dots.map((dot, i) => (
        <Animated.View
          key={i}
          style={[
            styles.dot,
            { backgroundColor: color, transform: [{ translateY: dot.interpolate({ inputRange: [0, 1], outputRange: [0, -5] }) }] },
          ]}
        />
      ))}
    </View>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

// ── Link handler ──────────────────────────────────────────────────────────────
// Called when a parsed link inside an Alison message is tapped.

function useLinkHandler() {
  const router = useRouter();
  return (href: string) => {
    if (href.startsWith('product:')) {
      const id = href.slice('product:'.length);
      router.push(`/product/${id}`);
      return;
    }
    Linking.openURL(href).catch(() => {});
  };
}

export default function AiChatScreen() {
  const { user } = useAuth();
  // Remount account-owned state so no old messages or late responses cross accounts.
  return <AccountChatScreen key={user?.id ?? 'guest'} userId={user?.id ?? null} />;
}

function AccountChatScreen({ userId }: { userId: number | null }) {
  const colors = useColors();
  const router = useRouter();
  const api    = useApi();
  const { token, isLoading: authLoading } = useAuth();
  const handleLink = useLinkHandler();

  const params = useLocalSearchParams<{
    productName?: string; daysRemaining?: string;
    waterSource?: string; lastCheckIn?: string; cleanCount?: string;
  }>();

  const routeContext: FilterContext = {
    productName:   params.productName   || undefined,
    daysRemaining: params.daysRemaining ? Number(params.daysRemaining) : undefined,
    waterSource:   params.waterSource   || undefined,
    lastCheckIn:   params.lastCheckIn   || undefined,
    cleanCount:    params.cleanCount    ? Number(params.cleanCount)    : undefined,
  };
  const [filterContext, setFilterContext] = useState<FilterContext>(routeContext);

  const hasContext         = Boolean(filterContext.productName || filterContext.waterSource);
  const initialGreeting    = hasContext ? buildContextGreeting(filterContext) : GENERIC_GREETING;
  const initialSuggestions = buildInitialSuggestions(filterContext);

  const [messages, setMessages] = useState<Message[]>([
    { id: 'greeting', role: 'assistant', content: initialGreeting, suggestions: initialSuggestions, noRating: true },
  ]);
  const [input,   setInput]   = useState('');
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [failedTurn, setFailedTurn] = useState<{
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
    turnId: string;
    message: string;
    rateLimited: boolean;
  } | null>(null);
  // Track which message id is currently being retried (shows "Trying again…" state)
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState(() => Crypto.randomUUID());
  const createdAt = useRef(Date.now());
  const pendingTurnId = useRef<string | undefined>(undefined);
  const lastSaved = useRef('');
  const [recent, setRecent] = useState<ChatConversation[]>([]);
  const [historyReady, setHistoryReady] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [showRecent, setShowRecent] = useState(true);
  const mounted = useRef(true);
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; requestRef.current?.abort(); };
  }, []);

  useEffect(() => {
    let active = true;
    if (!userId) { setHistoryReady(true); return; }
    loadConversations(userId).then(saved => {
      if (active) { setRecent(saved); setHistoryReady(true); }
    }).catch(() => {
      if (active) {
        setHistoryError('Recent conversations could not be loaded. This chat may not be saved on this device.');
        setHistoryReady(true);
      }
    });
    return () => { active = false; };
  }, [userId]);

  useEffect(() => {
    if (!userId || !historyReady || !messages.some(m => m.role === 'user')) return;
    const content = JSON.stringify({ messages, filterContext, pendingTurnId: pendingTurnId.current });
    if (lastSaved.current === content) return;
    lastSaved.current = content;
    saveConversation(userId, {
      id: conversationId, createdAt: createdAt.current, updatedAt: Date.now(),
      messages, filterContext, pendingTurnId: pendingTurnId.current,
    }).then(saved => {
      if (mounted.current) { setRecent(saved); setHistoryError(''); }
    }).catch(() => {
      if (mounted.current) setHistoryError('This conversation could not be saved on this device.');
    });
  }, [messages, filterContext, conversationId, historyReady, userId]);

  function openConversation(saved?: ChatConversation) {
    if (sendingRef.current || retryingId || !historyReady) return;
    setInput('');
    setFailedTurn(null);
    setShowRecent(false);
    pendingTurnId.current = saved?.pendingTurnId;
    createdAt.current = saved?.createdAt ?? Date.now();
    setConversationId(saved?.id ?? Crypto.randomUUID());
    const context = saved?.filterContext ?? routeContext;
    setFilterContext(context);
    const restored = saved?.messages ?? [{
      id: 'greeting', role: 'assistant' as const,
      content: context.productName || context.waterSource ? buildContextGreeting(context) : GENERIC_GREETING,
      suggestions: buildInitialSuggestions(context), noRating: true,
    }];
    lastSaved.current = JSON.stringify({ messages: restored, filterContext: context, pendingTurnId: saved?.pendingTurnId });
    setMessages(restored);
    if (saved?.pendingTurnId && restored.at(-1)?.role === 'user') {
      setFailedTurn({
        history: restored.filter(m => m.id !== 'greeting' && !m.noRating).map(({ role, content }) => ({ role, content })),
        turnId: saved.pendingTurnId,
        message: 'This question has no saved reply. Retry it or edit your question.', rateLimited: false,
      });
    }
  }

  const listRef = useRef<FlatList<Message>>(null);
  const scrollToBottom = useCallback(() => {
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
  }, []);
  useEffect(() => { if (messages.length > 1) scrollToBottom(); }, [messages.length, scrollToBottom]);

  // ── Autocomplete ───────────────────────────────────────────────────────────

  const autocomplete = useMemo(() => {
    const q = input.trim().toLowerCase();
    if (q.length < 3) return [];
    return AUTOCOMPLETE_POOL.filter(s => s.toLowerCase().includes(q)).slice(0, 3);
  }, [input]);

  // ── Send ──────────────────────────────────────────────────────────────────

  async function requestReply(
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    turnId: string,
    isRetry = false,
  ) {
    const controller = new AbortController();
    requestRef.current = controller;
    const deadline = setTimeout(() => controller.abort(), 25_000);
    try {
      const replyRequest = api.waterAiChat(
        history, conversationId, turnId, filterContext, isRetry, controller.signal,
      );
      trackEvent('alison_message_sent');
      const { reply, suggestions } = await replyRequest;
      if (!mounted.current) return;
      pendingTurnId.current = undefined;
      trackEvent('alison_reply_received');
      setMessages(prev => [...prev, {
        id: `a-${Crypto.randomUUID()}`, role: 'assistant', content: reply,
        suggestions: suggestions?.length ? suggestions : undefined,
      }]);
      setFailedTurn(null);
    } catch (error) {
      if (mounted.current && (!controller.signal.aborted || requestRef.current === controller)) {
        setFailedTurn({ history, turnId, message: chatFailureMessage(error),
          rateLimited: !!(error && typeof error === 'object' && 'status' in error && error.status === 429) });
      }
    } finally {
      clearTimeout(deadline);
      if (requestRef.current === controller) requestRef.current = null;
      sendingRef.current = false;
      setSending(false);
    }
  }

  async function handleSend(textOverride?: string) {
    const text = (textOverride ?? input).trim();
    if (!text || sendingRef.current || retryingId || failedTurn || !token || authLoading || !historyReady) return;
    sendingRef.current = true;
    const turnId = Crypto.randomUUID();
    pendingTurnId.current = turnId;
    setShowRecent(false);

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

    const userMsg: Message = { id: `u-${Crypto.randomUUID()}`, role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    if (!textOverride) setInput('');
    setSending(true);
    setFailedTurn(null);
    scrollToBottom();

    const history = [...completedChatHistory(messages), { role: 'user' as const, content: text }];
    await requestReply(history, turnId);
  }

  async function retryFailedTurn() {
    if (!failedTurn || sendingRef.current || !token) return;
    sendingRef.current = true;
    setSending(true);
    const { history, turnId } = failedTurn;
    setFailedTurn(null);
    await requestReply(history, turnId);
  }

  function editFailedTurn() {
    if (!failedTurn || sendingRef.current) return;
    const lastQuestion = failedTurn.history.at(-1)?.content ?? '';
    pendingTurnId.current = undefined;
    setMessages(prev => prev.slice(0, -1));
    setInput(lastQuestion);
    setFailedTurn(null);
  }

  // ── Retry (after thumbs-down) ─────────────────────────────────────────────

  async function handleRetry(ratedMsgId: string) {
    if (sendingRef.current || retryingId || !token) return;
    setRetryingId(ratedMsgId);

    // Build history up to (and including) the last user message before the rated reply
    const idx = messages.findIndex(m => m.id === ratedMsgId);
    const historySlice = messages
      .slice(0, idx)
      .filter(m => m.id !== 'greeting' && !m.noRating)
      .map(m => ({ role: m.role, content: m.content }));

    // historySlice must end with a user message — find the last one
    const lastUserIdx = [...historySlice].reverse().findIndex(m => m.role === 'user');
    if (lastUserIdx === -1) { setRetryingId(null); return; }
    const history = historySlice.slice(0, historySlice.length - lastUserIdx);

    try {
      const controller = new AbortController();
      requestRef.current = controller;
      const timeout = setTimeout(() => controller.abort(), 25_000);
      let result: Awaited<ReturnType<typeof api.waterAiChat>>;
      try {
        const replyRequest = api.waterAiChat(
          history, conversationId, Crypto.randomUUID(), filterContext, true, controller.signal,
        );
        trackEvent('alison_message_sent');
        result = await replyRequest;
      } finally {
        clearTimeout(timeout);
      }
      const { reply, suggestions } = result;
      if (!mounted.current) return;
      trackEvent('alison_reply_received');
      setMessages(prev => [...prev, {
        id:          `a-retry-${Date.now()}`,
        role:        'assistant',
        content:     reply,
        suggestions: suggestions?.length ? suggestions : undefined,
        retryOf:     ratedMsgId,
      }]);
    } catch (error) {
      if (!mounted.current) return;
      setMessages(prev => [...prev, {
        id:       `err-retry-${Date.now()}`,
        role:     'assistant',
         content:  chatFailureMessage(error),
        noRating: true,
      }]);
    } finally {
      setRetryingId(null);
    }
  }

  // ── Rating ────────────────────────────────────────────────────────────────

  async function handleRate(msg: Message, rating: Rating) {
    if (msg.rating) return; // already rated

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

    // Optimistically update UI
    setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, rating } : m));

    // Find the user question just before this message
    const idx = messages.findIndex(m => m.id === msg.id);
    const questionMsg = [...messages.slice(0, idx)].reverse().find(m => m.role === 'user');

    // Log to knowledge base (fire-and-forget)
    api.chatFeedback(rating, questionMsg?.content ?? '', msg.content).catch(() => {});

    // Thumbs-down → auto-retry with a different approach
    if (rating === 'down') {
      await handleRetry(msg.id);
    }
  }

  // ── Render message ────────────────────────────────────────────────────────

  function renderMessage({ item }: { item: Message }) {
    const isUser        = item.role === 'user';
    const showRating    = !isUser && !item.noRating;
    const isRetryingThis = retryingId === item.id;

    return (
      <View style={styles.msgGroup}>
        <View style={[styles.msgRow, isUser && styles.msgRowUser]}>
          {!isUser && (
            <View style={[styles.avatar, { backgroundColor: colors.primaryLight }]}>
              <Text style={styles.avatarLetter}>A</Text>
            </View>
          )}
          <View style={[
            styles.bubble,
            isUser
              ? [styles.bubbleUser, { backgroundColor: colors.primary }]
              : [styles.bubbleAI,   { backgroundColor: colors.surface, borderColor: colors.border }],
          ]}>
            <Text style={[styles.bubbleText, { color: isUser ? '#fff' : colors.text }]}>
              {isUser
                ? item.content
                : parseMessageContent(item.content).map((part, i) =>
                    part.t === 'text'
                      ? <Text key={i}>{part.v}</Text>
                      : (
                        <Text
                          key={i}
                          style={[styles.linkText, { color: colors.primary }]}
                          onPress={() => handleLink(part.href)}>
                          {part.label}
                        </Text>
                      )
                  )
              }
            </Text>
          </View>
        </View>

        {/* ── Rating row + retry feedback ──────────────────────────────── */}
        {showRating && (
          <View style={[styles.ratingRow, { marginLeft: 36 }]}>
            {isRetryingThis ? (
              <Text style={[styles.ratingHint, { color: colors.mutedForeground }]}>
                ↻ Trying a different approach…
              </Text>
            ) : item.rating === 'up' ? (
              <Text style={[styles.ratingHint, { color: '#22c55e' }]}>✓ Glad that helped!</Text>
            ) : item.rating === 'down' ? (
              <Text style={[styles.ratingHint, { color: colors.mutedForeground }]}>
                Thanks — see my next response ↓
              </Text>
            ) : (
              <>
                <Text style={[styles.ratingLabel, { color: colors.mutedForeground }]}>Helpful?</Text>
                <TouchableOpacity
                  onPress={() => handleRate(item, 'up')}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={[styles.ratingBtn, { borderColor: colors.border }]}>
                  <Ionicons name="thumbs-up-outline" size={14} color={colors.mutedForeground} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleRate(item, 'down')}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={[styles.ratingBtn, { borderColor: colors.border }]}>
                  <Ionicons name="thumbs-down-outline" size={14} color={colors.mutedForeground} />
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

        {/* ── Follow-up / quick-reply chips ────────────────────────────── */}
        {/* Only shown on the MOST RECENT assistant message so old chips
            cannot redirect an in-progress thread. */}
         {!isUser && !isRetryingThis && !sending && !failedTurn && !!token &&
         item.suggestions && item.suggestions.length > 0 &&
         messages.filter(m => m.role === 'assistant').at(-1)?.id === item.id && (
          <View style={[styles.chipRow, { marginLeft: 36 }]}>
            {item.suggestions.map(s => (
              <TouchableOpacity
                key={s}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                  handleSend(s);
                }}
                activeOpacity={0.75}
                style={[styles.followChip, {
                  borderColor:     colors.primary + '66',
                  backgroundColor: colors.primaryLight,
                }]}>
                <Ionicons name="return-down-forward-outline" size={11} color={colors.primary} style={{ marginRight: 3 }} />
                <Text style={[styles.followChipText, { color: colors.primary }]} numberOfLines={2}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    );
  }

  const topPad = Platform.OS === 'web' ? 67 : 0;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['bottom']}>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <View style={[styles.header, { backgroundColor: colors.card, borderColor: colors.border, marginTop: topPad }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={24} color={colors.primary} />
        </TouchableOpacity>
        <View style={[styles.headerAvatar, { backgroundColor: colors.primary }]}>
          <Text style={styles.headerAvatarText}>A</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Alison</Text>
          <View style={styles.headerSubRow}>
            <View style={styles.onlineDot} />
            <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>Ultra-Clear Water Guide</Text>
          </View>
        </View>
        {!!token && (
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Show recent conversations"
            onPress={() => setShowRecent(value => !value)} style={styles.backBtn}>
            <Ionicons name="time-outline" size={24} color={colors.primary} />
          </TouchableOpacity>
        )}
      </View>

      {/* ── Messages + input ──────────────────────────────────────────────── */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>

        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={m => m.id}
          renderItem={renderMessage}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => { if (!showRecent) scrollToBottom(); }}
          ListHeaderComponent={showRecent && !!token ? (
            <View style={{ gap: 8, marginBottom: 18 }}>
              <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>Recent conversations</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>Last 5 chats · kept for 30 days on this device</Text>
              {!historyReady ? <Text style={{ color: colors.mutedForeground }}>Loading conversations…</Text> :
                recent.length === 0 ? <Text style={{ color: colors.mutedForeground }}>No saved conversations yet.</Text> :
                recent.map(saved => (
                  <TouchableOpacity key={saved.id} accessibilityRole="button"
                    disabled={sending || !!retryingId} onPress={() => openConversation(saved)}
                    style={[styles.recentCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
                    <Text numberOfLines={1} style={{ color: colors.text, fontWeight: '600' }}>
                      {saved.messages.find(m => m.role === 'user')?.content}
                    </Text>
                    <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                      {new Date(saved.updatedAt).toLocaleDateString()}{saved.filterContext.productName ? ` · ${saved.filterContext.productName}` : ''}
                    </Text>
                  </TouchableOpacity>
                ))}
              <TouchableOpacity accessibilityRole="button" disabled={sending || !!retryingId || !historyReady}
                onPress={() => openConversation()} style={[styles.recentCard, { borderColor: colors.primary }]}>
                <Text style={{ color: colors.primary, fontWeight: '700' }}>New chat</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          ListFooterComponent={
            (sending && !retryingId) ? (
              <View style={[styles.msgRow, { marginTop: 4 }]}>
                <View style={[styles.avatar, { backgroundColor: colors.primaryLight }]}>
                  <Text style={styles.avatarLetter}>A</Text>
                </View>
                <View style={[styles.bubble, styles.bubbleAI, {
                  backgroundColor: colors.surface, borderColor: colors.border, paddingVertical: 14,
                }]}>
                  <TypingDots color={colors.mutedForeground} />
                </View>
              </View>
            ) : null
          }
        />
        {!!historyError && (
          <Text accessibilityRole="alert" style={[styles.historyNotice, { color: colors.mutedForeground }]}>{historyError}</Text>
        )}

        {!authLoading && !token && (
          <TouchableOpacity accessibilityRole="button" onPress={() => router.push('/auth/login')}
            style={[styles.notice, { backgroundColor: colors.primaryLight }]}>
            <Text style={{ color: colors.text, flex: 1 }}>Sign in to ask Alison a question.</Text>
            <Text style={{ color: colors.primary, fontWeight: '700' }}>Sign in</Text>
          </TouchableOpacity>
        )}
        {failedTurn && (
          <View style={[styles.notice, { backgroundColor: colors.primaryLight }]}>
            <Text style={{ color: colors.text, flex: 1 }}>{failedTurn.message}</Text>
            {!failedTurn.rateLimited && !!token && (
              <TouchableOpacity onPress={retryFailedTurn} accessibilityRole="button" style={styles.retryBtn}>
                <Text style={{ color: colors.primary, fontWeight: '700' }}>Retry</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={editFailedTurn} accessibilityRole="button" style={styles.retryBtn}>
              <Text style={{ color: colors.primary, fontWeight: '700' }}>Edit</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Autocomplete strip ──────────────────────────────────────────── */}
        {autocomplete.length > 0 && (
          <View style={[styles.autocompleteBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {autocomplete.map(s => (
              <TouchableOpacity
                key={s}
                onPress={() => setInput(s)}
                activeOpacity={0.75}
                style={[styles.autocompleteChip, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Ionicons name="search-outline" size={11} color={colors.mutedForeground} style={{ marginRight: 4 }} />
                <Text style={[styles.autocompleteText, { color: colors.text }]} numberOfLines={1}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* ── Input bar ──────────────────────────────────────────────────── */}
        <View style={[styles.inputBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Ask Alison about your water…"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]}
            multiline
            maxLength={600}
            returnKeyType="default"
            blurOnSubmit={false}
          />
          <TouchableOpacity
            onPress={() => handleSend()}
            disabled={!input.trim() || sending || !!retryingId || !token || authLoading || !historyReady || !!failedTurn}
            activeOpacity={0.8}
            style={[
              styles.sendBtn,
              { backgroundColor: input.trim() && !sending && !retryingId && !!token && !failedTurn ? colors.primary : colors.border },
            ]}>
            <Ionicons name="send" size={17} color="#fff" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  recentCard: { borderWidth: 1, borderRadius: 10, padding: 12, gap: 4 },
  historyNotice: { paddingHorizontal: 16, paddingVertical: 8, fontSize: 12 },
  safe: { flex: 1 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, minHeight: 52 },
  retryBtn: { minWidth: 48, minHeight: 44, justifyContent: 'center', alignItems: 'center' },

  header:           { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 11, borderBottomWidth: 1 },
  backBtn:          { padding: 2 },
  headerAvatar:     { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerAvatarText: { fontSize: 16, fontWeight: '700' as const, color: '#fff' },
  headerTitle:      { fontSize: 15, fontWeight: '700' as const },
  headerSubRow:     { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  onlineDot:        { width: 7, height: 7, borderRadius: 4, backgroundColor: '#22c55e' },
  headerSub:        { fontSize: 12 },

  list:       { padding: 16, paddingBottom: 12, gap: 10 },
  msgGroup:   { gap: 6 },
  msgRow:     { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  msgRowUser: { flexDirection: 'row-reverse' },

  avatar:       { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatarLetter: { fontSize: 13, fontWeight: '700' as const, color: '#0054A6' },

  bubble:     { maxWidth: '82%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1 },
  bubbleUser: { borderTopRightRadius: 4, borderWidth: 0 },
  bubbleAI:   { borderTopLeftRadius: 4 },
  bubbleText: { fontSize: 14, lineHeight: 22 },

  // Rating row
  ratingRow:  { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 24 },
  ratingLabel:{ fontSize: 11, opacity: 0.7 },
  ratingBtn:  { borderWidth: 1, borderRadius: 14, padding: 5 },
  ratingHint: { fontSize: 11, fontStyle: 'italic' },

  // Follow-up chips
  chipRow:        { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  followChip:     { borderWidth: 1, borderRadius: 14, paddingHorizontal: 11, paddingVertical: 6, maxWidth: 240 },
  followChipText: { fontSize: 12, fontWeight: '500' as const, lineHeight: 16 },

  // Autocomplete strip
  autocompleteBar:  { borderTopWidth: 1, paddingHorizontal: 12, paddingVertical: 6, gap: 6, flexDirection: 'column' },
  autocompleteChip: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  autocompleteText: { fontSize: 13, flex: 1 },

  // Inline links inside AI bubbles
  linkText: { textDecorationLine: 'underline' as const, fontWeight: '600' as const },

  // Typing dots
  typingRow: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 2 },
  dot:       { width: 7, height: 7, borderRadius: 4 },

  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10,
    paddingHorizontal: 12, paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 24 : 12,
    borderTopWidth: 1,
  },
  input:   { flex: 1, borderRadius: 22, borderWidth: 1, paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 10 : 8, fontSize: 14, maxHeight: 110 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
});
