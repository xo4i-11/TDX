// Builds and wires up the floating panel: parses a requestor, picks a template and service, fills the form, and shows the results.
/**
 * Lives in a shadow root because TDX ships Bootstrap, jQuery UI, and Kendo
 * stylesheets, any of which would otherwise restyle it. Holds the requestor in
 * memory and never writes it to storage: those are student records.
 */

import { PANEL_CSS } from './panel.css.ts';
import { highlightFilled } from './results.ts';
import { renderSettings } from './settings.ts';
import { harvest } from '../core/harvest.ts';
import { resolve } from '../core/resolve.ts';
import { formSignature } from '../core/signature.ts';
import { pageMode } from '../core/pagemode.ts';
import { readRequestorFromPage, missingWarnings } from '../data/requestor-page.ts';
import { EMPTY_REQUESTOR, SHIPPED_TEMPLATES } from '../data/templates.ts';
import { runFill } from '../fill/policy.ts';
import { captureLookup, readLookup } from '../adapters/lookup.ts';
import { waitFor } from '../adapters/wait.ts';
import { readRichTextHtml } from '../adapters/richtext.ts';
import { isBlankHtml, toStepsTemplate } from '../data/resolved.ts';
import { findTemplateLink, applyTemplate } from '../adapters/tdx-templates.ts';
import type {
  Bridge, FillRow, RequestorFields, Resolution, Stores, Template,
} from '../types.ts';

// SHIPPED_TEMPLATES always ships with a 'blank' entry — this only exists to
// satisfy noUncheckedIndexedAccess on SHIPPED_TEMPLATES[0]; it is never
// actually reached.
const FALLBACK_TEMPLATE: Template = SHIPPED_TEMPLATES[0]
  ?? { id: 'blank', name: 'Blank', summary: '', descriptionHtml: '', service: null };

/** How long to keep watching for the Requestor card TDX renders around the form. */
const CARD_TIMEOUT_MS = 15000;

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

interface PanelState {
  /** Lives here and only here. Never persisted — see the file banner. */
  requestor: RequestorFields | null;
  warnings: string[];
  templateId: string;
  rows: FillRow[];
  /** Resolve mode: the troubleshooting steps box, kept here so a re-render does not wipe it. */
  steps: string;
  /**
   * Resolve mode: the body TDX's own template menu just loaded, red placeholder
   * still in it. Preferred over the stored capture — it is what UBIT publishes
   * today, not what was captured months ago.
   */
  loadedTemplateHtml: string | null;
  /** What the automatic template load did, shown in the panel so a silent miss is impossible. */
  autoTemplate: string;
  showSettings: boolean;
}

