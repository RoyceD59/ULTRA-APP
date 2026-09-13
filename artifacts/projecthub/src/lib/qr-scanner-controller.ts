export type QrScannerFailure =
  | "insecure-context"
  | "permission-denied"
  | "no-camera"
  | "camera-busy"
  | "decode-error";

export interface QrScannerInstance {
  start(): Promise<void>;
  destroy(): void;
}

export type QrScannerFactory = (
  onResult: (value: string) => void,
  onDecodeError: (error: Error | string) => void,
) => QrScannerInstance;

export function classifyQrScannerError(error: unknown): QrScannerFailure {
  // DOMException is not an Error in every browser (and in jsdom), so read
  // its standard fields structurally before falling back to a string.
  const exception = error as { name?: unknown; message?: unknown } | null;
  const name = typeof exception?.name === "string" ? exception.name : "";
  const message = typeof exception?.message === "string"
    ? exception.message.toLowerCase()
    : String(error).toLowerCase();
  if (name === "NotAllowedError" || name === "PermissionDeniedError") return "permission-denied";
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") return "no-camera";
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") return "camera-busy";
  if (name === "SecurityError") return "insecure-context";
  if (message.includes("secure context") || message.includes("https")) return "insecure-context";
  if (message.includes("media devices") || message.includes("no camera") || message.includes("not found")) return "no-camera";
  if (message.includes("in use") || message.includes("busy")) return "camera-busy";
  return "decode-error";
}

/**
 * Owns one scanner session. Keeping this browser-free makes camera lifecycle
 * behaviour testable without exposing media APIs to the page component.
 */
export class QrScannerController {
  private scanner: QrScannerInstance | null = null;
  private stopped = false;
  private resolved = false;

  constructor(
    private readonly isSecureContext: boolean,
    private readonly factory: QrScannerFactory,
    private readonly callbacks: {
      onStarted: () => void;
      onResult: (value: string) => void;
      onFailure: (failure: QrScannerFailure) => void;
    },
  ) {}

  async start(): Promise<void> {
    if (!this.isSecureContext) {
      this.callbacks.onFailure("insecure-context");
      return;
    }
    if (this.scanner) return;

    this.stopped = false;
    const scanner = this.factory(
      (value) => this.handleResult(value),
      (error) => this.handleDecodeError(error),
    );
    this.scanner = scanner;

    try {
      await scanner.start();
      if (this.stopped || this.scanner !== scanner) {
        scanner.destroy();
        return;
      }
      this.callbacks.onStarted();
    } catch (error) {
      if (this.scanner === scanner) this.scanner = null;
      scanner.destroy();
      if (!this.stopped) this.callbacks.onFailure(classifyQrScannerError(error));
    }
  }

  stop(): void {
    this.stopped = true;
    const scanner = this.scanner;
    this.scanner = null;
    scanner?.destroy();
  }

  private handleResult(value: string): void {
    const lookup = value.trim();
    if (!lookup || this.stopped || this.resolved) return;
    this.resolved = true;
    this.stop();
    this.callbacks.onResult(lookup);
  }

  private handleDecodeError(error: Error | string): void {
    // qr-scanner reports this for ordinary frames that do not contain a QR.
    if (String(error) === "No QR code found" || this.stopped || this.resolved) return;
    this.callbacks.onFailure("decode-error");
  }
}