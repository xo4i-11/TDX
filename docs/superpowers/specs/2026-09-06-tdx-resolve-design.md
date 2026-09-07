# Resolving a ticket

Design for the second form the extension works on: the TDX ticket **Update**
page, used to resolve a walk-up ticket after the create form has done its job.

Companion to `2026-09-04-tdx-autofill-design.md`, which covers the create form
and the resolution engine both pages share.

## What the technician does today

Resolve a ticket by hand and it is five separate acts, every one of them
forgettable:

1. Set **New Status** to `Resolved`.
2. Leave **Responsible** on the IT helper account TDX already defaulted to.
3. Uncheck **Make comments private**, or the client never sees the reply.
4. Open **Templates → ALL → Ticket Resolved**, which loads boilerplate carrying
   red placeholder text.
5. Replace that red text with what was actually tried, and delete nothing else.

Step 3 is the one that hurts. A private resolution comment looks sent, reads
correctly in the ticket, and the client never receives it.

## What this adds

On the update page the panel writes three fields and reports the rest:

| Field | Value | Why it is written |
|---|---|---|
| New Status | `Resolved` | the point of the page |
| Make comments private | unchecked | the failure that is invisible until a client asks why nobody answered |
| Comments | the captured resolved template, red text replaced by the steps | the only field whose content varies per ticket |

**Responsible is never written.** TDX defaults it correctly and a wrong write
reassigns a real person's queue and emails them. It is resolved and reported
so it is visible before saving, and marked `neverWrite` in the dictionary —
the same guard `affiliation` carries on the create form, enforced in data
rather than in a branch someone can later delete.

**Nothing is ever submitted.** As on the create form, the panel fills and
stops.

## Page facts this design rests on

Read off a saved `Update.html` frame (ticket 229544), not assumed:

| Thing | Selector | Note |
|---|---|---|
| New Status | `select#NewStatusId` | `Resolved` is option value `80`; matched by text, not by that id |
| Responsible | `data-fieldtype="responsible"`, `data-fieldid="1279"` | lookup, prefilled with a GUID |
| Private comment | `input#CommentsIsPrivate` | **checked by default**; a sibling hidden input posts `false` |
| Comments | `textarea#Comments_Content` | CKEditor, same shape the create form's Description uses |
| Templates menu | `a.js-template[data-template-id]` under `#lnkShowTemplates` | grouped in submenus; **ALL → Ticket Resolved is id 61** |
| The form | `form#frmTicketUpdate` | |

Two facts drive the dictionary work below:

- **New Status, Comments, and the private checkbox carry no `data-fieldtype` or
  `data-fieldid`.** They are core TDX fields, not custom attributes. Only the
  11 custom attributes on the page (Responsible, UBITName, Affiliation, and
  friends) carry markers. So these three resolve at tier 3, on label and id
  pattern. Tier 3 exists for exactly this.
- **The update page already mounts the panel.** Its custom attributes satisfy
  `isTicketForm`'s `form [data-fieldtype]` gate, which is why the saved page
  contains the panel's own shadow root. No mount change is needed.

## Approach

The panel gains a **mode**, rather than a second panel or a form-profile
registry.

`pageMode(doc)` lives in `src/core/pagemode.ts`, beside the other pure
document readers (`signature.ts`, `harvest.ts`), and is called once by the
panel at mount: `#NewStatusId` present → `resolve`, else `create`. One cheap
check, with `form#frmTicketUpdate` as a confirming signal if it ever needs one.

`FILL_SET` becomes:

```ts
FILL_SETS = {
  create:  ['ubitName', 'briefSummary', 'description', 'source', 'service', 'serviceOffering'],
  resolve: ['newStatus', 'commentsPrivate', 'comments'],
}
```

Private-before-comments is deliberate. Unchecking is what makes the comment
client-visible, so if a run dies halfway the survivable outcome is an
unchecked box and no comment — not a private comment that looks sent.

A separate resolve panel was rejected: it duplicates roughly 200 lines of
render/error/collapse/guard plumbing for a mode whose sections are about 60.
A pluggable profile registry was rejected as speculation — there are two form
types, not five.

## Dictionary

Four new entries in `src/core/dictionary.ts`:

| key | shape | signals | fill set |
|---|---|---|---|
| `newStatus` | select | label `New Status`; `/^NewStatusId$/`; options include `Resolved`; `fixedValue: 'Resolved'` | resolve |
| `comments` | richtext | label `Comments`; `/^Comments[_.]Content$/` | resolve |
| `commentsPrivate` | checkbox | label `Make comments private`; `/^CommentsIsPrivate$/` | resolve |
| `responsible` | lookup | `data-fieldtype="responsible"`; `data-fieldid` `1279`; label `Responsible`; `neverWrite: true` | neither |

`FieldDef.fixedValue` is a string, so `commentsPrivate` does not use it. The
policy's `valueFor` returns the boolean `false` for that key directly, the
same way it already returns a `Captured` pair for `service` rather than a
string.

### A new control shape

`harvest` emits `text | select | select2 | lookup | richtext`. A checkbox is
none of them, so `ControlShape` gains `checkbox`, `harvest` recognises
`input[type=checkbox]`, and `applyValue` gains a third value-narrowing arm
(boolean) beside string and `{id, text}`.

