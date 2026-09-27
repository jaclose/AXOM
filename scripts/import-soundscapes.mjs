#!/usr/bin/env node
// Turn your own recordings into soundscape versions:
//
//   npm run soundscapes:import                 # everything in ./soundscapes_import
//   npm run soundscapes:import -- --dir ~/Music/focus --seconds 240
//
// Each file (audio or video) is matched to a preset by name — "40 Hz",
// "20 Hz", "10 Hz"/"alpha", "2 Hz"/"delta", "brown", "rain" — or by an
// explicit prefix: `gamma-40__my file.mp3`. The tool skips the intro, cuts a
// segment, bakes a seamless crossfade loop (the end flows into the start),
// normalizes loudness to sit with the synthesized versions, keeps stereo
// intact (binaural beats depend on it), encodes AAC, and registers the result
// in web/src/data/soundscape-recordings.json. Re-running replaces a version.
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
const dir = resolve(option('dir', join(root, 'soundscapes_import')).replace(/^~(?=\/)/, process.env.HOME ?? '~'));
const loopSeconds = Number(option('seconds', '180'));
const crossfade = 4;
const manifestPath = join(root, 'web/src/data/soundscape-recordings.json');
const PRESETS = ['gamma-40', 'beta-20', 'alpha-10', 'delta-2', 'brown-noise', 'soft-rain'];
const MEDIA = /\.(mp3|m4a|aac|wav|flac|ogg|opus|mp4|mov|mkv|webm)$/i;

export function presetFor(name) {
  const explicit = name.match(/^([a-z0-9-]+)__/);
  if (explicit && PRESETS.includes(explicit[1])) return explicit[1];
  const lower = name.toLowerCase();
  if (/\b40\s*hz\b|gamma/.test(lower)) return 'gamma-40';
  if (/\b20\s*hz\b|\bbeta\b/.test(lower)) return 'beta-20';
  if (/\b10\s*hz\b|alpha/.test(lower)) return 'alpha-10';
  if (/\b2\s*hz\b|delta|sleep/.test(lower)) return 'delta-2';
  if (/brown/.test(lower)) return 'brown-noise';
  if (/rain|storm|thunder/.test(lower)) return 'soft-rain';
  return null;
}

export function slugFor(name) {
  return basename(name, extname(name)).replace(/^[a-z0-9-]+__/, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'recording';
}

function duration(file) {
  return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }));
}

function importFile(file) {
  const name = basename(file);
  const preset = presetFor(name);
  if (!preset) return { name, skipped: 'no preset in the name (prefix it like gamma-40__name.mp3)' };
  const total = duration(file);
  const length = Math.min(loopSeconds, Math.max(20, total - crossfade - 1));
  // Skip intros/outros: start a quarter of the way in when there is room.
  const start = total > length + crossfade + 60 ? Math.floor(total * 0.25) : 0;
  const slug = slugFor(name);
  const relative = `soundscapes/${preset}/${slug}.m4a`;
  const out = join(root, 'web/public', relative);
  mkdirSync(dirname(out), { recursive: true });
  // O(t) = S(t) for t ∈ [X, L); for t ∈ [0, X) the head fades in while the
  // audio just past the end (S(L+t)) fades out — so O wraps without a seam.
  const filter = [
    `[0:a]aformat=sample_rates=44100:channel_layouts=stereo,asplit=3[a][b][c]`,
    `[a]atrim=0:${crossfade},asetpts=PTS-STARTPTS,afade=t=in:d=${crossfade}[head]`,
    `[b]atrim=${length}:${length + crossfade},asetpts=PTS-STARTPTS,afade=t=out:d=${crossfade}[tail]`,
    `[head][tail]amix=inputs=2:normalize=0[joined]`,
    `[c]atrim=${crossfade}:${length},asetpts=PTS-STARTPTS[body]`,
    `[joined][body]concat=n=2:v=0:a=1,loudnorm=I=-26:TP=-3:LRA=11[out]`,
  ].join(';');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(start), '-t', String(length + crossfade + 0.5), '-i', file,
    '-filter_complex', filter, '-map', '[out]', '-ac', '2', '-ar', '44100', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out], { stdio: 'inherit' });
  return { name, preset, id: `rec-${slug}`, src: relative, seconds: length, bytes: statSync(out).size };
}

function main() {
  if (!existsSync(dir)) throw new Error(`No folder at ${dir}`);
  const files = readdirSync(dir).filter((name) => MEDIA.test(name)).map((name) => join(dir, name));
  if (!files.length) {
    console.log(`Nothing to import in ${dir}. Drop audio or video files there (e.g. "40 Hz study.mp3").`);
    return;
  }
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : [];
  for (const file of files) {
    const result = importFile(file);
    if (result.skipped) {
      console.log(`skip  ${result.name}: ${result.skipped}`);
      continue;
    }
    const label = basename(result.name, extname(result.name)).replace(/^[a-z0-9-]+__/, '').replace(/[_]+/g, ' ').slice(0, 40);
    const entry = { preset: result.preset, id: result.id, label, description: `Your recording, looped from ${Math.round(result.seconds / 60)} min.`, src: result.src, gain: 0.9, source: result.name };
    const index = manifest.findIndex((item) => item.preset === entry.preset && item.id === entry.id);
    if (index >= 0) manifest[index] = entry; else manifest.push(entry);
    console.log(`ok    ${result.name} → ${result.preset} (${(result.bytes / 1_048_576).toFixed(1)} MB, ${result.seconds}s loop)`);
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Registered ${manifest.length} recording(s) in web/src/data/soundscape-recordings.json.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
