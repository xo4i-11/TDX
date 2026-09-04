// Proves that, on the paths these two tests actually exercise, the extension makes no network request.
/**
 * What this file does NOT prove: the runtime trap is armed after all static
 * ESM imports have already run, so a module that captures a network
 * primitive at import time (e.g. `const f = globalThis.fetch`) is invisible
 * to it, and the `navigator` trap replaces the whole object rather than the
 * `sendBeacon` method, which is weaker still. The static scan is a RegExp
 * over de-commented source text, so any bound reference or computed access
 * (`globalThis['fe' + 'tch']`) walks straight through it. The real guarantee
 * here is: post-import, on executed paths, in the scanned files only. That
 * is reasonable defence-in-depth against accidental network code — the
 * realistic threat for this project — not a whole-extension proof.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFixture } from './helpers.ts';
import { harvest } from '../src/core/harvest.ts';
import { resolve } from '../src/core/resolve.ts';
import { formSignature } from '../src/core/signature.ts';
import { parseRequestor } from '../src/data/parser.ts';
import { retrieve } from '../src/service/retriever.ts';
import { runFill } from '../src/fill/policy.ts';
import { SHIPPED_TEMPLATES } from '../src/data/templates.ts';
import { createStores, createMemoryArea } from '../src/data/stores.ts';

const BLOCK = `Requestor
[Anh Duy Nghiem](https://ubuffalo.teamdynamix.com/TDNext/Apps/People/PersonDet.aspx?U=b067308b-2198-ef11-9c36-f06ebc4e4310)
[duynghie@buffalo.edu](mailto:duynghie@buffalo.edu)
Student Assistant - ITCX Tech Squad
University at Buffalo
50583450 - duynghie`;

/** Replaces every network primitive with a landmine, on the global and on the page window. */
function armNetworkTraps(targets: object[]): string[] {
  const tripped: string[] = [];
  const trap = (name: string) => (): never => {
    tripped.push(name);
    throw new Error(`network call attempted: ${name}`);
  };
  for (const target of targets) {
    const bag = target as Record<string, unknown>;
    for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Request']) {
      try { bag[name] = trap(name); } catch { /* frozen in some environments */ }
    }
    try {
      const nav = bag.navigator as Record<string, unknown> | undefined;
      bag.navigator = { ...nav, sendBeacon: trap('sendBeacon') };
    } catch { /* read-only */ }
  }
  return tripped;
}

test('ACCEPTANCE: a full parse to fill cycle makes no network request', async () => {
  const doc = loadFixture();
  const tripped = armNetworkTraps([globalThis, doc.defaultView as unknown as object]);

  const { fields: requestor } = parseRequestor(BLOCK);
  const controls = harvest(doc);
  const resolution = resolve(controls, { learned: {} });
  formSignature(doc);

  const stores = createStores(createMemoryArea());
  await stores.settings.patch({ overwrite: true });
  await stores.examples.add({ description: 'eduroam profile removed and CAT tool run', service: { id: '288', text: 'Personal Device Consultation' } });
  const examples = await stores.examples.list();
  const ranked = retrieve('set up eduroam on a laptop', examples);

  const template = SHIPPED_TEMPLATES.find((t) => t.id === 'eduroam');
  assert.ok(template, 'fixture template "eduroam" must exist for this test');

  const rows = await runFill({
    resolution,
    requestor,
    template,
    service: ranked[0]?.service ?? null,
    settings: await stores.settings.get(),
  }, { bridge: { async setEditorData() { return { ok: false, detail: 'no CKEDITOR in jsdom' }; } } });

  assert.ok(rows.length > 0);
  assert.deepEqual(tripped, [], `network primitives were called: ${tripped.join(', ')}`);
});

test('no source file references a network primitive or an external URL', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');

  // manifest.json is a shipped MV3 asset, not TypeScript — a CDN asset,
  // remote script, or over-broad host_permissions entry would live there,
  // not under src/, so it must be scanned too.
  const files: string[] = ['manifest.json'];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith('.ts')) files.push(full);
    }
  };
  walk('src');

  const banned = /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(/;
  const externalUrl = /https?:\/\/(?!ubuffalo\.teamdynamix\.com)/;

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    // Comments legitimately name these primitives when explaining why they are
    // absent, so only look at code lines.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
      .filter((line) => !line.trim().startsWith('//')).join('\n');
    assert.ok(!banned.test(code), `${file} calls a network primitive`);
    assert.ok(!externalUrl.test(code), `${file} references an external URL`);
  }
});
