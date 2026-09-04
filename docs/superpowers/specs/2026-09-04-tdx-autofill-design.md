# TDX Autofill — Design

**Date:** 2026-09-04
**Status:** Approved, ready for implementation planning

A Chrome extension (Manifest V3) that fills TeamDynamix ticket forms at
`https://ubuffalo.teamdynamix.com/` semantically, without hardcoded selectors,
for the ITCX Tech Squad walk-up workflow at the University at Buffalo.

---

## 1. Problem

Every walk-up becomes a TDX ticket, and most walk-ups are the same handful of
issues. The same requestor details and the same descriptions get retyped several
times a shift.

TDX is not one form. Every service, ticket type, and department has its own form
with different fields in different orders, and administrators edit those forms
without notice. A script targeting one form's element IDs dies the first time a
different service request is opened.

The extension must therefore resolve fields by meaning, not by selector.

## 2. Non-goals

- No auto-submit, ever. The extension fills and stops.
- No network requests of any kind: no telemetry, no analytics, no CDN fonts, no
  hosted models, no external APIs. Requestor data includes student records and
  stays in the browser.
- No access to historical TDX tickets. There is no API credential, so there is no
  ticket corpus to retrieve from. Any corpus is built from user-confirmed examples.
- No cross-frame scraping of the person side panel in the MVP.
- No neural embedding model in the MVP.

## 3. Findings from the captured form

A saved technician-view page (`Work Management _ UBIT Tech Squad.html`, form 162)
was analyzed before design. The findings below are observed facts from that
markup, not assumptions.

**The ticket form lives in a nested iframe.** The outer page is the TDNext shell;
the form is inside `.tdx-workmgmt-container__iframe`. A top-frame-only content
script sees no form controls at all.

**TDX emits its own field semantics.** Every field wrapper is a
`div.form-group` carrying `data-fieldtype` and `data-fieldid`:

| `data-fieldtype` | `data-fieldid` | Label |
|---|---|---|
| `requestor` | 495 | Who is this request for? |
| `acct/dept` | 38 | Department |
| `contact` | 1269 | Alternative Contact (optional) |
| `dropdown` | 2706 | Affiliation |
| `textbox` | 2445 | UBITName |
| `title` | 37 | Brief Summary |
| `description` | 138 | Description |
| `location` | 701 | Location |
| `location_room` | 702 | Location Room |
| `dropdown` | 2751 | Device type |
| `textbox` | 2455 | MAC Address |
| `textbox` | 2757 | IP Address |
| `dropdown` | 2616 | Operating System |
| `textbox` | 2624 | OS Version |
| `textbox` | 3224 | Asset ID |
| `textarea` | 2390 | Additional Information |
| `status` | 40 | Status |
| `responsible` | 1279 | (widget-rendered) |
| `source` | 371 | Source |
| `impact` | 369 | Impact |
| `urgency` | 370 | Urgency |
| `service` | 789 | Service |
| `service_offering` | 1932 | Service Offering |

System fields get named types; custom attributes get a generic type plus a
`data-fieldid` that is stable instance-wide. These are TDX's own vocabulary and
survive form edits, because administrators edit forms, not attribute IDs.

**Verified option strings.**

- Source: `API/Automation`, `Chat/Messaging`, `Chatbot-LiveAgent`, `Client Portal`,
  `Email`, `Event/Monitoring`, `Internal Work`, `Operations Check`,
  `Personal Visit`, `Phone`, `Self/Own Observation`, `SPAM/Erroneous`, `Testing`,
  **`Walkup`**. The correct value is `Walkup` — not "Walk In".
- Impact: `Low - Affects User`, `Medium - Affects Group/Department`,
  `High - Affects Buildings/Departments`, `Critical - Affects Organization`.
- Urgency: `Low - Can still do work`, `Medium - Can do work but with workaround`,
  `High - Impacting work`, `Critical - Teaching, learning, critical work cannot proceed.`
- Status: `New`, `In Process`, `On Hold`, `Scheduled`, `Waiting for Customer`,
  `Resolved`, `Closed`, `Cancelled`, plus `CR - *` change-request states.
- Affiliation: `Alumnus`, `Applicant`, `Faculty`, `Parent`, `Retiree`, `Staff`,
  `Student`, `Visitor`, `Volunteer`.

