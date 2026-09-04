# Task 9 Report: Page-world bridge and the rich-text adapter

## What I implemented

- `src/content/bridge-main.ts` — the page-world (MAIN world) half of the bridge. Exports `BRIDGE_CHANNEL`, `handleBridgeMessage(win, event)` (the trust-boundary logic, pulled out of the listener for testability), and `installBridge(win)`. At module bottom, `if (typeof window !== 'undefined') installBridge(window);` wires it to the real page — guarded so importing the module under Node (no global `window`) never throws.
- `src/adapters/richtext.ts` — exports `BRIDGE_CHANNEL`, `createBridgeClient(win)` (isolated-world client, returns a `Bridge`), `fillRichText(control, html, { bridge, bridgeTimeout })`, and `readRichText(control)`. Three fallback paths in order: CKEditor bridge → same-origin iframe body → contenteditable → plain textarea, each independently read-back verified.
- `test/adapters-richtext.test.ts` — the 7 tests transcribed verbatim from the brief (to strict TS), plus 3 additional tests for `createBridgeClient`'s trust-boundary behavior (origin never `'*'`, wrong-origin/stale-id replies ignored, listener torn down on settle).
- `test/content-bridge-main.test.ts` — 6 tests for `handleBridgeMessage`'s trust boundary: valid request → correct CKEDITOR call and reply to page origin (never `'*'`); wrong origin ignored; wrong `event.source` ignored; wrong channel ignored; unknown instance key reports failure instead of throwing; malformed payloads (null, wrong types, unknown op) are all ignored without throwing.

No changes to `src/types.ts` — the `Bridge` interface it needed already existed there from an earlier task.

## Testing

`node --test test/adapters-richtext.test.ts test/content-bridge-main.test.ts` — 16/16 passing.
`npm run check` (tsc --noEmit + full suite) — 84/84 passing, typecheck clean, output pristine (no warnings, no unhandled rejections).

## TDD Evidence

**RED** — `node --test test/adapters-richtext.test.ts` before any implementation existed://
```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'D:\Github_Project\Auto TDX\TDX\src\adapters\richtext.ts' imported from D:\Github_Project\Auto TDX\TDX\test\adapters-richtext.test.ts
...
ℹ tests 1
ℹ pass 0
ℹ fail 1
```
Expected failure: the test file imports `fillRichText`/`readRichText`/`createBridgeClient` from a module that didn't exist yet.

**GREEN** — after implementing `src/adapters/richtext.ts` and `src/content/bridge-main.ts`:
```
✔ uses the CKEditor bridge when the instance exists
✔ the bridge is asked for the harvested instance key, not a hardcoded one
✔ falls back to the same-origin iframe body when CKEditor is absent
✔ falls back to the bare textarea when there is no editor at all
✔ reports failed rather than claiming success when no path verifies
✔ a bridge that never answers does not hang the fill
✔ readRichText reports current content for preserve checks
✔ createBridgeClient posts requests to the page origin, never "*"
✔ createBridgeClient ignores a reply from the wrong origin and one with a stale id, then resolves on the matching reply
✔ createBridgeClient removes its message listener once a reply lands
ℹ tests 10
ℹ pass 10
ℹ fail 0
```
And `test/content-bridge-main.test.ts` (written directly against `handleBridgeMessage`, so it went red→green as the file was written function-by-function; final state):
```
✔ handles a valid request: sets the editor data and replies to the page origin, never "*"
✔ ignores a message from a different origin
✔ ignores a message whose source is not this window
✔ ignores a message on a different channel
✔ reports failure for an unknown instance key instead of throwing
✔ ignores malformed payloads without throwing and without replying
ℹ tests 6
ℹ pass 6
ℹ fail 0
```

## Files changed

- `D:/Github_Project/Auto TDX/TDX/src/content/bridge-main.ts` (new)
- `D:/Github_Project/Auto TDX/TDX/src/adapters/richtext.ts` (new)
- `D:/Github_Project/Auto TDX/TDX/test/adapters-richtext.test.ts` (new)
- `D:/Github_Project/Auto TDX/TDX/test/content-bridge-main.test.ts` (new)

## Self-review findings (fixed before committing)

