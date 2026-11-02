import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderWelcomeDraft } from './render-welcome-draft.mjs';

test('exports portable welcome HTML and text from the canonical renderer', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'axom-welcome-draft-'));
  try {
    const output = pathToFileURL(`${directory}/`);
    const result = await renderWelcomeDraft(output);
    assert.match(result.subject, /Welcome to AXOM/);
    const dark = await readFile(new URL('welcome-dark.html', output), 'utf8');
    const light = await readFile(new URL('welcome-light.html', output), 'utf8');
    const text = await readFile(new URL('welcome.txt', output), 'utf8');
    const index = await readFile(new URL('index.html', output), 'utf8');
    for (const html of [dark, light]) {
      assert.match(html, /Alex/);
      assert.match(html, /alt="AXOM Orb"/);
      assert.match(html, /src="orb.png"/);
      assert.match(html, /Bring your term/);
      assert.doesNotMatch(html, /<script\b|https:\/\/axom\.info\/icons\/axom-orb-512\.png/i);
    }
    assert.match(text, /Enter AXOM/);
    assert.match(index, /LOCAL DRAFT · NO EMAIL SENT/);
    assert.ok((await readFile(new URL('orb.png', output))).length > 1000);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