**Description is an iframe editor.** CKEditor 4.5.11, initialized with
`CKEDITOR.replace('attribute138_Content', config)`. The `divarea` plugin is not in
`extraPlugins`, so it runs in classic iframe mode. Reachable as
`CKEDITOR.instances['attribute138_Content']`.

**Four widget families, not two.**

1. Kendo autocomplete lookups (`js-*-lookup`): a visible `attributeNNN_input`
   holding display text, a hidden `attributeNNN` holding the real ID, and an
   `attributeNNN_reset`. Used by Requestor, Department, Location, Room, Service,
   Service Offering.
2. select2 v3 (`js-select2`): a hidden native `<select>` plus `s2id_*` chrome.
   Used by Affiliation, Device type, Operating System.
3. Plain native `<select>`: Status, Source, Impact, Urgency.
4. Plain text inputs, plus the CKEditor description.

**TDX prefills from the launch URL.** The captured form arrived with Requestor
(GUID), Location (`Capen Hall` / 139), and Service (288, `Personal Device Software
and Support / Personal Device Consultation`) already populated via `data-default`,
because the launch URL carried `RequestorUID`. When a ticket is started from a
person record, the hardest adapter is not on the critical path.

## 4. Scope

### Fill set — five fields

1. **UBITName** — from the parsed requestor; `Unknown` when absent, matching the
   field's own placeholder ("If unknown, please state so.").
2. **Brief Summary** — from the selected template, placeholders substituted.
3. **Description** — from the selected template, placeholders substituted.
4. **Source** — always the exact option `Walkup`.
5. **Service** — a captured `{id, text}` pair; see section 7.

### Resolved but never written

Impact, Urgency, Status, Affiliation, Location, Location Room, Department,
Responsible, Alternative Contact, Device type, MAC Address, IP Address, Operating
System, OS Version, Asset ID, Additional Information, Service Offering.

These stay in the dictionary and are resolved and reported so diagnostics stays
honest and the engine stays portable, but the fill loop iterates the fill set, not
the dictionary. They report as `skipped — out of fill scope`.

**Affiliation is never written in the MVP.** A person can be a student, an
employee, or both, and a wrong affiliation misroutes the ticket. It is never
inferred. If it is reintroduced later it will be a dictionary flag driven by an
explicit per-template value, never a guess.

### Existing values

Preserve by default: a non-empty control is left alone and reported as
`preserved`. An explicit overwrite toggle in the panel reverses this per fill.

## 5. Architecture

### Frame model

One content script, `all_frames: true`, matching
`https://ubuffalo.teamdynamix.com/*`. Each frame self-tests for a TDX ticket form
(a `form` containing `.form-group[data-fieldtype]`) and exits immediately if
absent. Only the form frame mounts the panel. No cross-frame messaging.

No background service worker. `chrome.storage.local` is reachable from content
scripts and there is no background event to handle.

### Page-world bridge

A second content script with `world: "MAIN"`, same frames, exists solely to reach
`window.CKEDITOR` and `window.jQuery`, which the isolated world cannot see. It
communicates over `window.postMessage` with a namespaced token and exposes one
operation in the MVP: `setEditorData(instanceKey, html)`. A second,
`notifyJQueryChange(selector)`, is reserved for the select2 write adapter and is
not implemented while select2 remains detection-only. Nothing else crosses the
boundary.

### Resolution — four tiers

Highest tier wins. Every tier records its evidence.

| Tier | Signal | Confidence | Covers |
|---|---|---|---|
| 0 | learned mapping for this form signature | 1.00 | user corrections |
| 1 | `data-fieldtype` on ancestor `.form-group` | 0.95 | TDX system fields |
| 2 | `data-fieldid` on ancestor `.form-group` | 0.90 | instance-wide custom attributes |
| 3 | weighted score over label, option set, `name`, `id`, placeholder, aria | 0.0–0.85 | unseen fields, other TDX instances |

Tier 3 runs even when a higher tier wins, because diagnostics needs the
runners-up and because tier 3 is the portability guarantee.

Tier 3 weights: exact label match 1.0; label contains synonym 0.7; option-set
overlap 0.9 (a select carrying `Low - Affects User` is Impact regardless of its
label); `name`/`id` fragment 0.5; placeholder or aria text 0.4. A control-type
mismatch multiplies by 0.3 rather than eliminating, since TDX sometimes converts a
textbox to a dropdown.

