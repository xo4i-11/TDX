# Resolve-Mode Fill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the TDX ticket Update page — status `Resolved`, comment made client-visible, and the captured "Ticket Resolved" template with the technician's troubleshooting steps substituted in.

**Architecture:** The existing panel gains a *mode*. `pageMode(doc)` picks `create` or `resolve` from one selector; `FILL_SET` becomes `FILL_SETS[mode]`; the resolver, adapters, stores, results and diagnostics are reused untouched. The one genuinely new primitive is a `checkbox` control shape. The resolved comment body is captured once from the page, its red placeholder block rewritten to `{{steps}}`, and filled thereafter with the existing `substitute()`.

**Tech Stack:** TypeScript (type-stripped, no build step for tests), `node --test`, jsdom, esbuild for the extension bundle. No runtime dependencies, no network calls — `test/no-network.test.ts` enforces the latter.

**Spec:** `docs/superpowers/specs/2026-09-06-tdx-resolve-design.md`

## Global Constraints

- **No network calls, ever.** `test/no-network.test.ts` trips on `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `EventSource`. Nothing in this plan may reach the network.
- **No new dependencies.** `package.json` has devDependencies only.
- **Node >= 24**, ESM (`"type": "module"`). Imports of local files carry the `.ts` extension.
- **Every write verifies itself.** An adapter returns `filled` only after reading the value back. Never report success for a write that did not land.
- **The extension never submits a form.** It fills and stops.
- **No requestor data is ever persisted.** Requestor fields live in panel memory only (`src/data/stores.ts` banner, pinned by `test/no-network.test.ts`).
- **Commands:** `npm test` (all), `npm run typecheck`, `npm run check` (both), `npm run build`.
- **Run a single test file:** `node --test test/policy.test.ts`
- **Commit trailers** — every commit message ends with:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_014p2ZwRgeFhqdaPjbhDYzMh
  ```

---

## File Structure

**Create:**
- `src/core/pagemode.ts` — `pageMode(doc)`. Pure document read, beside `signature.ts`.
- `src/adapters/checkbox.ts` — `fillCheckbox`, `readCheckbox`.
- `src/data/resolved.ts` — red-block detection and the `{{steps}}` rewrite. Pure string/DOM work, no storage.
- `test/fixtures/tdx-update-229544.html` — scrubbed update-form fixture.
- `test/pagemode.test.ts`, `test/adapters-checkbox.test.ts`, `test/resolved.test.ts`

**Modify:**
- `scripts/make-fixture.ts` — add `--scrub` and `--replace`.
- `src/types.ts` — `ControlShape` gains `checkbox`; `Template.steps`; `Settings.resolvedCommentHtml`.
- `src/core/harvest.ts` — stop skipping checkboxes.
- `src/core/dictionary.ts` — four entries; `FILL_SET` → `FILL_SETS`.
- `src/adapters/index.ts` — checkbox arm in `applyValue` and `currentValue`.
- `src/adapters/richtext.ts` — `readRichTextHtml`.
- `src/data/templates.ts` — `steps` placeholder support, `stepsToHtml`, `steps` on the five walk-up templates.
- `src/data/stores.ts` — `DEFAULT_SETTINGS.resolvedCommentHtml`.
- `src/fill/policy.ts` — `mode`, resolve-set values, checkbox preserve exemption.
- `src/ui/panel.ts` — resolve-mode sections.
- `src/ui/settings.ts` — captured-template row with Clear.
- `test/helpers.ts` — `loadUpdateFixture()`.

---

### Task 1: Scrubbed update fixture

The saved page is a live ticket. Nothing identifying may land in the repo.

**Files:**
- Modify: `scripts/make-fixture.ts`
- Create: `test/fixtures/tdx-update-229544.html` (generated)
- Modify: `test/helpers.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `loadUpdateFixture(): Document` in `test/helpers.ts`.

- [ ] **Step 1: Add `--scrub` and `--replace` to the fixture script**

In `scripts/make-fixture.ts`, after the existing `__RequestVerificationToken` redaction and before `mkdirSync`, insert:

```ts
// The update page is a live ticket: person GUIDs, emails, person numbers and
// the ticket's own id/subject are all real. --scrub replaces the mechanical
// ones; --replace handles names and prose, which no regex can find safely.
if (process.argv.includes('--scrub')) {
  form = form
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '00000000-0000-0000-0000-000000000000')
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, 'testuser@example.edu')
    .replace(/\b\d{8}\b/g, '10000000');
}

// --replace "old=new", repeatable. Literal, not regex: a name is not a pattern.
for (const [i, arg] of process.argv.entries()) {
  if (arg !== '--replace') continue;
  const pair = process.argv[i + 1];
  if (!pair) continue;
  const eq = pair.indexOf('=');
  if (eq === -1) continue;
  form = form.split(pair.slice(0, eq)).join(pair.slice(eq + 1));
}
```

- [ ] **Step 2: Generate the fixture**

```bash
node scripts/make-fixture.ts \
  "/d/Downloads/Work Management _ Update Service Request - 229544_ Client Couldn't Connect to ..._files/Update.html" \
  test/fixtures/tdx-update-229544.html \
  --scrub \
  --replace "Anh Duy Nghiem=Test Requestor" \
  --replace "229544=100000"
```

- [ ] **Step 3: Verify nothing identifying survived**

```bash
grep -nEi "buffalo\.edu|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|229544" test/fixtures/tdx-update-229544.html | grep -v "00000000-0000" | head
```

Expected: no output except `ubuffalo.teamdynamix.com` URLs. **Read the surviving person names and ticket subject by eye** — add another `--replace` and regenerate for anything real. Do not commit until this is clean.

- [ ] **Step 4: Verify the fixture carries the controls this plan needs**

```bash
grep -c 'id="NewStatusId"\|id="CommentsIsPrivate"\|id="Comments_Content"\|data-fieldtype="responsible"' test/fixtures/tdx-update-229544.html
```

Expected: `4`.

- [ ] **Step 5: Add the loader**

In `test/helpers.ts`, beside `FIXTURE`:

```ts
const UPDATE_FIXTURE = fileURLToPath(new URL('./fixtures/tdx-update-229544.html', import.meta.url));

