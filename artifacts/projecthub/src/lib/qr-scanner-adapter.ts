import QrScanner from "qr-scanner";
import type { QrScannerFactory } from "./qr-scanner-controller";

export function createQrScannerAdapter(video: HTMLVideoElement): QrScannerFactory {
  return (onResult, onDecodeError) => {
    const scanner = new QrScanner(video, (result) => onResult(result.data), {
      // The library uses a worker fallback where BarcodeDetector is absent,
      // including iPhone Safari. It also owns and stops its MediaStream.
      preferredCamera: "environment",
      maxScansPerSecond: 10,
      returnDetailedScanResult: true,
      onDecodeError,
    });
    return {
      start: () => scanner.start(),
      destroy: () => scanner.destroy(),
    };
  };
}