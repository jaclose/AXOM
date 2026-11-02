#!/usr/bin/env node
// Original AXOM composition. Deterministic synthesis; no samples or third-party audio.
// Run: node scripts/generate-axom-afterlight.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'web/public/soundscapes/axom-original/afterlight.m4a');
const sampleRate = 22_050;
const seconds = 120;
const samples = sampleRate * seconds;
const pcm = Buffer.alloc(samples * 4);
const tau = Math.PI * 2;
const chords = [
  [146.83, 220, 261.63, 329.63], // Dm9
  [116.54, 174.61, 220, 293.66], // B♭maj7
  [174.61, 261.63, 329.63, 440], // Fmaj7
  [130.81, 196, 293.66, 329.63], // Cadd9
];
const bellNotes = [587.33, 440, 392, 329.63, 523.25, 440, 349.23, 293.66,
  587.33, 523.25, 440, 349.23, 392, 329.63, 293.66, 440,
  698.46, 587.33, 523.25, 440, 392, 349.23, 329.63, 293.66];

function chordWeight(t, center) {
  const distance = Math.abs((((t - center) + seconds * 1.5) % seconds) - seconds / 2);
  if (distance <= 11) return 1;
  if (distance >= 19) return 0;
  return (1 + Math.cos(Math.PI * (distance - 11) / 8)) / 2;
}

let seed = 0x41584f4d;
let air = 0;
for (let i = 0; i < samples; i += 1) {
  const t = i / sampleRate;
  let pad = 0;
  for (let c = 0; c < chords.length; c += 1) {
    const weight = chordWeight(t, c * 30 + 15);
    if (weight === 0) continue;
    for (const hz of chords[c]) {
      const breath = 0.78 + 0.22 * Math.sin(tau * (0.045 + c * 0.004) * t);
      pad += weight * breath * (Math.sin(tau * hz * t) + 0.16 * Math.sin(tau * hz * 2 * t)) * 0.022;
    }
  }
  const note = Math.floor(t / 5);
  const elapsed = t - note * 5;
  const bellHz = bellNotes[note % bellNotes.length];
  const bellEnvelope = Math.exp(-elapsed * 1.7) * (1 - Math.exp(-elapsed * 24));
  const bell = bellEnvelope * (Math.sin(tau * bellHz * t) + 0.34 * Math.sin(tau * bellHz * 2.01 * t)) * 0.052;
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  air = 0.985 * air + 0.015 * ((seed / 4294967296) * 2 - 1);
  const edge = Math.min(1, t / 2.4, (seconds - t) / 2.4);
  const pan = 0.09 * Math.sin(tau * 0.031 * t);
  const left = (pad * (1 + pan) + bell * 0.95 + air * 0.012) * edge;
  const right = (pad * (1 - pan) + bell * 0.75 + air * 0.013) * edge;
  pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left)) * 32767), i * 4);
  pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right)) * 32767), i * 4 + 2);
}

const wav = Buffer.alloc(44);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + pcm.length, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 4, 28);
wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(pcm.length, 40);
const work = mkdtempSync(join(tmpdir(), 'axom-afterlight-'));
try {
  const source = join(work, 'afterlight.wav');
  writeFileSync(source, Buffer.concat([wav, pcm]));
  mkdirSync(dirname(output), { recursive: true });
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', source, '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', output], { stdio: 'inherit' });
  console.log(`Wrote ${output}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
