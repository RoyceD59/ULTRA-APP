import type { ResolvedRewardsQr } from './rewardsQrResolution';

export class RewardsQrController {
  private generation = 0;
  private active: AbortController | null = null;
  public state: { token: string | null; loading: boolean; error: Error | null } =
    { token: null, loading: false, error: null };

  /** Query observers share the result through React Query; the worker itself
   * rejects cancelled/old-account completions and bounds even hanging bridges. */
  async load(
    userId: number,
    resolve: (signal: AbortSignal) => Promise<ResolvedRewardsQr>,
    signal?: AbortSignal,
    deadlineMs = 12000,
  ): Promise<ResolvedRewardsQr> {
    this.active?.abort();
    const controller = new AbortController();
    this.active = controller;
    const generation = ++this.generation;
    this.state = { token: null, loading: true, error: null };
    const abort = () => controller.abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled: (() => void) | undefined;
    try {
      const cancellation = new Promise<never>((_, reject) => {
        cancelled = () => reject(new Error('QR verification cancelled or timed out'));
        controller.signal.addEventListener('abort', cancelled, { once: true });
      });
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) controller.abort();
      timer = setTimeout(abort, deadlineMs);
      const result = await Promise.race([resolve(controller.signal), cancellation]);
      if (generation !== this.generation || controller.signal.aborted) throw new Error('QR verification cancelled');
      if (result.userId !== userId) throw new Error('QR account verification failed');
      this.state = { token: result.token, loading: false, error: null };
      return result;
    } catch (error) {
      if (generation === this.generation) {
        this.state = { token: null, loading: false, error: error instanceof Error ? error : new Error('QR unavailable') };
      }
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (cancelled) controller.signal.removeEventListener('abort', cancelled);
      if (this.active === controller) this.active = null;
    }
  }
}