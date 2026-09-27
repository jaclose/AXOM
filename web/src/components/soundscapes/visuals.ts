import type { SoundscapeVisual } from "../../lib/soundscapes/presets";

export interface VisualColors {
  accent: string; // "r,g,b"
  cool: string;
  hi: string;
}

export interface FrameInput {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  /** Seconds. Every motion below completes a cycle in ≥ 2 s: no flashing. */
  t: number;
  /** Smoothed audio level, 0–1 (0 when silent or paused). */
  level: number;
  colors: VisualColors;
}

const TAU = Math.PI * 2;

/** Deterministic pseudo-random sequence so particles never jump between frames. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const PARTICLES = (() => {
  const random = seeded(20260926);
  return Array.from({ length: 160 }, () => ({ x: random(), y: random(), s: random(), p: random() * TAU }));
})();

function lattice({ ctx, width, height, t, level, colors }: FrameInput) {
  const spacing = Math.max(7, Math.min(width, height) / 38) * (1 + level * 0.08);
  const maxR = Math.hypot(width, height);
  const centers = [
    [width * (0.5 + 0.16 * Math.cos(t * 0.07)), height * (0.5 + 0.12 * Math.sin(t * 0.05))],
    [width * (0.5 - 0.16 * Math.cos(t * 0.06 + 1)), height * (0.5 - 0.12 * Math.sin(t * 0.045 + 2))],
  ];
  ctx.lineWidth = 1;
  centers.forEach(([cx, cy], index) => {
    ctx.strokeStyle = `rgba(${index ? colors.cool : colors.accent}, ${0.16 + level * 0.06})`;
    for (let r = spacing; r < maxR; r += spacing) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.stroke();
    }
  });
  const glow = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(width, height) * 0.55);
  glow.addColorStop(0, `rgba(${colors.hi}, 0.10)`);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
}

function flow({ ctx, width, height, t, level, colors }: FrameInput) {
  const ribbons = 7;
  for (let i = 0; i < ribbons; i += 1) {
    const mix = i / (ribbons - 1);
    ctx.strokeStyle = `rgba(${mix < 0.5 ? colors.accent : colors.cool}, ${0.14 + 0.18 * (1 - Math.abs(mix - 0.5) * 2)})`;
    ctx.lineWidth = 1.4 + (1 - Math.abs(mix - 0.5) * 2) * 1.4;
    ctx.beginPath();
    for (let step = 0; step <= 96; step += 1) {
      const x = (step / 96) * width;
      const phase = x / width * TAU * 1.3 + t * (0.22 + i * 0.02) + i * 0.7;
      const amplitude = height * (0.09 + 0.03 * Math.sin(t * 0.1 + i)) * (0.85 + level * 0.3);
      const y = height * (0.3 + mix * 0.4) + Math.sin(phase) * amplitude + Math.sin(phase * 0.5 + t * 0.07) * amplitude * 0.4;
      if (step === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

/** Ten-second breath: 4 s in, 6 s out (about six breaths a minute). */
export function breathPhase(t: number): number {
  const cycle = t % 10;
  const ease = (x: number) => 0.5 - Math.cos(Math.PI * x) / 2;
  return cycle < 4 ? ease(cycle / 4) : 1 - ease((cycle - 4) / 6);
}

