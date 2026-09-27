// ===========================================================================
// Focus dock — the persistent pill at the bottom of every page. It appears
// whenever something is running: a study session, a Pomodoro phase, or a
// soundscape. With a timer and a soundscape together, the pill splits in two
// (a liquid "pinch" drawn by an SVG goo filter behind the content). Hovering
// the sound half genies its live visual out of the pill.
// ===========================================================================
import { useEffect, useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { Brain, Check, Coffee, ListPlus, Maximize2, Minimize2, Moon, Pause, Play, RotateCcw, SkipForward, Sunrise, X } from "lucide-react";
import { useStore } from "../../lib/store";
import { findLiveSession, formatElapsed, sessionElapsedMs, QUICK_LOG_LABEL, type SessionQuickLog } from "../../lib/sessions";
import { formatClock, pomodoroPhaseSeconds, usePomodoro } from "../../lib/pomodoro";
import { useSessionUi } from "../../lib/sessionUi";
import { useSoundscape } from "../../lib/soundscapes/store";
import { EVIDENCE_LABEL, SOUNDSCAPES } from "../../lib/soundscapes/presets";
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
  // Paused mid-sprint (even at 0 s elapsed) still belongs in the dock; reset hides it.
  const visible = pomodoro.running || pomodoro.focusRunStarted || (pomodoro.secondsLeft > 0 && pomodoro.secondsLeft < total);
  return { pomodoro, total, visible };
}