export async function createPanel({ doc: document, stores, bridge, now = () => new Date() }: CreatePanelOptions): Promise<PanelHandle> {
  const state: PanelState = {
    requestor: null,
    warnings: [],
    templateId: 'blank',
    rows: [],
    steps: '',
    loadedTemplateHtml: null,
    autoTemplate: '',
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

  // Decoration only: the resize itself is CSS `resize: both`, and this sits
  // over Chrome's own grey grip with pointer-events off, so the browser still
  // owns the drag.
  const grip = document.createElement('div');
  grip.className = 'grip';
  panel.append(grip);

  // A persistent DOM node, owned here rather than rebuilt by render()/body().
  // The whole point: render() itself touches storage (stores.settings.get(),
  // then templates()' several more calls) and can fail
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
  if (initialSettings.lastTemplateId) state.templateId = initialSettings.lastTemplateId;

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

  async function render(): Promise<void> {
    panel.replaceChildren(errorEl, header(), await body());
  }

  async function setCollapsed(collapsed: boolean): Promise<void> {
    panel.dataset.collapsed = String(collapsed);
    await stores.settings.patch({ collapsed });
    await render();
    // The bubble and the open panel are different sizes: what fitted collapsed
    // at the screen edge does not fit expanded.
    keepOnScreen();
  }

  /** Where the panel was dragged to, or null while it still sits in its default corner. */
  let at: { x: number; y: number } | null = null;

  /** Clamps to the viewport: the panel can never be dragged or resized off-screen. */
  function place(x: number, y: number, measured?: { width: number; height: number }): { x: number; y: number } {
    const view = document.defaultView;
    const width = measured?.width || panel.offsetWidth || 340;
    const height = measured?.height || panel.offsetHeight || 120;
    const maxX = Math.max(0, (view?.innerWidth ?? width) - width);
    const maxY = Math.max(0, (view?.innerHeight ?? height) - height);
    at = { x: Math.min(maxX, Math.max(0, x)), y: Math.min(maxY, Math.max(0, y)) };
    // left/top only once dragged — the CSS default (bottom right) is what an
    // untouched panel should keep, including after a window resize.
    panel.style.left = `${at.x}px`;
    panel.style.top = `${at.y}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    return at;
  }

  /**
   * Re-clamps after anything that changes the panel's size or the window's:
   * expanding it, the corner grip, or the technician resizing the browser. Without
   * this, a panel dragged to the right edge and then expanded hangs off it.
   */
  function keepOnScreen(): void {
    if (at) place(at.x, at.y);
  }
  const onResize = (): void => keepOnScreen();
  document.defaultView?.addEventListener('resize', onResize);

  /**
   * Remembers a corner resize. Debounced because ResizeObserver fires on every
   * frame of the drag and each notification would otherwise be a storage
   * write; a collapsed panel is the bubble, whose size is the stylesheet's
   * business, not the technician's.
   */
  let sizeTimer: ReturnType<typeof setTimeout> | undefined;
  // Null where there is no ResizeObserver (jsdom): the corner grip is a CSS
  // feature of a real browser, and its absence must not stop the panel mounting.
  const ResizeObserverCtor = document.defaultView?.ResizeObserver;
  const observer = ResizeObserverCtor ? new ResizeObserverCtor(() => {
    if (panel.dataset.collapsed === 'true') return;
    keepOnScreen();
    clearTimeout(sizeTimer);
    sizeTimer = setTimeout(() => {
      stores.settings.patch({ panelW: panel.offsetWidth, panelH: panel.offsetHeight }).catch(() => {
        // A failed size write is not worth a visible error: the panel is the
        // size the technician just dragged it to either way, it simply will
        // not be that size after a reload.
      });
    }, 250);
  }) : null;
  observer?.observe(panel);

  /**
   * Drag by the header. Pointer events, not mouse events: one code path covers
   * mouse, pen and touch, and setPointerCapture means a fast drag that leaves
   * the header — or the page — does not drop the panel mid-move.
   */
  function startDragging(handle: HTMLElement): void {
    handle.addEventListener('pointerdown', (event: PointerEvent) => {
      // Buttons in the header are still buttons.
      if ((event.target as Element | null)?.closest('button')) return;
      const rect = panel.getBoundingClientRect();
      const offsetX = event.clientX - rect.left;
      const offsetY = event.clientY - rect.top;
      // Measured once, here: reading offsetWidth inside the move handler
      // forces a layout on every pointer event, and a pointer can outrun the
      // compositor — that read is what makes a drag feel like it snags.
      const size = { width: rect.width, height: rect.height };
      // Optional call: a fast drag must not drop the panel, but an environment
      // without pointer capture (jsdom) is not a reason to refuse to drag.
      handle.setPointerCapture?.(event.pointerId);
      panel.dataset.dragging = 'true';
      event.preventDefault();

      // One write per animation frame. Pointer events fire faster than the
      // screen redraws, so applying every one of them is work nobody sees —
      // and the half-applied positions are what read as tearing.
      // Falls back to applying straight away where there is no rAF (jsdom):
      // the coalescing is a smoothness optimisation, not the drag itself.
      const view = document.defaultView;
      const schedule = view?.requestAnimationFrame?.bind(view)
        ?? ((callback: FrameRequestCallback): number => { callback(0); return 0; });
      const unschedule = view?.cancelAnimationFrame?.bind(view) ?? ((): void => {});
      let frame = 0;
      let pending: { x: number; y: number } | null = null;
      const move = (moveEvent: PointerEvent): void => {
        pending = { x: moveEvent.clientX - offsetX, y: moveEvent.clientY - offsetY };
        if (frame) return;
        frame = schedule(() => {
          frame = 0;
          if (pending) place(pending.x, pending.y, size);
        });
      };
      const up = (upEvent: PointerEvent): void => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        unschedule(frame);
        frame = 0;
        delete panel.dataset.dragging;
        const dropped = place(upEvent.clientX - offsetX, upEvent.clientY - offsetY, size);
        stores.settings.patch({ panelX: dropped.x, panelY: dropped.y }).catch((error: unknown) => {
          setError(describeError(error));
        });
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  }

  function header(): HTMLElement {
    const head = document.createElement('div');
    head.className = 'head';
    const title = document.createElement('h1');
    // Collapsed, the panel is a bubble and this is the only thing in it.
    title.textContent = panel.dataset.collapsed === 'true' ? 'TDX' : 'TDX Autofill';

    const settingsButton = button('⚙', () => { state.showSettings = !state.showSettings; return render(); });
    settingsButton.setAttribute('data-settings', '');
    settingsButton.setAttribute('aria-expanded', String(state.showSettings));
    settingsButton.title = 'Settings';
    settingsButton.setAttribute('aria-label', 'Settings');

    const collapsedNow = panel.dataset.collapsed === 'true';
    const collapse = button(collapsedNow ? '●' : '–', () => setCollapsed(!collapsedNow));
    collapse.setAttribute('data-collapse', '');
    collapse.title = collapsedNow ? 'Expand' : 'Minimise';
    collapse.setAttribute('aria-label', collapsedNow ? 'Expand' : 'Minimise');

    head.append(title, settingsButton, collapse);
    startDragging(head);
    return head;
  }

  async function body(): Promise<HTMLElement> {
    const wrap = document.createElement('div');
    wrap.className = 'body';

    if (state.showSettings) {
      wrap.append(await renderSettings({ doc: document, stores, onChange: render, guarded }));
      return wrap;
    }

    if (mode === 'resolve') {
      wrap.append(requestorSection(), await templateSection(), stepsSection(), resolvedSection());
    } else {
      wrap.append(requestorSection(), await templateSection());
    }
    return wrap;
  }

  function requestorSection(): HTMLElement {
    const el = sectionEl('requestor', 'Requestor');

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
      // Carried to the other form: the ticket created from this template is
      // resolved with the same one.
      await stores.settings.patch({ lastTemplateId: select.value });
      if (mode === 'resolve') {
        syncSteps();
        // Canned steps give way to canned steps, so switching jobs re-fills the
        // comment with the right ones. Text the technician typed themselves is
        // never overwritten — including by Blank, which has none.
        if (!state.steps.trim() || await isCannedSteps(state.steps)) {
          state.steps = (await selectedTemplate()).steps ?? '';
        }
      }
      await render();
      // Picking a template is the whole interaction: it fills, and picking
      // another one re-fills with that template's saved values.
      return fillNow();
    }));
    el.append(select);
    return el;
  }

  /** Whether the box still holds some template's canned steps, unedited — the test for "safe to replace". */
  async function isCannedSteps(text: string): Promise<boolean> {
    const current = text.trim();
    return (await templates()).some((t) => (t.steps ?? '').trim() === current && current !== '');
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

  /** Says what the automatic template load did, so a silent miss is impossible. */
  function resolvedSection(): HTMLElement {
    const el = sectionEl('resolved', 'Resolved template');
    el.append(noteEl(state.autoTemplate || 'Loading Templates > ALL > Ticket Resolved...'));
    return el;
  }

  /**
   * A template with no service yet learns one from the form: whatever is in the
   * Service lookup when it is first filled is saved onto the template, so the
   * next pick of that template sets Service itself. Nothing is guessed — an
   * empty lookup teaches nothing.
   */
  async function captureServiceIfNew(template: Template): Promise<Template> {
    if (template.service) return template;
    const captured = resolution.byField.get('service')?.control;
    const service = captured ? captureLookup(captured) : null;
    if (!service) return template;
    const offeringControl = resolution.byField.get('serviceOffering')?.control;
    const saved = { ...template, service, serviceOffering: offeringControl ? captureLookup(offeringControl) : null };
    await stores.templates.save(saved);
    return saved;
  }

  /** One fill, whether the button or the automatic flow asked for it. */
  async function fillNow(): Promise<void> {
    // Never fill through the resolution captured at mount — see rescan().
    syncSteps();
    await rescan();
    const template = await captureServiceIfNew(await selectedTemplate());
    const service = template.service;
    const serviceOffering = template.serviceOffering ?? null;
    const current = await stores.settings.get();
    // The body in the editor is the one this panel just loaded, not something
    // the technician typed, so replacing it is not clobbering their work —
    // and without this the comment row preserves and writes nothing.
    // Always overwrite: picking a template is an explicit "put this template's
    // values on the form", and switching templates has to replace the last
    // one's values rather than preserve them.
    const settings = { ...current, overwrite: true };
    state.rows = await runFill({
      resolution,
      mode,
      requestor: state.requestor ?? EMPTY_REQUESTOR,
      template,
      service,
      serviceOffering,
      steps: state.steps,
      resolvedCommentHtml: state.loadedTemplateHtml
        ? toStepsTemplate(state.loadedTemplateHtml, document)
        : null,
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
        // (settings.get, then templates()' more calls)
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
    setCollapsed(true).catch((error: unknown) => {
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
  // Resolve mode opens on the template the ticket was created from, so its
  // canned steps are in the box before autoResolve's first fill.
  if (mode === 'resolve') state.steps = (await selectedTemplate()).steps ?? '';

  document.body.append(host);
  await render();
  if (initialSettings.panelW) panel.style.width = `${initialSettings.panelW}px`;
  if (initialSettings.panelH) panel.style.height = `${initialSettings.panelH}px`;
  if (initialSettings.panelX !== undefined && initialSettings.panelY !== undefined) {
    place(initialSettings.panelX, initialSettings.panelY);
  }

  // The card holding the email, the UBITName and the person number is
  // rendered by the page *around* the form, and usually after this frame's
  // form is already up — so the read at mount above catches only the name and
  // the GUID, which come from the lookup and the URL. Watch for the card
  // instead of reporting "no UBITName found" forever.
  // ponytail: waitFor's poll does the work here (the observer is bound to this
  // frame's document, the card is in another), and it gives up quietly.
  if (!state.requestor?.ubitName) {
    waitFor(() => {
      const found = readRequestorFromPage(document, resolution);
      return found.ubitName || found.email || found.personNumber ? found : null;
    }, { timeout: CARD_TIMEOUT_MS, root: document, win: document.defaultView ?? undefined })
      .then((found) => {
        state.requestor = { ...(state.requestor ?? EMPTY_REQUESTOR), ...found };
        state.warnings = missingWarnings(state.requestor);
        return render();
      })
      .catch(() => {}); // card never showed; the panel already lists what is missing
  }

  // Deliberately not awaited: mounting must not wait on TDX's own fetch, and
  // every failure inside is turned into visible panel text by guarded().
  if (mode === 'resolve') guarded(autoResolve)();

  return {
    host,
    shadow,
    refresh: render,
    destroy() {
      document.removeEventListener('keydown', onEscape);
      document.defaultView?.removeEventListener('resize', onResize);
      clearTimeout(sizeTimer);
      observer?.disconnect();
      // highlightFilled (results.ts) marks controls on the page itself, not
      // inside this panel's shadow root — those dashed outlines must not
      // outlive the panel.
      for (const el of document.querySelectorAll('.tdxa-touched')) el.classList.remove('tdxa-touched');
      host.remove();
    },
  };
}

/** Turns a caught rejection into panel text a technician can act on, e.g. "Extension context invalidated." */
function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `Something went wrong and the action did not complete: ${message}`;
}
