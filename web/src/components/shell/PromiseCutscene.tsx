// The Promise of Use (JD, Wave 2): read in three calm movements the student
// advances at their own pace, then one deliberate signing moment on a paper
// sheet, then a slow fade into AXOM. Every line stays readable at once under
// reduced motion. "Review later" is always one step away; nothing here gates
// the app, and it is not a legal contract.
import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MutableRefObject } from "react";
import { ArrowRight, PenLine } from "lucide-react";
import { useStore } from "../../lib/store";
import { prefersReducedMotion } from "../../lib/motion";
import { revealApp } from "../../lib/presentation";
import { ICON_SIZE } from "../../lib/iconSize";
import { PROMISE_MOVEMENTS, PROMISE_TEXT_VERSION, PROMISE_VOWS } from "../../lib/promiseText";
import { AxomMark, AxomWordmark } from "../ui/BrandMark";
import "../../styles/promise.css";

/** Time between lines inside a movement, and before the first one. */
const LINE_MS = 700;
const LEAD_MS = 450;
/** How long the sealed sheet rests before AXOM fades in. */
const SEALED_REST_MS = 2600;
const FADE_OUT_MS = 900;

type Stage = number | "sign" | "sealed";
const STEPS = PROMISE_MOVEMENTS.length + 1;

