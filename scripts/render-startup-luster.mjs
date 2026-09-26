#!/usr/bin/env node
// Optional authoring tool, deliberately separate from normal app/release builds.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const frameDir = join(root, 'build/startup-luster');
const sourceDir = join(root, 'design/startup');
const assets = join(root, 'web/public/startup');
const args = process.argv.slice(2);
if (args.some((arg) => !['--encode-only', '--preview'].includes(arg))) throw new Error('Use --preview or --encode-only, or no arguments for a full render.');
if (args.includes('--preview') && args.includes('--encode-only')) throw new Error('Choose preview or encode-only.');
const blender = process.env.BLENDER_BIN || (existsSync('/Applications/Blender.app/Contents/MacOS/Blender')
  ? '/Applications/Blender.app/Contents/MacOS/Blender' : 'blender');
const ffmpeg = process.env.FFMPEG_BIN || 'ffmpeg';
function run(command, argv) {
  const result = spawnSync(command, argv, { cwd: root, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error?.message || result.status}`);
}
if (!args.includes('--encode-only')) {
  run(blender, ['-b', '--factory-startup', '--python', 'scripts/render-startup-luster.py', '--',
    ...(args.includes('--preview') ? ['--preview', '--samples', '16'] : [])]);
}
if (!args.includes('--preview')) {
  for (let n = 1; n <= 78; n += 1) {
    if (!existsSync(join(frameDir, `frame_${String(n).padStart(4, '0')}.png`))) throw new Error(`Missing frame ${n}; complete the render before encoding.`);
  }
  await mkdir(assets, { recursive: true });
  const movie = join(assets, 'axom-optical-luster.mp4');
  const poster = join(assets, 'axom-optical-luster-poster.png');
  run(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=0x0d0d0e:s=1280x720:r=60:d=1.3',
    '-framerate', '60', '-start_number', '1', '-i', join(frameDir, 'frame_%04d.png'),
    '-filter_complex', '[1:v]fade=t=in:st=0:d=0.15:alpha=1[mark];[0:v][mark]overlay=shortest=1:format=auto,format=yuv420p[out]',
    '-map', '[out]', '-frames:v', '78', '-c:v', 'libx264', '-profile:v', 'high',
    '-crf', '18', '-preset', 'slow', '-movflags', '+faststart', '-an', movie]);
  run(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=0x0d0d0e:s=1280x720',
    '-i', join(frameDir, 'frame_0068.png'), '-filter_complex', '[0:v][1:v]overlay=format=auto',
    '-frames:v', '1', '-update', '1', poster]);
  const manifestPath = join(sourceDir, 'render-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.assets = await Promise.all([movie, poster].map(async (path) => ({
    path: path.slice(root.length + 1), bytes: (await stat(path)).size,
    sha256: createHash('sha256').update(await readFile(path)).digest('hex'),
  })));
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`AXOM startup asset ready: ${movie}`);
}
