#!/usr/bin/env node
/* global process, console, window, document, localStorage */

// Visual snapshots of AXOM routes across themes and accent palettes.
//
//   npm run dev                      # in one terminal (or pass --base-url)
//   npm run snapshots                # default routes × dark/light × classic
//   npm run snapshots -- --routes dashboard,reports --palettes classic,amethyst,sapphire --themes dark,light --seed
//
// Output: web/.snapshots/<route>--<theme>--<palette>.png (+ index.html contact sheet).
// Uses installed Google Chrome when available, otherwise Playwright's Chromium.
// --seed fills an isolated browser profile with synthetic study activity (never your data).

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { completeSetup } from "./setup-flow.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const list = (name, fallback) => option(name, fallback).split(",").map((value) => value.trim()).filter(Boolean);

const baseUrl = option("base-url", process.env.AXOM_E2E_BASE_URL ?? "http://127.0.0.1:5187");
const routes = list("routes", "dashboard,productivity,reports,tracker,leaderboards,integrations,folders,building,appchecker,about,help");
const themes = list("themes", "dark,light");
const palettes = list("palettes", "classic");
const width = Number(option("width", "1440"));
const height = Number(option("height", "1000"));
const out = resolve(option("out", ".snapshots"));
const seed = args.includes("--seed");
const fullPage = args.includes("--full");

async function launch() {
  try {
    return await chromium.launch({ channel: "chrome", headless: true });
  } catch {
    return chromium.launch({ headless: true });
  }
}

async function onboard(page) {
  if (!(await completeSetup(page, "Snapshot Learner", { ifVisible: true }))) return;
  const later = page.getByRole("button", { name: "Review later" });
  if (await later.count()) await later.click();
}

async function seedActivity(page) {
  await page.evaluate(async () => {
    const dev = window.__AXOM_DEV__;
    if (!dev) return;
    const { useStore } = await dev;
    const state = useStore.getState();
    const today = new Date(`${state.activeDayKey}T12:00:00`);
    const types = ["Lecture", "Anki", "Practice questions", "Deep Study", "Reading"];
    const logs = [];
    for (let offset = 0; offset < 40; offset += 1) {
      if (offset % 6 === 5) continue;
      const date = new Date(today);
      date.setDate(today.getDate() - offset);
      const dayKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      for (let index = 0; index < 1 + (offset % 3); index += 1) {
        const type = types[(offset + index) % types.length];
        logs.push({
          id: `snapshot-${offset}-${index}`, dayKey, ts: `${dayKey}T1${index}:00:00.000Z`, type,
          minutes: 30 + ((offset * 17 + index * 23) % 90),
          cards: type === "Anki" ? 60 + (offset % 5) * 20 : 0,
          quantity: type === "Practice questions" ? 20 + (offset % 4) * 10 : undefined,
          quantityKind: type === "Practice questions" ? "questions" : undefined,
          academic: true,
        });
      }
    }
    useStore.setState({ logs, profile: { ...state.profile, experimentalFlags: { ...state.profile.experimentalFlags, habits: true, dailyGames: true } } });
  });
}

async function applyAppearance(page, theme, palette) {
  await page.evaluate(async ([themeName, paletteId]) => {
    localStorage.setItem("axom.theme", themeName);
    if (paletteId === "classic") localStorage.removeItem("axom.palette.v1");
    else {
      const module = await import("/src/lib/palette.ts");
      module.setPalettePreference({ id: paletteId, customAccent: "#e0566b" });
    }
  }, [theme, palette]);
  await page.reload({ waitUntil: "networkidle" });
}

const browser = await launch();
const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await mkdir(out, { recursive: true });
await page.goto(baseUrl, { waitUntil: "networkidle" });
await onboard(page);
if (seed) await seedActivity(page);

const shots = [];
for (const palette of palettes) {
  for (const theme of themes) {
    await applyAppearance(page, theme, palette);
    for (const route of routes) {
      await page.evaluate((hash) => { window.location.hash = hash; }, route);
      await page.waitForTimeout(700);
      await page.evaluate(() => document.querySelectorAll(".toast").forEach((toast) => toast.remove()));
      const file = `${route}--${theme}--${palette}.png`;
      await page.screenshot({ path: resolve(out, file), fullPage });
      shots.push({ file, route, theme, palette });
    }
  }
}
await browser.close();

const sheet = `<!doctype html><meta charset="utf-8"><title>AXOM snapshots</title>
<style>body{font:13px system-ui;background:#111;color:#eee;margin:20px}figure{display:inline-block;margin:0 12px 18px 0;width:460px}img{width:100%;border:1px solid #333;border-radius:8px}figcaption{margin-top:4px;color:#aaa}</style>
<h1>AXOM snapshots · ${new Date().toISOString()}</h1>
${shots.map((shot) => `<figure><a href="${shot.file}"><img src="${shot.file}" loading="lazy"></a><figcaption>${shot.route} · ${shot.theme} · ${shot.palette}</figcaption></figure>`).join("\n")}`;
await writeFile(resolve(out, "index.html"), sheet);
console.log(JSON.stringify({ out, shots: shots.length, errors }, null, 2));
if (errors.length) process.exitCode = 1;
