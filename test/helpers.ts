// Loads the saved TDX form for tests, either as-is or with TDX's own field markers stripped out.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const FIXTURE = fileURLToPath(new URL('./fixtures/tdx-form-162.html', import.meta.url));

/** Returns a fresh Document for the checked-in TDX form. */
export function loadFixture(): Document {
  return new JSDOM(readFileSync(FIXTURE, 'utf8')).window.document;
}

/**
 * Returns the fixture with every TDX-specific semantic marker removed,
 * simulating a form the engine has never seen. Labels and option sets are left
 * intact on purpose — they are exactly the signals tier 3 must resolve from.
 */
export function loadUnknownFormFixture(): Document {
  const doc = loadFixture();
  for (const group of doc.querySelectorAll('[data-fieldtype]')) {
    group.removeAttribute('data-fieldtype');
    group.removeAttribute('data-fieldid');
  }
  return doc;
}
