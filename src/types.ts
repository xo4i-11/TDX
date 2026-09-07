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
  /** The Service Offering under `service` — TDX treats the pair as one choice ("Wi-Fi / Wi-Fi Issue"). */
  serviceOffering?: Captured | null;
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

/** Saved issue templates, keyed by id. */
export interface TemplateStore {
  list(): Promise<Template[]>;
  save(template: Template): Promise<Template>;
  remove(id: string): Promise<void>;
}

/** Past confirmed tickets used to suggest a service. The technician supplies id and timestamp implicitly. */
export interface ExampleStore {
  list(): Promise<Example[]>;
  add(example: Pick<Example, 'description' | 'service'>): Promise<Example>;
  remove(id: string): Promise<void>;
}

/** Field-mapping corrections the technician made, keyed by form signature (src/core/signature.ts) so a form edit invalidates them. */
export interface LearnedStore {
  get(signature: string): Promise<Record<string, string>>;
  set(signature: string, mapping: Record<string, string>): Promise<void>;
  clearAll(): Promise<void>;
}

/** The technician's preferences, defaulted and patchable without clobbering unrelated keys. */
export interface SettingsStore {
  get(): Promise<Settings>;
  patch(partial: Partial<Settings>): Promise<void>;
}

/** The four persisted stores. No requestor store exists — requestor data lives in panel memory only. */
export interface Stores {
  templates: TemplateStore;
  examples: ExampleStore;
  learned: LearnedStore;
  settings: SettingsStore;
}
