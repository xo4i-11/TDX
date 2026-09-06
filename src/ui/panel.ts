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
import { DICTIONARY } from '../core/dictionary.ts';
import { parseRequestor } from '../data/parser.ts';
import { SHIPPED_TEMPLATES } from '../data/templates.ts';
import { retrieve } from '../service/retriever.ts';
import { runFill } from '../fill/policy.ts';
import { captureLookup, readLookup } from '../adapters/lookup.ts';
import type {
  Bridge, Captured, FillRow, Ranked, RequestorFields, Resolution, Settings, Stores, Template,
} from '../types.ts';

/** A requestor with every field explicitly null — the base a partial read from the page is merged onto. */
const EMPTY_REQUESTOR: RequestorFields = {
  name: null, email: null, personGuid: null, personNumber: null, ubitName: null, title: null, organization: null,
};

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
  rows: FillRow[];
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
    rows: [],
    showDiagnostics: false,
    showSettings: false,
  };

  const controls = harvest(document);
  const signature = formSignature(document);
  const learned = await stores.learned.get(signature);
  let resolution: Resolution = resolve(controls, { learned });

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

    wrap.append(requestorSection(), await templateSection(), await serviceSection(), fillSection(current), resultsSection());

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
    select.addEventListener('change', guarded(() => {
      state.templateId = select.value;
      state.confirmedService = null; // a new template means a new service decision
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
      const suggested = suggestion.service;
      const confirm = button(`Use ${suggested.text}`, () => {
        state.confirmedService = suggested;
        return render();
      });
      confirm.setAttribute('data-confirm-service', '');
      row.append(confirm);
    }

    const capture = button('Capture service from form', async () => {
      const control = resolution.byField.get('service')?.control;
      const captured = control ? captureLookup(control) : null;
      if (!captured) {
        // The ordinary case where the technician forgot to set the Service
        // lookup on the form first — must say so, not do nothing.
        setError('Could not capture a service: nothing is selected in the Service lookup on the form.');
        return render();
      }
      const template = await selectedTemplate();
      await stores.templates.save({ ...template, service: captured });
      state.confirmedService = captured;
      return render();
    });
    capture.setAttribute('data-capture-service', '');
    row.append(capture);

    el.append(row);
    return el;
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

    const fill = button('Fill form', async () => {
      const template = await selectedTemplate();
      const suggestion = await serviceSuggestion();
      const service = state.confirmedService ?? (suggestion.kind === 'template' ? suggestion.service : null);
      state.rows = await runFill({
        resolution,
        requestor: state.requestor ?? EMPTY_REQUESTOR,
        template,
        service,
        settings: await stores.settings.get(),
        now: now(),
      }, { bridge });
      highlightFilled(state.rows, document);
      return render();
    }, 'primary');
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

  await render();

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
 * Recovers the requestor TDX already knows about, from the form's own URL and
 * the data-default blob on the requestor lookup. Yields the GUID and the name
 * and nothing else — the paste path remains the complete one.
 */
function readRequestorFromPage(doc: Document, resolution: Resolution): Pick<RequestorFields, 'personGuid' | 'name'> {
  const url = doc.defaultView?.location.href ?? '';
  const fromUrl = url.match(/RequestorUID=([0-9a-f-]{36})/i)?.[1] ?? null;

  const control = resolution.byField.get('requestor')?.control ?? null;
  const hidden = control?.lookup?.hidden ?? null;
  const personGuid = (hidden?.value || fromUrl || null)?.toLowerCase() ?? null;
  // readLookup already reads the visible caption, falling back to the
  // data-default blob TDX writes when a widget hasn't initialised yet — the
  // same logic this file used to duplicate with its own JSON.parse.
  const name = control ? readLookup(control) || null : null;

  return { personGuid, name };
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
