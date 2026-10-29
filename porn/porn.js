// where porn sites lead (background.js sends the tab here before the site loads). the block screen's own parts
// (src/ui.js), look (css/overlay.css) and theme colors, with a quote that stings, one of two clips, and one
// better thing to do. the words live in src/suggestions.js
const clip = h('video', { class: 'd2t-clip', loop: '', playsinline: '' });
const back = h('button', { type: 'button', onclick: () => history.back() }, 'go back');
back.hidden = history.length < 2; // opened in a new tab: there is nothing to go back to
const close = h('button', { type: 'button', onclick: async () => browser.tabs.remove((await browser.tabs.getCurrent()).id) }, 'close the tab');
const screen = h('div', { id: 'dis2tract', role: 'main', 'aria-labelledby': 'dis2tract-title', 'data-enter': '' },
  h('div', { class: 'd2t-card' },
    h('h2', { id: 'dis2tract-title' }, 'no porn'),
    sub(pick(SHAME)),
    clip,
    answer(lateNight() ? URGE_LATE : pick(URGES))),
  h('div', { class: 'd2t-unlock' }, back, close));
// synchronous, so the first paint already has the theme
paint(screen, browser.extension.getBackgroundPage()?.theme);
document.body.append(screen);

// with sound if firefox allows it here. a fresh tab often has had no click yet, and then sound is refused: the
// clip plays muted with its controls showing, so one tap brings the sound
clip.src = pick(['abah.mp4', 'laugh.mp4']);
clip.play().catch(() => {
  clip.muted = true;
  clip.controls = true;
  clip.play();
});