/** Returns a fresh Document for the checked-in TDX ticket *update* form. */
export function loadUpdateFixture(): Document {
  return new JSDOM(readFileSync(UPDATE_FIXTURE, 'utf8')).window.document;
}
```

- [ ] **Step 6: Commit**

```bash
git add scripts/make-fixture.ts test/fixtures/tdx-update-229544.html test/helpers.ts
git commit -m "test: add a scrubbed fixture for the TDX ticket update form"
```

---

### Task 2: The checkbox control shape

**Files:**
- Modify: `src/types.ts`, `src/core/harvest.ts`
- Create: `src/adapters/checkbox.ts`, `test/adapters-checkbox.test.ts`
- Modify: `src/adapters/index.ts`, `test/harvest.test.ts`

**Interfaces:**
- Consumes: `loadUpdateFixture()` (Task 1).
- Produces:
  - `ControlShape` includes `'checkbox'`
  - `fillCheckbox(control: Control, value: boolean): AdapterResult`
  - `readCheckbox(control: Control): boolean`
  - `applyValue(control, value: unknown, ctx)` accepts a boolean for checkbox controls.

- [ ] **Step 1: Write the failing tests**

Create `test/adapters-checkbox.test.ts`:

```ts
// Tests the checkbox adapter: it writes, it verifies, and it refuses to claim success.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { fillCheckbox, readCheckbox } from '../src/adapters/checkbox.ts';
import { harvest } from '../src/core/harvest.ts';
import type { Control } from '../src/types.ts';

function boxControl(html: string): { control: Control; doc: Document } {
  const doc = new JSDOM(`<form><div class="form-group">${html}</div></form>`).window.document;
  const control = harvest(doc).find((c) => c.shape === 'checkbox');
  assert.ok(control, 'no checkbox control harvested');
  return { control, doc };
}

test('fillCheckbox unchecks a checked box and reports filled', () => {
  const { control } = boxControl('<input type="checkbox" id="CommentsIsPrivate" name="CommentsIsPrivate" checked>');
  const result = fillCheckbox(control, false);
  assert.equal(result.status, 'filled');
  assert.equal((control.el as HTMLInputElement).checked, false);
});

test('fillCheckbox fires a change event so the page sees the write', () => {
  const { control, doc } = boxControl('<input type="checkbox" id="box" name="box" checked>');
  let seen = 0;
  control.el.addEventListener('change', () => { seen += 1; });
  fillCheckbox(control, false);
  assert.equal(seen, 1);
  assert.ok(doc);
});

// Falsifiability: a checkbox whose state is forced back (a page script, a
// disabled input) must report failed, not filled — the whole point of the
// read-back contract.
test('fillCheckbox reports failed when the box refuses the change', () => {
  const { control } = boxControl('<input type="checkbox" id="box" name="box" checked>');
  control.el.addEventListener('change', () => { (control.el as HTMLInputElement).checked = true; });
  const result = fillCheckbox(control, false);
  assert.equal(result.status, 'failed');
  assert.match(result.detail, /read back/);
});

test('readCheckbox reports the current state', () => {
  const { control } = boxControl('<input type="checkbox" id="box" name="box" checked>');
  assert.equal(readCheckbox(control), true);
});
```

Add to `test/harvest.test.ts`:

```ts
test('the private-comment checkbox on the update form is harvested as a checkbox', () => {
  const control = harvest(loadUpdateFixture()).find((c) => c.id === 'CommentsIsPrivate');
  assert.ok(control, 'CommentsIsPrivate was not harvested at all');
  assert.equal(control.shape, 'checkbox');
});

// Falsifiability: radios stay skipped. The update form has three
// KnowledgeBaseArticleOption radios that must not become fillable controls.
test('radios are still skipped', () => {
  const radios = harvest(loadUpdateFixture()).filter((c) => (c.el as HTMLInputElement).type === 'radio');
  assert.deepEqual(radios, []);
});
```

Import `loadUpdateFixture` in `test/harvest.test.ts`'s existing helpers import.

- [ ] **Step 2: Run them and watch them fail**

```bash
node --test test/adapters-checkbox.test.ts test/harvest.test.ts
```

Expected: FAIL — `Cannot find module '../src/adapters/checkbox.ts'`, and `shape` is `undefined` because no checkbox is harvested.

- [ ] **Step 3: Add the shape to the types**

`src/types.ts`:

```ts
export type ControlShape = 'text' | 'select' | 'select2' | 'lookup' | 'richtext' | 'checkbox';
```

`ControlKind` also gains it, since a dictionary entry must be able to expect one:

```ts
export type ControlKind = 'text' | 'select' | 'lookup' | 'richtext' | 'checkbox';
```

- [ ] **Step 4: Harvest checkboxes**

In `src/core/harvest.ts`, replace:

```ts
    if (tag === 'input' && (type === 'radio' || type === 'checkbox')) continue;
```

with:

```ts
    // Radios stay skipped: they are a group with one value, and nothing in
    // either fill set is one. A checkbox is a single boolean control.
    if (tag === 'input' && type === 'radio') continue;
