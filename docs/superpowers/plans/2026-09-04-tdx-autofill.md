# TDX Autofill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Manifest V3 Chrome extension that fills five fields on any TeamDynamix ticket form at `ubuffalo.teamdynamix.com` by resolving fields semantically, with every write verified by read-back and zero network requests.

**Architecture:** A content script mounts a shadow-DOM panel in whichever frame contains the ticket form. A four-tier resolver maps DOM controls to canonical fields using TDX's own `data-fieldtype`/`data-fieldid` markers first and label/option-set scoring as the portable fallback. Shape-specific adapters perform the writes through native prototype setters and verify by reading back. A page-world bridge exists solely to reach `window.CKEDITOR` for the description field.

**Tech Stack:** TypeScript, no runtime dependencies. `esbuild` for bundling (MV3 content scripts cannot be ES modules; esbuild compiles TS natively). `tsc --noEmit` for type checking. `node:test` + `jsdom` for tests, run directly on `.ts` files via Node 24's native type stripping — no ts-node, no tsx, no loader. Docker pins the toolchain so build and test behave identically on any machine. Node 24 LTS.

**Spec:** `docs/superpowers/specs/2026-09-04-tdx-autofill-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **Zero network requests.** No `fetch`, `XMLHttpRequest`, `WebSocket`, `navigator.sendBeacon`, no CDN assets, no hosted models, no telemetry. Enforced by test in Task 15.
- **Never call `submit()`** on any form, and never click a submit control.
- **Affiliation is never written.** Resolve it, report it as `skipped — out of fill scope`, never pass it a value.
- **Fill set is exactly five fields:** `ubitName`, `briefSummary`, `description`, `source`, `service`. Everything else in the dictionary resolves and reports but has no write path.
- **Source's exact option string is `Walkup`.** Not "Walk In", not "Walkup ".
- **Preserve by default.** A non-empty control is left alone and reported `preserved`, unless the overwrite toggle is on for that fill.
- **Every adapter returns `{status, detail}`** where `status` is one of `filled | preserved | skipped | failed | needs-confirm`. Never a bare boolean. Never a silent success.
- **Every `filled` is backed by a read-back verification.** Write, then read the control, then compare. Mismatch returns `failed` with expected and actual.
- **Adapters contain no field-specific logic.** They take `(control, value)` and know nothing about which canonical field they serve.
- **No selector strings in fill or adapter logic.** `src/core/dictionary.ts` is the only place field identity is defined.
- **No fixed `setTimeout` sleeps.** Waiting goes through `waitFor(predicate, {timeout})`.
- **Requestor data is never persisted.** It lives in panel memory only.
- **Comments explain the non-obvious why, not the obvious what.**
- Permissions are exactly `["storage"]` plus host permission `https://ubuffalo.teamdynamix.com/*`. Nothing else.
- **TypeScript, strict, no `any`.** `npm run typecheck` passes before every commit. Shared types come from `src/types.ts`. See the Amendment section below for the full rules.
- **Every source file opens with one plain-English sentence** saying what it does in simple words.
- **Ponytail:** the laziest solution that works. No speculative abstraction, no dependency for what a few lines do, shortest working diff.

## Amendment (2026-09-04): TypeScript, Docker, and two authoring rules

Agreed with the project owner after the plan was written. These override the
plan body wherever they conflict, and bind every task.

### 1. TypeScript, not JavaScript

**Every file under `src/`, `test/`, and `scripts/` is `.ts`.** The code blocks in
the tasks below are written as JavaScript: **their logic is normative, their
syntax is not.** Transcribe each one to TypeScript — add parameter and return
types, import shared types from `src/types.ts`, keep the logic and the comments
exactly as written.

Rules that keep this cheap:

- **Node 24 strips types natively.** Tests run as `node --test "test/**/*.test.ts"`
  with no loader and no build step. Nothing compiles before a test runs.
- **Type stripping does not type-check.** `npm run typecheck` (`tsc --noEmit`) is
  a separate gate and must pass before every commit.
- **`erasableSyntaxOnly` is on**, because type stripping cannot handle syntax that
  emits code. No `enum`, no `namespace`, no parameter properties, no
  `declare` merging. Use union-of-string-literals instead of `enum`.
- **Relative imports carry the `.ts` extension** (`import { x } from './y.ts'`).
  Required by both Node's stripper and `allowImportingTsExtensions`.
- **Use `import type` for type-only imports** (`verbatimModuleSyntax` is on).
- Types describe boundaries, not internals. Do not add a type alias used once, or
  a generic with one instantiation — that is the abstraction ponytail forbids,
  wearing a type annotation.
- **`strict` and `noUncheckedIndexedAccess` are on**, and DOM APIs return nullable
  types the plan's JavaScript ignores. `el.textContent` is `string | null`;
  `querySelector` returns `Element | null`; `arr[0]` is `T | undefined`. Handle
  these with `?? ''`, an early return, or a narrowing check — **never with `any`,
  and never by loosening tsconfig.** A non-null assertion (`!`) is acceptable only
  where the fixture or the DOM contract guarantees presence, and it gets a short
  comment saying why.
- Cast DOM query results to the concrete element type you need
  (`doc.querySelector('#x') as HTMLInputElement | null`) rather than widening the
  variable's type.

`src/types.ts` is created in Task 1 and is the single home for every shape more
than one module touches. Each task's **Interfaces** block names the types it
consumes and produces; those names come from `src/types.ts` verbatim.

### 2. Docker pins the toolchain

Docker cannot ship the extension — a Chrome extension is loaded into the
technician's own browser from `dist/`, not run in a container. What Docker does
here is make **build and test reproducible on any machine**: same Node, same
dependency tree, no "works on mine".

Task 1 adds a `Dockerfile` and a `compose.yaml` with one service, plus
`npm run docker:test` and `npm run docker:build`. `dist/` is bind-mounted back to
the host so a container build produces an extension the host's Chrome can load.
Running `npm test` on the host stays supported and is the fast path.

### 3. Every file opens with one plain-English sentence

Before any other comment, each source file starts with a single sentence saying
what the file does in simple words, for someone who has never seen this codebase.
Not a restatement of the filename. For example:

```ts
// Turns a block of text copied out of TDX into the requestor's name, email, and IDs.
```

The longer `/** ... */` block explaining the non-obvious *why* still follows where
the plan specifies one.

### 4. Ponytail

Build the laziest thing that works. Standard library and native platform features
before dependencies. No interface with one implementation, no factory for one
product, no config for a value that never changes, no scaffolding for later.
Shortest working diff. A deliberate shortcut with a known ceiling gets a
`ponytail:` comment naming the ceiling and the upgrade path.

## Deviation from the spec

The spec's section 10 lists 21 source modules and section 11 points `content_scripts` at them. Chrome MV3 has no module support for content scripts and `import()` from a content script requires `web_accessible_resources`, which the spec rules out. The sources stay exactly as specified; `esbuild` bundles them to `dist/content.js` and `dist/bridge.js`, and the manifest points at those two files. Tests import the ESM sources directly and never load the bundle.

## File Structure

| File | Responsibility |
|---|---|
| `manifest.json` | MV3 declaration, two content scripts, two permissions |
| `package.json` | Scripts and devDependencies (`typescript`, `esbuild`, `jsdom`, types) |
| `tsconfig.json` | Strict, `noEmit`, `erasableSyntaxOnly` so Node can strip types directly |
| `Dockerfile`, `compose.yaml` | Pin Node 24 and the dependency tree so build and test are reproducible |
| `scripts/make-fixture.ts` | Reduces a saved TDX page to the checked-in fixture |
| `src/types.ts` | Every data shape that crosses a module boundary |
| `src/core/dictionary.ts` | Canonical field definitions. The only place field identity lives |
| `src/core/harvest.ts` | Enumerate DOM controls and gather every identifying signal |
| `src/core/resolve.ts` | Four-tier scoring and globally-best-match assignment |
| `src/core/signature.ts` | Stable form-signature hash for the learning store |
| `src/adapters/wait.ts` | `waitFor(predicate, {timeout})` on MutationObserver + poll |
| `src/adapters/text.ts` | Native-setter writes for inputs, textareas, native selects |
| `src/adapters/lookup.ts` | Captured `{id,text}` write and capture read-back |
| `src/adapters/richtext.ts` | CKEditor via bridge, with verified fallbacks |
| `src/adapters/index.ts` | Shape → adapter dispatch |
| `src/content/bridge-main.ts` | Page-world script. Reaches `window.CKEDITOR` only |
| `src/content/mount.ts` | Frame self-test, panel mount |
| `src/data/parser.ts` | Requestor block → `{fields, warnings}` |
| `src/data/stores.ts` | Four stores over `chrome.storage.local` |
| `src/data/templates.ts` | Three shipped templates plus blank, placeholder substitution |
| `src/service/retriever.ts` | TF-IDF cosine retrieval behind a swappable interface |
| `src/fill/policy.ts` | Value and write decisions. The only field-aware layer |
| `src/ui/panel.css.ts` | Stylesheet, exported as a string for the shadow root |
| `src/ui/panel.ts` | Shadow-root panel shell and state |
| `src/ui/results.ts` | Per-field outcome rows and the correction control |
| `src/ui/diagnostics.ts` | Copy-pasteable resolution dump |
| `src/ui/settings.ts` | Templates, threshold, clear learned |
| `test/helpers.ts` | Loads the fixture, and a marker-stripped copy of it |
| `test/fixtures/tdx-form-162.html` | Reduced real form, checked in |
| `test/*.test.ts` | One file per module under test |

---

### Task 1: Project scaffolding and the real-markup fixture

Everything downstream tests against real TDX markup, so the fixture comes first.

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `.dockerignore`, `manifest.json`, `Dockerfile`, `compose.yaml`, `scripts/make-fixture.ts`, `src/types.ts`
- Keep: `test/fixtures/tdx-form-162.html` (already generated and verified — see Step 3)
- Test: `test/fixture.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `test/fixtures/tdx-form-162.html`; the convention that every test loads it via `loadFixture()` from `test/helpers.ts` returning a jsdom `Document`; and `src/types.ts`, the single home for every shared type.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "tdx-autofill",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Semantic autofill for TeamDynamix ticket forms",
  "engines": { "node": ">=24" },
  "scripts": {
    "build": "esbuild src/content/mount.ts --bundle --format=iife --outfile=dist/content.js && esbuild src/content/bridge-main.ts --bundle --format=iife --outfile=dist/bridge.js",
    "test": "node --test \"test/**/*.test.ts\"",
    "typecheck": "tsc --noEmit",
    "check": "npm run typecheck && npm test",
    "docker:test": "docker compose run --rm dev npm run check",
    "docker:build": "docker compose run --rm dev npm run build"
  },
  "devDependencies": {
    "@types/jsdom": "^21.1.7",
    "@types/node": "^22.10.0",
    "esbuild": "^0.24.0",
    "jsdom": "^25.0.0",
    "typescript": "^5.7.0"
  }
}
```

Run: `npm install`

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "skipLibCheck": true
  },
  "include": ["src", "test", "scripts"]
}
```

`erasableSyntaxOnly` is what keeps `node --test` able to run `.ts` directly:
Node strips types, it does not compile them, so any TypeScript syntax that would
emit code (`enum`, `namespace`, parameter properties) must be rejected at
type-check time rather than crashing at run time.

- [ ] **Step 3: Create `.gitignore` and `.dockerignore`**

`.gitignore`:

```
node_modules/
dist/
*.log
.superpowers/
```

`.dockerignore`:

```
node_modules
dist
.git
.superpowers
docs
```

- [ ] **Step 4: Create the Docker toolchain**

Docker cannot run the extension — Chrome loads it from `dist/` on the
technician's own machine. What it pins is the build and the tests, so they behave
the same everywhere.

`Dockerfile`:

```dockerfile
# Pins Node and the dependency tree so tests and builds behave the same on any machine.
FROM node:24-alpine

WORKDIR /app

# Dependencies are their own layer: source edits do not trigger a reinstall.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

CMD ["npm", "run", "check"]
```

`compose.yaml`:

```yaml
# One service that runs this project's tests and builds inside a pinned Node 24 image.
services:
  dev:
    build: .
    working_dir: /app
    volumes:
      # Source is bind-mounted so edits are picked up without a rebuild, and so a
      # container build writes dist/ back to the host for Chrome to load.
      - .:/app
      # Keeps the image's node_modules; the host's may be built for another platform.
      - /app/node_modules
```

Verify both work:

```bash
npm run docker:test
```

Expected: the image builds and the type check plus test suite run inside it.
If Docker is unavailable on this machine, note it in the report and move on —
the host `npm run check` path is the one the rest of the plan depends on.

- [ ] **Step 4b: Create `src/types.ts`**

Every shape that crosses a module boundary lives here, so sixteen later tasks
cannot each invent a different name for the same thing. Types used inside one
module stay in that module.

```ts
// The shared vocabulary: every data shape that more than one part of the extension passes around.

/** How a control must be written, which decides the adapter that handles it. */
export type ControlShape = 'text' | 'select' | 'select2' | 'lookup' | 'richtext';

/** What a canonical field expects its control to be. Narrower than ControlShape. */
export type ControlKind = 'text' | 'select' | 'lookup' | 'richtext';

/** The outcome of trying to write one field. Never a bare boolean. */
export type FillStatus = 'filled' | 'preserved' | 'skipped' | 'failed' | 'needs-confirm';

/** What every adapter returns: what happened, and why in one short phrase. */
export interface AdapterResult {
  status: FillStatus;
  detail: string;
}

/** The three elements a TDX type-ahead lookup is really made of. */
export interface LookupParts {
  hidden: HTMLInputElement;
  input: HTMLInputElement;
  reset: HTMLInputElement | null;
}

/** A TDX lookup value: the id TDX submits, and the text a human reads. */
export interface Captured {
  id: string;
  text: string;
}

/** One fillable control on the page, with every signal that could identify it. */
export interface Control {
  key: string;
  el: Element;
  shape: ControlShape;
  fieldType: string | null;
  fieldId: string | null;
  label: string | null;
  name: string | null;
  id: string | null;
  placeholder: string | null;
  aria: string | null;
  options: string[];
  lookup: LookupParts | null;
  richtext: { textarea: HTMLTextAreaElement; instanceKey: string } | null;
}

/** One canonical field: everything known about how to recognise it. */
export interface FieldDef {
  key: string;
  label: string;
  control: ControlKind;
  fieldTypes: string[];
  fieldIds: string[];
  labels: string[];
  patterns: RegExp[];
  options: string[];
  fixedValue?: string;
  neverWrite?: boolean;
}

/** A field matched to a control, with how sure we are and which tier decided it. */
export interface Match {
  fieldKey: string;
  control: Control;
  confidence: number;
  tier: 0 | 1 | 2 | 3;
  evidence: string;
}

/** What the resolver saw for one control: what won, and what nearly won. */
export interface Diag {
  control: Control;
  winner: Match | null;
  runnersUp: { fieldKey: string; score: number; evidence: string }[];
}

/** The whole result of resolving a page. */
export interface Resolution {
  byField: Map<string, Match>;
  byControl: Map<string, Match>;
  unresolvedFields: string[];
  diagnostics: Diag[];
}

/** The requestor, as parsed out of a pasted TDX block. Null means not found. */
export interface RequestorFields {
  name: string | null;
  email: string | null;
  personGuid: string | null;
  personNumber: string | null;
  ubitName: string | null;
  title: string | null;
  organization: string | null;
}

/** A saved issue template: what to write, and which service it belongs to. */
export interface Template {
  id: string;
  name: string;
  summary: string;
  descriptionHtml: string;
  service: Captured | null;
}

/** One past ticket the technician confirmed, used to suggest a service later. */
export interface Example {
  id: string;
  savedAt: string;
  description: string;
  service: Captured;
}

/** A service the retriever thinks fits, with how well and which past tickets say so. */
export interface Ranked {
  service: Captured;
  score: number;
  evidence: { exampleId: string; snippet: string; terms: string[] }[];
}

/** The technician's preferences. */
export interface Settings {
  threshold: number;
  overwrite: boolean;
  diagnostics: boolean;
  collapsed?: boolean;
}

/** One line in the results panel: what happened to one field. */
export interface FillRow {
  fieldKey: string;
  label: string;
  action: 'write' | 'report';
  value: string | Captured | null;
  status: FillStatus | 'pending';
  detail: string;
  control: Control | null;
  confidence?: number;
}

/** The isolated world's handle on the page-world script that can reach CKEditor. */
export interface Bridge {
  setEditorData(instanceKey: string, html: string): Promise<{ ok: boolean; detail: string }>;
}
```

Run `npm run typecheck`. Expected: clean.

- [ ] **Step 5: Write the fixture generator**

The saved capture is 1.4 MB and mostly scripts. This reduces it to the form
subtree, which is the only part the engine reads.

**`test/fixtures/tdx-form-162.html` already exists in the working tree and has
been verified** (91,230 bytes, 19 distinct `data-fieldtype` markers, 28
`data-fieldid` attributes, every control id the later tasks need, scripts
stripped, `__RequestVerificationToken` reading `REDACTED`). Do not regenerate it.
Write the generator anyway — it is how the fixture gets refreshed when TDX
changes — and confirm re-running it against the source produces the same file.

Create `scripts/make-fixture.ts`:

```ts
// Cuts a saved 1.4 MB TDX page down to just the ticket form, so tests have real markup to work with.
//
// Run once; the output is checked in so tests never depend on a local download.
//   node scripts/make-fixture.ts "<path to saved New.html>" test/fixtures/tdx-form-162.html
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error('usage: make-fixture.ts <input.html> <output.html>');
  process.exit(1);
}

let html = readFileSync(input, 'utf8');

// Scripts are ~95% of the bytes and none of the signal. The resolver reads
// markup attributes only, so stripping them keeps the fixture honest.
html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
html = html.replace(/<link\b[^>]*>/gi, '');

const start = html.search(/<form\b/i);
const end = html.toLowerCase().lastIndexOf('</form>');
if (start === -1 || end === -1) {
  console.error('no <form> found in input');
  process.exit(1);
}
let form = html.slice(start, end + '</form>'.length);

// The anti-forgery token is a real session credential. It must not be committed.
form = form.replace(
  /(name="__RequestVerificationToken"[^>]*value=")[^"]*(")/gi,
  '$1REDACTED$2'
);

mkdirSync(dirname(output), { recursive: true });
writeFileSync(
  output,
  `<!doctype html>\n<html><head><meta charset="utf-8"><title>TDX fixture form 162</title></head>\n<body>\n${form}\n</body></html>\n`
);
console.log(`wrote ${output} (${form.length} bytes of form markup)`);
```

Confirm it reproduces the checked-in fixture (it must leave the file unchanged):

```bash
node scripts/make-fixture.ts "/d/Downloads/Work Management _ UBIT Tech Squad_files/New.html" test/fixtures/tdx-form-162.html
git diff --stat test/fixtures/tdx-form-162.html
```

Expected: `git diff` reports no change. If it does report one, the generator does
not match the fixture that the rest of the plan was verified against — report it
rather than committing a different fixture.

- [ ] **Step 6: Write the test helper**

Create `test/helpers.ts`:

```ts
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
 * Returns the fixture with every TDX-specific semantic marker removed and
 * labels shuffled, simulating a form the engine has never seen. Tier 3 must
 * still resolve the fill set from labels and option values alone.
 */
export function loadUnknownFormFixture(): Document {
  const doc = loadFixture();
  for (const group of doc.querySelectorAll('[data-fieldtype]')) {
    group.removeAttribute('data-fieldtype');
    group.removeAttribute('data-fieldid');
  }
  return doc;
}
```

- [ ] **Step 7: Write the fixture test**

Create `test/fixture.test.ts`:

```ts
// Checks the saved TDX form still carries every signal the resolver reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFixture, loadUnknownFormFixture } from './helpers.ts';

test('fixture carries the TDX semantic markers the resolver depends on', () => {
  const doc = loadFixture();
  const types = [...doc.querySelectorAll('[data-fieldtype]')]
    .map((el) => el.getAttribute('data-fieldtype'));
  for (const expected of ['requestor', 'title', 'description', 'source', 'service']) {
    assert.ok(types.includes(expected), `missing data-fieldtype="${expected}"`);
  }
});

test('fixture carries the custom-attribute ids the resolver depends on', () => {
  const doc = loadFixture();
  assert.ok(doc.querySelector('[data-fieldid="2445"]'), 'missing UBITName group 2445');
  assert.ok(doc.querySelector('[data-fieldid="2706"]'), 'missing Affiliation group 2706');
});

test('fixture carries the Walkup option and the lookup triple', () => {
  const doc = loadFixture();
  const sourceOptions = [...doc.querySelectorAll('#attribute371 option')].map((o) => o.textContent.trim());
  assert.ok(sourceOptions.includes('Walkup'));
  assert.ok(doc.querySelector('#attribute789'), 'service hidden input');
  assert.ok(doc.querySelector('#attribute789_input'), 'service visible input');
  assert.ok(doc.querySelector('#attribute789_reset'), 'service reset input');
});

test('fixture contains no session credential', () => {
  const doc = loadFixture();
  const token = doc.querySelector('[name="__RequestVerificationToken"]');
  assert.equal(token?.getAttribute('value'), 'REDACTED');
});

test('unknown-form fixture has no TDX semantic markers left', () => {
  const doc = loadUnknownFormFixture();
  assert.equal(doc.querySelectorAll('[data-fieldtype]').length, 0);
  assert.equal(doc.querySelectorAll('[data-fieldid]').length, 0);
  assert.ok(doc.querySelector('#attribute37'), 'controls themselves must survive');
});
```

- [ ] **Step 8: Run the checks**

Run: `npm run check`
Expected: the type check is clean and all five fixture tests PASS. A test failure here means the fixture lost signal during reduction — fix `make-fixture.ts` rather than weakening the test.

- [ ] **Step 9: Create `manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "TDX Autofill",
  "version": "0.1.0",
  "description": "Semantic autofill for TeamDynamix ticket forms. All processing is local.",
  "permissions": ["storage"],
  "host_permissions": ["https://ubuffalo.teamdynamix.com/*"],
  "content_scripts": [
    {
      "matches": ["https://ubuffalo.teamdynamix.com/*"],
      "js": ["dist/bridge.js"],
      "all_frames": true,
      "run_at": "document_idle",
      "world": "MAIN"
    },
    {
      "matches": ["https://ubuffalo.teamdynamix.com/*"],
      "js": ["dist/content.js"],
      "all_frames": true,
      "run_at": "document_idle"
    }
  ]
}
```

The bridge is declared first so it is installed before the isolated-world script
tries its handshake. `all_frames` is required because the ticket form is in a
nested iframe; every frame self-tests and all but one exit immediately.

The manifest still points at `dist/*.js` — esbuild compiles the TypeScript
sources to those two bundles. Chrome never sees TypeScript.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore .dockerignore \
        Dockerfile compose.yaml manifest.json scripts/ src/ test/
git commit -m "chore: TypeScript scaffolding, Docker toolchain, and real-markup fixture"
```

---

### Task 2: Requestor parser

Acceptance criterion 1. Independent of the DOM, so it comes early.

**Files:**
- Create: `src/data/parser.ts`
- Test: `test/parser.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseRequestor(raw: string) -> { fields, warnings }` where `fields` is
  `{ name, email, personGuid, personNumber, ubitName, title, organization }` with
  `null` for anything absent, and `warnings` is a `string[]`. Never throws.

- [ ] **Step 1: Write the failing test**

Create `test/parser.test.ts`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRequestor } from '../src/data/parser.ts';

const MARKDOWN_BLOCK = `Requestor
[Anh Duy Nghiem](https://ubuffalo.teamdynamix.com/TDNext/Apps/People/PersonDet.aspx?U=b067308b-2198-ef11-9c36-f06ebc4e4310)
[duynghie@buffalo.edu](mailto:duynghie@buffalo.edu)
Student Assistant - ITCX Tech Squad
University at Buffalo
50583450 - duynghie`;

const PLAIN_BLOCK = `Requestor
Anh Duy Nghiem
duynghie@buffalo.edu
Student Assistant - ITCX Tech Squad
University at Buffalo
50583450 - duynghie`;

test('markdown block yields all seven fields including the GUID', () => {
  const { fields, warnings } = parseRequestor(MARKDOWN_BLOCK);
  assert.equal(fields.name, 'Anh Duy Nghiem');
  assert.equal(fields.email, 'duynghie@buffalo.edu');
  assert.equal(fields.personGuid, 'b067308b-2198-ef11-9c36-f06ebc4e4310');
  assert.equal(fields.personNumber, '50583450');
  assert.equal(fields.ubitName, 'duynghie');
  assert.equal(fields.title, 'Student Assistant - ITCX Tech Squad');
  assert.equal(fields.organization, 'University at Buffalo');
  assert.deepEqual(warnings, []);
});

test('plain-text block yields everything except the GUID, and warns', () => {
  const { fields, warnings } = parseRequestor(PLAIN_BLOCK);
  assert.equal(fields.name, 'Anh Duy Nghiem');
  assert.equal(fields.email, 'duynghie@buffalo.edu');
  assert.equal(fields.personNumber, '50583450');
  assert.equal(fields.ubitName, 'duynghie');
  assert.equal(fields.personGuid, null);
  assert.ok(warnings.some((w) => /guid/i.test(w)));
});

test('UBITName comes from the ID line, not the email local part', () => {
  // Aliases exist. The ID line is authoritative; the email may be an alias.
  const aliased = PLAIN_BLOCK.replace('duynghie@buffalo.edu', 'anh.nghiem@buffalo.edu');
  const { fields } = parseRequestor(aliased);
  assert.equal(fields.email, 'anh.nghiem@buffalo.edu');
  assert.equal(fields.ubitName, 'duynghie');
});

test('a malformed paste returns partial fields and warnings instead of throwing', () => {
  const { fields, warnings } = parseRequestor('just some garbage text');
  assert.equal(fields.email, null);
  assert.equal(fields.ubitName, null);
  assert.ok(warnings.length >= 3);
});

test('empty input is handled', () => {
  const { fields, warnings } = parseRequestor('');
  assert.equal(fields.name, null);
  assert.ok(warnings.length > 0);
});

test('the Requestor header line is not mistaken for the name', () => {
  const { fields } = parseRequestor(MARKDOWN_BLOCK);
  assert.notEqual(fields.name, 'Requestor');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/parser.test.ts`
Expected: FAIL — `Cannot find module '../src/data/parser.ts'`

- [ ] **Step 3: Write the implementation**

Create `src/data/parser.ts`:

```js
/**
 * Parses a requestor block copied out of TDX into structured fields.
 *
 * Accepts both the markdown form (links preserved) and a plain-text paste.
 * Never throws: a malformed paste yields partial fields plus warnings, because
 * a parser that throws mid-shift is worse than one that reports what it missed.
 */

