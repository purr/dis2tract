// where porn sites lead (background.js sends the tab here, before the site loads where it can). the block screen's
// own parts (src/ui.js), look (css/overlay.css) and theme colors, with a quote that stings, one of two clips, one
// better thing to do, and what set it off. the words live in src/suggestions.js
// vp9 and opus, which every firefox decodes with its own bundled code (media/ffvpx/libavcodec/codec_list.c,
// 2026-10). firefox leaves h.264 and aac to the os, and windows n without the media feature pack or a linux without
// system ffmpeg has no decoder for them: no picture, no sound
const CLIPS = ['abah.webm', 'laugh.webm'];
// why the tab is here (background.js): ?host= the listed site, or ?mark= the platform that marked it adult itself.
// skip: the page that set it off still sits right behind this one (android cannot replace it), and going back
// there would only send the tab here again
const query = new URLSearchParams(location.search);
const mark = query.get('mark');
const why = query.has('host') ? [query.get('host'), LISTED] : Object.hasOwn(MARKED, mark) ? MARKED[mark] : null;
const steps = query.has('skip') ? 2 : 1;
// controls from the start: firefox lets extension pages play sound without a click, so the clip starts with
// sound, and they are the page's only way to pause or mute it
const clip = h('video', { class: 'd2t-clip', loop: '', playsinline: '', controls: '' });
const back = h('button', { type: 'button', onclick: () => history.go(-steps) }, 'go back');
back.hidden = history.length <= steps; // a new tab, or only the page that set it off behind this one
const close = h('button', { type: 'button', onclick: async () => browser.tabs.remove((await browser.tabs.getCurrent()).id) }, 'close the tab');
const screen = h('div', { id: 'dis2tract', role: 'main', 'aria-labelledby': 'dis2tract-title', 'data-enter': '' },
  h('div', { class: 'd2t-card' },
    h('h2', { id: 'dis2tract-title' }, 'no porn'),
    sub(pick(SHAME)),
    clip,
    answer(lateNight() ? URGE_LATE : pick(URGES))),
  h('div', { class: 'd2t-unlock' }, ...(why ? [sub(why)] : []), back, close));
// the firefox theme's colors, synchronous so the first paint already has them. a private window gets no
// background page (getBackgroundPage() is null there, bug 1329304): storage fills them in a moment later.
// storage also carries every later change, as on the block screen
const repaint = (theme) => {
  screen.removeAttribute('style'); // paint() only sets: a theme with fewer colors must not keep the old ones
  paint(screen, theme);
};
const background = browser.extension.getBackgroundPage();
repaint(background?.theme);
if (!background) browser.storage.local.get('theme').then(({ theme }) => repaint(theme));
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.theme) repaint(changes.theme.newValue);
});
document.body.append(screen);

// with sound: firefox lets extension pages play without a click (AutoplayPolicy.cpp: an extension document passes
// media.autoplay.allow-extension-background-pages, on by default, 2026-10). muted is the fallback for a firefox
// set to refuse even that. with reduced motion the clip waits for its play button. a tab sent here while hidden (the
// check of the open tabs, a background tab's label hit) starts it once shown: out of sight it would sound from
// nowhere, and on android stop the audio another tab plays (one tab sounds at a time there)
clip.src = pick(CLIPS);
const start = () => clip.play().catch(() => {
  clip.muted = true;
  clip.play();
});
if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
  if (document.visibilityState === 'visible') start();
  else document.addEventListener('visibilitychange', start, { once: true });
}