Assignment is globally best-match, one control per canonical field: build the
score matrix, then assign greedily in descending order, each control and each
field claimed once. This prevents two canonical fields from claiming the same
control.

### The dictionary

The only place field identity is defined. No selector string appears in fill or
adapter logic. Each entry:

```
{ key, fieldTypes: [], fieldIds: [], labels: [], patterns: [],
  control: 'text' | 'select' | 'lookup' | 'richtext', options: [] }
```

Covers all canonical fields listed in section 4, both written and unwritten.

### Form signature

The learning key: the sorted list of `data-fieldid` values present on the page
plus the `ParentFormID` hidden input (162 on the captured form), hashed. Stable
across sessions, ignores the session and app IDs that TDX puts in URLs, and
changes when an administrator actually edits the form — which is exactly when a
learned mapping should be invalidated.

## 6. Widget adapters

Resolution decides what a field is. Adapters decide how to write it. Each adapter
takes `(control, value)` and returns `{status, detail}` where status is one of
`filled | preserved | skipped | failed | needs-confirm`. Never a bare boolean,
never a silent success.

**Every adapter reads back what it wrote and compares against intent before
returning `filled`.** A mismatch returns `failed` with expected and actual values.
This is what makes "nothing fails silently" enforceable rather than aspirational,
and it is the check that catches a widget that accepted the pixels but not the
value.

**Adapters contain no field-specific business logic.** They know a control shape
and nothing about which canonical field they are serving. `Walkup`, `Unknown`,
template bodies, and preserve-versus-overwrite all live in fill policy above them.

### Text inputs, textareas, native selects

Assign through the native prototype setter, then dispatch bubbling `input`,
`change`, and `blur`:

```js
Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v)
```

Plain `el.value = v` fails silently on Kendo-managed inputs: the visible text
updates but the widget's internal model does not, and the postback submits an
empty field with no error. This is load-bearing and carries a comment saying so,
because it looks exactly like something a future maintainer would tidy up.

Native selects match option text case-insensitively with a `startsWith` fallback,
use the `HTMLSelectElement` prototype setter, and dispatch `change`.

### Captured lookups — Service, Service Offering, Department

Rather than driving the AJAX type-ahead, the extension writes a previously
captured `{id, text}` pair into all three places the widget uses: hidden
`attributeNNN` receives the ID, visible `attributeNNN_input` receives the display
text through the prototype setter plus events, and `attributeNNN_reset` receives
the ID. Then the widget's change is fired.

TDX lookup IDs are stable per instance (`Capen Hall = 139`,
`Personal Device Consultation = 288`), so capture is both simpler and more
reliable than search. It eliminates AJAX latency, ambiguous multi-row matches, and
the shared-suggestion-container race that would otherwise force lookups to run in
series.

**Capture** is the same code read backwards: read the three values from a form the
technician has filled by hand, store the pair.

Location and Location Room are out of the MVP: TDX prefills Location and
preserve-by-default keeps it.

### Requestor

Prefill-first. If `attribute495` already holds a GUID, report `preserved`. A
type-ahead lookup adapter exists as a fallback for the case where TDX did not
prefill, but it is not on the common path.

### select2

Detection and classification only in the MVP. No write adapter. Affiliation,
Device type, and Operating System are outside the fill set, so diagnostics can
identify them without any manipulation path existing.

### Rich text — Description

Primary path: `CKEDITOR.instances['attribute138_Content'].setData(html)` through
the page-world bridge, which updates the editor, its iframe body, and the backing
textarea in one call.

Fallbacks, in order, if the instance is absent: the same-origin iframe body's
`innerHTML` plus the textarea prototype setter; then `[contenteditable]`; then a
bare textarea. Every path verifies the resulting content before reporting
`filled`, and reports which shape it found. Success is never claimed when
CKEditor is unavailable and the fallback cannot be verified.

### Waiting

`waitFor(predicate, {timeout})` built on `MutationObserver` plus a ~120 ms poll,
used for the bridge handshake and the editor-ready check. No fixed `setTimeout`
sleeps anywhere — desk network latency varies.

## 7. Service selection

Called **local example retrieval**. It is not RAG and not neural. There is no
access to TDX ticket history; the corpus starts empty and contains only examples
the technician explicitly confirms and saves.

Two sources of a Service value, in order:

