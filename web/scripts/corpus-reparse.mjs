#!/usr/bin/env node
/* global process, console */
// Corpus evaluation harness: re-runs the app's CURRENT question parser over the
// page text retained in a prepared private library, and measures how many
// questions become keyed / ready compared with the stored banks. Reads private
// data from the paths you pass; writes only the report (and, with
// --write-library, an updated private library) where you point it. Nothing
// here is bundled with the app.
//
//   node scripts/corpus-reparse.mjs --library <dir with catalog.json> --out <report.json>
//        [--only <substring>] [--limit N] [--write-library <new dir>] [--no-emphasis]
//
// Unless --no-emphasis is given, PDFs with unkeyed drafts are also read for
// answers marked only in bold or colour, exactly as the app's import does.
//
// --write-library never regresses a source: a bank is replaced only when the
// current parser yields strictly more ready questions and the stored bank holds
// no extracted images. Replaced banks keep matching question ids (so learner
// history stays attached), inherit the bank's module/term/week filing, and hold
// any question whose stem points at a figure that was not extracted.
import { readFile, writeFile, mkdir, link, copyFile, access, readdir, stat } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => {
  if (arg.startsWith('--')) pairs.push([arg.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]]);
  return pairs;
}, []));
if (!args.library || !args.out) { console.error('usage: --library <dir> --out <report.json> [--only s] [--limit N] [--write-library dir]'); process.exit(2); }