const PERSON_GUID = /PersonDet\.aspx\?U=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const MAILTO = /\[[^\]]*\]\(mailto:([^)\s]+)\)/i;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const MD_LINK = /\[([^\]]+)\]\(([^)]+)\)/;
// "50583450 - duynghie". Person number is numeric; UBITName follows the dash.
const ID_LINE = /^(\d{4,})\s*-\s*([A-Za-z0-9._-]+)$/;

const FIELD_KEYS = [
  'name', 'email', 'personGuid', 'personNumber', 'ubitName', 'title', 'organization',
];

export function parseRequestor(raw) {
  const fields = Object.fromEntries(FIELD_KEYS.map((k) => [k, null]));
  const warnings = [];

  const text = typeof raw === 'string' ? raw : '';
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^requestor:?$/i.test(l));

  // Each extraction is independent so one failure cannot cascade into the rest.
  fields.personGuid = text.match(PERSON_GUID)?.[1]?.toLowerCase() ?? null;

  const mailto = text.match(MAILTO)?.[1];
  fields.email = mailto ?? text.match(EMAIL)?.[0] ?? null;

  const idLineIndex = lines.findIndex((l) => ID_LINE.test(l));
  if (idLineIndex !== -1) {
    const [, number, ubit] = lines[idLineIndex].match(ID_LINE);
    fields.personNumber = number;
    // Authoritative. Never derive UBITName from the email local part: aliases exist.
    fields.ubitName = ubit;
  }

  const remaining = [];
  for (const [i, line] of lines.entries()) {
    if (i === idLineIndex) continue;
    if (fields.email && line.includes(fields.email)) continue;
    if (MAILTO.test(line)) continue;
    remaining.push(line);
  }

  if (remaining.length) {
    const first = remaining[0];
    const link = first.match(MD_LINK);
    fields.name = link ? link[1].trim() : first;
    fields.title = remaining[1] ?? null;
    fields.organization = remaining[2] ?? null;
  }

  if (!fields.name) warnings.push('No name found.');
  if (!fields.email) warnings.push('No email found.');
  if (!fields.personGuid) {
    warnings.push('No person GUID found — TDX submits the GUID, so the requestor lookup cannot be driven from this paste.');
  }
  if (!fields.personNumber) warnings.push('No person number found.');
  if (!fields.ubitName) warnings.push('No UBITName found on the ID line.');

  return { fields, warnings };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/parser.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/data/parser.ts test/parser.test.ts
git commit -m "feat: requestor block parser with warnings instead of throws"
```

---

### Task 3: Field dictionary

The only place field identity is defined. No behavior, so its test is a
structural contract check rather than a behavior test.

**Files:**
- Create: `src/core/dictionary.ts`
- Test: `test/dictionary.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `DICTIONARY: FieldDef[]` where `FieldDef` is
    `{ key, label, control, fieldTypes: string[], fieldIds: string[], labels: string[], patterns: RegExp[], options: string[], fixedValue?: string, neverWrite?: boolean }`
  - `FILL_SET: string[]` — the five writable field keys, in fill order.
  - `byKey(key) -> FieldDef | undefined`

- [ ] **Step 1: Write the failing test**

Create `test/dictionary.test.ts`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DICTIONARY, FILL_SET, byKey } from '../src/core/dictionary.ts';

test('every entry has the required shape', () => {
  for (const def of DICTIONARY) {
    assert.equal(typeof def.key, 'string', 'key');
    assert.equal(typeof def.label, 'string', `${def.key} label`);
    assert.ok(['text', 'select', 'lookup', 'richtext'].includes(def.control), `${def.key} control`);
    assert.ok(Array.isArray(def.fieldTypes), `${def.key} fieldTypes`);
    assert.ok(Array.isArray(def.fieldIds), `${def.key} fieldIds`);
    assert.ok(Array.isArray(def.labels), `${def.key} labels`);
    assert.ok(Array.isArray(def.patterns), `${def.key} patterns`);
    assert.ok(Array.isArray(def.options), `${def.key} options`);
  }
});

test('keys are unique', () => {
  const keys = DICTIONARY.map((d) => d.key);
  assert.equal(new Set(keys).size, keys.length);
});

test('the fill set is exactly the five writable fields, in order', () => {
  assert.deepEqual(FILL_SET, ['ubitName', 'briefSummary', 'description', 'source', 'service']);
});

test('every fill-set key exists in the dictionary and is not marked neverWrite', () => {
  for (const key of FILL_SET) {
    const def = byKey(key);
    assert.ok(def, `${key} missing from dictionary`);
    assert.notEqual(def.neverWrite, true, `${key} must be writable`);
  }
});

test('affiliation is present, resolvable, and marked neverWrite', () => {
  const aff = byKey('affiliation');
  assert.ok(aff);
  assert.equal(aff.neverWrite, true);
  assert.ok(!FILL_SET.includes('affiliation'));
});

test('source carries the exact TDX option string as its fixed value', () => {
  assert.equal(byKey('source').fixedValue, 'Walkup');
  assert.ok(byKey('source').options.includes('Walkup'));
});

test('impact and urgency carry their real option strings, which are their strongest signal', () => {
  assert.ok(byKey('impact').options.includes('Low - Affects User'));
  assert.ok(byKey('urgency').options.includes('High - Impacting work'));
});