1. **Template-bound, deterministic, always available.** Every template carries a
   captured `{id, text}`. Selecting a template yields a Service with no inference.
   This is the cold-start behavior and the permanent floor.
2. **Retrieval suggestion, optional and additive.** The current description is
   scored against confirmed local examples. Above threshold, the match is proposed
   in place of the template's Service, with its evidence shown.

### Retriever interface

One seam, so the ranking method is swappable:

```
retrieve(queryText, examples)
  -> [{ service: {id, text}, score, evidence: [{exampleId, snippet, terms}] }]
```

The UI and fill engine consume only this shape. Replacing TF-IDF with an
embedding retriever later means writing one module that returns the same array;
nothing above it changes.

MVP retriever: TF-IDF over word unigrams, cosine similarity, an English stopword
list, no stemming. The corpus is small enough to score in a synchronous loop.

### Confidence gate

| Condition | Behavior |
|---|---|
| Score at or above threshold | Suggested with score and matching prior examples; **awaits explicit confirmation** before writing |
| Score below threshold | No suggestion. Falls back to the template's Service, or manual selection, and says which |
| Empty corpus | Template's Service, labeled `template default` |

Service is never written without a visible selection the technician can see and
change. Same rule as Affiliation: no silent inference into a routing-relevant
field.

### Saving examples

After a fill, the panel offers `Save this as an example`, storing
`{description, service: {id, text}, savedAt}`. Never automatic — an unconfirmed
fill teaches nothing. Wrong examples are deletable in settings.

## 8. Data model

Four stores, all `chrome.storage.local`. No `storage.sync`, no network.

| Store | Holds | Lifetime |
|---|---|---|
| `templates` | issue templates including captured Service | user-managed |
| `examples` | confirmed `{description, service{id,text}, savedAt}` | grows with use |
| `learned` | `formSignature -> {controlKey: canonicalField}` | grows with corrections |
| `settings` | similarity threshold, overwrite toggle, diagnostics flag | user-managed |

The technician-defaults store from the original brief is dropped: with the fill
set reduced to five fields it would hold one constant, and `Source = Walkup` lives
in the dictionary as that field's fixed value.

**The current requestor is not persisted.** It holds student PII and lives in
panel memory only, cleared on navigation. Re-pasting costs one keystroke;
student records on disk cost more.

### Requestor parser

One function: string in, `{fields, warnings}` out. It never throws — a malformed
paste yields partial fields and a warnings list, because a parser that throws
mid-shift is worse than one that reports what it could not find.

Each extraction is independent so one failure does not cascade:

- `personGuid` — the `U=` parameter of any `PersonDet.aspx` URL, markdown link or
  bare. Authoritative; this is what TDX actually submits.
- `name` — markdown link text, else the first non-empty line after a `Requestor`
  header.
- `email` — the `mailto:` target, else the first address-shaped token.
- `personNumber` and `ubitName` — the `50583450 - duynghie` line, split on the
  dash. **UBITName comes from this line, never from the email local part** —
  aliases exist and the ID line is authoritative. The code carries this comment.
- `title`, `organization` — the remaining lines between the email and the ID line.

A plain-text paste with no links still yields name, email, UBITName, and person
number. The GUID is the only casualty, and its absence is a warning, not an error.

### Templates

```
{ id, name, summary, descriptionHtml, service: {id, text} | null }
```

Three shipped plus a blank. Descriptions are written as past-tense notes for the
next technician — what was done and what was verified — specific enough that
whoever picks up a follow-up knows what has already been ruled out.

1. **Set up eduroam** — removed the stale profile, ran the eduroam CAT
   configuration tool, signed in with UBITName credentials, accepted the
   certificate prompt, confirmed the device pulled an address and reached the
   internet.
2. **Reset UBITName password** — photo ID verified in person against the account
   record, the user set the password themselves (staff never sees or handles it),
   reminded them to update saved credentials on phones, tablets, and eduroam
   profiles, confirmed sign-in before they left.
3. **Set up Duo two-step** — identity verified in person, Duo Mobile installed and
   the device enrolled, push notification tested end to end, backup method
   discussed so a lost phone does not lock the account out.

All three ship with `service: null`. The technician captures the correct Service
once per template on a real form; the extension does not invent IDs it has never
seen. The blank template exists for the walk-up that fits nothing.

