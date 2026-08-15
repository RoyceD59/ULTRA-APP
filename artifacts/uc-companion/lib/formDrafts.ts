/**
 * Lightweight per-form draft persistence (AsyncStorage).
 *
 * Used by the account-gated request screens (service request, water test) so
 * a guest who is sent through sign-in / registration mid-flow returns to the
 * form with everything they typed — fields, selections, and
 * attachments-in-progress — intact.
 *
 * Drafts are device-local, never sent to the server, and cleared on
 * successful submission.
 *
 * Concurrency model:
 *  All save operations for a given draft key are serialised through a per-key
 *  promise queue (enqueueDraftSave).  This prevents a later, faster save from
 *  being overwritten by an earlier one that was stalled on its first-call
 *  AsyncStorage read.  Callers await drainDraftSaveQueue before clearDraft so
 *  no queued write can recreate the draft after it has been erased.
 *
 * Media persistence:
 *  - persistMediaForDraft  copies picker-cache files into the app's documents
 *    directory before storing URIs so they survive OS cache cleanup between
 *    app launches.  On the first call per key per session it seeds the orphan-
 *    tracking set from the persisted draft (cold-restart safety).  Orphaned
 *    copies (items removed mid-session) are deleted on the next save.
 *  - validateMediaItems    checks each URI on draft restore and silently drops
 *    entries whose files are gone, returning a count so the screen can tell
 *    the user how many attachments need re-adding.
 *  - clearDraft            deletes the durable copies before removing the
 *    AsyncStorage entry so media never outlives the draft lifecycle.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { File as EXFile, Directory as EXDirectory, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import type { MediaItem } from '@/components/MediaPicker';

export type DraftKey = 'ticket' | 'water-test';

const storageKey = (key: DraftKey) => `uc_form_draft:${key}`;

// ── Serial save queue ─────────────────────────────────────────────────────────

/**
 * Per-key promise queue.  Each enqueued task runs only after the previous one
 * completes, so concurrent effect firings never overwrite a newer save with an
 * older stale snapshot.
 */
const saveQueues = new Map<DraftKey, Promise<void>>();

/**
 * Enqueue a save operation for `key`.  The provided async function runs after
 * the previous task for the same key has settled — whether it resolved or
 * rejected — so a transient failure never blocks future saves.
 * Returns a promise that resolves when `fn` has finished (or been swallowed
 * on error), allowing callers to `await enqueueDraftSave(...)` for ordered
 * navigation (goToAuth) or drain checks (drainDraftSaveQueue).
 */
export function enqueueDraftSave(key: DraftKey, fn: () => Promise<void>): Promise<void> {
  const prev = saveQueues.get(key) ?? Promise.resolve();
  // Use both then-handlers so fn always runs regardless of predecessor outcome.
  const next = prev.then(
    () => fn(),
    () => fn(),
  ).catch(() => {
    // Swallow fn's errors to keep the queue alive and prevent unhandled rejections.
  });
  saveQueues.set(key, next);
  return next;
}

/**
 * Await the current tail of the save queue for `key`.
 * Call this (then immediately set the cancellation flag) before clearDraft so
 * no already-started write can complete after the draft has been erased.
 */
export async function drainDraftSaveQueue(key: DraftKey): Promise<void> {
  await (saveQueues.get(key) ?? Promise.resolve());
}

// ── Module-level tracking ─────────────────────────────────────────────────────

/**
 * Stable URIs (inside the draft-media dir) currently stored per draft key.
 * Updated on every persistMediaForDraft call; used to diff and delete orphans.
 */
const persistedStableUris = new Map<DraftKey, Set<string>>();

/**
 * Per-key session cache: originalUri → stableUri.
 * Scoped by key so each draft owns its own physical copy — clearing one draft
 * cannot invalidate the other draft's attachments.
 */
const sessionUriCache = new Map<DraftKey, Map<string, string>>();

/**
 * Keys whose tracking set has been initialised this session.
 * Prevents redundant AsyncStorage reads after the first call per key.
 */
const initializedKeys = new Set<DraftKey>();

