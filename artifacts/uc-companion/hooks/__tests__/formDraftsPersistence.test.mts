/**
 * Tests for draft-media persistence in lib/formDrafts.ts.
 *
 * Verified scenarios:
 *
 *  A. persistMediaForDraft copies picker-cache files to the durable document
 *     directory and returns stable URIs.
 *  B. Cold-restart survival: stable URIs stored in AsyncStorage are found and
 *     validated after all in-memory state is cleared (simulating a force-quit
 *     and relaunch).
 *  C. Yellow "re-add" warning path: validateMediaItems drops entries whose
 *     files are genuinely gone (e.g. after an external cache clear) and
 *     returns a non-zero dropped count.
 *  D. Orphan cleanup: removing an item from the draft list causes its durable
 *     copy to be deleted on the next persistMediaForDraft call.
 *  E. Re-add the same source after it was removed — stale cache entry is
 *     evicted and the file is re-copied correctly.
 *  F. clearDraft deletes durable media copies and the AsyncStorage entry.
 *  G. Cross-draft isolation: 'ticket' and 'water-test' drafts have independent
 *     stable-URI sets and never step on each other.
 *  H. Cold-restart submit: clearDraft can locate stable URIs from AsyncStorage
 *     alone (no in-memory state) and delete them.
 *  I. Web platform: persistMediaForDraft and validateMediaItems are no-ops and
 *     return items unchanged / dropped=0.
 *
 * Run with: pnpm --filter @workspace/uc-companion test
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── AsyncStorage stub ─────────────────────────────────────────────────────────
// @ts-ignore — stub exports private helpers not present in real package types
import AsyncStorageStub from '@react-native-async-storage/async-storage';
const _resetStorage: () => void = (AsyncStorageStub as any)._reset;
const _storage: Map<string, string> = (AsyncStorageStub as any)._storage;

// ── expo-file-system stub ─────────────────────────────────────────────────────
// @ts-ignore — stub exports private helpers not present in real package types
import * as EFSStub from 'expo-file-system';
const _vfs: Map<string, Buffer> = (EFSStub as any)._vfs;
const _setFileExists: (uri: string, exists: boolean) => void =
  (EFSStub as any)._setFileExists;
const _resetVFS: () => void = (EFSStub as any)._reset;

// ── react-native stub (Platform) ──────────────────────────────────────────────
// @ts-ignore
import * as RN from 'react-native';
const Platform: { OS: string } = (RN as any).Platform;

// ── Unit under test ───────────────────────────────────────────────────────────
import {
  persistMediaForDraft,
  validateMediaItems,
  saveDraft,
  loadDraft,
  clearDraft,
  __resetForTesting,
} from '../../lib/formDrafts.js';
import type { MediaItem } from '../../components/MediaPicker.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Draft-media document directory prefix (matches the stub's Paths.document). */
const DRAFT_DIR = 'file:///documents/uc-draft-media/';

/** Build a picker-cache URI that lives outside the document directory. */
function pickerUri(name: string): string {
  return `file:///var/mobile/cache/ImagePicker/${name}`;
}

function photo(uri: string, extra: Partial<MediaItem> = {}): MediaItem {
  return { uri, type: 'photo', ...extra };
}

/** True when the given URI is inside the durable draft-media directory. */
function isStable(uri: string): boolean {
  return uri.startsWith(DRAFT_DIR);
}

/** Tick lets queued microtasks (Promise chains) settle. */
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  _resetStorage();
  _resetVFS();
  __resetForTesting();
  // Ensure we run as a native platform for every test unless overridden.
  (Platform as any).OS = 'ios';
});

// ── A. Copy to stable location ────────────────────────────────────────────────