```

and in the shape-picking chain, before the `text` fallback:

```ts
    } else if (tag === 'input' && type === 'checkbox') {
      controls.push(describe(el, doc, { shape: 'checkbox' }));
```

- [ ] **Step 5: Write the adapter**

Create `src/adapters/checkbox.ts`:

```ts
// Writes a boolean checkbox and verifies the page kept it.
/**
 * Separate from text.ts because a checkbox's value is `.checked`, not
 * `.value` — `setNativeValue` would write the string "false" into `value`
 * and leave the box checked, reporting success for a write that never
 * happened. Like every adapter here, this one knows nothing about which
 * field it serves.
 */

import type { AdapterResult, Control } from '../types.ts';

export function fillCheckbox(control: Control, value: boolean): AdapterResult {
  const el = control.el as HTMLInputElement;
  if (typeof el.checked !== 'boolean') {
    return { status: 'failed', detail: 'control is not a checkbox' };
  }

  el.checked = value;
  const view = el.ownerDocument.defaultView ?? window;
  // click() would toggle a second time; a change event is what page scripts
  // listen for and what an unchecked private-comment box has to announce.
  el.dispatchEvent(new view.Event('change', { bubbles: true }));

  if (el.checked !== value) {
    return { status: 'failed', detail: `wrote ${value}, read back ${el.checked}` };
  }
  return { status: 'filled', detail: value ? 'checked' : 'unchecked' };
}

/** Current state, used by fill policy for its report rows. */
export function readCheckbox(control: Control): boolean {
  return (control.el as HTMLInputElement).checked === true;
}
```

- [ ] **Step 6: Route it in the dispatcher**

In `src/adapters/index.ts`, add the import:

```ts
import { fillCheckbox, readCheckbox } from './checkbox.ts';
```

Add an arm to `applyValue`'s switch, before `case 'select2'`:

```ts
    case 'checkbox': {
      if (typeof value !== 'boolean') return mismatch('checkbox', 'a boolean', value);
      return fillCheckbox(control, value);
    }
```

And to `currentValue`'s switch:

```ts
    case 'checkbox':
      // Deliberately not the checked state: `currentValue` feeds the
      // preserve-versus-overwrite decision, and "this box already has a
      // value" is meaningless for a boolean — see planFill, which exempts
      // checkboxes from preserving entirely.
      return '';
```

- [ ] **Step 7: Run the tests**

```bash
node --test test/adapters-checkbox.test.ts test/harvest.test.ts && npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Full suite, then commit**

```bash
npm run check
git add src/types.ts src/core/harvest.ts src/adapters/checkbox.ts src/adapters/index.ts test/adapters-checkbox.test.ts test/harvest.test.ts
git commit -m "feat: add a checkbox control shape and its adapter"
```

---

### Task 3: Page mode and the two fill sets

**Files:**
- Create: `src/core/pagemode.ts`, `test/pagemode.test.ts`
- Modify: `src/core/dictionary.ts`, `test/dictionary.test.ts`, `test/resolve.test.ts`

**Interfaces:**
- Consumes: `loadUpdateFixture()` (Task 1), `ControlKind` including `'checkbox'` (Task 2).
- Produces:
  - `pageMode(doc: Document): PageMode` where `export type PageMode = 'create' | 'resolve'`
  - `FILL_SETS: Record<PageMode, string[]>` in `src/core/dictionary.ts`
  - `FILL_SET` is **gone**; every caller uses `FILL_SETS[mode]`
  - Dictionary keys `newStatus`, `comments`, `commentsPrivate`, `responsible`

- [ ] **Step 1: Write the failing tests**

Create `test/pagemode.test.ts`:

```ts
// Tests the one check that decides which form the panel thinks it is on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFixture, loadUpdateFixture } from './helpers.ts';
import { pageMode } from '../src/core/pagemode.ts';

test('the ticket update form is resolve mode', () => {
  assert.equal(pageMode(loadUpdateFixture()), 'resolve');
});

test('the ticket create form is create mode', () => {
  assert.equal(pageMode(loadFixture()), 'create');
});
```

Add to `test/resolve.test.ts` (it already imports `resolve` and `harvest`; add `loadUpdateFixture` to the helpers import):

```ts
// These three carry no data-fieldtype and no data-fieldid — they are core TDX
// fields, not custom attributes — so tier 3 is the only thing that can find
// them. That is exactly what tier 3 is for.
test('the update form resolves its core fields at tier 3', () => {
  const { byField } = resolveDoc(loadUpdateFixture());
  assert.equal(byField.get('newStatus')?.control.id, 'NewStatusId');
  assert.equal(byField.get('comments')?.control.id, 'Comments_Content');
  assert.equal(byField.get('commentsPrivate')?.control.id, 'CommentsIsPrivate');
  assert.equal(byField.get('newStatus')?.tier, 3);
});

test('responsible resolves from its TDX marker and is never written', () => {
  const { byField } = resolveDoc(loadUpdateFixture());
  const match = byField.get('responsible');
  assert.ok(match, 'responsible did not resolve');
  assert.equal(match.tier, 1);
  assert.equal(byKey('responsible')?.neverWrite, true);
});
```

Add `import { byKey } from '../src/core/dictionary.ts';` to that file if it is not already imported.

Replace the fill-set test in `test/dictionary.test.ts`:

```ts
// Order matters twice over: Service before its dependent Offering, and
// unchecking "private" before the comment it makes visible.
test('the fill sets are exactly the writable fields of each mode, in order', () => {
  assert.deepEqual(FILL_SETS.create, ['ubitName', 'briefSummary', 'description', 'source', 'service', 'serviceOffering']);
  assert.deepEqual(FILL_SETS.resolve, ['newStatus', 'commentsPrivate', 'comments']);
});

test('every fill-set key exists in the dictionary and is not marked neverWrite', () => {
  for (const key of [...FILL_SETS.create, ...FILL_SETS.resolve]) {
    const def = byKey(key);
    assert.ok(def, `${key} missing from dictionary`);
    assert.notEqual(def?.neverWrite, true, `${key} must be writable`);
  }
});
```

Update that file's import from `FILL_SET` to `FILL_SETS`, and the existing `'serviceOffering', 'additionalInformation',` key-list test to include the four new keys.

- [ ] **Step 2: Run them and watch them fail**

```bash
node --test test/pagemode.test.ts test/dictionary.test.ts test/resolve.test.ts
```

Expected: FAIL — no `pagemode.ts`, no `FILL_SETS`, `byField.get('newStatus')` is `undefined`.

- [ ] **Step 3: Write pageMode**

Create `src/core/pagemode.ts`:

```ts
// Decides which of the two TDX forms the panel is looking at.
/**
 * One selector, not a URL check: the panel runs inside a nested iframe whose
 * location is not always the page the technician thinks they are on, and TDX
 * reuses the same route for several ticket actions. The New Status select
 * exists on the update form and nowhere else.
 */

export type PageMode = 'create' | 'resolve';

export function pageMode(doc: Document): PageMode {
  return doc.querySelector('#NewStatusId, form#frmTicketUpdate') ? 'resolve' : 'create';
}
```

- [ ] **Step 4: Add the dictionary entries**

In `src/core/dictionary.ts`, append to `DICTIONARY` (before the closing `];`):

```ts
  {
    key: 'newStatus',
    label: 'New Status',
    control: 'select',
    fieldTypes: [],
    fieldIds: [],
    labels: ['New Status'],
    patterns: [/^NewStatusId$/i, /new\s*status/i],
    options: ['New', 'In Process', 'On Hold', 'Resolved', 'Closed', 'Cancelled'],
    fixedValue: 'Resolved',
  },
  {
    key: 'comments',
    label: 'Comments',
    control: 'richtext',
    fieldTypes: [],
    fieldIds: [],
    labels: ['Comments'],
    patterns: [/^Comments[_.]Content$/i],
    options: [],
  },
  {
    key: 'commentsPrivate',
    label: 'Make comments private',
    control: 'checkbox',
    fieldTypes: [],
    fieldIds: [],
    labels: ['Make comments private'],
    patterns: [/^CommentsIsPrivate$/i, /comments?\s*is\s*private/i],
    options: [],
  },
  {
    key: 'responsible',
    label: 'Responsible',
    control: 'lookup',
    fieldTypes: ['responsible'],
    fieldIds: ['1279'],
    labels: ['Responsible'],
    patterns: [/^NewResponsibleId$/i, /^responsible$/i],
    options: [],
    // TDX defaults this correctly, and a wrong write reassigns a real
    // person's queue and emails them. Resolved and reported, never written.
    neverWrite: true,
  },
```

- [ ] **Step 5: Replace FILL_SET with FILL_SETS**

In `src/core/dictionary.ts`:

```ts
/** The fields the extension writes on each form, in the order it writes them. */
export const FILL_SETS: Record<PageMode, string[]> = {
  create: ['ubitName', 'briefSummary', 'description', 'source', 'service', 'serviceOffering'],
  // commentsPrivate before comments on purpose: unchecking is what makes the
  // comment client-visible, so a run that dies halfway leaves an unchecked box
  // and no comment — not a private comment that looks sent.
  resolve: ['newStatus', 'commentsPrivate', 'comments'],
};
```

Add the import at the top: `import type { PageMode } from './pagemode.ts';`

- [ ] **Step 6: Fix the two callers**

`src/fill/policy.ts` — change the import and, for now, the two uses, so the build stays green (Task 5 replaces this properly):

```ts
import { DICTIONARY, FILL_SETS, byKey } from '../core/dictionary.ts';
```

then inside `planFill`, `for (const fieldKey of FILL_SETS.create)` and `if (FILL_SETS.create.includes(def.key)) continue;`.

`src/ui/panel.ts` uses `DICTIONARY` only — no change.

- [ ] **Step 7: Run the tests**

```bash
node --test test/pagemode.test.ts test/dictionary.test.ts test/resolve.test.ts && npm run typecheck
```

Expected: PASS. If `newStatus` resolved to a different control, dump the runners-up before touching weights:

```bash
node --test test/resolve.test.ts 2>&1 | head -40
```

- [ ] **Step 8: Full suite, then commit**

```bash
npm run check
git add src/core/pagemode.ts src/core/dictionary.ts src/fill/policy.ts test/pagemode.test.ts test/dictionary.test.ts test/resolve.test.ts
git commit -m "feat: recognise the update form and its four fields"
```

---

### Task 4: Reading rich text as HTML, and the red-block rewrite

**Files:**
- Modify: `src/adapters/richtext.ts`, `test/adapters-richtext.test.ts`
- Create: `src/data/resolved.ts`, `test/resolved.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `readRichTextHtml(control: Control): string`
  - `export interface RedBlock { index: number; text: string; html: string }`
  - `findRedBlocks(html: string, doc: Document): RedBlock[]`
  - `toStepsTemplate(html: string, doc: Document, index: number): string`

- [ ] **Step 1: Write the failing tests**

Create `test/resolved.test.ts`:

```ts
// Tests the red-placeholder detection and rewrite that turns a captured TDX
// "Ticket Resolved" body into an ordinary {{steps}} template.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { findRedBlocks, toStepsTemplate } from '../src/data/resolved.ts';

const doc = new JSDOM('').window.document;

const REDS = [
  ['hex short', '<p><span style="color:#c00">what you tried</span></p>'],
  ['hex long', '<p><span style="color:#FF0000">what you tried</span></p>'],
  ['rgb', '<p><span style="color: rgb(192, 0, 0)">what you tried</span></p>'],
  ['named', '<p><span style="color:red">what you tried</span></p>'],
  ['font tag', '<p><font color="red">what you tried</font></p>'],
];

for (const [name, html] of REDS) {
  test(`red is detected as ${name}`, () => {
    const blocks = findRedBlocks(`<p>Hello</p>${html}<p>Bye</p>`, doc);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.text, 'what you tried');
  });
}