const FIGURE_CUE = /\b(figures?|images?|pictures?|photo(?:graph)?s?|micrograph|radiograph|x-?rays?|ct scan|mri|shown (?:below|above|here|in)|diagram|graph|chart|illustrat\w*|arrows?|labell?ed [A-J]\b|structure (?:labell?ed|indicated|marked)|indicated by|ecg|ekg|electrocardiogram|smear shown|slide shown|table below|following table|the table|pedigree|gel|blot)\b/i;
const FIGURE_FLAG = 'This question refers to a figure, image or table that was not extracted from the source. Open the source page before answering.';
const norm = text => String(text ?? '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 160);
const stemText = question => (question.stem ?? []).filter(block => block.type === 'text').map(block => block.text).join(' ');
const exists = path => access(path).then(() => true, () => false);
async function assetFiles(dir) {
  try { return await Promise.all((await readdir(dir)).map(async name => ({ name, size: (await stat(join(dir, name))).size }))); }
  catch { return []; }
}
const hasAsset = (blocks, id) => (blocks ?? []).some(block => block.type === 'image' && block.assetId === id);
/** Carry a stored printing's images onto the reparsed question that reproduces it. */
function transplantImages(question, peers) {
  const moved = new Set();
  for (const peer of peers) {
    for (const asset of peer.assets ?? []) {
      if ((question.assets ?? []).some(existing => existing.id === asset.id)) continue;
      question.assets = [...(question.assets ?? []), { ...asset, questionId: question.id }];
      moved.add(asset.id);
    }
    for (const block of peer.stem ?? []) if (block.type === 'image' && !hasAsset(question.stem, block.assetId)) question.stem.push(block);
    for (const block of peer.explanation ?? []) if (block.type === 'image' && !hasAsset(question.explanation, block.assetId)) question.explanation = [...(question.explanation ?? []), block];
    for (const choice of peer.choices ?? []) for (const block of choice.blocks ?? []) {
      const target = question.choices.find(option => option.label === choice.label);
      if (block.type === 'image' && target && !hasAsset(target.blocks, block.assetId)) target.blocks.push(block);
    }
  }
  return moved;
}

async function retain(from, to) {
  await mkdir(dirname(to), { recursive: true });
  if (await exists(to)) return;
  try { await link(from, to); } catch { await copyFile(from, to); }
}

/** Give a reparsed question the id (and choice ids) of the stored question it reproduces. */
function adoptId(question, id) {
  question.id = id;
  question.choices = question.choices.map(choice => ({ ...choice, id: `${id}-${choice.label.toLowerCase()}` }));
  for (const asset of question.assets ?? []) asset.questionId = id;
}

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root: web, configFile: false, logLevel: 'error', cacheDir: join(web, 'node_modules/.vite-corpus'),
  optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
try {
  const load = path => server.ssrLoadModule(path);
  const { parsePdfQuestions } = await load('/src/lib/pdfQuestionImport.ts');
  const { draftsToQuestions } = await load('/src/lib/question-content/fromDrafts.ts');
  const { assessBank } = await load('/src/lib/question-content/assessBank.ts');
  const { readPrintedChoiceSets, applyEmphasisAnswers } = await load('/src/lib/pdfEmphasisAnswers.ts');
  const pdfjsLegacy = await import(pathToFileURL(join(web, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href);
  const pdfWorker = pathToFileURL(join(web, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs')).href;
  const catalog = JSON.parse(await readFile(join(args.library, 'catalog.json'), 'utf8'));
  const output = args['write-library'] ? resolve(args['write-library']) : undefined;
  const rows = [], outSources = [];
  let n = 0;
  const holdsAll = {}, blockersAll = {};
  const tally = (into, text) => { const k = String(text).replace(/\d+/g, '#').slice(0, 140); into[k] = (into[k] ?? 0) + 1; };

  for (const source of catalog.sources) {
    let written = { ...source };
    const selected = source.bankFile && (!args.only || source.name.includes(args.only)) && (!args.limit || n < Number(args.limit));
    let bank;
    if (selected) { try { bank = JSON.parse(await readFile(join(args.library, source.bankFile), 'utf8')); } catch { bank = undefined; } }
    const pages = bank?.sourceText?.pageTexts;
    if (selected && Array.isArray(pages) && pages.length) {
      n++;
      const oldQs = bank.pkg?.questions ?? [];
      const row = { name: source.name, module: source.module, oldQuestions: oldQs.length, oldReady: source.ready ?? 0, oldKeyed: oldQs.filter(q => q.correctAnswer).length };
      try {
        const parsed = parsePdfQuestions(pages.join('\n\n'), pages);
        const original = source.originalFile && join(args.library, source.originalFile);
        if (!args['no-emphasis'] && original?.toLowerCase().endsWith('.pdf') && parsed.drafts.some(d => d.options.length >= 2 && !d.correctKey)) {
          try {
            const bytes = await readFile(original);
            const sets = await readPrintedChoiceSets(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), pdfjsLegacy, pdfWorker);
            const result = applyEmphasisAnswers(parsed.drafts, sets);
            row.emphasis = { keyed: result.keyed, conflicts: result.conflicts, accepted: result.accepted,
              tallies: result.tallies.map(t => `${t.kind}:${t.marked}/${t.conflicting}/${t.agree}-${t.disagree}/${t.highlightShare.toFixed(2)}`) };
          } catch (error) { row.emphasisError = String(error?.message ?? error).slice(0, 160); }
        }
        const bankId = bank.pkg?.manifest?.bank?.id ?? source.id;
        const seen = new Map();
        const ids = parsed.drafts.map((d, i) => {
          const base = `${bankId}-q${String(d.questionNumber ?? i + 1).padStart(3, '0')}`;
          const k = (seen.get(base) ?? 0) + 1; seen.set(base, k);
          return k === 1 ? base : `${base}-${k}`;
        });
        const converted = draftsToQuestions(parsed.drafts, { media: [] }, { bankId, sourceFilename: source.name, method: 'pdf-import', ids });
        // Reuse stored ids so installed attempts, notes and highlights stay attached.
        const byKey = new Map(), byStem = new Map(), used = new Set(), renamed = new Map(), moved = new Set();
        const push = (map, key, q) => map.set(key, [...(map.get(key) ?? []), q]);
        for (const q of oldQs) {
          push(byKey, `${q.source?.questionNumber ?? ''}|${norm(stemText(q))}`, q);
          push(byStem, norm(stemText(q)), q);
        }
        const template = oldQs[0];
        for (const q of converted.questions) {
          const key = `${q.source?.questionNumber ?? ''}|${norm(stemText(q))}`;
          const peers = [...new Set([...(byKey.get(key) ?? []), ...(norm(stemText(q)).length >= 25 ? byStem.get(norm(stemText(q))) ?? [] : [])])];
          const match = peers.find(candidate => !used.has(candidate.id));
          if (match) { renamed.set(q.id, match.id); adoptId(q, match.id); used.add(match.id); }
          for (const id of transplantImages(q, peers)) moved.add(id);
          for (const field of ['course', 'term', 'week']) {
            const value = (match ?? template)?.[field];
            if (value !== undefined) q[field] = value;
          }
          if (!(q.assets ?? []).length && FIGURE_CUE.test(stemText(q)))
            q.flags = [...(q.flags ?? []), { type: 'media_association_uncertain', message: FIGURE_FLAG }];
        }
        // Converted ids may collide with adopted stored ids; keep every id unique.
        const taken = new Set();
        for (const q of converted.questions) {
          if (!taken.has(q.id)) { taken.add(q.id); continue; }
          let k = 2; while (taken.has(`${q.id}-r${k}`)) k++;
          const fresh = `${q.id}-r${k}`; renamed.set(q.id, fresh); adoptId(q, fresh); taken.add(fresh);
        }
        const issues = converted.issues.map(issue => issue.questionId && renamed.has(issue.questionId) ? { ...issue, questionId: renamed.get(issue.questionId) } : issue);
        const manifest = bank.pkg?.manifest ?? { schemaVersion: 1, course: { name: 'UNMAPPED', term: 0, week: 0 },
          bank: { id: bankId, title: source.name, discipline: source.module ?? 'Unfiled' }, source: { filename: source.name, sourceWeekDeclared: false },
          questionsFile: 'questions.json', assetsDirectory: 'assets/' };
        const pkg = { manifest, questions: converted.questions };
        const files = await assetFiles(join(args.library, dirname(source.bankFile), manifest.assetsDirectory ?? 'assets'));
        const assessment = assessBank(pkg, issues, files);
        const lost = oldQs.flatMap(q => (q.assets ?? []).map(asset => asset.id)).filter(id => !moved.has(id));
        const verdicts = converted.questions.map(q => assessment.verdicts.get(q.id)?.readiness);
        const ready = verdicts.filter(v => v === 'ready').length, review = verdicts.filter(v => v === 'needs-review').length;
        const codes = {}, holds = {}, blockers = {};
        for (const issue of assessment.issues) if (issue.severity !== 'info') codes[issue.code] = (codes[issue.code] ?? 0) + 1;
        for (const q of converted.questions) {
          for (const flag of q.flags ?? []) if (flag.type === 'answer_needs_review') { tally(holds, flag.message.split(" The parser's candidate")[0]); tally(holdsAll, flag.message.split(" The parser's candidate")[0]); }
          if (q.correctAnswer && assessment.verdicts.get(q.id)?.readiness !== 'ready')
            for (const issue of assessment.issues) if (issue.questionId === q.id && issue.severity !== 'info') { tally(blockers, issue.code); tally(blockersAll, issue.code); }
        }
        const replace = lost.length === 0 && ready > row.oldReady;
        Object.assign(row, { drafts: parsed.drafts.length, draftKeys: parsed.drafts.filter(d => d.correctKey).length,
          savedKeys: converted.questions.filter(q => q.correctAnswer).length, ready, review, kept: renamed.size,
          images: moved.size, decision: replace ? 'replaced' : lost.length ? `kept: ${lost.length} stored images unplaced` : 'kept: no gain', deck: parsed.deck ?? null, codes, holds, blockers });
        if (output && replace) {
          const to = join(output, source.bankFile);
          await mkdir(dirname(to), { recursive: true });
          await writeFile(to, JSON.stringify({ ...bank, pkg, issues: assessment.issues, reparsedBy: 'corpus-reparse@2',
            notes: [...(bank.notes ?? []), `Reparsed ${new Date().toISOString().slice(0, 10)} with the current parser; ${ready} ready (was ${row.oldReady}). Keys are source-printed; figure-dependent stems without an extracted image stay held.`] }), { mode: 0o600 });
          written = { ...source, ready, review: converted.questions.length - ready,
            reason: `${ready} ready; ${converted.questions.length - ready} held. ${String(source.reason ?? '').replace(/^\d+ ready; \d+ held\.\s*/, '')}`.trim() };
        }
      } catch (error) { row.error = String(error?.message ?? error).slice(0, 200); }
      rows.push(row);
    }
    if (output) {
      if (source.bankFile && !(await exists(join(output, source.bankFile))) && await exists(join(args.library, source.bankFile)))
        await retain(join(args.library, source.bankFile), join(output, source.bankFile));
      if (source.bankFile) for (const file of await assetFiles(join(args.library, dirname(source.bankFile), 'assets')))
        await retain(join(args.library, dirname(source.bankFile), 'assets', file.name), join(output, dirname(source.bankFile), 'assets', file.name));
      if (source.originalFile && await exists(join(args.library, source.originalFile)))
        await retain(join(args.library, source.originalFile), join(output, source.originalFile));
      outSources.push(written);
    }
  }
  if (output) {
    for (const template of catalog.templates ?? []) await retain(join(args.library, template.file), join(output, template.file));
    await writeFile(join(output, 'catalog.json'), JSON.stringify({ ...catalog, version: `${catalog.version}+reparsed-${new Date().toISOString().slice(0, 10)}`, sources: outSources }, null, 1), { mode: 0o600 });
  }
  const sum = key => rows.reduce((total, row) => total + (row[key] ?? 0), 0);
  const top = into => Object.entries(into).sort((a, b) => b[1] - a[1]).slice(0, 40);
  const report = { library: args.library, sources: rows.length, oldReady: sum('oldReady'), oldKeyed: sum('oldKeyed'),
    drafts: sum('drafts'), draftKeys: sum('draftKeys'), savedKeys: sum('savedKeys'), ready: sum('ready'), review: sum('review'),
    replaced: rows.filter(r => r.decision === 'replaced').length,
    readyAfterDecisions: rows.reduce((total, r) => total + (r.decision === 'replaced' ? r.ready : r.oldReady), 0),
    emphasisKeyed: rows.reduce((total, r) => total + (r.emphasis?.keyed ?? 0), 0),
    emphasisConflicts: rows.reduce((total, r) => total + (r.emphasis?.conflicts ?? 0), 0),
    emphasisErrors: rows.filter(r => r.emphasisError).length,
    errors: rows.filter(r => r.error).length, holds: top(holdsAll), blockers: top(blockersAll), rows };
  await writeFile(args.out, JSON.stringify(report, null, 1), { mode: 0o600 });
  console.log(JSON.stringify(Object.fromEntries(Object.entries(report).filter(([key]) => !['rows', 'holds', 'blockers'].includes(key)))));
} finally { await server.close(); }
