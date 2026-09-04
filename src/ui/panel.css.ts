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
  background: #1c1b1a; color: #ece7e1;
  border: 1px solid #3a3733; border-radius: 10px;
  box-shadow: 0 10px 30px rgba(0,0,0,.45);
  font-size: 13px; line-height: 1.45; z-index: 2147483000;
}
.panel[data-collapsed="true"] .body { display: none; }

.head {
  display: flex; align-items: center; gap: 8px;
  padding: 9px 11px; background: #262421; border-bottom: 1px solid #3a3733;
}
.head h1 { margin: 0; font-size: 12px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: #f0a71c; flex: 1; }

.body { overflow-y: auto; padding: 11px; display: flex; flex-direction: column; gap: 11px; }
section { display: flex; flex-direction: column; gap: 6px; }
h2 { margin: 0; font-size: 11px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: #a29a90; }

textarea, input, select {
  width: 100%; padding: 6px 7px; font: inherit;
  background: #141312; color: #ece7e1;
  border: 1px solid #45403a; border-radius: 5px;
}
textarea { min-height: 76px; resize: vertical; }

button {
  padding: 6px 10px; font: inherit; font-weight: 600; cursor: pointer;
  background: #2f2c28; color: #ece7e1;
  border: 1px solid #4a453e; border-radius: 5px;
}
button:hover { background: #3a3630; }
button.primary { background: #f0a71c; border-color: #f0a71c; color: #1c1b1a; }
button.primary:hover { background: #ffbb3d; }
.row { display: flex; gap: 6px; }

/* Focus must be obvious: this panel is used at a walk-up desk, often by keyboard. */
:focus-visible { outline: 2px solid #f0a71c; outline-offset: 2px; }

/* Monospace only where character accuracy is the point. */
.ident { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; word-break: break-all; }

.parsed { display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; }
.parsed dt { color: #a29a90; font-size: 11px; }
.parsed dd { margin: 0; }
.missing { color: #ff9b8a; }

.results { display: flex; flex-direction: column; gap: 3px; margin: 0; padding: 0; list-style: none; }
.result { display: grid; grid-template-columns: 16px 1fr; gap: 6px; padding: 4px 5px; border-radius: 4px; background: #232120; }
.result .icon { text-align: center; }
.result .name { font-weight: 600; }
.result .detail { grid-column: 2; color: #a29a90; font-size: 11.5px; }
.result[data-tone="good"] .icon { color: #7fd18b; }
.result[data-tone="warn"] .icon { color: #f0a71c; }
.result[data-tone="bad"] .icon { color: #ff7a66; }
.result[data-tone="mute"] .icon { color: #7d766e; }
.result[data-tone="mute"] { opacity: .72; }
.result select { margin-top: 4px; grid-column: 2; }

pre.diagnostics {
  margin: 0; padding: 8px; max-height: 260px; overflow: auto;
  background: #141312; border: 1px solid #45403a; border-radius: 5px;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 11px; white-space: pre;
}
.note { color: #a29a90; font-size: 11.5px; margin: 0; }
`;