// Falsifiability: if the colour test were "has any colour", this blue run
// would match and every captured template would lose a random paragraph.
test('non-red colours are not placeholders', () => {
  assert.deepEqual(findRedBlocks('<p><span style="color:#0000cc">blue</span></p>', doc), []);
});

test('the whole block is replaced, not just the coloured run', () => {
  const out = toStepsTemplate('<p>Hi</p><p>We <span style="color:red">tried things</span> today</p>', doc, 0);
  assert.match(out, /<p>Hi<\/p>/);
  assert.equal(out.includes('today'), false, 'the block holding the red run must go, or a <ul> lands inside a <p>');
  assert.match(out, /\{\{steps\}\}/);
});

test('two red blocks are both reported so the technician can choose', () => {
  const blocks = findRedBlocks('<p><span style="color:red">one</span></p><div><span style="color:#c00">two</span></div>', doc);
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks.map((b) => b.text), ['one', 'two']);
});

test('toStepsTemplate rewrites only the chosen block', () => {
  const out = toStepsTemplate('<p><span style="color:red">one</span></p><p><span style="color:red">two</span></p>', doc, 1);
  assert.match(out, /one/);
  assert.equal(out.includes('two'), false);
  assert.equal(out.match(/\{\{steps\}\}/g)?.length, 1);
});

test('a body with no red is left alone and reports nothing', () => {
  assert.deepEqual(findRedBlocks('<p>plain</p>', doc), []);
  assert.equal(toStepsTemplate('<p>plain</p>', doc, 0), '<p>plain</p>');
});
```

Add to `test/adapters-richtext.test.ts`:

```ts
test('readRichTextHtml returns markup, where readRichText returns text', () => {
  const { control, iframe } = iframeControl(); // existing helper in this file
  const body = iframe.contentDocument?.body;
  assert.ok(body);
  body.innerHTML = '<p>Removed the <b>stale</b> profile.</p>';
  assert.match(readRichTextHtml(control), /<b>stale<\/b>/);
  assert.equal(readRichText(control).includes('<b>'), false);
});
```

Use whatever the file's existing iframe-control helper is named; if there is none, build the control the same way the neighbouring tests in that file already do.

- [ ] **Step 2: Run them and watch them fail**

```bash
node --test test/resolved.test.ts test/adapters-richtext.test.ts
```

Expected: FAIL — `Cannot find module '../src/data/resolved.ts'`, `readRichTextHtml is not a function`.

- [ ] **Step 3: Add readRichTextHtml**

In `src/adapters/richtext.ts`, directly under `readRichText`:

```ts
/**
 * Current content as markup. `readRichText` returns text because fill policy
 * only needs "is there anything here"; capturing a template needs the tags.
 * Same three-path order as the fill side, for the same reason: whichever
 * state the widget is in, one of them is the live one.
 */
export function readRichTextHtml(control: Control): string {
  const body = sameOriginBody(editorIframe(control));
  if (body) return body.innerHTML.trim();

  const editable = contentEditableIn(control);
  if (editable) return editable.innerHTML.trim();

  return (plainTextarea(control)?.value ?? '').trim();
}
```

- [ ] **Step 4: Write the red-block module**

Create `src/data/resolved.ts`:

```ts
// Turns a captured TDX "Ticket Resolved" comment into a {{steps}} template.
/**
 * TDX's resolved-ticket boilerplate marks the bit you are meant to replace by
 * colouring it red. That is a visual convention, not a marker, so this reads
 * the colour rather than a class or an id — and shows the technician what it
 * matched instead of trusting itself (see the panel's capture preview).
 */

const BLOCK_TAGS = new Set(['P', 'DIV', 'LI', 'TD', 'BLOCKQUOTE', 'SECTION']);

/** One red run found in a captured body, with the block that will be replaced. */
export interface RedBlock {
  index: number;
  /** The red run's own text, for the preview. */
  text: string;
  /** The whole block that would be replaced, so the preview can show what is lost. */
  html: string;
}

