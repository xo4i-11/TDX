// Builds and wires up the floating panel: parses a requestor, picks a template and service, fills the form, and shows the results.
/**
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
import { pageMode } from '../core/pagemode.ts';
import { DICTIONARY } from '../core/dictionary.ts';
import { ID_LINE, parseRequestor } from '../data/parser.ts';
import { EMPTY_REQUESTOR, SHIPPED_TEMPLATES } from '../data/templates.ts';
import { retrieve } from '../service/retriever.ts';
import { runFill } from '../fill/policy.ts';
import { captureLookup, readLookup } from '../adapters/lookup.ts';
import { readRichTextHtml } from '../adapters/richtext.ts';
import { findRedBlocks, isBlankHtml, toStepsTemplate, type RedBlock } from '../data/resolved.ts';
import { findTemplateLink, applyTemplate } from '../adapters/tdx-templates.ts';
import type {
  Bridge, Captured, FillRow, Ranked, RequestorFields, Resolution, Settings, Stores, Template,
} from '../types.ts';

// SHIPPED_TEMPLATES always ships with a 'blank' entry — this only exists to
// satisfy noUncheckedIndexedAccess on SHIPPED_TEMPLATES[0]; it is never
// actually reached.
const FALLBACK_TEMPLATE: Template = SHIPPED_TEMPLATES[0]
  ?? { id: 'blank', name: 'Blank', summary: '', descriptionHtml: '', service: null };

export interface CreatePanelOptions {
  /** The document the panel's own elements are created in — never the bare global. */
  doc: Document;
  stores: Stores;
  /**
   * Optional: the page-world CKEditor bridge. Left undefined when the caller
   * has no MAIN-world window to reach (or in a test) — fillRichText already
   * treats a missing bridge as "skip straight to the iframe/textarea
   * fallback", so the panel needs no special case for it.
   */
  bridge?: Bridge;
  now?: () => Date;
}

export interface PanelHandle {
  host: HTMLDivElement;
  shadow: ShadowRoot;
  refresh: () => Promise<void>;
  destroy: () => void;
}

/** What the service section decided to show: a confident local-corpus match, a template default, or nothing. */
type ServiceSuggestion =
  | { kind: 'suggested'; service: Captured; score: number; evidence: Ranked['evidence'] }
  | { kind: 'template'; service: Captured; score: number }
  | { kind: 'none'; service: null; score: number };

interface PanelState {
  /** Lives here and only here. Never persisted — see the file banner. */
  requestor: RequestorFields | null;
  warnings: string[];
  /** The raw paste textarea content, kept here so a re-render (any button click) doesn't wipe it. */
  pasteText: string;
  templateId: string;
  confirmedService: Captured | null;
  /** The Service Offering under confirmedService, captured with it. */
  confirmedOffering: Captured | null;
  rows: FillRow[];
  /** Resolve mode: the troubleshooting steps box, kept here so a re-render does not wipe it. */
  steps: string;
  /** Resolve mode: a capture awaiting confirmation. Never stored until the technician confirms. */
  capture: { html: string; blocks: RedBlock[]; chosen: number } | null;
  /**
   * Resolve mode: the body TDX's own template menu just loaded, red placeholder
   * still in it. Preferred over the stored capture — it is what UBIT publishes
   * today, not what was captured months ago.
   */
  loadedTemplateHtml: string | null;
  /** What the automatic template load did, shown in the panel so a silent miss is impossible. */
  autoTemplate: string;
  showDiagnostics: boolean;
  showSettings: boolean;
}

