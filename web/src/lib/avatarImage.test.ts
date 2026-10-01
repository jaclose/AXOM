import { describe, expect, it } from "vitest";
import { AVATAR_COMPACT_ABOVE, AVATAR_SHORT_SIDE, avatarTargetSize, compactAvatarDataUrl } from "./avatarImage";

describe("stored profile photo size", () => {
  it("brings the short side to display size and never enlarges", () => {
    expect(avatarTargetSize(4000, 3000)).toEqual({ width: 341, height: 256 });
    expect(avatarTargetSize(3000, 4000)).toEqual({ width: 256, height: 341 });
    expect(avatarTargetSize(1024, 1024)).toEqual({ width: AVATAR_SHORT_SIDE, height: AVATAR_SHORT_SIDE });
    expect(avatarTargetSize(200, 120)).toEqual({ width: 200, height: 120 });
    expect(avatarTargetSize(256, 256)).toEqual({ width: 256, height: 256 });
  });

  it("caps the long side of a very wide or tall photo", () => {
    expect(avatarTargetSize(8000, 500)).toEqual({ width: 1024, height: 64 });
    expect(avatarTargetSize(300, 6000)).toEqual({ width: 51, height: 1024 });
  });

  it("answers nothing for a picture that has no size", () => {
    expect(avatarTargetSize(0, 0)).toEqual({ width: 0, height: 0 });
    expect(avatarTargetSize(Number.NaN, 10)).toEqual({ width: 0, height: 0 });
  });

  it("leaves a small file exactly as it was chosen, and never fails outside a browser", async () => {
    const small = `data:image/gif;base64,${"A".repeat(2_000)}`;
    expect(await compactAvatarDataUrl(small)).toBe(small);
    const large = `data:image/png;base64,${"A".repeat(AVATAR_COMPACT_ABOVE + 1)}`;
    expect(await compactAvatarDataUrl(large)).toBe(large);
  });
});