Placeholders `{{name}}`, `{{ubitName}}`, `{{email}}`, `{{personNumber}}`,
`{{date}}` are substituted in both summary and description. An unknown placeholder
is left literal and flagged in the results, so a typo is visible rather than
silently blanking a field. Values substituted into the description are
HTML-escaped.

### Fill policy

The only field-aware layer. For each of the five fill-set fields it decides the
value and whether to write, given preserve-by-default, the overwrite toggle, the
Service confirmation gate, and the UBITName fallback.

## 9. User interface

**Mount.** A shadow root, docked bottom-right of the form iframe, about 330 px
wide, collapsible, remembering its collapsed state. Shadow DOM is required because
TDX ships Bootstrap, jQuery UI, and Kendo stylesheets, any of which would
otherwise restyle the panel.

**Appearance.** Deliberately not TDX. TDX's chrome is white and blue; the panel is
a dark charcoal surface with a single amber accent, reading as a separate
instrument sitting on top of the page. A visible focus ring on every interactive
element, keyboard-reachable throughout, `Esc` collapses. Monospace is confined to
parsed identifiers — GUID, person number, UBITName, service ID — where character
accuracy is the point; everything else is proportional.

**Order.** Paste textarea; `Parse` and `Read from page`; the parsed fields with
anything missing flagged; the template picker; the Service row; `Fill`; results.

`Read from page` reads `RequestorUID` from the form's own URL and the
`data-default` attribute on `attribute495`. This yields the GUID and display name
with no cross-frame plumbing. It does not yield email, UBITName, or person number
— the paste path remains the complete one.

**Results panel.** One row per fill-set field, plus resolved-but-out-of-scope
fields collapsed under a summary count. Each row shows the field name, a status
chip, and a short reason.

```
✓ Brief Summary    filled
✓ Description      filled — CKEditor instance
✓ Source           filled — "Walkup"
✓ UBITName         filled
• Service          template default (no confident match: best 0.42)
• Requestor        preserved — already set by TDX
– Affiliation      skipped — out of fill scope
✕ Location         failed — wrote "139", read back ""
```

`needs-confirm` is reserved for an above-threshold Service suggestion awaiting a
click. Below threshold there is no suggestion, only the template default, stated
as such.

Filled controls receive a brief outline on the page itself so the technician can
see at a glance what was touched. The failure line is the point of the panel: when
TDX changes, the mismatch is visible rather than a form that looks correct and
submits wrong.

**Correction feeds learning.** Any row offers a control to reassign that control
to a different canonical field. The correction writes to `learned` under the form
signature and applies as tier 0 next time.

**Diagnostic mode.** A toggle that dumps every harvested control: extracted label,
`data-fieldtype`, `data-fieldid`, control shape, resolved canonical field,
confidence, the tier that won, and the top three runners-up with their scores.
Rendered as monospace text in a `<pre>` with a copy button — plain text, because
copy-pasteable is the requirement.

**Settings.** Technician templates, similarity threshold, and clearing learned
mappings.

**The extension never calls `submit()`.** A ticket that files itself with a wrong
location is worse than no extension, because nobody catches it until a technician
has been sent to the wrong building.

## 10. File layout

```
manifest.json
README.md
src/
  content/mount.js          detect TDX form in this frame, mount panel, else exit
  content/bridge-main.js    world: MAIN — CKEDITOR and jQuery reach only
  core/dictionary.js        the only place field identity is defined
  core/harvest.js           enumerate and describe controls
  core/resolve.js           four-tier scoring, greedy assignment
  core/signature.js         form signature hash
  adapters/index.js         shape to adapter dispatch
  adapters/text.js          native-setter writes (inputs, textareas, selects)
  adapters/lookup.js        captured {id,text} write and capture read-back
  adapters/richtext.js      CKEditor via bridge, verified fallbacks
  adapters/wait.js          waitFor(predicate, {timeout})
  data/parser.js            requestor block to {fields, warnings}
  data/stores.js            four stores over chrome.storage.local
  data/templates.js         three shipped plus blank
  service/retriever.js      TF-IDF cosine, retrieve() interface
  fill/policy.js            value and write decisions; the only field-aware layer
  ui/panel.js               shadow-root panel, mount and state
  ui/results.js             per-field outcome rows, correction control
  ui/diagnostics.js         copy-pasteable dump
  ui/settings.js            templates, threshold, clear learned
  ui/panel.css.js           stylesheet
test/
  fixtures/tdx-form-162.html
  parser.test.js
  resolve.test.js
  retriever.test.js
  adapters.test.js
  no-network.test.js
```

