#!/usr/bin/env node
// Turn video clips into soundscape scenes: silent, seamless, lightweight loops.
//
//   npm run scenes:import                              # ./soundscapes_import/scenes (personal)
//   npm run scenes:import -- --dir <folder> --map meta.json --publish
//
// Each clip is trimmed to at most --seconds (default 12), its end is
// crossfaded into its start so the loop has no seam, it is scaled to 720p
// (H.264, no audio, faststart) and a poster frame is written beside it.
// PERSONAL imports (default) go to web/public/scenes/personal + a gitignored
// manifest; --publish writes the shipped manifest (only for footage you may
// redistribute, e.g. Pixabay/Pexels/Mixkit or your own).
//
// --map points at JSON: { "<file name>": { "id", "label", "mood": "calm"|"serious"|"fun", "credit" } }.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const expand = (path) => resolve(path.replace(/^~(?=\/)/, process.env.HOME ?? '~'));
const dir = expand(option('dir', join(root, 'soundscapes_import/scenes')));
const maxSeconds = Number(option('seconds', '12'));
const publish = args.includes('--publish');
const mapPath = option('map', '');
const meta = mapPath ? JSON.parse(readFileSync(expand(mapPath), 'utf8')) : {};
const manifestPath = join(root, publish ? 'web/src/data/scenes.json' : 'web/src/data/scenes.personal.json');
const publicBase = publish ? 'scenes' : 'scenes/personal';
const VIDEO = /\.(mp4|mov|m4v|webm|mkv)$/i;
const FADE = 1;

export function slugFor(name) {
  return basename(name, extname(name)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'scene';
}

function probe(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file], { encoding: 'utf8' });
  const json = JSON.parse(out);
  return { duration: Number(json.format?.duration ?? 0), width: json.streams?.[0]?.width ?? 0, height: json.streams?.[0]?.height ?? 0 };
}

function importClip(file) {
  const name = basename(file);
  const info = probe(file);
  if (!info.duration || !info.width) return { name, skipped: 'not a readable video (encrypted or incomplete?)' };
  const entry = meta[name] ?? {};
  const id = entry.id ?? slugFor(name);
  const length = Math.max(2, Math.min(maxSeconds, info.duration - FADE - 0.1));
  // Take the loop from the middle of long clips (intros/outros are rarely loopable).
  const start = info.duration > length + FADE + 4 ? Math.max(0, (info.duration - length - FADE) / 2) : 0;
  const out = join(root, 'web/public', publicBase, `${id}.mp4`);
  const poster = join(root, 'web/public', publicBase, `${id}.jpg`);
  mkdirSync(dirname(out), { recursive: true });
  // O = S[F, L) then a crossfade from S[L, L+F) into S[0, F): the last frame
  // flows into the first, so <video loop> has no visible jump.
  const scale = "scale='min(1280,iw)':-2:flags=lanczos,fps=24,format=yuv420p";
  const filter = [
    `[0:v]${scale},split=3[a][b][c]`,
    `[a]trim=${FADE}:${length},setpts=PTS-STARTPTS[body]`,
    `[b]trim=${length}:${length + FADE},setpts=PTS-STARTPTS[tail]`,
    `[c]trim=0:${FADE},setpts=PTS-STARTPTS[head]`,
    `[tail][head]xfade=transition=fade:duration=${FADE}:offset=0[joint]`,
    `[body][joint]concat=n=2:v=1:a=0[out]`,
  ].join(';');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(start), '-t', String(length + FADE + 0.2), '-i', file,
    '-filter_complex', filter, '-map', '[out]', '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-profile:v', 'high',
    '-movflags', '+faststart', out], { stdio: 'inherit' });
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', out, '-frames:v', '1', '-q:v', '4', poster], { stdio: 'inherit' });
  return {
    name, bytes: statSync(out).size,
    entry: {
      id,
      label: entry.label ?? basename(name, extname(name)).replace(/[_-]+/g, ' ').slice(0, 40),
      mood: entry.mood ?? 'calm',
      src: `${publicBase}/${id}.mp4`,
      poster: `${publicBase}/${id}.jpg`,
      credit: entry.credit ?? (publish ? undefined : 'Your file'),
      seconds: Math.round(length * 10) / 10,
    },
  };
}

function main() {
  if (!existsSync(dir)) throw new Error(`No folder at ${dir}`);
  const files = readdirSync(dir).filter((file) => VIDEO.test(file)).sort().map((file) => join(dir, file));
  if (!files.length) {
    console.log(`Nothing to import in ${dir}. Drop .mp4/.mov clips there.`);
    return;
  }
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : [];
  for (const file of files) {
    const result = importClip(file);
    if (result.skipped) { console.log(`skip  ${result.name}: ${result.skipped}`); continue; }
    const index = manifest.findIndex((item) => item.id === result.entry.id);
    if (index >= 0) manifest[index] = result.entry; else manifest.push(result.entry);
    console.log(`ok    ${result.name} → ${result.entry.src} (${(result.bytes / 1_048_576).toFixed(1)} MB, ${result.entry.seconds}s loop)`);
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Registered ${manifest.length} scene(s) in ${manifestPath.slice(root.length + 1)}${publish ? '' : ' (personal — gitignored)'}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