// ── Directory helpers ─────────────────────────────────────────────────────────

/**
 * Returns the app's durable draft-media directory, creating it if needed.
 * Returns null on web (no filesystem) or when setup fails.
 *
 * expo-file-system v19 synchronous OO API:
 *   Directory.exists, Directory.create(), File.copy(), File.exists.
 */
function getDraftMediaDir(): EXDirectory | null {
  if (Platform.OS === 'web') return null;
  try {
    const dir = new EXDirectory(Paths.document, 'uc-draft-media');
    if (!dir.exists) {
      dir.create({ intermediates: true, idempotent: true });
    }
    return dir;
  } catch {
    return null;
  }
}

/** Delete a stable-URI file from the draft-media directory. Ignores all errors. */
function deleteDraftMediaFile(uri: string): void {
  try {
    const file = new EXFile(uri);
    if (file.exists) file.delete();
  } catch {
    // Ignore — file already gone or protected.
  }
}

/**
 * Load the stable URIs (those inside the draft-media dir) from the persisted
 * draft.  Used to seed the tracking set on the first call after a cold restart
 * so cross-launch orphan detection works correctly.
 */
async function loadStableUrisFromDraft(
  key: DraftKey,
  dir: EXDirectory,
): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(key));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const media = Array.isArray(parsed?.media) ? (parsed.media as MediaItem[]) : [];
    return new Set(
      media
        .map(m => m.uri)
        .filter((uri): uri is string => typeof uri === 'string' && uri.startsWith(dir.uri)),
    );
  } catch {
    return new Set();
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Persist the current form state. Fire-and-forget safe — never throws. */
export async function saveDraft<T extends object>(key: DraftKey, data: T): Promise<void> {
  try {
    await AsyncStorage.setItem(storageKey(key), JSON.stringify(data));
  } catch {
    // Non-critical: worst case the user retypes the form.
  }
}

/** Load a previously saved draft, or null when none exists. */
export async function loadDraft<T extends object>(key: DraftKey): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as T) : null;
  } catch {
    return null;
  }
}

/**
 * Remove the draft and delete any durable media copies associated with it.
 *
 * IMPORTANT: callers must set their cancellation flag and await
 * drainDraftSaveQueue before calling this, so no queued write can recreate
 * the draft after clearDraft returns.
 */
export async function clearDraft(key: DraftKey): Promise<void> {
  // 1. Determine which stable URIs to clean up.
  //    Prefer the in-memory tracking set (populated if persistMediaForDraft
  //    ran this session).  Fall back to reading the draft from AsyncStorage
  //    for cold-restart submits where persistMediaForDraft was never called.
  const tracked = persistedStableUris.get(key);
  const urisToDelete: Set<string> = tracked
    ? new Set(tracked)
    : await (async () => {
        const dir = getDraftMediaDir();
        if (!dir) return new Set<string>();
        return loadStableUrisFromDraft(key, dir);
      })();

  // 2. Delete the durable copies.
  for (const uri of urisToDelete) {
    deleteDraftMediaFile(uri);
  }

  // 3. Clean up all tracking state for this key.
  persistedStableUris.delete(key);
  sessionUriCache.delete(key);
  initializedKeys.delete(key);

  // 4. Remove the AsyncStorage entry.
  try {
    await AsyncStorage.removeItem(storageKey(key));
  } catch {
    // ignore
  }
}

/**
 * Copy media items that live in the image-picker's cache into the app's
 * document directory so their URIs remain valid after an app restart or OS
 * cache cleanup.
 *
 * Behaviour:
 * - First call per key per session: seeds the orphan-tracking set from the
 *   persisted draft (AsyncStorage) so cross-launch removals are detected.
 * - Subsequent calls: uses the in-memory tracking set — no AsyncStorage read.
 * - Items already inside the draft-media directory are returned unchanged.
 * - Within one app session, each original picker URI is only copied once per
 *   key (per-key sessionUriCache); subsequent saves re-use the same stable copy.
 * - Stable copies absent from the current `items` (including when items is
 *   empty) are treated as orphans and deleted immediately.
 *
 * Must be called from inside an enqueueDraftSave callback so concurrent
 * invocations are serialised and the orphan-tracking diff is always applied
 * against the most recent state.
 *
 * Returns a new array with stable URIs suitable for storing in a draft.
 * The caller's in-memory state (original URIs) stays valid for the current
 * session; only the persisted draft needs the stable paths.
 */
