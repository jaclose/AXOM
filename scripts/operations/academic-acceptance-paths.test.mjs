import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../../.github/workflows/apex-acceptance.yml', import.meta.url), 'utf8');
const pullRequestBlock = workflow.split(/^  workflow_dispatch:/m)[0];
const paths = [...pullRequestBlock.matchAll(/^      - '([^']+)'$/gm)].map((match) => match[1]);

// Workflow uses only GitHub's plain '*' and '**' path globs, never extglobs or negation.
function matchesGithubPath(pattern, file) {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*');
  return new RegExp('^' + escaped + '$').test(file);
}

function triggersFor(file) {
  return paths.some((pattern) => matchesGithubPath(pattern, file));
}

test('APEX path filter is defined and remains pull-request-scoped', () => {
  assert.match(workflow, /\bon:\s*\n  pull_request:\s*\n    paths:/);
  assert.ok(paths.length > 0);
  assert.ok(paths.every((path) => !path.startsWith('!')), 'negative patterns need dedicated GitHub semantics');
});

test('QBank runner and real recovery browser specs trigger academic acceptance', () => {
  for (const file of [
    'web/src/components/questions/ExamRunner.tsx',
    'web/src/components/questions/ExamRunner.test.tsx',
    'web/src/components/questions/ExamRunner.media.test.tsx',
    'web/e2e/question-block-save.spec.ts',
  ]) {
    assert.ok(triggersFor(file), 'APEX workflow misses QBank path: ' + file);
  }
});

test('Course Tracker term download and catalog edits trigger academic acceptance', () => {
  for (const file of [
    'web/src/components/tracker/TermCourseActions.tsx',
    'web/src/components/tracker/TermCourseActions.test.tsx',
    'web/src/pages/CourseTrackerPage.tsx',
    'web/src/lib/academicLibrary/courseCatalog.ts',
  ]) {
    assert.ok(triggersFor(file), 'APEX workflow misses Tracker/catalog path: ' + file);
  }
});

test('existing academic backend, academic browser and workflow coverage persist', () => {
  for (const file of [
    'web/src/lib/course-engine/scope.ts',
    'scripts/operations/academic-pdf-triage.mjs',
    'scripts/operations/academic-acceptance-paths.test.mjs',
    'web/e2e/academic-quiz-planner.spec.ts',
    'web/e2e/course-qbank-v2.spec.ts',
    'web/e2e/exam-simulation-save.spec.ts',
    '.github/workflows/apex-acceptance.yml',
  ]) {
    assert.ok(triggersFor(file), 'APEX workflow lost academic coverage: ' + file);
  }
});

test('unrelated Journal, soundscapes and general browser changes stay out of this expensive gate', () => {
  for (const file of [
    'web/src/pages/JournalPage.tsx',
    'web/src/components/soundscapes/SoundscapePlayer.tsx',
    'web/e2e/landing-hero.spec.ts',
  ]) {
    assert.equal(triggersFor(file), false, 'APEX workflow over-triggers on: ' + file);
  }
});
