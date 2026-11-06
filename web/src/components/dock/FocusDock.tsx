// ===========================================================================
// Focus dock: equal timer and sound pills stay available while idle, paused,
// or running. An SVG goo filter draws the background shapes without duplicating
// interactive controls. Hovering or focusing the sound pill opens its visual.
// ===========================================================================
import { useEffect, useId, useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { Brain, Check, Coffee, ListPlus, Maximize2, Minimize2, Moon, Pause, Play, RotateCcw, SkipForward, Sunrise, X } from "lucide-react";
import { useStore } from "../../lib/store";
import { findLiveSession, formatElapsed, sessionElapsedMs, QUICK_LOG_LABEL, type SessionQuickLog } from "../../lib/sessions";
import { formatClock, pomodoroPhaseSeconds, POMODORO_PRESETS, usePomodoro } from "../../lib/pomodoro";
import { useSessionUi } from "../../lib/sessionUi";
import { useSoundscape } from "../../lib/soundscapes/store";
import { DEFAULT_SOUNDSCAPE_ID, EVIDENCE_LABEL, SOUNDSCAPES, lookFor, versionOf, isPlayable } from "../../lib/soundscapes/presets";
import { carrierPair } from "../../lib/soundscapes/engine";
import { useReducedMotion } from "../../lib/motion";
import { formatRestClock, useRest } from "../../lib/rest";
import { ICON_SIZE } from "../../lib/iconSize";
import { SoundscapeVisual } from "../soundscapes/SoundscapeVisual";
import { FollowTimerToggle, OutputToggle, PresetChips, StopTimerControl, VersionChips, VolumeControl, useStopTimerLabel } from "../soundscapes/SoundscapeControls";

const QUICK_LOGS = Object.keys(QUICK_LOG_LABEL) as SessionQuickLog[];
const GENIE_OPEN_DELAY = 140;
const GENIE_CLOSE_DELAY = 260;
const GENIE_OUT_MS = 260;
const DOCK_HOVER_QUERY = "(min-width: 561px) and (hover: hover) and (pointer: fine)";

function dockHoverEnabled(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(DOCK_HOVER_QUERY).matches;
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

function usePomodoroView() {
  const pomodoro = usePomodoro();
  const total = pomodoroPhaseSeconds(pomodoro);
  // A started sprint takes priority over a standalone session, even while paused.
  const visible = pomodoro.running || pomodoro.focusRunStarted || (pomodoro.secondsLeft > 0 && pomodoro.secondsLeft < total);
  return { pomodoro, total, visible };
}

export function FocusDock() {
  const sessions = useStore((state) => state.sessions);
  const session = findLiveSession(sessions ?? []);
  const { pomodoro, total, visible: pomodoroVisible } = usePomodoroView();
  const restStatus = useRest((state) => state.status);
  const resting = restStatus !== "idle";
  // While resting, the rest capsule stands in for the (paused) timer.
  const [expanded, setExpanded] = useState(false);

  const capsules = (
    <>
      {resting ? <RestCapsule ghost={false} /> : (
        <TimerCapsule ghost={false} expanded={expanded} onExpand={setExpanded}
          session={session} pomodoro={session && !pomodoroVisible ? null : pomodoro} phaseTotal={total} />
      )}
      <SoundCapsule ghost={false} entering={false} />
    </>
  );

  return (
    <div className="focus-dock split" role="region" aria-label="Focus dock">
      <svg className="focus-dock-defs" aria-hidden="true" focusable="false">
        <filter id="axom-dock-goo" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="blur" />
          <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -10" result="goo" />
          <feComposite in="SourceGraphic" in2="goo" operator="atop" />
        </filter>
      </svg>
      {/* The goo layer holds only the capsule shapes; the crisp content sits on top. */}
      <div className="focus-dock-row focus-dock-goo" aria-hidden="true"><div className="dock-capsule ghost" /><div className="dock-capsule ghost" /></div>
      <div className="focus-dock-row focus-dock-content">{capsules}</div>
    </div>
  );
}

function Capsule({ ghost, className, children, ...rest }: { ghost: boolean; className: string; children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`dock-capsule ${className} ${ghost ? "ghost" : ""}`} {...(ghost ? {} : rest)}>
      {children}
    </div>
  );
}

function IconButton({ label, onClick, children, className = "" }: { label: string; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button type="button" className={`dock-icon ${className}`} aria-label={label} title={label} onClick={onClick}>
      {children}
    </button>
  );
}

function ProgressRing({ fraction, phase }: { fraction: number; phase: "focus" | "break" | "session" }) {
  const radius = 12;
  const circumference = 2 * Math.PI * radius;
  const Glyph = phase === "break" ? Coffee : Brain;
  return (
    <span className={`dock-ring ${phase}`} aria-hidden="true">
      <svg className="dock-ring-track" viewBox="0 0 30 30">
        <circle cx="15" cy="15" r={radius} className="track" />
        {phase !== "session" && (
          <circle cx="15" cy="15" r={radius} className="value" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - Math.min(1, Math.max(0, fraction)))} />
        )}
      </svg>
      {phase === "session" ? <i className="dock-live-dot" /> : <Glyph size={11} className="dock-ring-glyph" />}
    </span>
  );
}

