import { Worker } from "node:worker_threads";
import { MAX_PDF_PAGES, MAX_REFERENCE_CHARACTERS, REFERENCE_TIMEOUT_MS, ReferenceExtractionError } from "./library-reference-limits.js";

// An isolated, disposable parser: only supplied bytes, no rendering, actions,
// annotations, attachments, metadata, fonts, or external resource URLs.
const parserSource = `
const { parentPort, workerData } = require("node:worker_threads");
globalThis.fetch = () => { throw new Error("Remote resources are disabled"); };
(async () => {
  let task;
  try {
    const { getDocument } = await import(workerData.parser);
    task = getDocument({
      data: new Uint8Array(workerData.bytes),
      isEvalSupported: false, useSystemFonts: false, disableFontFace: true,
      useWasm: false, useWorkerFetch: false, stopAtErrors: true, verbosity: 0,
      maxImageSize: 0,
    });
    const pdf = await task.promise;
    if (await pdf.getPermissions() !== null) {
      parentPort.postMessage({ error: "Encrypted or password-protected PDFs are unsupported; upload an unencrypted text-based manual." });
      return;
    }
    if (pdf.numPages < 1 || pdf.numPages > workerData.maxPages) {
      throw new Error("PDF manuals must contain 1–" + workerData.maxPages + " pages; split longer documents.");
    }
    let text = "";
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      let pageText = "";
      for (const item of content.items) {
        if (typeof item.str !== "string") continue;
        pageText += item.str + (item.hasEOL ? "\\n" : " ");
        if (text.length + pageText.length > workerData.maxCharacters) {
          throw new Error("Extracted PDF text exceeds 16,000 characters; split the manual.");
        }
      }
      if (!pageText.trim()) {
        throw new Error("PDF page " + n + " has no extractable text. Scanned or image-only pages are unsupported; upload reviewed text instead.");
      }
      text += (n > 1 ? "\\n\\n" : "") + pageText.trim();
      if (text.length > workerData.maxCharacters) {
        throw new Error("Extracted PDF text exceeds 16,000 characters; split the manual.");
      }
      page.cleanup();
    }
    parentPort.postMessage({ text });
  } catch (error) {
    const message = error?.name === "PasswordException"
      ? "Encrypted or password-protected PDFs are unsupported; upload an unencrypted text-based manual."
      : error?.message?.startsWith("PDF ") || error?.message?.startsWith("Extracted PDF ")
        ? error.message : "The PDF is malformed or unsupported; upload a valid text-based PDF or reviewed text.";
    parentPort.postMessage({ error: message });
  } finally {
    if (task) await task.destroy();
  }
})();
`;

let activeParsers = 0;
export async function extractPdfText(bytes: Buffer): Promise<string> {
  if (!bytes.subarray(0, 8).toString("ascii").startsWith("%PDF-")) {
    throw new ReferenceExtractionError("The file is not a valid PDF.");
  }
  if (activeParsers >= 2) throw new ReferenceExtractionError("PDF review is busy. Try again shortly.");
  activeParsers++;
  try {
    return await new Promise<string>((resolve, reject) => {
      const worker = new Worker(parserSource, {
        eval: true,
        execArgv: [],
        workerData: { bytes, parser: import.meta.resolve("pdfjs-dist/legacy/build/pdf.mjs"),
          maxPages: MAX_PDF_PAGES, maxCharacters: MAX_REFERENCE_CHARACTERS },
        resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
      });
      const timer = setTimeout(() => finish(new ReferenceExtractionError("PDF extraction timed out; split the manual or upload reviewed text.")), REFERENCE_TIMEOUT_MS);
      let settled = false;
      function finish(error?: Error, text?: string) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // Do not release the concurrency slot until the worker is gone.
        void worker.terminate().finally(() => error ? reject(error) : resolve(text!));
      }
      worker.once("message", (result: { text?: string; error?: string }) => {
        if (result.error || typeof result.text !== "string") finish(new ReferenceExtractionError(result.error ?? "PDF extraction failed."));
        else finish(undefined, result.text);
      });
      worker.once("error", () => finish(new ReferenceExtractionError("PDF extraction exceeded its resource budget or failed; upload reviewed text instead.")));
      worker.once("exit", () => { if (!settled) finish(new ReferenceExtractionError("PDF extraction stopped before completion.")); });
    });
  } finally { activeParsers--; }
}