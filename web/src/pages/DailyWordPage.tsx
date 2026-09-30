import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ArrowLeft, BarChart3, Check, CircleDot, Clock3, Copy, Delete, HelpCircle, Minus, ShieldCheck } from "lucide-react";
import { GlassCard, GButton } from "../components/ui/primitives";
import { Modal } from "../components/ui/Modal";
import { DailyWordDemo } from "../components/games/DailyWordDemo";
import {
  buildDailyWordShare,
  dailyWordNumber,
  DAILY_WORD_MAX_GUESSES,
  deriveDailyWordStats,
  millisecondsUntilNextCalendarDate,
  resolveTimeZone,
  scoreGuess,
  selectDailyWordAnswer,
  selectDailyWordPuzzle,
  type LetterEvaluation,
} from "../lib/dailyWord";
import { useClockNow } from "../lib/clock";
import { useStore } from "../lib/store";
import { dismissAnnouncement, isAnnouncementDismissed, readDismissedAnnouncements } from "../lib/announcements";
import "../styles/daily-games.css";
import { ICON_SIZE } from "../lib/iconSize";

interface WordData {
  answersForVersion: (version: string) => readonly string[] | undefined;
  allowed: ReadonlySet<string>;
  version: string;
  marker: string;
}

const KEYBOARD_ROWS = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"] as const;
const EVALUATION_LABEL: Record<LetterEvaluation, string> = {
  correct: "correct position",
  present: "present in word, wrong position",
  absent: "not in word",
};
const EVALUATION_RANK: Record<LetterEvaluation, number> = { absent: 1, present: 2, correct: 3 };
const DAILY_WORD_HOW_TO_ANNOUNCEMENT_ID = "daily-word-how-to-v1";
const DAILY_WORD_SUGGESTION_EMAIL = "jafardabbagh@gmail.com";

