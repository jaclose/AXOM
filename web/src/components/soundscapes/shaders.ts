// ===========================================================================
// GPU soundscape visuals. One shared, hidden WebGL2 canvas renders any
// visual and copies the frame into the requesting 2D canvas, so a page with
// many visuals never approaches the browser's WebGL context limit and a lost
// context is recovered in one place. All motion is slow: no luminance change
// repeats faster than ~0.5 Hz (WCAG 2.3.1), including on 40 Hz presets.
// ===========================================================================
import type { SoundscapeVisual } from "../../lib/soundscapes/presets";

const HEADER = `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_level;
uniform vec3 u_accent;
uniform vec3 u_cool;
uniform vec3 u_hi;
out vec4 outColor;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 r = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = r * p * 2.02 + 17.0; a *= 0.5; }
  return v;
}
vec3 finish(vec3 c, vec2 uv) {
  float vig = smoothstep(1.25, 0.25, length((uv - 0.5) * vec2(1.25, 1.0)));
  c *= mix(0.55, 1.0, vig);
  c += (hash(gl_FragCoord.xy) - 0.5) * 0.018; // static grain: dithers banding, never flickers
  return c;
}
`;

const SHADERS: Record<SoundscapeVisual, string> = {
  // 40 Hz — interference of three slow sources, drawn as thin glowing
  // contour lines (a topographic map of the field) over a soft haze.
  lattice: `
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  float t = u_time * 0.1;
  vec2 a = vec2(sin(t * 0.9) * 0.55, cos(t * 0.7) * 0.28);
  vec2 b = vec2(cos(t * 0.6 + 2.0) * 0.6, sin(t * 0.8 + 1.0) * 0.32);
  vec2 c = vec2(sin(t * 0.5 + 4.0) * 0.4, cos(t * 0.4 + 3.0) * 0.36);
  float k = 15.0 + u_level * 1.5;
  float v = (sin(length(p - a) * k - u_time * 0.35) + sin(length(p - b) * k * 1.07 - u_time * 0.31) + sin(length(p - c) * k * 0.93 - u_time * 0.27)) / 3.0;
  float bands = v * 5.0;
  float d = abs(fract(bands) - 0.5) / max(fwidth(bands), 1e-4);
  float line = 1.0 - clamp(d - 0.5, 0.0, 1.0);
  float glow = exp(-d * 0.18);
  float haze = fbm(p * 1.8 + vec2(t, -t * 0.7));
  vec3 base = vec3(0.012, 0.014, 0.024) + u_cool * haze * 0.09;
  vec3 tint = mix(u_cool, u_accent, 0.5 + 0.5 * sin(v * 3.0 + t * 2.0));
  float strength = 0.35 + 0.65 * smoothstep(-0.2, 0.9, abs(v));
  vec3 col = base + tint * (line * 0.55 + glow * 0.16) * strength;
  col += u_hi * exp(-dot(p, p) * 5.0) * (0.12 + u_level * 0.12);
  outColor = vec4(finish(col, uv), 1.0);
}`,
  // 20 Hz — aurora ribbons on domain-warped noise.
  flow: `
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  float t = u_time * 0.07;
  vec2 q = vec2(fbm(p * 1.4 + vec2(0.0, t)), fbm(p * 1.4 + vec2(5.2, -t)));
  vec2 r = vec2(fbm(p * 1.8 + 3.0 * q + vec2(1.7, 9.2) + t * 0.6), fbm(p * 1.8 + 3.0 * q + vec2(8.3, 2.8) - t * 0.4));
  float f = fbm(p * 1.6 + 2.5 * r);
  vec3 col = mix(vec3(0.008, 0.01, 0.02), u_cool * 0.16, f * f);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float y = p.y + 0.22 - fi * 0.2 + 0.16 * sin(p.x * 2.1 + t * (3.0 + fi) + r.x * 2.2);
    float ribbon = exp(-pow(y * (11.0 + fi * 3.0), 2.0));
    float curtain = smoothstep(0.0, 0.35, y + 0.35) * exp(-max(y, 0.0) * 6.0) * 0.35;
    vec3 hue = mix(u_accent, u_cool, smoothstep(-0.7, 0.7, p.x + r.y - 0.5 + fi * 0.3));
    col += hue * (ribbon * (0.38 - fi * 0.07) + curtain * ribbon * 0.4) * (0.85 + u_level * 0.2);
    col += u_hi * pow(ribbon, 6.0) * 0.12;
  }
  outColor = vec4(finish(col, uv), 1.0);
}`,
  // 10 Hz — a breathing orb (4 s in, 6 s out) with bloom and soft rays.
  breath: `
float breathe(float t) { float c = mod(t, 10.0); return c < 4.0 ? 0.5 - 0.5 * cos(3.14159 * c / 4.0) : 0.5 + 0.5 * cos(3.14159 * (c - 4.0) / 6.0); }
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  float b = breathe(u_time);
  float r = length(p);
  float radius = 0.16 + 0.07 * b;
  float core = smoothstep(radius, radius * 0.2, r);
  float bloom = exp(-r * r / (0.07 + 0.06 * b)) * 0.9;
  float ang = atan(p.y, p.x);
  float rays = pow(fbm(vec2(ang * 3.0, u_time * 0.05)), 3.0) * exp(-r * 2.2) * 0.8;
  float halo = 0.0;
  for (int i = 1; i <= 3; i++) {
    float hr = radius * (1.0 + float(i) * 0.55) * (0.9 + 0.12 * b);
    halo += exp(-pow((r - hr) * 90.0, 2.0)) * (0.28 - float(i) * 0.06);
  }
  vec3 col = mix(vec3(0.012, 0.014, 0.024), u_cool * 0.12, fbm(p * 2.0 + u_time * 0.02));
  col += u_accent * bloom * 0.55 + u_hi * core * 0.85 + u_cool * rays + u_hi * halo;
  outColor = vec4(finish(col, uv), 1.0);
}`,
  // 2 Hz — a deep night ocean under a low moon, swells rolling slowly.
  tide: `
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  float t = u_time * 0.05;
  float horizon = 0.12;
  vec3 sky = mix(vec3(0.006, 0.008, 0.018), u_cool * 0.1, smoothstep(0.6, horizon, p.y));
  sky += u_hi * exp(-pow(p.y - horizon, 2.0) * 60.0) * 0.08;
  vec2 moon = vec2(0.35, 0.36);
  sky += u_hi * (smoothstep(0.055, 0.05, length(p - moon)) * 0.55 + exp(-length(p - moon) * 9.0) * 0.12);
  vec3 col = sky;
  if (p.y < horizon) {
    float depth = (horizon - p.y);
    float swell = fbm(vec2(p.x * 3.0 / (depth + 0.15) + t * 2.0, depth * 12.0 - t * 3.0));
    vec3 water = mix(u_cool * 0.16, vec3(0.004, 0.006, 0.014), smoothstep(0.0, 0.5, depth));
    water += u_accent * swell * 0.05;
    // Moonlight scattered on the swells: a soft, slowly shimmering column.
    float column = exp(-pow((p.x - moon.x) * (3.0 + depth * 6.0), 2.0));
    float shimmer = smoothstep(0.55, 0.85, fbm(vec2(p.x * 18.0, depth * 60.0 - t * 5.0)));
    water += u_hi * column * shimmer * (0.5 - depth * 0.5) * (0.8 + u_level * 0.3);
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float crestY = horizon - 0.1 - fi * 0.13 + 0.03 * sin(p.x * (2.5 + fi) + t * (5.0 - fi) + fi * 2.0);
      water += u_cool * exp(-pow((p.y - crestY) * 70.0, 2.0)) * (0.1 - fi * 0.02);
    }
    col = water;
  }
  outColor = vec4(finish(col, uv), 1.0);
}`,
  // Brown noise — slow nebula clouds with drifting dust.
  grain: `
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  float t = u_time * 0.035;
  float n1 = fbm(p * 1.3 + vec2(t, -t * 0.6));
  float n2 = fbm(p * 2.4 - vec2(t * 0.7, t) + n1 * 1.5);
  vec3 col = vec3(0.012, 0.01, 0.012);
  col += u_accent * smoothstep(0.45, 0.9, n2) * 0.42;
  col += u_cool * smoothstep(0.5, 1.0, n1) * 0.28;
  col += u_hi * pow(max(0.0, n1 * n2 - 0.25), 2.0) * 0.8;
  vec2 g = p * 40.0 + vec2(u_time * 0.12, u_time * 0.05);
  vec2 id = floor(g);
  float dust = step(0.97, hash(id)) * smoothstep(0.3, 0.0, length(fract(g) - 0.5));
  col += u_hi * dust * 0.4;
  outColor = vec4(finish(col, uv), 1.0);
}`,
  // Rain — streaks on dark glass over soft bokeh.
  rain: `
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  vec3 col = vec3(0.01, 0.012, 0.018);
  for (int i = 0; i < 12; i++) {
    float fi = float(i);
    vec2 c = vec2(hash(vec2(fi, 1.3)) * 2.0 - 1.0, hash(vec2(fi, 7.1)) * 1.2 - 0.6) * vec2(u_res.x / u_res.y * 0.5, 0.5);
    c.x += 0.03 * sin(u_time * 0.07 + fi);
    float d = length(p - c);
    float size = 0.06 + hash(vec2(fi, 3.3)) * 0.1;
    col += mix(u_accent, u_cool, hash(vec2(fi, 9.9))) * smoothstep(size, size * 0.6, d) * 0.14;
  }
  vec2 s = vec2(p.x * 60.0 + p.y * 4.0, p.y);
  float column = floor(s.x);
  float speed = 0.35 + hash(vec2(column, 2.0)) * 0.35;
  float y = fract(p.y * 0.8 + u_time * speed + hash(vec2(column, 5.0)));
  float streak = smoothstep(0.12, 0.0, y) * smoothstep(0.5, 0.2, abs(fract(s.x) - 0.5)) * step(0.55, hash(vec2(column, 8.0)));
  col += u_hi * streak * 0.4;
  vec2 g = p * vec2(18.0, 12.0);
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5 + 0.3 * (vec2(hash(id), hash(id + 3.0)) - 0.5);
  float drop = smoothstep(0.09, 0.05, length(f * vec2(1.0, 0.8))) * step(0.72, hash(id + 11.0));
  col += (u_hi * 0.35 + u_cool * 0.2) * drop;
  outColor = vec4(finish(col, uv), 1.0);
}`,
};

