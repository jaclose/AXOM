import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { NoctyriumState } from "../types";
import type { QuizSession } from "../quiz";
import type { DailyChallenge } from "./challenges";
import { STORAGE_KEYS } from "../brand";
const mock = vi.hoisted(() => ({ state: { quizSessions: [] } as unknown as NoctyriumState,
  listener: undefined as undefined | ((state: NoctyriumState) => void), rpc: vi.fn(), flush: vi.fn(), assert: vi.fn(), write: vi.fn(), saved: new Map<string, string>() }));
vi.mock("../store", () => ({ useStore: { getState: () => mock.state, subscribe: (listener: (state: NoctyriumState) => void) => { mock.listener = listener; return () => { mock.listener = undefined; }; } } }));
vi.mock("../localVault", () => ({ flushLocalVaultWrites: mock.flush, getVaultWriteCheckpoint: () => 0, assertVaultWritesSince: () => {},
  localVaultStorage: { getItem: async (key: string) => mock.saved.get(key) ?? null,
    setItem: async (key: string, value: string) => { await mock.write(); mock.saved.set(key, value); }, removeItem: async (key: string) => { mock.saved.delete(key); } } }));
vi.mock("./accountScope", () => ({ academicAccountScope: () => ({ assertCurrent: mock.assert, dispose: () => {} }) }));
vi.mock("./client", () => ({ academicClient: async () => ({ rpc: mock.rpc }) }));
import { observeChallengeRun, prepareChallengeRun, readChallengeRun, verifyChallengeRun } from "./challengeRun";
const challenge = { id: "challenge", revisionId: "revision", day: "2026-10-14" } as DailyChallenge;
const mapping = new Map([["local", "bank:q"]]);
const session = (id: string, mode: QuizSession["mode"] = "exam") => ({ id, mode, startedAt: "2026-10-14T00:00:01Z", questionIds: ["local"], answers: [{ questionId: "local", answerKey: "A" }] } as QuizSession);
function persist(sessions: QuizSession[]) { mock.saved.set(STORAGE_KEYS.persistedState, JSON.stringify({ state: { quizSessions: sessions } })); }
function emit(sessions: QuizSession[]) {
  mock.state = { ...mock.state, quizSessions: sessions }; mock.listener?.(mock.state);
  queueMicrotask(() => persist(sessions));
}
beforeEach(() => {
  const locks = new Map<string, Promise<unknown>>();
  vi.stubGlobal("navigator", { locks: { request: (key: string, run: () => Promise<unknown>) => {
    const result = (locks.get(key) ?? Promise.resolve()).then(run);
    locks.set(key, result.catch(() => {})); return result;
  } } });
  mock.rpc.mockResolvedValue({ data: { accepted: true }, error: null }); });