function breath({ ctx, width, height, t, level, colors }: FrameInput) {
  const cx = width / 2;
  const cy = height / 2;
  const base = Math.min(width, height) * 0.22;
  const inhale = breathPhase(t);
  for (let ring = 3; ring >= 1; ring -= 1) {
    ctx.strokeStyle = `rgba(${colors.cool}, ${0.05 + 0.05 * (4 - ring) * (0.5 + inhale * 0.5)})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, base * (1 + ring * 0.38) * (0.86 + inhale * 0.18), 0, TAU);
    ctx.stroke();
  }
  const radius = base * (0.72 + inhale * 0.32) * (1 + level * 0.05);
  const orb = ctx.createRadialGradient(cx, cy - radius * 0.2, radius * 0.1, cx, cy, radius);
  orb.addColorStop(0, `rgba(${colors.hi}, 0.55)`);
  orb.addColorStop(0.55, `rgba(${colors.accent}, 0.28)`);
  orb.addColorStop(1, `rgba(${colors.accent}, 0)`);
  ctx.fillStyle = orb;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, TAU);
  ctx.fill();
}

function tide({ ctx, width, height, t, level, colors }: FrameInput) {
  for (const particle of PARTICLES.slice(0, 70)) {
    const y = ((particle.y - t * 0.004 * (0.5 + particle.s)) % 1 + 1) % 1;
    ctx.fillStyle = `rgba(${colors.hi}, ${0.05 + 0.1 * particle.s})`;
    ctx.fillRect(particle.x * width, y * height * 0.7, 1.2, 1.2);
  }
  for (let layer = 0; layer < 4; layer += 1) {
    ctx.fillStyle = `rgba(${layer % 2 ? colors.cool : colors.accent}, ${0.06 + layer * 0.025})`;
    ctx.beginPath();
    ctx.moveTo(0, height);
    for (let step = 0; step <= 64; step += 1) {
      const x = (step / 64) * width;
      const y = height * (0.62 + layer * 0.08)
        + Math.sin(x / width * TAU * (0.8 + layer * 0.2) + t * (0.08 + layer * 0.02) + layer) * height * 0.04 * (1 + level * 0.2);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fill();
  }
}

function grain({ ctx, width, height, t, level, colors }: FrameInput) {
  for (const particle of PARTICLES) {
    const x = ((particle.x + Math.sin(t * 0.05 + particle.p) * 0.04 + t * 0.006 * particle.s) % 1 + 1) % 1;
    const y = ((particle.y + Math.cos(t * 0.04 + particle.p * 1.3) * 0.05) % 1 + 1) % 1;
    const size = 0.8 + particle.s * 1.8 + level * 0.6;
    ctx.fillStyle = `rgba(${particle.s > 0.6 ? colors.accent : colors.hi}, ${0.12 + particle.s * 0.22})`;
    ctx.beginPath();
    ctx.arc(x * width, y * height, size, 0, TAU);
    ctx.fill();
  }
}

function rain({ ctx, width, height, t, colors }: FrameInput) {
  ctx.lineWidth = 1;
  for (const drop of PARTICLES.slice(0, 110)) {
    const speed = 0.18 + drop.s * 0.22;
    const y = ((drop.y + t * speed) % 1.1) - 0.1;
    const x = drop.x * width + y * height * 0.08;
    const length = height * (0.03 + drop.s * 0.05);
    ctx.strokeStyle = `rgba(${drop.s > 0.5 ? colors.cool : colors.hi}, ${0.12 + drop.s * 0.22})`;
    ctx.beginPath();
    ctx.moveTo(x, y * height);
    ctx.lineTo(x + length * 0.08, y * height + length);
    ctx.stroke();
  }
  // Ripples: each bucket of time spawns a few rings that spread and fade.
  const bucket = Math.floor(t / 0.8);
  for (let back = 0; back < 3; back += 1) {
    const random = seeded(bucket - back);
    const age = (t % 0.8) / 0.8 + back;
    for (let i = 0; i < 3; i += 1) {
      const rx = random() * width;
      const ry = height * (0.84 + random() * 0.12);
      ctx.strokeStyle = `rgba(${colors.hi}, ${Math.max(0, 0.18 - age * 0.06)})`;
      ctx.beginPath();
      ctx.ellipse(rx, ry, 4 + age * 16, 1 + age * 3.5, 0, 0, TAU);
      ctx.stroke();
    }
  }
}

export const VISUAL_RENDERERS: Record<SoundscapeVisual, (frame: FrameInput) => void> = { lattice, flow, breath, tide, grain, rain };
