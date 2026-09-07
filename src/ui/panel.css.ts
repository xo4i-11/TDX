// The look of the results panel, as a plain CSS string.
/**
 * Exported as a string rather than shipped as a .css file because a shadow
 * root needs the CSS *text*, and loading a stylesheet from the extension would
 * require declaring it in web_accessible_resources — widening what any page
 * can see for no benefit. Do not "fix" this back into a .css file.
 *
 * The palette is deliberately unlike TDX's white and blue: the panel should
 * read as a separate instrument sitting on top of the page, not as part of it.
 */
export const PANEL_CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: system-ui, -apple-system, Segoe UI, sans-serif; }

.panel {
  position: fixed; right: 16px; bottom: 16px; width: 330px; max-height: 78vh;
  display: flex; flex-direction: column; overflow: hidden;
  background: #1c1b1aee; color: #ece7e1;
  border: 1px solid #4a453e; border-radius: 14px;
  box-shadow: 0 1px 0 #ffffff14 inset, 0 18px 40px -12px rgba(0,0,0,.6), 0 2px 8px rgba(0,0,0,.35);
  backdrop-filter: blur(10px) saturate(120%);
  font-size: 13px; line-height: 1.45; z-index: 2147483000;
  transition: width .18s ease, border-radius .18s ease, box-shadow .18s ease;
}
.panel:hover { box-shadow: 0 1px 0 #ffffff1f inset, 0 22px 48px -12px rgba(0,0,0,.66), 0 2px 8px rgba(0,0,0,.4); }
/* Dragging: no transition, or the panel lags the pointer. */
.panel[data-dragging] { transition: none; box-shadow: 0 26px 60px -14px rgba(0,0,0,.7); }

/* Minimised, it is a bubble: a round handle you can park anywhere. */
.panel[data-collapsed="true"] { width: auto; border-radius: 999px; }
.panel[data-collapsed="true"] .body { display: none; }
.panel[data-collapsed="true"] .head { border-bottom: 0; padding: 8px 10px; }
.panel[data-collapsed="true"] .head h1 { flex: 0; }
.panel[data-collapsed="true"] button:not([data-collapse]) { display: none; }
.panel[data-collapsed="true"] [data-error] { display: none; }

.head {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 10px; background: #262421; border-bottom: 1px solid #3a3733;
  cursor: grab; touch-action: none; user-select: none;
}
.panel[data-dragging] .head { cursor: grabbing; }
.head h1 { margin: 0; font-size: 12px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: #f0a71c; flex: 1; }
/* Header controls are round chips, so the bubble reads as one shape. */
.head button {
  min-width: 26px; height: 26px; padding: 0 7px; border-radius: 999px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 13px; line-height: 1; cursor: pointer;
}

.body { overflow-y: auto; padding: 11px; display: flex; flex-direction: column; gap: 11px; }
section { display: flex; flex-direction: column; gap: 6px; }
section + section { border-top: 1px solid #2e2b27; padding-top: 11px; }
h2 { margin: 0; font-size: 11px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: #a29a90; }

textarea, input, select {
  width: 100%; padding: 6px 8px; font: inherit;
  background: #141312; color: #ece7e1;
  border: 1px solid #45403a; border-radius: 7px;
  transition: border-color .14s ease;
}
textarea:hover, input:hover, select:hover { border-color: #5b554c; }
textarea { min-height: 76px; resize: vertical; }

button {
  padding: 6px 10px; font: inherit; font-weight: 600; cursor: pointer;
  background: #2f2c28; color: #ece7e1;
  border: 1px solid #4a453e; border-radius: 5px;
}
button { transition: background .14s ease, border-color .14s ease, transform .08s ease; }
button:hover { background: #3a3630; border-color: #5b554c; }
button:active { transform: translateY(1px); }
button.primary { background: #f0a71c; border-color: #f0a71c; color: #1c1b1a; }
button.primary:hover { background: #ffbb3d; }
.row { display: flex; gap: 6px; }
.row > span { flex: 1; }

/* Focus must be obvious: this panel is used at a walk-up desk, often by keyboard. */
:focus-visible { outline: 2px solid #f0a71c; outline-offset: 2px; }

/* Monospace only where character accuracy is the point. */
.ident { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; word-break: break-all; }

.parsed { display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; }
.parsed dt { color: #a29a90; font-size: 11px; }
.parsed dd { margin: 0; }
.missing { color: #ff9b8a; }

.note { color: #a29a90; font-size: 11.5px; margin: 0; }

textarea[name="steps"] { width: 100%; min-height: 72px; }

/* The desk is not a motion-tolerant place for everyone. */
@media (prefers-reduced-motion: reduce) {
  .panel, button, textarea, input, select { transition: none; }
}
`;
