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

### Resolving a ticket

On a ticket **update** form the panel switches to resolve mode and writes three
fields: New Status (`Resolved`), the private-comment checkbox (unchecked, so the
client can read the reply), and Comments.

**Responsible is never written.** TDX defaults it to the right account, and a
wrong write reassigns a real person's queue and emails them. It shows in the
results as resolved-and-reported, so you can see it before saving.

The comment body comes from TDX's own template, captured once per instance:
open **Templates → ALL → Ticket Resolved** on a real update form, then click
**Capture resolved template** in the panel. The panel finds the red placeholder
text, shows you which block it will replace — everything else in that block is
dropped — and on confirmation stores the body with `{{steps}}` in its place.

Every later resolve substitutes your troubleshooting steps into that spot, one
line per bullet. Picking a template pre-fills the steps box with that job's
canned steps; edit them freely before filling. Clear the capture in Settings
when UBIT edits the template, then capture again.



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

```ts
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

## Troubleshooting: the panel doesn't appear

The panel mounts itself; there is no toolbar icon to click. When it doesn't
show up on a page that should be a ticket form, check, in order:

1. **Did the content script even run in the frame the form is in?** The
   ticket form usually lives inside a nested `iframe`, and `manifest.json`
   runs the content scripts in every frame (`all_frames: true`) precisely so
   that a top-frame-only script doesn't miss it. Open DevTools, switch its
   context selector to the iframe in question, and look in that frame's own
   console — a frame that gave up waiting logs
   `[TDX Autofill] gave up waiting for a ticket form after <n>ms (<url>)`
   after up to 8 seconds, which tells you the script *did* run there but
   never saw a form worth mounting into.
2. **Does the form actually carry TDX's own field markers?** The mount gate
   (`isTicketForm` in `src/content/mount.ts`) looks for
   `data-fieldtype`/`data-fieldid` attributes inside *any* `<form>` on the
   page — a defensible scope, but wider than "the ticket-creation form
   specifically": it will also mount into any other TDX form that happens to
   carry those same markers. If neither is present anywhere in the page, the
   gate is deliberately refusing to mount, on the same evidence `isTicketForm`
   uses to reject the TDNext shell and unrelated forms — that is the point of
   the gate, not a bug.
3. **Was the extension just reloaded (or updated) while this tab stayed open?**
   `createPanel` reads from `chrome.storage.local` before it draws anything —
   before the panel exists, there is nothing on the page yet to show an error
   in. If storage is dead at that point (a reload invalidates every extension
   API in every tab open before the reload), mounting fails outright and that
   frame's console shows `[TDX Autofill] failed to mount:` instead of the
   `gave up waiting` line above. The fix is the tab, not the form: refresh the
   page so the content script re-injects against the reloaded extension.

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
script sees nothing. `isTicketForm` itself is one cheap `querySelector`, but
the real entry point waits for up to 8 seconds before giving up on a frame
that never becomes one — a whole-document `MutationObserver` plus a 120ms
poll, not a single cheap check — because TDX renders the ticket form's markup
after its own scripts run, so a frame with no form yet is often about to
become the ticket frame. Every non-ticket frame pays that cost once, for up
to 8 seconds, and cleans up its observer and timers either way.

**A page-world content script.** `window.CKEDITOR` is invisible to a content
script's isolated world. The `world: "MAIN"` script exists only to call
`setData` on the description editor and exposes nothing else. If it never
answers — a CKEditor version bump, a CSP change, anything — the isolated-world
side times out after 3 seconds and the description adapter falls through to
writing the CKEditor iframe body directly, then the plain textarea, each
verified by reading its own value back. The results row for Description says
which path actually landed the write (`iframe editor body`, not `CKEditor
instance`), so a silent bridge is visible in the panel, not just in the
console — and the fill never hangs waiting for an answer that isn't coming.

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
copy of that fixture with every TDX marker removed: if that passes, the engine
resolves from labels and option values alone, and works on forms it has never
seen.

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
