// The browser tab mirrors AXOM's live state, Raycast-style: the page name when
// idle; the countdown and a thin progress ring on the orb icon during a
// Pomodoro. Mounted once in the app shell; renders nothing.
import { useEffect, useRef } from "react";
import { pomodoroPhaseSeconds, usePomodoro } from "../../lib/pomodoro";

const BASE_ICON = "./favicon.svg";

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

export function tabTitle(page: string, timer: { running: boolean; phase: "focus" | "break"; secondsLeft: number }): string {
  if (!timer.running) return page ? `${page} · AXOM` : "AXOM";
  return `${formatClock(timer.secondsLeft)} · ${timer.phase === "focus" ? "Focus" : "Break"} · AXOM`;
}

function iconLink(): HTMLLinkElement | null {
  return document.querySelector<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]');
}

export function TabPresence({ page }: { page: string }) {
  const running = usePomodoro((s) => s.running);
  const phase = usePomodoro((s) => s.phase);
  const secondsLeft = usePomodoro((s) => s.secondsLeft);
  const orb = useRef<HTMLImageElement | null>(null);
  const lastPercent = useRef(-1);

  useEffect(() => {
    document.title = tabTitle(page, { running, phase, secondsLeft });
  }, [page, running, phase, secondsLeft]);

  useEffect(() => {
    const link = iconLink();
    if (!link) return;
    if (!running) {
      lastPercent.current = -1;
      if (link.getAttribute("href") !== BASE_ICON) link.setAttribute("href", BASE_ICON);
      return;
    }
    const total = pomodoroPhaseSeconds(usePomodoro.getState());
    const percent = total > 0 ? Math.round((1 - secondsLeft / total) * 100) : 0;
    if (percent === lastPercent.current) return;
    lastPercent.current = percent;
    const draw = () => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 64;
      const ctx = canvas.getContext("2d");
      if (!ctx || !orb.current) return;
      ctx.drawImage(orb.current, 0, 0, 64, 64);
      const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent-rgb").trim() || "200,169,106";
      ctx.lineCap = "round";
      ctx.lineWidth = 5;
      ctx.strokeStyle = phase === "focus" ? `rgba(${accent},0.95)` : "rgba(110,207,151,0.95)";
      ctx.beginPath();
      ctx.arc(32, 32, 28.5, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * Math.max(percent, 2)) / 100);
      ctx.stroke();
      link.setAttribute("href", canvas.toDataURL("image/png"));
    };
    if (orb.current?.complete) { draw(); return; }
    const image = new Image();
    image.onload = () => { orb.current = image; draw(); };
    image.src = BASE_ICON;
  }, [running, phase, secondsLeft]);

  useEffect(() => () => {
    iconLink()?.setAttribute("href", BASE_ICON);
    document.title = "AXOM";
  }, []);

  return null;
}