export function findRedBlocks(html: string, doc: Document): RedBlock[] {
  const { blocks } = analyse(html, doc);
  return blocks.map(({ el, run }, index) => ({
    index,
    text: (run.textContent ?? '').trim(),
    html: el.outerHTML,
  }));
}

/**
 * Replaces the chosen red run's whole block with a bare `{{steps}}`
 * placeholder. The block, not the run: substituting a `<ul>` into the middle
 * of a `<p>` produces markup CKEditor silently rearranges.
 */
export function toStepsTemplate(html: string, doc: Document, index: number): string {
  const { root, blocks } = analyse(html, doc);
  const target = blocks[index];
  if (!target) return html;

  const placeholder = root.ownerDocument.createElement('p');
  placeholder.textContent = '{{steps}}';
  target.el.replaceWith(placeholder);
  return root.innerHTML;
}

/** Parses once and finds every red run with the block it lives in. Shared so both exports agree on what "block 0" means. */
function analyse(html: string, doc: Document): { root: HTMLElement; blocks: { el: Element; run: Element }[] } {
  // A detached document: parsing into the live page would run nothing (no
  // scripts, no resources) but would still be someone else's DOM to mutate.
  const parsed = doc.implementation.createHTMLDocument('');
  parsed.body.innerHTML = html;

  const blocks: { el: Element; run: Element }[] = [];
  const seen = new Set<Element>();
  for (const run of parsed.body.querySelectorAll('*')) {
    if (!isRed(run)) continue;
    const el = blockAncestor(run, parsed.body);
    if (seen.has(el)) continue;
    seen.add(el);
    blocks.push({ el, run });
  }
  return { root: parsed.body, blocks };
}

function blockAncestor(run: Element, root: Element): Element {
  let el: Element | null = run;
  while (el && el.parentElement && el.parentElement !== root && !BLOCK_TAGS.has(el.tagName)) {
    el = el.parentElement;
  }
  // A red run directly under the body with no block wrapper: replace the run.
  return el && BLOCK_TAGS.has(el.tagName) ? el : run;
}

function isRed(el: Element): boolean {
  const attr = el.getAttribute('color');
  if (attr && isRedValue(attr)) return true;
  const style = el.getAttribute('style');
  if (!style) return false;
  const colour = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(style)?.[1];
  return Boolean(colour && isRedValue(colour.trim()));
}

/** Red-dominant, not "any warm colour": r must be high and clearly beat both g and b. */
function isRedValue(value: string): boolean {
  const rgb = parseColour(value.toLowerCase());
  if (!rgb) return false;
  const [r, g, b] = rgb;
  return r >= 100 && r >= 2 * g && r >= 2 * b;
}

function parseColour(value: string): [number, number, number] | null {
  if (value === 'red') return [255, 0, 0];

  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(value);
  if (!hex) return null;
  const digits = hex[1]!;
  const pair = (i: number): number => (digits.length === 3
    ? parseInt(digits[i]!.repeat(2), 16)
    : parseInt(digits.slice(i * 2, i * 2 + 2), 16));
  return [pair(0), pair(1), pair(2)];
}
```

- [ ] **Step 5: Run the tests**

```bash
node --test test/resolved.test.ts test/adapters-richtext.test.ts && npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
npm run check
git add src/adapters/richtext.ts src/data/resolved.ts test/resolved.test.ts test/adapters-richtext.test.ts
git commit -m "feat: detect the red placeholder in a captured resolved comment"
```

---

### Task 5: Steps rendering and the resolve fill policy

**Files:**
- Modify: `src/types.ts`, `src/data/templates.ts`, `src/data/stores.ts`, `src/fill/policy.ts`
- Modify: `test/templates.test.ts`, `test/policy.test.ts`

**Interfaces:**
- Consumes: `FILL_SETS` and `PageMode` (Task 3), checkbox shape (Task 2).
- Produces:
  - `Template.steps?: string`
  - `Settings.resolvedCommentHtml?: string | null`
  - `stepsToHtml(steps: string): string` in `src/data/templates.ts`
  - `planFill` accepts `mode?: PageMode`, `steps?: string`, `resolvedCommentHtml?: string | null`
  - `ValueOutcome`'s value widens to `string | Captured | boolean`

- [ ] **Step 1: Write the failing tests**

Add to `test/templates.test.ts`:

```ts
test('stepsToHtml makes one bullet per non-blank line and escapes each', () => {
  assert.equal(
    stepsToHtml('Removed the stale profile\n\nRan the CAT tool <b>\n'),
    '<ul><li>Removed the stale profile</li><li>Ran the CAT tool &lt;b&gt;</li></ul>',
  );
});

// Falsifiability: a single line must still be a list, or the fill has two
// shapes to reason about instead of one.
test('a single step is still a list', () => {
  assert.equal(stepsToHtml('Rebooted'), '<ul><li>Rebooted</li></ul>');
});

test('blank steps make no list at all', () => {
  assert.equal(stepsToHtml('  \n \n'), '');
});
```

Add to `test/policy.test.ts`:

```ts
const RESOLVED_BODY = '<p>Your ticket is resolved.</p><p>{{steps}}</p><p>Thanks.</p>';

const resolveSetup = () => {
  const doc = loadUpdateFixture();
  const controls = harvest(doc);
  return { doc, resolution: resolve(controls) };
};

test('resolve mode sets the status, unchecks private, and fills the comment', async () => {
  const { doc, resolution } = resolveSetup();
  const rows = await runFill({
    resolution,
    mode: 'resolve',
    requestor: REQUESTOR,
    settings: settings(),
    resolvedCommentHtml: RESOLVED_BODY,
    steps: 'Removed the stale profile\nRan the CAT tool',
  }, { bridge });

  const status = selectEl(doc, 'NewStatusId');
  assert.equal(status.options[status.selectedIndex]?.textContent?.trim(), 'Resolved');
  assert.equal(inputEl(doc, 'CommentsIsPrivate').checked, false);
  assert.equal(row(rows, 'comments')?.status, 'filled');
  assert.match(textareaEl(doc, 'Comments_Content').value, /<li>Removed the stale profile<\/li>/);
});

// Falsifiability: the private checkbox starts checked. If planFill applied its
// normal preserve rule to checkboxes, this row would come back 'preserved'
// with overwrite off and the comment would go out invisible to the client.
test('the private checkbox is unchecked even with overwrite off', async () => {
  const { doc, resolution } = resolveSetup();
  assert.equal(inputEl(doc, 'CommentsIsPrivate').checked, true, 'fixture must start checked');
  await runFill({
    resolution, mode: 'resolve', requestor: REQUESTOR, settings: settings({ overwrite: false }),
    resolvedCommentHtml: RESOLVED_BODY, steps: 'Rebooted',
  }, { bridge });
  assert.equal(inputEl(doc, 'CommentsIsPrivate').checked, false);
});