1. **Field-specific language in a comment (defect per the task's explicit constraint).** My first draft of `richtext.ts`'s header comment said "Fills the ticket description" and "TDX's description field can be in one of three states" — literally naming the field this adapter is presumed to serve, which the task brief flags as a defect even in comments. The brief's own sample code uses this exact wording, but the task's constraints override the brief here. Reworded to "Fills a rich-text control" / "A CKEditor-backed control can be in one of three states" and added an explicit line: "This file knows nothing about which canonical field it serves — that lives in fill policy (Task 14)." Also changed one inline comment from "submits an empty description" to "submits an empty value for this field."

2. **Real timer leak in `withTimeout` (mentally broke the timeout test and it caught this).** The original transcription used `Promise.race([promise, timeoutPromise])`. The loser's `setTimeout` is never cleared, so every call to `fillRichText` with a bridge left a live ~3000ms timer running even after the real answer arrived — holding the Node event loop (and, in the real extension, a wasted background callback) open for the full default timeout on every single fill. Confirmed empirically: the richtext+bridge test file alone took 3.8s wall-clock despite every individual assertion finishing in under 70ms. Rewrote `withTimeout` to track a `settled` flag and `clearTimeout` the loser as soon as either side resolves (mirroring `wait.ts`'s own timer/observer cleanup discipline, which that file's own tests pin explicitly). Re-ran: same two test files dropped from ~3.8s to ~0.9s wall-clock with identical pass/fail results, confirming the fix was real, not cosmetic. One of my own added `createBridgeClient` tests had the same shape of leak (didn't await/settle the request, leaving its internal 3s timeout alive) — fixed by having that test dispatch a reply and await the promise before finishing.

No other issues found. Re-read both production files fully after these fixes; no field-specific logic, no selector strings beyond the necessary generic `.form-group`/`iframe`/`[contenteditable="true"]` structural landmarks (same category already used by `harvest.ts`), no `eval`, no network calls, every `filled` backed by read-back verification, every path returns `{status, detail}`.

## What I tightened over the brief's sample, at the postMessage trust boundary

The brief's own sample code (Step 3) is looser than the task's stated security bar in several ways. I kept the brief's protocol (channel name `'tdxa'`, message shape, reply shape, op name `setEditorData`) verbatim, but tightened:

1. **Reply target origin.** The brief's sample posts the response with `window.postMessage(..., '*')`. I changed both the bridge's reply and the client's request to target `win.location.origin` specifically, never `'*'`. This is the one place the task instructions said to flag explicitly if the brief required `'*'` — it doesn't strictly require it (the brief just uses it as a shortcut in the sample), so I tightened without needing to defend a deviation from an explicit requirement.
2. **Origin check on incoming messages.** The brief's sample only checks `event.source !== window`. I added `event.origin !== win.location.origin` alongside it on both sides of the bridge (page-world listener and isolated-world client), so a message can't be trusted purely by same-window sourcing.
3. **Full payload shape validation.** The brief's sample only checks `msg.channel` and `msg.direction`/`msg.op`. I added `typeof` checks on every field the handler reads (`id` must be `number`, `key`/`html` must be `string` on the request; `id` must be `number` on the response) before treating the payload as well-formed, so a message with the right channel/op but garbage-typed fields is silently ignored rather than causing a runtime type error deep in `setData`/string operations.
4. **Client-side reply matching.** The brief's sample sketch didn't show the client side at all in detail; I added strict matching on request `id` so an unrelated in-flight request's reply (or a forged one) can never be mistaken for the answer to a different call — covered by a dedicated test (`createBridgeClient ignores a reply from the wrong origin and one with a stale id...`).
5. **Listener/timer cleanup.** Neither side's listener nor its timeout timer lingers past settlement — verified by a dedicated test on the client side (`removes its message listener once a reply lands`) and, incidentally, was the mechanism that surfaced the `withTimeout` bug described above.

Nothing was simplified away from the brief's stated protocol — only the validation was made stricter than the sample, per the task's own instruction to do exactly that.

## Issues or concerns

