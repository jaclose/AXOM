import { chromium } from "@playwright/test";

type DecodedBitmap = Pick<ImageBitmap, "width" | "height" | "close">;

/** Give the Node-only publication check the same real browser decode boundary
 * as the upload UI. No header-only or synthetic dimension receipt is accepted. */
export async function openPublicationBrowserDecoder(): Promise<{
  decode(blob: Blob): Promise<DecodedBitmap>;
  assertHealthy(): void;
  close(): Promise<void>;
}> {
  const browser = await chromium.launch(process.platform === "darwin"
    ? { channel: "chrome", headless: true }
    : { headless: true });
  const page = await browser.newPage();
  let pending = Promise.resolve();

  const decode = (blob: Blob): Promise<DecodedBitmap> => {
    // One page at a time bounds memory when a course contains many figures.
    const next = pending.then(async () => {
      const encoded = Buffer.from(await blob.arrayBuffer()).toString("base64");
      const dimensions = await page.evaluate(async ({ encoded: base64, mime }) => {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
        const imageBlob = new Blob([bytes], { type: mime });
        try {
          const bitmap = await createImageBitmap(imageBlob);
          try { return { width: bitmap.width, height: bitmap.height }; }
          finally { bitmap.close(); }
        } catch {
          const url = URL.createObjectURL(imageBlob);
          try {
            const image = new Image();
            image.src = url;
            await image.decode();
            return { width: image.naturalWidth, height: image.naturalHeight };
          } finally { URL.revokeObjectURL(url); }
        }
      }, { encoded, mime: blob.type });
      return { ...dimensions, close() {} };
    });
    pending = next.then(() => undefined, () => undefined);
    return next;
  };

  return {
    decode,
    assertHealthy() {
      if (!browser.isConnected() || page.isClosed())
        throw new Error("The browser image decoder disconnected during the publication check.");
    },
    async close() { await browser.close(); },
  };
}