test('no captured template blocks only the comment row', async () => {
  const { doc, resolution } = resolveSetup();
  const rows = await runFill({
    resolution, mode: 'resolve', requestor: REQUESTOR, settings: settings(), steps: 'Rebooted',
  }, { bridge });
  assert.equal(row(rows, 'comments')?.status, 'needs-confirm');
  assert.match(row(rows, 'comments')?.detail ?? '', /capture the resolved template/i);
  assert.equal(row(rows, 'newStatus')?.status, 'filled');
  assert.equal(inputEl(doc, 'CommentsIsPrivate').checked, false);
});

test('empty steps block only the comment row', async () => {
  const { resolution } = resolveSetup();
  const rows = await runFill({
    resolution, mode: 'resolve', requestor: REQUESTOR, settings: settings(),
    resolvedCommentHtml: RESOLVED_BODY, steps: '   ',
  }, { bridge });
  assert.equal(row(rows, 'comments')?.status, 'needs-confirm');
  assert.match(row(rows, 'comments')?.detail ?? '', /what you tried/i);
});

// Falsifiability: responsible is resolvable on this form, so if neverWrite
// stopped being honoured it would appear as a write row here.
test('responsible is reported, never written', async () => {
  const { resolution } = resolveSetup();
  const rows = await runFill({
    resolution, mode: 'resolve', requestor: REQUESTOR, settings: settings(),
    resolvedCommentHtml: RESOLVED_BODY, steps: 'Rebooted',
  }, { bridge });
  const responsible = row(rows, 'responsible');
  assert.ok(responsible, 'responsible must still be reported');
  assert.equal(responsible.action, 'report');
});
```

Add `loadUpdateFixture` to that file's helpers import, and a `textareaEl`/`selectEl`/`inputEl` helper if the file lacks one — it already has `inputEl`, `selectEl`, `textareaEl`.

- [ ] **Step 2: Run them and watch them fail**

```bash
node --test test/templates.test.ts test/policy.test.ts
```

Expected: FAIL — `stepsToHtml is not a function`; `mode` not accepted; comment rows absent.

- [ ] **Step 3: Widen the types**

`src/types.ts` — `Template` and `Settings`:

```ts
export interface Template {
  id: string;
  name: string;
  summary: string;
  descriptionHtml: string;
  service: Captured | null;
  serviceOffering?: Captured | null;
  /** Canned troubleshooting steps, one per line, pre-filled into the resolve panel's box. */
  steps?: string;
}
```

```ts
export interface Settings {
  threshold: number;
  overwrite: boolean;
  collapsed?: boolean;
  /** The captured "Ticket Resolved" body, red placeholder already rewritten to {{steps}}. */
  resolvedCommentHtml?: string | null;
}
```

`src/data/stores.ts`:

```ts
export const DEFAULT_SETTINGS: Settings = { threshold: 0.35, overwrite: false, resolvedCommentHtml: null };
```

- [ ] **Step 4: Add steps rendering**

In `src/data/templates.ts`, add `'steps'` to `SUPPORTED`:

```ts
const SUPPORTED = ['name', 'ubitName', 'email', 'personNumber', 'date', 'time', 'steps'];
```

and export, beside `escapeHtml`:

```ts
/**
 * One bullet per non-blank line. Always a list, even for a single step — one
 * shape to reason about at the call site instead of two. Each line is escaped
 * here, so the result is substituted unescaped (the same split renderTemplate
 * already makes between the plain-text summary and the HTML description).
 */
export function stepsToHtml(steps: string): string {
  const lines = steps.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return '';
  return `<ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`;
}
```

Add `steps` to the five walk-up templates, e.g. for `eduroam`:

```ts
    steps: 'Removed the stale eduroam profile from the device\nRan the eduroam CAT configuration tool\nSigned in with UBITName credentials and accepted the certificate prompt\nConfirmed the device reached the internet',
```

`eduroam-reconfigure`:

```ts
    steps: 'Forgot the existing eduroam network on the device\nRe-ran the eduroam CAT configuration tool\nConfirmed the device reconnected and reached the internet',
```

`password-reset`:

```ts
    steps: 'Verified photo ID in person against the account record\nUser set the new password themselves\nReminded them to update saved credentials on phones, tablets and eduroam profiles\nConfirmed sign-in before they left',
```

`duo`:

```ts
    steps: 'Verified identity in person\nInstalled Duo Mobile and enrolled the device\nTested a push notification end to end\nDiscussed a backup method in case the phone is lost',
```

`duo-bypass`:

```ts
    steps: 'Verified identity in person\nGenerated a bypass code and gave it to the requestor\nExplained that the code is single-use and expires\nConfirmed they could sign in with it',
```

- [ ] **Step 5: Teach the policy about modes**

In `src/fill/policy.ts`:

```ts
import { DICTIONARY, FILL_SETS, byKey } from '../core/dictionary.ts';
import { renderTemplate, stepsToHtml, substitute } from '../data/templates.ts';
import type { PageMode } from '../core/pagemode.ts';
```

`PlanFillArgs` gains three fields:

```ts
  /** Which form this is. Decides the fill set; defaults to the create form. */
  mode?: PageMode;
  /** Resolve mode only: the technician's troubleshooting steps, one per line. */
  steps?: string;
  /** Resolve mode only: the captured "Ticket Resolved" body carrying {{steps}}. */
  resolvedCommentHtml?: string | null;