export async function persistMediaForDraft(
  items: MediaItem[],
  draftKey: DraftKey,
): Promise<MediaItem[]> {
  if (Platform.OS === 'web') return items;

  const dir = getDraftMediaDir();
  if (!dir) return items;

  // Seed tracking from the persisted draft on the first call this session.
  if (!initializedKeys.has(draftKey)) {
    initializedKeys.add(draftKey);
    if (!persistedStableUris.has(draftKey)) {
      const seeded = await loadStableUrisFromDraft(draftKey, dir);
      persistedStableUris.set(draftKey, seeded);
    }
  }

  const previousStable = persistedStableUris.get(draftKey) ?? new Set<string>();

  // Empty-items case: delete ALL previously-copied files so none are orphaned
  // when every attachment is removed before clear/submit.
  if (!items.length) {
    for (const uri of previousStable) {
      deleteDraftMediaFile(uri);
    }
    persistedStableUris.set(draftKey, new Set());
    return items;
  }

  // Per-key session cache — each draft owns its own physical copy.
  const keyCache = sessionUriCache.get(draftKey) ?? new Map<string, string>();
  sessionUriCache.set(draftKey, keyCache);

  const nextStable = new Set<string>();

  const result = items.map((item): MediaItem => {
    try {
      // Already a stable URI in our directory — re-use it.
      if (item.uri.startsWith(dir.uri)) {
        nextStable.add(item.uri);
        return item;
      }

      // Check per-key session cache — avoid copying the same source twice.
      const cached = keyCache.get(item.uri);
      if (cached) {
        try {
          // The cached destination may have been deleted as an orphan in a
          // prior save (e.g. user removed then re-added the same picker file).
          // Verify it still exists before reusing; evict and re-copy if not.
          const cachedFile = new EXFile(cached);
          if (cachedFile.exists) {
            nextStable.add(cached);
            return { ...item, uri: cached };
          }
        } catch {
          // Treat any error as "gone".
        }
        keyCache.delete(item.uri);
        // Fall through to re-copy below.
      }

      // Copy to stable location.
      const src = new EXFile(item.uri);
      // .extension already includes the dot (e.g. ".jpg").
      const ext = src.extension || (item.type === 'video' ? '.mp4' : '.jpg');
      const uniqueName =
        `${item.type}-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
      const dest = new EXFile(dir, uniqueName);
      src.copy(dest);

      keyCache.set(item.uri, dest.uri);
      nextStable.add(dest.uri);
      return { ...item, uri: dest.uri };
    } catch {
      // Copy failed (e.g. source already evicted from cache this session).
      // Keep original URI — validateMediaItems will drop it on the next restore.
      return item;
    }
  });

  // Delete stable copies no longer in the current list (orphans from removals).
  for (const staleUri of previousStable) {
    if (!nextStable.has(staleUri)) {
      deleteDraftMediaFile(staleUri);
    }
  }

  persistedStableUris.set(draftKey, nextStable);
  return result;
}

/**
 * Check each media URI and silently drop entries whose files no longer exist
 * on disk.  Returns the surviving items and how many were removed so the
 * caller can tell the user which attachments need re-adding.
 *
 * expo-file-system v19: File.exists is a synchronous boolean property.
 */
export async function validateMediaItems(
  items: MediaItem[],
): Promise<{ valid: MediaItem[]; dropped: number }> {
  if (!items.length) return { valid: [], dropped: 0 };
  if (Platform.OS === 'web') return { valid: items, dropped: 0 };

  const valid: MediaItem[] = [];
  for (const item of items) {
    try {
      const file = new EXFile(item.uri);
      if (file.exists) valid.push(item);
    } catch {
      // Treat any error as "not found" — safer to re-add than silently fail.
    }
  }
  return { valid, dropped: items.length - valid.length };
}