export function FocusDock() {
  const sessions = useStore((state) => state.sessions);
  const session = findLiveSession(sessions ?? []);
  const { pomodoro, total, visible: pomodoroVisible } = usePomodoroView();
  const soundStatus = useSoundscape((state) => state.status);
  const restStatus = useRest((state) => state.status);
  const resting = restStatus !== "idle";
  // While resting, the rest capsule stands in for the (paused) timer.
  const timerActive = resting || Boolean(session) || pomodoroVisible;
  const soundActive = soundStatus !== "idle";
  const [expanded, setExpanded] = useState(false);
  if (!timerActive && !soundActive) return null;
  const split = timerActive && soundActive;

  const capsules = (ghost: boolean) => (
    <>
      {resting && <RestCapsule ghost={ghost} />}
      {timerActive && !resting && (
        <TimerCapsule
          ghost={ghost}
          expanded={expanded}
          onExpand={setExpanded}
          session={session}
          pomodoro={pomodoroVisible ? pomodoro : null}
          phaseTotal={total}
        />
      )}
      {soundActive && <SoundCapsule ghost={ghost} entering={split} />}
    </>
  );

  return (
    <div className={`focus-dock ${split ? "split" : ""}`} role="region" aria-label="Focus dock">
      <svg className="focus-dock-defs" aria-hidden="true" focusable="false">
        <filter id="axom-dock-goo" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="blur" />
          <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -10" result="goo" />
          <feComposite in="SourceGraphic" in2="goo" operator="atop" />
        </filter>
      </svg>
      {/* The goo layer holds only the capsule shapes; the crisp content sits on top. */}
      <div className="focus-dock-row focus-dock-goo" aria-hidden="true">{capsules(true)}</div>
      <div className="focus-dock-row focus-dock-content">{capsules(false)}</div>
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
  const status = pomodoro
    ? `${pomodoro.phase === "break" ? "Break" : "Focus"} ${pomodoro.running ? "running" : "paused"}, ${clock} left`
    : `Session ${session?.status === "active" ? "running" : "paused"}, ${clock} elapsed`;

  return (
    <Capsule
      ghost={ghost}
      className={`dock-timer ${expanded ? "expanded" : ""} ${running ? "" : "paused"}`}
      onMouseEnter={() => onExpand(true)}
      onMouseLeave={() => { onExpand(false); setLogsOpen(false); }}
      onFocus={() => onExpand(true)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { onExpand(false); setLogsOpen(false); } }}
    >
      <ProgressRing fraction={fraction} phase={phase} />
      <span className="dock-clock mono" aria-hidden="true">{clock}</span>
      <span className="sr-only" role="status">{status}</span>
      <span className="dock-label">{label}</span>
      <IconButton label={running ? (pomodoro ? "Pause timer" : "Pause session") : (pomodoro ? "Resume timer" : "Resume session")} onClick={toggle} className="primary">
        {running ? <Pause size={ICON_SIZE.body} /> : <Play size={ICON_SIZE.body} />}
      </IconButton>
      <span className="dock-more">
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
      </span>
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
      <button type="button" className="dock-sound-name" onClick={open} aria-label={ringing ? "Rest is over — open" : "Resting — open"}>
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
  const presetId = useSoundscape((state) => state.presetId);
  const status = useSoundscape((state) => state.status);
  const output = useSoundscape((state) => state.output);
  const { toggle, stop } = useSoundscape.getState();
  const stopLabel = useStopTimerLabel();
  const reduced = useReducedMotion();
  const [genie, setGenie] = useState<GeniePhase>("closed");
  const [origin, setOrigin] = useState(70);
  const capsuleRef = useRef<HTMLDivElement | null>(null);
  const timers = useRef<{ open?: number; close?: number; out?: number }>({});
  // Escape closes the genie wherever focus is (a hover never moves focus).
  useEffect(() => {
    if (ghost || genie !== "open") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
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
  if (!presetId) return null;
  const preset = SOUNDSCAPES[presetId];
  const pair = carrierPair(preset, output);

  const clear = () => {
    window.clearTimeout(timers.current.open);
    window.clearTimeout(timers.current.close);
    window.clearTimeout(timers.current.out);
  };
  const open = (delay = GENIE_OPEN_DELAY) => {
    clear();
    timers.current.open = window.setTimeout(() => setGenie("open"), delay);
  };
  const close = (delay = GENIE_CLOSE_DELAY) => {
    clear();
    timers.current.close = window.setTimeout(() => {
      setGenie((current) => (current === "open" ? "closing" : current));
      timers.current.out = window.setTimeout(() => setGenie("closed"), reduced ? 0 : GENIE_OUT_MS);
    }, delay);
  };

  return (
    <div
      className="dock-sound-wrap"
      onMouseEnter={ghost ? undefined : () => open()}
      onMouseLeave={ghost ? undefined : () => close()}
      onFocus={ghost ? undefined : () => open(0)}
      onBlur={ghost ? undefined : (event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close(); }}
    >
      {!ghost && genie !== "closed" && (
        <GeniePanel phase={genie} origin={origin} presetId={presetId} pairLabel={pair ? `${pair[0]} / ${pair[1]} Hz` : undefined} />
      )}
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
          <button type="button" className="dock-sound-name" onClick={() => (genie === "open" ? close(0) : open(0))} aria-expanded={genie === "open"} aria-label={`${preset.name} soundscape — show visual and controls`}>
            <b>{preset.short}</b>
            <small>{stopLabel ?? preset.band}</small>
          </button>
          <IconButton label={status === "playing" ? "Pause sound" : "Play sound"} onClick={() => void toggle()} className="primary">
            {status === "playing" ? <Pause size={ICON_SIZE.body} /> : <Play size={ICON_SIZE.body} />}
          </IconButton>
          <IconButton label="Stop sound" onClick={() => void stop()}><X size={ICON_SIZE.body} /></IconButton>
        </div>
      </Capsule>
    </div>
  );
}

function GeniePanel({ phase, origin, presetId, pairLabel }: { phase: Exclude<GeniePhase, "closed">; origin: number; presetId: NonNullable<ReturnType<typeof useSoundscape.getState>["presetId"]>; pairLabel?: string }) {
  const preset = SOUNDSCAPES[presetId];
  const status = useSoundscape((state) => state.status);
  const panelRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    panelRef.current?.style.setProperty("--genie-origin", `${origin}%`);
  }, [origin]);
  return (
    <div ref={panelRef} className={`dock-genie ${phase}`} role="dialog" aria-label={`${preset.name} soundscape`}>
      <div className="dock-genie-stage">
        <SoundscapeVisual visual={preset.visual} animate={status === "playing"} reactive label={`${preset.name} visual`} />
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