```

`planFill`'s signature and body:

```ts
export function planFill({
  resolution, requestor, template = null, service = null, serviceOffering = null,
  mode = 'create', steps = '', resolvedCommentHtml = null, settings, now = new Date(),
}: PlanFillArgs): FillRow[] {
```

then `for (const fieldKey of FILL_SETS[mode])`, `if (FILL_SETS[mode].includes(def.key)) continue;`, and the `valueFor` call:

```ts
    const outcome = valueFor(fieldKey, { rendered, requestor, service, serviceOffering, steps, resolvedCommentHtml });
```

Exempt checkboxes from the preserve rule — replace the `if (existing && !settings.overwrite)` guard's condition:

```ts
    const existing = currentValue(match.control);
    // Checkboxes are exempt: unchecking IS the write, and "already has a
    // value" is meaningless for a boolean. Preserving here would leave the
    // private-comment box checked and send an invisible resolution.
    if (existing && !settings.overwrite && match.control.shape !== 'checkbox') {
```

Widen the outcome type:

```ts
type ValueOutcome =
  | { kind: 'value'; value: string | Captured | boolean }
  | { kind: 'blocked'; status: FillStatus; detail: string };
```

and add the three arms to `valueFor`, whose parameter object gains `steps: string; resolvedCommentHtml: string | null`:

```ts
    case 'newStatus':
      return { kind: 'value', value: byKey('newStatus')?.fixedValue ?? 'Resolved' };
    case 'commentsPrivate':
      // false = unchecked = the client can read it.
      return { kind: 'value', value: false };
    case 'comments': {
      if (!resolvedCommentHtml) {
        return { kind: 'blocked', status: 'needs-confirm', detail: 'capture the resolved template first: pick Templates > ALL > Ticket Resolved on the form, then Capture' };
      }
      const list = stepsToHtml(steps);
      if (!list) {
        return { kind: 'blocked', status: 'needs-confirm', detail: 'type what you tried before filling — this comment is visible to the client' };
      }
      return { kind: 'value', value: substitute(resolvedCommentHtml, { steps: list }, { escape: false }).text };
    }
```

Also widen `FillRow.value` in `src/types.ts`:

```ts
  value: string | Captured | boolean | null;
```

- [ ] **Step 6: Run the tests**

```bash
node --test test/templates.test.ts test/policy.test.ts && npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Full suite, then commit**

```bash
npm run check
git add src/types.ts src/data/templates.ts src/data/stores.ts src/fill/policy.ts test/templates.test.ts test/policy.test.ts
git commit -m "feat: fill status, private flag and comment on the update form"
```

---

### Task 6: Resolve mode in the panel

**Files:**
- Modify: `src/ui/panel.ts`, `src/ui/settings.ts`, `src/ui/panel.css.ts`
- Modify: `test/panel.test.ts`, `test/settings.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–5.
- Produces: no new exports. Panel behaviour only.

- [ ] **Step 1: Write the failing tests**

Add to `test/panel.test.ts` (add `loadUpdateFixture` to the helpers import):

```ts
const RESOLVED_CAPTURE = '<p>Your ticket has been resolved.</p><p><span style="color:red">what we tried</span></p>';

test('the panel renders resolve sections on the update form', async () => {
  const { $ } = await open(loadUpdateFixture());
  assert.ok($('[data-section="steps"]'), 'steps section missing');
  assert.ok($('button[data-capture-resolved]'), 'capture button missing');
  assert.equal($('[data-section="service"]'), null, 'service section belongs to the create form only');
});

test('capture rewrites the red block to a {{steps}} template and stores it', async () => {
  const doc = loadUpdateFixture();
  const editor = doc.querySelector<HTMLTextAreaElement>('#Comments_Content');
  assert.ok(editor);
  editor.value = RESOLVED_CAPTURE;

  const { $, stores } = await open(doc);
  click(must($('button[data-capture-resolved]'), 'capture button missing'), doc);
  await settle();
  click(must($('button[data-confirm-capture]'), 'confirm button missing'), doc);
  await settle();

  const saved = (await stores.settings.get()).resolvedCommentHtml ?? '';
  assert.match(saved, /\{\{steps\}\}/);
  assert.equal(saved.includes('what we tried'), false);
});

test('capture refuses an empty editor instead of storing nothing', async () => {
  const { $, stores } = await open(loadUpdateFixture());
  click(must($('button[data-capture-resolved]'), 'capture button missing'), doc0($));
  await settle();
  assert.equal((await stores.settings.get()).resolvedCommentHtml ?? null, null);
});

test('choosing a template pre-fills the steps box, and the box stays editable', async () => {
  const doc = loadUpdateFixture();
  const { $ } = await open(doc);
  const template = must($<HTMLSelectElement>('select[name="template"]'), 'template select missing');
  template.value = 'eduroam';
  change(template, doc);
  await settle();
  const steps = must($<HTMLTextAreaElement>('textarea[name="steps"]'), 'steps box missing');
  assert.match(steps.value, /CAT configuration tool/);
});
```

`doc0` is not a real helper — replace that third test's body with the same `const doc = loadUpdateFixture(); const { $, stores } = await open(doc);` shape as its neighbours and click with `doc`.

Add to `test/settings.test.ts`:

```ts
test('the captured resolved template can be cleared', async () => {
  const stores = createStores(createMemoryArea());
  await stores.settings.patch({ resolvedCommentHtml: '<p>{{steps}}</p>' });
  const view = await renderSettings({ doc, stores, guarded: (fn) => () => { void fn(); } });
  const clear = view.querySelector('button[data-clear-resolved]');
  assert.ok(clear, 'clear button missing');
  clear.dispatchEvent(new doc.defaultView!.Event('click', { bubbles: true }));
  await new Promise((r) => setImmediate(r));
  assert.equal((await stores.settings.get()).resolvedCommentHtml, null);
});
```

Match that file's existing `renderSettings` call shape rather than inventing one.

- [ ] **Step 2: Run them and watch them fail**

```bash
node --test test/panel.test.ts test/settings.test.ts
```

Expected: FAIL — no steps section, no capture button.

- [ ] **Step 3: Add the mode and the new state**

In `src/ui/panel.ts`, add imports:

```ts
import { pageMode } from '../core/pagemode.ts';
import { findRedBlocks, toStepsTemplate, type RedBlock } from '../data/resolved.ts';
import { readRichTextHtml } from '../adapters/richtext.ts';
```

Add to `PanelState`:

```ts
  /** Resolve mode: the troubleshooting steps textarea, kept here so a re-render does not wipe it. */
  steps: string;
  /** Resolve mode: a capture awaiting confirmation — never stored until the technician says so. */
  capture: { html: string; blocks: RedBlock[]; chosen: number } | null;
```

initialised to `steps: '', capture: null`, and beside `let controls = harvest(document);`:

```ts
  const mode = pageMode(document);
```

- [ ] **Step 4: Branch the body**

In `body()`, replace the single `wrap.append(...)` line with:

```ts
    if (mode === 'resolve') {
      wrap.append(requestorSection(), await templateSection(), stepsSection(), await resolveSection(), fillSection(current), resultsSection());
    } else {
      wrap.append(requestorSection(), await templateSection(), await serviceSection(), fillSection(current), resultsSection());
    }
```

In `templateSection`'s change listener, pre-fill the steps box:

```ts
    select.addEventListener('change', guarded(async () => {
      state.templateId = select.value;
      state.confirmedService = null; // a new template means a new service decision
      state.confirmedOffering = null;
      // Blunt on purpose: changing template is an explicit act, and
      // dirty-tracking is state nobody asked for.
      if (mode === 'resolve') state.steps = (await selectedTemplate()).steps ?? '';
      return render();
    }));
```

- [ ] **Step 5: Add the two new sections**

```ts
  function stepsSection(): HTMLElement {
    const el = sectionEl('steps', 'What you tried');
    const box = document.createElement('textarea');
    box.name = 'steps';
    box.setAttribute('aria-label', 'Troubleshooting steps, one per line');
    box.placeholder = 'One step per line';
    box.value = state.steps;
    box.addEventListener('input', () => { state.steps = box.value; });
    el.append(box, noteEl('One line per bullet. This comment is visible to the client.'));
    return el;
  }

  async function resolveSection(): Promise<HTMLElement> {
    const el = sectionEl('resolved', 'Resolved template');
    const current = await stores.settings.get();

    const line = document.createElement('p');
    line.className = 'note';
    line.textContent = current.resolvedCommentHtml
      ? 'Captured. Fill will substitute your steps into it.'
      : 'Not captured yet. On the form pick Templates > ALL > Ticket Resolved, then Capture.';
    el.append(line);

    const capture = button('Capture resolved template', () => {
      const control = resolution.byField.get('comments')?.control;
      const html = control ? readRichTextHtml(control) : '';
      if (!html) {
        setError('Nothing to capture: the comment editor is empty. Pick Templates > ALL > Ticket Resolved on the form first.');
        return render();
      }
      const blocks = findRedBlocks(html, document);
      if (!blocks.length) {
        setError('Captured no red placeholder text. Check the template loaded, or clear the red text yourself and capture again.');
        return render();
      }
      state.capture = { html, blocks, chosen: 0 };
      return render();
    });
    capture.setAttribute('data-capture-resolved', '');
    el.append(capture);

    if (state.capture) el.append(capturePreview(state.capture));
    return el;
  }

  /** Shows exactly which block will be replaced before anything is stored — the check the red heuristic needs. */
  function capturePreview(capture: NonNullable<PanelState['capture']>): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'preview';
    wrap.append(noteEl(capture.blocks.length > 1
      ? 'Pick the block your steps replace. Everything else in it is dropped.'
      : 'This block will be replaced by your steps. Everything else in it is dropped.'));

    for (const block of capture.blocks) {
      const row = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'red-block';
      radio.checked = block.index === capture.chosen;
      radio.addEventListener('change', () => {
        capture.chosen = block.index;
      });
      const text = document.createElement('span');
      text.textContent = block.text;
      row.append(radio, text);
      wrap.append(row);
    }

    const confirm = button('Save captured template', async () => {
      await stores.settings.patch({
        resolvedCommentHtml: toStepsTemplate(capture.html, document, capture.chosen),
      });
      state.capture = null;
      return render();
    }, 'primary');
    confirm.setAttribute('data-confirm-capture', '');

    const cancel = button('Cancel', () => { state.capture = null; return render(); });
    cancel.setAttribute('data-cancel-capture', '');

    const row = document.createElement('div');
    row.className = 'row';
    row.append(confirm, cancel);
    wrap.append(row);
    return wrap;
  }
```

- [ ] **Step 6: Pass the mode into the fill**

In `fillSection`'s fill button, replace the `runFill` call's argument object:

```ts
      state.rows = await runFill({
        resolution,
        mode,
        requestor: state.requestor ?? EMPTY_REQUESTOR,
        template,
        service,
        serviceOffering,
        steps: state.steps,
        resolvedCommentHtml: (await stores.settings.get()).resolvedCommentHtml ?? null,
        settings: await stores.settings.get(),
        now: now(),
      }, { bridge, refind: async (fieldKey) => { await rescan(); return resolution.byField.get(fieldKey)?.control ?? null; } });
```

- [ ] **Step 7: Add the Settings row**

In `src/ui/settings.ts`'s `buildSections`, after the threshold section:

```ts
  const resolvedSection = section(doc, 'Captured resolved template');
  if (settings.resolvedCommentHtml) {
    const clear = doc.createElement('button');
    clear.type = 'button';
    clear.textContent = 'Clear';
    clear.setAttribute('data-clear-resolved', '');
    clear.addEventListener('click', guarded(async () => {
      await stores.settings.patch({ resolvedCommentHtml: null });
      onChange();
      await rerender();
    }));
    resolvedSection.append(note(doc, 'Captured. Clear it after UBIT edits the Ticket Resolved template, then capture again.'), clear);
  } else {
    resolvedSection.append(note(doc, 'Nothing captured yet. Capture it from a ticket update form.'));
  }
  sections.push(resolvedSection);
```

- [ ] **Step 8: Style the preview**

In `src/ui/panel.css.ts`, append to the CSS string:

```css
.preview { margin-top: 6px; display: flex; flex-direction: column; gap: 4px; }
.preview label { display: flex; gap: 6px; align-items: baseline; font-size: 12px; }
textarea[name="steps"] { width: 100%; min-height: 72px; }
```

- [ ] **Step 9: Run the tests**

```bash
node --test test/panel.test.ts test/settings.test.ts && npm run typecheck
```

Expected: PASS.

- [ ] **Step 10: Full suite, build, commit**

```bash
npm run check && npm run build
git add src/ui/panel.ts src/ui/settings.ts src/ui/panel.css.ts test/panel.test.ts test/settings.test.ts
git commit -m "feat: resolve mode in the panel, with a capture preview"
```

---

### Task 7: Documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the second form**

Under "What it fills", after the existing five-field paragraph:

```markdown
On a ticket **update** form the panel switches to resolve mode and writes three
fields: New Status (`Resolved`), the private-comment checkbox (unchecked, so
the client can read the reply), and Comments.

**Responsible is never written.** TDX defaults it to the right account, and a
wrong write reassigns a real person's queue and emails them. It shows in the
results as resolved-and-reported.

The comment body comes from TDX's own template. Once per instance: open
Templates → ALL → Ticket Resolved on a real update form, then click **Capture
resolved template** in the panel. The panel finds the red placeholder text,
shows you which block it will replace, and stores the body with a `{{steps}}`
placeholder in its place. Every later resolve substitutes your troubleshooting
steps — one line per bullet — into that spot. Clear the capture in Settings
when UBIT edits the template.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: describe resolve mode and the capture step"
```

---

## Self-Review

**Spec coverage:** page facts → Task 1 fixture; mode + fill sets + dictionary → Task 3; checkbox shape → Task 2; `readRichTextHtml` + red detection + block replacement + storage → Tasks 4 and 5 (`Settings.resolvedCommentHtml`); steps + canned steps + bullets → Task 5; fill flow and both blocked cases → Task 5; capture preview and refusals → Task 6; Settings clear → Task 6; tests → each task; accepted limits → comments carried in the code blocks above. `responsible` never-write is pinned in Tasks 3 and 5.

**Placeholders:** none — every code step carries real code, every test step real assertions. Two spots name an existing helper rather than repeating it (`test/adapters-richtext.test.ts`'s iframe control, `test/settings.test.ts`'s `renderSettings` call shape); both say to match the file's existing shape, because inventing a second one would be the bug.

**Type consistency:** `PageMode` is defined in Task 3 and consumed in Tasks 5 and 6. `RedBlock` is defined in Task 4 and consumed in Task 6. `stepsToHtml` is defined in Task 5 and used only there. `FILL_SETS` replaces `FILL_SET` in Task 3, and Task 3 fixes `policy.ts` in the same step so the tree never breaks between commits. `FillRow.value` and `ValueOutcome` widen together in Task 5.