export function buildDailyWordSuggestionMailto(word: string, dictionaryVersion: string): string {
  const normalized = word.trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5);
  const version = dictionaryVersion.trim().slice(0, 40);
  const subject = `[AXOM Suggestion] Daily Word: ${normalized || "word"}`;
  const body = [
    `Suggested word: ${normalized || "(not provided)"}`,
    `Dictionary version: ${version || "unknown"}`,
    "Route: #daily-word",
  ].join("\n");
  return `mailto:${DAILY_WORD_SUGGESTION_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function DailyWordPage() {
  const profile = useStore((state) => state.profile);
  const history = useStore((state) => state.dailyWordPuzzles);
  const upsertPuzzle = useStore((state) => state.upsertDailyWordPuzzle);
  const [words, setWords] = useState<WordData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("Enter a five-letter word.");
  const [unrecognizedWord, setUnrecognizedWord] = useState("");
  const [manualShare, setManualShare] = useState("");
  // Opens the moment a puzzle is finished in this visit (Doctordle-style);
  // on a return visit the compact results row offers it instead.
  const [winOpen, setWinOpen] = useState(false);
  // First visit plays the on-board how-to once (JD, Ideas 3); later visits
  // replay it from "How to play". Typing always skips it.
  const [firstVisit] = useState(() => !isAnnouncementDismissed(
    DAILY_WORD_HOW_TO_ANNOUNCEMENT_ID,
    readDismissedAnnouncements(),
  ));
  const [demo, setDemo] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const demoStarted = useRef(false);
  const endDemo = useCallback(() => setDemo(false), []);
  const submitting = useRef(false);
  const manualShareRef = useRef<HTMLTextAreaElement>(null);
  const initializedPuzzleId = useRef<string>();
  const now = useClockNow("minute");
  const timeZone = resolveTimeZone(profile.timeZonePreference);

  useEffect(() => {
    let cancelled = false;
    import("../data/dailyWordWords")
      .then((module) => {
        if (cancelled) return;
        setWords({
          answersForVersion: module.dailyWordAnswersForVersion,
          allowed: new Set(module.DAILY_WORD_ALLOWED_GUESSES),
          version: module.WORD_LIST_VERSION,
          marker: module.DAILY_WORD_LIST_SENTINEL,
        });
      })
      .catch(() => { if (!cancelled) setLoadError("The local word list could not be opened."); });
    return () => { cancelled = true; };
  }, []);

  const selection = useMemo(() => words ? selectDailyWordPuzzle({
    history,
    now,
    timeZone,
    wordListVersion: words.version,
  }) : null, [history, now, timeZone, words]);
  const puzzle = selection?.puzzle;
  const puzzleAnswers = puzzle && words ? words.answersForVersion(puzzle.wordListVersion) : undefined;
  const answer = useMemo(
    () => puzzle && puzzleAnswers ? selectDailyWordAnswer(puzzle.puzzleId, puzzleAnswers) : "",
    [puzzle, puzzleAnswers],
  );
  const evaluations = useMemo(
    () => puzzle && answer ? puzzle.guesses.map((guess) => scoreGuess(guess, answer)) : [],
    [answer, puzzle],
  );
  const keyStates = useMemo(() => deriveKeyStates(puzzle?.guesses ?? [], evaluations), [evaluations, puzzle?.guesses]);
  const stats = useMemo(() => deriveDailyWordStats(history), [history]);
  const nextPuzzleCountdown = useMemo(
    () => puzzle?.completed ? formatCountdown(millisecondsUntilNextCalendarDate(now, puzzle.timezone)) : "",
    [now, puzzle?.completed, puzzle?.timezone],
  );

  useEffect(() => {
    if (selection?.created) upsertPuzzle(selection.puzzle);
  }, [selection?.created, selection?.puzzle, upsertPuzzle]);

  useEffect(() => {
    if (!words || !puzzle) return;
    dismissAnnouncement(DAILY_WORD_HOW_TO_ANNOUNCEMENT_ID);
    if (firstVisit && !demoStarted.current && !puzzle.completed && puzzle.guesses.length === 0) {
      demoStarted.current = true;
      setDemo(true);
    }
  }, [firstVisit, puzzle, words]);

  useEffect(() => {
    if (!puzzle || initializedPuzzleId.current === puzzle.puzzleId) return;
    initializedPuzzleId.current = puzzle.puzzleId;
    setDraft("");
    setUnrecognizedWord("");
    setManualShare("");
    setStatus(puzzle.completed
      ? puzzle.won ? `Solved in ${puzzle.guesses.length} guess${puzzle.guesses.length === 1 ? "" : "es"}.` : "Puzzle complete."
      : "Enter a five-letter word.");
  }, [puzzle]);

  // Keep the synchronous guard raised until the persisted puzzle update has
  // rendered. This blocks key-repeat/double-click submissions from appending
  // the same row twice through a stale render closure.
  useEffect(() => {
    submitting.current = false;
  }, [puzzle?.updatedAt]);

  useEffect(() => {
    if (!manualShare) return;
    manualShareRef.current?.focus();
    manualShareRef.current?.select();
  }, [manualShare]);

  const submit = useCallback(() => {
    if (!puzzle || !words || !answer || submitting.current) return;
    if (puzzle.completed) {
      setStatus("Puzzle complete.");
      setUnrecognizedWord("");
      return;
    }
    if (draft.length !== 5) {
      setStatus("Enter five letters.");
      setUnrecognizedWord("");
      return;
    }
    if (puzzle.guesses.includes(draft)) {
      setStatus("That word was already used.");
      setUnrecognizedWord("");
      return;
    }
    if (!words.allowed.has(draft)) {
      setStatus("Not recognized in AXOM’s current dictionary.");
      setUnrecognizedWord(draft);
      return;
    }
    setUnrecognizedWord("");
    submitting.current = true;
    const guesses = [...puzzle.guesses, draft];
    const won = draft === answer;
    const completed = won || guesses.length >= DAILY_WORD_MAX_GUESSES;
    const timestamp = new Date().toISOString();
    upsertPuzzle({
      ...puzzle,
      guesses,
      won,
      completed,
      completedAt: completed ? timestamp : undefined,
      updatedAt: timestamp,
    });
    const row = scoreGuess(draft, answer);
    setDraft("");
    setManualShare("");
    if (completed) setWinOpen(true);
    setStatus(won
      ? `Correct. Solved in ${guesses.length} guess${guesses.length === 1 ? "" : "es"}.`
      : completed
        ? "Six guesses used. The puzzle is complete."
        : summarizeEvaluation(row));
  }, [answer, draft, puzzle, upsertPuzzle, words]);

  const enterLetter = useCallback((letter: string) => {
    if (!puzzle || puzzle.completed || !/^[A-Z]$/.test(letter)) return;
    setDemo(false);
    setUnrecognizedWord("");
    setDraft((current) => current.length < 5 ? `${current}${letter}` : current);
  }, [puzzle]);

  const backspace = useCallback(() => {
    if (!puzzle || puzzle.completed) return;
    setDemo(false);
    setUnrecognizedWord("");
    setDraft((current) => current.slice(0, -1));
  }, [puzzle]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof Element
        && target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])")) return;
      if (/^[a-zA-Z]$/.test(event.key)) {
        event.preventDefault();
        enterLetter(event.key.toUpperCase());
      } else if (event.key === "Backspace") {
        event.preventDefault();
        backspace();
      } else if (event.key === "Enter") {
        event.preventDefault();
        submit();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [backspace, enterLetter, submit]);

  async function shareResult() {
    if (!puzzle?.completed) return;
    const result = buildDailyWordShare(puzzle, evaluations);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(result);
      setManualShare("");
      setStatus("Result copied. The answer and guesses were not included.");
    } catch {
      setManualShare(result);
      setStatus("Clipboard unavailable. Copy the result from the manual-copy field.");
    }
  }

  if (loadError) return <GlassCard pad><h1>AXOM Daily Word</h1><p role="alert">{loadError}</p></GlassCard>;
  if (!words || !puzzle) return <div className="route-loading" role="status">Opening the local daily puzzle…</div>;
  if (!answer) {
    return (
      <GlassCard pad>
        <h1>AXOM Daily Word</h1>
        <p role="alert">This historical puzzle uses an unavailable dictionary version. Its saved guesses were preserved and were not rescored.</p>
      </GlassCard>
    );
  }

  return (
    <div className="daily-word-page" data-list-marker={words.marker}>
      <div className="daily-word-topline">
        <a className="daily-word-back" href="#daily-games"><ArrowLeft size={ICON_SIZE.body} aria-hidden="true" /> Daily Games</a>
        <button
          type="button"
          className="daily-word-howto"
          aria-expanded={legendOpen || demo}
          onClick={() => {
            if (!puzzle.completed && puzzle.guesses.length === 0 && !draft) setDemo(true);
            else setLegendOpen((open) => !open);
          }}
        >
          <HelpCircle size={ICON_SIZE.body} aria-hidden="true" /> How to play
        </button>
        <span className="daily-word-date"><b>#{dailyWordNumber(puzzle.puzzleDate)}</b><span>{puzzle.puzzleDate}</span></span>
      </div>
      {/* The top bar already shows the title; keep the page heading for assistive tech. */}
      <header className="sr-only">
        <h1>AXOM Daily Word</h1>
        <p>A daily five-letter word puzzle.</p>
      </header>

      <GlassCard pad className="daily-word-board-card">
        {legendOpen && (
          <div className="daily-word-legend" role="note">
            <span><i className="correct" /> Right letter, right spot</span>
            <span><i className="present" /> In the word, another spot</span>
            <span><i className="absent" /> Not in the word</span>
          </div>
        )}
        <div className="daily-word-grid-wrap">
        <div className="daily-word-grid" role="grid" aria-label={`Six-row Daily Word puzzle for ${puzzle.puzzleDate}`}>
          {Array.from({ length: DAILY_WORD_MAX_GUESSES }, (_, rowIndex) => {
            const submitted = puzzle.guesses[rowIndex];
            const current = rowIndex === puzzle.guesses.length && !puzzle.completed ? draft : "";
            const letters = (submitted ?? current).padEnd(5, " ").slice(0, 5).split("");
            return (
              <div className="daily-word-row" role="row" aria-label={`Row ${rowIndex + 1}`} key={rowIndex}>
                {letters.map((letter, columnIndex) => {
                  const evaluation = submitted ? evaluations[rowIndex]?.[columnIndex] : undefined;
                  const label = evaluation
                    ? `Row ${rowIndex + 1}, column ${columnIndex + 1}, letter ${letter}, ${EVALUATION_LABEL[evaluation]}.`
                    : `Row ${rowIndex + 1}, column ${columnIndex + 1}, ${letter.trim() ? `letter ${letter}` : "blank"}.`;
                  return (
                    <div className={`daily-word-tile ${evaluation ?? ""} ${letter.trim() ? "filled" : ""}`} role="gridcell" aria-label={label} key={columnIndex}>
                      <span>{letter.trim()}</span>
                      {evaluation === "correct" && <Check size={ICON_SIZE.microInline} aria-hidden="true" />}
                      {evaluation === "present" && <CircleDot size={ICON_SIZE.microInline} aria-hidden="true" />}
                      {evaluation === "absent" && <Minus size={ICON_SIZE.microInline} aria-hidden="true" />}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

          {demo && <DailyWordDemo wordCount={words.allowed.size} onDone={endDemo} />}
        </div>

        <div className="daily-word-status" role="status" aria-live="polite" aria-atomic="true">{status}</div>
        {unrecognizedWord && (
          <a className="gbtn sm daily-word-suggest" href={buildDailyWordSuggestionMailto(unrecognizedWord, words.version)}>
            Suggest this word
          </a>
        )}

        <div className="daily-word-keyboard" role="group" aria-label="On-screen keyboard">
          {KEYBOARD_ROWS.map((row) => (
            <div className="daily-word-keyboard-row" key={row}>
              {row.split("").map((letter) => (
                <button
                  type="button"
                  className={`daily-word-key ${keyStates[letter] ?? "unknown"}`}
                  aria-label={`Letter ${letter}${keyStates[letter] ? `, ${EVALUATION_LABEL[keyStates[letter]!]}` : ""}`}
                  disabled={puzzle.completed}
                  onClick={() => enterLetter(letter)}
                  key={letter}
                >{letter}</button>
              ))}
            </div>
          ))}
          <div className="daily-word-keyboard-row actions">
            <button type="button" className="daily-word-key wide" disabled={puzzle.completed} onClick={submit}>Enter</button>
            <button type="button" className="daily-word-key wide" aria-label="Backspace" disabled={puzzle.completed} onClick={backspace}><Delete size={ICON_SIZE.emphasis} aria-hidden="true" /> Backspace</button>
          </div>
        </div>
        <p className="daily-word-dictionary-note">Dictionary {words.version} · {words.allowed.size.toLocaleString()} words · works offline</p>
      </GlassCard>

      {puzzle.completed && (
        <div className="daily-word-done" role="group" aria-label="Today's result">
          <span className="daily-word-done-score">
            <b>{puzzle.won ? `Solved in ${puzzle.guesses.length}` : "Not this time"}</b>
            <span aria-label={`Time until the next Daily Word puzzle: ${nextPuzzleCountdown}`}><Clock3 size={ICON_SIZE.microInline} aria-hidden="true" /> Next word in {nextPuzzleCountdown}</span>
          </span>
          <GButton size="sm" variant="primary" onClick={shareResult}><Copy size={ICON_SIZE.body} /> Share result</GButton>
          <GButton size="sm" onClick={() => setWinOpen(true)}><BarChart3 size={ICON_SIZE.body} /> See results</GButton>
        </div>
      )}
      {puzzle.completed && !winOpen && manualShare && <ManualShare value={manualShare} textareaRef={manualShareRef} />}

      {puzzle.completed && winOpen && (
        <Modal title={puzzle.won ? "Puzzle solved" : "Puzzle complete"} onClose={() => setWinOpen(false)} className="daily-word-win">
          <p className="daily-word-win-kicker">
            Today's word · #{dailyWordNumber(puzzle.puzzleDate)} · {puzzle.won ? `solved in ${puzzle.guesses.length} ${puzzle.guesses.length === 1 ? "guess" : "guesses"}` : "six guesses used"}
          </p>
          <p className="daily-word-answer">Answer: <b>{answer}</b></p>
          <div className="daily-word-stats" aria-label="Daily Word statistics">
            <Stat label="Played" value={stats.gamesPlayed} />
            <Stat label="Win %" value={stats.gamesPlayed ? Math.round((stats.wins / stats.gamesPlayed) * 100) : 0} />
            <Stat label="Streak" value={stats.currentStreak} />
            <Stat label="Best" value={stats.maxStreak} />
          </div>
          <div className="daily-word-distribution">
            <h3>Guess distribution</h3>
            {Array.from({ length: DAILY_WORD_MAX_GUESSES }, (_, index) => index + 1).map((guess) => {
              const mine = puzzle.won && puzzle.guesses.length === guess;
              return (
                <div className={`daily-word-distribution-row ${mine ? "is-today" : ""}`} key={guess}>
                  <span>{mine && <em aria-label="Today">You</em>}{guess}</span>
                  <div><i style={{ width: `${distributionWidth(stats.guessDistribution[guess] ?? 0, stats.wins)}%` }} /></div>
                  <b>{stats.guessDistribution[guess] ?? 0}</b>
                </div>
              );
            })}
          </div>
          <div className="daily-word-win-foot">
            <span className="daily-word-countdown" aria-label={`Time until the next Daily Word puzzle: ${nextPuzzleCountdown}`}>
              <Clock3 size={ICON_SIZE.body} aria-hidden="true" /> Next word in <b>{nextPuzzleCountdown}</b>
            </span>
            <GButton variant="primary" onClick={shareResult}><Copy size={ICON_SIZE.body} /> Share result</GButton>
          </div>
          {manualShare && <ManualShare value={manualShare} textareaRef={manualShareRef} />}
          <div className="backup-note"><ShieldCheck size={ICON_SIZE.body} /><span>Sharing shows the puzzle number, your score and coloured squares. Never the word or your guesses.</span></div>
        </Modal>
      )}
    </div>
  );
}

function deriveKeyStates(
  guesses: readonly string[],
  rows: readonly (readonly LetterEvaluation[])[],
): Partial<Record<string, LetterEvaluation>> {
  const result: Partial<Record<string, LetterEvaluation>> = {};
  guesses.forEach((guess, rowIndex) => guess.split("").forEach((letter, columnIndex) => {
    const next = rows[rowIndex]?.[columnIndex];
    if (!next) return;
    const current = result[letter];
    if (!current || EVALUATION_RANK[next] > EVALUATION_RANK[current]) result[letter] = next;
  }));
  return result;
}

function summarizeEvaluation(row: readonly LetterEvaluation[]) {
  const correct = row.filter((value) => value === "correct").length;
  const present = row.filter((value) => value === "present").length;
  return `${correct} correct ${correct === 1 ? "position" : "positions"}; ${present} present elsewhere.`;
}

function distributionWidth(value: number, wins: number) {
  if (!wins) return 0;
  return Math.max(value ? 8 : 0, Math.round((value / wins) * 100));
}

function formatCountdown(milliseconds: number): string {
  const totalMinutes = Math.max(0, Math.ceil(milliseconds / 60_000));
  if (totalMinutes < 1) return "less than a minute";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!hours) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function ManualShare({ value, textareaRef }: { value: string; textareaRef: RefObject<HTMLTextAreaElement> }) {
  return (
    <label className="stack gap6 daily-word-manual-share">
      <span className="field-label">Manual copy result</span>
      <textarea ref={textareaRef} className="field" readOnly value={value} rows={value.split("\n").length} />
    </label>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div><b>{value}</b><span>{label}</span></div>;
}
