// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyImageBlob } from "./presentation";

class TestClipboardItem {
  constructor(readonly items: Record<string, Blob>) {}
}

describe("Pulse image clipboard boundary", () => {
  let originalClipboard: PropertyDescriptor | undefined;
  const write = vi.fn<(items: ClipboardItem[]) => Promise<void>>();
  const image = new Blob(["private share card"], { type: "image/png" });

  beforeEach(() => {
    originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    write.mockReset();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write } });
    vi.stubGlobal("ClipboardItem", TestClipboardItem);
  });

  afterEach(() => {
    if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
    else Reflect.deleteProperty(navigator, "clipboard");
    vi.unstubAllGlobals();
  });

  it("copies a PNG when the browser accepts the image", async () => {
    write.mockResolvedValue(undefined);
    await expect(copyImageBlob(image)).resolves.toBe(true);
    expect(write).toHaveBeenCalledOnce();
    expect((write.mock.calls[0][0][0] as unknown as TestClipboardItem).items["image/png"]).toBe(image);
  });

  it("offers download instead of exposing a permission-denied browser error", async () => {
    write.mockRejectedValue(new DOMException("Write permission denied", "NotAllowedError"));
    await expect(copyImageBlob(image)).resolves.toBe(false);
    expect(write).toHaveBeenCalledOnce();
  });

  it("reports unavailable when the image clipboard API is absent", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    await expect(copyImageBlob(image)).resolves.toBe(false);
    expect(write).not.toHaveBeenCalled();
  });
});
