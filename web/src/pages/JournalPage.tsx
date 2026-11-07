import {
  useCallback, useEffect, useMemo, useRef, useState,
  type ChangeEvent, type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { ICON_SIZE } from "../lib/iconSize";
import {
  ArrowDown, ArrowLeft, ArrowRight, BookOpen, CalendarClock, CheckCircle2, ChevronRight,
  CloudSun, Download, HeartHandshake, ImagePlus, Lock, Palette, Pause, Pencil, Play, Plus, Save,
  Trash2, Trophy, X,
} from "lucide-react";
import { useStore } from "../lib/store";
import { useUi } from "../lib/uiStore";
import { useAccount } from "../lib/account/accountStore";
import * as localVault from "../lib/localVault";
import { GButton, GhostButton, PanelHeader, Tag } from "../components/ui/primitives";
import { Field, Modal, SelectField, TextAreaField } from "../components/ui/Modal";
import { dayKey, prettyDate } from "../lib/scoring";
import { entryDayKey, missedStandupDays, planForDay } from "../lib/journal";
import { findLiveSession, formatElapsed, sessionElapsedMs } from "../lib/sessions";
import { formatClock, usePomodoro } from "../lib/pomodoro";
import type { DailyLoopReminderPreferences, DayPlan, JournalEntry, Profile } from "../lib/types";
import { announceJournalEnergyOnce } from "../lib/journalAnnouncement";
import { selectDayAtAGlance } from "../lib/dayAtAGlance";
import { buildDayExtraSections } from "../lib/journalExtras";
import { readListeningLog } from "../lib/soundscapes/listeningLog";
import { readRestLog } from "../lib/rest";
import { focusCheckInLedger } from "../lib/focusCheckIn";
import { useReducedMotion } from "../lib/motion";
import { normalizeDailyLoopReminderPreferences } from "../lib/dailyLoopReminders";
import { journalReflectionNeedsSupport } from "../lib/journalSupport";
import { studyCreditsBalance, STUDY_CURRENCY_NAME, STUDY_CURRENCY_SHORT } from "../lib/studyStreaks";
import { unlock, useUnlocked } from "../lib/unlocks";
import { useSoundscape } from "../lib/soundscapes/store";
import { submitJournalFeedback, type JournalExperienceFeedbackInput } from "../lib/journalFeedback";
import {
  DEFAULT_JOURNAL_NOTEBOOK,
  JOURNAL_STYLE_COST,
  buildJournalGlanceSections,
  buildJournalMarkdown,
  createJournalAttachmentExport,
  formatBytes,
  hasNotebookContent,
  nextJournalDay,
  normalizeJournalAttachments,
  normalizeJournalNotebookPreferences,
  previousJournalDay,
  readJournalImage,
  renderJournalGlanceText,
  withoutJournalAttachment,
  type JournalGlancePreferences,
  type JournalGlanceSectionKey,
  type JournalImageAttachment,
  type JournalNotebookEntryFields,
  type JournalNotebookPreferences,
  type JournalPremiumStyle,
  type JournalPurpose,
  type NotebookJournalEntry,
} from "../lib/journalNotebook";

type JournalProfile = Profile & { journalNotebook?: JournalNotebookPreferences };
type TurnDirection = "previous" | "next" | null;
export type JournalTransitionGuard = (transition: () => void) => Promise<boolean>;
export type RegisterJournalTransitionGuard = (guard: JournalTransitionGuard) => () => void;
type JournalPersistResult = "saved" | "no-change" | "superseded" | "aborted" | "failed";

const outcomeTone = { won: "green", partial: "orange", missed: "red" } as const;
const journalPurposePrompts: Record<JournalPurpose, string> = {
  focus: "Notice where your attention went. One true line is enough.",
  reflect: "Keep what mattered. Let the rest be unfinished.",
  recover: "Set down what you carried. Begin wherever you are.",
};
const journalPromptSets: Record<JournalPurpose, { today: string; blockers: string; tomorrow: string }> = {
  focus: {
    today: "What held your attention today?",
    blockers: "Where did it drift?",
    tomorrow: "What would make one focused stretch easier?",
  },
  reflect: {
    today: "Which moment will you remember?",
    blockers: "What can you set down tonight?",
    tomorrow: "What deserves a place tomorrow?",
  },
  recover: {
    today: "What asked more of you than expected?",
    blockers: "What can stay on this page?",
    tomorrow: "What would make tomorrow gentler?",
  },
};

const deskWeatherSequence: JournalNotebookPreferences["weather"][] = ["dawn", "sun", "overcast", "rain", "night"];
const deskWeatherName: Record<JournalNotebookPreferences["weather"], string> = {
  dawn: "First light",
  sun: "Late sun",
  overcast: "Cloud cover",
  rain: "Rain",
  night: "Night",
};

function nextDeskWeather(current: JournalNotebookPreferences["weather"]): JournalNotebookPreferences["weather"] {
  return deskWeatherSequence[(deskWeatherSequence.indexOf(current) + 1) % deskWeatherSequence.length];
}

function JournalWeatherControls({ weather, automatic, paused, onNext, onToggle }: {
  weather: JournalNotebookPreferences["weather"];
  automatic: boolean;
  paused: boolean;
  onNext: () => void;
  onToggle: () => void;
}) {
  return <div className="journal-weather-controls" role="group" aria-label={`${deskWeatherName[weather]} desk ambience. ${automatic ? (paused ? "Scene paused" : "Scenes change automatically") : "Manual scene"}`}>
    <span className="journal-weather-label"><CloudSun size={ICON_SIZE.body} /> <b>{deskWeatherName[weather]}</b><small>{automatic ? (paused ? "Paused" : "Changing scene") : "Manual scene"}</small></span>
    <button type="button" onClick={onNext} aria-label="Next desk scene" title="Next desk scene"><ArrowRight size={ICON_SIZE.body} /></button>
    {automatic && <button type="button" onClick={onToggle} aria-label={paused ? "Resume changing desk scene" : "Pause changing desk scene"} title={paused ? "Resume changing desk scene" : "Pause changing desk scene"}>{paused ? <Play size={ICON_SIZE.body} /> : <Pause size={ICON_SIZE.body} />}</button>}
  </div>;
}

function journalFeedbackRequested(): boolean {
  if (typeof window === "undefined") return false;
  const [route, query = ""] = window.location.hash.slice(1).split("?");
  return route === "journal" && new URLSearchParams(query).get("feedback") === "1";
}

function clearJournalFeedbackRequest() {
  if (!journalFeedbackRequested()) return;
  const [route, query = ""] = window.location.hash.slice(1).split("?");
  const params = new URLSearchParams(query);
  params.delete("feedback");
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${route}${params.size ? `?${params}` : ""}`);
}

interface DeskMessage {
  label: string;
  value: string;
  detail: string;
}

function JournalDeskLaptop({ today }: { today: string }) {
  const tracker = useStore((state) => state.tracker);
  const questions = useStore((state) => state.questions);
  const tasks = useStore((state) => state.tasks);
  const sessions = useStore((state) => state.sessions);
  const pomodoro = usePomodoro();
  const liveSession = findLiveSession(sessions ?? []);
  const runningSession = liveSession?.status === "active" ? liveSession : undefined;
  const running = pomodoro.running || Boolean(runningSession);
  const [now, setNow] = useState(() => Date.now());
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    if (!runningSession || pomodoro.running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [runningSession, pomodoro.running]);

  const messages = useMemo(() => {
    const result: Array<DeskMessage & { at: number }> = [];
    const recentTracker = tracker.flatMap((item) => (item.passEvents ?? []).map((event) => ({ item, at: event.at })))
      .filter(({ at }) => Number.isFinite(Date.parse(at)) && dayKey(new Date(at)) === today)
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
    if (recentTracker) result.push({
      label: "COURSE TRACKER",
      value: `${recentTracker.item.label} marked.`,
      detail: "That step is on the record.",
      at: Date.parse(recentTracker.at),
    });

    const answered = questions.flatMap((question) => (question.attempts ?? [])
      .filter((attempt) => Number.isFinite(Date.parse(attempt.at)) && dayKey(new Date(attempt.at)) === today
        && ["correct", "incorrect", "guessed"].includes(attempt.status))
      .map((attempt) => ({ questionId: question.id, at: attempt.at })));
    const questionCount = new Set(answered.map((attempt) => attempt.questionId)).size;
    if (questionCount > 0) result.push({
      label: "QUESTION PRACTICE",
      value: `${questionCount} question${questionCount === 1 ? "" : "s"} logged.`,
      detail: questionCount >= 20 ? "A full stretch of practice. Good work." : "Every answer adds to the picture.",
      at: Math.max(...answered.map((attempt) => Date.parse(attempt.at))),
    });

    const completedTask = tasks.filter((task) => task.done && task.completedAt && Number.isFinite(Date.parse(task.completedAt))
      && dayKey(new Date(task.completedAt)) === today)
      .sort((a, b) => Date.parse(b.completedAt ?? "") - Date.parse(a.completedAt ?? ""))[0];
    if (completedTask) result.push({
      label: "TASK FINISHED",
      value: completedTask.title,
      detail: "You made room for what comes next.",
      at: Date.parse(completedTask.completedAt ?? ""),
    });

    const completedSession = (sessions ?? []).filter((session) => session.status === "completed" && session.endedAt
      && Number.isFinite(Date.parse(session.endedAt)) && dayKey(new Date(session.endedAt)) === today)
      .sort((a, b) => Date.parse(b.endedAt ?? "") - Date.parse(a.endedAt ?? ""))[0];
    if (completedSession) result.push({
      label: "FOCUS KEPT",
      value: `${Math.max(1, Math.round(sessionElapsedMs(completedSession) / 60_000))} minutes logged.`,
      detail: completedSession.title || "A study session finished today.",
      at: Date.parse(completedSession.endedAt ?? ""),
    });
    return result.sort((a, b) => b.at - a.at).slice(0, 4);
  }, [tracker, questions, tasks, sessions, today]);

  useEffect(() => {
    if (running || messages.length < 2) return;
    const timer = window.setInterval(() => setMessageIndex((index) => index + 1), 7200);
    return () => window.clearInterval(timer);
  }, [running, messages.length]);

  const message = messages[messageIndex % messages.length];
  const open = running || Boolean(message);
  const timerValue = pomodoro.running ? formatClock(pomodoro.secondsLeft)
    : runningSession ? formatElapsed(sessionElapsedMs(runningSession, new Date(now))) : "";
  const timerDetail = pomodoro.running
    ? pomodoro.targetLabel || pomodoro.intention || (pomodoro.phase === "break" ? "A pause is part of the work." : "Stay with one thing.")
    : runningSession?.title || "Focus session";

  return (
    <div role="img" className={`journal-desk-laptop${open ? " is-open" : " is-closed"}`} aria-label={running
      ? `MacBook showing ${pomodoro.phase === "break" ? "break" : "focus"} timer ${timerValue}`
      : message ? `MacBook showing recent progress: ${message.value}` : "Closed MacBook"}>
      <span className="journal-desk-laptop-base" aria-hidden="true"><span className="journal-desk-laptop-keys" /><span className="journal-desk-laptop-trackpad" /></span>
      <span className="journal-desk-laptop-lid" aria-hidden="true">
        <span className="journal-desk-laptop-mark" />
        <span className="journal-desk-laptop-screen">
          <span className="journal-desk-laptop-screen-head"><i /> AXOM <span>{running ? "LIVE" : "TODAY"}</span></span>
          <strong>{running ? timerValue : message?.value}</strong>
          <small>{running ? timerDetail : message?.detail}</small>
          <span className="journal-desk-laptop-screen-foot">{running ? "FOCUS IN PROGRESS" : message?.label}</span>
        </span>
      </span>
      <span className="journal-desk-laptop-port" aria-hidden="true" />
    </div>
  );
}

export function JournalPage({ registerAppTransitionGuard }: {
  registerAppTransitionGuard?: RegisterJournalTransitionGuard;
} = {}) {
  const s = useStore();
  const journalDay = useUi((state) => state.journalDay);
  const clearJournalDay = useUi((state) => state.clearJournalDay);
  const reducedMotion = useReducedMotion();
  const [selectedDay, setSelectedDay] = useState(s.activeDayKey || dayKey());
  const [open, setOpen] = useState(false);
  const [startZoomed, setStartZoomed] = useState(false);
  const [turnDirection, setTurnDirection] = useState<TurnDirection>(null);
  const [customizing, setCustomizing] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(() => !(s.profile as JournalProfile).journalNotebook?.setupCompleted && s.journal.length === 0);
  const [feedbackOpen, setFeedbackOpen] = useState(() => journalFeedbackRequested());
  const [closingDay, setClosingDay] = useState<string | null>(null);
  const transitionGuardRef = useRef<JournalTransitionGuard | null>(null);
  const requestedJournalDayRef = useRef<string | null>(null);
  const today = s.activeDayKey || dayKey();
  const preferences = normalizeJournalNotebookPreferences((s.profile as JournalProfile).journalNotebook);
  const credits = studyCreditsBalance(s);
  const [sceneWeather, setSceneWeather] = useState(preferences.weather);
  const [weatherPaused, setWeatherPaused] = useState(false);
  const missed = missedStandupDays({ journal: s.journal, logs: s.logs, dayPlans: s.dayPlans });
  const entries = useMemo(
    () => [...s.journal].sort((a, b) => entryDayKey(b).localeCompare(entryDayKey(a))),
    [s.journal],
  );

  useEffect(() => { announceJournalEnergyOnce(); }, []);

  useEffect(() => { setSceneWeather(preferences.weather); }, [preferences.weather]);

  useEffect(() => {
    if (!preferences.weatherCycle || weatherPaused || reducedMotion) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible" || document.querySelector(".journal-book-stage.is-zoomed")) return;
      if (document.activeElement instanceof Element && document.activeElement.closest(".journal-inline-book")) return;
      setSceneWeather(nextDeskWeather);
    }, 16000);
    return () => window.clearInterval(interval);
  }, [preferences.weatherCycle, weatherPaused, reducedMotion]);

  useEffect(() => {
    const openFromRoute = () => { if (journalFeedbackRequested()) setFeedbackOpen(true); };
    window.addEventListener("hashchange", openFromRoute);
    return () => window.removeEventListener("hashchange", openFromRoute);
  }, []);

  useEffect(() => {
    if (!closingDay) return;
    const timeout = window.setTimeout(() => setClosingDay(null), reducedMotion ? 2200 : 3800);
    return () => window.clearTimeout(timeout);
  }, [closingDay, reducedMotion]);

  const registerTransitionGuard = useCallback<RegisterJournalTransitionGuard>((guard) => {
    transitionGuardRef.current = guard;
    const unregisterAppGuard = registerAppTransitionGuard?.(guard);
    return () => {
      if (transitionGuardRef.current === guard) transitionGuardRef.current = null;
      unregisterAppGuard?.();
    };
  }, [registerAppTransitionGuard]);

  const requestTransition = useCallback(async (transition: () => void) => {
    const guard = transitionGuardRef.current;
    if (guard) return guard(transition);
    transition();
    return true;
  }, []);

  useEffect(() => {
    if (!journalDay || requestedJournalDayRef.current === journalDay) return;
    const requestedDay = journalDay;
    requestedJournalDayRef.current = requestedDay;
    void requestTransition(() => {
      setSelectedDay(requestedDay);
      setOpen(true);
      setStartZoomed(true);
      const surface = document.querySelector<HTMLElement>(".surface-scroll");
      if (surface) surface.scrollTop = 0;
    }).then((completed) => {
      requestedJournalDayRef.current = null;
      if (completed && useUi.getState().journalDay === requestedDay) clearJournalDay();
    });
  }, [journalDay, clearJournalDay, requestTransition]);

  function openDay(key: string, openFull = false) {
    setSelectedDay(key);
    setStartZoomed(openFull);
    setOpen(true);
    const surface = document.querySelector<HTMLElement>(".surface-scroll");
    if (surface) surface.scrollTop = 0;
  }

  function closeNotebook() {
    setOpen(false);
    setStartZoomed(false);
    const surface = document.querySelector<HTMLElement>(".surface-scroll");
    if (surface) surface.scrollTop = 0;
  }

  function navigate(direction: Exclude<TurnDirection, null>) {
    const next = direction === "previous" ? previousJournalDay(selectedDay) : nextJournalDay(selectedDay);
    if (next > today) return;
    setTurnDirection(direction);
    setStartZoomed(true);
    setSelectedDay(next);
    if (!reducedMotion) window.setTimeout(() => setTurnDirection(null), 440);
  }

  return (
    <div className={`journal-notebook-page${open ? " is-open" : ""}`}>
      <header className="journal-page-header">
        <div>
          <span className="journal-kicker">Journal</span>
          <h1>A page of your own.</h1>
          <p>Write freely. Choose a prompt when it helps. Saved locally first.</p>
        </div>
        <div className="journal-header-actions">
          <GButton size="sm" onClick={() => setFeedbackOpen(true)}>Feedback</GButton>
          <span className="journal-credit-chip" aria-label={`${credits} ${STUDY_CURRENCY_NAME} available`}><span aria-hidden="true">A</span><strong>{credits}</strong><small>{STUDY_CURRENCY_SHORT}</small></span>
          <GButton size="sm" onClick={() => setCustomizing(true)}><Palette size={ICON_SIZE.body} /> Personalize</GButton>
          {open && <GButton size="sm" onClick={() => { void requestTransition(closeNotebook); }}><BookOpen size={ICON_SIZE.body} /> Library</GButton>}
        </div>
      </header>

      {!open ? (
        <NotebookLibrary
          preferences={preferences}
          entries={entries}
          missed={missed}
          today={today}
          sceneWeather={sceneWeather}
          weatherPaused={weatherPaused}
          onNextWeather={() => setSceneWeather(nextDeskWeather)}
          onToggleWeather={() => setWeatherPaused((current) => !current)}
          onOpenDay={openDay}
        />
      ) : (
        <JournalWritingPage
          key={selectedDay}
          day={selectedDay}
          today={today}
          preferences={preferences}
          sceneWeather={sceneWeather}
          weatherPaused={weatherPaused}
          onNextWeather={() => setSceneWeather(nextDeskWeather)}
          onToggleWeather={() => setWeatherPaused((current) => !current)}
          direction={turnDirection}
          startZoomed={startZoomed}
          onNavigate={navigate}
          onClose={closeNotebook}
          onCompleted={(key) => {
            setOpen(false);
            setStartZoomed(false);
            setClosingDay(key);
          }}
          registerTransitionGuard={registerTransitionGuard}
        />
      )}

      {closingDay && (
        <div className="journal-closeout" role="status" aria-live="polite">
          <span className="journal-closeout-volume" aria-hidden="true"><span className="journal-closeout-paper" /><span className={`journal-closeout-cover cover-${preferences.coverTone}`}><span>A</span></span><span className="journal-closeout-ribbon" /></span>
          <span className="journal-closeout-copy"><time dateTime={closingDay}>{prettyDate(`${closingDay}T12:00:00`)}</time><strong>{closingDay === today ? "Day kept." : "Page kept."}</strong><small>The page will be here when you return.</small></span>
        </div>
      )}

      {customizing && (
        <NotebookCustomization
          initial={preferences}
          onClose={() => setCustomizing(false)}
          onSave={(journalNotebook) => {
            const patch = { journalNotebook } as Partial<Profile> & { journalNotebook: JournalNotebookPreferences };
            useStore.getState().updateProfile(patch);
            setCustomizing(false);
          }}
        />
      )}

      {welcomeOpen && !feedbackOpen && (
        <JournalWelcome initial={preferences} initialReminders={normalizeDailyLoopReminderPreferences(s.profile.dailyLoopReminders)} onComplete={(journalNotebook, dailyLoopReminders) => {
          useStore.getState().updateProfile({ journalNotebook: { ...journalNotebook, setupCompleted: true }, dailyLoopReminders } as Partial<Profile>);
          setWelcomeOpen(false);
        }} />
      )}

      {feedbackOpen && (
        <JournalFeedback onClose={() => {
          setFeedbackOpen(false);
          clearJournalFeedbackRequest();
        }} />
      )}
    </div>
  );
}

function NotebookLibrary({
  preferences, entries, missed, today, sceneWeather, weatherPaused, onNextWeather, onToggleWeather, onOpenDay,
}: {
  preferences: JournalNotebookPreferences;
  entries: JournalEntry[];
  missed: string[];
  today: string;
  sceneWeather: JournalNotebookPreferences["weather"];
  weatherPaused: boolean;
  onNextWeather: () => void;
  onToggleWeather: () => void;
  onOpenDay: (key: string, remediation?: boolean) => void;
}) {
  const s = useStore();
  const againUnlocked = useUnlocked("again");
  const [ipadOn, setIpadOn] = useState(false);
  const [wallpaper, setWallpaper] = useState(0);
  const [offCycles, setOffCycles] = useState(0);
  const [unlockedNow, setUnlockedNow] = useState(false);
  const [audioError, setAudioError] = useState("");
  const [screenTime, setScreenTime] = useState("");

  function toggleIpad() {
    if (!ipadOn) {
      setIpadOn(true);
      setWallpaper((current) => (current + 1) % 3);
      setScreenTime(new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date()));
      return;
    }
    setIpadOn(false);
    const cycles = offCycles + 1;
    if (cycles < 3) {
      setOffCycles(cycles);
      return;
    }
    setOffCycles(0);
    if (!unlock("again")) return;
    setUnlockedNow(true);
    void useSoundscape.getState().play("again", { version: "original" }).then(() => {
      setAudioError(useSoundscape.getState().error ?? "");
    });
  }

  return (
    <div className="journal-library-grid">
      <section
        className={`journal-library-hero journal-desk desk-${preferences.deskTone} weather-${sceneWeather} laptop-${preferences.laptopTone} laptop-${preferences.laptopPosition} headphones-${preferences.headphones} drink-${preferences.drink} accent-${preferences.deskAccent ?? "none"}`}
        aria-labelledby="journal-library-title"
      >
        {deskWeatherSequence.map((weather) => <span key={weather} className={`journal-weather-wash wash-${weather}`} aria-hidden="true" />)}
        <span className="journal-desk-window" aria-hidden="true" />
        <JournalWeatherControls weather={sceneWeather} automatic={preferences.weatherCycle !== false} paused={weatherPaused} onNext={onNextWeather} onToggle={onToggleWeather} />
        <svg className="journal-desk-headphone-cable" viewBox="0 0 1000 620" preserveAspectRatio="none" aria-hidden="true">
          <path className="journal-desk-cable-desktop" d="M 112 348 C 50 392 40 355 61 311 C 71 289 83 277 97 267" />
          <path className="journal-desk-cable-mobile" d="M 98 355 C 34 362 2 297 18 205" />
        </svg>
        <JournalDeskLaptop today={today} />
        <span className="journal-desk-headphones" aria-hidden="true" />
        <span className="journal-desk-plant" aria-hidden="true"><span /><span /><span /><span /><span /><i /></span>
        <span className="journal-desk-drink" aria-hidden="true"><span /></span>
        <span className="journal-desk-lamp" aria-hidden="true" />
        <span className="journal-desk-ipad-stand" aria-hidden="true" />
        <button
          type="button"
          className={`journal-desk-ipad wallpaper-${wallpaper}${ipadOn ? " is-on" : ""}`}
          onClick={toggleIpad}
          aria-label={`Turn ${ipadOn ? "off" : "on"} desk iPad`}
          aria-pressed={ipadOn}
        >
          <span className="journal-desk-ipad-screen"><time>{screenTime}</time><span className="journal-desk-ipad-home" /></span>
        </button>
        <button
          type="button"
          className={`journal-hardback cover-${preferences.coverTone}`}
          onClick={() => onOpenDay(today)}
          aria-label={`Open ${preferences.title} to today’s page`}
        >
          <span className="journal-cover-spine" aria-hidden="true" />
          <span className="journal-cover-mark" aria-hidden="true">A</span>
          <span className="journal-cover-copy">
            <strong id="journal-library-title">{preferences.title}</strong>
            <span>{preferences.subtitle}</span>
          </span>
          <span className="journal-cover-edge" aria-hidden="true" />
        </button>
        <div className="journal-library-primary">
          <GButton variant="primary" onClick={() => onOpenDay(today)}>
            <BookOpen size={ICON_SIZE.emphasis} /> Open today’s page
          </GButton>
          <span>{entries.length ? `${entries.length} saved page${entries.length === 1 ? "" : "s"}` : "Your first page is ready"}</span>
        </div>
        {(unlockedNow || againUnlocked) && <p className="journal-desk-unlocked" role="status">{unlockedNow ? "Again unlocked. It is now in Your sounds." : "Again is in Your sounds."}</p>}
        {audioError && <p className="journal-desk-audio-error" role="alert">Again unlocked, but audio could not start: {audioError}</p>}
      </section>

      <aside className="journal-library-shelf" aria-label="Journal pages">
        <PanelHeader title="Recent pages" sub="Saved locally first in your AXOM workspace" />
        {entries.length === 0 ? (
          <div className="journal-calm-empty">
            <BookOpen size={ICON_SIZE.display} />
            <b>No pages yet</b>
            <span>Open today’s page. AXOM saves as you write.</span>
          </div>
        ) : (
          <div className="journal-page-list">
            {entries.slice(0, 8).map((rawEntry) => {
              const entry = rawEntry as NotebookJournalEntry;
              const key = entryDayKey(entry);
              const preview = entry.freeWriting?.trim() || entry.today.trim() || entry.tomorrow.trim() || "Image and day notes";
              return (
                <div className="journal-page-list-row" key={entry.id}>
                  <button type="button" onClick={() => onOpenDay(key)}>
                    <span><b>{key === today ? "Today" : prettyDate(`${key}T12:00:00`)}</b><small>{preview}</small></span>
                    <ChevronRight size={ICON_SIZE.emphasis} aria-hidden="true" />
                  </button>
                  <GhostButton
                    className="danger"
                    aria-label={`Delete journal page for ${key}`}
                    onClick={() => {
                      if (window.confirm("Delete this journal page? This cannot be undone.")) s.removeJournal(entry.id);
                    }}
                  ><Trash2 size={ICON_SIZE.body} /></GhostButton>
                </div>
              );
            })}
          </div>
        )}
        {missed.length > 0 && (
          <details className="journal-catchup-disclosure">
            <summary><CalendarClock size={ICON_SIZE.body} /> {missed.length} optional catch-up page{missed.length === 1 ? "" : "s"}</summary>
            <p>These days had local activity but no journal page. Catch-up is optional.</p>
            <div className="journal-catchup-days">
              {missed.map((key) => (
                <button key={key} type="button" onClick={() => onOpenDay(key, true)}>
                  {prettyDate(`${key}T12:00:00`)} <Plus size={ICON_SIZE.body} />
                </button>
              ))}
            </div>
          </details>
        )}
      </aside>
    </div>
  );
}

interface JournalDraft {
  today: string;
  tomorrow: string;
  blockers: string;
  energy: JournalEntry["energy"];
  rating: string;
  freeWriting: string;
  wins: string[];
  losses: string[];
  attachments: JournalImageAttachment[];
  dayAtAGlance: JournalGlancePreferences;
  notebookStatus: "draft" | "complete";
}

function JournalWritingPage({
  day, today, preferences, sceneWeather, weatherPaused, onNextWeather, onToggleWeather, direction, startZoomed, onNavigate, onClose, onCompleted, registerTransitionGuard,
}: {
  day: string;
  today: string;
  preferences: JournalNotebookPreferences;
  sceneWeather: JournalNotebookPreferences["weather"];
  weatherPaused: boolean;
  onNextWeather: () => void;
  onToggleWeather: () => void;
  direction: TurnDirection;
  startZoomed: boolean;
  onNavigate: (direction: Exclude<TurnDirection, null>) => void;
  onClose: () => void;
  onCompleted: (day: string) => void;
  registerTransitionGuard: RegisterJournalTransitionGuard;
}) {
  const s = useStore();
  const entry = s.journal.find((item) => entryDayKey(item) === day) as NotebookJournalEntry | undefined;
  const plan = planForDay(s.dayPlans, day);
  const reducedMotion = useReducedMotion();
  const [zoomed, setZoomed] = useState(startZoomed);
  const [settling, setSettling] = useState(false);
  const [deskClosing, setDeskClosing] = useState(false);
  const [deskTouched, setDeskTouched] = useState(false);
  const [hasInteractedSinceOpen, setHasInteractedSinceOpen] = useState(startZoomed || day !== today);
  const [composing, setComposing] = useState(false);
  const [promptMode, setPromptMode] = useState<"open" | JournalPurpose>(() => {
    const hasEarlierPromptNotes = [entry?.today, entry?.blockers, entry?.tomorrow, ...(entry?.wins ?? []), ...(entry?.losses ?? [])]
      .some((value) => typeof value === "string" && value.trim());
    return preferences.writingMode === "free" && !hasEarlierPromptNotes ? "open" : preferences.purpose ?? "reflect";
  });
  const [promptStep, setPromptStep] = useState(0);
  const [summaryVisible, setSummaryVisible] = useState(false);
  const [draft, setDraftState] = useState<JournalDraft>(() => draftFromEntry(entry, plan));
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">(entry ? "saved" : "idle");
  const [saveError, setSaveError] = useState("");
  const [attachmentError, setAttachmentError] = useState("");
  const [addingImage, setAddingImage] = useState(false);
  const [editingGlance, setEditingGlance] = useState<JournalGlanceSectionKey | null>(null);
  const [supportOpen, setSupportOpen] = useState(false);
  const entryIdRef = useRef(entry?.id ?? "");
  const entryDateRef = useRef(entry?.date ?? `${day}T12:00:00`);
  const draftRef = useRef(draft);
  const dirtyRef = useRef(false);
  const draftVersionRef = useRef(0);
  const mountedRef = useRef(true);
  const transitionPendingRef = useRef(false);
  const lifecyclePersistPendingRef = useRef(false);
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());
  const attachmentReadRef = useRef<Promise<void> | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  const deskCloseTimerRef = useRef<number | null>(null);
  const returnToDeskWritingRef = useRef(false);
  const pageHeadingRef = useRef<HTMLHeadingElement>(null);
  const inlineHeadingRef = useRef<HTMLHeadingElement>(null);
  const inlineWritingRef = useRef<HTMLTextAreaElement>(null);
  const zoomWritingRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const glance = selectDayAtAGlance({
    profile: s.profile,
    activeDayKey: s.activeDayKey,
    dayPlans: s.dayPlans,
    logs: s.logs,
    productivityTrackers: s.productivityTrackers,
    sessions: s.sessions,
    questions: s.questions,
    habits: s.habits,
    habitEntries: s.habitEntries,
    tasks: s.tasks,
    energyFactors: s.energyFactors,
    journal: s.journal,
    closeouts: s.closeouts,
  }, day, today);
  const glanceSections = useMemo(() => [
    ...buildJournalGlanceSections(glance),
    ...buildDayExtraSections({
      day,
      sessions: s.sessions ?? [],
      attempts: (s.questions ?? []).flatMap((question) => question.attempts ?? []),
      listening: readListeningLog(),
      rests: readRestLog(),
      checkIns: focusCheckInLedger.read(day),
    }),
  ], [glance, day, s.sessions, s.questions]);
  // The day's record is always part of the page; hide or correct any line.
  const liveGlanceText = renderJournalGlanceText(glanceSections, draft.dayAtAGlance);
  const liveGlanceRef = useRef(liveGlanceText);
  liveGlanceRef.current = liveGlanceText;
  const supportSignal = journalReflectionNeedsSupport([
    draft.today,
    draft.blockers,
    draft.tomorrow,
    draft.freeWriting,
    ...draft.wins,
    ...draft.losses,
  ]);
  const previousSupportSignalRef = useRef(false);

  const putDownPage = useCallback(() => {
    if (!zoomed) return;
    returnToDeskWritingRef.current = document.activeElement === zoomWritingRef.current;
    const surface = document.querySelector<HTMLElement>(".surface-scroll");
    if (surface) surface.scrollTop = 0;
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
    setZoomed(false);
    if (reducedMotion) {
      setSettling(false);
      return;
    }
    setSettling(true);
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null;
      setSettling(false);
    }, 760);
  }, [zoomed, reducedMotion]);

  function noteActivity() {
    if (zoomed) setHasInteractedSinceOpen(true);
    else setDeskTouched(true);
  }

  function openFullPage() {
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    setSettling(false);
    setHasInteractedSinceOpen(dirtyRef.current || day !== today);
    setZoomed(true);
  }

  useEffect(() => {
    if (zoomed) pageHeadingRef.current?.focus({ preventScroll: true });
    else if (returnToDeskWritingRef.current) inlineWritingRef.current?.focus({ preventScroll: true });
    else inlineHeadingRef.current?.focus({ preventScroll: true });
    returnToDeskWritingRef.current = false;
  }, [zoomed]);

  useEffect(() => {
    if (!zoomed || settling || hasInteractedSinceOpen || supportOpen || addingImage || composing) return;
    const timer = window.setTimeout(putDownPage, 4400);
    return () => window.clearTimeout(timer);
  }, [zoomed, settling, hasInteractedSinceOpen, supportOpen, addingImage, composing, putDownPage]);

  useEffect(() => () => {
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
    if (deskCloseTimerRef.current !== null) window.clearTimeout(deskCloseTimerRef.current);
  }, []);

  useEffect(() => {
    if (!zoomed) return;
    const previousOverflow = document.body.style.overflow;
    const appRoot = document.getElementById("root");
    const previousInert = appRoot?.inert;
    document.body.style.overflow = "hidden";
    if (appRoot) appRoot.inert = true;
    return () => {
      document.body.style.overflow = previousOverflow;
      if (appRoot) appRoot.inert = previousInert ?? false;
    };
  }, [zoomed]);

  useEffect(() => {
    if (supportSignal && !previousSupportSignalRef.current) {
      setSupportOpen(true);
      setHasInteractedSinceOpen(true);
      setZoomed(true);
    }
    previousSupportSignalRef.current = supportSignal;
  }, [supportSignal]);

  const persistNow = useCallback(async (status?: "draft" | "complete"): Promise<JournalPersistResult> => {
    if (!mountedRef.current) return "aborted";
    const current = draftRef.current;
    if (!hasNotebookContent(current) && !entryIdRef.current) return "no-change";
    const draftVersion = draftVersionRef.current;
    const timestamp = new Date().toISOString();
    // Stamp the entry's `date` with the local day key (noon), never a raw UTC
    // toISOString(): day-keyed lookups use `entry.date.slice(0,10)` against the
    // local day key, so a UTC prefix mismatches near midnight (entry appears on
    // the wrong day / not found). `updatedAt` keeps the precise instant.
    const payload: Omit<JournalEntry, "id"> & JournalNotebookEntryFields = {
      date: entryDateRef.current,
      today: current.today.trim(),
      tomorrow: current.tomorrow,
      blockers: current.blockers,
      energy: current.energy,
      rating: current.rating,
      freeWriting: current.freeWriting,
      wins: current.wins.filter((value) => value.trim()),
      losses: current.losses.filter((value) => value.trim()),
      attachments: current.attachments,
      dayAtAGlance: { ...current.dayAtAGlance, includedText: liveGlanceRef.current, includedAt: timestamp },
      notebookStatus: status ?? current.notebookStatus,
      updatedAt: timestamp,
    };
    let id = entryIdRef.current;
    if (!id) {
      id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `journal-${Date.now()}`;
      entryIdRef.current = id;
    }
    const store = useStore.getState();
    const checkpoint = localVault.getVaultWriteCheckpoint();
    if (mountedRef.current) {
      setSaveState("saving");
      setSaveError("");
    }
    try {
      if (store.journal.some((item) => item.id === id)) store.updateJournal(id, payload);
      else store.addJournal({ ...payload, id });
      await localVault.flushLocalVaultWrites();
      localVault.assertVaultWrite(checkpoint + 1);
      localVault.assertVaultWritesSince(checkpoint);
      if (draftVersion === draftVersionRef.current) {
        dirtyRef.current = false;
        if (mountedRef.current) setSaveState("saved");
        return "saved";
      }
      return "superseded";
    } catch (cause) {
      if (draftVersion === draftVersionRef.current) {
        dirtyRef.current = true;
        if (mountedRef.current) {
          setSaveState("failed");
          setSaveError(localVault.isVaultConflictError(cause)
            ? cause.message
            : "Your latest changes are still open, but AXOM could not confirm them in local storage. Export a portable backup, then retry Save.");
        }
        return "failed";
      }
      return "superseded";
    }
  }, []);

  const persist = useCallback((status?: "draft" | "complete") => {
    const queued = persistQueueRef.current.then(
      () => persistNow(status),
      () => persistNow(status),
    );
    persistQueueRef.current = queued.then(() => undefined, () => undefined);
    return queued;
  }, [persistNow]);

  const cancelScheduledSave = useCallback(() => {
    if (saveTimerRef.current === null) return;
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
  }, []);

  const requestDurableTransition = useCallback<JournalTransitionGuard>(async (transition) => {
    if (transitionPendingRef.current) return false;
    transitionPendingRef.current = true;
    cancelScheduledSave();
    try {
      const pendingAttachment = attachmentReadRef.current;
      if (pendingAttachment) await pendingAttachment;
      if (!mountedRef.current) return false;
      if (!dirtyRef.current) {
        transition();
        return true;
      }
      while (mountedRef.current) {
        const result = await persist();
        if (result === "superseded") continue;
        if (result === "failed" || result === "aborted" || !mountedRef.current) return false;
        transition();
        return true;
      }
      return false;
    } finally {
      transitionPendingRef.current = false;
    }
  }, [cancelScheduledSave, persist]);

  const persistBeforePageExit = useCallback(() => {
    if (!dirtyRef.current || lifecyclePersistPendingRef.current) return;
    cancelScheduledSave();
    lifecyclePersistPendingRef.current = true;
    void persistNow().finally(() => {
      lifecyclePersistPendingRef.current = false;
    });
  }, [cancelScheduledSave, persistNow]);

  function setDraft(update: (current: JournalDraft) => JournalDraft) {
    const next = update(draftRef.current);
    setDeskTouched(true);
    draftRef.current = next;
    draftVersionRef.current += 1;
    dirtyRef.current = true;
    setDraftState(next);
    setSaveState("saving");
    setSaveError("");
    cancelScheduledSave();
    if (!transitionPendingRef.current) {
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        void persist();
      }, 420);
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    const unregisterTransitionGuard = registerTransitionGuard(requestDurableTransition);
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current && !attachmentReadRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const persistOnPageHide = () => { persistBeforePageExit(); };
    const persistWhenHidden = () => {
      if (document.visibilityState === "hidden") persistBeforePageExit();
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    window.addEventListener("pagehide", persistOnPageHide);
    document.addEventListener("visibilitychange", persistWhenHidden);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload);
      window.removeEventListener("pagehide", persistOnPageHide);
      document.removeEventListener("visibilitychange", persistWhenHidden);
      cancelScheduledSave();
      mountedRef.current = false;
      unregisterTransitionGuard();
    };
  }, [cancelScheduledSave, persistBeforePageExit, registerTransitionGuard, requestDurableTransition]);

  function turnPage(nextDirection: Exclude<TurnDirection, null>) {
    void requestDurableTransition(() => onNavigate(nextDirection));
  }

  const putBookDown = useCallback(() => {
    if (addingImage || deskClosing) return;
    void requestDurableTransition(() => {
      if (reducedMotion) { onClose(); return; }
      setDeskClosing(true);
      deskCloseTimerRef.current = window.setTimeout(onClose, 900);
    });
  }, [addingImage, deskClosing, requestDurableTransition, reducedMotion, onClose]);

  useEffect(() => {
    if (zoomed || settling || deskClosing || deskTouched || addingImage || composing) return;
    const timer = window.setTimeout(putBookDown, 4400);
    return () => window.clearTimeout(timer);
  }, [zoomed, settling, deskClosing, deskTouched, addingImage, composing, putBookDown]);

  async function completeToday() {
    cancelScheduledSave();
    const current = draftRef.current;
    if (!hasNotebookContent(current) && !entryIdRef.current) {
      setSaveState("idle");
      setSaveError("Write one line before marking this page done. Nothing has been saved yet.");
      return;
    }
    const next = { ...current, notebookStatus: "complete" as const };
    draftRef.current = next;
    draftVersionRef.current += 1;
    dirtyRef.current = true;
    setDraftState(next);
    setSaveState("saving");
    setSaveError("");
    const result = await persist("complete");
    if (result === "saved") onCompleted(day);
  }

  function handleBookKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (zoomed && event.key === "Escape") {
      event.preventDefault();
      putDownPage();
      return;
    }
    if (zoomed && event.key === "Tab") {
      const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]")]
        .filter((element) => element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first && last && event.shiftKey && (document.activeElement === first || document.activeElement === pageHeadingRef.current)) { event.preventDefault(); last.focus(); }
      else if (first && last && !event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      return;
    }
    const target = event.target as HTMLElement;
    if (target.matches("input, textarea, select, button, a, [contenteditable='true']")) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      turnPage("previous");
    }
    if (event.key === "ArrowRight" && day < today) {
      event.preventDefault();
      turnPage("next");
    }
  }

  async function addAttachment(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setAttachmentError("");
    setAddingImage(true);
    const read = (async () => {
      try {
        const attachment = await readJournalImage(file, draftRef.current.attachments);
        setDraft((current) => ({ ...current, attachments: [...current.attachments, attachment] }));
      } catch (error) {
        setAttachmentError(error instanceof Error ? error.message : "AXOM could not add that image.");
      } finally {
        setAddingImage(false);
      }
    })();
    attachmentReadRef.current = read;
    try {
      await read;
    } finally {
      if (attachmentReadRef.current === read) attachmentReadRef.current = null;
    }
  }

  function exportAttachment(attachment: JournalImageAttachment) {
    const result = createJournalAttachmentExport(attachment);
    downloadBlob(result.filename, result.blob);
  }

  function exportPage() {
    const raw: NotebookJournalEntry = {
      id: entryIdRef.current || `journal-export-${day}`,
      date: entryDateRef.current,
      ...draftRef.current,
    };
    const body = buildJournalMarkdown(raw, prettyDate(`${day}T12:00:00`));
    downloadBlob(`axom-journal-${day}.md`, new Blob([body], { type: "text/markdown;charset=utf-8" }));
  }

  const hiddenGlance = new Set(draft.dayAtAGlance.hiddenSections ?? []);
  const hasStructuredDraft = [draft.today, draft.blockers, draft.tomorrow, ...draft.wins, ...draft.losses].some((value) => value.trim());
  const activePromptSet = journalPromptSets[promptMode === "open" ? preferences.purpose ?? "reflect" : promptMode];
  const guidedPrompts = [
    { key: "today", label: activePromptSet.today, value: draft.today },
    { key: "blockers", label: activePromptSet.blockers, value: draft.blockers },
    { key: "tomorrow", label: activePromptSet.tomorrow, value: draft.tomorrow },
  ] as const;
  const guidedPrompt = guidedPrompts[promptStep];
  const dialogProps = zoomed
    ? { role: "dialog" as const, "aria-modal": true, "aria-label": "Full journal" }
    : {};

  const notebook = (
    <section
      className={`journal-book-stage paper-${preferences.paperTone} desk-${preferences.deskTone} weather-${sceneWeather}${zoomed ? " is-zoomed" : ""}${settling ? " is-settling" : ""}${direction ? ` turn-${direction}` : ""}`}
      aria-label="Journal notebook"
      data-motion={reducedMotion ? "reduced" : "full"}
      onKeyDown={handleBookKeyDown}
      onInputCapture={noteActivity}
      onPointerDownCapture={noteActivity}
      onWheelCapture={noteActivity}
      onTouchMoveCapture={noteActivity}
      onFocusCapture={(event) => {
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) noteActivity();
      }}
      onCompositionStartCapture={() => setComposing(true)}
      onCompositionEndCapture={() => { setComposing(false); noteActivity(); }}
      {...dialogProps}
    >
      <section
        className={`journal-inline-scene journal-desk desk-${preferences.deskTone} weather-${sceneWeather} laptop-${preferences.laptopTone} laptop-${preferences.laptopPosition} headphones-${preferences.headphones} drink-${preferences.drink} accent-${preferences.deskAccent ?? "none"}${deskClosing ? " is-closing" : ""}`}
        aria-label="Write at your desk"
        hidden={zoomed}
        onClick={(event) => {
          if (!(event.target instanceof Element) || event.target.closest(".journal-inline-book, button, a, input, textarea, select")) return;
          putBookDown();
        }}
      >
        {deskWeatherSequence.map((weather) => <span key={weather} className={`journal-weather-wash wash-${weather}`} aria-hidden="true" />)}
        <span className="journal-desk-window" aria-hidden="true" />
        <JournalWeatherControls weather={sceneWeather} automatic={preferences.weatherCycle !== false} paused={weatherPaused} onNext={onNextWeather} onToggle={onToggleWeather} />
        <GButton size="sm" className="journal-inline-putdown" onClick={putBookDown}><ArrowDown size={ICON_SIZE.body} /> Put book down</GButton>
        <svg className="journal-desk-headphone-cable" viewBox="0 0 1000 620" preserveAspectRatio="none" aria-hidden="true">
          <path className="journal-desk-cable-desktop" d="M 112 348 C 50 392 40 355 61 311 C 71 289 83 277 97 267" />
          <path className="journal-desk-cable-mobile" d="M 98 355 C 34 362 2 297 18 205" />
        </svg>
        {!zoomed && <JournalDeskLaptop today={today} />}
        <span className="journal-desk-headphones" aria-hidden="true" />
        <span className="journal-desk-plant" aria-hidden="true"><span /><span /><span /><span /><span /><i /></span>
        <span className="journal-desk-drink" aria-hidden="true"><span /></span>
        <span className="journal-desk-lamp" aria-hidden="true" />
        <div className={`journal-inline-book paper-${preferences.paperTone}`}>
          <div className="journal-inline-leaf">
            <span className="journal-inline-overline">{preferences.title} / {prettyDate(`${day}T12:00:00`)}</span>
            <h2 ref={inlineHeadingRef} tabIndex={-1}>Your open page</h2>
            {promptMode !== "open" && <p>{journalPurposePrompts[promptMode]}</p>}
            <label className="journal-inline-writing">
              <span>{promptMode === "open" ? "Write freely at your desk" : "One line to begin"}</span>
              <textarea ref={inlineWritingRef} value={draft.freeWriting} onChange={(event) => setDraft((current) => ({ ...current, freeWriting: event.target.value }))} placeholder={promptMode === "open" ? "Write in your own words." : "One line is enough to begin."} />
            </label>
          </div>
          <div className="journal-inline-leaf journal-inline-leaf-right">
            <span className="journal-inline-overline">Private / local first</span>
            <span className="journal-inline-quote">A record you can return to.</span>
            <p>{saveState === "saving" ? "Saving…" : saveState === "saved" ? "Page saved locally" : saveState === "failed" ? "Your changes need saving" : "Ready when you are"}</p>
            {saveError && <p className="journal-inline-save-error" role="alert">{saveError}</p>}
            {saveState === "failed" && (
              <GButton size="sm" disabled={addingImage} onClick={() => { void persist(); }}>
                <Save size={ICON_SIZE.body} /> Retry save
              </GButton>
            )}
            <GButton variant="primary" onClick={openFullPage}><BookOpen size={ICON_SIZE.body} /> Write full page</GButton>
          </div>
        </div>
      </section>

      {zoomed && <div className="journal-zoom-return">
        <GButton size="sm" onClick={putDownPage}><ArrowLeft size={ICON_SIZE.body} /> Put down on desk</GButton>
        <span>{preferences.title} <i>/</i> {prettyDate(`${day}T12:00:00`)}</span>
        <GButton size="sm" aria-expanded={summaryVisible} aria-controls="journal-glance-page" onClick={() => setSummaryVisible((current) => !current)}>{summaryVisible ? "Hide day summary" : "Show day summary"}</GButton>
      </div>}
      <div className="journal-expanded-pages" hidden={!zoomed}>
      <div className="journal-book-toolbar">
        <GButton size="sm" onClick={() => turnPage("previous")} aria-label="Previous journal page">
          <ArrowLeft size={ICON_SIZE.body} /> Previous
        </GButton>
        <div className="journal-page-position" aria-live="polite">
          <b>{day === today ? "Today" : prettyDate(`${day}T12:00:00`)}</b>
          <span>{saveState === "saving" ? "Saving to this workspace…" : saveState === "saved" ? "Saved to this workspace" : saveState === "failed" ? "Not saved on this device" : "Ready to write"}</span>
        </div>
        <GButton size="sm" onClick={() => turnPage("next")} disabled={day >= today} aria-label="Next journal page">
          Next <ArrowRight size={ICON_SIZE.body} />
        </GButton>
      </div>

      {saveError && <div className="journal-save-error" role="alert">{saveError}</div>}

      <div className="journal-focus-layout">
        <aside className={`journal-focus-rail${supportOpen ? " has-support" : ""}`} aria-label="Desk margin">
          <div className={`journal-focus-desk journal-desk desk-${preferences.deskTone} weather-${sceneWeather} laptop-${preferences.laptopTone} laptop-${preferences.laptopPosition} drink-${preferences.drink}`}>
            {deskWeatherSequence.map((weather) => <span key={weather} className={`journal-weather-wash wash-${weather}`} aria-hidden="true" />)}
            <div className="journal-focus-desk-objects">
              <JournalDeskLaptop today={today} />
              <span className="journal-desk-drink" aria-hidden="true"><span /></span>
            </div>
            <JournalWeatherControls weather={sceneWeather} automatic={preferences.weatherCycle !== false} paused={weatherPaused} onNext={onNextWeather} onToggle={onToggleWeather} />
          </div>
          <div className="journal-support-access">
            <GhostButton aria-expanded={supportOpen} aria-controls="journal-support-preview" onClick={() => setSupportOpen((current) => !current)}>
              <HeartHandshake size={ICON_SIZE.body} /> Support
            </GhostButton>
          </div>

          {supportOpen && (
            <JournalSupportPreview
              noticedReflection={supportSignal}
              onClose={() => setSupportOpen(false)}
              onLeave={() => { void requestDurableTransition(onClose); }}
            />
          )}
        </aside>

      <div className={`journal-open-book${zoomed && !summaryVisible ? " is-writing-only" : ""}`}>
        <article className="journal-paper journal-writing-paper">
          <div className="journal-paper-running-head">
            <span>{preferences.title}</span><time dateTime={day}>{prettyDate(`${day}T12:00:00`)}</time>
          </div>
          <h2 ref={pageHeadingRef} tabIndex={-1}>{day === today ? "Today’s page" : day === previousJournalDay(today) ? "Yesterday’s page" : "A page from before"}</h2>
          {day !== today && <p className="journal-day-context">A day can be written after it ends.</p>}
          {promptMode !== "open" && <p className="journal-page-lede">{journalPurposePrompts[promptMode]}</p>}

          <label className="journal-writing-field journal-free-writing">
            <span>Free writing</span>
            <textarea ref={zoomWritingRef} value={draft.freeWriting} onChange={(event) => setDraft((current) => ({ ...current, freeWriting: event.target.value }))}
              placeholder="Begin anywhere." />
          </label>

          <details className="journal-writing-tools">
            <summary>{promptMode === "open" ? "Need a starting point?" : `Writing lens: ${promptMode === "focus" ? "Focus" : promptMode === "reflect" ? "Reflect" : "Regroup"}`}</summary>
            <div className="journal-writing-lens" role="group" aria-label="Writing lens">
              {(["open", "focus", "reflect", "recover"] as const).map((mode) => (
                <button key={mode} type="button" aria-pressed={promptMode === mode} onClick={() => setPromptMode(mode)}>
                  {mode === "open" ? "Open page" : mode === "focus" ? "Focus" : mode === "reflect" ? "Reflect" : "Regroup"}
                </button>
              ))}
            </div>
          </details>

          {promptMode !== "open" ? (
            <section className="journal-prompt-fields" aria-label={`${promptMode} prompts`}>
              <div className="journal-guided-heading"><span>A way in, if you need one</span><span>{String(promptStep + 1).padStart(2, "0")} / 03</span></div>
              <label className="journal-writing-field compact journal-guided-field" key={guidedPrompt.key}>
                <span>{guidedPrompt.label}</span>
                <textarea value={guidedPrompt.value} onChange={(event) => setDraft((current) => ({ ...current, [guidedPrompt.key]: event.target.value }))} placeholder="You can leave this blank." />
              </label>
              <nav className="journal-guided-steps" aria-label="Optional writing prompts">
                {guidedPrompts.map((item, index) => (
                  <button key={item.key} type="button" aria-label={`Prompt ${index + 1}`} aria-current={promptStep === index ? "step" : undefined} onClick={() => setPromptStep(index)}>{index + 1}</button>
                ))}
                <button className="journal-guided-next" type="button" onClick={() => setPromptStep((step) => (step + 1) % guidedPrompts.length)}>Next thought <ArrowRight size={ICON_SIZE.body} /></button>
              </nav>
              <details className="journal-keep-release">
                <summary>Keep something. Release something.</summary>
                <div className="journal-win-loss-grid">
                  <label><span>Something to keep</span><input value={draft.wins[0] ?? ""} onChange={(event) => setDraft((current) => ({ ...current, wins: [event.target.value] }))} /></label>
                  <label><span>A loose thread</span><input value={draft.losses[0] ?? ""} onChange={(event) => setDraft((current) => ({ ...current, losses: [event.target.value] }))} /></label>
                </div>
              </details>
            </section>
          ) : hasStructuredDraft ? (
            <details className="journal-earlier-notes">
              <summary>Earlier prompt notes are still here</summary>
              <p>{[draft.today, draft.blockers, draft.tomorrow, ...draft.wins, ...draft.losses].filter((value) => value.trim()).join(" · ")}</p>
              <GButton size="sm" onClick={() => setPromptMode(preferences.purpose ?? "reflect")}>Edit prompt notes</GButton>
            </details>
          ) : null}

          {plan && <details className="journal-intention-details"><summary>Earlier intention</summary><PreviousIntention plan={plan} /></details>}

          <section className="journal-attachments" aria-labelledby="journal-attachments-title">
            <div className="journal-section-head">
              <div><h3 id="journal-attachments-title">Images</h3><span>Optional · saved with this workspace</span></div>
              <GButton size="sm" onClick={() => fileInputRef.current?.click()} disabled={addingImage}>
                <ImagePlus size={ICON_SIZE.body} /> {addingImage ? "Adding…" : "Add image"}
              </GButton>
              <input ref={fileInputRef} className="journal-file-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={addAttachment} aria-label="Choose a journal image" />
            </div>
            <details className="journal-image-storage"><summary>How images are stored</summary><p className="journal-local-note">Images are saved locally first and included in portable exports. Linked account backups may include them when the workspace fits account limits. Maximum 3 MB each and 12 MB per page.</p></details>
            <JournalAccountProtectionWarning />
            {attachmentError && <div className="journal-attachment-error" role="alert">{attachmentError}</div>}
            {draft.attachments.length > 0 && (
              <div className="journal-attachment-grid">
                {draft.attachments.map((attachment) => (
                  <figure key={attachment.id}>
                    <img src={attachment.dataUrl} alt={attachment.altText || attachment.name} />
                    <figcaption>
                      <span><b>{attachment.name}</b><small>{formatBytes(attachment.size)}</small></span>
                      <span className="journal-attachment-actions">
                        <GhostButton aria-label={`Export ${attachment.name}`} onClick={() => exportAttachment(attachment)}><Download size={ICON_SIZE.body} /></GhostButton>
                        <GhostButton className="danger" aria-label={`Remove ${attachment.name}`} onClick={() => setDraft((current) => ({
                          ...current,
                          attachments: withoutJournalAttachment(current.attachments, attachment.id),
                        }))}><Trash2 size={ICON_SIZE.body} /></GhostButton>
                      </span>
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
          </section>

          <div className="journal-page-footer-actions">
            <label className="journal-energy-field">
              <span>Energy</span>
              <select aria-label="Energy" value={draft.energy} onChange={(event) => setDraft((current) => ({
                ...current,
                energy: event.target.value as JournalEntry["energy"],
              }))}>
                <option value="">Not set</option><option>Low</option><option>Medium</option><option>High</option>
              </select>
            </label>
            <GButton size="sm" onClick={exportPage}><Download size={ICON_SIZE.body} /> Export page</GButton>
            <GButton size="sm" disabled={addingImage} onClick={() => { void persist(); }}><Save size={ICON_SIZE.body} /> Save</GButton>
            <GButton variant="primary" size="sm" disabled={addingImage} onClick={() => { void completeToday(); }}><CheckCircle2 size={ICON_SIZE.body} /> {day === today ? "Done for today" : "Keep this page"}</GButton>
          </div>
        </article>

        <aside id="journal-glance-page" className="journal-paper journal-glance-paper" aria-labelledby="journal-glance-title" hidden={zoomed && !summaryVisible}>
          <div className="journal-paper-running-head"><span>Workspace summary</span><span>Optional</span></div>
          <div className="journal-glance-heading"><h2 id="journal-glance-title">Day at a glance</h2><button type="button" onClick={() => setSummaryVisible(false)} aria-label="Close day summary"><X size={ICON_SIZE.body} /></button></div>
          <p>What AXOM can see from this day. Keep, correct, or leave any line out.</p>
          <div className="journal-glance-list">
            {glanceSections.map((item) => {
              const hidden = hiddenGlance.has(item.key);
              const correction = draft.dayAtAGlance.corrections?.[item.key] ?? "";
              return (
                <section key={item.key} className={`journal-glance-row${hidden ? " is-hidden" : ""}`}>
                  <div className="journal-glance-row-head">
                    <span><i className={item.hasEvidence ? "has-evidence" : ""} aria-hidden="true" /><b>{item.label}</b></span>
                    <div>
                      <GhostButton aria-label={`Correct ${item.label}`} aria-expanded={editingGlance === item.key}
                        onClick={() => setEditingGlance((current) => current === item.key ? null : item.key)}><Pencil size={ICON_SIZE.body} /></GhostButton>
                      <GhostButton aria-label={`${hidden ? "Show" : "Hide"} ${item.label}`} onClick={() => setDraft((current) => {
                        const hiddenSections = new Set(current.dayAtAGlance.hiddenSections ?? []);
                        if (hidden) hiddenSections.delete(item.key); else hiddenSections.add(item.key);
                        return { ...current, dayAtAGlance: { ...current.dayAtAGlance, hiddenSections: [...hiddenSections] } };
                      })}>{hidden ? <Plus size={ICON_SIZE.body} /> : <X size={ICON_SIZE.body} />}</GhostButton>
                    </div>
                  </div>
                  <p>{correction.trim() || item.value}</p>
                  {editingGlance === item.key && (
                    <label><span className="sr-only">Correct {item.label}</span><input autoFocus value={correction}
                      placeholder="Use your own value, or leave blank"
                      onChange={(event) => setDraft((current) => ({
                        ...current,
                        dayAtAGlance: {
                          ...current.dayAtAGlance,
                          corrections: { ...current.dayAtAGlance.corrections, [item.key]: event.target.value },
                        },
                      }))} /></label>
                  )}
                </section>
              );
            })}
          </div>
          <span className="journal-glance-footnote">Every visible line is included in your page automatically and saved with it. Hide a line to leave it out; corrections change only this page, never your records.</span>
        </aside>
      </div>
      </div>
      </div>
    </section>
  );
  return zoomed ? createPortal(notebook, document.body) : notebook;
}

function JournalSupportPreview({
  noticedReflection, onClose, onLeave,
}: {
  noticedReflection: boolean;
  onClose: () => void;
  onLeave: () => void;
}) {
  return (
    <section
      id="journal-support-preview"
      className="journal-support-preview"
      aria-labelledby="journal-support-title"
      aria-live={noticedReflection ? "polite" : "off"}
    >
      <div className="journal-support-copy">
        <span className="journal-support-mark" aria-hidden="true"><HeartHandshake size={ICON_SIZE.emphasis} /></span>
        <div>
          <span className="journal-kicker">Support options</span>
          <h2 id="journal-support-title">You do not have to carry this alone.</h2>
          <p>
            {noticedReflection
              ? "AXOM noticed first-person wording that may be about your safety. This check is not a diagnosis and does not send a support alert."
              : "Use these options whenever you want support. This check runs in your browser and does not send a support alert."}
          </p>
          <p className="journal-support-urgent">
            If you may act now, call your local emergency number or go to the nearest emergency department. If you can, stay with someone you trust and move away from anything you could use to hurt yourself.
          </p>
        </div>
      </div>
      <div className="journal-support-actions">
        <a href="https://findahelpline.com/" target="_blank" rel="noreferrer">Find support near me</a>
        <a href="https://988lifeline.org/get-help/" target="_blank" rel="noreferrer">988 in the U.S. and territories</a>
        <GButton size="sm" onClick={onClose}>Keep writing</GButton>
        <GhostButton onClick={onLeave}>Leave journal</GhostButton>
      </div>
    </section>
  );
}

function JournalAccountProtectionWarning() {
  const blockedBySize = useAccount((state) => (
    state.link === "linked"
    && state.protection === "blocked"
    && state.syncFailure?.rejection === "too-large"
  ));
  if (!blockedBySize) return null;
  return (
    <div className="journal-account-warning" role="alert">
      <div>
        <b>Account protection blocked</b>
        <span>The prepared workspace exceeds the 14 MB account limit. Your locally confirmed Journal copy remains on this device, but this version is not protected in your account. Remove large images or export a portable backup, then retry in Account.</span>
      </div>
      <span className="journal-account-warning-actions">
        <GButton size="sm" onClick={() => useUi.getState().requestSettings("backup")}>Emergency recovery</GButton>
        <GButton size="sm" onClick={() => useUi.getState().requestSettings("account")}>Open Account</GButton>
      </span>
    </div>
  );
}

function JournalWelcome({ initial, initialReminders, onComplete }: {
  initial: JournalNotebookPreferences;
  initialReminders: DailyLoopReminderPreferences;
  onComplete: (preferences: JournalNotebookPreferences, reminders: DailyLoopReminderPreferences) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [closeoutEnabled, setCloseoutEnabled] = useState(initialReminders.closeoutEnabled ?? true);
  const [closeoutTime, setCloseoutTime] = useState(initialReminders.closeoutTime ?? "20:30");
  return (
    <Modal title="Make this notebook yours" onClose={() => onComplete(initial, initialReminders)} className="journal-welcome-modal" footer={<>
      <GButton onClick={() => onComplete(initial, initialReminders)}>Skip for now</GButton>
      <GButton variant="primary" onClick={() => onComplete(draft, { ...initialReminders, closeoutEnabled, closeoutTime })}>Begin at my desk</GButton>
    </>}>
      <p className="sub">A few choices make this feel like your place. Change them later in Personalize. Your writing stays private in your workspace.</p>
      <Field label="What should we call your notebook?" value={draft.title} maxLength={80} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
      <fieldset className="journal-choice-fieldset">
        <legend>Why do you come to the journal?</legend>
        <div className="journal-choice-grid three">
          {(["focus", "reflect", "recover"] as const).map((purpose) => (
            <button key={purpose} type="button" aria-pressed={draft.purpose === purpose} onClick={() => setDraft({ ...draft, purpose })}>
              <b>{purpose === "focus" ? "Find focus" : purpose === "reflect" ? "Reflect" : "Regroup"}</b>
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="journal-choice-fieldset">
        <legend>How do you like to start writing?</legend>
        <div className="journal-choice-grid">
          <button type="button" aria-pressed={draft.writingMode !== "free"} onClick={() => setDraft({ ...draft, writingMode: "guided" })}>
            <b>A few prompts</b><span>Begin with what happened and what comes next.</span>
          </button>
          <button type="button" aria-pressed={draft.writingMode === "free"} onClick={() => setDraft({ ...draft, writingMode: "free" })}>
            <b>Open page</b><span>Start in your own words, then zoom in if you want structure.</span>
          </button>
        </div>
      </fieldset>
      <fieldset className="journal-choice-fieldset">
        <legend>What light helps you settle?</legend>
        <div className="journal-choice-grid three">
          {(["sun", "rain", "night"] as const).map((weather) => (
            <button key={weather} type="button" aria-pressed={draft.weather === weather} onClick={() => setDraft({ ...draft, weather })}>
              <b>{weather === "sun" ? "Late sun" : weather === "rain" ? "Rain" : "Night"}</b>
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="journal-choice-fieldset">
        <legend>Before the day closes</legend>
        <div className="journal-choice-grid">
          <button type="button" aria-pressed={closeoutEnabled} onClick={() => setCloseoutEnabled(true)}><b>Offer a quiet wrap-up</b><span>Once in the evening, only if your page is still open.</span></button>
          <button type="button" aria-pressed={!closeoutEnabled} onClick={() => setCloseoutEnabled(false)}><b>I’ll open it myself</b><span>Your pages stay available whenever you want them.</span></button>
        </div>
        {closeoutEnabled && <label className="journal-setup-time"><span>Offer it around</span><input name="journal-closeout-time" type="time" value={closeoutTime} onChange={(event) => setCloseoutTime(event.target.value)} /></label>}
      </fieldset>
    </Modal>
  );
}

const JOURNAL_FEEDBACK_EMPTY: JournalExperienceFeedbackInput = {
  rating: 0, liked: "", wantMore: "", missing: "", painPoints: "", comment: "",
};

interface StoredJournalFeedbackDraft {
  draft: JournalExperienceFeedbackInput;
  revision: string | null;
  raw: string | null;
  unreadable: boolean;
}

// A receipt must never remove a shared localStorage key: another tab can write
// between a getItem check and removeItem. The marker identifies exactly
// the acknowledged revision without copying feedback text to a second key.
function journalFeedbackFingerprint(draft: JournalExperienceFeedbackInput | string): string {
  const value = JSON.stringify(draft);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${value.length}:${(first >>> 0).toString(16)}:${(second >>> 0).toString(16)}`;
}

// A component-local ref cannot prevent a second submission after its modal
// unmounts. Keep only owner-scoped fingerprints and promise/receipt metadata in
// memory for this tab, never the written feedback or notebook contents.
// This does not provide server-side exactly-once delivery after reload or an
// ambiguous network error; a backend idempotency key is a separate release gate.
interface JournalFeedbackTabSubmission {
  fingerprint: string;
  pending: Promise<string> | null;
  receipt: string | null;
}
const journalFeedbackTabSubmissions = new Map<string, JournalFeedbackTabSubmission>();

function submitJournalFeedbackOncePerTab(
  draftKey: string, accountId: string, draft: JournalExperienceFeedbackInput,
): Promise<string> {
  const fingerprint = journalFeedbackFingerprint(draft);
  const prior = journalFeedbackTabSubmissions.get(draftKey);
  if (prior?.fingerprint === fingerprint) {
    // Reopened dialog, same saved text: join the original pending request or
    // reuse its receipt rather than inserting a duplicate feedback row.
    return prior.pending ?? Promise.resolve(prior.receipt!);
  }
  if (prior?.pending) {
    return Promise.reject(new Error("Feedback is already being sent in this tab. Try again after it finishes."));
  }

  const pending = submitJournalFeedback(accountId, draft);
  const entry: JournalFeedbackTabSubmission = { fingerprint, pending, receipt: null };
  journalFeedbackTabSubmissions.set(draftKey, entry);
  // Do not retain the Promise, which closes over submitted text, after it settles.
  void pending.then((receipt) => {
    if (journalFeedbackTabSubmissions.get(draftKey) === entry) {
      entry.receipt = receipt;
      entry.pending = null;
    }
  }, () => {
    // Failed requests may be retried explicitly. A lost success response is
    // still ambiguous without server idempotency and remains REVIEW_REQUIRED.
    if (journalFeedbackTabSubmissions.get(draftKey) === entry)
      journalFeedbackTabSubmissions.delete(draftKey);
  });
  return pending;
}

function journalFeedbackRevision(): string {
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readJournalFeedbackDraft(key: string): StoredJournalFeedbackDraft {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key);
    if (raw === null) return { draft: JOURNAL_FEEDBACK_EMPTY, revision: null, raw, unreadable: false };
    // A malformed stored draft is not a blank draft. Never overwrite its
    // original bytes during a recovery attempt.
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value))
      return { draft: JOURNAL_FEEDBACK_EMPTY, revision: null, raw, unreadable: true };
    const record = value as Record<string, unknown>;
    // Preserve any unsupported or future-version draft verbatim rather than
    // converting its unknown/private fields into an editable lossy snapshot.
    const textLimits: Record<string, number> = { liked: 1000, wantMore: 1000, missing: 1000, painPoints: 1000, comment: 2000 };
    const allowedFields = ["rating", ...Object.keys(textLimits), "__axomRevision"];
    const invalidRating = "rating" in record
      && (!Number.isInteger(record.rating) || Number(record.rating) < 0 || Number(record.rating) > 5);
    const invalidRevision = "__axomRevision" in record
      && (typeof record.__axomRevision !== "string" || !/^[a-f0-9]{32}$/.test(record.__axomRevision));
    const invalidText = Object.entries(textLimits).some(([field, max]) =>
      field in record && (typeof record[field] !== "string" || (record[field] as string).length > max));
    if (Object.keys(record).some((field) => !allowedFields.includes(field))
      || invalidRating || invalidRevision || invalidText)
      return { draft: JOURNAL_FEEDBACK_EMPTY, revision: null, raw, unreadable: true };
    const draft: JournalExperienceFeedbackInput = {
      rating: Number.isInteger(record.rating) && Number(record.rating) >= 1 && Number(record.rating) <= 5 ? Number(record.rating) : 0,
      liked: typeof record.liked === "string" ? record.liked.slice(0, 1000) : "",
      wantMore: typeof record.wantMore === "string" ? record.wantMore.slice(0, 1000) : "",
      missing: typeof record.missing === "string" ? record.missing.slice(0, 1000) : "",
      painPoints: typeof record.painPoints === "string" ? record.painPoints.slice(0, 1000) : "",
      comment: typeof record.comment === "string" ? record.comment.slice(0, 2000) : "",
    };
    const revision = typeof record.__axomRevision === "string" && /^[a-f0-9]{32}$/.test(record.__axomRevision)
      ? record.__axomRevision : null;
    // Legacy drafts have no revision. A receipt for their exact raw bytes
    // prevents a second explicit send without rewriting or deleting the draft.
    // Another tab changing those bytes must make its new text visible.
    const acknowledged = revision
      ? `${revision}:${journalFeedbackFingerprint(draft)}`
      : `legacy:${journalFeedbackFingerprint(raw)}`;
    if (window.localStorage.getItem(`${key}:submitted`) === acknowledged) {
      return { draft: JOURNAL_FEEDBACK_EMPTY, revision: null, raw, unreadable: false };
    }
    return { draft, revision, raw, unreadable: false };
  } catch {
    // JSON corruption or a blocked localStorage read must fail closed.
    return { draft: JOURNAL_FEEDBACK_EMPTY, revision: null, raw, unreadable: true };
  }
}

