import type { CustomerRewards } from '@/hooks/useApi';

type ResolveRewardsQrToken = (
  userId: number,
  rewardsToken: string | null | undefined,
  apiRotate: () => Promise<{ qrToken: string }>,
  readLocal: (id: number) => Promise<string | null>,
  storeLocal: (id: number, token: string) => Promise<void>,
) => Promise<{ token: string; source: 'local' | 'rewards' | 'rotated' }>;

export interface RewardsQrState {
  token: string | null;
  loading: boolean;
  error: Error | null;
}

export class RewardsQrController {
  private userId: number | null | undefined = null;
  private rewards: CustomerRewards | undefined;
  
  public state: RewardsQrState = { token: null, loading: true, error: null };
  private qrRecoveryForUser: number | null = null;
  
  private apiRotate!: () => Promise<{ qrToken: string }>;
  private readLocal!: (id: number) => Promise<string | null>;
  private storeLocal!: (id: number, token: string) => Promise<void>;
  
  private activeLoadId = 0;

  constructor(
    private readonly onStateChange: (state: RewardsQrState) => void,
    private readonly resolveToken: ResolveRewardsQrToken,
  ) {}
  
  private updateState(partial: Partial<RewardsQrState>) {
    this.state = { ...this.state, ...partial };
    this.onStateChange(this.state);
  }

  public async setProps(
    userId: number | undefined | null, 
    rewards: CustomerRewards | undefined,
    apiRotate: () => Promise<{ qrToken: string }>,
    readLocal: (id: number) => Promise<string | null>,
    storeLocal: (id: number, token: string) => Promise<void>
  ) {
    this.apiRotate = apiRotate;
    this.readLocal = readLocal;
    this.storeLocal = storeLocal;

    const userChanged = this.userId !== userId;
    
    if (userChanged) {
      this.userId = userId;
      this.qrRecoveryForUser = null;
      this.activeLoadId++; // Cancel pending loads
      this.updateState({ token: null, loading: !!userId, error: null });
    }
    
    this.rewards = rewards;
    
    if (!userId) return;
    
    // Fast path: if we already have the right token and user hasn't changed, and rewards don't dictate a new token
    if (!userChanged && this.state.token && (!rewards?.qrToken || rewards.qrToken === this.state.token)) {
      if (this.state.loading) this.updateState({ loading: false });
      return;
    }
    
    await this.loadToken();
  }
  
  private async loadToken() {
    const userId = this.userId;
    if (!userId) return;

    const loadId = ++this.activeLoadId;

    try {
      if (this.rewards?.qrToken && this.rewards.qrToken !== this.state.token) {
        if (!this.state.loading) this.updateState({ loading: true, error: null });
        const result = await this.resolveToken(
          userId,
          this.rewards.qrToken,
          this.apiRotate,
          this.readLocal,
          this.storeLocal
        );
        if (this.activeLoadId === loadId && this.userId === userId) {
          this.updateState({ token: result.token, loading: false, error: null });
        }
        return;
      }

      if (this.state.token) {
        this.updateState({ loading: false });
        return;
      }

      if (!this.rewards) {
        const local = await this.readLocal(userId);
        if (this.activeLoadId === loadId && local && this.userId === userId) {
          this.updateState({ token: local, loading: false, error: null });
        }
        return;
      }

      if (this.qrRecoveryForUser === userId) return;
      this.qrRecoveryForUser = userId;

      this.updateState({ loading: true, error: null });
      
      const result = await this.resolveToken(
        userId,
        null,
        this.apiRotate,
        this.readLocal,
        this.storeLocal
      );
      
      if (this.activeLoadId === loadId && this.userId === userId) {
        this.updateState({ token: result.token, loading: false, error: null });
      }
    } catch (err) {
      if (this.activeLoadId === loadId && this.userId === userId) {
        this.updateState({ 
          error: err instanceof Error ? err : new Error('Failed to load QR token'),
          loading: false 
        });
      }
    }
  }

  public retry() {
    this.qrRecoveryForUser = null;
    this.activeLoadId++; // Cancel pending
    this.updateState({ token: null, loading: true, error: null });
    this.loadToken();
  }
}
