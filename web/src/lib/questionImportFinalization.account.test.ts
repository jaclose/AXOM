import { afterEach, describe, expect, it, vi } from "vitest";
import { useAccount } from "./account/accountStore";
import {
  isReviewedImportInFlight,
  persistReviewedImportOnce,
  type QuestionImportPersistence,
  type ReviewedImportPersistencePlan,
  type ReviewedImportPersistenceResult,
} from "./questionImportFinalization";

const originalAccount = {
  user: useAccount.getState().user,
  phase: useAccount.getState().phase,
};
const sameReviewedFingerprint = "synthetic:identical-reviewed-source-and-filing";

function signIn(id: string): void {
  useAccount.setState({
    phase: "signed-in",
    user: {
      id,
      email: id + "@example.invalid",
      displayName: "Synthetic " + id,
      emailConfirmed: true,
    },
  });
}

function importPlan(id: string): ReviewedImportPersistencePlan {
  return {
    questions: [{
      id,
      source: "imported",
      stem: "Which finding is correct?",
      options: [{ key: "A", text: "First" }, { key: "B", text: "Second" }],
      correctKey: "A",
    }],
  };
}

function persistence(commit: NonNullable<QuestionImportPersistence["commitReviewedImport"]>): QuestionImportPersistence {
  return {
    commitReviewedImport: commit,
    addQuestion: async () => ({ ok: true, errors: [], id: "not-used" }),
    removeQuestion: async () => {},
    addQuestionSet: async () => {},
    removeQuestionSet: async () => {},
    addDocument: async () => {},
    updateDocument: async () => {},
    removeDocument: async () => {},
  };
}

function success(id: string): ReviewedImportPersistenceResult {
  return { ok: true, questionIds: [id], questionSetId: "set-" + id };
}

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

afterEach(() => {
  useAccount.setState(originalAccount);
});

describe("reviewed-import account-epoch isolation", () => {
  it("never joins a different account's identical pending successful import or returns its saved IDs", async () => {
    const gate = deferred();
    const commit = vi.fn(async (plan: ReviewedImportPersistencePlan) => {
      const id = plan.questions[0].id;
      if (id === "a-question") await gate.promise;
      return success(id);
    });
    signIn("account-a");
    const a = persistReviewedImportOnce(sameReviewedFingerprint, persistence(commit), importPlan("a-question"));
    signIn("account-b");
    // The shared local workspace may still expose A\x27s tentative state.
    // No caller may mistake that state for a settled equivalent set.
    expect(isReviewedImportInFlight(sameReviewedFingerprint)).toBe(true);
    const b = persistReviewedImportOnce(sameReviewedFingerprint, persistence(commit), importPlan("b-question"));
    expect(commit).toHaveBeenCalledTimes(1);
    gate.release();
    await expect(a).rejects.toThrow(/account changed/i);
    await expect(b).resolves.toEqual({ joined: false, result: success("b-question") });
    expect(commit).toHaveBeenCalledTimes(2);
  });

  it("never forwards account A's failed import result to account B", async () => {
    const gate = deferred();
    const commit = vi.fn(async (plan: ReviewedImportPersistencePlan): Promise<ReviewedImportPersistenceResult> => {
      const id = plan.questions[0].id;
      if (id === "a-question") {
        await gate.promise;
        return { ok: false, message: "A's private write rejected", rollbackFailures: [] };
      }
      return success(id);
    });
    signIn("account-a");
    const a = persistReviewedImportOnce(sameReviewedFingerprint, persistence(commit), importPlan("a-question"));
    signIn("account-b");
    const b = persistReviewedImportOnce(sameReviewedFingerprint, persistence(commit), importPlan("b-question"));
    gate.release();
    await expect(a).rejects.toThrow(/account changed/i);
    await expect(b).resolves.toEqual({ joined: false, result: success("b-question") });
    expect(commit).toHaveBeenCalledTimes(2);
  });

  it("invalidates the old A operation after A to B to A and starts a new A commit", async () => {
    const gate = deferred();
    const commit = vi.fn(async (plan: ReviewedImportPersistencePlan) => {
      const id = plan.questions[0].id;
      if (id === "a-before-switch") await gate.promise;
      return success(id);
    });
    signIn("account-a");
    const oldA = persistReviewedImportOnce(sameReviewedFingerprint, persistence(commit), importPlan("a-before-switch"));
    signIn("account-b");
    signIn("account-a");
    const newA = persistReviewedImportOnce(sameReviewedFingerprint, persistence(commit), importPlan("a-after-return"));
    gate.release();
    await expect(oldA).rejects.toThrow(/account changed/i);
    await expect(newA).resolves.toEqual({ joined: false, result: success("a-after-return") });
    expect(commit).toHaveBeenCalledTimes(2);
  });

  it("still joins the same account's retry across two different adapter instances", async () => {
    const gate = deferred();
    const commit = vi.fn(async () => { await gate.promise; return success("original"); });
    signIn("account-a");
    const first = persistReviewedImportOnce(sameReviewedFingerprint, persistence(commit), importPlan("original"));
    const second = persistReviewedImportOnce(sameReviewedFingerprint, persistence(commit), importPlan("remount"));
    gate.release();
    await expect(first).resolves.toEqual({ joined: false, result: success("original") });
    await expect(second).resolves.toEqual({ joined: true, result: success("original") });
    expect(commit).toHaveBeenCalledOnce();
  });

  it("prevents a queued account B write from starting after switching back to A", async () => {
    const gate = deferred();
    const commit = vi.fn(async (plan: ReviewedImportPersistencePlan) => {
      if (plan.questions[0].id === "a-question") await gate.promise;
      return success(plan.questions[0].id);
    });
    signIn("account-a");
    const a = persistReviewedImportOnce(sameReviewedFingerprint, persistence(commit), importPlan("a-question"));
    signIn("account-b");
    const b = persistReviewedImportOnce(sameReviewedFingerprint, persistence(commit), importPlan("b-question"));
    signIn("account-a");
    gate.release();
    await expect(a).rejects.toThrow(/account changed/i);
    await expect(b).rejects.toThrow(/account changed/i);
    expect(commit).toHaveBeenCalledTimes(1);
  });
});