export function PromiseCutscene({ onDone }: { onDone: () => void }) {
  const store = useStore();
  const reduceMotion = useRef(prefersReducedMotion()).current;
  const [stage, setStage] = useState<Stage>(0);
  const [leaving, setLeaving] = useState(false);
  const [name, setName] = useState(store.profile.name && !/^(axom|noctyrium)$/i.test(store.profile.name) ? store.profile.name : "");
  const stageRef = useRef<HTMLDivElement>(null);
  const focusRef = useRef<HTMLElement | null>(null);
  const timers = useRef<number[]>([]);
  const onDoneRef = useRef(onDone);
  const nameId = useId();
  const noteId = useId();

  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => window.clearTimeout(timer));
  }, []);

  // Modal behaviour: focus stays inside, Escape is "Review later", and focus
  // returns to wherever it was when the sequence closes.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = stageRef.current;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!root) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onDoneRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = [...root.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])")];
      if (!controls.length) return;
      const first = controls[0];
      const last = controls.at(-1)!;
      if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  // Each new movement takes focus, so a screen reader reads it from the top.
  useEffect(() => {
    focusRef.current?.focus({ preventScroll: true });
  }, [stage]);

  function schedule(callback: () => void, ms: number) {
    timers.current.push(window.setTimeout(callback, ms));
  }

  function advance() {
    setStage((current) => (typeof current === "number" && current < PROMISE_MOVEMENTS.length - 1 ? current + 1 : "sign"));
  }

  function sign() {
    const signedName = name.trim();
    if (!signedName || stage !== "sign") return;
    const signedAt = new Date().toISOString();
    const journalEntryId = crypto.randomUUID();
    store.updateProfile({
      name: signedName,
      promise: { signedName, signedAt, promiseTextVersion: PROMISE_TEXT_VERSION, journalEntryId },
    });
    // The first journal entry is always the promise.
    store.addJournal({
      id: journalEntryId,
      date: signedAt,
      today: `Promise of Use signed by ${signedName}.`,
      tomorrow: "Return honestly. Record the work. Build again after missed days.",
      blockers: "",
      energy: "High",
      rating: "Promise",
    });
    setStage("sealed");
    schedule(enter, reduceMotion ? 1200 : SEALED_REST_MS);
  }

  function enter() {
    if (reduceMotion) { onDoneRef.current(); return; }
    // AXOM's regions slot in from top to bottom while the stage fades above them.
    revealApp("promise");
    setLeaving(true);
    schedule(() => onDoneRef.current(), FADE_OUT_MS);
  }

  // Enter moves to the next movement when nothing else has focus.
  function onStageKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter" || typeof stage !== "number") return;
    if ((event.target as HTMLElement).closest("button, input")) return;
    event.preventDefault();
    advance();
  }

  const step = typeof stage === "number" ? stage : PROMISE_MOVEMENTS.length;
  const sealed = stage === "sealed";
  return (
    <div
      ref={stageRef}
      className={`promise-stage ${leaving ? "leaving" : ""} ${sealed ? "sealed" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="A promise to yourself"
      onKeyDown={onStageKeyDown}
    >
      <div className="promise-stage-glow" aria-hidden="true" />
      <header className="promise-stage-top">
        <AxomWordmark size="sm" className="promise-stage-mark" />
        <ol className="promise-stage-progress" aria-label="Promise progress">
          {Array.from({ length: STEPS }, (_, index) => (
            <li key={index} className={index === step ? "on" : index < step ? "done" : ""} aria-current={index === step ? "step" : undefined}>
              <span className="sr-only">{index < PROMISE_MOVEMENTS.length ? PROMISE_MOVEMENTS[index].label : "Signing"}</span>
            </li>
          ))}
        </ol>
        {!sealed ? <button type="button" className="promise-stage-later" onClick={() => onDoneRef.current()}>Review later</button> : <span />}
      </header>

      <main className="promise-stage-body">
        {typeof stage === "number" ? (
          <Movement
            key={stage}
            index={stage}
            reduceMotion={reduceMotion}
            focusRef={focusRef}
            onContinue={advance}
            onSkip={() => setStage("sign")}
          />
        ) : (
          <section className={`promise-sheet ${sealed ? "is-sealed" : ""}`} aria-labelledby={`${nameId}-title`} tabIndex={-1} ref={(node) => { focusRef.current = node; }}>
            <span className="promise-sheet-kicker">A promise to yourself</span>
            <h2 id={`${nameId}-title`}>What I am promising</h2>
            <ol className="promise-vows">
              {PROMISE_VOWS.map((vow, index) => <li key={vow} style={{ "--i": index } as CSSProperties}>{vow}</li>)}
            </ol>

            <form className="promise-signature" onSubmit={(event) => { event.preventDefault(); sign(); }}>
              <label htmlFor={nameId}>{sealed ? "Signed" : "Sign with your name"}</label>
              <div className="promise-signature-line">
                <input id={nameId} value={name} maxLength={80} autoComplete="name" placeholder="Your name" readOnly={sealed}
                  aria-describedby={noteId} onChange={(event) => setName(event.target.value)} />
                <svg viewBox="0 0 320 24" preserveAspectRatio="none" aria-hidden="true" focusable="false">
                  <path className="promise-ink-base" d="M2 16 H318" />
                  <path className="promise-ink" pathLength={1} d="M4 15c40-10 78-8 114-3 40 6 78 7 114-1 30-6 56-6 84-1" />
                </svg>
              </div>
              <p className="promise-signature-note" id={noteId}>Not a legal contract. It stays in your AXOM and becomes the first page of your journal.</p>
              {!sealed ? (
                <button type="submit" className="promise-sign-btn" disabled={!name.trim()}>
                  <span>Sign the promise</span>
                  <span className="promise-sign-icon" aria-hidden="true"><PenLine size={ICON_SIZE.body} /></span>
                </button>
              ) : (
                <div className="promise-sealed-row" role="status">
                  <span className="promise-seal" aria-hidden="true"><AxomMark size="sm" /></span>
                  <span className="promise-sealed-copy"><b>Promise made.</b><small>Welcome to AXOM, {name.trim()}.</small></span>
                  <button type="button" className="promise-enter" onClick={enter}>
                    Enter AXOM <ArrowRight size={ICON_SIZE.body} aria-hidden="true" />
                  </button>
                </div>
              )}
            </form>
          </section>
        )}
      </main>
    </div>
  );
}

function Movement({ index, reduceMotion, focusRef, onContinue, onSkip }: {
  index: number;
  reduceMotion: boolean;
  focusRef: MutableRefObject<HTMLElement | null>;
  onContinue: () => void;
  onSkip: () => void;
}) {
  const movement = PROMISE_MOVEMENTS[index];
  const labelId = useId();
  const last = index === PROMISE_MOVEMENTS.length - 1;
  const after = reduceMotion ? 0 : LEAD_MS + movement.lines.length * LINE_MS + 500;
  return (
    <section className={`promise-movement ${last ? "final" : ""}`} aria-labelledby={labelId} tabIndex={-1} ref={(node) => { focusRef.current = node; }}>
      <span className="promise-movement-label" id={labelId}>{movement.label}</span>
      <div className="promise-verse">
        {movement.lines.map((line, lineIndex) => (
          <p key={line} className={last && lineIndex === movement.lines.length - 1 ? "accent" : ""}
            style={{ "--delay": `${reduceMotion ? 0 : LEAD_MS + lineIndex * LINE_MS}ms` } as CSSProperties}>
            {line}
          </p>
        ))}
      </div>
      <div className="promise-movement-actions" style={{ "--delay": `${after}ms` } as CSSProperties}>
        <button type="button" className="promise-next" onClick={onContinue}>
          <span>{last ? "Sign it" : "Continue"}</span>
          <span className="promise-next-icon" aria-hidden="true"><ArrowRight size={ICON_SIZE.body} /></span>
        </button>
        {!last && <button type="button" className="promise-skip" onClick={onSkip}>Skip to signing</button>}
      </div>
    </section>
  );
}

/** The signed promise, read back from Settings. */
export function SavedPromise({ onClose }: { onClose: () => void }) {
  const promise = useStore((state) => state.profile.promise);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    // Capture phase, so Escape closes only this sheet and not Settings under it.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const signedOn = promise?.signedAt ? new Date(promise.signedAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "";
  return (
    <div className="promise-stage" role="dialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={onClose}>
      <div className="promise-stage-glow" aria-hidden="true" />
      <main className="promise-stage-body">
        <section className="promise-sheet is-sealed saved" onMouseDown={(event) => event.stopPropagation()}>
          <span className="promise-sheet-kicker">Your promise</span>
          <h2 id={titleId}>A promise to yourself</h2>
          <div className="promise-sheet-verse">
            {PROMISE_MOVEMENTS.map((movement) => (
              <p key={movement.label}>{movement.lines.join(" ")}</p>
            ))}
          </div>
          <ol className="promise-vows">
            {PROMISE_VOWS.map((vow) => <li key={vow}>{vow}</li>)}
          </ol>
          <div className="promise-saved-signature">
            <span className="promise-saved-name">{promise?.signedName}</span>
            <svg viewBox="0 0 320 24" preserveAspectRatio="none" aria-hidden="true" focusable="false">
              <path className="promise-ink" pathLength={1} d="M4 15c40-10 78-8 114-3 40 6 78 7 114-1 30-6 56-6 84-1" />
            </svg>
          </div>
          <p className="promise-signature-note">
            {signedOn ? `Signed ${signedOn}. ` : ""}Not a legal contract. Promise text {promise?.promiseTextVersion ?? PROMISE_TEXT_VERSION}.
          </p>
          <button ref={closeRef} type="button" className="promise-enter" onClick={onClose}>Close</button>
        </section>
      </main>
    </div>
  );
}
