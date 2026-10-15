// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { readImageInfo } from "../question-content/assets";
import {
  assertCompleteAcademicGif,
  assertInstallableAcademicImageBytes as assertInstallableAcademicImage,
} from "./gifIntegrity";

// A real 1x1 GIF that decodes in Chromium despite omitting the optional LZW
// end code. It has a full pixel, complete image-data sub-blocks and a trailer.
const gif = Uint8Array.from(Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64"));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function twice(first = gif) {
  const index = first.indexOf(0x2c, 13);
  const header = first.subarray(0, index);
  const frame = first.subarray(index, first.length - 1);
  return Uint8Array.from([...header, ...frame, ...frame, 0x3b]);
}

function stubSuccessfulBrowserDecode(width = 1, height = 1) {
  const close = vi.fn();
  const decode = vi.fn(async (_blob: Blob) => ({ width, height, close }));
  vi.stubGlobal("createImageBitmap", decode);
  return { decode, close };
}

it("accepts a real complete tiny GIF and validates all frames in an animation", async () => {
  stubSuccessfulBrowserDecode();
  expect(assertCompleteAcademicGif(gif)).toEqual({ width: 1, height: 1, frames: 1 });
  const animation = twice();
  expect(assertCompleteAcademicGif(animation)).toEqual({ width: 1, height: 1, frames: 2 });
  await expect(assertInstallableAcademicImage(animation, "image/gif"))
    .resolves.toMatchObject({ mimeType: "image/gif", width: 1, height: 1 });
});

it("rejects a GIF89a header-only file even when the legacy MIME/size parser accepts its dimensions", async () => {
  const header = gif.subarray(0, 12);
  expect(readImageInfo(header)).toMatchObject({ mimeType: "image/gif", width: 1, height: 1 });
  expect(() => assertCompleteAcademicGif(header)).toThrow(/truncated|fully decoded/);
  await expect(assertInstallableAcademicImage(header, "image/gif")).rejects.toThrow(/truncated|fully decoded/);
});

it("rejects a missing frame/trailer and invalid logical-screen size", () => {
  const noFrame = Uint8Array.from([...gif.subarray(0, 19), 0x3b]);
  const noTrailer = gif.subarray(0, gif.length - 1);
  const trailingData = Uint8Array.from([...gif, 0x21]);
  const invalidSize = new Uint8Array(gif);
  invalidSize[6] = 0;
  invalidSize[7] = 0;
  for (const invalid of [noFrame, noTrailer, trailingData, invalidSize]) {
    expect(() => assertCompleteAcademicGif(invalid)).toThrow(/truncated|fully decoded/);
  }
});

it("rejects an undecodable LZW stream even when header, palette, sub-block boundaries and trailer exist", () => {
  const broken = new Uint8Array(gif);
  // The compressed data is the byte immediately before the sub-block's 0
  // terminator. A stream starting with a literal instead of CLEAR is invalid.
  broken[broken.length - 3] = 0x00;
  expect(readImageInfo(broken)?.mimeType).toBe("image/gif");
  expect(() => assertCompleteAcademicGif(broken)).toThrow(/fully decoded/);
});

it("does not certify a valid first frame when a later GIF frame has corrupt compressed pixels", () => {
  const frames = twice();
  const secondData = frames.length - 3;
  frames[secondData] = 0x00;
  expect(() => assertCompleteAcademicGif(frames)).toThrow(/fully decoded/);
});

it("rejects a structurally complete GIF that the actual browser decoder refuses", async () => {
  const decode = vi.fn().mockRejectedValue(new Error("decoder refused frame"));
  vi.stubGlobal("createImageBitmap", decode);
  await expect(assertInstallableAcademicImage(gif, "image/gif")).rejects.toThrow(/truncated|fully decoded/);
  expect(decode).toHaveBeenCalledTimes(1);
  const blob = decode.mock.calls[0][0] as Blob;
  expect(blob.type).toBe("image/gif");
  expect(blob.size).toBe(gif.length);
});

it("closes browser image bitmaps and requires decoded dimensions to agree with the GIF", async () => {
  const close = vi.fn();
  const decode = vi.fn().mockResolvedValue({ width: 1, height: 1, close });
  vi.stubGlobal("createImageBitmap", decode);
  await expect(assertInstallableAcademicImage(gif, "image/gif"))
    .resolves.toMatchObject({ mimeType: "image/gif", width: 1, height: 1 });
  expect(close).toHaveBeenCalledTimes(1);
  decode.mockResolvedValueOnce({ width: 2, height: 1, close });
  await expect(assertInstallableAcademicImage(gif, "image/gif")).rejects.toThrow(/fully decoded/);
  expect(close).toHaveBeenCalledTimes(2);
});

const png = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXnkAAAAASUVORK5CYII=", "base64",
));
// The JPEG and WebP samples deliberately contain *only* sniffable dimension
// headers. A browser decoder must reject them despite matching MIME/dimensions.
const jpegHeader = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 1, 0, 1, 0]);
const webpHeader = new Uint8Array(30);
webpHeader.set(Buffer.from("RIFF"), 0);
webpHeader.set(Buffer.from("WEBP"), 8);
webpHeader.set(Buffer.from("VP8X"), 12);
const formats = [
  { name: "PNG", mime: "image/png", bytes: png },
  { name: "JPEG", mime: "image/jpeg", bytes: jpegHeader },
  { name: "WebP", mime: "image/webp", bytes: webpHeader },
  { name: "GIF", mime: "image/gif", bytes: gif },
];