function TimerCapsule({ ghost, expanded, onExpand, session, pomodoro, phaseTotal }: {
  ghost: boolean;
  expanded: boolean;
  onExpand: (value: boolean) => void;
  session: ReturnType<typeof findLiveSession>;
  pomodoro: ReturnType<typeof usePomodoro.getState> | null;
  phaseTotal: number;
}) {
  const now = useNow(!ghost && session?.status === "active");
  const [logsOpen, setLogsOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  const idle = Boolean(pomodoro && !pomodoro.running && !pomodoro.focusRunStarted && pomodoro.phase === "focus" && pomodoro.secondsLeft === phaseTotal && !session);
  const { focusMode, toggleFocusMode, openCapture } = useSessionUi();
  const store = useStore.getState();
  const elapsed = session ? sessionElapsedMs(session, new Date(now)) : 0;
  const clock = pomodoro ? formatClock(pomodoro.secondsLeft) : formatElapsed(elapsed);
  const phase = pomodoro ? pomodoro.phase : "session";
  const label = session?.title
    ?? (pomodoro?.phase === "break" ? "Break" : pomodoro?.targetLabel || pomodoro?.intention || "Focus sprint");
  const running = pomodoro ? pomodoro.running : session?.status === "active";
  const fraction = pomodoro ? 1 - pomodoro.secondsLeft / Math.max(1, phaseTotal) : 0;

  const toggle = () => {
    if (pomodoro) pomodoro.toggle();
    else if (session?.status === "active") store.pauseSession(session.id);
    else if (session) store.resumeSession(session.id);
  };
  const status = idle ? `Timer ready, ${clock}` : pomodoro
    ? `${pomodoro.phase === "break" ? "Break" : "Focus"} ${pomodoro.running ? "running" : "paused"}, ${clock} left`
    : `Session ${session?.status === "active" ? "running" : "paused"}, ${clock} elapsed`;

  return (
    <Capsule
      ghost={ghost}
      className={`dock-timer ${expanded ? "expanded" : ""} ${running ? "" : "paused"}`}
      onMouseEnter={() => { if (dockHoverEnabled()) { window.clearTimeout(closeTimer.current); onExpand(true); } }}
      onMouseLeave={(event) => {
        const capsule = event.currentTarget;
        window.clearTimeout(closeTimer.current);
        closeTimer.current = window.setTimeout(() => {
          if (!capsule.contains(document.activeElement)) { onExpand(false); setLogsOpen(false); setSetupOpen(false); }
        }, 250);
      }}
      onFocus={() => { window.clearTimeout(closeTimer.current); onExpand(true); }}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { onExpand(false); setLogsOpen(false); setSetupOpen(false); } }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        const trigger = event.currentTarget.querySelector<HTMLButtonElement>(".dock-timer-trigger")
          ?? event.currentTarget.querySelector<HTMLButtonElement>(".dock-icon.primary");
        trigger?.focus();
        setLogsOpen(false);
        setSetupOpen(false);
        onExpand(false);
      }}
    >
      <ProgressRing fraction={fraction} phase={phase} />
      {pomodoro
        ? <button type="button" className="dock-clock dock-timer-trigger mono" aria-label="Timer options" aria-expanded={setupOpen} onClick={() => setSetupOpen((value) => !value)}>{clock}</button>
        : <span className="dock-clock mono" aria-hidden="true">{clock}</span>}
      <span className="sr-only" role="status">{status}</span>
      <span className="dock-label">{label}</span>
      <IconButton label={running ? (pomodoro ? "Pause timer" : "Pause session") : (idle ? "Start timer" : pomodoro ? "Resume timer" : "Resume session")} onClick={toggle} className="primary">
        {running ? <Pause size={ICON_SIZE.body} /> : <Play size={ICON_SIZE.body} />}
      </IconButton>
      {setupOpen && pomodoro && <div className="dock-setup" role="group" aria-label="Timer options">
        <label>Duration <select aria-label="Timer duration" disabled={pomodoro.running} value={pomodoro.presetId} onChange={(event) => pomodoro.setPreset(event.target.value)}>{POMODORO_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select></label>
        <button type="button" disabled={pomodoro.running} onClick={() => { pomodoro.start(); setSetupOpen(false); }}>Start timer</button>
        <button type="button" disabled={pomodoro.running} onClick={() => { if (pomodoro.phase === "focus") pomodoro.skip(); usePomodoro.getState().start(); setSetupOpen(false); }}>Start break</button>
      </div>}
      {expanded && !setupOpen && (pomodoro || session) && <span className="dock-more">
        {pomodoro && (
          <>
            <IconButton label="Skip to next phase" onClick={() => pomodoro.skip()}><SkipForward size={ICON_SIZE.body} /></IconButton>
            {!session && <IconButton label="Reset timer" onClick={() => pomodoro.reset()}><RotateCcw size={ICON_SIZE.body} /></IconButton>}
          </>
        )}
        {session && (
          <>
            <IconButton label="Log a quick note" onClick={() => setLogsOpen((value) => !value)}><ListPlus size={ICON_SIZE.body} /></IconButton>
            <IconButton label={focusMode ? "Exit focus mode" : "Focus mode"} onClick={toggleFocusMode}>
              {focusMode ? <Minimize2 size={ICON_SIZE.body} /> : <Maximize2 size={ICON_SIZE.body} />}
            </IconButton>
            <IconButton label="Finish session" onClick={openCapture} className="finish"><Check size={ICON_SIZE.body} /></IconButton>
          </>
        )}
      </span>}
      {session && logsOpen && !ghost && (
        <span className="dock-log-menu" role="menu" aria-label="Quick log">
          {QUICK_LOGS.map((log) => (
            <button key={log} type="button" role="menuitem" onClick={() => {
              store.quickLogSession(session.id, log);
              setLogsOpen(false);
              if (log === "completed") openCapture();
            }}>{QUICK_LOG_LABEL[log]}</button>
          ))}
        </span>
      )}
    </Capsule>
  );
}

