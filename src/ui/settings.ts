// Settings view: the retrieval threshold, saved templates, learned field mappings, and saved examples.
/**
 * Examples are deletable because a single wrong example poisons every future
 * service suggestion, and the technician is the only one who can tell.
 *
 * A new template is saved with `service: null` — never guessed. The
 * technician captures the real service id from a form later; inventing one
 * here would silently misroute a ticket.
 */

import { SHIPPED_TEMPLATES } from '../data/templates.ts';
import type { Example, Stores, Template } from '../types.ts';

export interface RenderSettingsOptions {
  /** The document the settings view's elements are created in — never the bare global. */
  doc: Document;
  stores: Stores;
  /** Called after any store write, so the panel can refresh anything that depends on settings. */
  onChange?: () => void;
  /**
   * Wraps a listener so a rejected store call surfaces as visible panel text
   * instead of a silent no-op plus a console-only unhandled rejection — see
   * panel.ts's own `guarded`. Required, not defaulted: every listener below is
   * async, so a passthrough default would silently drop the promise and
   * reintroduce exactly the failure this parameter exists to close.
   */
  guarded: (action: () => void | Promise<void>) => () => void;
}

/** Builds the full settings view: threshold, templates, examples, learned mappings — freshly read from the stores. */
export async function renderSettings({
  doc, stores, onChange = () => {}, guarded,
}: RenderSettingsOptions): Promise<HTMLElement> {
  const wrap = doc.createElement('div');

  const rerender = async (): Promise<void> => {
    wrap.replaceChildren(...(await buildSections(doc, stores, rerender, onChange, guarded)));
  };
  await rerender();
  return wrap;
}

async function buildSections(
  doc: Document,
  stores: Stores,
  rerender: () => Promise<void>,
  onChange: () => void,
  guarded: (action: () => void | Promise<void>) => () => void,
): Promise<HTMLElement[]> {
  const [settings, templates, examples] = await Promise.all([
    stores.settings.get(),
    stores.templates.list(),
    stores.examples.list(),
  ]);

  const sections: HTMLElement[] = [];

  // Retrieval threshold
  const thresholdSection = section(doc, 'Service suggestion threshold');
  const threshold = doc.createElement('input');
  threshold.type = 'number';
  threshold.name = 'threshold';
  threshold.min = '0';
  threshold.max = '1';
  threshold.step = '0.05';
  threshold.value = String(settings.threshold);
  threshold.addEventListener('change', guarded(async () => {
    await stores.settings.patch({ threshold: Number(threshold.value) });
    onChange();
  }));
  thresholdSection.append(threshold, note(doc, 'Below this similarity, no service is suggested and the template default is used instead.'));
  sections.push(thresholdSection);


  // Templates
  const templateSection = section(doc, 'Templates');
  const isShipped = (id: string): boolean => SHIPPED_TEMPLATES.some((t) => t.id === id);
  for (const template of templates) {
    templateSection.append(templateRow(doc, template, isShipped(template.id), guarded(async () => {
      await stores.templates.remove(template.id);
      await rerender();
      onChange();
    })));
  }
  // True whether the list is empty, or holds only shipped ids the technician
  // captured a service onto — "Set up eduroam" here is not a template the
  // technician authored, so this note is not a lie in either case.
  if (!templates.some((t) => !isShipped(t.id))) {
    templateSection.append(note(doc, 'No custom templates yet. The shipped ones are always available.'));
  }

  const nameInput = inputField(doc, templateSection, 'Name', 'templateName');
  const summaryInput = inputField(doc, templateSection, 'Summary', 'templateSummary');
  const descriptionInput = textareaField(doc, templateSection, 'Description (HTML)', 'templateDescription');
  const add = doc.createElement('button');
  add.type = 'button';
  add.className = 'primary';
  add.textContent = 'Add template';
  add.setAttribute('data-add-template', '');
  add.addEventListener('click', guarded(async () => {
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
  }));
  templateSection.append(add);
  sections.push(templateSection);

  // Saved examples
  const exampleSection = section(doc, 'Saved examples');
  if (examples.length) {
    for (const example of examples) {
      exampleSection.append(exampleRow(doc, example, guarded(async () => {
        await stores.examples.remove(example.id);
        await rerender();
        onChange();
      })));
    }
  } else {
    exampleSection.append(note(doc, 'No examples saved yet. Service suggestions start once you save some.'));
  }
  sections.push(exampleSection);

  // Learned mappings
  const learnedSection = section(doc, 'Learned field mappings');
  const clear = doc.createElement('button');
  clear.type = 'button';
  clear.textContent = 'Clear all learned mappings';
  clear.setAttribute('data-clear-learned', '');
  clear.addEventListener('click', guarded(async () => {
    await stores.learned.clearAll();
    await rerender();
    onChange();
  }));
  learnedSection.append(
    note(doc, 'Corrections are remembered per form. Clear them if TDX changed and the old mapping is wrong.'),
    clear,
  );
  sections.push(learnedSection);

  return sections;
}

function templateRow(doc: Document, template: Template, isShipped: boolean, onRemove: () => void): HTMLElement {
  const line = doc.createElement('div');
  line.className = 'row';
  const name = doc.createElement('span');
  name.textContent = template.service ? `${template.name} → ${template.service.text}` : template.name;
  const remove = doc.createElement('button');
  remove.type = 'button';
  // A shipped template (e.g. "Set up eduroam") that only appears here because
  // a service was captured onto it isn't something the technician authored —
  // removing it resets it to the shipped default, it doesn't delete anything.
  remove.textContent = isShipped ? 'Reset to shipped' : 'Remove';
  remove.setAttribute('data-remove-template', template.id);
  remove.addEventListener('click', onRemove);
  line.append(name, remove);
  return line;
}

function exampleRow(doc: Document, example: Example, onRemove: () => void): HTMLElement {
  const line = doc.createElement('div');
  line.className = 'row';
  const text = doc.createElement('span');
  // Example.service is always present (src/data/stores.ts's ExampleStore
  // requires it) — a suggestion the technician never confirmed is never saved
  // as an example in the first place.
  text.textContent = `${truncate(example.description)} → ${example.service.text}`;
  const remove = doc.createElement('button');
  remove.type = 'button';
  remove.textContent = 'Delete';
  remove.setAttribute('data-remove-example', example.id);
  remove.addEventListener('click', onRemove);
  line.append(text, remove);
  return line;
}

function section(doc: Document, title: string): HTMLElement {
  const el = doc.createElement('section');
  const heading = doc.createElement('h2');
  heading.textContent = title;
  el.append(heading);
  return el;
}

function note(doc: Document, text: string): HTMLElement {
  const p = doc.createElement('p');
  p.className = 'note';
  p.textContent = text;
  return p;
}

function inputField(doc: Document, parent: HTMLElement, text: string, name: string): HTMLInputElement {
  const label = doc.createElement('label');
  label.textContent = text;
  const field = doc.createElement('input');
  field.type = 'text';
  field.name = name;
  label.append(field);
  parent.append(label);
  return field;
}

function textareaField(doc: Document, parent: HTMLElement, text: string, name: string): HTMLTextAreaElement {
  const label = doc.createElement('label');
  label.textContent = text;
  const field = doc.createElement('textarea');
  field.name = name;
  label.append(field);
  parent.append(label);
  return field;
}

function truncate(text: string): string {
  const plain = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return plain.length > 48 ? `${plain.slice(0, 45)}...` : plain;
}
