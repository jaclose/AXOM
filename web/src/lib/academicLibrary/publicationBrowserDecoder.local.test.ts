// @vitest-environment node
// Run with AXOM_PUBLISH_DECODER_TEST=1 to exercise the installed browser locally.
import { chromium } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertBrowserAcademicImageDecodable, assertInstallableAcademicImageBytes } from "./gifIntegrity";
import { openPublicationBrowserDecoder } from "./publicationBrowserDecoder.local";
import { readImageInfo } from "../question-content/assets";

const formats = ["image/png", "image/jpeg", "image/webp"] as const;

describe.skipIf(process.env.AXOM_PUBLISH_DECODER_TEST !== "1")(
  "real browser decoder for the local publication check", () => {
    const fixtures = new Map<string, Uint8Array>();
    let decoder: Awaited<ReturnType<typeof openPublicationBrowserDecoder>>;

    beforeAll(async () => {
      decoder = await openPublicationBrowserDecoder();
      vi.stubGlobal("createImageBitmap", decoder.decode);
      const browser = await chromium.launch(process.platform === "darwin"
        ? { channel: "chrome", headless: true }
        : { headless: true });
      try {
        const page = await browser.newPage();
        for (const mime of formats) {
          const encoded = await page.evaluate(type => {
            const canvas = document.createElement("canvas");
            canvas.width = 2;
            canvas.height = 3;
            const context = canvas.getContext("2d");
            if (!context) throw new Error("Canvas unavailable for image fixture.");
            context.fillStyle = "#28509c";
            context.fillRect(0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL(type);
            if (!dataUrl.startsWith(`data:${type};base64,`))
              throw new Error(`Browser did not encode ${type}.`);
            return dataUrl.slice(dataUrl.indexOf(",") + 1);
          }, mime);
          fixtures.set(mime, new Uint8Array(Buffer.from(encoded, "base64")));
        }
      } finally { await browser.close(); }
    });

    afterAll(async () => {
      vi.unstubAllGlobals();
      await decoder?.close();
    });

    function fixture(mime: string): Uint8Array {
      const bytes = fixtures.get(mime);
      if (!bytes) throw new Error(`Missing ${mime} fixture.`);
      return bytes;
    }

    it.each(formats)("decodes a complete %s through the production validator", async mime => {
      await expect(assertInstallableAcademicImageBytes(fixture(mime), mime))
        .resolves.toMatchObject({ mimeType: mime, width: 2, height: 3 });
    });

    it("rejects a header-valid but truncated PNG", async () => {
      const truncated = fixture("image/png").subarray(0, 24);
      expect(readImageInfo(truncated)).toMatchObject({ mimeType: "image/png", width: 2, height: 3 });
      await expect(assertInstallableAcademicImageBytes(truncated, "image/png"))
        .rejects.toThrow(/fully decoded/);
    });

    it("rejects a decoder receipt with dimensions different from the header", async () => {
      await expect(assertBrowserAcademicImageDecodable(
        fixture("image/png"), "image/png", { width: 3, height: 3 },
      )).rejects.toThrow(/dimensions disagree/);
    });
  },
);
