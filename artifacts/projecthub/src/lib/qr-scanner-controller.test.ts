import { describe, expect, it, vi } from "vitest";
import { QrScannerController, classifyQrScannerError } from "./qr-scanner-controller";

describe("QrScannerController", () => {
  it("stops the decoder and resolves a scan only once", async () => {
    let emitResult = (_value: string) => {};
    const destroy = vi.fn();
    const onResult = vi.fn();
    const controller = new QrScannerController(true, (result) => {
      emitResult = result;
      return { start: vi.fn().mockResolvedValue(undefined), destroy };
    }, { onStarted: vi.fn(), onResult, onFailure: vi.fn() });

    await controller.start();
    emitResult(" uc-rewards:customer ");
    emitResult("uc-rewards:customer");

    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith("uc-rewards:customer");
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("destroys a pending scanner when closed before camera startup completes", async () => {
    let finishStart = () => {};
    const destroy = vi.fn();
    const controller = new QrScannerController(true, () => ({
      start: () => new Promise<void>((resolve) => { finishStart = resolve; }),
      destroy,
    }), { onStarted: vi.fn(), onResult: vi.fn(), onFailure: vi.fn() });

    const starting = controller.start();
    controller.stop();
    finishStart();
    await starting;

    expect(destroy).toHaveBeenCalled();
  });

  it("classifies browser camera failures and ignores empty frames", async () => {
    const onFailure = vi.fn();
    let emitError = (_error: Error | string) => {};
    const controller = new QrScannerController(false, () => {
      throw new Error("should not construct");
    }, { onStarted: vi.fn(), onResult: vi.fn(), onFailure });
    await controller.start();
    expect(onFailure).toHaveBeenCalledWith("insecure-context");

    const active = new QrScannerController(true, (_result, error) => {
      emitError = error;
      return { start: vi.fn().mockResolvedValue(undefined), destroy: vi.fn() };
    }, { onStarted: vi.fn(), onResult: vi.fn(), onFailure });
    await active.start();
    emitError("No QR code found");
    emitError(new DOMException("denied", "NotAllowedError"));

    expect(onFailure).toHaveBeenLastCalledWith("decode-error");
    expect(classifyQrScannerError(new DOMException("busy", "NotReadableError"))).toBe("camera-busy");
    expect(classifyQrScannerError(new DOMException("missing", "NotFoundError"))).toBe("no-camera");
  });
});