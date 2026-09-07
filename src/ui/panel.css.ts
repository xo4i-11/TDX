// The look of the panel, as a plain CSS string.
/**
 * Exported as a string rather than shipped as a .css file because a shadow
 * root needs the CSS *text*, and loading a stylesheet from the extension would
 * require declaring it in web_accessible_resources — widening what any page
 * can see for no benefit. Do not "fix" this back into a .css file.
 *
 * Neutral near-black, no colour of its own: the panel is an instrument sitting
 * over someone else's form, and the only things that should catch the eye are
 * the values in it. Nothing is translucent — every surface is solid, so no
 * colour here depends on what TDX happens to be painting underneath.
 *
 * Open and close animate on max-height/opacity rather than toggling `display`,
 * because a display change cannot be transitioned: the panel would snap.
 */
export const PANEL_CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: system-ui, -apple-system, Segoe UI, sans-serif; }

.panel {
  --ground: #1e1e1e;
  --raised: #292929;
  --field: #171717;
  --line: #343434;
  --ink: #ededed;
  --dim: #8d8d8d;
  --ease: cubic-bezier(.22, 1, .36, 1);

  position: fixed; right: 18px; bottom: 18px; width: 340px;
  display: flex; flex-direction: column;
  overflow: hidden; resize: both;
  min-width: 280px; min-height: 150px; max-width: 96vw; max-height: 92vh;
  background: var(--ground); color: var(--ink);
  border: 1px solid var(--line); border-radius: 14px;
  box-shadow: 0 16px 40px -16px #000000a6, 0 2px 8px -3px #00000066;
  font-size: 13px; line-height: 1.5; z-index: 2147483000;
  transition: width .26s var(--ease), height .26s var(--ease), border-radius .26s var(--ease);
}
/* Nothing animates while dragging: the panel must sit exactly under the pointer. */
.panel[data-dragging] { transition: none; box-shadow: 0 24px 54px -14px #000000bf; }

/* Chrome paints a grey triangle for the resizer; this replaces it. */
.panel::-webkit-resizer { display: none; }
.grip {
  position: absolute; right: 3px; bottom: 3px; width: 14px; height: 14px;
  pointer-events: none; opacity: 0; transition: opacity .15s ease; color: var(--dim);
  background:
    linear-gradient(135deg, transparent 46%, currentColor 46%, currentColor 57%, transparent 57%),
    linear-gradient(135deg, transparent 70%, currentColor 70%, currentColor 81%, transparent 81%);
}
.panel:hover .grip { opacity: .6; }

/* Collapsed, the panel is a bubble: one round handle, parked where it was left. */
.panel[data-collapsed="true"] {
  width: 48px; height: 48px; min-width: 0; min-height: 0;
  border-radius: 999px; resize: none;
}
.panel[data-collapsed="true"] .head { border-bottom-color: transparent; padding: 0; height: 46px; justify-content: center; }
.panel[data-collapsed="true"] .head h1,
.panel[data-collapsed="true"] .grip,
.panel[data-collapsed="true"] [data-error] { display: none; }
.panel[data-collapsed="true"] button:not([data-collapse]) { display: none; }
.panel[data-collapsed="true"] [data-collapse] { width: 30px; height: 30px; font-size: 15px; }
.panel[data-collapsed="true"] .body { max-height: 0; opacity: 0; padding-top: 0; padding-bottom: 0; }

.head {
  display: flex; align-items: center; gap: 4px;
  padding: 9px 9px 9px 14px;
  border-bottom: 1px solid var(--line);
  cursor: grab; touch-action: none; user-select: none;
  transition: padding .26s var(--ease);
}
.panel[data-dragging] .head { cursor: grabbing; }
.head h1 { margin: 0; flex: 1; font-size: 13px; font-weight: 600; color: var(--ink); white-space: nowrap; }
/* Header controls: quiet until you point at them, like the window controls they sit beside. */
.head button {
  min-width: 28px; height: 28px; padding: 0 8px; border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center;
  background: none; border-color: transparent; color: var(--dim);
  font-size: 14px; line-height: 1;
}
.head button:hover { background: var(--raised); color: var(--ink); border-color: transparent; }

.body {
  overflow-y: auto; overscroll-behavior: contain;
  flex: 1 1 auto; min-height: 0; max-height: 88vh; opacity: 1;
  padding: 14px; display: flex; flex-direction: column; gap: 18px;
  transition: max-height .26s var(--ease), opacity .18s ease, padding .26s var(--ease);
}
.body::-webkit-scrollbar { width: 10px; }
.body::-webkit-scrollbar-thumb { background: #3d3d3d; border: 3px solid transparent; background-clip: content-box; border-radius: 999px; }
.body::-webkit-scrollbar-thumb:hover { background: #4f4f4f; background-clip: content-box; }

section { display: flex; flex-direction: column; gap: 8px; }
h2 { margin: 0; font-size: 12px; font-weight: 600; color: var(--ink); }

textarea, input, select {
  width: 100%; padding: 8px 10px; font: inherit;
  background: var(--field); color: var(--ink);
  border: 1px solid var(--line); border-radius: 9px;
  transition: border-color .15s ease;
}
textarea:hover, input:hover, select:hover { border-color: #4a4a4a; }
textarea:focus, input:focus, select:focus { border-color: #6a6a6a; }
textarea { min-height: 78px; resize: vertical; }
/* The popup list is painted by the OS, not by this shadow root: without an
   explicit pair it inherits the page's white background and keeps our light
   text, which is white on white. */
select { color-scheme: dark; }
option { background: #262626; color: var(--ink); }

button {
  padding: 7px 12px; font: inherit; font-size: 12.5px; font-weight: 500; cursor: pointer;
  background: var(--raised); color: var(--ink);
  border: 1px solid var(--line); border-radius: 9px;
  transition: background .15s ease, border-color .15s ease;
}
button:hover { background: #343434; border-color: #4a4a4a; }
button.primary { background: var(--ink); border-color: var(--ink); color: #1a1a1a; }
button.primary:hover { background: #ffffff; }

.row { display: flex; gap: 8px; }
.row > span { flex: 1; }

/* Focus must be obvious: this panel is used at a walk-up desk, often by keyboard. */
:focus-visible { outline: 2px solid #7f9cff; outline-offset: 2px; }

/* Monospace only where character accuracy is the point. */
.ident { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; word-break: break-all; }

.parsed { display: grid; grid-template-columns: auto 1fr; gap: 5px 12px; margin: 0; }
.parsed dt { color: var(--dim); font-size: 12px; }
.parsed dd { margin: 0; }
.missing { color: #e88b7d; }
ul.missing { margin: 0; padding-left: 16px; font-size: 12px; }

.note { color: var(--dim); font-size: 12px; margin: 0; }
[data-error] { margin: 0; padding: 10px 14px; font-size: 12px; border-bottom: 1px solid var(--line); }

textarea[name="steps"] { width: 100%; min-height: 74px; }

/* The desk is not a motion-tolerant place for everyone. */
@media (prefers-reduced-motion: reduce) {
  .panel, .panel *, .head, .body { transition: none !important; animation: none !important; }
}
`;