test('the dictionary covers every canonical field named in the spec', () => {
  const required = [
    'requestor', 'department', 'alternativeContact', 'affiliation', 'ubitName',
    'briefSummary', 'description', 'location', 'locationRoom', 'deviceType',
    'macAddress', 'ipAddress', 'operatingSystem', 'osVersion', 'assetId',
    'status', 'responsible', 'source', 'impact', 'urgency', 'service',
    'serviceOffering', 'additionalInformation',
  ];
  const keys = new Set(DICTIONARY.map((d) => d.key));
  for (const key of required) assert.ok(keys.has(key), `missing canonical field: ${key}`);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/dictionary.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/core/dictionary.ts`:

```js
/**
 * Canonical field definitions. This is the ONLY place in the codebase where a
 * field's identity is described. Adapters and fill policy take resolved
 * controls and values; they never contain a selector or a field name lookup.
 *
 * To support a new field: add an entry here. Nothing else changes.
 *
 * fieldTypes  TDX's own data-fieldtype markers (tier 1). Near-certain.
 * fieldIds    TDX attribute ids, stable instance-wide (tier 2).
 * labels      Exact label texts (tier 3, weight 1.0).
 * patterns    Regexes tested against label, name, id, placeholder (tier 3).
 * options     Known option strings. A select carrying these is this field
 *             regardless of its label — often the strongest signal available.
 * fixedValue  A constant this field is always written with, when writable.
 * neverWrite  Resolve and report, but never pass a value. Safety, not scope.
 */

export const DICTIONARY = [
  {
    key: 'requestor',
    label: 'Requestor',
    control: 'lookup',
    fieldTypes: ['requestor'],
    fieldIds: ['495'],
    labels: ['Who is this request for?', 'Requestor'],
    patterns: [/requestor/i, /who is this request for/i, /contactu?id/i],
    options: [],
  },
  {
    key: 'department',
    label: 'Department',
    control: 'lookup',
    fieldTypes: ['acct/dept'],
    fieldIds: ['38'],
    labels: ['Department', 'Account/Department', 'Acct/Dept'],
    patterns: [/\bdepartment\b/i, /acct\s*\/\s*dept/i, /accountid/i],
    options: [],
  },
  {
    key: 'alternativeContact',
    label: 'Alternative Contact',
    control: 'lookup',
    fieldTypes: ['contact'],
    fieldIds: ['1269'],
    labels: ['Alternative Contact (optional)', 'Alternative Contact'],
    patterns: [/alternative contact/i, /contactuidstr/i],
    options: [],
  },
  {
    key: 'affiliation',
    label: 'Affiliation',
    control: 'select',
    fieldTypes: [],
    fieldIds: ['2706'],
    labels: ['Affiliation'],
    patterns: [/affiliation/i],
    options: ['Alumnus', 'Applicant', 'Faculty', 'Parent', 'Retiree', 'Staff', 'Student', 'Visitor', 'Volunteer'],
    // A person can be a student, an employee, or both. A wrong affiliation
    // misroutes the ticket, so it is never inferred and never written.
    neverWrite: true,
  },
  {
    key: 'ubitName',
    label: 'UBITName',
    control: 'text',
    fieldTypes: [],
    fieldIds: ['2445'],
    labels: ['UBITName', 'UBIT Name'],
    patterns: [/ubit\s*name/i],
    options: [],
  },
  {
    key: 'briefSummary',
    label: 'Brief Summary',
    control: 'text',
    fieldTypes: ['title'],
    fieldIds: ['37'],
    labels: ['Brief Summary', 'Title', 'Summary'],
    patterns: [/brief summary/i, /^title$/i, /^summary$/i],
    options: [],
  },
  {
    key: 'description',
    label: 'Description',
    control: 'richtext',
    fieldTypes: ['description'],
    fieldIds: ['138'],
    labels: ['Description', 'Details'],
    patterns: [/description/i, /^details$/i],
    options: [],
  },
  {
    key: 'location',
    label: 'Location',
    control: 'lookup',
    fieldTypes: ['location'],
    fieldIds: ['701'],
    labels: ['Location', 'Building'],
    patterns: [/^location$/i, /^building$/i, /locationid/i],
    options: [],
  },
  {
    key: 'locationRoom',
    label: 'Location Room',
    control: 'lookup',
    fieldTypes: ['location_room'],
    fieldIds: ['702'],
    labels: ['Location Room', 'Room'],
    patterns: [/location\s*room/i, /^room$/i, /locationroomid/i],
    options: [],
  },
  {
    key: 'deviceType',
    label: 'Device type',
    control: 'select',
    fieldTypes: [],
    fieldIds: ['2751'],
    labels: ['Device type', 'Device Type'],
    patterns: [/device\s*type/i],
    options: ['Desktop', 'IoT Device', 'Laptop', 'Phone - Android', 'Phone - iPhone', 'Tablet', 'Other'],
  },
  {
    key: 'macAddress',
    label: 'MAC Address',
    control: 'text',
    fieldTypes: [],
    fieldIds: ['2455'],
    labels: ['MAC Address'],
    patterns: [/mac\s*address/i],
    options: [],
  },
  {
    key: 'ipAddress',
    label: 'IP Address',
    control: 'text',
    fieldTypes: [],
    fieldIds: ['2757'],
    labels: ['IP Address'],
    patterns: [/\bip\s*address\b/i],
    options: [],
  },
  {
    key: 'operatingSystem',
    label: 'Operating System',
    control: 'select',
    fieldTypes: [],
    fieldIds: ['2616'],
    labels: ['Operating System', 'OS'],
    patterns: [/operating\s*system/i, /^os$/i],
    options: ['Android OS (mobile)', 'Apple iOS (mobile)', 'Linux', 'Mac', 'Windows', 'Other'],
  },
  {
    key: 'osVersion',
    label: 'OS Version',
    control: 'text',
    fieldTypes: [],
    fieldIds: ['2624'],
    labels: ['OS Version'],
    patterns: [/os\s*version/i],
    options: [],
  },
  {
    key: 'assetId',
    label: 'Asset ID',
    control: 'text',
    fieldTypes: [],
    fieldIds: ['3224'],
    labels: ['Asset ID', 'Asset Tag'],
    patterns: [/asset\s*(id|tag)/i],
    options: [],
  },
  {
    key: 'additionalInformation',
    label: 'Additional Information',
    control: 'text',
    fieldTypes: [],
    fieldIds: ['2390'],
    labels: ['Additional Information'],
    patterns: [/additional information/i],
    options: [],
  },
  {
    key: 'status',
    label: 'Status',
    control: 'select',
    fieldTypes: ['status'],
    fieldIds: ['40'],
    labels: ['Status'],
    patterns: [/^status$/i],
    options: ['New', 'In Process', 'On Hold', 'Scheduled', 'Waiting for Customer', 'Resolved', 'Closed', 'Cancelled'],
  },
  {
    key: 'responsible',
    label: 'Responsible',
    control: 'lookup',
    fieldTypes: ['responsible'],
    fieldIds: ['1279'],
    labels: ['Responsible', 'Responsible Group', 'Responsibility'],
    patterns: [/responsib/i],
    options: [],
  },
  {
    key: 'source',
    label: 'Source',
    control: 'select',
    fieldTypes: ['source'],
    fieldIds: ['371'],
    labels: ['Source'],
    patterns: [/^source$/i],
    options: [
      'API/Automation', 'Chat/Messaging', 'Chatbot-LiveAgent', 'Client Portal',
      'Email', 'Event/Monitoring', 'Internal Work', 'Operations Check',
      'Personal Visit', 'Phone', 'Self/Own Observation', 'SPAM/Erroneous',
      'Testing', 'Walkup',
    ],
    // Every walk-up ticket has the same source. Verified against the live
    // option list: the string is "Walkup", not "Walk In".
    fixedValue: 'Walkup',
  },
  {
    key: 'impact',
    label: 'Impact',
    control: 'select',
    fieldTypes: ['impact'],
    fieldIds: ['369'],
    labels: ['Impact'],
    patterns: [/^impact$/i],
    options: [
      'Low - Affects User', 'Medium - Affects Group/Department',
      'High - Affects Buildings/Departments', 'Critical - Affects Organization',
    ],
  },
  {
    key: 'urgency',
    label: 'Urgency',
    control: 'select',
    fieldTypes: ['urgency'],
    fieldIds: ['370'],
    labels: ['Urgency'],
    patterns: [/^urgency$/i],
    options: [
      'Low - Can still do work', 'Medium - Can do work but with workaround',
      'High - Impacting work', 'Critical - Teaching, learning, critical work cannot proceed.',
    ],
  },
  {
    key: 'service',
    label: 'Service',
    control: 'lookup',
    fieldTypes: ['service'],
    fieldIds: ['789'],
    labels: ['Service'],
    patterns: [/^service$/i, /serviceid/i],
    options: [],
  },
  {
    key: 'serviceOffering',
    label: 'Service Offering',
    control: 'lookup',
    fieldTypes: ['service_offering'],
    fieldIds: ['1932'],
    labels: ['Service Offering'],
    patterns: [/service\s*offering/i],
    options: [],
  },
];

/** The five fields the extension writes, in the order it writes them. */
export const FILL_SET = ['ubitName', 'briefSummary', 'description', 'source', 'service'];

const INDEX = new Map(DICTIONARY.map((d) => [d.key, d]));

export function byKey(key) {
  return INDEX.get(key);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/dictionary.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/dictionary.ts test/dictionary.test.ts
git commit -m "feat: canonical field dictionary, the only place field identity lives"
```

---

### Task 4: Control harvest

Enumerate fillable controls and gather every identifying signal, without
deciding what any of them mean. Resolution is Task 6's job.

**Files:**
- Create: `src/core/harvest.ts`
- Test: `test/harvest.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `harvest(root: Document | Element) -> Control[]` where `Control` is:

```
{
  key: string,            // stable within a page; used by the learning store
  shape: 'text' | 'select' | 'select2' | 'lookup' | 'richtext',
  el: Element,            // the element an adapter writes for text/select shapes
  fieldType: string|null, // data-fieldtype on the ancestor .form-group
  fieldId: string|null,   // data-fieldid on the ancestor .form-group
  label: string|null,
  name: string|null,
  id: string|null,
  placeholder: string|null,
  aria: string|null,
  options: string[],      // option texts, for selects
  lookup: { hidden, input, reset } | null,   // elements, for lookup shape
  richtext: { textarea, instanceKey } | null // for richtext shape
}
```

- [ ] **Step 1: Write the failing test**

Create `test/harvest.test.ts`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFixture, loadUnknownFormFixture } from './helpers.ts';
import { harvest } from '../src/core/harvest.ts';

const find = (controls, id) => controls.find((c) => c.id === id || c.lookup?.hidden?.id === id);

test('harvests the fixture without throwing and finds a plausible number of controls', () => {
  const controls = harvest(loadFixture());
  assert.ok(controls.length >= 15, `expected 15+ controls, got ${controls.length}`);
});

test('a lookup is one control carrying its hidden, visible, and reset elements', () => {
  const controls = harvest(loadFixture());
  const service = find(controls, 'attribute789');
  assert.ok(service, 'service lookup not harvested');
  assert.equal(service.shape, 'lookup');
  assert.equal(service.lookup.hidden.id, 'attribute789');
  assert.equal(service.lookup.input.id, 'attribute789_input');
  assert.equal(service.lookup.reset.id, 'attribute789_reset');
  assert.equal(service.label, 'Service');
});

test('the visible half of a lookup is not also harvested as a separate text control', () => {
  const controls = harvest(loadFixture());
  const strays = controls.filter((c) => c.id?.endsWith('_input'));
  assert.deepEqual(strays, [], 'lookup input surfaced as its own control');
});

test('native selects carry their option texts', () => {
  const controls = harvest(loadFixture());
  const source = find(controls, 'attribute371');
  assert.equal(source.shape, 'select');
  assert.ok(source.options.includes('Walkup'));
  assert.equal(source.label, 'Source');
});

test('select2 controls are classified distinctly from native selects', () => {
  const controls = harvest(loadFixture());
  const affiliation = find(controls, 'attribute2706');
  assert.equal(affiliation.shape, 'select2');
  assert.ok(affiliation.options.includes('Student'));
});

test('the description is harvested as richtext with its CKEditor instance key', () => {
  const controls = harvest(loadFixture());
  const description = controls.find((c) => c.shape === 'richtext');
  assert.ok(description);
  assert.equal(description.richtext.instanceKey, 'attribute138_Content');
  assert.equal(description.label, 'Description');
});

test('TDX semantic markers are captured when present', () => {
  const controls = harvest(loadFixture());
  const summary = find(controls, 'attribute37');
  assert.equal(summary.fieldType, 'title');
  assert.equal(summary.fieldId, '37');
});

test('harvest still finds controls and labels when the markers are gone', () => {
  const controls = harvest(loadUnknownFormFixture());
  const summary = find(controls, 'attribute37');
  assert.ok(summary);
  assert.equal(summary.fieldType, null);
  assert.equal(summary.fieldId, null);
  assert.equal(summary.label, 'Brief Summary', 'label must survive marker removal');
});

test('hidden, submit, button, and file controls are excluded', () => {
  const controls = harvest(loadFixture());
  for (const c of controls) {
    if (c.shape !== 'lookup') {
      const type = c.el.getAttribute?.('type');
      assert.ok(!['hidden', 'submit', 'button', 'image', 'reset', 'file'].includes(type), `${c.id} type=${type}`);
    }
  }
});

test('control keys are unique and stable across two harvests of the same document', () => {
  const doc = loadFixture();
  const a = harvest(doc).map((c) => c.key);
  const b = harvest(doc).map((c) => c.key);
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, a.length);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/harvest.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/core/harvest.ts`:

```js
/**
 * Enumerates fillable controls and gathers every signal that could identify
 * them. Deliberately makes no judgement about what any control means — that is
 * the resolver's job, and keeping the two apart is what lets the resolver be
 * tested against markup this file has never special-cased.
 */

const SKIP_TYPES = new Set(['hidden', 'submit', 'button', 'image', 'reset', 'file']);
const GROUP_SELECTOR = '.form-group, [data-fieldtype], [data-fieldid]';

export function harvest(root) {
  const doc = root.ownerDocument ?? root;
  const controls = [];
  const claimed = new Set();

  // Lookups first. They span three elements, and claiming all three up front
  // stops the visible half from surfacing again as a lone text input.
  for (const hidden of root.querySelectorAll('input[data-selectlookup="true"], input[data-wsurl]')) {
    const base = hidden.id || hidden.getAttribute('name');
    if (!base) continue;
    const input = doc.getElementById(`${base}_input`) ?? root.querySelector(`[name="${base}_input"]`);
    const reset = doc.getElementById(`${base}_reset`);
    if (!input) continue;

    claimed.add(hidden);
    claimed.add(input);
    if (reset) claimed.add(reset);

    controls.push(describe(hidden, {
      shape: 'lookup',
      lookup: { hidden, input, reset: reset ?? null },
    }));
  }

  // Rich text. TDX renders the description as a hidden textarea named
  // <id>_Content that CKEditor replaces at runtime, so the textarea is the
  // stable handle even though it is display:none.
  for (const textarea of root.querySelectorAll('textarea[id$="_Content"]')) {
    claimed.add(textarea);
    controls.push(describe(textarea, {
      shape: 'richtext',
      richtext: { textarea, instanceKey: textarea.id },
    }));
  }

  for (const el of root.querySelectorAll('input, select, textarea, [contenteditable="true"]')) {
    if (claimed.has(el)) continue;
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (tag === 'input' && SKIP_TYPES.has(type)) continue;
    if (tag === 'input' && (type === 'radio' || type === 'checkbox')) continue;
    // select2 and Kendo both leave decorative inputs in the DOM. They carry no
    // name, so they can never be a real form value.
    if (tag === 'input' && !el.getAttribute('name') && !el.id?.startsWith('attribute')) continue;
    if (el.classList.contains('select2-input') || el.classList.contains('select2-focusser')) continue;

    let shape = 'text';
    if (tag === 'select') shape = el.classList.contains('js-select2') ? 'select2' : 'select';
    else if (el.hasAttribute('contenteditable')) shape = 'richtext';

    controls.push(describe(el, { shape }));
  }

  return controls;
}

function describe(el, extra) {
  const doc = el.ownerDocument;
  const group = el.closest(GROUP_SELECTOR);
  const options = el.tagName.toLowerCase() === 'select'
    ? [...el.querySelectorAll('option')].map((o) => o.textContent.trim()).filter(Boolean)
    : [];

  return {
    key: el.id || el.getAttribute('name') || `${el.tagName}:${indexOf(el)}`,
    el,
    fieldType: group?.getAttribute('data-fieldtype') ?? null,
    fieldId: group?.getAttribute('data-fieldid') ?? null,
    label: findLabel(el, group, doc),
    name: el.getAttribute('name'),
    id: el.id || null,
    placeholder: el.getAttribute('placeholder'),
    aria: ariaText(el, doc),
    options,
    lookup: null,
    richtext: null,
    ...extra,
  };
}

/**
 * Label discovery, most reliable signal first. TDX uses <label for> throughout,
 * but the fallbacks matter for forms built by other means and for the
 * marker-stripped case the resolver must still handle.
 */
function findLabel(el, group, doc) {
  const targets = [el.id, ...(el.id ? [`${el.id}_Content`] : [])].filter(Boolean);
  for (const target of targets) {
    const explicit = doc.querySelector(`label[for="${cssEscape(target)}"]`);
    if (explicit) return clean(explicit.textContent);
  }
  // A lookup's <label for> points at the hidden input, which is what we
  // describe, so the direct lookup above already covers it.
  const ancestor = el.closest('label');
  if (ancestor) return clean(ancestor.textContent);

  const nearby = group?.querySelector('label, th, .control-label');
  if (nearby) return clean(nearby.textContent);

  return null;
}

function ariaText(el, doc) {
  const direct = el.getAttribute('aria-label');
  if (direct) return clean(direct);
  const ref = el.getAttribute('aria-labelledby');
  if (!ref) return el.getAttribute('title') ? clean(el.getAttribute('title')) : null;
  const parts = ref.split(/\s+/)
    .map((id) => doc.getElementById(id)?.textContent)
    .filter(Boolean);
  return parts.length ? clean(parts.join(' ')) : null;
}

function clean(text) {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  return trimmed || null;
}

function indexOf(el) {
  return [...el.ownerDocument.querySelectorAll(el.tagName)].indexOf(el);
}

// jsdom lacks CSS.escape in some versions, and TDX ids are alphanumeric anyway.
function cssEscape(value) {
  return value.replace(/["\\]/g, '\\$&');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/harvest.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/harvest.ts test/harvest.test.ts
git commit -m "feat: control harvest with lookup, richtext, and select2 classification"
```

---

### Task 5: Form signature

**Files:**
- Create: `src/core/signature.ts`
- Test: `test/signature.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `formSignature(root: Document | Element) -> string` — a short hex hash.

- [ ] **Step 1: Write the failing test**

Create `test/signature.test.ts`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { loadFixture } from './helpers.ts';
import { formSignature } from '../src/core/signature.ts';

const docFrom = (html) => new JSDOM(html).window.document;

test('the same form yields the same signature every time', () => {
  assert.equal(formSignature(loadFixture()), formSignature(loadFixture()));
});

test('the signature ignores URL-carried session and app ids', () => {
  // Signatures are computed from markup only; nothing here reads location.
  const doc = loadFixture();
  const before = formSignature(doc);
  doc.querySelectorAll('a[href]').forEach((a) => a.setAttribute('href', 'https://example.test/?U=changed'));
  assert.equal(formSignature(doc), before);
});

test('adding a field changes the signature, because a learned mapping should be revalidated', () => {
  const base = '<form><div class="form-group" data-fieldid="37"></div><input name="ParentFormID" value="162"></form>';
  const grown = '<form><div class="form-group" data-fieldid="37"></div><div class="form-group" data-fieldid="99"></div><input name="ParentFormID" value="162"></form>';
  assert.notEqual(formSignature(docFrom(base)), formSignature(docFrom(grown)));
});

test('field order does not change the signature', () => {
  const a = '<form><div data-fieldid="37"></div><div data-fieldid="99"></div><input name="ParentFormID" value="162"></form>';
  const b = '<form><div data-fieldid="99"></div><div data-fieldid="37"></div><input name="ParentFormID" value="162"></form>';
  assert.equal(formSignature(docFrom(a)), formSignature(docFrom(b)));
});

test('a different parent form id yields a different signature', () => {
  const a = '<form><div data-fieldid="37"></div><input name="ParentFormID" value="162"></form>';
  const b = '<form><div data-fieldid="37"></div><input name="ParentFormID" value="999"></form>';
  assert.notEqual(formSignature(docFrom(a)), formSignature(docFrom(b)));
});

test('a document with no markers still yields a stable string', () => {
  const sig = formSignature(docFrom('<form><input name="x"></form>'));
  assert.equal(typeof sig, 'string');
  assert.ok(sig.length > 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/signature.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/core/signature.ts`:

```js
/**
 * A stable identity for "this form", used as the key for learned field
 * mappings.
 *
 * Deliberately NOT the URL: TDX URLs carry session ids, app ids, and a
 * RequestorUID, none of which describe the form's structure. The signature is
 * the sorted set of attribute ids present plus the parent form id, so it stays
 * constant across sessions and changes exactly when an administrator edits the
 * form — which is when a learned mapping should stop being trusted.
 */

export function formSignature(root) {
  const ids = [...root.querySelectorAll('[data-fieldid]')]
    .map((el) => el.getAttribute('data-fieldid'))
    .filter(Boolean)
    .sort();

  const parent = root.querySelector('input[name="ParentFormID"]')?.getAttribute('value')
    ?? root.querySelector('input[name="FormID"]')?.getAttribute('value')
    ?? '';

  return fnv1a(`${parent}|${ids.join(',')}`);
}

// FNV-1a: short, dependency-free, and collision resistance is irrelevant here —
// a collision would only mean reusing a learned mapping, which the results
// panel surfaces anyway.
function fnv1a(input) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/signature.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/signature.ts test/signature.test.ts
git commit -m "feat: markup-derived form signature for the learning store"
```

---

### Task 6: The resolution engine

The centre of the project, and acceptance criterion 2.

**Files:**
- Create: `src/core/resolve.ts`
- Test: `test/resolve.test.ts`

**Interfaces:**
- Consumes: `harvest()` from Task 4, `DICTIONARY`/`byKey` from Task 3.
- Produces:
  - `resolve(controls, { dictionary = DICTIONARY, learned = {} }) -> Resolution`
  - `Resolution = { byField: Map<fieldKey, Match>, byControl: Map<controlKey, Match>, unresolvedFields: string[], diagnostics: Diag[] }`
  - `Match = { fieldKey, control, confidence: number, tier: 0|1|2|3, evidence: string }`
  - `Diag = { control, winner: Match|null, runnersUp: { fieldKey, score, evidence }[] }`
  - `LOW_CONFIDENCE = 0.6` — at or below this, the UI flags the match for review.

- [ ] **Step 1: Write the failing test**

Create `test/resolve.test.ts`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFixture, loadUnknownFormFixture } from './helpers.ts';
import { harvest } from '../src/core/harvest.ts';
import { resolve, LOW_CONFIDENCE } from '../src/core/resolve.ts';
import { FILL_SET } from '../src/core/dictionary.ts';

const resolveDoc = (doc, opts) => resolve(harvest(doc), opts);

test('every fill-set field resolves on the real form, via TDX markers', () => {
  const { byField } = resolveDoc(loadFixture());
  for (const key of FILL_SET) {
    const match = byField.get(key);
    assert.ok(match, `${key} did not resolve`);
    assert.ok(match.tier === 1 || match.tier === 2, `${key} expected tier 1 or 2, got ${match.tier}`);
    assert.ok(match.confidence >= 0.9, `${key} confidence ${match.confidence}`);
  }
});

test('fill-set fields land on the right controls', () => {
  const { byField } = resolveDoc(loadFixture());
  assert.equal(byField.get('ubitName').control.id, 'attribute2445');
  assert.equal(byField.get('briefSummary').control.id, 'attribute37');
  assert.equal(byField.get('source').control.id, 'attribute371');
  assert.equal(byField.get('description').control.richtext.instanceKey, 'attribute138_Content');
  assert.equal(byField.get('service').control.lookup.hidden.id, 'attribute789');
});

test('ACCEPTANCE: an unseen form resolves the fill set from labels and options alone', () => {
  // No data-fieldtype, no data-fieldid. Only labels, option sets, names, ids.
  const { byField } = resolveDoc(loadUnknownFormFixture());
  for (const key of FILL_SET) {
    const match = byField.get(key);
    assert.ok(match, `${key} did not resolve without TDX markers`);
    assert.equal(match.tier, 3);
    assert.ok(match.confidence > LOW_CONFIDENCE, `${key} confidence ${match.confidence}`);
  }
  assert.equal(byField.get('briefSummary').control.id, 'attribute37');
  assert.equal(byField.get('source').control.id, 'attribute371');
});

test('Service and Service Offering do not collide', () => {
  const { byField } = resolveDoc(loadUnknownFormFixture());
  const service = byField.get('service').control.lookup.hidden.id;
  const offering = byField.get('serviceOffering').control.lookup.hidden.id;
  assert.equal(service, 'attribute789');
  assert.equal(offering, 'attribute1932');
});

test('one control is never assigned to two fields', () => {
  const { byField } = resolveDoc(loadFixture());
  const used = [...byField.values()].map((m) => m.control.key);
  assert.equal(new Set(used).size, used.length);
});

test('option sets alone identify Impact even when its label is wrong', () => {
  const doc = loadUnknownFormFixture();
  doc.querySelector('label[for="attribute369"]').textContent = 'Widget Severity Level';
  const { byField } = resolveDoc(doc);
  assert.equal(byField.get('impact').control.id, 'attribute369');
});

test('a learned mapping wins over scoring and reports tier 0', () => {
  const learned = { attribute2390: 'briefSummary' };
  const { byField } = resolveDoc(loadFixture(), { learned });
  const match = byField.get('briefSummary');
  assert.equal(match.control.id, 'attribute2390');
  assert.equal(match.tier, 0);
  assert.equal(match.confidence, 1);
});

test('diagnostics reports a winner and runners-up for every harvested control', () => {
  const { diagnostics } = resolveDoc(loadFixture());
  assert.equal(diagnostics.length, harvest(loadFixture()).length);
  const summary = diagnostics.find((d) => d.control.id === 'attribute37');
  assert.equal(summary.winner.fieldKey, 'briefSummary');
  assert.ok(Array.isArray(summary.runnersUp));
  assert.ok(summary.runnersUp.length <= 3);
  assert.ok(summary.runnersUp.every((r) => r.fieldKey !== 'briefSummary'));
});

test('fields absent from the form are reported unresolved rather than mismatched', () => {
  const { unresolvedFields, byField } = resolveDoc(loadFixture());
  // This form has no Classification field; whatever is missing must be listed,
  // and must not have been forced onto some unrelated control.
  for (const key of unresolvedFields) assert.equal(byField.has(key), false);
});

test('resolution is deterministic', () => {
  const a = [...resolveDoc(loadFixture()).byField.entries()].map(([k, m]) => `${k}:${m.control.key}:${m.tier}`);
  const b = [...resolveDoc(loadFixture()).byField.entries()].map(([k, m]) => `${k}:${m.control.key}:${m.tier}`);
  assert.deepEqual(a, b);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/resolve.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/core/resolve.ts`:

```js
/**
 * Maps harvested controls onto canonical fields.
 *
 * Four tiers, highest wins:
 *   0  a mapping the technician corrected on this form signature
 *   1  TDX's own data-fieldtype marker
 *   2  TDX's own data-fieldid, stable instance-wide
 *   3  weighted scoring over label, option set, name, id, placeholder, aria
 *
 * Tier 3 is computed for every control even when a higher tier wins, because
 * diagnostics needs the runners-up and because tier 3 is what carries a form
 * — or an institution — this code has never seen.
 */

import { DICTIONARY } from './dictionary.ts';

export const LOW_CONFIDENCE = 0.6;

const TIER_LEARNED = 1;
const TIER_FIELDTYPE = 0.95;
const TIER_FIELDID = 0.9;
// Tier 3 can never claim the certainty of a TDX-supplied marker, however
// convincing a label looks.
const TIER3_CEILING = 0.85;

export function resolve(controls, { dictionary = DICTIONARY, learned = {} } = {}) {
  const candidates = [];
  const diagnostics = [];

  for (const control of controls) {
    const scored = [];

    for (const def of dictionary) {
      const tier3 = scoreTier3(control, def);
      let raw = tier3.raw;
      let confidence = Math.min(TIER3_CEILING, tier3.raw);
      let tier = 3;
      let evidence = tier3.evidence;

      if (def.fieldIds.includes(control.fieldId)) {
        raw = 10;
        confidence = TIER_FIELDID;
        tier = 2;
        evidence = `data-fieldid="${control.fieldId}"`;
      }
      if (def.fieldTypes.includes(control.fieldType)) {
        raw = 20;
        confidence = TIER_FIELDTYPE;
        tier = 1;
        evidence = `data-fieldtype="${control.fieldType}"`;
      }
      if (learned[control.key] === def.key) {
        raw = 100;
        confidence = TIER_LEARNED;
        tier = 0;
        evidence = 'learned from a previous correction on this form';
      }

      if (raw <= 0) continue;
      const candidate = { fieldKey: def.key, control, confidence, tier, evidence, raw };
      candidates.push(candidate);
      scored.push(candidate);
    }

    scored.sort(byRawDescending);
    diagnostics.push({
      control,
      winner: null, // filled in after assignment
      runnersUp: scored.slice(1, 4).map(({ fieldKey, raw, evidence }) => ({ fieldKey, score: raw, evidence })),
    });
  }

  // Globally best-match assignment: take the strongest pair available, claim
  // both sides, repeat. Prevents two fields from grabbing the same control and
  // makes the result independent of DOM order.
  candidates.sort(byRawDescending);
  const byField = new Map();
  const byControl = new Map();
  for (const candidate of candidates) {
    if (byField.has(candidate.fieldKey)) continue;
    if (byControl.has(candidate.control.key)) continue;
    const match = {
      fieldKey: candidate.fieldKey,
      control: candidate.control,
      confidence: candidate.confidence,
      tier: candidate.tier,
      evidence: candidate.evidence,
    };
    byField.set(candidate.fieldKey, match);
    byControl.set(candidate.control.key, match);
  }

  for (const diag of diagnostics) {
    diag.winner = byControl.get(diag.control.key) ?? null;
    diag.runnersUp = diag.runnersUp.filter((r) => r.fieldKey !== diag.winner?.fieldKey);
  }

  const unresolvedFields = dictionary.map((d) => d.key).filter((key) => !byField.has(key));

  return { byField, byControl, unresolvedFields, diagnostics };
}

// Raw scores are compared before the tier-3 ceiling is applied, so an exact
// label match still outranks a substring match even though both report 0.85.
function byRawDescending(a, b) {
  if (b.raw !== a.raw) return b.raw - a.raw;
  return a.fieldKey.localeCompare(b.fieldKey);
}

function scoreTier3(control, def) {
  const reasons = [];
  let score = 0;

  const label = control.label?.toLowerCase() ?? '';
  const defLabels = def.labels.map((l) => l.toLowerCase());

  if (label && defLabels.includes(label)) {
    score = Math.max(score, 1);
    reasons.push(`label exactly "${control.label}"`);
  } else if (label && defLabels.some((l) => label.includes(l))) {
    score = Math.max(score, 0.7);
    reasons.push(`label contains "${defLabels.find((l) => label.includes(l))}"`);
  }

  if (def.options.length && control.options.length) {
    const known = new Set(def.options.map((o) => o.toLowerCase()));
    const hits = control.options.filter((o) => known.has(o.toLowerCase())).length;
    const overlap = hits / def.options.length;
    if (overlap > 0) {
      score = Math.max(score, 0.9 * overlap);
      reasons.push(`${hits}/${def.options.length} known option strings`);
    }
  }

  const identifier = `${control.name ?? ''} ${control.id ?? ''}`;
  if (def.patterns.some((p) => p.test(identifier))) {
    score = Math.max(score, 0.5);
    reasons.push('name or id fragment');
  }

  const soft = `${control.placeholder ?? ''} ${control.aria ?? ''}`;
  if (soft.trim() && def.patterns.some((p) => p.test(soft))) {
    score = Math.max(score, 0.4);
    reasons.push('placeholder or aria text');
  }

  if (score > 0 && !shapeMatches(control.shape, def.control)) {
    // Not disqualifying: TDX administrators do convert a textbox into a
    // dropdown, and a strong label should still surface the field for review.
    score *= 0.3;
    reasons.push(`shape mismatch (${control.shape} vs ${def.control})`);
  }

  return { raw: score, evidence: reasons.join(', ') || 'no signal' };
}

function shapeMatches(shape, expected) {
  if (expected === 'select') return shape === 'select' || shape === 'select2';
  return shape === expected;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/resolve.test.ts`
Expected: PASS, 10 tests. The acceptance test on the marker-stripped fixture is the one that matters — if it fails, tune the tier-3 weights or add synonyms to the dictionary, never add a selector.

- [ ] **Step 5: Commit**

```bash
git add src/core/resolve.ts test/resolve.test.ts
git commit -m "feat: four-tier field resolution with globally-best-match assignment"
```

---

### Task 7: waitFor and the text/select adapter

**Files:**
- Create: `src/adapters/wait.ts`, `src/adapters/text.ts`
- Test: `test/wait.test.ts`, `test/adapters-text.test.ts`

**Interfaces:**
- Consumes: `Control` from Task 4.
- Produces:
  - `waitFor(predicate, { timeout = 5000, root, win }) -> Promise<T>` — resolves with the predicate's truthy value, rejects on timeout.
  - `setNativeValue(el, value) -> void`
  - `fillText(control, value) -> { status, detail }`
  - `fillSelect(control, value) -> { status, detail }`
  - `readValue(control) -> string` — used by fill policy to decide preserve-vs-write.

- [ ] **Step 1: Write the failing test for waitFor**

Create `test/wait.test.ts`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { waitFor } from '../src/adapters/wait.ts';

test('resolves immediately when the predicate is already true', async () => {
  const dom = new JSDOM('<div id="here"></div>');
  const el = await waitFor(() => dom.window.document.getElementById('here'), {
    root: dom.window.document, win: dom.window,
  });
  assert.equal(el.id, 'here');
});

test('resolves when the DOM later satisfies the predicate', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const { document } = dom.window;
  const pending = waitFor(() => document.getElementById('later'), {
    root: document, win: dom.window,
  });
  const added = document.createElement('span');
  added.id = 'later';
  document.getElementById('root').appendChild(added);
  assert.equal((await pending).id, 'later');
});

test('rejects on timeout rather than hanging', async () => {
  const dom = new JSDOM('<div></div>');
  await assert.rejects(
    () => waitFor(() => null, { timeout: 60, root: dom.window.document, win: dom.window }),
    /timed out/i,
  );
});

test('disconnects its observer and clears its poll on resolve', async () => {
  const dom = new JSDOM('<div id="here"></div>');
  const before = dom.window.__intervals?.size ?? 0;
  await waitFor(() => dom.window.document.getElementById('here'), {
    root: dom.window.document, win: dom.window,
  });
  // No leak assertion is possible directly; this asserts the call completes
  // and a second identical call still behaves, which fails if state leaked.
  const again = await waitFor(() => dom.window.document.getElementById('here'), {
    root: dom.window.document, win: dom.window,
  });
  assert.equal(again.id, 'here');
  assert.equal(before, dom.window.__intervals?.size ?? 0);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/wait.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement waitFor**

Create `src/adapters/wait.ts`:

```js
/**
 * Waits for a DOM condition.
 *
 * A fixed setTimeout is never correct here: the help desk network is sometimes
 * fast and sometimes not, and a sleep long enough to be safe is long enough to
 * be annoying on every single fill. MutationObserver catches the common case
 * instantly; the poll catches changes that mutate no nodes, such as a widget
 * flipping a property on an element that is already present.
 */
const POLL_MS = 120;

export function waitFor(predicate, { timeout = 5000, root, win } = {}) {
  const doc = root ?? globalThis.document;
  const view = win ?? doc?.defaultView ?? globalThis;

  return new Promise((resolvePromise, reject) => {
    let settled = false;

    const check = () => {
      if (settled) return false;
      let value;
      try {
        value = predicate();
      } catch {
        return false; // a predicate that throws mid-render is just "not yet"
      }
      if (!value) return false;
      settled = true;
      cleanup();
      resolvePromise(value);
      return true;
    };

    const observer = new view.MutationObserver(check);
    const poll = view.setInterval(check, POLL_MS);
    const timer = view.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`waitFor timed out after ${timeout}ms`));
    }, timeout);

    function cleanup() {
      observer.disconnect();
      view.clearInterval(poll);
      view.clearTimeout(timer);
    }

    if (check()) return;
    observer.observe(doc.documentElement ?? doc, {
      childList: true, subtree: true, attributes: true, characterData: true,
    });
  });
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test test/wait.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the failing test for the text/select adapter**

Create `test/adapters-text.test.ts`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { harvest } from '../src/core/harvest.ts';
import { fillText, fillSelect, readValue, setNativeValue } from '../src/adapters/text.ts';

const controlFor = (html, id) => {
  const doc = new JSDOM(`<form>${html}</form>`).window.document;
  return harvest(doc).find((c) => c.id === id);
};

const TEXT = '<label for="f">Field</label><input id="f" name="f" type="text">';
const SELECT = '<label for="s">Sel</label><select id="s" name="s">'
  + '<option value=""></option><option value="1">Walkup</option><option value="2">Phone</option></select>';

test('setNativeValue writes through the prototype setter, not the instance property', () => {
  const doc = new JSDOM('<input id="f">').window.document;
  const el = doc.getElementById('f');
  // A widget that shadows `value` with its own accessor is exactly the case
  // this defends against: assigning el.value would hit the shadow, not the DOM.
  let shadowed = '';
  Object.defineProperty(el, 'value', {
    configurable: true,
    get: () => shadowed,
    set: (v) => { shadowed = `intercepted:${v}`; },
  });
  setNativeValue(el, 'hello');
  delete el.value;
  assert.equal(el.value, 'hello', 'prototype setter must reach the real value');
});

test('fillText writes, fires the events a widget listens for, and verifies', () => {
  const control = controlFor(TEXT, 'f');
  const seen = [];
  for (const type of ['input', 'change', 'blur']) {
    control.el.addEventListener(type, () => seen.push(type));
  }
  const result = fillText(control, 'duynghie');
  assert.equal(result.status, 'filled');
  assert.equal(control.el.value, 'duynghie');
  assert.deepEqual(seen, ['input', 'change', 'blur']);
});

test('fillText reports failed when the control refuses the value', () => {
  const control = controlFor(TEXT, 'f');
  // Simulates a widget that reverts on change — the exact silent failure the
  // read-back check exists to catch.
  control.el.addEventListener('change', () => setNativeValue(control.el, ''));
  const result = fillText(control, 'duynghie');
  assert.equal(result.status, 'failed');
  assert.match(result.detail, /duynghie/);
  assert.match(result.detail, /read back/i);
});

test('fillSelect matches option text case-insensitively', () => {
  const control = controlFor(SELECT, 's');
  const result = fillSelect(control, 'walkup');
  assert.equal(result.status, 'filled');
  assert.equal(control.el.value, '1');
});

test('fillSelect falls back to a startsWith match', () => {
  const control = controlFor(SELECT, 's');
  const result = fillSelect(control, 'Walk');
  assert.equal(result.status, 'filled');
  assert.equal(control.el.value, '1');
  assert.match(result.detail, /Walkup/);
});

test('fillSelect fails loudly when no option matches', () => {
  const control = controlFor(SELECT, 's');
  const result = fillSelect(control, 'Carrier Pigeon');
  assert.equal(result.status, 'failed');
  assert.match(result.detail, /no option/i);
  assert.equal(control.el.value, '');
});

test('fillSelect dispatches change so the widget model updates', () => {
  const control = controlFor(SELECT, 's');
  let fired = 0;
  control.el.addEventListener('change', () => { fired += 1; });
  fillSelect(control, 'Walkup');
  assert.equal(fired, 1);
});

test('readValue reports the current text for both shapes', () => {
  const text = controlFor(TEXT, 'f');
  assert.equal(readValue(text), '');
  fillText(text, 'x');
  assert.equal(readValue(text), 'x');

  const select = controlFor(SELECT, 's');
  assert.equal(readValue(select), '');
  fillSelect(select, 'Phone');
  assert.equal(readValue(select), 'Phone');
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `node --test test/adapters-text.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement the text/select adapter**

Create `src/adapters/text.ts`:

```js
/**
 * Writes to plain inputs, textareas, and native selects.
 *
 * Knows nothing about which field it is filling. Field identity, fixed values,
 * and preserve-versus-overwrite all live in fill policy.
 */

/**
 * DO NOT SIMPLIFY THIS TO `el.value = value`.
 *
 * Kendo and other widget libraries shadow the `value` property on the element
 * instance. Assigning through the instance updates the visible text but leaves
 * the widget's internal model untouched, and the ASP.NET postback then submits
 * an empty field with no error anywhere. Going through the prototype's setter
 * reaches the real DOM value that the form actually serialises.
 */
export function setNativeValue(el, value) {
  const proto = Object.getPrototypeOf(el);
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value')
    ?? Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  if (descriptor?.set) descriptor.set.call(el, value);
  else el.value = value;
}

function notify(el) {
  // Order matters: widgets bind to different ones, and blur is what commits
  // several Kendo inputs.
  for (const type of ['input', 'change', 'blur']) {
    el.dispatchEvent(new el.ownerDocument.defaultView.Event(type, { bubbles: true }));
  }
}

export function fillText(control, value) {
  const el = control.el;
  setNativeValue(el, value);
  notify(el);

  const actual = el.value;
  if (actual !== value) {
    return {
      status: 'failed',
      detail: `wrote ${JSON.stringify(value)}, read back ${JSON.stringify(actual)}`,
    };
  }
  return { status: 'filled', detail: '' };
}

export function fillSelect(control, value) {
  const el = control.el;
  const wanted = String(value).toLowerCase();
  const options = [...el.options];

  const match = options.find((o) => o.textContent.trim().toLowerCase() === wanted)
    ?? options.find((o) => o.textContent.trim().toLowerCase().startsWith(wanted));

  if (!match) {
    return {
      status: 'failed',
      detail: `no option matching ${JSON.stringify(value)} (have: ${options.map((o) => o.textContent.trim()).filter(Boolean).join(', ')})`,
    };
  }

  const proto = Object.getPrototypeOf(el);
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  if (descriptor?.set) descriptor.set.call(el, match.value);
  else el.value = match.value;

  el.dispatchEvent(new el.ownerDocument.defaultView.Event('change', { bubbles: true }));

  const selected = el.options[el.selectedIndex]?.textContent.trim();
  if (selected !== match.textContent.trim()) {
    return { status: 'failed', detail: `selected ${JSON.stringify(selected)}, expected ${JSON.stringify(match.textContent.trim())}` };
  }
  return { status: 'filled', detail: match.textContent.trim() };
}

/** Current human-readable value, used to decide preserve versus overwrite. */
export function readValue(control) {
  const el = control.el;
  if (el.tagName?.toLowerCase() === 'select') {
    return el.options[el.selectedIndex]?.textContent.trim() ?? '';
  }
  return el.value ?? '';
}
```

- [ ] **Step 8: Run it to verify it passes**

Run: `node --test test/adapters-text.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 9: Commit**

```bash
git add src/adapters/wait.ts src/adapters/text.ts test/wait.test.ts test/adapters-text.test.ts
git commit -m "feat: waitFor helper and verified native-setter text/select adapter"
```

---

### Task 8: Captured-lookup adapter

**Files:**
- Create: `src/adapters/lookup.ts`
- Test: `test/adapters-lookup.test.ts`

**Interfaces:**
- Consumes: `Control` (shape `lookup`) from Task 4, `setNativeValue` from Task 7.
- Produces:
  - `fillLookup(control, { id, text }) -> { status, detail }`
  - `captureLookup(control) -> { id, text } | null`
  - `readLookup(control) -> string` — the visible text, for preserve checks.

- [ ] **Step 1: Write the failing test**

Create `test/adapters-lookup.test.ts`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { harvest } from '../src/core/harvest.ts';
import { fillLookup, captureLookup, readLookup } from '../src/adapters/lookup.ts';

const LOOKUP = `
<div class="form-group" data-fieldtype="service" data-fieldid="789">
  <label for="attribute789">Service</label>
  <input id="attribute789_reset" name="Item.ServiceID_reset" type="hidden" value="">
  <input id="attribute789_input" name="attribute789_input" type="text" value="">
  <input id="attribute789" name="attribute789" type="hidden" value=""
         data-selectlookup="true" data-wsurl="/TDNext/Apps/31/Shared/Services/Autocomplete">
</div>`;

const lookupControl = (html = LOOKUP) => {
  const doc = new JSDOM(`<form>${html}</form>`).window.document;
  return harvest(doc).find((c) => c.shape === 'lookup');
};

const SERVICE = { id: '288', text: 'Personal Device Software and Support / Personal Device Consultation' };

test('fillLookup writes the id, the display text, and the reset field', () => {
  const control = lookupControl();
  const result = fillLookup(control, SERVICE);
  assert.equal(result.status, 'filled');
  assert.equal(control.lookup.hidden.value, '288');
  assert.equal(control.lookup.input.value, SERVICE.text);
  assert.equal(control.lookup.reset.value, '288');
});

test('fillLookup makes no network request', () => {
  // The whole point of capture over search: no AJAX, no suggestion popup, no
  // ordering constraint between two lookups sharing one container.
  const control = lookupControl();
  const doc = control.lookup.hidden.ownerDocument;
  doc.defaultView.fetch = () => { throw new Error('network call attempted'); };
  doc.defaultView.XMLHttpRequest = function () { throw new Error('network call attempted'); };
  assert.equal(fillLookup(control, SERVICE).status, 'filled');
});

test('fillLookup dispatches change on both halves so the widget model updates', () => {
  const control = lookupControl();
  const seen = [];
  control.lookup.hidden.addEventListener('change', () => seen.push('hidden'));
  control.lookup.input.addEventListener('change', () => seen.push('input'));
  fillLookup(control, SERVICE);
  assert.ok(seen.includes('hidden'));
  assert.ok(seen.includes('input'));
});

test('fillLookup reports failed when the id does not stick', () => {
  const control = lookupControl();
  control.lookup.hidden.addEventListener('change', () => {
    control.lookup.hidden.setAttribute('value', '');
    control.lookup.hidden.value = '';
  });
  const result = fillLookup(control, SERVICE);
  assert.equal(result.status, 'failed');
  assert.match(result.detail, /288/);
});

test('fillLookup reports failed when the display text does not stick', () => {
  const control = lookupControl();
  control.lookup.input.addEventListener('change', () => { control.lookup.input.value = 'something else'; });
  const result = fillLookup(control, SERVICE);
  assert.equal(result.status, 'failed');
  assert.match(result.detail, /display text/i);
});

test('fillLookup rejects an incomplete capture instead of writing half a value', () => {
  const control = lookupControl();
  assert.equal(fillLookup(control, { id: '288' }).status, 'failed');
  assert.equal(fillLookup(control, { text: 'x' }).status, 'failed');
  assert.equal(fillLookup(control, null).status, 'failed');
  assert.equal(control.lookup.hidden.value, '', 'must not partially write');
});

test('captureLookup reads back what a technician set by hand', () => {
  const control = lookupControl();
  control.lookup.hidden.value = '288';
  control.lookup.input.value = SERVICE.text;
  assert.deepEqual(captureLookup(control), SERVICE);
});

test('captureLookup returns null for an empty lookup', () => {
  assert.equal(captureLookup(lookupControl()), null);
});

test('captureLookup falls back to the data-default TDX prefills', () => {
  const html = LOOKUP.replace(
    'data-selectlookup="true"',
    'data-selectlookup="true" data-default="[{&quot;caption&quot;:&quot;Capen Hall&quot;,&quot;value&quot;:&quot;139&quot;}]"',
  ).replace('id="attribute789" name="attribute789" type="hidden" value=""', 'id="attribute789" name="attribute789" type="hidden" value="139"');
  const control = lookupControl(html);
  assert.deepEqual(captureLookup(control), { id: '139', text: 'Capen Hall' });
});

test('readLookup reports the visible text for preserve checks', () => {
  const control = lookupControl();
  assert.equal(readLookup(control), '');
  fillLookup(control, SERVICE);
  assert.equal(readLookup(control), SERVICE.text);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/adapters-lookup.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the lookup adapter**

Create `src/adapters/lookup.ts`:

```js
/**
 * Fills a TDX type-ahead lookup from a previously captured {id, text} pair.
 *
 * WHY NOT DRIVE THE AUTOCOMPLETE: typing a query means waiting on AJAX,
 * disambiguating multiple result rows, and dispatching mousedown before click
 * because several Kendo widgets commit on mousedown. Worse, every lookup on the
 * page shares one suggestion container, so two fills in flight click each
 * other's results. TDX lookup ids are stable per instance, so capturing the
 * pair once removes that entire class of failure.
 *
 * A lookup is three elements. Writing only the visible input leaves the hidden
 * id empty and the ticket saves with no service and no error.
 */

import { setNativeValue } from './text.ts';

function fire(el, type) {
  el.dispatchEvent(new el.ownerDocument.defaultView.Event(type, { bubbles: true }));
}

export function fillLookup(control, captured) {
  const id = captured?.id;
  const text = captured?.text;
  if (!id || !text) {
    return { status: 'failed', detail: 'incomplete capture: need both id and text, refusing to write a partial value' };
  }

  const { hidden, input, reset } = control.lookup;

  if (reset) setNativeValue(reset, String(id));
  setNativeValue(hidden, String(id));
  setNativeValue(input, String(text));

  fire(input, 'input');
  fire(input, 'change');
  fire(hidden, 'change');
  fire(input, 'blur');

  if (String(hidden.value) !== String(id)) {
    return { status: 'failed', detail: `wrote id ${id}, read back ${JSON.stringify(hidden.value)}` };
  }
  if (String(input.value) !== String(text)) {
    return { status: 'failed', detail: `display text mismatch: wrote ${JSON.stringify(text)}, read back ${JSON.stringify(input.value)}` };
  }
  return { status: 'filled', detail: `${text} (id ${id})` };
}

/** Reads a lookup's current selection so it can be stored on a template. */
export function captureLookup(control) {
  const { hidden, input } = control.lookup;
  const id = hidden.value?.trim();
  if (!id) return null;

  const text = input.value?.trim() || defaultCaption(hidden);
  if (!text) return null;
  return { id, text };
}

export function readLookup(control) {
  return control.lookup.input.value?.trim() || defaultCaption(control.lookup.hidden) || '';
}

/**
 * When TDX prefills a lookup from the launch URL it populates the hidden id and
 * a data-default JSON blob, but leaves the visible input empty until its widget
 * initialises. Reading the blob makes capture work on a freshly loaded form.
 */
function defaultCaption(hidden) {
  const raw = hidden.getAttribute('data-default');
  if (!raw) return '';
  try {
    return JSON.parse(raw)?.[0]?.caption ?? '';
  } catch {
    return '';
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test test/adapters-lookup.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/lookup.ts test/adapters-lookup.test.ts
git commit -m "feat: captured {id,text} lookup adapter with verification and capture"
```

---

### Task 9: Page-world bridge and the rich-text adapter

**Files:**
- Create: `src/content/bridge-main.ts`, `src/adapters/richtext.ts`
- Test: `test/adapters-richtext.test.ts`

**Interfaces:**
- Consumes: `Control` (shape `richtext`), `setNativeValue`.
- Produces:
  - `createBridgeClient(win) -> { setEditorData(instanceKey, html) -> Promise<{ok, detail}> }`
  - `fillRichText(control, html, { bridge }) -> Promise<{ status, detail }>`
  - `readRichText(control) -> string` — plain text of current content, for preserve checks.
  - `BRIDGE_CHANNEL = 'tdxa'` — the postMessage discriminator, shared by both sides.

- [ ] **Step 1: Write the failing test**

Create `test/adapters-richtext.test.ts`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { harvest } from '../src/core/harvest.ts';
import { fillRichText, readRichText } from '../src/adapters/richtext.ts';

const HTML = '<p>Removed the stale eduroam profile.</p>';

const richControl = (markup) => {
  const doc = new JSDOM(`<form>${markup}</form>`).window.document;
  return harvest(doc).find((c) => c.shape === 'richtext');
};

const TEXTAREA_ONLY = `
<div class="form-group" data-fieldtype="description" data-fieldid="138">
  <label for="attribute138_Content">Description</label>
  <textarea id="attribute138_Content" name="attribute138.Content" style="display:none"></textarea>
</div>`;

const WITH_IFRAME = `
<div class="form-group" data-fieldtype="description" data-fieldid="138">
  <label for="attribute138_Content">Description</label>
  <textarea id="attribute138_Content" name="attribute138.Content" style="display:none"></textarea>
  <div class="cke"><iframe title="Rich Text Editor"></iframe></div>
</div>`;

const okBridge = () => ({
  calls: [],
  async setEditorData(key, html) { this.calls.push({ key, html }); return { ok: true, detail: 'CKEditor instance' }; },
});
const absentBridge = () => ({
  async setEditorData() { return { ok: false, detail: 'no CKEDITOR instance for that key' }; },
});

test('uses the CKEditor bridge when the instance exists', async () => {
  const control = richControl(TEXTAREA_ONLY);
  const bridge = okBridge();
  const result = await fillRichText(control, HTML, { bridge });
  assert.equal(result.status, 'filled');
  assert.match(result.detail, /CKEditor/);
  assert.deepEqual(bridge.calls, [{ key: 'attribute138_Content', html: HTML }]);
});

test('the bridge is asked for the harvested instance key, not a hardcoded one', async () => {
  const markup = TEXTAREA_ONLY.replace(/attribute138_Content/g, 'attribute999_Content');
  const bridge = okBridge();
  await fillRichText(richControl(markup), HTML, { bridge });
  assert.equal(bridge.calls[0].key, 'attribute999_Content');
});

test('falls back to the same-origin iframe body when CKEditor is absent', async () => {
  const control = richControl(WITH_IFRAME);
  const result = await fillRichText(control, HTML, { bridge: absentBridge() });
  assert.equal(result.status, 'filled');
  assert.match(result.detail, /iframe/i);
  const iframe = control.richtext.textarea.closest('.form-group').querySelector('iframe');
  assert.match(iframe.contentDocument.body.innerHTML, /stale eduroam profile/);
  assert.equal(control.richtext.textarea.value, HTML, 'the backing textarea must carry the value that posts back');
});

test('falls back to the bare textarea when there is no editor at all', async () => {
  const control = richControl(TEXTAREA_ONLY);
  const result = await fillRichText(control, HTML, { bridge: absentBridge() });
  assert.equal(result.status, 'filled');
  assert.match(result.detail, /textarea/i);
  assert.equal(control.richtext.textarea.value, HTML);
});

test('reports failed rather than claiming success when no path verifies', async () => {
  const control = richControl(TEXTAREA_ONLY);
  // A textarea that refuses writes: the adapter must not report filled.
  Object.defineProperty(control.richtext.textarea, 'value', {
    configurable: true, get: () => '', set: () => {},
  });
  const result = await fillRichText(control, HTML, { bridge: absentBridge() });
  assert.equal(result.status, 'failed');
  assert.match(result.detail, /verif/i);
});

test('a bridge that never answers does not hang the fill', async () => {
  const control = richControl(TEXTAREA_ONLY);
  const stalled = { setEditorData: () => new Promise(() => {}) };
  const result = await fillRichText(control, HTML, { bridge: stalled, bridgeTimeout: 50 });
  // Falls through to the textarea rather than waiting forever.
  assert.equal(result.status, 'filled');
  assert.match(result.detail, /textarea/i);
});

test('readRichText reports current content for preserve checks', async () => {
  const control = richControl(TEXTAREA_ONLY);
  assert.equal(readRichText(control), '');
  await fillRichText(control, HTML, { bridge: absentBridge() });
  assert.match(readRichText(control), /stale eduroam profile/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/adapters-richtext.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the bridge (page world)**

Create `src/content/bridge-main.ts`:

```js
/**
 * Page-world half of the extension. Runs in the page's own JavaScript context,
 * which is the ONLY way to reach window.CKEDITOR — a content script's isolated
 * world sees the same DOM but a different global object.
 *
 * Deliberately tiny and deliberately one-way in capability: it exposes exactly
 * one operation and reads nothing back out of the page. Everything else stays
 * in the isolated world.
 */

const BRIDGE_CHANNEL = 'tdxa';

window.addEventListener('message', (event) => {
  // Same-frame messages only. Anything else is not ours.
  if (event.source !== window) return;
  const msg = event.data;
  if (!msg || msg.channel !== BRIDGE_CHANNEL || msg.direction !== 'request') return;

  let ok = false;
  let detail = '';

  if (msg.op === 'setEditorData') {
    const instance = window.CKEDITOR?.instances?.[msg.key];
    if (!instance) {
      detail = `no CKEDITOR instance for "${msg.key}"`;
    } else {
      try {
        // setData updates the editor, its iframe body, and the backing
        // textarea in one call, which is why it is the preferred path.
        instance.setData(msg.html);
        ok = instance.getData().includes(stripTags(msg.html).slice(0, 24));
        detail = ok ? 'CKEditor instance' : 'CKEditor accepted setData but did not retain the content';
      } catch (error) {
        detail = `CKEditor threw: ${error.message}`;
      }
    }
  } else {
    detail = `unknown op "${msg.op}"`;
  }

  window.postMessage({ channel: BRIDGE_CHANNEL, direction: 'response', id: msg.id, ok, detail }, '*');
});

function stripTags(html) {
  return html.replace(/<[^>]*>/g, '').trim();
}
```

- [ ] **Step 4: Implement the rich-text adapter**

Create `src/adapters/richtext.ts`:

```js
/**
 * Fills the ticket description.
 *
 * TDX renders it as CKEditor 4 in classic iframe mode, so there are three
 * possible shapes depending on how far the editor got initialising. Each path
 * verifies its own result: reporting "filled" for a description that did not
 * land would put an empty ticket in the queue with nothing to notice it by.
 */

import { setNativeValue } from './text.ts';

export const BRIDGE_CHANNEL = 'tdxa';
const DEFAULT_BRIDGE_TIMEOUT = 3000;

/** Isolated-world client for the page-world bridge. */
export function createBridgeClient(win = window) {
  let nextId = 1;
  return {
    setEditorData(instanceKey, html) {
      const id = nextId++;
      return new Promise((resolve) => {
        const onMessage = (event) => {
          const msg = event.data;
          if (!msg || msg.channel !== BRIDGE_CHANNEL || msg.direction !== 'response' || msg.id !== id) return;
          win.removeEventListener('message', onMessage);
          resolve({ ok: Boolean(msg.ok), detail: msg.detail ?? '' });
        };
        win.addEventListener('message', onMessage);
        win.postMessage({ channel: BRIDGE_CHANNEL, direction: 'request', id, op: 'setEditorData', key: instanceKey, html }, '*');
      });
    },
  };
}

export async function fillRichText(control, html, { bridge, bridgeTimeout = DEFAULT_BRIDGE_TIMEOUT } = {}) {
  const attempts = [];

  if (bridge && control.richtext?.instanceKey) {
    const answer = await withTimeout(
      bridge.setEditorData(control.richtext.instanceKey, html),
      bridgeTimeout,
      { ok: false, detail: 'bridge did not answer' },
    );
    if (answer.ok) return { status: 'filled', detail: answer.detail || 'CKEditor instance' };
    attempts.push(`CKEditor: ${answer.detail}`);
  }

  const iframeResult = fillViaIframe(control, html);
  if (iframeResult) {
    if (iframeResult.ok) return { status: 'filled', detail: 'iframe editor body' };
    attempts.push(`iframe: ${iframeResult.detail}`);
  }

  const editableResult = fillViaContentEditable(control, html);
  if (editableResult) {
    if (editableResult.ok) return { status: 'filled', detail: 'contenteditable element' };
    attempts.push(`contenteditable: ${editableResult.detail}`);
  }

  const textareaResult = fillViaTextarea(control, html);
  if (textareaResult) {
    if (textareaResult.ok) return { status: 'filled', detail: 'plain textarea' };
    attempts.push(`textarea: ${textareaResult.detail}`);
  }

  return { status: 'failed', detail: `no path verified — ${attempts.join('; ') || 'no writable target found'}` };
}

export function readRichText(control) {
  const iframe = editorIframe(control);
  const body = sameOriginBody(iframe);
  if (body) return body.textContent.trim();

  const editable = control.richtext?.textarea?.closest('.form-group')?.querySelector('[contenteditable="true"]');
  if (editable) return editable.textContent.trim();

  const textarea = control.richtext?.textarea ?? control.el;
  return stripTags(textarea?.value ?? '');
}

function fillViaIframe(control, html) {
  const body = sameOriginBody(editorIframe(control));
  if (!body) return null;
  body.innerHTML = html;
  // The iframe is only what the technician sees; the textarea is what posts
  // back. Writing one without the other submits an empty description.
  syncTextarea(control, html);
  const ok = body.innerHTML.includes(firstWords(html)) && (control.richtext?.textarea?.value ?? '') === html;
  return { ok, detail: ok ? '' : 'wrote iframe body but read-back did not match' };
}

function fillViaContentEditable(control, html) {
  const group = control.richtext?.textarea?.closest('.form-group') ?? control.el?.closest('.form-group');
  const editable = group?.querySelector('[contenteditable="true"]')
    ?? (control.el?.getAttribute?.('contenteditable') === 'true' ? control.el : null);
  if (!editable) return null;
  editable.innerHTML = html;
  syncTextarea(control, html);
  const ok = editable.innerHTML.includes(firstWords(html));
  return { ok, detail: ok ? '' : 'wrote contenteditable but read-back did not match' };
}

function fillViaTextarea(control, html) {
  const textarea = control.richtext?.textarea ?? (control.el?.tagName?.toLowerCase() === 'textarea' ? control.el : null);
  if (!textarea) return null;
  setNativeValue(textarea, html);
  textarea.dispatchEvent(new textarea.ownerDocument.defaultView.Event('change', { bubbles: true }));
  const ok = textarea.value === html;
  return { ok, detail: ok ? '' : `wrote ${html.length} chars, read back ${textarea.value.length}` };
}

function syncTextarea(control, html) {
  const textarea = control.richtext?.textarea;
  if (textarea) setNativeValue(textarea, html);
}

function editorIframe(control) {
  const group = control.richtext?.textarea?.closest('.form-group') ?? control.el?.closest?.('.form-group');
  return group?.querySelector('iframe') ?? null;
}

function sameOriginBody(iframe) {
  if (!iframe) return null;
  try {
    return iframe.contentDocument?.body ?? null;
  } catch {
    return null; // cross-origin; nothing to do here and nothing to report as an error
  }
}

function firstWords(html) {
  return stripTags(html).slice(0, 24);
}

function stripTags(html) {
  return String(html).replace(/<[^>]*>/g, '').trim();
}

function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => { setTimeout(() => resolve(fallback), ms); }),
  ]);
}
```

Note: the `setTimeout` in `withTimeout` is a failure deadline on a message that
may never be answered, not a sleep waiting for a DOM condition. The
no-fixed-sleep rule targets the latter.

- [ ] **Step 5: Run it to verify it passes**

Run: `node --test test/adapters-richtext.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add src/content/bridge-main.ts src/adapters/richtext.ts test/adapters-richtext.test.ts
git commit -m "feat: page-world CKEditor bridge and verified rich-text adapter"
```

---

### Task 10: Adapter dispatch

**Files:**
- Create: `src/adapters/index.ts`
- Test: `test/adapters-dispatch.test.ts`

**Interfaces:**
- Consumes: every adapter from Tasks 7–9.
- Produces:
  - `applyValue(control, value, ctx) -> Promise<{ status, detail }>` — dispatches on `control.shape`.
  - `currentValue(control) -> string` — dispatches on `control.shape`.
  - `ctx = { bridge }`.

- [ ] **Step 1: Write the failing test**

Create `test/adapters-dispatch.test.ts`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFixture } from './helpers.ts';
import { harvest } from '../src/core/harvest.ts';
import { applyValue, currentValue } from '../src/adapters/index.ts';

const controls = () => harvest(loadFixture());
const byId = (id) => controls().find((c) => c.id === id || c.lookup?.hidden?.id === id);
const bridge = { async setEditorData() { return { ok: false, detail: 'no instance in jsdom' }; } };

test('a text control routes to the text adapter', async () => {
  const result = await applyValue(byId('attribute2445'), 'duynghie', { bridge });
  assert.equal(result.status, 'filled');
});

test('a native select routes to the select adapter', async () => {
  const control = byId('attribute371');
  const result = await applyValue(control, 'Walkup', { bridge });
  assert.equal(result.status, 'filled');
  assert.equal(currentValue(control), 'Walkup');
});

test('a lookup routes to the lookup adapter and takes an {id,text} pair', async () => {
  const control = byId('attribute789');
  const result = await applyValue(control, { id: '288', text: 'Personal Device Consultation' }, { bridge });
  assert.equal(result.status, 'filled');
  assert.equal(control.lookup.hidden.value, '288');
});

test('a richtext control routes to the rich-text adapter', async () => {
  const control = controls().find((c) => c.shape === 'richtext');
  const result = await applyValue(control, '<p>notes</p>', { bridge });
  assert.equal(result.status, 'filled');
});

test('select2 has no write path and says so instead of half-working', async () => {
  const control = byId('attribute2706');
  const result = await applyValue(control, 'Student', { bridge });
  assert.equal(result.status, 'skipped');
  assert.match(result.detail, /select2/i);
});

test('an unknown shape reports failed rather than throwing', async () => {
  const result = await applyValue({ shape: 'sorcery', key: 'x' }, 'v', { bridge });
  assert.equal(result.status, 'failed');
  assert.match(result.detail, /sorcery/);
});

test('currentValue works for every shape the fixture contains', () => {
  assert.equal(typeof currentValue(byId('attribute2445')), 'string');
  assert.equal(typeof currentValue(byId('attribute371')), 'string');
  assert.equal(typeof currentValue(byId('attribute789')), 'string');
  assert.equal(typeof currentValue(controls().find((c) => c.shape === 'richtext')), 'string');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/adapters-dispatch.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the dispatcher**

Create `src/adapters/index.ts`:

```js
/**
 * Routes a resolved control to the adapter that knows its shape.
 *
 * This is the boundary the "adapters hold no field logic" rule protects: the
 * dispatcher sees a shape and a value, never a field name.
 */

import { fillText, fillSelect, readValue } from './text.ts';
import { fillLookup, readLookup } from './lookup.ts';
import { fillRichText, readRichText } from './richtext.ts';

export async function applyValue(control, value, ctx = {}) {
  switch (control.shape) {
    case 'text':
      return fillText(control, String(value));
    case 'select':
      return fillSelect(control, String(value));
    case 'lookup':
      return fillLookup(control, value);
    case 'richtext':
      return fillRichText(control, String(value), ctx);
    case 'select2':
      // Detection only. Nothing in the fill set is a select2 control, so
      // shipping an untested write path would be surface with no purpose.
      return { status: 'skipped', detail: 'select2 controls are detected but not written in this version' };
    default:
      return { status: 'failed', detail: `no adapter for control shape "${control.shape}"` };
  }
}

export function currentValue(control) {
  switch (control.shape) {
    case 'lookup':
      return readLookup(control);
    case 'richtext':
      return readRichText(control);
    case 'text':
    case 'select':
    case 'select2':
      return readValue(control);
    default:
      return '';
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test test/adapters-dispatch.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/index.ts test/adapters-dispatch.test.ts
git commit -m "feat: shape-based adapter dispatch"
```

---

### Task 11: Storage

**Files:**
- Create: `src/data/stores.ts`
- Test: `test/stores.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `createStores(area) -> Stores`, where `area` defaults to `chrome.storage.local` and is injected in tests.
  - `Stores = { templates, examples, learned, settings }`
  - `templates: { list(), save(template), remove(id) }`
  - `examples: { list(), add({description, service}), remove(id) }`
  - `learned: { get(signature), set(signature, mapping), clearAll() }`
  - `settings: { get(), patch(partial) }`
  - `DEFAULT_SETTINGS = { threshold: 0.35, overwrite: false, diagnostics: false }`
  - `createMemoryArea() -> area` — an in-memory `chrome.storage`-shaped object for tests.

- [ ] **Step 1: Write the failing test**

Create `test/stores.test.ts`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStores, createMemoryArea, DEFAULT_SETTINGS } from '../src/data/stores.ts';

const fresh = () => createStores(createMemoryArea());

test('settings start at their defaults and patch without clobbering', async () => {
  const stores = fresh();
  assert.deepEqual(await stores.settings.get(), DEFAULT_SETTINGS);
  await stores.settings.patch({ overwrite: true });
  const after = await stores.settings.get();
  assert.equal(after.overwrite, true);
  assert.equal(after.threshold, DEFAULT_SETTINGS.threshold, 'unpatched keys must survive');
});

test('templates round-trip and are replaced by id, not duplicated', async () => {
  const stores = fresh();
  await stores.templates.save({ id: 'a', name: 'One', summary: 's', descriptionHtml: '<p>x</p>', service: null });
  await stores.templates.save({ id: 'a', name: 'One edited', summary: 's', descriptionHtml: '<p>x</p>', service: null });
  const list = await stores.templates.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'One edited');
});

test('templates can be removed', async () => {
  const stores = fresh();
  await stores.templates.save({ id: 'a', name: 'One' });
  await stores.templates.remove('a');
  assert.deepEqual(await stores.templates.list(), []);
});

test('examples get an id and a timestamp on add', async () => {
  const stores = fresh();
  await stores.examples.add({ description: 'eduroam wifi', service: { id: '288', text: 'Consultation' } });
  const [example] = await stores.examples.list();
  assert.ok(example.id);
  assert.ok(example.savedAt);
  assert.equal(example.description, 'eduroam wifi');
});

test('learned mappings are keyed by form signature and clearable in bulk', async () => {
  const stores = fresh();
  await stores.learned.set('abc123', { attribute37: 'briefSummary' });
  await stores.learned.set('def456', { attribute99: 'location' });
  assert.deepEqual(await stores.learned.get('abc123'), { attribute37: 'briefSummary' });
  assert.deepEqual(await stores.learned.get('nope'), {});
  await stores.learned.clearAll();
  assert.deepEqual(await stores.learned.get('abc123'), {});
});

test('no store persists requestor data', async () => {
  // Requestor fields include student records and live in panel memory only.
  const stores = fresh();
  assert.equal(stores.requestor, undefined);
  assert.deepEqual(Object.keys(stores).sort(), ['examples', 'learned', 'settings', 'templates']);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/stores.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the stores**

Create `src/data/stores.ts`:

```js
/**
 * Four stores over chrome.storage.local. No storage.sync — a technician's
 * learned mappings and captured service ids are machine-local, and syncing
 * them would put desk data on Google's servers, which the design forbids.
 *
 * There is deliberately no requestor store. Requestor fields include student
 * records; they live in panel memory and die with the page.
 */

export const DEFAULT_SETTINGS = { threshold: 0.35, overwrite: false, diagnostics: false };

const KEYS = { templates: 'tdxa.templates', examples: 'tdxa.examples', learned: 'tdxa.learned', settings: 'tdxa.settings' };

export function createStores(area = globalThis.chrome?.storage?.local) {
  const read = async (key, fallback) => {
    const bag = await area.get(key);
    return bag?.[key] ?? fallback;
  };
  const write = (key, value) => area.set({ [key]: value });

  const collection = (key) => ({
    async list() {
      return read(key, []);
    },
    async save(item) {
      const items = await read(key, []);
      const index = items.findIndex((i) => i.id === item.id);
      if (index === -1) items.push(item);
      else items[index] = item;
      await write(key, items);
      return item;
    },
    async remove(id) {
      await write(key, (await read(key, [])).filter((i) => i.id !== id));
    },
  });

  const templates = collection(KEYS.templates);
  const examples = collection(KEYS.examples);

  return {
    templates,
    examples: {
      list: examples.list,
      remove: examples.remove,
      async add(example) {
        const record = { id: newId(), savedAt: new Date().toISOString(), ...example };
        await examples.save(record);
        return record;
      },
    },
    learned: {
      async get(signature) {
        return (await read(KEYS.learned, {}))[signature] ?? {};
      },
      async set(signature, mapping) {
        const all = await read(KEYS.learned, {});
        all[signature] = { ...(all[signature] ?? {}), ...mapping };
        await write(KEYS.learned, all);
      },
      async clearAll() {
        await write(KEYS.learned, {});
      },
    },
    settings: {
      async get() {
        return { ...DEFAULT_SETTINGS, ...(await read(KEYS.settings, {})) };
      },
      async patch(partial) {
        await write(KEYS.settings, { ...(await read(KEYS.settings, {})), ...partial });
      },
    },
  };
}

function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** chrome.storage-shaped object backed by a Map, for tests. */
export function createMemoryArea() {
  const data = new Map();
  return {
    async get(key) {
      return data.has(key) ? { [key]: data.get(key) } : {};
    },
    async set(bag) {
      for (const [key, value] of Object.entries(bag)) data.set(key, value);
    },
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test test/stores.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/data/stores.ts test/stores.test.ts
git commit -m "feat: four local stores, with no requestor persistence by design"
```

---

### Task 12: Templates and placeholder substitution

**Files:**
- Create: `src/data/templates.ts`
- Test: `test/templates.test.ts`

**Interfaces:**
- Consumes: parser output shape from Task 2.
- Produces:
  - `SHIPPED_TEMPLATES: Template[]` — blank plus the three walk-up templates.
  - `Template = { id, name, summary, descriptionHtml, service: {id,text}|null }`
  - `substitute(text, values, { escape }) -> { text, unknown: string[] }`
  - `renderTemplate(template, requestorFields, { now }) -> { summary, descriptionHtml, unknown: string[] }`

- [ ] **Step 1: Write the failing test**

Create `test/templates.test.ts`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHIPPED_TEMPLATES, substitute, renderTemplate } from '../src/data/templates.ts';

const REQUESTOR = {
  name: 'Anh Duy Nghiem', email: 'duynghie@buffalo.edu', ubitName: 'duynghie',
  personNumber: '50583450', personGuid: 'b067308b-2198-ef11-9c36-f06ebc4e4310',
  title: 'Student Assistant', organization: 'University at Buffalo',
};

test('ships a blank template plus the three walk-up templates', () => {
  assert.equal(SHIPPED_TEMPLATES.length, 4);
  const names = SHIPPED_TEMPLATES.map((t) => t.name);
  assert.ok(names.some((n) => /blank/i.test(n)));
  assert.ok(names.some((n) => /eduroam/i.test(n)));
  assert.ok(names.some((n) => /password/i.test(n)));
  assert.ok(names.some((n) => /duo/i.test(n)));
});

test('every shipped template ships with no service, because ids are captured not invented', () => {
  for (const t of SHIPPED_TEMPLATES) assert.equal(t.service, null, `${t.name} must not ship a guessed service id`);
});

test('shipped descriptions are past-tense notes naming what was verified', () => {
  const eduroam = SHIPPED_TEMPLATES.find((t) => /eduroam/i.test(t.name));
  assert.match(eduroam.descriptionHtml, /confirmed/i);
  assert.match(eduroam.descriptionHtml, /CAT/);
  const password = SHIPPED_TEMPLATES.find((t) => /password/i.test(t.name));
  assert.match(password.descriptionHtml, /photo ID/i);
  assert.match(password.descriptionHtml, /never sees/i);
});

test('substitute replaces every supported placeholder', () => {
  const { text, unknown } = substitute(
    '{{name}} / {{ubitName}} / {{email}} / {{personNumber}} / {{date}}',
    { ...REQUESTOR, date: '2026-09-04' },
  );
  assert.equal(text, 'Anh Duy Nghiem / duynghie / duynghie@buffalo.edu / 50583450 / 2026-09-04');
  assert.deepEqual(unknown, []);
});

test('an unknown placeholder is left literal and reported, never blanked', () => {
  const { text, unknown } = substitute('Hello {{nmae}}', REQUESTOR);
  assert.equal(text, 'Hello {{nmae}}');
  assert.deepEqual(unknown, ['nmae']);
});

test('a known placeholder with no value is left literal and reported', () => {
  const { text, unknown } = substitute('UBIT: {{ubitName}}', { ...REQUESTOR, ubitName: null });
  assert.equal(text, 'UBIT: {{ubitName}}');
  assert.deepEqual(unknown, ['ubitName']);
});

test('values substituted into HTML are escaped', () => {
  const { text } = substitute('<p>{{name}}</p>', { name: 'A <script>alert(1)</script> B' }, { escape: true });
  assert.ok(!text.includes('<script>'));
  assert.match(text, /&lt;script&gt;/);
});

test('renderTemplate fills summary and description and reports unknowns once', () => {
  const template = {
    id: 't', name: 'T',
    summary: 'eduroam setup for {{ubitName}}',
    descriptionHtml: '<p>Configured eduroam for {{name}} on {{date}}. {{oops}}</p>',
    service: null,
  };
  const out = renderTemplate(template, REQUESTOR, { now: new Date('2026-09-04T12:00:00Z') });
  assert.equal(out.summary, 'eduroam setup for duynghie');
  assert.match(out.descriptionHtml, /Anh Duy Nghiem/);
  assert.match(out.descriptionHtml, /2026-09-04/);
  assert.deepEqual(out.unknown, ['oops']);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/templates.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement templates**

Create `src/data/templates.ts`:

```js
/**
 * Issue templates and placeholder substitution.
 *
 * Descriptions are written as notes for the next technician: past tense, what
 * was done and what was verified, specific enough that whoever picks up a
 * follow-up knows what has already been ruled out.
 */

const SUPPORTED = ['name', 'ubitName', 'email', 'personNumber', 'date'];
const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;

export const SHIPPED_TEMPLATES = [
  {
    id: 'blank',
    name: 'Blank',
    summary: '',
    descriptionHtml: '',
    service: null,
  },
  {
    id: 'eduroam',
    name: 'Set up eduroam',
    summary: 'eduroam setup — {{ubitName}}',
    descriptionHtml: '<p>Walk-in. Set up eduroam for {{name}} ({{ubitName}}) on {{date}}.</p>'
      + '<ul><li>Removed the stale eduroam profile from the device.</li>'
      + '<li>Ran the eduroam CAT configuration tool.</li>'
      + '<li>Signed in with UBITName credentials and accepted the certificate prompt.</li>'
      + '<li>Confirmed the device pulled an address and reached the internet before they left.</li></ul>',
    service: null,
  },
  {
    id: 'password-reset',
    name: 'Reset UBITName password',
    summary: 'UBITName password reset — {{ubitName}}',
    descriptionHtml: '<p>Walk-in. UBITName password reset for {{name}} ({{ubitName}}) on {{date}}.</p>'
      + '<ul><li>Photo ID verified in person against the account record.</li>'
      + '<li>User set the password themselves; staff never sees or handles it.</li>'
      + '<li>Reminded them to update saved credentials on phones, tablets, and eduroam profiles.</li>'
      + '<li>Confirmed sign-in before they left.</li></ul>',
    service: null,
  },
  {
    id: 'duo',
    name: 'Set up Duo two-step',
    summary: 'Duo two-step enrollment — {{ubitName}}',
    descriptionHtml: '<p>Walk-in. Duo two-step enrollment for {{name}} ({{ubitName}}) on {{date}}.</p>'
      + '<ul><li>Identity verified in person.</li>'
      + '<li>Duo Mobile installed and the device enrolled.</li>'
      + '<li>Push notification tested end to end.</li>'
      + '<li>Backup method discussed so a lost phone does not lock the account out.</li></ul>',
    service: null,
  },
];

export function substitute(text, values, { escape = false } = {}) {
  const unknown = [];
  const out = String(text ?? '').replace(PLACEHOLDER, (whole, key) => {
    const value = SUPPORTED.includes(key) ? values?.[key] : undefined;
    if (value === undefined || value === null || value === '') {
      // Left literal on purpose: a blanked field looks correct and is not, and
      // a typo in a template should be visible in the results panel.
      unknown.push(key);
      return whole;
    }
    return escape ? escapeHtml(String(value)) : String(value);
  });
  return { text: out, unknown };
}

export function renderTemplate(template, requestorFields = {}, { now = new Date() } = {}) {
  const values = { ...requestorFields, date: formatDate(now) };
  const summary = substitute(template.summary ?? '', values);
  const description = substitute(template.descriptionHtml ?? '', values, { escape: true });
  return {
    summary: summary.text,
    descriptionHtml: description.text,
    unknown: [...new Set([...summary.unknown, ...description.unknown])],
  };
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test test/templates.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/data/templates.ts test/templates.test.ts
git commit -m "feat: shipped issue templates and reporting placeholder substitution"
```

---

### Task 13: Local example retrieval

**Files:**
- Create: `src/service/retriever.ts`
- Test: `test/retriever.test.ts`

**Interfaces:**
- Consumes: `examples` records from Task 11.
- Produces:
  - `retrieve(queryText, examples) -> Ranked[]` sorted by score descending.
  - `Ranked = { service: {id, text}, score: number, evidence: [{ exampleId, snippet, terms: string[] }] }`
  - Scores are in `[0, 1]`. An empty corpus returns `[]`.

- [ ] **Step 1: Write the failing test**

Create `test/retriever.test.ts`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retrieve } from '../src/service/retriever.ts';

const WIFI = { id: '288', text: 'Personal Device Consultation' };
const ACCOUNT = { id: '301', text: 'Account Management' };

const CORPUS = [
  { id: 'e1', description: 'Removed the stale eduroam profile and ran the eduroam CAT tool. Device joined wifi.', service: WIFI },
  { id: 'e2', description: 'eduroam would not connect on a laptop; reinstalled the wireless profile.', service: WIFI },
  { id: 'e3', description: 'Photo ID verified, user reset their UBITName password themselves.', service: ACCOUNT },
];

test('ACCEPTANCE: an empty corpus suggests nothing rather than guessing', () => {
  assert.deepEqual(retrieve('eduroam setup', []), []);
});

test('an empty query suggests nothing', () => {
  assert.deepEqual(retrieve('', CORPUS), []);
});

test('ranks the service whose prior tickets match the description', () => {
  const [top] = retrieve('Set up eduroam wifi profile on a laptop', CORPUS);
  assert.equal(top.service.id, WIFI.id);
});

test('a different topic ranks a different service', () => {
  const [top] = retrieve('User needs their UBITName password reset, photo ID checked', CORPUS);
  assert.equal(top.service.id, ACCOUNT.id);
});

test('scores are normalised to 0..1 and ordered descending', () => {
  const ranked = retrieve('eduroam wifi', CORPUS);
  for (const r of ranked) {
    assert.ok(r.score >= 0 && r.score <= 1, `score out of range: ${r.score}`);
  }
  const scores = ranked.map((r) => r.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
});

test('an unrelated description scores low rather than picking a winner confidently', () => {
  const ranked = retrieve('printer jammed in the copy room', CORPUS);
  assert.ok(!ranked.length || ranked[0].score < 0.2, `expected a weak match, got ${ranked[0]?.score}`);
});

test('each result carries the prior examples and the terms that matched', () => {
  const [top] = retrieve('eduroam profile', CORPUS);
  assert.ok(top.evidence.length >= 1);
  assert.ok(top.evidence[0].exampleId);
  assert.ok(top.evidence[0].snippet.length > 0);
  assert.ok(top.evidence[0].terms.includes('eduroam'));
});

test('one result per service, not one per example', () => {
  const ranked = retrieve('eduroam wifi profile', CORPUS);
  const ids = ranked.map((r) => r.service.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('stopwords do not drive the ranking', () => {
  const [top] = retrieve('the and of a to it was for on with', CORPUS);
  assert.ok(top === undefined || top.score < 0.1);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/retriever.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the retriever**

Create `src/service/retriever.ts`:

```js
/**
 * Ranks candidate services for a ticket description against examples the
 * technician has explicitly confirmed and saved.
 *
 * This is retrieval over a local corpus, not RAG and not a model. There is no
 * access to TDX ticket history: the corpus starts empty and only grows when
 * someone saves a fill they were happy with. An empty corpus suggests nothing,
 * which is the point — a cold-start guess into a routing field is worse than
 * no suggestion at all.
 *
 * The exported shape is the seam: swapping TF-IDF for an embedding retriever
 * later means writing one module that returns the same array. Nothing above
 * this file changes.
 */

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'had',
  'has', 'have', 'he', 'her', 'his', 'i', 'in', 'is', 'it', 'its', 'not', 'of',
  'on', 'or', 'she', 'that', 'the', 'their', 'them', 'then', 'they', 'this',
  'to', 'was', 'were', 'will', 'with', 'you', 'your',
]);

export function retrieve(queryText, examples) {
  const query = tokenize(queryText);
  if (!query.length || !examples?.length) return [];

  const docs = examples.map((example) => ({ example, terms: tokenize(example.description) }));
  const idf = inverseDocumentFrequency(docs.map((d) => d.terms));

  const queryVector = vectorize(query, idf);
  if (!queryVector.size) return [];

  const perService = new Map();

  for (const { example, terms } of docs) {
    const score = cosine(queryVector, vectorize(terms, idf));
    if (score <= 0) continue;

    const shared = [...new Set(terms.filter((t) => queryVector.has(t)))];
    const key = example.service.id;
    const entry = perService.get(key) ?? { service: example.service, score: 0, evidence: [] };
    // A service is as strong as its best matching prior ticket. Averaging would
    // punish a service that has one perfect match and several unrelated ones.
    entry.score = Math.max(entry.score, score);
    entry.evidence.push({ exampleId: example.id, snippet: snippet(example.description), terms: shared, score });
    perService.set(key, entry);
  }

  return [...perService.values()]
    .map((entry) => ({
      service: entry.service,
      score: round(entry.score),
      evidence: entry.evidence.sort((a, b) => b.score - a.score).slice(0, 3)
        .map(({ exampleId, snippet: s, terms }) => ({ exampleId, snippet: s, terms })),
    }))
    .sort((a, b) => b.score - a.score);
}

function tokenize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/<[^>]*>/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

function inverseDocumentFrequency(documents) {
  const df = new Map();
  for (const terms of documents) {
    for (const term of new Set(terms)) df.set(term, (df.get(term) ?? 0) + 1);
  }
  const total = documents.length;
  const idf = new Map();
  for (const [term, count] of df) {
    // Smoothed so a term appearing in every example still contributes a little.
    idf.set(term, Math.log((total + 1) / (count + 0.5)) + 1);
  }
  return idf;
}

function vectorize(terms, idf) {
  const counts = new Map();
  for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1);
  const vector = new Map();
  for (const [term, count] of counts) {
    const weight = idf.get(term);
    if (weight === undefined) continue; // a query word no example ever used
    vector.set(term, (1 + Math.log(count)) * weight);
  }
  return vector;
}

function cosine(a, b) {
  let dot = 0;
  for (const [term, weight] of a) {
    const other = b.get(term);
    if (other) dot += weight * other;
  }
  if (!dot) return 0;
  return dot / (magnitude(a) * magnitude(b));
}

function magnitude(vector) {
  let sum = 0;
  for (const weight of vector.values()) sum += weight * weight;
  return Math.sqrt(sum) || 1;
}

function snippet(text) {
  const plain = String(text ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return plain.length > 140 ? `${plain.slice(0, 137)}...` : plain;
}

function round(value) {
  return Math.round(value * 100) / 100;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test test/retriever.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/service/retriever.ts test/retriever.test.ts
git commit -m "feat: local TF-IDF example retrieval behind a swappable interface"
```

---

### Task 14: Fill policy, and the zero-network acceptance test

The only field-aware layer, and where acceptance criteria 3, 5, and 6 are proven.

**Files:**
- Create: `src/fill/policy.ts`
- Test: `test/policy.test.ts`, `test/no-network.test.ts`

**Interfaces:**
- Consumes: `resolve()` (Task 6), `applyValue`/`currentValue` (Task 10), `renderTemplate` (Task 12), `byKey`/`FILL_SET`/`DICTIONARY` (Task 3).
- Produces:
  - `planFill({ resolution, requestor, template, service, settings, now }) -> Row[]` — pure, no DOM writes.
  - `executeFill(rows, ctx) -> Promise<Row[]>` — performs writes for rows whose `action` is `write`.
  - `Row = { fieldKey, label, action: 'write'|'report', value, status, detail, control }`
  - `runFill(args, ctx) -> Promise<Row[]>` — `planFill` then `executeFill`.

- [ ] **Step 1: Write the failing test**

Create `test/policy.test.ts`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFixture } from './helpers.ts';
import { harvest } from '../src/core/harvest.ts';
import { resolve } from '../src/core/resolve.ts';
import { runFill, planFill } from '../src/fill/policy.ts';
import { SHIPPED_TEMPLATES } from '../src/data/templates.ts';

const REQUESTOR = { name: 'Anh Duy Nghiem', email: 'duynghie@buffalo.edu', ubitName: 'duynghie', personNumber: '50583450' };
const EDUROAM = SHIPPED_TEMPLATES.find((t) => t.id === 'eduroam');
const SERVICE = { id: '288', text: 'Personal Device Consultation' };
const bridge = { async setEditorData() { return { ok: false, detail: 'no CKEDITOR in jsdom' }; } };

const setup = (doc = loadFixture()) => {
  const controls = harvest(doc);
  return { doc, controls, resolution: resolve(controls) };
};

const row = (rows, key) => rows.find((r) => r.fieldKey === key);
const settings = (over = {}) => ({ threshold: 0.35, overwrite: false, diagnostics: false, ...over });

test('every fill-set field produces a row with a status; nothing fails silently', async () => {
  const { resolution } = setup();
  const rows = await runFill({ resolution, requestor: REQUESTOR, template: EDUROAM, service: SERVICE, settings: settings() }, { bridge });
  for (const key of ['ubitName', 'briefSummary', 'description', 'source', 'service']) {
    const r = row(rows, key);
    assert.ok(r, `${key} produced no row`);
    assert.ok(['filled', 'preserved', 'skipped', 'failed', 'needs-confirm'].includes(r.status), `${key} status ${r.status}`);
    assert.equal(typeof r.detail, 'string');
  }
});

test('the five fields are written with the right values', async () => {
  const { doc, resolution } = setup();
  await runFill({ resolution, requestor: REQUESTOR, template: EDUROAM, service: SERVICE, settings: settings() }, { bridge });
  assert.equal(doc.getElementById('attribute2445').value, 'duynghie');
  assert.match(doc.getElementById('attribute37').value, /eduroam/i);
  assert.equal(doc.getElementById('attribute371').options[doc.getElementById('attribute371').selectedIndex].textContent.trim(), 'Walkup');
  assert.equal(doc.getElementById('attribute789').value, '288');
  assert.match(doc.getElementById('attribute138_Content').value, /eduroam CAT/);
});

test('ACCEPTANCE: affiliation is never written', async () => {
  const { doc, resolution } = setup();
  const before = doc.getElementById('attribute2706').value;
  const rows = await runFill({ resolution, requestor: REQUESTOR, template: EDUROAM, service: SERVICE, settings: settings() }, { bridge });
  assert.equal(doc.getElementById('attribute2706').value, before);
  const affiliation = row(rows, 'affiliation');
  assert.equal(affiliation.status, 'skipped');
  assert.match(affiliation.detail, /scope/i);
});

test('ACCEPTANCE: the extension never calls submit', async () => {
  const { doc, resolution } = setup();
  const form = doc.querySelector('form');
  form.submit = () => { throw new Error('submit() was called'); };
  form.addEventListener('submit', () => { throw new Error('submit event dispatched'); });
  await runFill({ resolution, requestor: REQUESTOR, template: EDUROAM, service: SERVICE, settings: settings() }, { bridge });
});

test('a non-empty control is preserved by default', async () => {
  const { doc, resolution } = setup();
  doc.getElementById('attribute2445').value = 'someoneelse';
  const rows = await runFill({ resolution, requestor: REQUESTOR, template: EDUROAM, service: SERVICE, settings: settings() }, { bridge });
  assert.equal(row(rows, 'ubitName').status, 'preserved');
  assert.equal(doc.getElementById('attribute2445').value, 'someoneelse');
});

test('the overwrite toggle replaces an existing value', async () => {
  const { doc, resolution } = setup();
  doc.getElementById('attribute2445').value = 'someoneelse';
  const rows = await runFill({ resolution, requestor: REQUESTOR, template: EDUROAM, service: SERVICE, settings: settings({ overwrite: true }) }, { bridge });
  assert.equal(row(rows, 'ubitName').status, 'filled');
  assert.equal(doc.getElementById('attribute2445').value, 'duynghie');
});

test('a missing UBITName falls back to the value the field itself asks for', async () => {
  const { doc, resolution } = setup();
  const rows = await runFill({ resolution, requestor: { ...REQUESTOR, ubitName: null }, template: EDUROAM, service: SERVICE, settings: settings() }, { bridge });
  assert.equal(row(rows, 'ubitName').status, 'filled');
  assert.equal(doc.getElementById('attribute2445').value, 'Unknown');
});

test('no confirmed service means the field is reported, not guessed', async () => {
  const { doc, resolution } = setup();
  const rows = await runFill({ resolution, requestor: REQUESTOR, template: EDUROAM, service: null, settings: settings() }, { bridge });
  const r = row(rows, 'service');
  assert.equal(r.status, 'needs-confirm');
  assert.match(r.detail, /confirm/i);
  assert.equal(doc.getElementById('attribute789').value, '288', 'the TDX prefill must be left exactly as it was');
});

test('an unresolved field is reported as unresolved, not written somewhere plausible', async () => {
  const doc = loadFixture();
  doc.getElementById('attribute2445-grp')?.remove();
  doc.getElementById('attribute2445')?.closest('.form-group')?.remove();
  const { resolution } = setup(doc);
  const rows = await runFill({ resolution, requestor: REQUESTOR, template: EDUROAM, service: SERVICE, settings: settings() }, { bridge });
  const r = row(rows, 'ubitName');
  assert.equal(r.status, 'skipped');
  assert.match(r.detail, /not found|unresolved/i);
});

test('out-of-scope resolved fields are reported so the technician sees them', async () => {
  const { resolution } = setup();
  const rows = await runFill({ resolution, requestor: REQUESTOR, template: EDUROAM, service: SERVICE, settings: settings() }, { bridge });
  for (const key of ['impact', 'urgency', 'status', 'location']) {
    const r = row(rows, key);
    assert.ok(r, `${key} not reported`);
    assert.equal(r.status, 'skipped');
  }
});

test('planFill writes nothing to the DOM', () => {
  const { doc, resolution } = setup();
  const before = doc.getElementById('attribute37').value;
  planFill({ resolution, requestor: REQUESTOR, template: EDUROAM, service: SERVICE, settings: settings() });
  assert.equal(doc.getElementById('attribute37').value, before);
});

test('an adapter failure surfaces as failed with the mismatch, not as success', async () => {
  const { doc, resolution } = setup();
  const el = doc.getElementById('attribute2445');
  el.addEventListener('change', () => { el.value = ''; });
  const rows = await runFill({ resolution, requestor: REQUESTOR, template: EDUROAM, service: SERVICE, settings: settings() }, { bridge });
  assert.equal(row(rows, 'ubitName').status, 'failed');
  assert.match(row(rows, 'ubitName').detail, /read back/i);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/policy.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the fill policy**

Create `src/fill/policy.ts`:

```js
/**
 * Decides what to write and whether to write it.
 *
 * This is the ONLY field-aware layer. Adapters below it take a control and a
 * value and know nothing about which field they serve; the resolver above it
 * maps controls to fields and knows nothing about values. Keeping the three
 * apart is what makes the engine testable against forms it has never seen.
 */

import { DICTIONARY, FILL_SET, byKey } from '../core/dictionary.ts';
import { applyValue, currentValue } from '../adapters/index.ts';
import { renderTemplate } from '../data/templates.ts';

const OUT_OF_SCOPE = 'out of fill scope — resolved and reported, never written';

export function planFill({ resolution, requestor = {}, template, service = null, settings, now = new Date() }) {
  const rendered = template ? renderTemplate(template, requestor, { now }) : { summary: '', descriptionHtml: '', unknown: [] };
  const rows = [];

  for (const fieldKey of FILL_SET) {
    const def = byKey(fieldKey);
    const match = resolution.byField.get(fieldKey);

    if (!match) {
      rows.push(report(def, 'skipped', 'not found on this form (unresolved)'));
      continue;
    }

    const { value, blocked } = valueFor(fieldKey, { rendered, requestor, service });
    if (blocked) {
      rows.push({ ...report(def, blocked.status, blocked.detail), control: match.control, confidence: match.confidence });
      continue;
    }

    const existing = currentValue(match.control);
    if (existing && !settings.overwrite) {
      rows.push({
        ...report(def, 'preserved', `already set to ${JSON.stringify(truncate(existing))}; enable overwrite to replace`),
        control: match.control, confidence: match.confidence,
      });
      continue;
    }

    rows.push({
      fieldKey, label: def.label, action: 'write', value,
      status: 'pending', detail: '', control: match.control, confidence: match.confidence,
    });
  }

  // Everything else the resolver found: reported so a technician can see what
  // the engine understood, and so a bad match is visible before it matters.
  for (const def of DICTIONARY) {
    if (FILL_SET.includes(def.key)) continue;
    const match = resolution.byField.get(def.key);
    if (!match) continue;
    rows.push({ ...report(def, 'skipped', OUT_OF_SCOPE), control: match.control, confidence: match.confidence });
  }

  if (rendered.unknown.length) {
    rows.push({
      fieldKey: '__placeholders', label: 'Template placeholders', action: 'report',
      status: 'failed', detail: `left literal because no value was available: ${rendered.unknown.map((u) => `{{${u}}}`).join(', ')}`,
      control: null, value: null,
    });
  }

  return rows;
}

export async function executeFill(rows, ctx = {}) {
  const done = [];
  // Serial on purpose: a widget that re-renders on change can invalidate the
  // element another adapter is holding.
  for (const row of rows) {
    if (row.action !== 'write') {
      done.push(row);
      continue;
    }
    const result = await applyValue(row.control, row.value, ctx);
    done.push({ ...row, status: result.status, detail: result.detail });
  }
  return done;
}

export async function runFill(args, ctx) {
  return executeFill(planFill(args), ctx);
}

function valueFor(fieldKey, { rendered, requestor, service }) {
  switch (fieldKey) {
    case 'ubitName':
      // The field's own placeholder reads "If unknown, please state so."
      return { value: requestor.ubitName || 'Unknown' };
    case 'briefSummary':
      return rendered.summary
        ? { value: rendered.summary }
        : { blocked: { status: 'skipped', detail: 'the selected template has no summary' } };
    case 'description':
      return rendered.descriptionHtml
        ? { value: rendered.descriptionHtml }
        : { blocked: { status: 'skipped', detail: 'the selected template has no description' } };
    case 'source':
      return { value: byKey('source').fixedValue };
    case 'service':
      return service?.id && service?.text
        ? { value: service }
        : { blocked: { status: 'needs-confirm', detail: 'no confirmed service — pick or confirm one in the panel before filling' } };
    default:
      return { blocked: { status: 'skipped', detail: OUT_OF_SCOPE } };
  }
}

function report(def, status, detail) {
  return { fieldKey: def.key, label: def.label, action: 'report', value: null, status, detail, control: null };
}

function truncate(text) {
  return text.length > 40 ? `${text.slice(0, 37)}...` : text;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test test/policy.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Write the zero-network acceptance test**

Create `test/no-network.test.ts`:

```js
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
function armNetworkTraps(targets) {
  const tripped = [];
  const trap = (name) => function () { tripped.push(name); throw new Error(`network call attempted: ${name}`); };
  for (const target of targets) {
    for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Request']) {
      try { target[name] = trap(name); } catch { /* frozen in some environments */ }
    }
    try { target.navigator = { ...target.navigator, sendBeacon: trap('sendBeacon') }; } catch { /* read-only */ }
  }
  return tripped;
}

test('ACCEPTANCE: a full parse to fill cycle makes no network request', async () => {
  const doc = loadFixture();
  const tripped = armNetworkTraps([globalThis, doc.defaultView]);

  const { fields: requestor } = parseRequestor(BLOCK);
  const controls = harvest(doc);
  const resolution = resolve(controls, { learned: {} });
  formSignature(doc);

  const stores = createStores(createMemoryArea());
  await stores.settings.patch({ overwrite: true });
  await stores.examples.add({ description: 'eduroam profile removed and CAT tool run', service: { id: '288', text: 'Personal Device Consultation' } });
  const examples = await stores.examples.list();
  const ranked = retrieve('set up eduroam on a laptop', examples);

  const rows = await runFill({
    resolution,
    requestor,
    template: SHIPPED_TEMPLATES.find((t) => t.id === 'eduroam'),
    service: ranked[0]?.service ?? null,
    settings: await stores.settings.get(),
  }, { bridge: { async setEditorData() { return { ok: false, detail: 'no CKEDITOR in jsdom' }; } } });

  assert.ok(rows.length > 0);
  assert.deepEqual(tripped, [], `network primitives were called: ${tripped.join(', ')}`);
});

test('no source file references a network primitive or an external URL', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');

  const files = [];
  const walk = (dir) => {
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
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS, every file. If the second test fails on `src/adapters/lookup.ts`, that means a lookup is driving the autocomplete — the design says it must not.

- [ ] **Step 7: Commit**

```bash
git add src/fill/policy.ts test/policy.test.ts test/no-network.test.ts
git commit -m "feat: fill policy with preserve-by-default, plus zero-network acceptance test"
```

---

### Task 15: Stylesheet and the results panel

The results panel is the most important element in the UI: it is what turns a
form that looks correct into a form you can tell is correct.

**Files:**
- Create: `src/ui/panel.css.ts`, `src/ui/results.ts`
- Test: `test/results.test.ts`

**Interfaces:**
- Consumes: `Row[]` from Task 14.
- Produces:
  - `PANEL_CSS: string`
  - `renderResults(rows, { doc, onCorrect, fieldOptions }) -> HTMLElement`
  - `highlightFilled(rows, doc) -> void`
  - `STATUS_META: Record<status, { icon, tone, order }>`

- [ ] **Step 1: Write the stylesheet**

Create `src/ui/panel.css.ts`:

```js
/**
 * The panel stylesheet.
 *
 * Exported as a string rather than shipped as a .css file because a shadow
 * root needs the CSS *text*, and loading a stylesheet from the extension would
 * require declaring it in web_accessible_resources — widening what any page
 * can see for no benefit. Do not "fix" this back into a .css file.
 *
 * The palette is deliberately unlike TDX's white and blue: the panel should
 * read as a separate instrument sitting on top of the page, not as part of it.
 */
export const PANEL_CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: system-ui, -apple-system, Segoe UI, sans-serif; }

.panel {
  position: fixed; right: 16px; bottom: 16px; width: 330px; max-height: 78vh;
  display: flex; flex-direction: column; overflow: hidden;
  background: #1c1b1a; color: #ece7e1;
  border: 1px solid #3a3733; border-radius: 10px;
  box-shadow: 0 10px 30px rgba(0,0,0,.45);
  font-size: 13px; line-height: 1.45; z-index: 2147483000;
}
.panel[data-collapsed="true"] .body { display: none; }

.head {
  display: flex; align-items: center; gap: 8px;
  padding: 9px 11px; background: #262421; border-bottom: 1px solid #3a3733;
}
.head h1 { margin: 0; font-size: 12px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: #f0a71c; flex: 1; }

.body { overflow-y: auto; padding: 11px; display: flex; flex-direction: column; gap: 11px; }
section { display: flex; flex-direction: column; gap: 6px; }
h2 { margin: 0; font-size: 11px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: #a29a90; }

textarea, input, select {
  width: 100%; padding: 6px 7px; font: inherit;
  background: #141312; color: #ece7e1;
  border: 1px solid #45403a; border-radius: 5px;
}
textarea { min-height: 76px; resize: vertical; }

button {
  padding: 6px 10px; font: inherit; font-weight: 600; cursor: pointer;
  background: #2f2c28; color: #ece7e1;
  border: 1px solid #4a453e; border-radius: 5px;
}
button:hover { background: #3a3630; }
button.primary { background: #f0a71c; border-color: #f0a71c; color: #1c1b1a; }
button.primary:hover { background: #ffbb3d; }
.row { display: flex; gap: 6px; }

/* Focus must be obvious: this panel is used at a walk-up desk, often by keyboard. */
:focus-visible { outline: 2px solid #f0a71c; outline-offset: 2px; }

/* Monospace only where character accuracy is the point. */
.ident { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; word-break: break-all; }

.parsed { display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; }
.parsed dt { color: #a29a90; font-size: 11px; }
.parsed dd { margin: 0; }
.missing { color: #ff9b8a; }

.results { display: flex; flex-direction: column; gap: 3px; margin: 0; padding: 0; list-style: none; }
.result { display: grid; grid-template-columns: 16px 1fr; gap: 6px; padding: 4px 5px; border-radius: 4px; background: #232120; }
.result .icon { text-align: center; }
.result .name { font-weight: 600; }
.result .detail { grid-column: 2; color: #a29a90; font-size: 11.5px; }
.result[data-tone="good"] .icon { color: #7fd18b; }
.result[data-tone="warn"] .icon { color: #f0a71c; }
.result[data-tone="bad"] .icon { color: #ff7a66; }
.result[data-tone="mute"] .icon { color: #7d766e; }
.result[data-tone="mute"] { opacity: .72; }
.result select { margin-top: 4px; grid-column: 2; }

pre.diagnostics {
  margin: 0; padding: 8px; max-height: 260px; overflow: auto;
  background: #141312; border: 1px solid #45403a; border-radius: 5px;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 11px; white-space: pre;
}
.note { color: #a29a90; font-size: 11.5px; margin: 0; }
`;
```

- [ ] **Step 2: Write the failing test for results**

Create `test/results.test.ts`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderResults, highlightFilled, STATUS_META } from '../src/ui/results.ts';

const dom = () => new JSDOM('<body><input id="a"><input id="b"></body>').window.document;

const rows = (doc) => [
  { fieldKey: 'briefSummary', label: 'Brief Summary', status: 'filled', detail: '', control: { key: 'a', el: doc.getElementById('a') }, confidence: 0.95 },
  { fieldKey: 'source', label: 'Source', status: 'filled', detail: '"Walkup"', control: { key: 'b', el: doc.getElementById('b') }, confidence: 0.95 },
  { fieldKey: 'service', label: 'Service', status: 'needs-confirm', detail: 'no confirmed service', control: null, confidence: 0.95 },
  { fieldKey: 'location', label: 'Location', status: 'failed', detail: 'wrote "139", read back ""', control: null, confidence: 0.4 },
  { fieldKey: 'affiliation', label: 'Affiliation', status: 'skipped', detail: 'out of fill scope', control: null, confidence: 0.9 },
];

test('renders one row per result with an icon and the detail text', () => {
  const doc = dom();
  const el = renderResults(rows(doc), { doc });
  assert.equal(el.querySelectorAll('.result').length, 5);
  assert.match(el.textContent, /Brief Summary/);
  assert.match(el.textContent, /wrote "139", read back ""/);
});

test('problems sort above successes, because the failures are the point', () => {
  const doc = dom();
  const el = renderResults(rows(doc), { doc });
  const names = [...el.querySelectorAll('.result .name')].map((n) => n.textContent);
  assert.ok(names.indexOf('Location') < names.indexOf('Brief Summary'), 'failed row must come first');
  assert.ok(names.indexOf('Service') < names.indexOf('Brief Summary'), 'needs-confirm must come before filled');
});

test('a low-confidence match is flagged with its score even when it filled', () => {
  const doc = dom();
  const el = renderResults([
    { fieldKey: 'location', label: 'Location', status: 'filled', detail: '', control: { key: 'a', el: doc.getElementById('a') }, confidence: 0.4 },
  ], { doc });
  assert.match(el.textContent, /0\.4/);
  assert.equal(el.querySelector('.result').dataset.tone, 'warn');
});

test('every status maps to a tone and an icon', () => {
  for (const status of ['filled', 'preserved', 'skipped', 'failed', 'needs-confirm']) {
    assert.ok(STATUS_META[status], `no meta for ${status}`);
    assert.ok(STATUS_META[status].icon);
    assert.ok(['good', 'warn', 'bad', 'mute'].includes(STATUS_META[status].tone));
  }
});

test('a correction control reports the control key and the newly chosen field', () => {
  const doc = dom();
  const seen = [];
  const el = renderResults(rows(doc), {
    doc,
    fieldOptions: [{ key: 'location', label: 'Location' }, { key: 'briefSummary', label: 'Brief Summary' }],
    onCorrect: (controlKey, fieldKey) => seen.push([controlKey, fieldKey]),
  });
  const row = [...el.querySelectorAll('.result')].find((r) => r.textContent.includes('Brief Summary'));
  const select = row.querySelector('select');
  assert.ok(select, 'a filled row must offer a correction');
  select.value = 'location';
  select.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
  assert.deepEqual(seen, [['a', 'location']]);
});

test('highlightFilled outlines the controls that were written and nothing else', () => {
  const doc = dom();
  const all = rows(doc);
  highlightFilled(all, doc);
  assert.ok(doc.getElementById('a').classList.contains('tdxa-touched'));
  assert.ok(doc.getElementById('b').classList.contains('tdxa-touched'));
  assert.equal(doc.querySelectorAll('.tdxa-touched').length, 2);
});

test('highlightFilled injects its stylesheet once, not once per fill', () => {
  const doc = dom();
  highlightFilled(rows(doc), doc);
  highlightFilled(rows(doc), doc);
  assert.equal(doc.querySelectorAll('style[data-tdxa-highlight]').length, 1);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node --test test/results.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the results panel**

Create `src/ui/results.ts`:

```js
/**
 * Renders the outcome of a fill.
 *
 * The design rule this file exists to serve: when TDX changes, the technician
 * must see "Location — wrote 139, read back nothing", not a form that looks
 * fine and submits wrong. So failures sort to the top, every row carries a
 * reason, and low-confidence matches are flagged even when they succeeded.
 */

export const STATUS_META = {
  failed: { icon: '✕', tone: 'bad', order: 0 },
  'needs-confirm': { icon: '⚠', tone: 'warn', order: 1 },
  preserved: { icon: '•', tone: 'mute', order: 2 },
  skipped: { icon: '–', tone: 'mute', order: 3 },
  filled: { icon: '✓', tone: 'good', order: 4 },
};

const LOW_CONFIDENCE = 0.6;

export function renderResults(rows, { doc, onCorrect, fieldOptions = [] } = {}) {
  const document = doc ?? globalThis.document;
  const list = document.createElement('ul');
  list.className = 'results';

  const sorted = [...rows].sort((a, b) => {
    const byStatus = meta(a.status).order - meta(b.status).order;
    return byStatus !== 0 ? byStatus : a.label.localeCompare(b.label);
  });

  for (const row of sorted) {
    const info = meta(row.status);
    const lowConfidence = typeof row.confidence === 'number' && row.confidence <= LOW_CONFIDENCE;

    const item = document.createElement('li');
    item.className = 'result';
    item.dataset.tone = lowConfidence && info.tone === 'good' ? 'warn' : info.tone;
    item.dataset.field = row.fieldKey;

    const icon = document.createElement('span');
    icon.className = 'icon';
    icon.textContent = lowConfidence && info.tone === 'good' ? STATUS_META['needs-confirm'].icon : info.icon;
    icon.setAttribute('aria-hidden', 'true');

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = row.label;

    const detail = document.createElement('span');
    detail.className = 'detail';
    detail.textContent = [
      row.status,
      row.detail || null,
      lowConfidence ? `matched at ${row.confidence} confidence — check this one` : null,
    ].filter(Boolean).join(' — ');

    item.append(icon, name, detail);

    if (onCorrect && row.control?.key && fieldOptions.length) {
      item.append(correctionControl(document, row, fieldOptions, onCorrect));
    }

    list.append(item);
  }

  return list;
}

function correctionControl(document, row, fieldOptions, onCorrect) {
  const select = document.createElement('select');
  select.setAttribute('aria-label', `Correct the field mapped to ${row.label}`);

  const keep = document.createElement('option');
  keep.value = '';
  keep.textContent = 'Mapped correctly';
  select.append(keep);

  for (const option of fieldOptions) {
    if (option.key === row.fieldKey) continue;
    const el = document.createElement('option');
    el.value = option.key;
    el.textContent = `Actually: ${option.label}`;
    select.append(el);
  }

  select.addEventListener('change', () => {
    if (select.value) onCorrect(row.control.key, select.value);
  });
  return select;
}

/**
 * Outlines the controls the fill actually wrote, so the technician can see at
 * a glance what was touched without reading the list.
 */
export function highlightFilled(rows, doc) {
  const document = doc ?? globalThis.document;
  injectHighlightStyle(document);
  for (const el of document.querySelectorAll('.tdxa-touched')) el.classList.remove('tdxa-touched');
  for (const row of rows) {
    if (row.status !== 'filled') continue;
    const el = row.control?.el ?? row.control?.lookup?.input ?? row.control?.richtext?.textarea;
    el?.classList.add('tdxa-touched');
  }
}

function injectHighlightStyle(document) {
  if (document.querySelector('style[data-tdxa-highlight]')) return;
  const style = document.createElement('style');
  style.setAttribute('data-tdxa-highlight', '');
  style.textContent = '.tdxa-touched { outline: 2px dashed #f0a71c !important; outline-offset: 1px !important; }';
  (document.head ?? document.documentElement).append(style);
}

function meta(status) {
  return STATUS_META[status] ?? { icon: '?', tone: 'mute', order: 9 };
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `node --test test/results.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add src/ui/panel.css.ts src/ui/results.ts test/results.test.ts
git commit -m "feat: panel stylesheet and results panel with failures sorted first"
```

---

### Task 16: Diagnostic mode and settings

**Files:**
- Create: `src/ui/diagnostics.ts`, `src/ui/settings.ts`
- Test: `test/diagnostics.test.ts`, `test/settings.test.ts`

**Interfaces:**
- Consumes: `Resolution.diagnostics` (Task 6), `Stores` (Task 11), `SHIPPED_TEMPLATES` (Task 12).
- Produces:
  - `formatDiagnostics(resolution, { signature, url }) -> string`
  - `renderDiagnostics(text, { doc }) -> HTMLElement`
  - `renderSettings({ doc, stores, onChange }) -> Promise<HTMLElement>`

- [ ] **Step 1: Write the failing test for diagnostics**

Create `test/diagnostics.test.ts`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { loadFixture } from './helpers.ts';
import { harvest } from '../src/core/harvest.ts';
import { resolve } from '../src/core/resolve.ts';
import { formSignature } from '../src/core/signature.ts';
import { formatDiagnostics, renderDiagnostics } from '../src/ui/diagnostics.ts';

const dump = () => {
  const doc = loadFixture();
  return formatDiagnostics(resolve(harvest(doc)), { signature: formSignature(doc) });
};

test('the dump is plain text, so it pastes into a ticket or a chat unchanged', () => {
  const text = dump();
  assert.equal(typeof text, 'string');
  assert.ok(!text.includes('<'), 'must contain no markup');
});

test('every harvested control appears with its label, markers, shape, and resolution', () => {
  const text = dump();
  assert.match(text, /attribute37/);
  assert.match(text, /Brief Summary/);
  assert.match(text, /title/);        // data-fieldtype
  assert.match(text, /briefSummary/); // resolved field key
  assert.match(text, /tier/i);
});

test('runners-up are included, because tuning the dictionary needs the near misses', () => {
  const text = dump();
  assert.match(text, /runners?[- ]up/i);
});

test('the form signature is included so a learned mapping can be traced', () => {
  const doc = loadFixture();
  const signature = formSignature(doc);
  assert.ok(dump().includes(signature));
});

test('an unresolved control is shown as unresolved rather than omitted', () => {
  const text = dump();
  assert.match(text, /unresolved|—\s*none/i);
});

test('renderDiagnostics produces a pre plus a working copy button', async () => {
  const doc = new JSDOM('<body></body>').window.document;
  const copied = [];
  doc.defaultView.navigator.clipboard = { writeText: async (t) => copied.push(t) };
  const el = renderDiagnostics('hello diagnostics', { doc });
  assert.ok(el.querySelector('pre.diagnostics'));
  assert.equal(el.querySelector('pre').textContent, 'hello diagnostics');
  el.querySelector('button').click();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(copied, ['hello diagnostics']);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/diagnostics.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement diagnostics**

Create `src/ui/diagnostics.ts`:

```js
/**
 * Diagnostic mode: everything the resolver saw and everything it decided.
 *
 * This is how a bad match gets debugged and how the dictionary gets tuned, so
 * it is plain text rather than a table — it has to survive being pasted into a
 * ticket, a chat message, or an issue without reformatting.
 */

export function formatDiagnostics(resolution, { signature = '', url = '' } = {}) {
  const lines = [
    'TDX Autofill — resolution diagnostics',
    `form signature: ${signature}`,
    url ? `page: ${url}` : null,
    `controls harvested: ${resolution.diagnostics.length}`,
    `fields resolved: ${resolution.byField.size}`,
    '',
  ].filter((line) => line !== null);

  for (const { control, winner, runnersUp } of resolution.diagnostics) {
    lines.push(`- ${control.label ?? '(no label)'}`);
    lines.push(`    id=${control.id ?? '-'}  name=${control.name ?? '-'}  shape=${control.shape}`);
    lines.push(`    data-fieldtype=${control.fieldType ?? '-'}  data-fieldid=${control.fieldId ?? '-'}`);
    if (control.options.length) {
      lines.push(`    options: ${control.options.filter(Boolean).slice(0, 8).join(' | ')}${control.options.length > 8 ? ' | ...' : ''}`);
    }
    if (winner) {
      lines.push(`    -> ${winner.fieldKey}  confidence=${winner.confidence}  tier=${winner.tier}  (${winner.evidence})`);
    } else {
      lines.push('    -> unresolved');
    }
    lines.push(`    runners-up: ${runnersUp.length ? runnersUp.map((r) => `${r.fieldKey}=${round(r.score)}`).join(', ') : 'none'}`);
    lines.push('');
  }

  if (resolution.unresolvedFields.length) {
    lines.push(`fields with no control on this form: ${resolution.unresolvedFields.join(', ')}`);
  }

  return lines.join('\n');
}

export function renderDiagnostics(text, { doc } = {}) {
  const document = doc ?? globalThis.document;
  const wrap = document.createElement('section');

  const heading = document.createElement('h2');
  heading.textContent = 'Diagnostics';

  const pre = document.createElement('pre');
  pre.className = 'diagnostics';
  pre.tabIndex = 0;
  pre.textContent = text;

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = 'Copy diagnostics';
  copy.addEventListener('click', () => {
    document.defaultView?.navigator?.clipboard?.writeText(text);
  });

  wrap.append(heading, pre, copy);
  return wrap;
}

function round(value) {
  return Math.round(value * 100) / 100;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test test/diagnostics.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the failing test for settings**

Create `test/settings.test.ts`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createStores, createMemoryArea } from '../src/data/stores.ts';
import { renderSettings } from '../src/ui/settings.ts';

const setup = async (seed) => {
  const doc = new JSDOM('<body></body>').window.document;
  const stores = createStores(createMemoryArea());
  await seed?.(stores);
  return { doc, stores, el: await renderSettings({ doc, stores }) };
};

test('shows the current threshold and persists a change', async () => {
  const { el, stores, doc } = await setup();
  const input = el.querySelector('input[name="threshold"]');
  assert.equal(Number(input.value), 0.35);
  input.value = '0.5';
  input.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
  await new Promise((r) => setImmediate(r));
  assert.equal((await stores.settings.get()).threshold, 0.5);
});

test('lists stored templates and can remove one', async () => {
  const { el, stores, doc } = await setup(async (s) => {
    await s.templates.save({ id: 'x', name: 'Custom thing', summary: '', descriptionHtml: '', service: null });
  });
  assert.match(el.textContent, /Custom thing/);
  el.querySelector('button[data-remove-template="x"]').dispatchEvent(new doc.defaultView.Event('click', { bubbles: true }));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(await stores.templates.list(), []);
});

test('adding a template stores it', async () => {
  const { el, stores, doc } = await setup();
  el.querySelector('input[name="templateName"]').value = 'Printer setup';
  el.querySelector('input[name="templateSummary"]').value = 'Printer setup — {{ubitName}}';
  el.querySelector('textarea[name="templateDescription"]').value = '<p>Installed the driver.</p>';
  el.querySelector('button[data-add-template]').dispatchEvent(new doc.defaultView.Event('click', { bubbles: true }));
  await new Promise((r) => setImmediate(r));
  const [saved] = await stores.templates.list();
  assert.equal(saved.name, 'Printer setup');
  assert.equal(saved.service, null, 'a new template must not invent a service id');
});

test('clearing learned mappings empties the store', async () => {
  const { el, stores, doc } = await setup(async (s) => s.learned.set('sig', { a: 'briefSummary' }));
  el.querySelector('button[data-clear-learned]').dispatchEvent(new doc.defaultView.Event('click', { bubbles: true }));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(await stores.learned.get('sig'), {});
});

test('saved examples can be listed and deleted, because a wrong one poisons retrieval', async () => {
  const { el, stores, doc } = await setup(async (s) => {
    await s.examples.add({ description: 'bad example', service: { id: '1', text: 'Wrong' } });
  });
  assert.match(el.textContent, /bad example/);
  const [example] = await stores.examples.list();
  el.querySelector(`button[data-remove-example="${example.id}"]`).dispatchEvent(new doc.defaultView.Event('click', { bubbles: true }));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(await stores.examples.list(), []);
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `node --test test/settings.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement settings**

Create `src/ui/settings.ts`:

```js
/**
 * Settings view: templates, the retrieval threshold, learned mappings, and the
 * saved examples.
 *
 * Examples are deletable because a single wrong example poisons every future
 * service suggestion, and the technician is the only one who can tell.
 */

export async function renderSettings({ doc, stores, onChange = () => {} } = {}) {
  const document = doc ?? globalThis.document;
  const wrap = document.createElement('div');

  const rerender = async () => {
    wrap.replaceChildren(...(await build(document, stores, rerender, onChange)));
  };
  await rerender();
  return wrap;
}

async function build(document, stores, rerender, onChange) {
  const [settings, templates, examples] = await Promise.all([
    stores.settings.get(), stores.templates.list(), stores.examples.list(),
  ]);

  const sections = [];

  // Retrieval threshold
  const thresholdSection = section(document, 'Service suggestion threshold');
  const threshold = document.createElement('input');
  threshold.type = 'number';
  threshold.name = 'threshold';
  threshold.min = '0';
  threshold.max = '1';
  threshold.step = '0.05';
  threshold.value = String(settings.threshold);
  threshold.addEventListener('change', async () => {
    await stores.settings.patch({ threshold: Number(threshold.value) });
    onChange();
  });
  const thresholdNote = document.createElement('p');
  thresholdNote.className = 'note';
  thresholdNote.textContent = 'Below this similarity, no service is suggested and the template default is used instead.';
  thresholdSection.append(threshold, thresholdNote);
  sections.push(thresholdSection);

  // Templates
  const templateSection = section(document, 'Templates');
  if (templates.length) {
    for (const template of templates) {
      const line = document.createElement('div');
      line.className = 'row';
      const name = document.createElement('span');
      name.style.flex = '1';
      name.textContent = template.service ? `${template.name} → ${template.service.text}` : template.name;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.setAttribute('data-remove-template', template.id);
      remove.addEventListener('click', async () => { await stores.templates.remove(template.id); await rerender(); onChange(); });
      line.append(name, remove);
      templateSection.append(line);
    }
  } else {
    templateSection.append(note(document, 'No custom templates yet. The shipped ones are always available.'));
  }

  const nameInput = labelled(document, templateSection, 'Name', 'input', 'templateName');
  const summaryInput = labelled(document, templateSection, 'Summary', 'input', 'templateSummary');
  const descriptionInput = labelled(document, templateSection, 'Description (HTML)', 'textarea', 'templateDescription');
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'primary';
  add.textContent = 'Add template';
  add.setAttribute('data-add-template', '');
  add.addEventListener('click', async () => {
    if (!nameInput.value.trim()) return;
    await stores.templates.save({
      id: `t-${Date.now().toString(36)}`,
      name: nameInput.value.trim(),
      summary: summaryInput.value,
      descriptionHtml: descriptionInput.value,
      // Never guessed. The technician captures it from a real form.
      service: null,
    });
    await rerender();
    onChange();
  });
  templateSection.append(add);
  sections.push(templateSection);

  // Saved examples
  const exampleSection = section(document, 'Saved examples');
  if (examples.length) {
    for (const example of examples) {
      const line = document.createElement('div');
      line.className = 'row';
      const text = document.createElement('span');
      text.style.flex = '1';
      text.textContent = `${truncate(example.description)} → ${example.service?.text ?? '?'}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Delete';
      remove.setAttribute('data-remove-example', example.id);
      remove.addEventListener('click', async () => { await stores.examples.remove(example.id); await rerender(); onChange(); });
      line.append(text, remove);
      exampleSection.append(line);
    }
  } else {
    exampleSection.append(note(document, 'No examples saved yet. Service suggestions start once you save some.'));
  }
  sections.push(exampleSection);

  // Learned mappings
  const learnedSection = section(document, 'Learned field mappings');
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.textContent = 'Clear all learned mappings';
  clear.setAttribute('data-clear-learned', '');
  clear.addEventListener('click', async () => { await stores.learned.clearAll(); await rerender(); onChange(); });
  learnedSection.append(note(document, 'Corrections are remembered per form. Clear them if TDX changed and the old mapping is wrong.'), clear);
  sections.push(learnedSection);

  return sections;
}

function section(document, title) {
  const el = document.createElement('section');
  const heading = document.createElement('h2');
  heading.textContent = title;
  el.append(heading);
  return el;
}

function note(document, text) {
  const p = document.createElement('p');
  p.className = 'note';
  p.textContent = text;
  return p;
}

function labelled(document, parent, text, tag, name) {
  const label = document.createElement('label');
  label.textContent = text;
  const field = document.createElement(tag);
  field.name = name;
  if (tag === 'input') field.type = 'text';
  label.append(field);
  parent.append(label);
  return field;
}

function truncate(text) {
  const plain = String(text ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return plain.length > 48 ? `${plain.slice(0, 45)}...` : plain;
}
```

- [ ] **Step 8: Run it to verify it passes**

Run: `node --test test/settings.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 9: Commit**

```bash
git add src/ui/diagnostics.ts src/ui/settings.ts test/diagnostics.test.ts test/settings.test.ts
git commit -m "feat: copy-pasteable diagnostic dump and settings view"
```

---

### Task 17: The panel, the frame mount, the build, and the README

The last task wires everything together and ships it.

**Files:**
- Create: `src/ui/panel.ts`, `src/content/mount.ts`, `README.md`
- Test: `test/panel.test.ts`, `test/mount.test.ts`

**Interfaces:**
- Consumes: every module built so far.
- Produces:
  - `createPanel({ doc, stores, bridge, now }) -> Promise<{ host, shadow, refresh, destroy }>`
  - `isTicketForm(doc) -> boolean`
  - `mountIfTicketForm(doc, deps) -> Promise<object|null>`

- [ ] **Step 1: Write the failing test for the frame self-test**

Create `test/mount.test.ts`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { loadFixture } from './helpers.ts';
import { isTicketForm, mountIfTicketForm } from '../src/content/mount.ts';
import { createStores, createMemoryArea } from '../src/data/stores.ts';

test('recognises a TDX ticket form', () => {
  assert.equal(isTicketForm(loadFixture()), true);
});

test('rejects the TDNext shell, which has a search box but no ticket form', () => {
  const doc = new JSDOM('<body><input role="search" placeholder="Search applications..."></body>').window.document;
  assert.equal(isTicketForm(doc), false);
});

test('rejects an unrelated form with no TDX field markers', () => {
  const doc = new JSDOM('<body><form><input name="q"><button>Go</button></form></body>').window.document;
  assert.equal(isTicketForm(doc), false);
});

test('mountIfTicketForm does nothing in a frame with no form', async () => {
  const doc = new JSDOM('<body></body>').window.document;
  assert.equal(await mountIfTicketForm(doc, {}), null);
  assert.equal(doc.body.children.length, 0);
});

test('in wait mode it gives up on a non-ticket frame instead of hanging', async () => {
  const doc = new JSDOM('<body></body>').window.document;
  assert.equal(await mountIfTicketForm(doc, { wait: true, timeout: 80 }), null);
});

test('in wait mode it mounts once the form appears', async () => {
  const dom = new JSDOM('<body><div id="root"></div></body>');
  const doc = dom.window.document;
  const stores = createStores(createMemoryArea());
  const pending = mountIfTicketForm(doc, {
    wait: true, timeout: 2000, stores,
    bridge: { async setEditorData() { return { ok: false, detail: 'stub' }; } },
  });
  doc.getElementById('root').innerHTML =
    '<form><div class="form-group" data-fieldtype="title" data-fieldid="37">'
    + '<label for="attribute37">Brief Summary</label><input id="attribute37" name="attribute37" type="text"></div></form>';
  const mounted = await pending;
  assert.ok(mounted, 'should have mounted once the form appeared');
  assert.ok(doc.getElementById('tdx-autofill-host'));
});
```

- [ ] **Step 2: Write the failing test for the panel**

Create `test/panel.test.ts`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFixture } from './helpers.ts';
import { createPanel } from '../src/ui/panel.ts';
import { createStores, createMemoryArea } from '../src/data/stores.ts';

const BLOCK = `Requestor
[Anh Duy Nghiem](https://ubuffalo.teamdynamix.com/TDNext/Apps/People/PersonDet.aspx?U=b067308b-2198-ef11-9c36-f06ebc4e4310)
[duynghie@buffalo.edu](mailto:duynghie@buffalo.edu)
Student Assistant - ITCX Tech Squad
University at Buffalo
50583450 - duynghie`;

const bridge = { async setEditorData() { return { ok: false, detail: 'no CKEDITOR in jsdom' }; } };
const settle = () => new Promise((r) => setImmediate(r));

const open = async (doc = loadFixture()) => {
  const stores = createStores(createMemoryArea());
  const panel = await createPanel({ doc, stores, bridge });
  return { doc, stores, panel, $: (sel) => panel.shadow.querySelector(sel) };
};

const click = (el, doc) => el.dispatchEvent(new doc.defaultView.Event('click', { bubbles: true }));

test('mounts into a shadow root so TDX stylesheets cannot reach it', async () => {
  const { panel } = await open();
  assert.ok(panel.shadow, 'no shadow root');
  assert.ok(panel.shadow.querySelector('style'), 'stylesheet not attached to the shadow root');
  assert.ok(panel.shadow.querySelector('.panel'));
});

test('contains the controls in the specified order', async () => {
  const { panel } = await open();
  const order = [...panel.shadow.querySelectorAll('[data-section]')].map((el) => el.dataset.section);
  assert.deepEqual(order, ['requestor', 'template', 'service', 'fill', 'results']);
});

test('parsing a pasted block shows the fields and flags nothing missing', async () => {
  const { $, doc } = await open();
  $('textarea[name="paste"]').value = BLOCK;
  click($('button[data-parse]'), doc);
  await settle();
  const parsed = $('.parsed').textContent;
  assert.match(parsed, /Anh Duy Nghiem/);
  assert.match(parsed, /duynghie/);
  assert.match(parsed, /b067308b-2198-ef11-9c36-f06ebc4e4310/);
  assert.equal($('.missing'), null, 'nothing should be flagged missing for a complete block');
});

test('a partial paste flags what is missing rather than silently continuing', async () => {
  const { $, doc } = await open();
  $('textarea[name="paste"]').value = 'Anh Duy Nghiem\nduynghie@buffalo.edu';
  click($('button[data-parse]'), doc);
  await settle();
  assert.ok($('.missing'), 'missing fields must be flagged');
});

test('reading from the page recovers the GUID and name TDX prefilled', async () => {
  const { $, doc } = await open();
  click($('button[data-read-page]'), doc);
  await settle();
  assert.match($('.parsed').textContent, /b067308b-2198-ef11-9c36-f06ebc4e4310/);
});

test('the identifiers are monospace and the prose is not', async () => {
  const { $, doc } = await open();
  $('textarea[name="paste"]').value = BLOCK;
  click($('button[data-parse]'), doc);
  await settle();
  const guid = [...$('.parsed').querySelectorAll('dd')].find((d) => d.textContent.includes('b067308b'));
  assert.ok(guid.classList.contains('ident'), 'the GUID must be monospace');
});

test('filling writes the five fields and renders one result row per outcome', async () => {
  const { $, doc } = await open();
  $('textarea[name="paste"]').value = BLOCK;
  click($('button[data-parse]'), doc);
  await settle();
  $('select[name="template"]').value = 'eduroam';
  $('select[name="template"]').dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
  await settle();
  click($('button[data-fill]'), doc);
  await settle();
  assert.equal(doc.getElementById('attribute2445').value, 'duynghie');
  assert.match($('.results').textContent, /Brief Summary/);
  assert.match($('.results').textContent, /Source/);
});

test('the panel never submits the form', async () => {
  const { $, doc } = await open();
  doc.querySelector('form').submit = () => { throw new Error('submit() called'); };
  doc.querySelector('form').addEventListener('submit', () => { throw new Error('submit dispatched'); });
  $('textarea[name="paste"]').value = BLOCK;
  click($('button[data-parse]'), doc);
  await settle();
  click($('button[data-fill]'), doc);
  await settle();
});

test('capturing the service stores the {id,text} pair on the selected template', async () => {
  const { $, doc, stores } = await open();
  $('select[name="template"]').value = 'eduroam';
  $('select[name="template"]').dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
  await settle();
  click($('button[data-capture-service]'), doc);
  await settle();
  const saved = (await stores.templates.list()).find((t) => t.id === 'eduroam');
  assert.deepEqual(saved.service, { id: '288', text: 'Personal Device Software and Support / Personal Device Consultation' });
});

test('with no examples saved, the service row says template default and suggests nothing', async () => {
  const { $ } = await open();
  assert.match($('[data-section="service"]').textContent, /template default|no service captured/i);
  assert.equal($('button[data-confirm-service]'), null, 'nothing to confirm with an empty corpus');
});

test('toggling diagnostics renders the copy-pasteable dump', async () => {
  const { $, doc } = await open();
  click($('button[data-diagnostics]'), doc);
  await settle();
  const pre = $('pre.diagnostics');
  assert.ok(pre);
  assert.match(pre.textContent, /attribute37/);
  assert.match(pre.textContent, /runners-up/);
});

test('the panel collapses and remembers it', async () => {
  const { $, doc, stores } = await open();
  click($('button[data-collapse]'), doc);
  await settle();
  assert.equal($('.panel').dataset.collapsed, 'true');
  assert.equal((await stores.settings.get()).collapsed, true);
});
```

- [ ] **Step 3: Run both to verify they fail**

Run: `node --test test/panel.test.ts test/mount.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement the panel**

Create `src/ui/panel.ts`:

```js
/**
 * The floating panel.
 *
 * Lives in a shadow root because TDX ships Bootstrap, jQuery UI, and Kendo
 * stylesheets, any of which would otherwise restyle it. Holds the requestor in
 * memory and never writes it to storage: those are student records.
 */

import { PANEL_CSS } from './panel.css.ts';
import { renderResults, highlightFilled } from './results.ts';
import { formatDiagnostics, renderDiagnostics } from './diagnostics.ts';
import { renderSettings } from './settings.ts';
import { harvest } from '../core/harvest.ts';
import { resolve } from '../core/resolve.ts';
import { formSignature } from '../core/signature.ts';
import { DICTIONARY } from '../core/dictionary.ts';
import { parseRequestor } from '../data/parser.ts';
import { SHIPPED_TEMPLATES } from '../data/templates.ts';
import { retrieve } from '../service/retriever.ts';
import { runFill } from '../fill/policy.ts';
import { captureLookup } from '../adapters/lookup.ts';

export async function createPanel({ doc, stores, bridge, now = () => new Date() } = {}) {
  const document = doc ?? globalThis.document;
  const state = {
    // Requestor lives here and only here. Never persisted.
    requestor: null,
    warnings: [],
    templateId: 'blank',
    confirmedService: null,
    rows: [],
    showDiagnostics: false,
    showSettings: false,
  };

  const controls = harvest(document);
  const signature = formSignature(document);
  const learned = await stores.learned.get(signature);
  let resolution = resolve(controls, { learned });

  const host = document.createElement('div');
  host.id = 'tdx-autofill-host';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = PANEL_CSS;
  shadow.append(style);
  document.body.append(host);

  const panel = document.createElement('div');
  panel.className = 'panel';
  shadow.append(panel);

  const settings = await stores.settings.get();
  panel.dataset.collapsed = String(Boolean(settings.collapsed));

  async function templates() {
    const custom = await stores.templates.list();
    const merged = new Map(SHIPPED_TEMPLATES.map((t) => [t.id, t]));
    for (const t of custom) merged.set(t.id, t);
    return [...merged.values()];
  }

  async function selectedTemplate() {
    return (await templates()).find((t) => t.id === state.templateId) ?? SHIPPED_TEMPLATES[0];
  }

  async function serviceSuggestion() {
    const template = await selectedTemplate();
    const examples = await stores.examples.list();
    const current = await stores.settings.get();
    const ranked = retrieve(`${template.summary} ${template.descriptionHtml}`, examples);
    const top = ranked[0];
    if (top && top.score >= current.threshold) {
      return { kind: 'suggested', service: top.service, score: top.score, evidence: top.evidence };
    }
    if (template.service) return { kind: 'template', service: template.service, score: top?.score ?? 0 };
    return { kind: 'none', service: null, score: top?.score ?? 0 };
  }

  async function render() {
    const current = await stores.settings.get();
    panel.replaceChildren(header(), await body(current));
  }

  function header() {
    const head = document.createElement('div');
    head.className = 'head';
    const title = document.createElement('h1');
    title.textContent = 'TDX Autofill';

    const settingsButton = button('Settings', () => { state.showSettings = !state.showSettings; render(); });
    settingsButton.setAttribute('data-settings', '');
    settingsButton.setAttribute('aria-expanded', String(state.showSettings));

    const collapse = button(panel.dataset.collapsed === 'true' ? 'Expand' : 'Collapse', async () => {
      const collapsed = panel.dataset.collapsed !== 'true';
      panel.dataset.collapsed = String(collapsed);
      await stores.settings.patch({ collapsed });
      render();
    });
    collapse.setAttribute('data-collapse', '');

    head.append(title, settingsButton, collapse);
    return head;
  }

  async function body(current) {
    const wrap = document.createElement('div');
    wrap.className = 'body';

    if (state.showSettings) {
      wrap.append(await renderSettings({ doc: document, stores, onChange: render }));
      return wrap;
    }

    wrap.append(requestorSection(), await templateSection(), await serviceSection(), fillSection(current), resultsSection());

    if (state.showDiagnostics) {
      wrap.append(renderDiagnostics(
        formatDiagnostics(resolution, { signature, url: document.defaultView?.location?.href ?? '' }),
        { doc: document },
      ));
    }
    return wrap;
  }

  function requestorSection() {
    const el = sectionEl('requestor', 'Requestor');

    const paste = document.createElement('textarea');
    paste.name = 'paste';
    paste.setAttribute('aria-label', 'Paste the requestor block');
    paste.placeholder = 'Paste the requestor block here';

    const row = document.createElement('div');
    row.className = 'row';
    const parse = button('Parse', () => {
      const { fields, warnings } = parseRequestor(paste.value);
      state.requestor = fields;
      state.warnings = warnings;
      render();
    });
    parse.setAttribute('data-parse', '');

    const readPage = button('Read from page', () => {
      state.requestor = { ...(state.requestor ?? {}), ...readRequestorFromPage(document, resolution) };
      state.warnings = missingWarnings(state.requestor);
      render();
    });
    readPage.setAttribute('data-read-page', '');
    row.append(parse, readPage);

    el.append(paste, row);

    if (state.requestor) {
      const list = document.createElement('dl');
      list.className = 'parsed';
      const identifiers = new Set(['personGuid', 'personNumber', 'ubitName', 'email']);
      for (const [key, label] of [
        ['name', 'Name'], ['email', 'Email'], ['ubitName', 'UBITName'],
        ['personNumber', 'Person #'], ['personGuid', 'GUID'],
      ]) {
        const dt = document.createElement('dt');
        dt.textContent = label;
        const dd = document.createElement('dd');
        const value = state.requestor[key];
        dd.textContent = value ?? 'missing';
        if (value && identifiers.has(key)) dd.className = 'ident';
        if (!value) dd.className = 'missing';
        list.append(dt, dd);
      }
      el.append(list);
    }

    return el;
  }

  async function templateSection() {
    const el = sectionEl('template', 'Template');
    const select = document.createElement('select');
    select.name = 'template';
    select.setAttribute('aria-label', 'Issue template');
    for (const template of await templates()) {
      const option = document.createElement('option');
      option.value = template.id;
      option.textContent = template.name;
      if (template.id === state.templateId) option.selected = true;
      select.append(option);
    }
    select.addEventListener('change', () => {
      state.templateId = select.value;
      state.confirmedService = null; // a new template means a new service decision
      render();
    });
    el.append(select);
    return el;
  }

  async function serviceSection() {
    const el = sectionEl('service', 'Service');
    const suggestion = await serviceSuggestion();
    const chosen = state.confirmedService ?? (suggestion.kind === 'template' ? suggestion.service : null);

    const line = document.createElement('p');
    line.className = 'note';
    if (chosen) {
      line.textContent = `${chosen.text} (id ${chosen.id}) — ${state.confirmedService ? 'confirmed' : 'template default'}`;
    } else if (suggestion.kind === 'suggested') {
      line.textContent = `Suggested: ${suggestion.service.text} — ${suggestion.score} similarity, from ${suggestion.evidence.length} prior example(s). Confirm to use it.`;
    } else {
      line.textContent = 'No service captured for this template and no confident match. Set it on the form by hand, then capture it.';
    }
    el.append(line);

    const row = document.createElement('div');
    row.className = 'row';

    if (suggestion.kind === 'suggested' && !state.confirmedService) {
      const confirm = button(`Use ${suggestion.service.text}`, () => {
        state.confirmedService = suggestion.service;
        render();
      });
      confirm.setAttribute('data-confirm-service', '');
      row.append(confirm);
    }

    const capture = button('Capture service from form', async () => {
      const match = resolution.byField.get('service');
      const captured = match?.control?.lookup ? captureLookup(match.control) : null;
      if (!captured) return;
      const template = await selectedTemplate();
      await stores.templates.save({ ...template, service: captured });
      state.confirmedService = captured;
      render();
    });
    capture.setAttribute('data-capture-service', '');
    row.append(capture);

    el.append(row);
    return el;
  }

  function fillSection(current) {
    const el = sectionEl('fill', 'Fill');

    const overwriteLabel = document.createElement('label');
    const overwrite = document.createElement('input');
    overwrite.type = 'checkbox';
    overwrite.name = 'overwrite';
    overwrite.checked = Boolean(current.overwrite);
    overwrite.addEventListener('change', async () => {
      await stores.settings.patch({ overwrite: overwrite.checked });
      render();
    });
    overwriteLabel.append(overwrite, document.createTextNode(' Overwrite fields that already have a value'));

    const row = document.createElement('div');
    row.className = 'row';

    const fill = button('Fill form', async () => {
      const template = await selectedTemplate();
      const suggestion = await serviceSuggestion();
      const service = state.confirmedService ?? (suggestion.kind === 'template' ? suggestion.service : null);
      state.rows = await runFill({
        resolution,
        requestor: state.requestor ?? {},
        template,
        service,
        settings: await stores.settings.get(),
        now: now(),
      }, { bridge });
      highlightFilled(state.rows, document);
      render();
    }, 'primary');
    fill.setAttribute('data-fill', '');

    const diagnostics = button('Diagnostics', () => { state.showDiagnostics = !state.showDiagnostics; render(); });
    diagnostics.setAttribute('data-diagnostics', '');
    diagnostics.setAttribute('aria-expanded', String(state.showDiagnostics));

    row.append(fill, diagnostics);
    el.append(overwriteLabel, row, noteEl('Never submits. Review the form before saving the ticket.'));
    return el;
  }

  function resultsSection() {
    const el = sectionEl('results', 'Results');
    if (!state.rows.length) {
      el.append(noteEl('No fill run yet.'));
      return el;
    }

    el.append(renderResults(state.rows, {
      doc: document,
      fieldOptions: DICTIONARY.map((d) => ({ key: d.key, label: d.label })),
      onCorrect: async (controlKey, fieldKey) => {
        await stores.learned.set(signature, { [controlKey]: fieldKey });
        resolution = resolve(controls, { learned: await stores.learned.get(signature) });
        render();
      },
    }));

    const saveExample = button('Save this as an example', async () => {
      const template = await selectedTemplate();
      const service = state.confirmedService ?? template.service;
      if (!service) return;
      await stores.examples.add({ description: `${template.summary} ${template.descriptionHtml}`, service });
      render();
    });
    saveExample.setAttribute('data-save-example', '');
    el.append(saveExample);
    return el;
  }

  function sectionEl(name, title) {
    const el = document.createElement('section');
    el.dataset.section = name;
    const heading = document.createElement('h2');
    heading.textContent = title;
    el.append(heading);
    return el;
  }

  function noteEl(text) {
    const p = document.createElement('p');
    p.className = 'note';
    p.textContent = text;
    return p;
  }

  function button(text, onClick, className = '') {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = text;
    if (className) el.className = className;
    el.addEventListener('click', onClick);
    return el;
  }

  document.addEventListener('keydown', onEscape);
  function onEscape(event) {
    if (event.key !== 'Escape') return;
    panel.dataset.collapsed = 'true';
    stores.settings.patch({ collapsed: true });
  }

  await render();

  return {
    host,
    shadow,
    refresh: render,
    destroy() {
      document.removeEventListener('keydown', onEscape);
      host.remove();
    },
  };
}

/**
 * Recovers the requestor TDX already knows about, from the form's own URL and
 * the data-default blob on the requestor lookup. Yields the GUID and the name
 * and nothing else — the paste path remains the complete one.
 */
function readRequestorFromPage(document, resolution) {
  const fields = {};
  const url = document.defaultView?.location?.href ?? '';
  const fromUrl = url.match(/RequestorUID=([0-9a-f-]{36})/i)?.[1];

  const match = resolution.byField.get('requestor');
  const hidden = match?.control?.lookup?.hidden;
  fields.personGuid = (hidden?.value || fromUrl || null)?.toLowerCase() ?? null;

  try {
    const parsed = JSON.parse(hidden?.getAttribute('data-default') ?? '[]');
    fields.name = parsed?.[0]?.caption ?? null;
  } catch {
    fields.name = null;
  }
  return fields;
}

function missingWarnings(fields) {
  const warnings = [];
  for (const [key, label] of [['name', 'name'], ['email', 'email'], ['ubitName', 'UBITName'], ['personNumber', 'person number'], ['personGuid', 'person GUID']]) {
    if (!fields?.[key]) warnings.push(`No ${label} found.`);
  }
  return warnings;
}
```

- [ ] **Step 5: Implement the frame mount**

Create `src/content/mount.ts`:

```js
/**
 * Entry point for the isolated-world content script.
 *
 * Runs in EVERY frame, because the TDX ticket form lives inside a nested
 * iframe and a top-frame-only script would see no form controls at all. Each
 * frame self-tests and all but one exit immediately, so "all_frames" costs a
 * single querySelector per frame.
 */

import { createPanel } from '../ui/panel.ts';
import { createStores } from '../data/stores.ts';
import { createBridgeClient } from '../adapters/richtext.ts';
import { waitFor } from '../adapters/wait.ts';

export function isTicketForm(doc) {
  const form = doc.querySelector('form');
  if (!form) return false;
  // TDX marks every field wrapper. A form without those markers is not a TDX
  // ticket form — it is a search box, a login, or someone else's page.
  return Boolean(form.querySelector('[data-fieldtype], [data-fieldid]'));
}

export async function mountIfTicketForm(doc, { stores, bridge, wait = false, timeout = 8000 } = {}) {
  if (wait) {
    // TDX renders the form after its own scripts run, so a frame can be a
    // ticket frame a moment before it looks like one. waitFor rather than a
    // sleep: the desk network is sometimes fast and sometimes not.
    try {
      await waitFor(() => isTicketForm(doc), { timeout, root: doc, win: doc.defaultView });
    } catch {
      return null; // not a ticket frame; every other frame lands here
    }
  } else if (!isTicketForm(doc)) {
    return null;
  }

  if (doc.getElementById('tdx-autofill-host')) return null; // already mounted
  return createPanel({
    doc,
    stores: stores ?? createStores(),
    bridge: bridge ?? createBridgeClient(doc.defaultView),
  });
}

// Auto-run only in a real extension context; imports in tests must stay inert.
if (typeof globalThis.chrome?.storage?.local !== 'undefined' && typeof document !== 'undefined') {
  mountIfTicketForm(document, { wait: true }).catch((error) => {
    console.error('[TDX Autofill] failed to mount:', error);
  });
}
```

- [ ] **Step 6: Run both test files to verify they pass**

Run: `node --test test/panel.test.ts test/mount.test.ts`
Expected: PASS, 12 + 6 tests.

- [ ] **Step 7: Run the full suite and build**

Run: `npm test && npm run build`
Expected: every test passes, and `dist/content.js` plus `dist/bridge.js` are produced.

Then load the unpacked extension in Chrome (`chrome://extensions` → Developer
mode → Load unpacked) and run the manual checklist below on a real TDX form.

- [ ] **Step 8: Write the README**

Create `README.md`:

````markdown
# TDX Autofill

A Chrome extension that fills TeamDynamix ticket forms at
`ubuffalo.teamdynamix.com` for walk-up tickets. It resolves fields by meaning
rather than by selector, so it works on TDX forms it has never seen.

Everything happens in the browser. The extension makes no network requests of
any kind — no telemetry, no analytics, no hosted models, no CDN assets — and
that is enforced by a test.

## Install

```bash
npm install
npm run build
```

Then `chrome://extensions` → Developer mode → Load unpacked → this directory.

## What it fills

Five fields: UBITName, Brief Summary, Description, Source (always `Walkup`),
and Service. Everything else on the form is resolved and reported but never
written.

**Affiliation is never written.** A person can be a student, an employee, or
both, and a wrong affiliation misroutes the ticket. It shows in the results as
deliberately skipped so you remember to set it.

**The extension never submits.** It fills and stops.

## How resolution works

Four tiers. The highest one that matches wins, and every match records why.

| Tier | Signal | Confidence |
|---|---|---|
| 0 | A mapping you corrected on this form before | 1.00 |
| 1 | TDX's own `data-fieldtype` on the field wrapper | 0.95 |
| 2 | TDX's own `data-fieldid`, stable across every form on the instance | 0.90 |
| 3 | Weighted scoring over label, option set, name, id, placeholder, aria | ≤ 0.85 |

Tier 3 always runs, even when a higher tier wins, because the diagnostic dump
needs the runners-up and because tier 3 is what carries a form — or an
institution — this code has never seen.

Assignment is globally best-match: every control is scored against every
canonical field, then pairs are claimed strongest-first, so one control can
never end up serving two fields.

### Extending the dictionary

`src/core/dictionary.ts` is the only place a field's identity is written down.
Add an entry and nothing else changes:

```js
{
  key: 'newField',
  label: 'Human Name',
  control: 'text',              // text | select | lookup | richtext
  fieldTypes: ['tdx_marker'],   // tier 1
  fieldIds: ['1234'],           // tier 2
  labels: ['Exact Label'],      // tier 3, weight 1.0
  patterns: [/regex/i],         // tier 3, matched against name/id/placeholder
  options: ['Known', 'Option'], // tier 3, often the strongest signal
}
```

To make it fillable, add its key to `FILL_SET` and give it a case in
`valueFor()` in `src/fill/policy.ts`. That is the only field-aware code in the
project.

## Debugging a bad match

Click **Diagnostics** in the panel. You get, for every control on the page: its
extracted label, its `data-fieldtype` and `data-fieldid`, its shape, its option
strings, the field it resolved to, the confidence, the tier that won, and the
top three runners-up with scores. It is plain text with a copy button, so it
pastes into a ticket or a chat unchanged.

Read the runners-up first. A field matching at 0.4 with a much better runner-up
usually means a missing synonym in the dictionary, not a bug in the engine.

If the mapping is simply wrong, correct it in the results panel. The correction
is remembered.

## The learning layer

Corrections are keyed on a **form signature**: a hash of the sorted set of
`data-fieldid` values on the page plus the parent form id.

Deliberately not the URL. TDX URLs carry session ids, app ids, and a
`RequestorUID`, none of which describe the form's structure. The signature stays
constant across sessions and changes exactly when an administrator edits the
form — which is precisely when a learned mapping should stop being trusted.

Clear all learned mappings in Settings if TDX changed and the old mappings are
now wrong.

## Service selection

There is no access to TDX ticket history, so there is no corpus to start from.

1. **Template default.** Each template can carry a captured `{id, text}` Service
   pair. Set the Service by hand on a real form, then click **Capture service
   from form**. Deterministic, always available, no inference.
2. **Local example retrieval.** After a fill you can save it as an example.
   Later descriptions are scored against those saved examples with TF-IDF cosine
   similarity — all local, no model, no network. Above the threshold you get a
   suggestion with its score and the prior tickets that matched; you still have
   to confirm it before it is written. Below the threshold there is no
   suggestion at all, and the template default is used.

This is retrieval over your own confirmed examples. It is not RAG and there is
nothing neural in it.

`src/service/retriever.ts` exports one function, `retrieve(queryText, examples)`,
returning `[{ service, score, evidence }]`. Swapping in an embedding retriever
later means writing a module with that same signature; nothing above it changes.

## Things that look like cruft and are not

**`setNativeValue` instead of `el.value = x`.** Kendo and similar widgets shadow
the `value` property on the element instance. Assigning through the instance
updates the visible text but leaves the widget's internal model untouched, and
the ASP.NET postback then submits an empty field with no error anywhere. Going
through the prototype's setter reaches the value the form actually serialises.

**Every adapter reads back what it wrote.** A write that silently did not take
is the failure mode that puts a wrong ticket in the queue, and it is invisible
without the check. That is why `filled` is only ever returned after a
comparison.

**Lookups are filled from a captured `{id, text}` pair, not by typing.** Driving
the autocomplete means waiting on AJAX, disambiguating result rows, and
dispatching `mousedown` before `click` because several Kendo widgets commit on
mousedown — and every lookup on the page shares one suggestion container, so two
fills in flight click each other's results. TDX lookup ids are stable per
instance, so capturing the pair once removes that entire class of failure. A
lookup is three elements (hidden id, visible text, reset); writing only the
visible one leaves the ticket with no service and no error.

**`all_frames: true`.** The ticket form is inside a nested iframe. A top-frame
script sees nothing. Every frame self-tests with one `querySelector` and all but
one exit immediately.

**A page-world content script.** `window.CKEDITOR` is invisible to a content
script's isolated world. The `world: "MAIN"` script exists only to call
`setData` on the description editor and exposes nothing else.

**`panel.css.ts` exports a string.** A shadow root needs the CSS text, and a
plain `.css` file would have to be declared in `web_accessible_resources`,
widening what any page can see for no benefit.

**No background service worker.** `chrome.storage.local` is reachable from
content scripts and there is no background event to handle.

## Permissions

```
permissions:      ["storage"]
host_permissions: ["https://ubuffalo.teamdynamix.com/*"]
```

That is all of it. No `activeTab`, no `scripting`, no `tabs`, no `<all_urls>`,
no `web_accessible_resources`.

Requestor data — including student records — is held in the panel's memory and
is never written to storage.

## Tests

```bash
npm test
```

The fixture in `test/fixtures/` is a real TDX form with the scripts stripped and
the session token redacted. The most important test resolves the fill set from a
copy of that fixture with every TDX marker removed and labels shuffled: if that
passes, the engine works on forms it has never seen.

`test/no-network.test.ts` replaces `fetch`, `XMLHttpRequest`, `WebSocket`,
`EventSource`, and `sendBeacon` with landmines, runs a full parse-to-fill cycle,
and also greps every source file for network primitives and external URLs.

### Manual checklist

jsdom cannot instantiate CKEditor, Kendo, or select2, so those three paths are
verified by hand on a real TDX form after any change to `src/adapters/`:

- [ ] Description text lands in the editor **and** survives a page-level save
      (this is what proves the backing textarea was synced, not just the iframe).
- [ ] Service shows the right display text **and** the ticket saves with the
      right service (proves the hidden id was written, not just the visible half).
- [ ] Brief Summary and UBITName survive a save.
- [ ] Source reads `Walkup` after the fill.
- [ ] Affiliation is untouched and reported as skipped.
- [ ] Nothing submits.

## A note on the TDX REST API

TeamDynamix exposes a REST API at `/TDWebApi/`. If the institution's TDX
administrators will issue credentials, **building against that API beats DOM
automation outright** — no widget adapters, no resolution engine, no breakage
when a form is edited.

This extension is a workaround for not having API access, not a preference. The
API's behavior has not been verified here, and nothing in this repository
depends on or describes it.
````

- [ ] **Step 9: Commit**

```bash
git add src/ui/panel.ts src/content/mount.ts README.md test/panel.test.ts test/mount.test.ts
git commit -m "feat: floating panel, frame mount, and README"
```

---

## Verification before calling this done

- [ ] `npm run check` passes: type check clean, every test file green.
- [ ] `npm run build` produces `dist/content.js` and `dist/bridge.js`.
- [ ] `npm run docker:test` passes, proving the toolchain is reproducible.
- [ ] The extension loads unpacked with no manifest errors.
- [ ] The manual checklist in the README passes on a real TDX form.
- [ ] `git grep -n "attribute[0-9]" src/ | grep -v dictionary.ts` returns nothing outside the dictionary — no selector strings leaked into fill or adapter logic.