None outstanding. One judgment call worth surfacing: `createBridgeClient`'s and `handleBridgeMessage`'s tests do not exercise a real browser `postMessage` round trip — I confirmed with a scratch script that jsdom does not set `event.origin`/`event.source` correctly for same-window `postMessage` (both come back as `''`/`null` even for a legitimate self-post), so a test built on real jsdom dispatch would either be unable to exercise the origin check at all, or would need to work around a jsdom bug rather than test the real logic. Instead, both files expose their core validation logic (`handleBridgeMessage`, and `createBridgeClient`'s internal listener) so tests can hand them a hand-crafted event object with `source`/`origin`/`data` set exactly as needed — this tests the actual trust-boundary code path directly rather than depending on jsdom's imperfect postMessage emulation. Task 17, which mounts both scripts into the real extension, is the place a real end-to-end postMessage round trip would need manual/browser verification if that's wanted.

## Fix report: hardcoded `.form-group` selector narrower than harvest's group boundary

### Finding

`src/adapters/richtext.ts`'s `editorIframe` and `contentEditableIn` both did `anchorElement(control).closest('.form-group')`, while `src/core/harvest.ts` defines the actual group boundary as `'.form-group, [data-fieldtype], [data-fieldid]'`. A field whose immediate group carries only `data-fieldtype`/`data-fieldid` (no `.form-group` class) would make `closest('.form-group')` climb past that group to a shared ancestor. If a sibling field's iframe/contenteditable lived in that ancestor, the write could land in the wrong field's editor while the read-back check (checking the very body just written) still reported `filled`.

### What I changed

- `src/core/harvest.ts`: exported the existing `GROUP_SELECTOR` constant (`'.form-group, [data-fieldtype], [data-fieldid]'`) instead of keeping it module-private, with a comment explaining why it must stay a single definition.
- `src/adapters/richtext.ts`: imported `GROUP_SELECTOR` from `../core/harvest.ts` and replaced both `closest('.form-group')` call sites (`editorIframe`, `contentEditableIn`) with `closest(GROUP_SELECTOR)`. No other logic touched — the postMessage trust-boundary code was explicitly out of scope and untouched.

This removes the second copy of the group-boundary string entirely rather than keeping two definitions in sync by hand.

### Regression test

Added to `test/adapters-richtext.test.ts`: `does not climb past a data-fieldtype-only group into a sibling field's editor`. It builds a field group marked only by `data-fieldtype`/`data-fieldid` (no `.form-group` class) nested inside an outer `.form-group` ancestor that also holds a *different* field's iframe (`data-owner="wrong-field"`) placed before, in document order, the real field's own iframe (`data-owner="right-field"`). It asserts the fill lands in `right-field`'s iframe body and never in `wrong-field`'s.

**RED (confirmed against the unfixed code):** I temporarily reverted both call sites in `richtext.ts` back to the literal `closest('.form-group')` (keeping the new test and the exported `GROUP_SELECTOR` in place) and ran `node --test test/adapters-richtext.test.ts`:

```
✖ does not climb past a data-fieldtype-only group into a sibling field's editor (23.06ms)
  AssertionError [ERR_ASSERTION]: the write must land in this field's own editor
      at TestContext.<anonymous> (file:///D:/Github_Project/Auto%20TDX/TDX/test/adapters-richtext.test.ts:137:10)
  ...
    actual: '',
    expected: /stale eduroam profile/,
    operator: 'match',
```
10/11 other tests in the file still passed; only the new regression test failed, confirming `closest('.form-group')` climbed to the outer ancestor and `querySelector('iframe')` grabbed the wrong-field iframe first, leaving the right-field iframe empty (`actual: ''`).

I then restored `closest(GROUP_SELECTOR)` and reran.

### Covering tests run (after the fix)

`node --test test/adapters-richtext.test.ts test/harvest.test.ts`:
```
✔ does not climb past a data-fieldtype-only group into a sibling field's editor (15.5901ms)
...
ℹ tests 21
ℹ pass 21
ℹ fail 0
```
(11 tests in `adapters-richtext.test.ts`, 10 in `harvest.test.ts`, all passing.)

`npm run check` (tsc --noEmit + full suite):
```
ℹ tests 101
ℹ pass 101
ℹ fail 0
```
Typecheck clean, output pristine.

### Files changed by this fix

- `D:/Github_Project/Auto TDX/TDX/src/core/harvest.ts`
- `D:/Github_Project/Auto TDX/TDX/src/adapters/richtext.ts`
- `D:/Github_Project/Auto TDX/TDX/test/adapters-richtext.test.ts`

### Concerns

None. The fix is a one-definition-instead-of-two change with no behavior change for any field whose group *does* carry `.form-group`, which is every case the prior 10/10 passing tests already covered.
