import { afterEach, expect, it } from "vitest";
import { beginSyncProgress, useSyncProgress } from "./syncProgress";

afterEach(() => useSyncProgress.setState({ current: null, attention: null }));

it("ignores an older upload finishing or reporting after a newer account starts", () => {
  const first = beginSyncProgress("account-a");
  const second = beginSyncProgress("account-b");
  second.report("content", 4, 8);
  first.report("receipt");
  first.attention([{ questionId: "q", questionLabel: "Private question", fileName: "image.png" }]);
  first.finish();
  expect(useSyncProgress.getState().current).toEqual({ accountId: "account-b", phase: "content", completed: 4, total: 8 });
  expect(useSyncProgress.getState().attention).toBeNull();
  second.finish();
  second.report("receipt");
  expect(useSyncProgress.getState().current).toBeNull();
});