afterEach(() => { mock.listener = undefined; mock.state = { quizSessions: [] } as unknown as NoctyriumState; mock.saved.clear(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

it("persists only a scoped quiz reference before launch and refuses to overwrite pending work", async () => {
  const intent = await prepareChallengeRun("account", challenge, mapping);
  expect(await readChallengeRun("account", challenge.id)).toEqual(intent);
  expect(await readChallengeRun("other-account", challenge.id)).toBeUndefined();
  expect(intent).not.toHaveProperty("answers");
  await expect(prepareChallengeRun("account", challenge, mapping)).rejects.toThrow("Resume or verify");
  mock.write.mockRejectedValueOnce(new Error("Device storage full"));
  await expect(prepareChallengeRun("other-account", challenge, mapping)).rejects.toThrow("storage full");
});

it("observes only the exact new run and sends durable canonical answers once, never a score", async () => {
  const intent = await prepareChallengeRun("account", challenge, mapping);
  const report = vi.fn(), busy = vi.fn(), settled = vi.fn();
  const stop = observeChallengeRun(intent, report, () => {}, settled, busy);
  emit([session("unrelated")]); expect(mock.rpc).not.toHaveBeenCalled();
  emit([session(intent.sessionId)]);
  await vi.waitFor(() => expect(settled).toHaveBeenCalledOnce());
  expect(mock.rpc.mock.calls[0][1]).toEqual({ challenge: "challenge", question_key: "bank:q", answer_key: "A", assisted: false, event_id: expect.stringMatching(/^[a-f0-9-]{36}$/) });
  emit([session(intent.sessionId)]); expect(mock.rpc).toHaveBeenCalledOnce();
  expect(busy.mock.calls.map(args => args[0])).toEqual([true, false]);
  expect(await readChallengeRun("account", challenge.id)).toBeUndefined(); stop();
});

it("retains interrupted verification across reload and reuses exactly the same server event identities", async () => {
  const intent = await prepareChallengeRun("account", challenge, new Map([...mapping, ["second", "bank:q2"]]));
  const quiz = session(intent.sessionId); quiz.questionIds.push("second"); quiz.answers.push({ questionId: "second", answerKey: "B", correct: false, seconds: 1, flagged: false }); persist([quiz]);
  mock.rpc.mockResolvedValueOnce({ data: { accepted: true }, error: null }).mockResolvedValueOnce({ data: null, error: { message: "Lost connection" } });
  await expect(verifyChallengeRun(intent)).rejects.toThrow("verification is incomplete");
  const reopened = await readChallengeRun("account", challenge.id);
  expect(reopened).toEqual(intent);
  expect(await verifyChallengeRun(reopened!)).toBe(2);
  expect(mock.rpc.mock.calls[0][1]).toEqual(mock.rpc.mock.calls[2][1]);
  expect(mock.rpc.mock.calls[1][1]).toEqual(mock.rpc.mock.calls[3][1]);
  expect(await readChallengeRun("account", challenge.id)).toBeUndefined();
});

it("does not promote completed historical/offline runs on refresh, but permits an explicit verification retry", async () => {
  const intent = await prepareChallengeRun("account", challenge, mapping);
  const quiz = session(intent.sessionId, "tutor"); mock.state.quizSessions = [quiz]; persist([quiz]);
  const stop = observeChallengeRun(intent, vi.fn(), () => {}, () => {}, () => {});
  emit([quiz]); await Promise.resolve(); expect(mock.rpc).not.toHaveBeenCalled();
  expect(await verifyChallengeRun(intent)).toBe(1);
  expect(mock.rpc.mock.calls[0][1].assisted).toBe(true); stop();
});

it("keeps the pending reference when the canonical quiz is not durable or the account changes", async () => {
  const intent = await prepareChallengeRun("account", challenge, mapping);
  mock.state.quizSessions = [session(intent.sessionId)];
  await expect(verifyChallengeRun(intent)).rejects.toThrow("Finish saving");
  expect(mock.rpc).not.toHaveBeenCalled();
  persist(mock.state.quizSessions); mock.assert.mockImplementation(() => { throw new Error("Account changed"); });
  await expect(verifyChallengeRun(intent)).rejects.toThrow("Account changed");
  expect(mock.rpc).not.toHaveBeenCalled();
  expect(await readChallengeRun("account", challenge.id)).toEqual(intent);
});

it("holds unacknowledged events after navigation and accepts server repeat exclusions without farming points", async () => {
  const intent = await prepareChallengeRun("account", challenge, mapping); persist([session(intent.sessionId)]);
  await expect(verifyChallengeRun(intent, () => true)).rejects.toThrow("Verification paused");
  expect(mock.rpc).not.toHaveBeenCalled();
  mock.rpc.mockResolvedValue({ data: { accepted: false, reason: "already-attempted", points: 0 }, error: null });
  expect(await verifyChallengeRun(intent)).toBe(1);
  expect(await readChallengeRun("account", challenge.id)).toBeUndefined();
});

it("serializes competing launches so another tab cannot overwrite a pending run", async () => {
  const outcomes = await Promise.allSettled([prepareChallengeRun("account", challenge, mapping), prepareChallengeRun("account", challenge, mapping)]);
  expect(outcomes.map(result => result.status)).toEqual(["fulfilled", "rejected"]);
  const winner = outcomes[0];
  if (winner.status !== "fulfilled") throw new Error("The first run should have been saved");
  expect((await readChallengeRun("account", challenge.id))?.sessionId).toBe(winner.value.sessionId);
  vi.stubGlobal("navigator", {});
  await expect(prepareChallengeRun("other-account", challenge, mapping)).rejects.toThrow("safely coordinate");
});
