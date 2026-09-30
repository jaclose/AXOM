// The Promise of Use, in one place: the signing sequence (PromiseCutscene) and
// the saved copy in Settings read the same words. Changing a word means a new
// PROMISE_TEXT_VERSION, so an old signature is never shown against new text.
export const PROMISE_TEXT_VERSION = "promise-of-use-v1";

export interface PromiseMovement {
  label: string;
  lines: string[];
}

/** Read in three calm movements before signing. */
export const PROMISE_MOVEMENTS: readonly PromiseMovement[] = [
  {
    label: "The tool",
    lines: [
      "This is only a tool.",
      "It will not save you.",
      "It will not study for you.",
      "It will not become disciplined on your behalf.",
    ],
  },
  {
    label: "The return",
    lines: [
      "But if you return to it honestly,",
      "if you record the work,",
      "if you confront the missed days,",
      "if you build again after falling behind,",
    ],
  },
  {
    label: "The witness",
    lines: [
      "then this becomes more than software.",
      "It becomes a witness.",
    ],
  },
];

export const PROMISE_LINES: readonly string[] = PROMISE_MOVEMENTS.flatMap((movement) => movement.lines);

/** What the signature commits to. */
export const PROMISE_VOWS: readonly string[] = [
  "I promise to use this system as a place of return.",
  "I promise to build with clarity instead of chaos.",
  "I promise to become responsible for the life I say I want.",
];