describe('A: persistMediaForDraft — copy to durable directory', () => {
  it('A1: returns stable URIs inside the draft-media directory', async () => {
    const src = pickerUri('photo1.jpg');
    _setFileExists(src, true);

    const items = [photo(src)];
    const result = await persistMediaForDraft(items, 'ticket');

    assert.equal(result.length, 1);
    assert.ok(isStable(result[0]!.uri),
      `expected stable URI under ${DRAFT_DIR}, got ${result[0]!.uri}`);
  });

  it('A2: stable file is present in the virtual filesystem after copy', async () => {
    const src = pickerUri('photo2.jpg');
    _setFileExists(src, true);

    const result = await persistMediaForDraft([photo(src)], 'ticket');
    const stableUri = result[0]!.uri;

    assert.ok(_vfs.has(stableUri),
      'stable URI must exist in the VFS after copy');
  });

  it('A3: items already inside the draft-media dir are returned unchanged', async () => {
    const stableUri = `${DRAFT_DIR}photo-existing.jpg`;
    _setFileExists(stableUri, true);

    const result = await persistMediaForDraft([photo(stableUri)], 'ticket');

    assert.equal(result[0]!.uri, stableUri,
      'already-stable URI must pass through without re-copying');
  });

  it('A4: a second call with the same source re-uses the cached stable URI', async () => {
    const src = pickerUri('photo3.jpg');
    _setFileExists(src, true);

    const first  = await persistMediaForDraft([photo(src)], 'ticket');
    const second = await persistMediaForDraft([photo(src)], 'ticket');

    assert.equal(first[0]!.uri, second[0]!.uri,
      'stable URI must be the same on both calls (cache hit)');
    // Only one file should exist — no duplicate copies.
    const stableFiles = [..._vfs.keys()].filter(isStable);
    assert.equal(stableFiles.length, 1, 'only one stable copy should exist');
  });
});

// ── B. Cold-restart survival ──────────────────────────────────────────────────

describe('B: cold-restart survival — stable files survive session boundary', () => {
  it('B1: validateMediaItems returns dropped=0 when stable files still exist', async () => {
    // "First session": copy files and save the draft.
    const src = pickerUri('cold-restart.jpg');
    _setFileExists(src, true);
    const persistedItems = await persistMediaForDraft([photo(src)], 'ticket');
    await saveDraft('ticket', { media: persistedItems });

    // "App force-quit": clear all in-memory module state.
    __resetForTesting();
    // The VFS and AsyncStorage are intentionally NOT reset — they simulate
    // durable storage that survives a process restart.

    // "Second session": restore the draft and validate.
    const draft = await loadDraft<{ media: MediaItem[] }>('ticket');
    assert.ok(draft, 'draft must be present in AsyncStorage after restart');

    const { valid, dropped } = await validateMediaItems(draft.media);
    assert.equal(dropped, 0,
      'no items should be dropped — stable files survived the restart');
    assert.equal(valid.length, 1, 'the one media item must be valid');
    assert.ok(isStable(valid[0]!.uri), 'restored URI must be stable');
  });

  it('B2: persistMediaForDraft seeds tracking from AsyncStorage on first call after restart', async () => {
    // First session.
    const src = pickerUri('seed-test.jpg');
    _setFileExists(src, true);
    const persisted = await persistMediaForDraft([photo(src)], 'ticket');
    const stableUri = persisted[0]!.uri;
    await saveDraft('ticket', { media: persisted });

    // Cold restart.
    __resetForTesting();

    // Second session: pass an EMPTY list — the seeded URI should be treated
    // as an orphan and deleted.
    await persistMediaForDraft([], 'ticket');
    assert.ok(!_vfs.has(stableUri),
      'seeded stable URI must be deleted as orphan after cold-restart empty save');
  });
});

// ── C. "Re-add" warning — validateMediaItems ──────────────────────────────────

