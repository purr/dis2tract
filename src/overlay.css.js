// the block screen's stylesheet, as text: page and manifest stylesheets stop at its closed shadow root (content.js), so
// it goes inside, and it has to be there at document_start, with no time to load a file. the porn page uses it too.
// look: apple's screen time limit screen (base colors and type from DESIGN.md), painted with the firefox theme's colors.
// var, not const: the binding must be visible to the script files loaded after this one
var OVERLAY_CSS = `
/* apple defaults. background.js overrides bg/fg, card/card-fg and accent with the firefox theme, each only where
   it stays readable (it checks the contrast); everything else derives from those. on the shadow root's host (the
   porn page's :root): the theme's first-paint rule sets them there from outside the root, and a rule on the host from
   outside wins over :host. the derived ones stay on the element itself, where painted colors make them recompute */
:root, :host {
  --d2t-bg: #f5f5f7;
  --d2t-fg: #1d1d1f;
  --d2t-card: #ffffff;
  --d2t-card-fg: var(--d2t-fg);
  --d2t-accent: #0071e3;
}
@media (prefers-color-scheme: dark) {
  :root, :host {
    --d2t-bg: #000000;
    --d2t-fg: #f5f5f7;
    --d2t-card: #1c1c1e;
    --d2t-accent: #2997ff;
  }
}
#dis2tract {
  /* 70%: at least 4.5:1 for small text, which background.js checks for a theme's pairs. the card has its own:
     muted text on a card mixed from the page colors fell to 1.2:1 under some themes */
  --d2t-muted: color-mix(in srgb, var(--d2t-fg) var(--d2t-mute, 70%), var(--d2t-bg));
  --d2t-card-muted: color-mix(in srgb, var(--d2t-card-fg) var(--d2t-card-mute, 70%), var(--d2t-card));
  --d2t-line: color-mix(in srgb, var(--d2t-fg) 12%, transparent);
  --d2t-line-strong: color-mix(in srgb, var(--d2t-fg) 24%, transparent);
  --d2t-ease: cubic-bezier(0.4, 0, 0.2, 1);
}

#dis2tract {
  all: initial;
  position: fixed !important;
  inset: 0 !important;
  z-index: 2147483647 !important;
  display: flex !important;
  flex-direction: column !important;
  align-items: center;
  box-sizing: border-box;
  padding: 32px 20px;
  overflow-y: auto;
  overscroll-behavior: contain;
  outline: none;
  /* alpha forced to 1: a translucent theme color must not let the feed show through */
  background: rgb(from var(--d2t-bg) r g b / 1);
  color: var(--d2t-fg);
  font: 17px/1.47 -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, "Segoe UI Variable Text", "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
  letter-spacing: -0.01em;
  text-align: center;
  -moz-osx-font-smoothing: grayscale;
}
#dis2tract * {
  all: revert;
  box-sizing: border-box;
  font: inherit;
  letter-spacing: inherit;
  color: inherit;
}
#dis2tract .d2t-card { width: 100%; max-width: 420px; margin: auto; }
#dis2tract h2 { margin: 0; font-size: 34px; line-height: 1.12; font-weight: 600; letter-spacing: -0.022em; text-wrap: balance; }
#dis2tract p { max-width: 34ch; margin: 8px auto 32px; color: var(--d2t-muted); text-wrap: balance; }

/* spotlight-style field. focus is a soft glow on the pill, never a ring on the bare input. both shadows exist
   at rest, fully transparent, so the browser fades them in instead of switching them on. */
#dis2tract .d2t-field {
  position: relative;
  display: flex;
  align-items: center;
  height: 52px;
  margin: 0;
  padding: 0 22px 0 46px;
  border: 1px solid var(--d2t-line);
  border-radius: 999px;
  background: var(--d2t-card);
  color: var(--d2t-card-fg);
  box-shadow:
    0 0 0 4px color-mix(in srgb, var(--d2t-accent) 0%, transparent),
    0 8px 24px -10px color-mix(in srgb, var(--d2t-accent) 0%, transparent);
  transition: border-color 0.35s var(--d2t-ease), box-shadow 0.45s var(--d2t-ease);
}
#dis2tract .d2t-field:focus-within {
  border-color: var(--d2t-accent);
  box-shadow:
    0 0 0 4px color-mix(in srgb, var(--d2t-accent) 14%, transparent),
    0 8px 24px -10px color-mix(in srgb, var(--d2t-accent) 45%, transparent);
  /* invisible here; forced colors (windows contrast themes) drop the glow and the accent border but draw this one
     in the system color, so focus still shows */
  outline: 2px solid transparent;
  outline-offset: 2px;
}
/* magnifier glyph: a ring and a handle. both are borders: forced colors draw a border in the text color but turn a
   background into the page color, which hid the handle */
#dis2tract .d2t-field::before,
#dis2tract .d2t-field::after {
  content: "";
  position: absolute;
  top: 50%;
  border-color: var(--d2t-card-muted);
  transition: border-color 0.25s var(--d2t-ease);
}
#dis2tract .d2t-field::before { left: 20px; width: 10px; height: 10px; margin-top: -8px; border: 2px solid var(--d2t-card-muted); border-radius: 50%; }
#dis2tract .d2t-field::after { left: 31px; width: 0; height: 6px; margin-top: 2px; border-left: 2px solid var(--d2t-card-muted); border-radius: 1px; transform: rotate(-45deg); }
#dis2tract .d2t-field:focus-within::before,
#dis2tract .d2t-field:focus-within::after { border-color: var(--d2t-card-fg); }
#dis2tract .d2t-field.d2t-plain { padding-left: 22px; }
#dis2tract .d2t-field.d2t-plain::before,
#dis2tract .d2t-field.d2t-plain::after { content: none; }
/* the sentence challenges: a wrapping field, so every typo stays in view on a phone */
#dis2tract .d2t-field.d2t-multi { height: auto; padding: 12px 18px; border-radius: 20px; }
#dis2tract .d2t-field textarea { min-height: 4.5em; line-height: 1.45; resize: none; }
#dis2tract .d2t-field :is(input, textarea) {
  flex: 1;
  min-width: 0;
  height: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: inherit;
  font-size: 17px;
  text-align: left;
  caret-color: var(--d2t-accent);
  appearance: none;
}
#dis2tract .d2t-field :is(input, textarea)::placeholder { color: var(--d2t-card-muted); opacity: 1; }

/* quick links: plain underlined links; the underline darkens on hover */
#dis2tract nav { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px 20px; margin: 18px 0 0; }
#dis2tract nav a {
  border-radius: 4px;
  color: var(--d2t-fg);
  font-size: 15px;
  text-decoration: underline 1px color-mix(in srgb, var(--d2t-fg) 30%, transparent);
  text-underline-offset: 4px;
  white-space: nowrap;
}

/* the unlock: a quiet gray pill at the bottom, like screen time's "ignore limit" */
#dis2tract .d2t-unlock { flex: none; width: 100%; max-width: 460px; margin-top: 32px; }
#dis2tract .d2t-unlock p { margin: 0 auto 14px; font-size: 15px; }
#dis2tract .d2t-unlock button + button { margin-left: 10px; }
/* the porn page's clip, between the quote and the better thing to do. a set height, not a max: firefox lays a video
   out at 300x150 until its size is known, and in the centered card a clip growing then would move the quote above
   it. only the width follows the clip. the address that set the page off breaks anywhere: it has no spaces */
#dis2tract video.d2t-clip { display: block; max-width: 100%; height: min(40vh, 440px); margin: 0 auto 24px; border-radius: 22px; background: #000; }
#dis2tract .d2t-unlock p.d2t-sub { overflow-wrap: anywhere; }
/* min-height, no vertical padding: a label that wraps (a narrow phone at the largest system font size, desktop's
   zoom text only) grows the pill instead of spilling out of it, while two lines still fit a phone's 44px pill
   unchanged. the transparent border is drawn in forced colors (windows contrast themes), which turn the pill's
   background into the page color */
#dis2tract button {
  min-height: 36px;
  margin: 0;
  padding: 0 16px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: color-mix(in srgb, var(--d2t-fg) 8%, transparent);
  color: var(--d2t-fg);
  font-size: 14px;
  cursor: pointer;
}
/* the mirror: the other apps just before, pinned to the top so the block stays centered */
#dis2tract p.d2t-mirror {
  position: absolute;
  top: max(16px, env(safe-area-inset-top, 0px));
  right: 16px;
  left: 16px;
  width: fit-content;
  max-width: 560px;
  margin: 0 auto;
  padding: 8px 16px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--d2t-accent) 14%, transparent);
  color: var(--d2t-fg);
  font-size: 14px;
}
/* on a short screen there is no free band at the top, so it joins the flow instead of covering the title */
@media (max-height: 640px) {
  #dis2tract p.d2t-mirror { position: static; margin: 0 auto 16px; border-radius: 14px; }
}
#dis2tract p.d2t-sub { max-width: none; }
#dis2tract p.d2t-sub span { display: block; }
#dis2tract p.d2t-idea { max-width: none; margin: 0; font-size: 17px; color: var(--d2t-fg); }
#dis2tract p.d2t-idea a { color: inherit; text-decoration: underline 1px color-mix(in srgb, currentColor 40%, transparent); text-underline-offset: 3px; }
#dis2tract .d2t-unlock p.d2t-small { margin: 10px auto 0; font-size: 13px; }
/* the answer to a question: the one thing to do now, in a card of its own. its slot is reserved, two lines tall:
   it stays empty until storage answers, so filling it in moves nothing above */
#dis2tract .d2t-answer {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: center;
  justify-content: center;
  min-height: calc(2 * 1.47em + 28px);
  margin-top: 24px;
  padding: 14px 18px;
  border-radius: 16px;
  transition: background-color 0.3s var(--d2t-ease);
}
#dis2tract .d2t-answer:not(:empty) { background: color-mix(in srgb, var(--d2t-accent) 14%, transparent); }

/* a block that appears while browsing fades in, its card rising a little; a page load paints it at once */
#dis2tract[data-enter] { animation: dis2tract-fade 0.35s var(--d2t-ease); }
#dis2tract[data-enter] .d2t-card { animation: dis2tract-rise 0.5s var(--d2t-ease); }

/* the unlock sheet: slides up over a dimmed block screen, which stays where it is */
#dis2tract .d2t-layer {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 16px;
  padding-bottom: max(16px, env(safe-area-inset-bottom, 0px));
  background: rgb(0 0 0 / 0.35);
  animation: dis2tract-fade 0.3s var(--d2t-ease);
}
#dis2tract .d2t-sheet {
  width: 100%;
  max-width: 460px;
  max-height: 100%;
  overflow-y: auto;
  padding: 22px 20px 16px;
  /* invisible here; forced colors drop the shadow, the sheet's only edge, and draw this border in the system color */
  border: 2px solid transparent;
  border-radius: 22px;
  background: var(--d2t-card);
  color: var(--d2t-card-fg);
  box-shadow: 0 12px 48px rgb(0 0 0 / 0.3);
  animation: dis2tract-rise 0.35s var(--d2t-ease);
}
#dis2tract .d2t-sheet p { margin: 0 auto 12px; font-size: 15px; color: var(--d2t-card-muted); }
#dis2tract .d2t-sheet p.d2t-sentence,
#dis2tract .d2t-sheet .d2t-field { background: color-mix(in srgb, var(--d2t-card-fg) 6%, var(--d2t-card)); }
/* closing plays the opening backwards; content.js removes the layer when it is done */
#dis2tract .d2t-layer[data-closing] { pointer-events: none; animation: dis2tract-fade-out 0.25s var(--d2t-ease) forwards; }
#dis2tract .d2t-layer[data-closing] .d2t-sheet { animation: dis2tract-sink 0.25s var(--d2t-ease) forwards; }
@keyframes dis2tract-fade { from { opacity: 0; } }
@keyframes dis2tract-rise { from { opacity: 0; transform: translateY(24px); } }
@keyframes dis2tract-fade-out { to { opacity: 0; } }
@keyframes dis2tract-sink { to { opacity: 0; transform: translateY(24px); } }
#dis2tract p.d2t-ask { max-width: none; margin: 0; color: var(--d2t-fg); font-size: 15px; font-weight: 600; }
/* never mind: the way out on every step of the sheet, full width like the cancel of an ios sheet, quiet like
   the unlock button that opened it */
#dis2tract button.d2t-back {
  width: 100%;
  min-height: 48px;
  margin-top: 16px;
  background: color-mix(in srgb, var(--d2t-card-fg) 6%, var(--d2t-card));
  color: var(--d2t-card-fg);
  font-size: 16px;
  font-weight: 600;
}
#dis2tract button.d2t-back:active { transform: scale(0.98); } /* a wide button presses in less */
#dis2tract p.d2t-sentence {
  max-width: none;
  padding: 14px 18px;
  border-radius: 16px;
  background: var(--d2t-card);
  color: var(--d2t-card-fg);
  font-size: 17px;
  line-height: 1.5;
  overflow-wrap: anywhere; /* a long link in the user's note would otherwise widen the sheet sideways */
  user-select: none;
}

#dis2tract nav a,
#dis2tract p.d2t-idea a,
#dis2tract button {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--d2t-accent) 0%, transparent);
  transition: background-color 0.3s var(--d2t-ease), text-decoration-color 0.3s var(--d2t-ease), transform 0.2s var(--d2t-ease), box-shadow 0.35s var(--d2t-ease);
}
@media (hover: hover) {
  #dis2tract .d2t-field:hover:not(:focus-within) { border-color: var(--d2t-line-strong); }
  #dis2tract nav a:hover,
  #dis2tract p.d2t-idea a:hover { text-decoration-color: currentColor; }
  #dis2tract button:hover { background: color-mix(in srgb, var(--d2t-fg) 14%, transparent); }
}
#dis2tract button:active { transform: scale(0.96); }
/* keyboard focus only: a solid accent outline, which keeps 3:1 against the page where a tinted glow does not
   (background.js takes a theme's accent only at 3:1 against the page and the card) */
#dis2tract nav a:focus-visible,
#dis2tract p.d2t-idea a:focus-visible,
#dis2tract button:focus-visible { outline: 2px solid var(--d2t-accent); outline-offset: 2px; }

@media (max-width: 480px) {
  #dis2tract h2 { font-size: 28px; }
  /* 38-character lines stay on one line at phone width, at the default text size: a larger system font size
     wraps them, as it should */
  #dis2tract .d2t-answer { padding-inline: 12px; }
  #dis2tract .d2t-answer p { font-size: 16px; }
}
/* android's largest display size can make a phone 320px wide (aosp DisplayDensityUtils, 2026-10). the answer then
   has 256px where the widest 38-character line needs 268px at 16px (roboto), and the feed sentence 280px where the
   longest needs 303px at 17px: smaller type and padding keep both on one line */
@media (max-width: 359px) {
  #dis2tract .d2t-answer { padding-inline: 4px; }
  #dis2tract .d2t-answer p,
  #dis2tract p.d2t-sub { font-size: 15px; }
}
@media (pointer: coarse) {
  #dis2tract button { min-height: 44px; padding: 0 20px; }
}
/* reduced motion stops movement only; color and glow fades stay, they are not motion */
@media (prefers-reduced-motion: reduce) {
  #dis2tract button:active,
  #dis2tract button.d2t-back:active { transform: none; }
  #dis2tract[data-enter] .d2t-card { animation-name: dis2tract-fade; }
  #dis2tract .d2t-sheet { animation-name: dis2tract-fade; } /* fades in and out, no slide */
  #dis2tract .d2t-layer[data-closing] .d2t-sheet { animation-name: dis2tract-fade-out; }
}
`;