export async function createPanel({ doc: document, stores, bridge, now = () => new Date() }: CreatePanelOptions): Promise<PanelHandle> {
  const state: PanelState = {
    requestor: null,
    warnings: [],
    pasteText: '',
    templateId: 'blank',
    confirmedService: null,
    confirmedOffering: null,
    rows: [],
    steps: '',
    capture: null,
    loadedTemplateHtml: null,
    autoTemplate: '',
    showDiagnostics: false,
    showSettings: false,
  };

  const mode = pageMode(document);
  /**
   * The live steps textarea. Fill reads it directly: a value set without an
   * 'input' event — a paste handled by the page, an IME commit, an
   * autofill — never reaches the listener, and the technician would watch a
   * box full of text produce "type what you tried". The paste box next door
   * already re-reads itself in the Parse button for exactly this reason.
   */
  let stepsBox: HTMLTextAreaElement | null = null;
  let controls = harvest(document);
  const signature = formSignature(document);
  const learned = await stores.learned.get(signature);
  let resolution: Resolution = resolve(controls, { learned });

  // The requestor is already on the page — read it before the first render so
  // the panel opens with the UBITName filled in rather than waiting for a paste.
  const detected = readRequestorFromPage(document, resolution);
  if (Object.keys(detected).length) {
    state.requestor = { ...EMPTY_REQUESTOR, ...detected };
    state.warnings = missingWarnings(state.requestor);
  }

  /**
   * Re-reads the form. TDX is ASP.NET WebForms: an AutoPostBack select or a
   * cascading Service -> Service Offering lookup replaces whole DOM subtrees,
   * and the adapters themselves dispatch the change events that trigger those
   * partial postbacks. After one, an element captured earlier is detached —
   * writing it still "succeeds" and the read-back re-reads the same detached
   * node, so the one silent failure read-back structurally cannot see.
   */
  async function rescan(): Promise<void> {
    controls = harvest(document);
    resolution = resolve(controls, { learned: await stores.learned.get(signature) });
  }

  const host = document.createElement('div');
  host.id = 'tdx-autofill-host';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = PANEL_CSS;
  shadow.append(style);

  const panel = document.createElement('div');
  panel.className = 'panel';
  shadow.append(panel);

  // A persistent DOM node, owned here rather than rebuilt by render()/body().
  // The whole point: render() itself touches storage (stores.settings.get(),
  // then templates()/serviceSuggestion()'s several more calls) and can fail
  // for the exact same reason the action that triggered it failed — "every
  // chrome.storage.local call is dead" is a total outage, not a one-method
  // failure, once an unpacked extension is reloaded mid-session. Writing
  // straight into this node means the failure is visible even when the
  // best-effort recovery render() below can't complete at all.
  const errorEl = document.createElement('p');
  errorEl.className = 'missing';
  errorEl.setAttribute('data-error', '');
  errorEl.hidden = true;
  panel.append(errorEl);

  function setError(message: string): void {
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  function clearError(): void {
    errorEl.textContent = '';
    errorEl.hidden = true;
  }

  const initialSettings = await stores.settings.get();
  panel.dataset.collapsed = String(Boolean(initialSettings.collapsed));

  async function templates(): Promise<Template[]> {
    const custom = await stores.templates.list();
    const merged = new Map<string, Template>();
    for (const t of SHIPPED_TEMPLATES) merged.set(t.id, t);
    for (const t of custom) merged.set(t.id, t);
    return [...merged.values()];
  }

  async function selectedTemplate(): Promise<Template> {
    return (await templates()).find((t) => t.id === state.templateId) ?? FALLBACK_TEMPLATE;
  }

  async function serviceSuggestion(): Promise<ServiceSuggestion> {
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

  async function render(): Promise<void> {
    const current = await stores.settings.get();
    panel.replaceChildren(errorEl, header(), await body(current));
  }

  function header(): HTMLElement {
    const head = document.createElement('div');
    head.className = 'head';
    const title = document.createElement('h1');
    title.textContent = 'TDX Autofill';

    const settingsButton = button('Settings', () => { state.showSettings = !state.showSettings; return render(); });
    settingsButton.setAttribute('data-settings', '');
    settingsButton.setAttribute('aria-expanded', String(state.showSettings));

    const collapse = button(panel.dataset.collapsed === 'true' ? 'Expand' : 'Collapse', async () => {
      const collapsed = panel.dataset.collapsed !== 'true';
      panel.dataset.collapsed = String(collapsed);
      await stores.settings.patch({ collapsed });
      await render();
    });
    collapse.setAttribute('data-collapse', '');

    head.append(title, settingsButton, collapse);
    return head;
  }

  async function body(current: Settings): Promise<HTMLElement> {
    const wrap = document.createElement('div');
    wrap.className = 'body';

    if (state.showSettings) {
      wrap.append(await renderSettings({ doc: document, stores, onChange: render, guarded }));
      return wrap;
    }

    if (mode === 'resolve') {
      wrap.append(requestorSection(), await templateSection(), stepsSection(), await resolvedSection(), fillSection(current), resultsSection());
    } else {
      wrap.append(requestorSection(), await templateSection(), await serviceSection(), fillSection(current), resultsSection());
    }

    if (state.showDiagnostics) {
      wrap.append(renderDiagnostics(
        formatDiagnostics(resolution, { signature, url: document.defaultView?.location.href ?? '' }),
        { doc: document },
      ));
    }
    return wrap;
  }

  function requestorSection(): HTMLElement {
    const el = sectionEl('requestor', 'Requestor');

    const paste = document.createElement('textarea');
    paste.name = 'paste';
    paste.setAttribute('aria-label', 'Paste the requestor block');
    paste.placeholder = 'Paste the requestor block here';
    // Every render rebuilds this element from scratch (replaceChildren), so
    // without restoring the value here a click on any *other* button in the
    // panel would silently wipe whatever the technician had pasted.
    paste.value = state.pasteText;
    paste.addEventListener('input', () => { state.pasteText = paste.value; });

    const row = document.createElement('div');
    row.className = 'row';
    const parse = button('Parse', () => {
      // Covers a programmatic value change with no 'input' event too, not
      // just the common typing/pasting case the listener above already keeps live.
      state.pasteText = paste.value;
      const { fields, warnings } = parseRequestor(paste.value);
      state.requestor = fields;
      state.warnings = warnings;
      return render();
    });
    parse.setAttribute('data-parse', '');

    const readPage = button('Read from page', () => {
      state.requestor = { ...EMPTY_REQUESTOR, ...(state.requestor ?? {}), ...readRequestorFromPage(document, resolution) };
      state.warnings = missingWarnings(state.requestor);
      return render();
    });
    readPage.setAttribute('data-read-page', '');
    row.append(parse, readPage);

    el.append(paste, row);

    const requestor = state.requestor;
    if (requestor) {
      const list = document.createElement('dl');
      list.className = 'parsed';
      const identifiers = new Set<keyof RequestorFields>(['personGuid', 'personNumber', 'ubitName', 'email']);
      const fieldRows: [keyof RequestorFields, string][] = [
        ['name', 'Name'], ['email', 'Email'], ['ubitName', 'UBITName'],
        ['personNumber', 'Person #'], ['personGuid', 'GUID'],
      ];
      for (const [key, label] of fieldRows) {
        const dt = document.createElement('dt');
        dt.textContent = label;
        const dd = document.createElement('dd');
        const value = requestor[key];
        dd.textContent = value ?? 'missing';
        if (value && identifiers.has(key)) dd.className = 'ident';
        if (!value) dd.className = 'missing';
        list.append(dt, dd);
      }
      el.append(list);

      // The parser's warnings are the "see why without a debugger" signal
      // this task exists to surface — a bare "missing" dd doesn't say *why*
      // TDX submits a GUID and this paste didn't carry one, for example.
      if (state.warnings.length) {
        const warn = document.createElement('ul');
        warn.className = 'missing';
        for (const message of state.warnings) {
          const li = document.createElement('li');
          li.textContent = message;
          warn.append(li);
        }
        el.append(warn);
      }
    }

    return el;
  }

  async function templateSection(): Promise<HTMLElement> {
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
    select.addEventListener('change', guarded(async () => {
      state.templateId = select.value;
      state.confirmedService = null; // a new template means a new service decision
      state.confirmedOffering = null;
      // Only pre-fill an empty box. Overwriting would destroy typed work —
      // and Blank, the default, has no canned steps, so selecting it would
      // silently erase everything the technician had written.
      if (mode === 'resolve') {
        syncSteps();
        if (!state.steps.trim()) state.steps = (await selectedTemplate()).steps ?? '';
      }
      return render();
    }));
    el.append(select);
    return el;
  }

  async function serviceSection(): Promise<HTMLElement> {
    const el = sectionEl('service', 'Service');
    const suggestion = await serviceSuggestion();
    const chosen = state.confirmedService ?? (suggestion.kind === 'template' ? suggestion.service : null);

    const line = document.createElement('p');
    line.className = 'note';
    if (chosen) {
      const offering = state.confirmedOffering ?? (state.confirmedService ? null : (await selectedTemplate()).serviceOffering ?? null);
      const pair = offering ? `${chosen.text} / ${offering.text} (ids ${chosen.id} / ${offering.id})` : `${chosen.text} (id ${chosen.id})`;
      line.textContent = `${pair} — ${state.confirmedService ? 'confirmed' : 'template default'}`;
    } else if (suggestion.kind === 'suggested') {
      line.textContent = `Suggested: ${suggestion.service.text} — ${suggestion.score} similarity, from ${suggestion.evidence.length} prior example(s). Confirm to use it.`;
    } else {
      line.textContent = 'No service captured for this template and no confident match. Set it on the form by hand, then capture it.';
    }
    el.append(line);

    const row = document.createElement('div');
    row.className = 'row';

    if (suggestion.kind === 'suggested' && !state.confirmedService) {
      const suggested = suggestion.service;
      const confirm = button(`Use ${suggested.text}`, () => {
        state.confirmedService = suggested;
        return render();
      });
      confirm.setAttribute('data-confirm-service', '');
      row.append(confirm);
    }

    const capture = button('Capture service from form', async () => {
      // The form is the source of truth for both halves and TDX rebuilds the
      // offering lookup when Service changes, so read the live DOM, not the
      // resolution captured at mount.
      await rescan();
      const control = resolution.byField.get('service')?.control;
      const captured = control ? captureLookup(control) : null;
      if (!captured) {
        // The ordinary case where the technician forgot to set the Service
        // lookup on the form first — must say so, not do nothing.
        setError('Could not capture a service: nothing is selected in the Service lookup on the form.');
        return render();
      }
      // Optional half: "Wi-Fi / Wi-Fi Issue" is a Service plus an Offering,
      // but plenty of services have no offering under them at all.
      const offeringControl = resolution.byField.get('serviceOffering')?.control;
      const offering = offeringControl ? captureLookup(offeringControl) : null;
      const template = await selectedTemplate();
      await stores.templates.save({ ...template, service: captured, serviceOffering: offering });
      state.confirmedService = captured;
      state.confirmedOffering = offering;
      return render();
    });
    capture.setAttribute('data-capture-service', '');
    row.append(capture);

    el.append(row);
    return el;
  }

  /** Pulls the steps box's current text into state, covering a value change that fired no 'input' event. */
  function syncSteps(): void {
    if (stepsBox?.isConnected) state.steps = stepsBox.value;
  }

  function stepsSection(): HTMLElement {
    const el = sectionEl('steps', 'What you tried');
    const box = document.createElement('textarea');
    box.name = 'steps';
    box.setAttribute('aria-label', 'Troubleshooting steps, one per line');
    box.placeholder = 'One step per line';
    box.value = state.steps;
    box.addEventListener('input', () => { state.steps = box.value; });
    // Refill on blur rather than on every keystroke: one write per edit, and
    // the technician never has to press anything to see their steps land.
    box.addEventListener('change', guarded(() => fillNow()));
    stepsBox = box;
    el.append(box, noteEl('One line per bullet. This comment is visible to the client.'));
    return el;
  }

  async function resolvedSection(): Promise<HTMLElement> {
    const el = sectionEl('resolved', 'Resolved template');
    const current = await stores.settings.get();

    if (state.autoTemplate) el.append(noteEl(state.autoTemplate));
    el.append(noteEl(current.resolvedCommentHtml
      ? 'Captured, as a fallback for when the menu load fails.'
      : 'Nothing captured. The template is loaded from the page automatically; capture one only as a fallback.'));

    const capture = button('Capture resolved template', () => {
      const control = resolution.byField.get('comments')?.control;
      const html = control ? readRichTextHtml(control) : '';
      if (!html) {
        setError('Nothing to capture: the comment editor is empty. Pick Templates > ALL > Ticket Resolved on the form first.');
        return render();
      }
      const blocks = findRedBlocks(html, document);
      if (!blocks.length) {
        setError('Found no red placeholder text in the comment. Check the template loaded before capturing.');
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

  /** Shows which block will be replaced before anything is stored — the check the red heuristic needs. */
  function capturePreview(capture: NonNullable<PanelState['capture']>): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'preview';
    wrap.append(noteEl(capture.blocks.length > 1
      ? 'Pick the block your steps replace. Everything else in that block is dropped.'
      : 'This block will be replaced by your steps. Everything else in it is dropped.'));

    for (const block of capture.blocks) {
      const row = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'red-block';
      radio.checked = block.index === capture.chosen;
      radio.addEventListener('change', () => { capture.chosen = block.index; });
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

  /**
   * The body to write into Comments: what TDX's menu just loaded if the
   * automatic load worked, otherwise the stored capture. The loaded one wins
   * because it is what UBIT publishes today; the capture is the fallback for
   * when the menu is missing or its fetch never lands.
   */
  function resolvedBody(current: Settings): string | null {
    if (state.loadedTemplateHtml) {
      const blocks = findRedBlocks(state.loadedTemplateHtml, document);
      // No red in the freshly loaded body means the template changed shape;
      // fall through to the capture rather than write boilerplate with no
      // steps in it at all.
      if (blocks.length) return toStepsTemplate(state.loadedTemplateHtml, document, 0);
    }
    return current.resolvedCommentHtml ?? null;
  }

  /** One fill, whether the button or the automatic flow asked for it. */
  async function fillNow(): Promise<void> {
    // Never fill through the resolution captured at mount — see rescan().
    syncSteps();
    await rescan();
    const template = await selectedTemplate();
    const suggestion = await serviceSuggestion();
    const service = state.confirmedService ?? (suggestion.kind === 'template' ? suggestion.service : null);
    const serviceOffering = state.confirmedOffering ?? (state.confirmedService ? null : template.serviceOffering ?? null);
    const current = await stores.settings.get();
    // The body in the editor is the one this panel just loaded, not something
    // the technician typed, so replacing it is not clobbering their work —
    // and without this the comment row preserves and writes nothing.
    const settings = state.loadedTemplateHtml ? { ...current, overwrite: true } : current;
    state.rows = await runFill({
      resolution,
      mode,
      requestor: state.requestor ?? EMPTY_REQUESTOR,
      template,
      service,
      serviceOffering,
      steps: state.steps,
      resolvedCommentHtml: resolvedBody(current),
      settings,
      now: now(),
    }, {
      bridge,
      // Writing Service makes TDX rebuild the Service Offering lookup, so the
      // control planFill captured for it is detached by the time its turn comes.
      refind: async (fieldKey) => {
        await rescan();
        return resolution.byField.get(fieldKey)?.control ?? null;
      },
    });
    highlightFilled(state.rows, document);
    await render();
  }

  /**
   * Resolve mode's opening move, run once at mount: click TDX's own
   * Templates > ALL > Ticket Resolved, wait for the editor to receive it, then
   * fill. The technician opens no menu and clicks no button.
   *
   * Refuses to load over an editor that already has content — that content
   * could be a comment someone was part-way through writing, and TDX's own
   * template click would overwrite it without asking.
   */
  async function autoResolve(): Promise<void> {
    const control = resolution.byField.get('comments')?.control ?? null;
    if (!control) {
      state.autoTemplate = 'No comment editor found on this page, so no template was loaded.';
      return;
    }

    // isBlankHtml, not a truthiness check: CKEditor seeds its body with a
    // placeholder paragraph, so an untouched comment box is never "".
    const existing = readRichTextHtml(control);
    if (!isBlankHtml(existing)) {
      state.autoTemplate = 'The comment box already had content, so no template was loaded over it.';
      await fillNow();
      return;
    }

    const link = findTemplateLink(document, 'Ticket Resolved', 'ALL');
    if (!link) {
      state.autoTemplate = 'Templates > ALL > Ticket Resolved is not in this page menu; using the captured template instead.';
      await fillNow();
      return;
    }

    const result = await applyTemplate(link, () => readRichTextHtml(control));
    if (result.ok) {
      state.loadedTemplateHtml = readRichTextHtml(control);
      state.autoTemplate = 'Loaded Templates > ALL > Ticket Resolved.';
    } else {
      state.autoTemplate = `${result.detail}; using the captured template instead.`;
    }
    await fillNow();
  }

  function fillSection(current: Settings): HTMLElement {
    const el = sectionEl('fill', 'Fill');

    const overwriteLabel = document.createElement('label');
    const overwrite = document.createElement('input');
    overwrite.type = 'checkbox';
    overwrite.name = 'overwrite';
    overwrite.checked = Boolean(current.overwrite);
    overwrite.addEventListener('change', guarded(async () => {
      await stores.settings.patch({ overwrite: overwrite.checked });
      await render();
    }));
    overwriteLabel.append(overwrite, document.createTextNode(' Overwrite fields that already have a value'));

    const row = document.createElement('div');
    row.className = 'row';

    const fill = button('Fill form', () => fillNow(), 'primary');
    fill.setAttribute('data-fill', '');

    const diagnostics = button('Diagnostics', () => { state.showDiagnostics = !state.showDiagnostics; return render(); });
    diagnostics.setAttribute('data-diagnostics', '');
    diagnostics.setAttribute('aria-expanded', String(state.showDiagnostics));

    row.append(fill, diagnostics);
    el.append(overwriteLabel, row, noteEl('Never submits. Review the form before saving the ticket.'));
    return el;
  }

  function resultsSection(): HTMLElement {
    const el = sectionEl('results', 'Results');
    if (!state.rows.length) {
      el.append(noteEl('No fill run yet.'));
      return el;
    }

    el.append(renderResults(state.rows, {
      doc: document,
      fieldOptions: DICTIONARY.map((d) => ({ key: d.key, label: d.label })),
      // results.ts invokes this from its own plain `change` listener, outside
      // panel.ts's button()/guarded() wrapper — it has to catch its own
      // failures rather than rely on a caller that doesn't know about `state`.
      onCorrect: async (controlKey, fieldKey) => {
        clearError();
        try {
          await stores.learned.set(signature, { [controlKey]: fieldKey });
          resolution = resolve(controls, { learned: await stores.learned.get(signature) });
          await render();
        } catch (error) {
          setError(describeError(error));
          await render().catch(() => {});
        }
      },
    }));

    const saveExample = button('Save this as an example', async () => {
      const template = await selectedTemplate();
      const service = state.confirmedService ?? template.service;
      if (!service) {
        setError('Could not save an example: no service is confirmed or captured for this template yet.');
        return render();
      }
      await stores.examples.add({ description: `${template.summary} ${template.descriptionHtml}`, service });
      return render();
    });
    saveExample.setAttribute('data-save-example', '');
    el.append(saveExample);
    return el;
  }

  function sectionEl(name: string, title: string): HTMLElement {
    const el = document.createElement('section');
    el.dataset.section = name;
    const heading = document.createElement('h2');
    heading.textContent = title;
    el.append(heading);
    return el;
  }

  function noteEl(text: string): HTMLElement {
    const p = document.createElement('p');
    p.className = 'note';
    p.textContent = text;
    return p;
  }

  /**
   * Wraps any DOM event listener so a rejected promise — a store call after
   * "Extension context invalidated," the routine failure while iterating on
   * an unpacked extension — becomes visible panel text instead of a silent
   * no-op plus an unhandled rejection only the browser console ever sees.
   * All of `button()`'s clicks and the panel's own `change` listeners route
   * through this, so there is exactly one place that catches.
   */
  function guarded(action: () => void | Promise<void>): () => void {
    return () => {
      clearError();
      Promise.resolve().then(action).catch((error: unknown) => {
        // Written straight into the DOM first — not through state+render —
        // because render() is itself several storage round trips deep
        // (settings.get, then templates()/serviceSuggestion()'s more calls)
        // and a total storage outage (the realistic trigger here) kills all
        // of them, not just the one this action happened to call.
        setError(describeError(error));
        // Best-effort only from here: if the recovery succeeds it picks up
        // the same errorEl (see render()), so the message survives; if it
        // also fails, the message set above is already visible regardless.
        render().catch(() => {});
      });
    };
  }

  function button(text: string, onClick: () => void | Promise<void>, className = ''): HTMLButtonElement {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = text;
    if (className) el.className = className;
    el.addEventListener('click', guarded(onClick));
    return el;
  }

  function onEscape(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    panel.dataset.collapsed = 'true';
    stores.settings.patch({ collapsed: true }).catch((error: unknown) => {
      setError(describeError(error));
      render().catch(() => {});
    });
  }
  document.addEventListener('keydown', onEscape);

  // Attached last, and only once there is something to show. Everything above
  // is detached DOM construction plus the store reads that can reject (the
  // extension-reloaded case): appending earlier would leave an empty
  // #tdx-autofill-host on the page with no handle to destroy() it, and
  // mount.ts's already-mounted guard would then match that corpse forever.
  document.body.append(host);
  await render();

  // Deliberately not awaited: mounting must not wait on TDX's own fetch, and
  // every failure inside is turned into visible panel text by guarded().
  if (mode === 'resolve') guarded(autoResolve)();

  return {
    host,
    shadow,
    refresh: render,
    destroy() {
      document.removeEventListener('keydown', onEscape);
      // highlightFilled (results.ts) marks controls on the page itself, not
      // inside this panel's shadow root — those dashed outlines must not
      // outlive the panel.
      for (const el of document.querySelectorAll('.tdxa-touched')) el.classList.remove('tdxa-touched');
      host.remove();
    },
  };
}

/**
 * Recovers the requestor TDX already knows about, from the form's own URL, the
 * data-default blob on the requestor lookup, and the Requestor card TDX renders
 * beside the form. Returns only the fields it actually found, so it can be
 * merged over a paste without blanking what the paste got right.
 */
function readRequestorFromPage(doc: Document, resolution: Resolution): Partial<RequestorFields> {
  const url = doc.defaultView?.location.href ?? '';
  const fromUrl = url.match(/RequestorUID=([0-9a-f-]{36})/i)?.[1] ?? null;

  const control = resolution.byField.get('requestor')?.control ?? null;
  const hidden = control?.lookup?.hidden ?? null;
  const personGuid = (hidden?.value || fromUrl || null)?.toLowerCase() ?? null;
  // readLookup already reads the visible caption, falling back to the
  // data-default blob TDX writes when a widget hasn't initialised yet — the
  // same logic this file used to duplicate with its own JSON.parse.
  const name = control ? readLookup(control) || null : null;

  const found: Partial<RequestorFields> = {};
  for (const [key, value] of Object.entries(readRequestorCard(doc)) as [keyof RequestorFields, string | null][]) {
    if (value) found[key] = value;
  }
  if (personGuid) found.personGuid = personGuid;
  if (name) found.name = name;
  return found;
}

/**
 * Reads the Requestor card — the sidebar block carrying the email, the title,
 * and the "50583450 - duynghie" ID line that is the only authoritative source
 * of the UBITName. TDX renders it as free text with no stable id or class, so
 * this anchors on that ID line rather than on markup that changes per skin,
 * then hands the surrounding block to the same parser the paste path uses.
 */
function readRequestorCard(doc: Document): Partial<RequestorFields> {
  if (!doc.body) return {};
  const walker = doc.createTreeWalker(doc.body, 4 /* NodeFilter.SHOW_TEXT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!ID_LINE.test((node.textContent ?? '').trim())) continue;
    let block = node.parentElement;
    // Climb to the block that also holds the email: the card, not the bare line.
    for (let hops = 0; hops < 5 && block?.parentElement; hops++) {
      if (block.querySelector('a[href^="mailto:"]')) break;
      block = block.parentElement;
    }
    if (block) return parseRequestor(blockLines(block)).fields;
  }
  return {};
}

/** textContent collapses the card to one line, and jsdom has no innerText — so rebuild one line per text node. */
function blockLines(el: Element): string {
  const doc = el.ownerDocument;
  const walker = doc.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
  const lines: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.textContent ?? '').trim();
    if (text) lines.push(text);
  }
  return lines.join('\n');
}

/** Turns a caught rejection into panel text a technician can act on, e.g. "Extension context invalidated." */
function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `Something went wrong and the action did not complete: ${message}`;
}

function missingWarnings(fields: RequestorFields | null): string[] {
  const warnings: string[] = [];
  const checks: [keyof RequestorFields, string][] = [
    ['name', 'name'], ['email', 'email'], ['ubitName', 'UBITName'],
    ['personNumber', 'person number'], ['personGuid', 'person GUID'],
  ];
  for (const [key, label] of checks) {
    if (!fields?.[key]) warnings.push(`No ${label} found.`);
  }
  return warnings;
}