describe('C: yellow "re-add" warning — validateMediaItems drops missing files', () => {
  it('C1: dropped count equals number of files that no longer exist', async () => {
    const uri1 = `${DRAFT_DIR}exists.jpg`;
    const uri2 = `${DRAFT_DIR}gone.jpg`;
    _setFileExists(uri1, true);
    // uri2 intentionally absent — simulates external cache clear.

    const { valid, dropped } = await validateMediaItems([photo(uri1), photo(uri2)]);

    assert.equal(dropped, 1, 'one file is gone — dropped must be 1');
    assert.equal(valid.length, 1, 'only the surviving file should remain');
    assert.equal(valid[0]!.uri, uri1);
  });

  it('C2: all files gone → valid is empty, dropped equals total', async () => {
    const items = [
      photo(`${DRAFT_DIR}a.jpg`),
      photo(`${DRAFT_DIR}b.jpg`),
    ];
    // Neither file exists in the VFS.

    const { valid, dropped } = await validateMediaItems(items);

    assert.equal(dropped, 2);
    assert.equal(valid.length, 0);
  });

  it('C3: dropped=0 when all files exist (no warning shown)', async () => {
    const uri = `${DRAFT_DIR}present.jpg`;
    _setFileExists(uri, true);

    const { valid, dropped } = await validateMediaItems([photo(uri)]);

    assert.equal(dropped, 0);
    assert.equal(valid.length, 1);
  });

  it('C4: empty input returns valid=[] dropped=0 immediately', async () => {
    const { valid, dropped } = await validateMediaItems([]);
    assert.equal(dropped, 0);
    assert.equal(valid.length, 0);
  });
});

// ── D. Orphan cleanup ─────────────────────────────────────────────────────────

describe('D: orphan cleanup — removing items deletes their stable copies', () => {
  it('D1: stable copy is deleted when item is removed on the next save', async () => {
    const src1 = pickerUri('orphan1.jpg');
    const src2 = pickerUri('orphan2.jpg');
    _setFileExists(src1, true);
    _setFileExists(src2, true);

    // First save: both items.
    const first = await persistMediaForDraft([photo(src1), photo(src2)], 'ticket');
    const uri1 = first[0]!.uri;

    // Second save: only the second item — first is removed.
    await persistMediaForDraft([photo(src2)], 'ticket');

    assert.ok(!_vfs.has(uri1),
      'stable copy for removed item must be deleted on next save');
  });

  it('D2: clearing all items deletes all stable copies', async () => {
    const src = pickerUri('orphan-all.jpg');
    _setFileExists(src, true);

    const result = await persistMediaForDraft([photo(src)], 'ticket');
    const stableUri = result[0]!.uri;

    // User removes all attachments.
    await persistMediaForDraft([], 'ticket');

    assert.ok(!_vfs.has(stableUri),
      'all stable copies must be deleted when item list is emptied');
  });
});

// ── E. Re-add after removal ───────────────────────────────────────────────────

describe('E: re-adding a previously-removed picker file works correctly', () => {
  it('E1: re-added source is re-copied after its stable copy was deleted as an orphan', async () => {
    const src = pickerUri('readd.jpg');
    _setFileExists(src, true);

    // Add, then remove.
    const first = await persistMediaForDraft([photo(src)], 'ticket');
    const firstStable = first[0]!.uri;
    await persistMediaForDraft([], 'ticket'); // orphan deleted

    assert.ok(!_vfs.has(firstStable), 'precondition: first copy deleted');

    // Re-add the same picker file.
    const second = await persistMediaForDraft([photo(src)], 'ticket');
    const secondStable = second[0]!.uri;

    assert.ok(isStable(secondStable), 'second stable URI must be inside draft-media dir');
    assert.ok(_vfs.has(secondStable), 'new stable copy must exist in VFS');
  });
});

// ── F. clearDraft cleanup ─────────────────────────────────────────────────────