function RestCapsule({ ghost }: { ghost: boolean }) {
  const status = useRest((state) => state.status);
  const endsAt = useRest((state) => state.endsAt);
  const now = useNow(!ghost);
  const ringing = status === "ringing";
  const open = () => useRest.getState().setOverlayOpen(true);
  return (
    <Capsule ghost={ghost} className={`dock-rest ${ringing ? "ringing" : ""}`}>
      <span className="dock-ring session" aria-hidden="true">{ringing ? <Sunrise size={13} /> : <Moon size={13} />}</span>
      <button type="button" className="dock-sound-name" onClick={open} aria-label={ringing ? "Rest is over, open" : "Resting, open"}>
        <b className="mono">{ringing ? "Wake up" : formatRestClock((endsAt ?? now) - now)}</b>
        <small>{ringing ? "Rest is over" : "Resting"}</small>
      </button>
      <IconButton label="Wake me now" onClick={() => useRest.getState().wakeNow()}><X size={ICON_SIZE.body} /></IconButton>
    </Capsule>
  );
}

function Equalizer({ playing }: { playing: boolean }) {
  return (
    <span className={`dock-eq ${playing ? "playing" : ""}`} aria-hidden="true">
      {[0, 1, 2, 3].map((bar) => <i key={bar} style={{ animationDelay: `${bar * -0.37}s` }} />)}
    </span>
  );
}