function JournalFeedback({ onClose }: { onClose: () => void }) {
  // The dialog can stay mounted across workspace or account switches. Remount
  // its draft state for each owner so one user's text is never written under
  // another owner's localStorage key. Do not migrate legacy authenticated
  // drafts automatically because the old keys did not identify an account.
  const workspaceId = useStore((state) => state.profile.userId);
  const accountId = useAccount((state) => state.user?.id);
  const ownerKey = accountId ? `${workspaceId}:account:${accountId}` : workspaceId;
  return <JournalFeedbackForOwner key={ownerKey} draftKey={`axom-journal-feedback-draft:${ownerKey}`} onClose={onClose} />;
}

function JournalFeedbackForOwner({ onClose, draftKey }: { onClose: () => void; draftKey: string }) {
  const user = useAccount((state) => state.user);
  const [loaded] = useState(() => readJournalFeedbackDraft(draftKey));
  const [draft, setDraft] = useState(loaded.draft);
  const persistedRevisionRef = useRef(loaded.revision);
  const persistedRawRef = useRef(loaded.raw);
  const persistedDraftRef = useRef(loaded.draft);
  const [conflicted, setConflicted] = useState(loaded.unreadable);
  // Opening or remounting the dialog must never write a stale snapshot back
  // over a newer draft another tab saved between our read and first effect.
  const initialDraftRef = useRef(draft);
  const [sending, setSending] = useState(false);
  // State-based disabling renders later; guard against a second same-turn activation.
  const submissionPendingRef = useRef(false);
  const [sentId, setSentId] = useState("");
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState(loaded.unreadable
    ? loaded.raw === null
      ? "AXOM could not read saved feedback in this browser. No draft was replaced. Close feedback and try again."
      : "AXOM could not read this saved feedback draft. Its original data is still here. Download the saved copy before editing."
    : "");
  const submittedReceiptRef = useRef<string | null>(null);
  const [saveRetryToken, setSaveRetryToken] = useState(0);

  useEffect(() => {
    // Persist only this editor's actual changes; a mount is not an edit.
    // The identity guard also survives React StrictMode effect replays.
    if (!sentId && draft === initialDraftRef.current) return;
    if (conflicted) return;
    try {
      if (sentId) {
        // An acknowledgement cannot erase another tab's newer or concurrent edit.
        if (!submittedReceiptRef.current) {
          // An explicit network receipt does not mean the latest text was
          // retained locally. Keep the in-memory copy exportable until close.
          setStorageError("Feedback was received, but your latest answers were not saved in this browser. Download submitted copy before closing.");
          return;
        }
        window.localStorage.setItem(`${draftKey}:submitted`, submittedReceiptRef.current);
      } else {
        // Do not overwrite a newer draft loaded by another tab since this
        // editor opened. Keep these in-memory edits available for export.
        // localStorage has no atomic compare-and-set: simultaneous writes
        // still need a separate concurrency policy and browser acceptance.
        if (window.localStorage.getItem(draftKey) !== persistedRawRef.current) {
          setConflicted(true);
          setStorageError("Another tab changed this feedback draft. Your writing is still here. Download it, then close and reopen feedback to see the saved copy.");
          return;
        }
        const revision = journalFeedbackRevision();
        const serialized = JSON.stringify({ ...draft, __axomRevision: revision });
        window.localStorage.setItem(draftKey, serialized);
        persistedRawRef.current = serialized;
        persistedRevisionRef.current = revision;
        persistedDraftRef.current = draft;
      }
      setStorageError("");
    } catch {
      setStorageError(sentId
        ? "Feedback was received, but this browser could not mark your saved draft as submitted."
        : "This browser could not keep a local draft. Download it before closing.");
    }
  }, [conflicted, draft, draftKey, sentId, saveRetryToken]);

  async function send() {
    if (!user || conflicted || sentId || submissionPendingRef.current) return;
    if (draft.rating < 1) { setError("Choose a rating before sending."); return; }
    // Check for changes that arrived after the editor's last successful write.
    // This prevents an observed stale send; localStorage cannot make the
    // check atomic against a simultaneous update by an older browser tab.
    try {
      if (window.localStorage.getItem(draftKey) !== persistedRawRef.current) {
        setConflicted(true);
        setStorageError("Another tab changed this feedback draft. Your writing is still here. Download it, then close and reopen feedback to see the saved copy.");
        return;
      }
    } catch {
      setStorageError("AXOM could not check the saved feedback draft. No feedback was sent. Download your writing and retry when browser storage is available.");
      return;
    }
    submissionPendingRef.current = true;
    setSending(true);
    setError("");
    // The network receives the in-memory draft. A failed local write must
    // not acknowledge an older revision as though it contained that draft.
    const submittedContentWasSaved = persistedRawRef.current !== null
      && journalFeedbackFingerprint(draft) === journalFeedbackFingerprint(persistedDraftRef.current);
    submittedReceiptRef.current = !submittedContentWasSaved ? null
      : persistedRevisionRef.current
        ? `${persistedRevisionRef.current}:${journalFeedbackFingerprint(draft)}`
        : journalFeedbackFingerprint(draft) === journalFeedbackFingerprint(initialDraftRef.current)
          ? `legacy:${journalFeedbackFingerprint(persistedRawRef.current!)}` : null;
    try {
      setSentId(await submitJournalFeedbackOncePerTab(draftKey, user.id, draft));
    } catch (cause) {
      // Only a failed request may be retried; a receipt seals this dialog.
      submissionPendingRef.current = false;
      setError(cause instanceof Error ? cause.message : "Feedback could not be sent. Your draft is still here.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal title="How is the journal feeling?" onClose={onClose} className="journal-feedback-modal" footer={sentId ? (<>
      <GButton onClick={() => downloadBlob("axom-journal-feedback-submitted.json", new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" }))}><Download size={ICON_SIZE.body} /> Download submitted copy</GButton>
      <GButton variant="primary" onClick={onClose}>Close</GButton>
    </>) : <>
      {loaded.unreadable && loaded.raw !== null
        ? <GButton onClick={() => downloadBlob("axom-journal-feedback-unreadable.txt", new Blob([loaded.raw ?? ""], { type: "text/plain" }))}><Download size={ICON_SIZE.body} /> Download saved copy</GButton>
        : <GButton onClick={() => downloadBlob("axom-journal-feedback-draft.json", new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" }))}><Download size={ICON_SIZE.body} /> Download draft</GButton>}
      <GButton onClick={onClose}>Not now</GButton>
      <GButton variant="primary" disabled={!user || sending || conflicted} onClick={() => { void send(); }}>{sending ? "Sending…" : "Send feedback"}</GButton>
    </>}>
      {sentId ? (
        <div className="journal-feedback-success" role="status"><CheckCircle2 size={ICON_SIZE.emphasis} /><b>Feedback received.</b><span>Thank you for helping shape the journal. Receipt {sentId.slice(0, 8)}.</span><span>{storageError ? "Keep an exported copy if you want to retain these answers." : "Your saved local copy remains on this device to protect changes made in other tabs."}</span>{storageError && <p role="alert">{storageError}</p>}</div>
      ) : <>
        <p className="sub">Tell us about the journal experience only. AXOM does not attach your entries, images, or study records. Sending happens only when you press Send feedback.</p>
        <fieldset className="journal-rating-fieldset">
          <legend>Overall experience</legend>
          <div className="journal-rating-choices">
            {[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" aria-label={`${value} out of 5`} aria-pressed={draft.rating === value} disabled={sending || loaded.unreadable} onClick={() => setDraft({ ...draft, rating: value })}>{value}</button>)}
          </div>
        </fieldset>
        <div className="journal-feedback-fields">
          <TextAreaField label="What do you like?" value={draft.liked} readOnly={sending || loaded.unreadable} maxLength={1000} onChange={(event) => setDraft({ ...draft, liked: event.target.value })} />
          <TextAreaField label="What do you want more of?" value={draft.wantMore} readOnly={sending || loaded.unreadable} maxLength={1000} onChange={(event) => setDraft({ ...draft, wantMore: event.target.value })} />
          <TextAreaField label="What feels missing?" value={draft.missing} readOnly={sending || loaded.unreadable} maxLength={1000} onChange={(event) => setDraft({ ...draft, missing: event.target.value })} />
          <TextAreaField label="Where does it get in your way?" value={draft.painPoints} readOnly={sending || loaded.unreadable} maxLength={1000} onChange={(event) => setDraft({ ...draft, painPoints: event.target.value })} />
          <TextAreaField label="Anything else?" value={draft.comment} readOnly={sending || loaded.unreadable} maxLength={2000} onChange={(event) => setDraft({ ...draft, comment: event.target.value })} />
        </div>
        {!user && <p className="journal-feedback-note">Sign in to send this to AXOM. You can keep writing and download the draft now.</p>}
        {storageError && <p className="journal-feedback-note" role="alert">{storageError}</p>}
        {storageError && !loaded.unreadable && !conflicted && <GButton size="sm" onClick={() => setSaveRetryToken((token) => token + 1)}>Retry draft save</GButton>}
        {error && <p className="journal-feedback-note" role="alert">{error}</p>}
      </>}
    </Modal>
  );
}

const journalKeepsakes: Array<{ id: JournalPremiumStyle; name: string; detail: string; image: string }> = [
  { id: "copper", name: "Copper cover", detail: "A burnished, darker leather cover.", image: "/assets/journal/previews/copper-cover.svg" },
  { id: "linen", name: "Linen pages", detail: "Soft paper with a quiet rule.", image: "/assets/journal/previews/linen-paper.svg" },
  { id: "starlight", name: "Starlight MacBook", detail: "A warm metal finish for the desk.", image: "/assets/journal/previews/starlight-macbook.svg" },
  { id: "lamp", name: "Desk lamp", detail: "A pool of evening light.", image: "/assets/journal/previews/desk-lamp.svg" },
];

function JournalScenePreview({ preferences, previewStyle }: { preferences: JournalNotebookPreferences; previewStyle: JournalPremiumStyle | null }) {
  const view = {
    ...preferences,
    coverTone: previewStyle === "copper" ? "copper" : preferences.coverTone,
    paperTone: previewStyle === "linen" ? "linen" : preferences.paperTone,
    laptopTone: previewStyle === "starlight" ? "starlight" : preferences.laptopTone,
    deskAccent: previewStyle === "lamp" ? "lamp" : preferences.deskAccent,
  };
  return <figure className="journal-scene-preview">
    <div className={`journal-preview-scene journal-desk desk-${view.deskTone} weather-${view.weather} laptop-${view.laptopTone} laptop-${view.laptopPosition} headphones-${view.headphones} drink-${view.drink} accent-${view.deskAccent}`}>
      {deskWeatherSequence.map((weather) => <span key={weather} className={`journal-weather-wash wash-${weather}`} aria-hidden="true" />)}
      <span className="journal-desk-window" aria-hidden="true" />
      <span className="journal-preview-laptop" aria-hidden="true"><span /></span>
      <span className={`journal-preview-book cover-${view.coverTone}`} aria-hidden="true"><span>A</span><i /></span>
      <span className={`journal-preview-paper paper-${view.paperTone}`} aria-hidden="true" />
      <span className="journal-preview-headphones" aria-hidden="true"><i /><i /></span>
      <span className="journal-preview-drink" aria-hidden="true" />
      <span className="journal-preview-lamp" aria-hidden="true" />
    </div>
    <figcaption><b>{previewStyle ? `Previewing ${journalKeepsakes.find((item) => item.id === previewStyle)?.name}` : "Your desk, as selected"}</b><span>{deskWeatherName[view.weather]} · {view.deskTone === "ink" ? "Charcoal wood" : view.deskTone === "oak" ? "Pale oak" : "Walnut"}</span></figcaption>
  </figure>;
}

function NotebookCustomization({ initial, onClose, onSave }: {
  initial: JournalNotebookPreferences;
  onClose: () => void;
  onSave: (preferences: JournalNotebookPreferences) => void;
}) {
  const s = useStore();
  const [draft, setDraft] = useState(initial);
  const [pane, setPane] = useState<"desk" | "notebook" | "keepsakes">("desk");
  const [previewStyle, setPreviewStyle] = useState<JournalPremiumStyle | null>(null);
  const unlocked = draft.unlockedStyles ?? [];
  const newlyUnlocked = unlocked.filter((style) => !(initial.unlockedStyles ?? []).includes(style)).length;
  const credits = Math.max(0, studyCreditsBalance(s) - newlyUnlocked * JOURNAL_STYLE_COST);

  function unlockStyle(style: JournalPremiumStyle) {
    if (unlocked.includes(style) || credits < JOURNAL_STYLE_COST) return;
    setDraft({
      ...draft,
      unlockedStyles: [...unlocked, style],
      coverTone: style === "copper" ? "copper" : draft.coverTone,
      paperTone: style === "linen" ? "linen" : draft.paperTone,
      laptopTone: style === "starlight" ? "starlight" : draft.laptopTone,
      deskAccent: style === "lamp" ? "lamp" : draft.deskAccent,
    });
    setPreviewStyle(null);
  }

  return <Modal title="Personalize your journal" className="journal-personalize-modal" bodyClassName="journal-personalize-body" onClose={onClose} footer={<>
    <GButton onClick={() => { setDraft({ ...DEFAULT_JOURNAL_NOTEBOOK, unlockedStyles: unlocked, setupCompleted: draft.setupCompleted, feedbackPrompted: draft.feedbackPrompted }); setPreviewStyle(null); }}>Reset scene</GButton>
    <GButton onClick={onClose}>Cancel</GButton>
    <GButton variant="primary" onClick={() => onSave(normalizeJournalNotebookPreferences(draft))}>Save changes</GButton>
  </>}>
    <p className="journal-personalize-intro">Make the desk feel like yours. Your pages stay exactly as you wrote them.</p>
    <div className="journal-credit-ledger"><span className="journal-credit-emblem" aria-hidden="true">A</span><div><b>{credits} {STUDY_CURRENCY_NAME}</b><small>Earn credits by completing study sessions, reaching 80% of your daily goals, and keeping a streak. Keepsakes cost {JOURNAL_STYLE_COST} {STUDY_CURRENCY_SHORT} each.</small></div></div>
    <div className="journal-personalize-layout">
      <div className="journal-personalize-controls">
        <div className="journal-personalize-tabs" aria-label="Personalization sections">
          {(["desk", "notebook", "keepsakes"] as const).map((item) => <button key={item} type="button" aria-pressed={pane === item} onClick={() => { setPane(item); setPreviewStyle(null); }}>{item === "desk" ? "Desk" : item === "notebook" ? "Notebook" : "Keepsakes"}</button>)}
        </div>
        {pane === "desk" && <div className="journal-personalize-section">
          <h4>Set the scene</h4>
          <p>Ambient scenes change the light and shadows. They are not a local weather report.</p>
          <div className="journal-customize-grid">
            <SelectField label="Desk surface" value={draft.deskTone} onChange={(event) => setDraft({ ...draft, deskTone: event.target.value as JournalNotebookPreferences["deskTone"] })}>
              <option value="walnut">Walnut</option><option value="oak">Pale oak</option><option value="ink">Charcoal wood</option>
            </SelectField>
            <SelectField label="Scene weather" value={draft.weather} onChange={(event) => setDraft({ ...draft, weather: event.target.value as JournalNotebookPreferences["weather"] })}>
              {deskWeatherSequence.map((weather) => <option key={weather} value={weather}>{deskWeatherName[weather]}</option>)}
            </SelectField>
          </div>
          <label className="journal-cycle-choice"><input type="checkbox" checked={draft.weatherCycle !== false} onChange={(event) => setDraft({ ...draft, weatherCycle: event.target.checked })} /><span><b>Cycle scenes automatically</b><small>Moves through five scenes while the desk is idle. Pause it on the desk at any time.</small></span></label>
          <div className="journal-customize-grid">
            <SelectField label="Laptop finish" value={draft.laptopTone} onChange={(event) => setDraft({ ...draft, laptopTone: event.target.value as JournalNotebookPreferences["laptopTone"] })}>
              <option value="graphite">Graphite</option><option value="silver">Silver</option><option value="starlight" disabled={!unlocked.includes("starlight")}>Starlight · {unlocked.includes("starlight") ? "owned" : `${JOURNAL_STYLE_COST} AC`}</option>
            </SelectField>
            <SelectField label="Laptop position" value={draft.laptopPosition} onChange={(event) => setDraft({ ...draft, laptopPosition: event.target.value as JournalNotebookPreferences["laptopPosition"] })}>
              <option value="left">Left</option><option value="right">Right</option>
            </SelectField>
            <SelectField label="Listening setup" value={draft.headphones} onChange={(event) => setDraft({ ...draft, headphones: event.target.value as JournalNotebookPreferences["headphones"] })}>
              <option value="wired">Wired headphones</option><option value="airpods">AirPods</option><option value="beats">Beats over-ear</option>
            </SelectField>
            <SelectField label="Drink" value={draft.drink} onChange={(event) => setDraft({ ...draft, drink: event.target.value as JournalNotebookPreferences["drink"] })}>
              <option value="tea">Tea</option><option value="coffee">Coffee</option><option value="water">Water</option>
            </SelectField>
            <SelectField label="Desk light" value={draft.deskAccent ?? "none"} onChange={(event) => setDraft({ ...draft, deskAccent: event.target.value as JournalNotebookPreferences["deskAccent"] })}>
              <option value="none">Window light</option><option value="lamp" disabled={!unlocked.includes("lamp")}>Warm lamp · {unlocked.includes("lamp") ? "owned" : `${JOURNAL_STYLE_COST} AC`}</option>
            </SelectField>
          </div>
        </div>}
        {pane === "notebook" && <div className="journal-personalize-section">
          <h4>The book itself</h4>
          <Field label="Notebook title" value={draft.title} maxLength={80} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
          <Field label="Subtitle" value={draft.subtitle} maxLength={120} onChange={(event) => setDraft({ ...draft, subtitle: event.target.value })} />
          <div className="journal-customize-grid">
            <SelectField label="Writing style" value={draft.writingMode ?? "guided"} onChange={(event) => setDraft({ ...draft, writingMode: event.target.value as JournalNotebookPreferences["writingMode"] })}><option value="guided">A few prompts</option><option value="free">Open page</option></SelectField>
            <SelectField label="Journal purpose" value={draft.purpose ?? "reflect"} onChange={(event) => setDraft({ ...draft, purpose: event.target.value as JournalNotebookPreferences["purpose"] })}><option value="focus">Find focus</option><option value="reflect">Reflect</option><option value="recover">Regroup</option></SelectField>
            <SelectField label="Cover" value={draft.coverTone} onChange={(event) => setDraft({ ...draft, coverTone: event.target.value as JournalNotebookPreferences["coverTone"] })}><option value="onyx">Onyx</option><option value="forest">Forest</option><option value="oxblood">Oxblood</option><option value="navy">Midnight navy</option><option value="copper" disabled={!unlocked.includes("copper")}>Copper · {unlocked.includes("copper") ? "owned" : `${JOURNAL_STYLE_COST} AC`}</option></SelectField>
            <SelectField label="Paper" value={draft.paperTone} onChange={(event) => setDraft({ ...draft, paperTone: event.target.value as JournalNotebookPreferences["paperTone"] })}><option value="warm">Warm</option><option value="cream">Cream</option><option value="white">Bright</option><option value="linen" disabled={!unlocked.includes("linen")}>Linen · {unlocked.includes("linen") ? "owned" : `${JOURNAL_STYLE_COST} AC`}</option></SelectField>
          </div>
        </div>}
        {pane === "keepsakes" && <div className="journal-personalize-section">
          <h4>Choose a keepsake</h4>
          <p>Preview each item in the desk scene before spending credits. Owned items can be selected whenever you like.</p>
          <div className="journal-keepsake-grid">
            {journalKeepsakes.map((item) => <article key={item.id} className="journal-keepsake-card">
              <button type="button" className="journal-keepsake-preview" aria-label={`Preview ${item.name}`} aria-pressed={previewStyle === item.id} onClick={() => setPreviewStyle(item.id)}><img src={item.image} alt={`${item.name} preview`} width="320" height="180" /></button>
              <div className="journal-keepsake-details"><b>{item.name}</b><small>{item.detail}</small></div>
              <GButton size="sm" disabled={unlocked.includes(item.id) || credits < JOURNAL_STYLE_COST} onClick={() => unlockStyle(item.id)}>{unlocked.includes(item.id) ? "Owned" : `Unlock · ${JOURNAL_STYLE_COST} ${STUDY_CURRENCY_SHORT}`}</GButton>
            </article>)}
          </div>
          {credits < JOURNAL_STYLE_COST && <p className="journal-credit-hint">Reach 80% of today’s goals or finish a study session to earn more credits.</p>}
        </div>}
      </div>
      <aside className="journal-personalize-preview"><JournalScenePreview preferences={draft} previewStyle={previewStyle} /><small>Changes appear here first. Save to keep the scene.</small></aside>
    </div>
  </Modal>;
}

function PreviousIntention({ plan }: { plan: DayPlan }) {
  return (
    <div className="standup-prev-intention journal-intention-card">
      <div className="spi-head"><Lock size={ICON_SIZE.microInline} /> Intention set {prettyDate(`${plan.dayKey}T12:00:00`)} · source record unchanged</div>
      <p>“{plan.intention}”</p>
      {plan.wins.length > 0 && <div className="spi-wins">{plan.wins.map((win, index) => <span key={index}>{win}</span>)}</div>}
      {plan.outcome && <Tag tone={outcomeTone[plan.outcome]}><Trophy size={ICON_SIZE.microInline} /> Marked {plan.outcome}</Tag>}
    </div>
  );
}

function draftFromEntry(entry: NotebookJournalEntry | undefined, plan: DayPlan | undefined): JournalDraft {
  return {
    today: entry?.today ?? "",
    tomorrow: entry?.tomorrow ?? "",
    blockers: entry?.blockers ?? "",
    energy: entry?.energy ?? "",
    rating: entry?.rating ?? (plan?.outcome ? `Outcome: ${plan.outcome}` : "Daily review"),
    freeWriting: entry?.freeWriting ?? "",
    wins: entry?.wins?.length ? entry.wins : [""],
    losses: entry?.losses?.length ? entry.losses : [""],
    attachments: normalizeJournalAttachments(entry?.attachments),
    dayAtAGlance: entry?.dayAtAGlance ?? {},
    notebookStatus: entry?.notebookStatus ?? "draft",
  };
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