describe('F: clearDraft — removes durable copies and AsyncStorage entry', () => {
  it('F1: stable files are deleted and AsyncStorage key is removed', async () => {
    const src = pickerUri('clear-me.jpg');
    _setFileExists(src, true);

    const persisted = await persistMediaForDraft([photo(src)], 'ticket');
    const stableUri = persisted[0]!.uri;
    await saveDraft('ticket', { media: persisted });

    await clearDraft('ticket');

    assert.ok(!_vfs.has(stableUri),
      'stable file must be deleted after clearDraft');
    assert.ok(!_storage.has('uc_form_draft:ticket'),
      'AsyncStorage entry must be removed after clearDraft');
  });

  it('F2: clearDraft on a draft with no attachments does not throw', async () => {
    await saveDraft('ticket', { media: [] });
    await assert.doesNotReject(() => clearDraft('ticket'));
  });
});

// ── G. Cross-draft isolation ──────────────────────────────────────────────────

describe('G: cross-draft isolation — ticket and water-test do not interfere', () => {
  it('G1: stable copies are stored under independent sets per draft key', async () => {
    const srcA = pickerUri('ticket-photo.jpg');
    const srcB = pickerUri('water-test-photo.jpg');
    _setFileExists(srcA, true);
    _setFileExists(srcB, true);

    const ticket    = await persistMediaForDraft([photo(srcA)], 'ticket');
    const waterTest = await persistMediaForDraft([photo(srcB)], 'water-test');

    const stableA = ticket[0]!.uri;
    const stableB = waterTest[0]!.uri;

    // Clearing the ticket draft must not delete the water-test copy.
    await clearDraft('ticket');

    assert.ok(!_vfs.has(stableA),
      'ticket stable copy must be deleted after clearDraft(ticket)');
    assert.ok(_vfs.has(stableB),
      'water-test stable copy must NOT be affected by clearDraft(ticket)');
  });
});

// ── H. Cold-restart submit path ───────────────────────────────────────────────

describe('H: clearDraft uses AsyncStorage as fallback when no in-memory state exists', () => {
  it('H1: stable files are deleted on clearDraft even when persistMediaForDraft was never called this session', async () => {
    // Simulate a draft saved in a previous session directly in AsyncStorage.
    const stableUri = `${DRAFT_DIR}cold-submit.jpg`;
    _setFileExists(stableUri, true);
    _storage.set('uc_form_draft:ticket', JSON.stringify({ media: [photo(stableUri)] }));

    // Cold restart — module state is empty.
    __resetForTesting();

    // User submits directly without viewing the form (e.g. re-opens app and
    // immediately hits Submit). clearDraft must still clean up via the
    // AsyncStorage fallback.
    await clearDraft('ticket');

    assert.ok(!_vfs.has(stableUri),
      'cold-restart submit must delete stable files via AsyncStorage fallback');
    assert.ok(!_storage.has('uc_form_draft:ticket'),
      'AsyncStorage key must be removed on cold-restart submit clearDraft');
  });
});

// ── I. Web platform no-ops ────────────────────────────────────────────────────

describe('I: web platform — persistMediaForDraft and validateMediaItems are no-ops', () => {
  it('I1: persistMediaForDraft returns items unchanged on web', async () => {
    (Platform as any).OS = 'web';
    try {
      const items = [photo('file:///some/picker/photo.jpg')];
      const result = await persistMediaForDraft(items, 'ticket');
      assert.deepEqual(result, items,
        'persistMediaForDraft must be a no-op on web');
    } finally {
      (Platform as any).OS = 'ios';
    }
  });

  it('I2: validateMediaItems returns all items valid with dropped=0 on web', async () => {
    (Platform as any).OS = 'web';
    try {
      const items = [photo('file:///some/missing.jpg'), photo('file:///another.jpg')];
      const { valid, dropped } = await validateMediaItems(items);
      assert.equal(dropped, 0, 'no items must be dropped on web');
      assert.deepEqual(valid, items, 'all items must be returned as valid on web');
    } finally {
      (Platform as any).OS = 'ios';
    }
  });
});