type GeniePhase = "closed" | "open" | "closing";

function SoundCapsule({ ghost, entering }: { ghost: boolean; entering: boolean }) {
  const presetId = useSoundscape((state) => state.presetId ?? (isPlayable(state.lastPresetId) ? state.lastPresetId : DEFAULT_SOUNDSCAPE_ID));
  const status = useSoundscape((state) => state.status);
  const output = useSoundscape((state) => state.output);
  const versionChoice = useSoundscape((state) => state.status !== "idle" ? state.loadedVersionId ?? state.versions[presetId] : state.versions[presetId]);
  useSoundscape((state) => state.catalog);
  const { toggle, stop } = useSoundscape.getState();
  const stopLabel = useStopTimerLabel();
  const reduced = useReducedMotion();
  const [genie, setGenie] = useState<GeniePhase>("closed");
  const [origin, setOrigin] = useState(70);
  const panelId = useId();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const capsuleRef = useRef<HTMLDivElement | null>(null);
  const timers = useRef<{ open?: number; close?: number; out?: number }>({});
  // Escape closes the genie wherever focus is (a hover never moves focus).
  useEffect(() => {
    if (ghost || genie !== "open") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && focused.closest(".dock-genie")) capsuleRef.current?.querySelector<HTMLButtonElement>(".dock-sound-name")?.focus();
      window.clearTimeout(timers.current.open);
      setGenie("closing");
      window.clearTimeout(timers.current.out);
      timers.current.out = window.setTimeout(() => setGenie("closed"), reduced ? 0 : GENIE_OUT_MS);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ghost, genie, reduced]);
  useEffect(() => () => {
    window.clearTimeout(timers.current.open);
    window.clearTimeout(timers.current.close);
    window.clearTimeout(timers.current.out);
  }, []);
  const preset = SOUNDSCAPES[presetId];
  const pair = carrierPair(preset, output);
  // Your own files show their own name, not the shelf's.
  const chosenVersion = versionOf(preset, versionChoice);
  const ownFile = "src" in chosenVersion && (chosenVersion.userFile || preset.band === "Yours" || preset.band === "Music");
  const capsuleTitle = ownFile ? chosenVersion.label : preset.short;
  const capsuleSub = ownFile ? preset.name : preset.band;

  const clear = () => {
    window.clearTimeout(timers.current.open);
    window.clearTimeout(timers.current.close);
    window.clearTimeout(timers.current.out);
  };
  const open = (delay = GENIE_OPEN_DELAY) => {
    clear();
    timers.current.open = window.setTimeout(() => setGenie("open"), delay);
  };
  const close = (delay = GENIE_CLOSE_DELAY, keepFocused = false) => {
    clear();
    timers.current.close = window.setTimeout(() => {
      // Pointer movement must not remove controls that still own keyboard focus.
      if (keepFocused && wrapperRef.current?.contains(document.activeElement)) return;
      setGenie((current) => (current === "open" ? "closing" : current));
      timers.current.out = window.setTimeout(() => setGenie("closed"), reduced ? 0 : GENIE_OUT_MS);
    }, delay);
  };

  return (
    <div
      ref={wrapperRef}
      className="dock-sound-wrap"
      onMouseEnter={ghost ? undefined : () => { if (dockHoverEnabled()) open(); }}
      onMouseLeave={ghost ? undefined : () => close(GENIE_CLOSE_DELAY, true)}
      onFocus={ghost ? undefined : () => open(0)}
      onBlur={ghost ? undefined : (event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close(); }}
    >
      <Capsule ghost={ghost} className={`dock-sound ${entering ? "entering" : ""} ${status === "paused" ? "paused" : ""}`}>
        <div
          ref={ghost ? undefined : (node) => {
            capsuleRef.current = node;
            if (node) {
              const width = node.offsetWidth;
              const panel = Math.min(360, window.innerWidth - 24);
              setOrigin((current) => {
                const next = Math.round(((panel - width / 2) / panel) * 100);
                return Math.abs(current - next) > 1 ? next : current;
              });
            }
          }}
          className="dock-sound-inner"
        >
          <Equalizer playing={status === "playing"} />
          <button type="button" className="dock-sound-name" onClick={() => (genie === "open" ? close(0) : open(0))} aria-expanded={genie === "open"} aria-controls={genie !== "closed" ? panelId : undefined} aria-haspopup="dialog" aria-label={`${preset.name} soundscape, show visual and controls`}>
            <b>{capsuleTitle}</b>
            <small>{stopLabel ?? capsuleSub}</small>
          </button>
          <IconButton label={status === "playing" ? "Pause sound" : "Play sound"} onClick={() => void toggle()} className="primary">
            {status === "playing" ? <Pause size={ICON_SIZE.body} /> : <Play size={ICON_SIZE.body} />}
          </IconButton>
          <IconButton label="Stop sound" onClick={() => void stop()}><X size={ICON_SIZE.body} /></IconButton>
        </div>
      </Capsule>
      {!ghost && genie !== "closed" && (
        <GeniePanel id={panelId} phase={genie} origin={origin} presetId={presetId} pairLabel={pair ? `${pair[0]} / ${pair[1]} Hz` : undefined} />
      )}
    </div>
  );
}

