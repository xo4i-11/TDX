// The look of the panel, as a plain CSS string.
/**
 * Exported as a string rather than shipped as a .css file because a shadow
 * root needs the CSS *text*, and loading a stylesheet from the extension would
 * require declaring it in web_accessible_resources — widening what any page
 * can see for no benefit. Do not "fix" this back into a .css file.
 *
 * The palette is deliberately unlike TDX's white and blue: the panel should
 * read as a separate instrument floating over the page, not as part of it.
 *
 * Open and close are animated on max-height/opacity rather than toggling
 * `display`, because a display change cannot be transitioned — the panel would
 * snap. The bubble keeps its own size transition, so collapsing reads as one
 * object shrinking rather than two states swapping.
 */
export const PANEL_CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: system-ui, -apple-system, Segoe UI, sans-serif; }

.panel {
  --ink: #f2ede7;
  --dim: #a49c92;
  --line: #ffffff1a;
  --accent: #f0a71c;
  --ease: cubic-bezier(.22, 1, .36, 1);

  position: fixed; right: 18px; bottom: 18px; width: 340px;
  display: flex; flex-direction: column;
  /* The browser's own corner grip: a resizer with no drag maths to get wrong.
     Needs a non-visible overflow, which the rounded shell wants anyway. */
  overflow: hidden; resize: both;
  min-width: 280px; min-height: 150px; max-width: 96vw; max-height: 92vh;
  background: linear-gradient(180deg, #22201ef2, #17161582);
  color: var(--ink);
  border: 1px solid var(--line); border-radius: 18px;
  box-shadow:
    0 0 0 1px #00000059,
    0 1px 0 #ffffff17 inset,
    0 24px 60px -20px #000000a6,
    0 4px 14px -6px #00000073;
  backdrop-filter: blur(18px) saturate(140%);
  font-size: 13px; line-height: 1.5; z-index: 2147483000;
  transition: width .32s var(--ease), border-radius .32s var(--ease), box-shadow .2s ease;
  animation: tdxa-in .28s var(--ease) both;
}
@keyframes tdxa-in {
  from { opacity: 0; transform: translateY(10px) scale(.97); }
  to   { opacity: 1; transform: none; }
}
.panel[data-dragging] {
  transition: none;
  cursor: grabbing;
  box-shadow: 0 0 0 1px #00000059, 0 1px 0 #ffffff17 inset, 0 34px 70px -18px #000000bf;
}

/* The grip itself: Chrome paints a grey triangle, so hide it behind our own. */
.panel::-webkit-resizer { display: none; }
.grip {
  position: absolute; right: 2px; bottom: 2px; width: 15px; height: 15px;
  pointer-events: none; opacity: .35; transition: opacity .15s ease;
  background:
    linear-gradient(135deg, transparent 46%, currentColor 46%, currentColor 58%, transparent 58%),
    linear-gradient(135deg, transparent 70%, currentColor 70%, currentColor 82%, transparent 82%);
  color: var(--ink);
}
.panel:hover .grip { opacity: .7; }

/* Collapsed, the panel is a bubble: one round handle, parked wherever it was left. */
.panel[data-collapsed="true"] { width: 52px; height: 52px; min-width: 0; min-height: 0; border-radius: 999px; resize: none; }
.panel[data-collapsed="true"] .grip { display: none; }
.panel[data-collapsed="true"] .head { border-bottom-color: transparent; padding: 0; height: 50px; justify-content: center; }
.panel[data-collapsed="true"] .head h1 { display: none; }
.panel[data-collapsed="true"] button:not([data-collapse]) { display: none; }
.panel[data-collapsed="true"] [data-collapse] {
  width: 34px; height: 34px; font-size: 15px;
  background: linear-gradient(180deg, #ffc44d, var(--accent)); color: #1b1a18; border-color: #ffffff2e;
}
.panel[data-collapsed="true"] [data-collapse]:hover { transform: scale(1.06); }
.panel[data-collapsed="true"] [data-error] { display: none; }
.panel[data-collapsed="true"] .body {
  max-height: 0; opacity: 0; padding-top: 0; padding-bottom: 0; overflow: hidden;
}

.head {
  display: flex; align-items: center; gap: 6px;
  padding: 10px 10px 10px 14px;
  border-bottom: 1px solid var(--line);
  cursor: grab; touch-action: none; user-select: none;
  transition: padding .32s var(--ease), border-color .2s ease;
}
.head h1 {
  margin: 0; flex: 1; font-size: 11.5px; font-weight: 650;
  letter-spacing: .09em; text-transform: uppercase; color: var(--accent);
  white-space: nowrap;
}

.body {
  overflow-y: auto; overscroll-behavior: contain;
  flex: 1 1 auto; min-height: 0; max-height: 88vh; opacity: 1;
  padding: 13px 14px; display: flex; flex-direction: column; gap: 13px;
  transition: max-height .32s var(--ease), opacity .2s ease, padding .32s var(--ease);
}
.body::-webkit-scrollbar { width: 9px; }
.body::-webkit-scrollbar-thumb { background: #ffffff1f; border: 3px solid transparent; background-clip: content-box; border-radius: 999px; }
.body::-webkit-scrollbar-thumb:hover { background: #ffffff33; background-clip: content-box; }

section { display: flex; flex-direction: column; gap: 7px; }
section + section { border-top: 1px solid #ffffff10; padding-top: 13px; }
h2 { margin: 0; font-size: 10.5px; font-weight: 650; letter-spacing: .08em; text-transform: uppercase; color: var(--dim); }

textarea, input, select {
  width: 100%; padding: 8px 10px; font: inherit;
  background: #ffffff0a; color: var(--ink);
  border: 1px solid var(--line); border-radius: 10px;
  transition: background .15s ease, border-color .15s ease;
}
textarea:hover, input:hover, select:hover { background: #ffffff12; border-color: #ffffff2b; }
textarea:focus, input:focus, select:focus { background: #ffffff12; border-color: #ffffff40; }
textarea { min-height: 78px; resize: vertical; }

button {
  padding: 7px 12px; font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer;
  background: #ffffff12; color: var(--ink);
  border: 1px solid var(--line); border-radius: 10px;
  transition: background .15s ease, border-color .15s ease, transform .12s var(--ease);
}
button:hover { background: #ffffff1f; border-color: #ffffff2e; }
button:active { transform: scale(.96); }
button.primary { background: linear-gradient(180deg, #ffc44d, var(--accent)); border-color: #ffffff2e; color: #1b1a18; }
button.primary:hover { filter: brightness(1.06); }

/* Header controls are round chips, so the whole thing reads as one object. */
.head button {
  min-width: 28px; height: 28px; padding: 0 8px; border-radius: 999px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 13px; line-height: 1;
}

.row { display: flex; gap: 7px; }
.row > span { flex: 1; }

/* Focus must be obvious: this panel is used at a walk-up desk, often by keyboard. */
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* Monospace only where character accuracy is the point. */
.ident { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; word-break: break-all; }

.parsed { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; margin: 0; }
.parsed dt { color: var(--dim); font-size: 11px; }
.parsed dd { margin: 0; }
.missing { color: #ff9b8a; }
ul.missing { margin: 0; padding-left: 16px; font-size: 11.5px; }

.note { color: var(--dim); font-size: 11.5px; margin: 0; }
[data-error] { margin: 0; padding: 10px 14px; font-size: 12px; border-bottom: 1px solid var(--line); }

textarea[name="steps"] { width: 100%; min-height: 74px; }

/* The desk is not a motion-tolerant place for everyone. */
@media (prefers-reduced-motion: reduce) {
  .panel, .panel *, .head, .body { transition: none !important; animation: none !important; }
}
`;
