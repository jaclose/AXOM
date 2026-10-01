// The orb at the centre of a soundscape stage: a clear glass sphere inside a
// thin ring, with a corona just outside it. It takes its colours from the
// scene behind it (sampled from the video, image or generative canvas), sits
// dead centre, and answers the sound: bass swells the ring, loudness lights
// it, and the spectrum bends the corona. The ring itself is always a true
// circle. One canvas; it only repaints the square around the orb. Reduced
// motion draws a still frame.
import { useEffect, useRef } from "react";
import { useReducedMotion } from "../../lib/motion";
import { CORONA_WAVES, SILENT, coronaShape, follow, orbPose, readBands } from "../../lib/soundscapes/orbMotion";
import { mixRgb, paletteFromPixels, type Rgb, type ScenePalette } from "../../lib/soundscapes/sceneColors";
import { soundscapeAnalyser } from "../../lib/soundscapes/store";

/** The scene is sampled at this size, this often. */
const SAMPLE_WIDTH = 32;
const SAMPLE_HEIGHT = 18;
const SAMPLE_EVERY_MS = 900;
/** Points around the corona. */
const POINTS = 144;
/** The corona's resting radius, as a multiple of the ring's. */
const CORONA_GAP = 1.11;
/** How far the corona may bend, as a fraction of the ring's radius. */
const CORONA_REACH = 0.058;
/** How fast each corona wave drifts round (radians per second); mixed directions keep it from spinning. */
const CORONA_DRIFT = [0.11, -0.07, 0.16, -0.13, 0.21];
/** The specular highlight never grows past this (CSS px), so a large orb keeps a point of light, not a bead. */
const GLINT_MAX_PX = 9;
const MAX_RATIO = 1.5;
const TAU = Math.PI * 2;
const WHITE: Rgb = [255, 255, 255];

const rgba = (colour: Rgb, alpha: number) => `rgba(${Math.round(colour[0])}, ${Math.round(colour[1])}, ${Math.round(colour[2])}, ${Math.max(0, Math.min(1, alpha))})`;

function parseCssColour(value: string): Rgb | null {
  const parts = value.match(/-?\d+(?:\.\d+)?/g);
  return parts && parts.length >= 3 ? [Number(parts[0]), Number(parts[1]), Number(parts[2])] : null;
}

