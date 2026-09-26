import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('active native and cloud packages use AXOM naming', async () => {
  const pkg = JSON.parse(await read('package.json'));
  const lock = JSON.parse(await read('package-lock.json'));
  const cargo = await read('src-tauri/Cargo.toml');
  assert.equal(pkg.name, 'axom-cloud');
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.packages[''].name, pkg.name);
  assert.match(cargo, /\[package\]\nname = "axom"/);
  assert.match(cargo, /\[lib\]\nname = "axom_lib"/);
  assert.match(await read('src-tauri/src/main.rs'), /axom_lib::run\(\)/);
  assert.ok((await read('src-tauri/Cargo.lock')).includes(`[[package]]\nname = "axom"\nversion = "${pkg.version}"`));
});

test('AXOM rebrand keeps the existing native data container', async () => {
  const config = JSON.parse(await read('src-tauri/tauri.conf.json'));
  assert.equal(config.productName, 'AXOM');
  assert.equal(config.identifier, 'com.noctyrium.alpha');
  assert.deepEqual(config.plugins.sql.preload, ['sqlite:noctyrium.db']);
});