function GeniePanel({ id, phase, origin, presetId, pairLabel }: { id: string; phase: Exclude<GeniePhase, "closed">; origin: number; presetId: NonNullable<ReturnType<typeof useSoundscape.getState>["presetId"]>; pairLabel?: string }) {
  const preset = SOUNDSCAPES[presetId];
  const status = useSoundscape((state) => state.status);
  const versionId = useSoundscape((state) => state.status !== "idle" ? state.loadedVersionId ?? state.versions[presetId] : state.versions[presetId]);
  const panelRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    panelRef.current?.style.setProperty("--genie-origin", `${origin}%`);
    panelRef.current?.toggleAttribute("inert", phase === "closing");
  }, [origin, phase]);
  return (
    <div id={id} ref={panelRef} className={`dock-genie ${phase}`} aria-hidden={phase === "closing" ? true : undefined} role="dialog" aria-label={`${preset.name} soundscape`}>
      <div className="dock-genie-stage">
        <SoundscapeVisual {...lookFor(preset, versionId)} animate={status === "playing"} reactive label={`${preset.name} visual`} />
        <div className="dock-genie-caption">
          <b>{preset.name}</b>
          <small>{[preset.band, pairLabel].filter(Boolean).join(" · ")}</small>
        </div>
      </div>
      <div className="dock-genie-controls">
        <PresetChips />
        <VersionChips presetId={presetId} />
        <div className="dock-genie-row">
          <VolumeControl />
          <StopTimerControl />
        </div>
        <div className="dock-genie-row">
          <OutputToggle />
          <a className="dock-genie-link" href="#soundscapes">All soundscapes</a>
        </div>
        <FollowTimerToggle />
        <p className="dock-genie-note"><span>{EVIDENCE_LABEL[preset.evidence]}.</span> {preset.evidenceNote}</p>
      </div>
    </div>
  );
}