export function SoundOrb({ active, reactive = false, tint = "rgb(var(--accent-rgb))", size = 46 }: {
  /** The stage is live or being previewed: the orb breathes. */
  active: boolean;
  /** This stage is the one playing: the orb follows the audio. */
  reactive?: boolean;
  /** Colour used until the scene has been sampled (any CSS colour). */
  tint?: string;
  /** Ring diameter as a % of the stage's shorter side. */
  size?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();
  // Read through refs so a play, pause or preset change never restarts the
  // canvas (which would blink the orb out and fade it back in).
  const live = useRef({ active, reactive, tint });
  live.current = { active, reactive, tint };

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    const stage = canvas?.parentElement;
    if (!canvas || !context || !stage) return;

    // --- geometry -------------------------------------------------------------
    // The stylesheet may place and cap the orb (--orb-x / --orb-y as a % of the
    // stage or in px, --orb-max in px), so layout decides where it sits.
    let width = 0;
    let height = 0;
    let ratio = 1;
    let centre: [number, number] = [0, 0];
    let base = 0;
    const along = (value: string, span: number) => {
      const number = Number.parseFloat(value);
      if (!Number.isFinite(number)) return span / 2;
      return value.trim().endsWith("%") ? (span * number) / 100 : number;
    };
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      ratio = Math.min(MAX_RATIO, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      const style = getComputedStyle(canvas);
      centre = [along(style.getPropertyValue("--orb-x"), width), along(style.getPropertyValue("--orb-y"), height)];
      const cap = Number.parseFloat(style.getPropertyValue("--orb-max"));
      const diameter = (Math.min(width, height) * size) / 100;
      base = (Number.isFinite(cap) && cap > 0 ? Math.min(diameter, cap) : diameter) / 2;
    };

    // --- colour: the fallback tint first, then whatever the scene shows ------
    canvas.style.color = live.current.tint;
    const fallback = parseCssColour(getComputedStyle(canvas).color) ?? [200, 169, 106];
    let target: ScenePalette = { primary: fallback, secondary: mixRgb(fallback, WHITE, 0.25), centerLight: 0.1, neutral: false };
    let primary: Rgb = target.primary;
    let secondary: Rgb = target.secondary;
    let light = target.centerLight;
    let sampledOnce = false;
    const sampler = document.createElement("canvas");
    sampler.width = SAMPLE_WIDTH;
    sampler.height = SAMPLE_HEIGHT;
    const samplerContext = sampler.getContext("2d", { willReadFrequently: true });
    const posters = new Map<string, HTMLImageElement>();

    const sampleScene = () => {
      const source = stage.querySelector<HTMLVideoElement | HTMLImageElement | HTMLCanvasElement>(".scene-player, .soundscape-visual");
      if (!source || !samplerContext || width < 1 || height < 1) return;
      let drawable: CanvasImageSource | null = source;
      if (source instanceof HTMLVideoElement && source.readyState < 2) {
        // No frame yet (reduced motion keeps the poster up): read the poster.
        const url = source.poster;
        let poster = url ? posters.get(url) : undefined;
        if (url && !poster) {
          poster = new Image();
          poster.decoding = "async";
          poster.src = url;
          posters.set(url, poster);
        }
        drawable = poster?.complete && poster.naturalWidth > 0 ? poster : null;
      } else if (source instanceof HTMLImageElement && !(source.complete && source.naturalWidth > 0)) {
        drawable = null;
      }
      if (!drawable) return;
      try {
        samplerContext.clearRect(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
        samplerContext.drawImage(drawable, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
        const pixels = samplerContext.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT).data;
        const palette = paletteFromPixels(pixels, SAMPLE_WIDTH, SAMPLE_HEIGHT, { x: centre[0] / width, y: centre[1] / height });
        if (!palette) return;
        target = palette;
        if (!sampledOnce) {
          sampledOnce = true;
          primary = palette.primary;
          secondary = palette.secondary;
          light = palette.centerLight;
        }
      } catch { /* a frame the browser will not let us read: keep the tint */ }
    };

    // --- sound ----------------------------------------------------------------
    const frequency = new Uint8Array(256);
    const waveform = new Uint8Array(256);
    const waves = new Float32Array(CORONA_WAVES.length);
    const phases = Float32Array.from(CORONA_WAVES, (_, index) => index * 1.7);
    let swell = 0;
    let glow = 0;

    let frame = 0;
    let visible = true;
    let lastSample = -Infinity;
    let lastPaint = performance.now();
    const started = performance.now();
    let reveal = reduced ? 1 : 0;

    const paint = (now: number) => {
      if (now - lastSample >= SAMPLE_EVERY_MS) {
        lastSample = now;
        sampleScene();
      }
      const t = (now - started) / 1000;
      const elapsed = Math.min(0.1, Math.max(0, (now - lastPaint) / 1000));
      lastPaint = now;
      const moving = !reduced;
      const { active, reactive } = live.current;
      // Colours ease toward the scene's, so a cut in the video never snaps the orb.
      primary = moving ? mixRgb(primary, target.primary, 0.05) : target.primary;
      secondary = moving ? mixRgb(secondary, target.secondary, 0.05) : target.secondary;
      light = moving ? light + (target.centerLight - light) * 0.05 : target.centerLight;
      const onBright = light > 0.62;
      // A mid-tone scene (pale water, smoke) needs help that a dark one does not.
      const pale = Math.min(1, Math.max(0, (light - 0.2) / 0.42));
      const highlight = onBright ? mixRgb(primary, [0, 0, 0], 0.25) : mixRgb(primary, WHITE, 0.7);

      const analyser = reactive && moving ? soundscapeAnalyser() : null;
      let bands = SILENT;
      if (analyser) {
        const bins = Math.min(frequency.length, analyser.frequencyBinCount);
        analyser.getByteFrequencyData(frequency);
        analyser.getByteTimeDomainData(waveform);
        bands = readBands(frequency.subarray(0, bins), waveform, analyser.context.sampleRate / analyser.fftSize);
      }
      const pose = orbPose(bands);
      swell = follow(swell, pose.swell, 0.3, 0.08);
      // Brightness moves slowly on purpose: it must never flash.
      glow = follow(glow, pose.glow, 0.05, 0.03);
      const shape = coronaShape(bands);
      let energy = 0;
      for (let wave = 0; wave < waves.length; wave += 1) {
        waves[wave] = follow(waves[wave], shape[wave] * pose.ripple, 0.22, 0.05);
        if (moving && active) phases[wave] += CORONA_DRIFT[wave] * elapsed;
        energy += waves[wave];
      }
      if (moving) reveal = Math.min(1, reveal + 0.02);

      const [cx, cy] = centre;
      const breath = moving && active ? Math.sin((t * TAU) / 9) : 0;
      const radius = base * (1 + 0.014 * breath + swell);

      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const reach = base * 2.1;
      context.clearRect(cx - reach, cy - reach, reach * 2, reach * 2);
      if (base < 4) return;
      context.globalAlpha = reveal * (active || reduced ? 1 : 0.72);
      const circle = (r: number) => { context.beginPath(); context.arc(cx, cy, r, 0, TAU); };
      const wash = (gradient: CanvasGradient) => { context.fillStyle = gradient; context.fillRect(cx - reach, cy - reach, reach * 2, reach * 2); };

      // A soft pool of shade behind the orb on pale scenes, so it never reads as a watermark.
      if (!onBright && pale > 0.02) {
        const shade = context.createRadialGradient(cx, cy, radius * 0.5, cx, cy, radius * 2.05);
        shade.addColorStop(0, `rgba(5, 7, 12, ${0.3 * pale})`);
        shade.addColorStop(0.5, `rgba(5, 7, 12, ${0.2 * pale})`);
        shade.addColorStop(1, "rgba(5, 7, 12, 0)");
        wash(shade);
      }
      // Aura: a soft bloom outside the ring that opens with the sound.
      const aura = context.createRadialGradient(cx, cy, radius * 0.9, cx, cy, radius * (1.36 + 0.22 * glow));
      aura.addColorStop(0, rgba(primary, 0));
      aura.addColorStop(0.22, rgba(primary, (onBright ? 0.08 : 0.11) + 0.14 * glow));
      aura.addColorStop(1, rgba(secondary, 0));
      wash(aura);

      // --- the sphere: a clear glass ball -----------------------------------
      // 1. Body: the scene seen through glass is a touch darker, never opaque.
      circle(radius);
      context.fillStyle = `rgba(5, 7, 12, ${onBright ? 0.06 : 0.12})`;
      context.fill();
      // 2. Volume: lit from the upper left, falling into shade at the lower right.
      const volume = context.createRadialGradient(cx - radius * 0.34, cy - radius * 0.4, 0, cx - radius * 0.1, cy - radius * 0.12, radius * 1.22);
      volume.addColorStop(0, rgba(highlight, 0.1 + 0.07 * glow));
      volume.addColorStop(0.45, rgba(primary, 0.04 + 0.04 * glow));
      volume.addColorStop(1, "rgba(3, 4, 8, 0.16)");
      context.fillStyle = volume;
      context.fill();
      // 3. Edge: glass is brightest where you look along its surface.
      const rim = mixRgb(primary, WHITE, 0.45);
      const edge = context.createRadialGradient(cx, cy, radius * 0.64, cx, cy, radius);
      edge.addColorStop(0, rgba(primary, 0));
      edge.addColorStop(0.84, rgba(primary, 0.06 + 0.05 * glow));
      edge.addColorStop(1, rgba(rim, 0.15 + 0.11 * glow));
      context.fillStyle = edge;
      context.fill();
      // 4. Specular: one small, sharp point of light inside a faint bloom. On a
      //    pale scene it is smaller and softer, where a hard white bead would
      //    look stuck on.
      const glint = (reachPx: number, alpha: number) => {
        const x = cx - radius * 0.41;
        const y = cy - radius * 0.45;
        const spot = context.createRadialGradient(x, y, 0, x, y, reachPx);
        spot.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
        spot.addColorStop(0.42, `rgba(255, 255, 255, ${alpha * 0.72})`);
        spot.addColorStop(1, "rgba(255, 255, 255, 0)");
        context.fillStyle = spot;
        context.beginPath();
        context.arc(x, y, reachPx, 0, TAU);
        context.fill();
      };
      glint(radius * 0.24, 0.07 + 0.04 * glow);
      glint(Math.min(GLINT_MAX_PX, radius * 0.062) * (1 - 0.2 * pale), 0.92 - 0.16 * pale);

      // --- the ring: always a true circle -----------------------------------
      context.lineJoin = "round";
      circle(radius);
      // A dark hairline underneath keeps the ring whole on pale or busy scenes.
      context.shadowColor = "rgba(0, 0, 0, 0.55)";
      context.shadowBlur = 7 * ratio;
      context.strokeStyle = "rgba(4, 5, 9, 0.42)";
      context.lineWidth = 3.4;
      context.stroke();
      // Glow.
      context.shadowColor = rgba(primary, 0.9);
      context.shadowBlur = (10 + 22 * glow) * ratio;
      context.strokeStyle = rgba(primary, 0.24 + 0.22 * glow);
      context.lineWidth = 2.4 + 1.4 * glow;
      context.stroke();
      // The line, shading from the scene's first colour to its second.
      context.shadowBlur = 2.5 * ratio;
      let line: string | CanvasGradient = rgba(primary, 0.98);
      if (typeof context.createConicGradient === "function") {
        const sweep = context.createConicGradient(moving && active ? t * 0.1 : -Math.PI / 2, cx, cy);
        sweep.addColorStop(0, rgba(primary, 0.98));
        sweep.addColorStop(0.2, rgba(highlight, 0.98));
        sweep.addColorStop(0.45, rgba(primary, 0.98));
        sweep.addColorStop(0.72, rgba(secondary, 0.95));
        sweep.addColorStop(1, rgba(primary, 0.98));
        line = sweep;
      }
      context.strokeStyle = line;
      context.lineWidth = 1.5 + 0.6 * glow;
      context.stroke();
      context.shadowBlur = 0;

      // --- the corona: the sound itself, drawn just outside the ring ----------
      // A circle bent by a few slow waves. In silence it is a faint true circle;
      // it comes forward, in the ring's own colour, only as the sound does.
      const coronaAlpha = Math.min(onBright || pale > 0.5 ? 0.26 : 0.5, 0.05 + energy * 0.62);
      if (coronaAlpha > 0.02) {
        const coronaAt = (point: number): [number, number] => {
          const angle = (point / POINTS) * TAU;
          let bend = 0;
          for (let wave = 0; wave < waves.length; wave += 1) bend += waves[wave] * Math.cos(CORONA_WAVES[wave] * angle + phases[wave]);
          const r = radius * (CORONA_GAP + CORONA_REACH * bend);
          return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r];
        };
        context.beginPath();
        const [firstX, firstY] = coronaAt(0);
        const [secondX, secondY] = coronaAt(1);
        context.moveTo((firstX + secondX) / 2, (firstY + secondY) / 2);
        for (let point = 1; point <= POINTS; point += 1) {
          const [x, y] = coronaAt(point);
          const [afterX, afterY] = coronaAt(point + 1);
          context.quadraticCurveTo(x, y, (x + afterX) / 2, (y + afterY) / 2);
        }
        context.closePath();
        context.strokeStyle = rgba(mixRgb(primary, WHITE, 0.3), coronaAlpha);
        context.lineWidth = 1;
        context.stroke();
      }
      context.globalAlpha = 1;
    };

    const loop = (now: number) => {
      paint(now);
      if (!reduced && visible && !document.hidden) frame = requestAnimationFrame(loop);
    };
    const restart = () => {
      cancelAnimationFrame(frame);
      lastPaint = performance.now();
      frame = requestAnimationFrame(loop);
    };

    resize();
    paint(performance.now());
    if (!reduced) restart();
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => { resize(); paint(performance.now()); }) : null;
    resizeObserver?.observe(canvas);
    const intersection = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible && !reduced) restart();
    }) : null;
    intersection?.observe(canvas);
    const onVisibility = () => { if (!document.hidden && !reduced) restart(); };
    document.addEventListener("visibilitychange", onVisibility);
    // Still frames (reduced motion) follow the scene too, just without animating.
    const stillTimer = reduced ? window.setInterval(() => paint(performance.now()), SAMPLE_EVERY_MS * 2) : undefined;
    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(stillTimer);
      resizeObserver?.disconnect();
      intersection?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [reduced, size]);

  return <canvas ref={canvasRef} className="sound-orb" aria-hidden="true" />;
}