`fillCheckbox` sets `.checked`, dispatches `change`, and reads back — the same
write-then-verify contract every other adapter honours. A checkbox that
refuses the change reports `failed`, never `filled`.

## Capturing the resolved template

The technician clicks **Templates → ALL → Ticket Resolved** by hand. TDX
fetches the body into CKEditor; that AJAX round trip stays TDX's business.
Then the panel's **Capture resolved template** reads it once and stores it.

Automating that click was rejected: it means waiting on someone else's AJAX
with no reliable completion signal, which is the failure class `lookup.ts`
exists to avoid.

### Reading the body as HTML

`readRichText()` returns plain text. Capture needs markup, so it gets a
sibling `readRichTextHtml(control)`: iframe `body.innerHTML` →
contenteditable `innerHTML` → `textarea.value`, the same three-path order the
fill side already walks. CKEditor keeps that iframe body live, so no bridge
change is needed — extending the postMessage protocol would touch four files
to buy nothing.

### Finding the red text

A run is red when an inline `style="color:…"` or a `<font color>` parses to a
red-dominant value: `r >= 100 && r >= 2g && r >= 2b`, plus the literal name
`red`. That covers `#c00`, `#FF0000`, `rgb(192,0,0)` and `red` without
pretending to know which one TDX's editor emits.

**The red run's nearest block ancestor** (`p`, `div`, `li`, `td`, else the run
itself) is replaced by a bare `{{steps}}` placeholder block. Replacing the
block, not the inline run, is what stops the fill from injecting a `<ul>`
inside a `<p>` — markup the editor silently mangles. The cost is that any
non-red text sharing that paragraph is dropped, which is exactly why capture
shows a before/after preview and saves only on confirmation.

Two or more red blocks: the preview lists each with a radio and nothing is
auto-selected. One block: auto-selected, still shown.

Capture refuses, with a message naming the fix, when the editor is empty —
CKEditor not yet initialised, or the template never clicked.

### Storage

`settings.resolvedCommentHtml: string | null`. One string, one per TDX
instance, not per walk-up template. A dedicated store for a single value is
ceremony. Settings gets a **Clear** button beside it, for when UBIT edits
template 61.

After capture the stored body is an ordinary `{{steps}}` template, so the
existing `substitute()` fills it. Nothing parses colour at fill time.

## The steps

`Template.steps?: string` — newline-separated canned troubleshooting steps,
added to the five walk-up templates and editable in Settings beside summary
and description.

Panel behaviour in resolve mode:

- Selecting a template writes its `steps` into the textarea, replacing what is
  there. Blunt on purpose: dirty-tracking is state nobody asked for, and
  changing template is an explicit act.
- A template with no `steps` leaves the box empty; the technician types.
- The text is always editable before Fill.
- Steps are never read from the ticket's description or existing comments.
  Those record what the client reported, not what was done, and this comment
  is client-visible.

At fill: split on newlines, trim, drop blanks, escape each line, wrap in
`<ul><li>…</li></ul>`. Always a list, even for a single line — one rule beats
two. The list is built pre-escaped and substituted unescaped, the same split
`renderTemplate` already makes between the plain-text summary and the HTML
description.

## Fill flow

`substitute(resolvedCommentHtml, { steps: stepsHtml }, { escape: false })`,
then the three writes in fill-set order.

Two blocked cases, each `needs-confirm` on the comments row only, with status
and the checkbox still written:

| Case | Message |
|---|---|
| nothing captured | capture the resolved template first |
| steps box empty | type what you tried before filling |

Both are recoverable because nothing is submitted. A silently empty
client-visible comment would not be.

## Testing

Against the existing runner: `node --test`, jsdom, no framework.

### Fixture

Tests need real update markup. The saved page is a live ticket, so a
`--scrub` pass is added to `scripts/make-fixture.ts` and run before anything
is committed: person GUIDs, emails, names, ticket id and subject, and the
`NewResponsibleId` default value all replaced with fixture values. The
scrubbed file is reviewed before it lands.

### What gets pinned

| Area | Pins |
|---|---|
| harvest | `CommentsIsPrivate` comes out as shape `checkbox` |
| resolve | `newStatus`, `comments`, `commentsPrivate` resolve at tier 3 with no marker to help them; `responsible` resolves and is `neverWrite` |
| capture | red detected as `#c00`, `rgb(192,0,0)`, `red`, `<font color>`; block ancestor replaced, not the inline run; two red blocks offered, neither auto-picked; empty editor refuses |
| policy | resolve set writes `Resolved`, unchecks private, substitutes bullets; missing capture and empty steps each block only the comment row |
| adapters | `fillCheckbox` reports `failed` when the box refuses the change |
| panel | resolve mode renders; template select prefills steps; fill runs end to end on the update fixture |

## Accepted limits

Each carries a `ponytail:` comment at its site.

1. **Capture before CKEditor initialises** reads the empty textarea. Guarded by
   the refusal above rather than by saving an empty template.
2. **The red heuristic can match red prose** that is not the placeholder. The
   preview is the check; this is why capture is not automatic.
3. **The technician clicks the TDX template.** Deliberate, per the rejected
   alternative above.
4. **One captured resolved body.** "Ticket Resolved - No Response" and its
   siblings are unsupported. Add a second slot when one is actually wanted.