it.each(formats)("rejects $name if a browser decoder refuses header-sniffed image bytes", async ({ mime, bytes }) => {
  expect(readImageInfo(bytes)).toMatchObject({ mimeType: mime, width: 1, height: 1 });
  vi.stubGlobal("window", {});
  const bitmap = vi.fn(async (_blob: Blob) => { throw new Error("Image byte stream cannot decode"); });
  vi.stubGlobal("createImageBitmap", bitmap);
  vi.stubGlobal("Image", undefined);
  await expect(assertInstallableAcademicImage(bytes, mime)).rejects.toThrow(/fully decoded/);
  expect(bitmap).toHaveBeenCalledOnce();
  expect(bitmap.mock.calls[0][0]).toMatchObject({ type: mime, size: bytes.length });
});

it.each(formats)("tries HTMLImageElement.decode if createImageBitmap rejects $name", async ({ mime, bytes }) => {
  vi.stubGlobal("window", {});
  const bitmap = vi.fn(async () => { throw new Error("bitmap API does not support this format"); });
  const htmlDecode = vi.fn(async () => undefined);
  class FallbackImage {
    src = "";
    naturalWidth = 1;
    naturalHeight = 1;
    decode() { return htmlDecode(); }
  }
  vi.stubGlobal("createImageBitmap", bitmap);
  vi.stubGlobal("Image", FallbackImage);
  const makeUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:axom-image");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  await expect(assertInstallableAcademicImage(bytes, mime))
    .resolves.toMatchObject({ mimeType: mime, width: 1, height: 1 });
  expect(bitmap).toHaveBeenCalledOnce();
  expect(htmlDecode).toHaveBeenCalledOnce();
  expect(makeUrl).toHaveBeenCalledWith(expect.objectContaining({ type: mime, size: bytes.length }));
  expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:axom-image");
});

it.each(formats)("refuses $name if createImageBitmap and HTML image decoding both fail", async ({ mime, bytes }) => {
  vi.stubGlobal("window", {});
  const bitmap = vi.fn(async () => { throw new Error("bitmap failed"); });
  const htmlDecode = vi.fn(async () => { throw new Error("HTML decoder failed"); });
  class FallbackImage {
    src = "";
    naturalWidth = 1;
    naturalHeight = 1;
    decode() { return htmlDecode(); }
  }
  vi.stubGlobal("createImageBitmap", bitmap);
  vi.stubGlobal("Image", FallbackImage);
  const makeUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:axom-failed");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  await expect(assertInstallableAcademicImage(bytes, mime)).rejects.toThrow(/fully decoded/);
  expect(bitmap).toHaveBeenCalledOnce();
  expect(htmlDecode).toHaveBeenCalledOnce();
  expect(makeUrl).toHaveBeenCalledOnce();
  expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:axom-failed");
});

it.each(formats)("fails closed for $name when the browser has no image decoder", async ({ mime, bytes }) => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("createImageBitmap", undefined);
  vi.stubGlobal("Image", undefined);
  await expect(assertInstallableAcademicImage(bytes, mime)).rejects.toThrow(/fully decoded/);
});

it.each(formats)("requires positive decoded dimensions matching the sniffed $name header", async ({ mime, bytes }) => {
  vi.stubGlobal("window", {});
  const close = vi.fn();
  const decode = vi.fn(async () => ({ width: 0, height: 1, close }));
  vi.stubGlobal("createImageBitmap", decode);
  await expect(assertInstallableAcademicImage(bytes, mime)).rejects.toThrow(/fully decoded/);
  expect(close).toHaveBeenCalledOnce();
  decode.mockResolvedValueOnce({ width: 2, height: 1, close });
  await expect(assertInstallableAcademicImage(bytes, mime)).rejects.toThrow(/fully decoded/);
  expect(close).toHaveBeenCalledTimes(2);
});

it("fails closed in Node because structural parsing is not a real decoder receipt", async () => {
  vi.stubGlobal("window", undefined);
  vi.stubGlobal("createImageBitmap", undefined);
  vi.stubGlobal("Image", undefined);
  await expect(assertInstallableAcademicImage(png.subarray(0, 24), "image/png"))
    .rejects.toThrow(/fully decoded/);
});

it("rejects more than 64,000,000 decoded pixels before invoking a browser decoder", async () => {
  const oversized = new Uint8Array(png);
  const view = new DataView(oversized.buffer);
  view.setUint32(16, 8_001);
  view.setUint32(20, 8_000);
  const decode = vi.fn(async () => ({ width: 8_001, height: 8_000, close: vi.fn() }));
  vi.stubGlobal("createImageBitmap", decode);
  await expect(assertInstallableAcademicImage(oversized, "image/png"))
    .rejects.toThrow(/64,000,000 decoded-pixel/);
  expect(decode).not.toHaveBeenCalled();
});
