#!/usr/bin/env node
// Drop a rendered film (Higgsfield, Blender, anything ffmpeg reads) into AXOM:
//
//   npm run cinematic:import -- ~/Downloads/render.mp4 --id wordmark-2s [--final] [--as-is]
//
// Transcodes to a small web/desktop-safe H.264 file (≤1920 px, ≤60 fps, no
// audio, fast start). --as-is keeps a finished H.264 master untouched (only a
// lossless remux when it lacks fast start or carries audio). Then it writes a
// poster, measures the edge color (so letterboxing never shows a seam), the
// duration and how the film ends ("black" or "hold" on its last frame), and
// updates web/src/data/cinematics.json. --final clears the placeholder flag.
// New film ids also need a label in FILM_COPY (web/src/lib/cinematics.ts).
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs';
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
const probe = (file, entries) => execFileSync('ffprobe', ['-v', 'error', '-show_entries', entries, '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim();
if (args.includes('--as-is')) {
  const [codec, pixFmt] = probe(input, 'stream=codec_name,pix_fmt').split('\n')[0].split(',');
  if (codec !== 'h264' || pixFmt !== 'yuv420p') throw new Error(`--as-is needs an H.264 yuv420p master (got ${codec} ${pixFmt}).`);
  if (fastStart(input) && !probe(input, 'stream=codec_type').includes('audio')) copyFileSync(input, join(publicDir, src));
  else ffmpeg(['-i', input, '-an', '-c:v', 'copy', '-movflags', '+faststart', join(publicDir, src)]);
} else {
  ffmpeg(['-i', input, '-an', '-vf', "scale='min(1920,iw)':-2,fps=fps='min(60,source_fps)'", '-c:v', 'libx264', '-profile:v', 'high',
    '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'slow', '-movflags', '+faststart', join(publicDir, src)]);
}
const durationMs = Math.round(Number(probe(join(publicDir, src), 'format=duration')) * 1000);
// A film that fades to black can hand over straight to the app; one that holds
// its last frame (a lockup) needs the player to take it to black first.
const lastLuma = lastFrameLuma(join(publicDir, src));
const exit = lastLuma <= 40 ? 'black' : 'hold';
// Posters double as Settings thumbnails, so never use a black frame.
const posterAt = exit === 'black' ? ['-ss', String((durationMs * 0.75) / 1000)] : ['-sseof', '-0.05'];
ffmpeg([...posterAt, '-i', join(publicDir, src), '-frames:v', '1', '-vf', 'scale=960:-2', '-q:v', '3', join(publicDir, poster)]);
const edge = ffmpeg(['-sseof', '-0.05', '-i', join(publicDir, src), '-frames:v', '1', '-vf', 'crop=4:4:8:8,scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
const background = `#${[...edge.subarray(0, 3)].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
if (!(durationMs > 300 && durationMs < 8000)) throw new Error(`A ${durationMs} ms film is outside the 0.3–8 s range an opening film should have.`);

manifest[id] = { ...existing, src, poster, background, durationMs, exit, placeholder: args.includes('--final') ? false : existing?.placeholder ?? true };
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
const kb = Math.round(statSync(join(publicDir, src)).size / 1024);
console.log(`${id}: ${src} (${kb} KB, ${durationMs} ms, edge ${background}, ends ${exit})${manifest[id].placeholder ? ' — still marked placeholder; pass --final for a finished render' : ''}`);
if (!existing) console.log(`New film id "${id}": add it to CinematicId, FILM_COPY and INTRO_FILM_ORDER in web/src/lib/cinematics.ts.`);

/** True when the moov atom precedes mdat (plays before it fully downloads). */
function fastStart(file) {
  const fd = openSync(file, 'r');
  const header = Buffer.alloc(16);
  let offset = 0;
  const size = statSync(file).size;
  while (offset + 8 <= size) {
    readSync(fd, header, 0, 16, offset);
    let box = header.readUInt32BE(0);
    const type = header.toString('latin1', 4, 8);
    if (type === 'moov') return true;
    if (type === 'mdat') return false;
    if (box === 1) box = Number(header.readBigUInt64BE(8));
    if (box < 8) return false;
    offset += box;
  }
  return false;
}

/** Peak brightness (0–255) of the final frame; signalstats reports on stderr. */
function lastFrameLuma(file) {
  const run = spawnSync('ffmpeg', ['-hide_banner', '-sseof', '-0.05', '-i', file, '-frames:v', '1', '-vf', 'format=gray,signalstats,metadata=print:key=lavfi.signalstats.YMAX', '-f', 'null', '-'], { encoding: 'utf8' });
  return Number(run.stderr.match(/YMAX=(\d+)/)?.[1] ?? 255);
}
