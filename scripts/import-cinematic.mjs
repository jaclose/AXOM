#!/usr/bin/env node
// Drop a rendered film (Higgsfield, Blender, anything ffmpeg reads) into AXOM:
//
//   npm run cinematic:import -- ~/Downloads/render.mp4 --id slow-sweep [--final]
//
// Transcodes to a small web/desktop-safe H.264 file (≤1920 px, ≤60 fps, no
// audio, fast start), writes a poster from the settled last frame, measures
// the edge color (so letterboxing never shows a seam) and the duration, then
// updates web/src/data/cinematics.json. --final clears the placeholder flag.
// New film ids also need a label in FILM_COPY (web/src/lib/cinematics.ts).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, 'web/src/data/cinematics.json');
const args = process.argv.slice(2);
const input = args.find((arg) => !arg.startsWith('--') && args[args.indexOf(arg) - 1] !== '--id');
const id = args[args.indexOf('--id') + 1];
if (!input || !existsSync(input) || args.indexOf('--id') < 0 || !/^[a-z0-9-]{2,40}$/.test(id ?? '')) {
  throw new Error('Usage: npm run cinematic:import -- <video file> --id <film-id> [--final]');
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const existing = manifest[id];
const src = existing?.src ?? `cinematics/${id}.mp4`;
const poster = existing?.poster?.endsWith('.jpg') ? existing.poster : `cinematics/${id}-poster.jpg`;
const publicDir = join(root, 'web/public');
mkdirSync(join(publicDir, dirname(src)), { recursive: true });

const ffmpeg = (argv, options = {}) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...argv], { maxBuffer: 1 << 26, ...options });
ffmpeg(['-i', input, '-an', '-vf', "scale='min(1920,iw)':-2,fps=fps='min(60,source_fps)'", '-c:v', 'libx264', '-profile:v', 'high',
  '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'slow', '-movflags', '+faststart', join(publicDir, src)]);
ffmpeg(['-sseof', '-0.05', '-i', join(publicDir, src), '-frames:v', '1', '-vf', 'scale=960:-2', '-q:v', '3', join(publicDir, poster)]);
const durationMs = Math.round(Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(publicDir, src)], { encoding: 'utf8' })) * 1000);
const edge = ffmpeg(['-sseof', '-0.05', '-i', join(publicDir, src), '-frames:v', '1', '-vf', 'crop=4:4:8:8,scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
const background = `#${[...edge.subarray(0, 3)].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
if (!(durationMs > 300 && durationMs < 8000)) throw new Error(`A ${durationMs} ms film is outside the 0.3–8 s range an opening film should have.`);

manifest[id] = { src, poster, background, durationMs, placeholder: args.includes('--final') ? false : existing?.placeholder ?? true };
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
const kb = Math.round(statSync(join(publicDir, src)).size / 1024);
console.log(`${id}: ${src} (${kb} KB, ${durationMs} ms, edge ${background})${manifest[id].placeholder ? ' — still marked placeholder; pass --final for a finished render' : ''}`);
if (!existing) console.log(`New film id "${id}": add it to CinematicId, FILM_COPY and INTRO_FILM_ORDER in web/src/lib/cinematics.ts.`);