const VERTEX = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

export interface ShaderUniforms {
  time: number;
  level: number;
  accent: [number, number, number];
  cool: [number, number, number];
  hi: [number, number, number];
}

type Program = { program: WebGLProgram; uniforms: Record<string, WebGLUniformLocation | null> };

class SharedShaderRenderer {
  private canvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private programs = new Map<SoundscapeVisual, Program | null>();
  private failed = false;

  private context(): WebGL2RenderingContext | null {
    if (this.failed) return null;
    if (this.gl && !this.gl.isContextLost()) return this.gl;
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: "low-power" });
      if (!gl) { this.failed = true; return null; }
      canvas.addEventListener("webglcontextlost", (event) => { event.preventDefault(); this.gl = null; this.programs.clear(); });
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      this.canvas = canvas;
      this.gl = gl;
      this.programs.clear();
      return gl;
    } catch {
      this.failed = true;
      return null;
    }
  }

  private program(gl: WebGL2RenderingContext, visual: SoundscapeVisual): Program | null {
    if (this.programs.has(visual)) return this.programs.get(visual)!;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.warn(`[AXOM] ${visual} shader failed`, gl.getShaderInfoLog(shader));
        return null;
      }
      return shader;
    };
    const vertex = compile(gl.VERTEX_SHADER, VERTEX);
    const fragment = compile(gl.FRAGMENT_SHADER, HEADER + SHADERS[visual]);
    let result: Program | null = null;
    if (vertex && fragment) {
      const program = gl.createProgram()!;
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.bindAttribLocation(program, 0, "a_pos");
      gl.linkProgram(program);
      if (gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const uniforms: Program["uniforms"] = {};
        for (const name of ["u_res", "u_time", "u_level", "u_accent", "u_cool", "u_hi"]) uniforms[name] = gl.getUniformLocation(program, name);
        result = { program, uniforms };
      }
    }
    this.programs.set(visual, result);
    return result;
  }

  /** Render `visual` at width×height device pixels into `target`. False = use the 2D fallback. */
  draw(visual: SoundscapeVisual, width: number, height: number, uniforms: ShaderUniforms, target: CanvasRenderingContext2D): boolean {
    const gl = this.context();
    if (!gl || !this.canvas) return false;
    const entry = this.program(gl, visual);
    if (!entry) return false;
    if (this.canvas.width < width || this.canvas.height < height) {
      this.canvas.width = Math.max(this.canvas.width, width);
      this.canvas.height = Math.max(this.canvas.height, height);
    }
    gl.viewport(0, 0, width, height);
    gl.useProgram(entry.program);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const u = entry.uniforms;
    gl.uniform2f(u.u_res, width, height);
    gl.uniform1f(u.u_time, uniforms.time);
    gl.uniform1f(u.u_level, uniforms.level);
    gl.uniform3fv(u.u_accent, uniforms.accent);
    gl.uniform3fv(u.u_cool, uniforms.cool);
    gl.uniform3fv(u.u_hi, uniforms.hi);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // The frame sits in the bottom-left of the (possibly larger) GL canvas.
    target.drawImage(this.canvas as HTMLCanvasElement, 0, this.canvas.height - height, width, height, 0, 0, target.canvas.width, target.canvas.height);
    return true;
  }
}

export const shaderRenderer = new SharedShaderRenderer();

/** "200,169,106" → [0.78, 0.66, 0.42] */
export function rgbChannels(value: string): [number, number, number] {
  const parts = value.split(",").map((part) => Number(part.trim()) / 255);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}
