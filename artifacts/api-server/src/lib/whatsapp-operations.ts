/**
 * Reset must wait for an admitted restore to finish before deleting its files.
 * A failed or pending cleanup must never admit a new connection.
 */
export class WhatsAppOperations {
  private starting: Promise<void> | null = null;
  private resetting: Promise<void> | null = null;
  private cleanupRequired = false;

  constructor(
    private readonly initialize: () => Promise<void>,
    private readonly invalidate: () => void,
    private readonly cleanup: () => Promise<void>,
  ) {}

  connect(): Promise<void> {
    if (this.cleanupRequired) {
      return Promise.reject(new Error("Retry WhatsApp Disconnect before pairing again"));
    }
    if (this.starting) return this.starting;
    const operation = Promise.resolve().then(async () => {
      if (!this.cleanupRequired) await this.initialize();
    });
    this.starting = operation;
    void operation.then(
      () => { if (this.starting === operation) this.starting = null; },
      () => { if (this.starting === operation) this.starting = null; },
    );
    return operation;
  }

  disconnect(): Promise<void> {
    if (this.resetting) return this.resetting;
    this.cleanupRequired = true;
    this.invalidate();
    const starting = this.starting;
    const operation = Promise.resolve().then(async () => {
      await starting?.catch(() => undefined);
      await this.cleanup();
      this.cleanupRequired = false;
    });
    this.resetting = operation;
    void operation.then(
      () => { if (this.resetting === operation) this.resetting = null; },
      () => { if (this.resetting === operation) this.resetting = null; },
    );
    return operation;
  }
}