`ui/panel.css.js` is a real, separate stylesheet that exports as a string. A
shadow root needs the CSS text, and a plain `.css` file would have to be declared
in `web_accessible_resources`, widening the extension's exposed surface for no
gain. The file carries a comment saying so.

## 11. Manifest and permissions

```
permissions:      ["storage"]
host_permissions: ["https://ubuffalo.teamdynamix.com/*"]
content_scripts:
  - matches: ["https://ubuffalo.teamdynamix.com/*"]
    all_frames: true
    run_at: document_idle
  - matches: ["https://ubuffalo.teamdynamix.com/*"]
    all_frames: true
    world: "MAIN"
```

That is the entire permission set. No `background` or service worker, no
`activeTab`, no `scripting`, no `tabs`, no `<all_urls>`, no `options_page`, no
`web_accessible_resources`.

`all_frames` is the one permission-shaped choice needing justification: the ticket
form is in a nested iframe, so a top-frame-only script sees nothing. Each frame
self-tests and all but one exit immediately.

## 12. Testing

Node's built-in `node:test` with `jsdom` as the single development dependency. No
framework, no configuration.

The fixture is the captured page reduced: the `<form>` subtree of the technician
view with `<script>` elements stripped and the verification token blanked — about
40 KB instead of 1.4 MB, retaining every signal the engine reads
(`data-fieldtype`, `data-fieldid`, labels, option sets, and the
`attributeNNN` / `_input` / `_reset` lookup triples). Real markup, checked in, no
hand-written mock forms.

- **`parser.test.js`** — the sample block yields all seven fields including the
  GUID from the `PersonDet.aspx` link; a plain-text paste with no links still
  yields name, email, UBITName, and person number.
- **`resolve.test.js`** — against the fixture, all five fill-set fields resolve
  with the expected tier and confidence. Against a **mutated** copy with
  `data-fieldtype` and `data-fieldid` stripped and labels shuffled, tier 3 alone
  still resolves them. This mutation is the proof of the brief: an unseen form,
  resolved from labels and option values alone.
- **`retriever.test.js`** — an empty corpus returns nothing (no cold-start
  guessing); a populated corpus ranks the correct service; the threshold gate
  holds.
- **`adapters.test.js`** — text and select adapters verified end to end in jsdom,
  including read-back mismatch returning `failed`. CKEditor, Kendo, and select2
  cannot be instantiated in jsdom; those get a manual checklist in the README
  rather than a fake test that proves nothing.
- **`no-network.test.js`** — stubs `fetch`, `XMLHttpRequest`, `WebSocket`, and
  `navigator.sendBeacon` to throw, runs a full parse to resolve to retrieve to
  fill cycle, and asserts none fired. This turns "zero network requests" from a
  promise into a failing test.

## 13. README contents

- How the four tiers resolve, and how to extend the dictionary.
- Why the native prototype setter and the read-back verification exist, so a
  future maintainer does not clean them up.
- Why `all_frames` is required and why there is no background worker.
- How the learning layer keys mappings on form signature rather than URL.
- How to debug a bad match using diagnostic mode.
- The manual verification checklist for CKEditor, Kendo lookups, and select2 —
  the three widgets jsdom cannot host.
- **TeamDynamix exposes a REST API at `/TDWebApi/`. If the institution's TDX
  administrators will issue credentials, building against that API beats DOM
  automation outright.** This extension is a workaround for not having API access,
  not a preference. That API's behavior has not been verified here and no endpoint
  behavior is described that has not been observed.

## 14. Acceptance criteria

1. Parsing the sample requestor block yields all seven fields, including the GUID
   from the `PersonDet.aspx` link. A plain-text paste with no links still yields
   name, email, UBITName, and person number.
2. The engine resolves the fill-set fields on a form it has no prior knowledge of,
   using labels and option values alone (verified by the mutated fixture).
3. Every fill reports an outcome. Nothing fails silently. Every `filled` is backed
   by a read-back verification.
4. No selector string appears in fill or adapter logic. The dictionary is the only
   place field identity is defined.
5. Affiliation is never written. The extension never calls `submit()`.
6. Zero network requests, enforced by test.
7. Comments explain the non-obvious why, not the obvious what.
