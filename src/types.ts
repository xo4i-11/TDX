// The shared vocabulary: every data shape that more than one part of the extension passes around.

/** How a control must be written, which decides the adapter that handles it. */
export type ControlShape = 'text' | 'select' | 'select2' | 'lookup' | 'richtext' | 'checkbox';

/** What a canonical field expects its control to be. Narrower than ControlShape. */
export type ControlKind = 'text' | 'select' | 'lookup' | 'richtext' | 'checkbox';

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
  /**
   * Exempt from the preserve-versus-overwrite rule. For a field whose current
   * value is the form's own state rather than something a technician typed —
   * the ticket's existing status, a checkbox's default — "already has a value"
   * is not a reason to leave it alone, it is the thing being changed.
   */
  alwaysWrite?: boolean;
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
  /** Canned troubleshooting steps, one per line, pre-filled into the resolve panel's box. */
  steps?: string;
}

/** The technician's preferences. */
export interface Settings {
  collapsed?: boolean;
  /**
   * The template picked last, on either form. Create and resolve share one
   * list — the "Reconfigure eduroam" job is the same job on both — so the
   * resolve page comes up on the template the ticket was created from.
   */
  lastTemplateId?: string;
  /** Where the technician dragged the panel to, and how big they made it. */
  panelX?: number;
  panelY?: number;
  zoom?: number;
}

/** One line in the results panel: what happened to one field. */
export interface FillRow {
  fieldKey: string;
  label: string;
  action: 'write' | 'report';
  value: string | Captured | boolean | null;
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

/** The persisted stores. No requestor store exists — requestor data lives in panel memory only. */
export interface Stores {
  templates: TemplateStore;
  learned: LearnedStore;
  settings: SettingsStore;
}
