#!/usr/bin/env node
/* global process, console */
// Corpus evaluation harness: re-runs the app's CURRENT question parser over the
// page text retained in a prepared private library, and measures how many
// questions become keyed / ready compared with the stored banks. Reads private
// data from the paths you pass; writes only the report (and optional reparsed
// banks) where you point it. Nothing here is bundled with the app.
//
//   node scripts/corpus-reparse.mjs --library <dir with catalog.json> --out <report.json>
//        [--only <substring>] [--write-banks <dir>] [--limit N]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => {
  if (arg.startsWith('--')) pairs.push([arg.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]]);
  return pairs;
}, []));
if (!args.library || !args.out) { console.error('usage: --library <dir> --out <report.json> [--only s] [--write-banks dir] [--limit N]'); process.exit(2); }
const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root: web, configFile: false, logLevel: 'error', cacheDir: join(web, 'node_modules/.vite-corpus'),
  optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
try {
  const load = path => server.ssrLoadModule(path);
  const { parsePdfQuestions } = await load('/src/lib/pdfQuestionImport.ts');
  const { draftsToQuestions } = await load('/src/lib/question-content/fromDrafts.ts');
  const { assessBank } = await load('/src/lib/question-content/assessBank.ts');
  const catalog = JSON.parse(await readFile(join(args.library, 'catalog.json'), 'utf8'));
  const rows = [];
  let n = 0;
  for (const source of catalog.sources) {
    if (!source.bankFile || (args.only && !source.name.includes(args.only))) continue;
    if (args.limit && n >= Number(args.limit)) break;
    let bank;
    try { bank = JSON.parse(await readFile(join(args.library, source.bankFile), 'utf8')); } catch { continue; }
    const pages = bank.sourceText?.pageTexts;
    if (!Array.isArray(pages) || !pages.length) continue;
    n++;
    const oldQs = bank.pkg?.questions ?? [];
    const row = { name: source.name, module: source.module, oldQuestions: oldQs.length, oldReady: source.ready ?? 0,
      oldKeyed: oldQs.filter(q => q.correctAnswer).length };
    try {
      const parsed = parsePdfQuestions(pages.join('\n\n'), pages);
      const bankId = bank.pkg?.manifest?.bank?.id ?? source.id;
      const seen = new Map();
      const ids = parsed.drafts.map((d, i) => {
        const base = `${bankId}-q${String(d.questionNumber ?? i + 1).padStart(3, '0')}`;
        const k = (seen.get(base) ?? 0) + 1; seen.set(base, k);
        return k === 1 ? base : `${base}-${k}`;
      });
      const converted = draftsToQuestions(parsed.drafts, { media: [] }, { bankId, sourceFilename: source.name, method: 'pdf-import', ids });
      const pkg = { manifest: bank.pkg?.manifest ?? { schemaVersion: 1, course: { name: 'UNMAPPED', term: 0, week: 0 },
        bank: { id: bankId, title: source.name, discipline: source.module ?? 'Unfiled' }, source: { filename: source.name, sourceWeekDeclared: false },
        questionsFile: 'questions.json', assetsDirectory: 'assets/' }, questions: converted.questions };
      const assessment = assessBank(pkg, converted.issues, []);
      const verdicts = [...assessment.verdicts.values()].map(v => v.readiness);
      const codes = {}, holds = {}, blockers = {};
      for (const issue of assessment.issues) if (issue.severity !== 'info') codes[issue.code] = (codes[issue.code] ?? 0) + 1;
      const tally = (into, text) => { const k = String(text).replace(/\d+/g, '#').replace(/[A-J](?=\. It was not saved)/, 'X').slice(0, 140); into[k] = (into[k] ?? 0) + 1; };
      for (const q of converted.questions) {
        for (const flag of q.flags ?? []) if (flag.type === 'answer_needs_review') tally(holds, flag.message.split(" The parser's candidate")[0]);
        if (q.correctAnswer && assessment.verdicts.get(q.id)?.readiness !== 'ready')
          for (const issue of assessment.issues) if (issue.questionId === q.id && issue.severity !== 'info') tally(blockers, issue.code + ': ' + issue.message);
      }
      Object.assign(row, { drafts: parsed.drafts.length, draftKeys: parsed.drafts.filter(d => d.correctKey).length,
        savedKeys: converted.questions.filter(q => q.correctAnswer).length,
        ready: verdicts.filter(v => v === 'ready').length, review: verdicts.filter(v => v === 'needs-review').length,
        deck: parsed.deck ?? null, codes, holds, blockers });
      if (args['write-banks']) {
        const to = join(args['write-banks'], source.bankFile);
        await mkdir(dirname(to), { recursive: true });
        await writeFile(to, JSON.stringify({ ...bank, pkg, issues: assessment.issues, reparsedBy: 'corpus-reparse@1' }), { mode: 0o600 });
      }
    } catch (error) { row.error = String(error?.message ?? error).slice(0, 200); }
    rows.push(row);
  }
  const sum = key => rows.reduce((total, row) => total + (row[key] ?? 0), 0);
  const merge = key => Object.entries(rows.reduce((all, row) => { for (const [k, v] of Object.entries(row[key] ?? {})) all[k] = (all[k] ?? 0) + v; return all; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 40);
  const report = { library: args.library, sources: rows.length, oldReady: sum('oldReady'), oldKeyed: sum('oldKeyed'),
    drafts: sum('drafts'), draftKeys: sum('draftKeys'), savedKeys: sum('savedKeys'), ready: sum('ready'), review: sum('review'),
    errors: rows.filter(r => r.error).length, holds: merge('holds'), blockers: merge('blockers'), rows };
  await writeFile(args.out, JSON.stringify(report, null, 1), { mode: 0o600 });
  const headline = Object.fromEntries(Object.entries(report).filter(([key]) => !['rows', 'holds', 'blockers'].includes(key)));
  console.log(JSON.stringify(headline));
} finally { await server.close(); }
