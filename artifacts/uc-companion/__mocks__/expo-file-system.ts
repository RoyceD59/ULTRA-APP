/**
 * expo-file-system stub for the Node.js test runner.
 *
 * Provides a minimal in-memory virtual filesystem that mirrors the
 * synchronous OO API used by expo-file-system v19 (File, Directory, Paths).
 *
 * Test helpers exported with an underscore prefix:
 *   _setFileExists(uri, true|false) — seed or evict a file
 *   _listFiles()                    — inspect what is currently on the VFS
 *   _reset()                        — wipe all state between tests
 */

/** In-memory virtual filesystem: uri → content bytes */
export const _vfs: Map<string, Buffer> = new Map();

export function _setFileExists(uri: string, exists: boolean): void {
  if (exists) {
    if (!_vfs.has(uri)) _vfs.set(uri, Buffer.from('mock-content'));
  } else {
    _vfs.delete(uri);
  }
}

export function _listFiles(): string[] {
  return [..._vfs.keys()];
}

export function _reset(): void {
  _vfs.clear();
}

// ── Path constants ────────────────────────────────────────────────────────────

export const Paths = {
  document: 'file:///documents/',
};

// ── Directory ─────────────────────────────────────────────────────────────────

export class Directory {
  readonly uri: string;

  constructor(base: string | Directory, ...segments: string[]) {
    const baseUri = base instanceof Directory ? base.uri : base;
    const seg     = segments.filter(Boolean).join('/');
    const prefix  = baseUri.endsWith('/') ? baseUri : `${baseUri}/`;
    this.uri       = seg ? `${prefix}${seg}/` : prefix;
  }

  /** Always true in the stub — we don't track directory existence separately. */
  get exists(): boolean {
    return true;
  }

  create(_opts?: { intermediates?: boolean; idempotent?: boolean }): void {
    // no-op — directory is always "created"
  }
}

// ── File ──────────────────────────────────────────────────────────────────────

export class File {
  readonly uri: string;

  constructor(baseOrUri: string | Directory, name?: string) {
    if (baseOrUri instanceof Directory) {
      const dir = baseOrUri.uri.endsWith('/') ? baseOrUri.uri : `${baseOrUri.uri}/`;
      this.uri   = `${dir}${name ?? ''}`;
    } else {
      this.uri = baseOrUri as string;
    }
  }

  /** Extension including the leading dot (e.g. ".jpg"), or "" when absent. */
  get extension(): string {
    const parts = this.uri.split('.');
    return parts.length > 1 ? `.${parts[parts.length - 1]}` : '';
  }

  get exists(): boolean {
    return _vfs.has(this.uri);
  }

  delete(): void {
    _vfs.delete(this.uri);
  }

  /** Copy this file's content into `dest`, creating it if absent. */
  copy(dest: File): void {
    const content = _vfs.get(this.uri) ?? Buffer.from('mock-content');
    _vfs.set(dest.uri, content);
  }
}
