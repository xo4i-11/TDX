// Decides which of the two TDX forms the panel is looking at.
/**
 * One selector, not a URL check: the panel runs inside a nested iframe whose
 * location is not always the page the technician thinks they are on, and TDX
 * reuses one route for several ticket actions. The New Status select exists on
 * the update form and nowhere else.
 */

export type PageMode = 'create' | 'resolve';

export function pageMode(doc: Document): PageMode {
  return doc.querySelector('#NewStatusId, form#frmTicketUpdate') ? 'resolve' : 'create';
}
