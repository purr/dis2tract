// mirrors the firefox theme into the block screen and the settings page; content scripts cannot read the theme.
// storage answers only after a page's first paint, so the colors also go out as a registered stylesheet that
// firefox injects at document_start, like the manifest css. a registration dies with the page that made it,
// hence the persistent background. firefox for android has no theme api: there the default palette stays.
// each pair is designed by the theme to contrast, so a pair is taken whole or not at all
const PAGE = [['--d2t-bg', 'frame'], ['--d2t-fg', 'tab_background_text']];
const FIELD = [['--d2t-card', 'toolbar_field'], ['--d2t-card-fg', 'toolbar_field_text']];
const ACCENT = ['toolbar_field_border_focus', 'tab_line']; // the theme's own focus ring color, else its tab accent
const MATCHES = browser.runtime.getManifest().content_scripts.flatMap((cs) => cs.matches);

// theme colors are css strings or [r, g, b(, a)] arrays. anything that is not a plain color is dropped: the values
// land in a stylesheet on four big sites, and a crafted value could otherwise smuggle in css rules.
function color(c) {
  const v = Array.isArray(c) ? `rgb(${c.slice(0, 3).join(' ')}${c.length > 3 ? ` / ${c[3]}` : ''})` : c;
  return typeof v === 'string' && !/[;{}]/.test(v) && CSS.supports('color', v) ? v : null;
}

var theme = {}; // var: the options page reads it synchronously through getBackgroundPage(), before its first paint
let registered = null;

async function syncTheme() {
  const { colors } = await browser.theme.getCurrent();
  const pick = (pair) => {
    const values = pair.map(([, key]) => color(colors?.[key]));
    return values.every(Boolean) ? values : null;
  };
  const next = {};
  const page = pick(PAGE);
  if (page) {
    // fields fall back to the page pair: the stylesheet's white default field would be unreadable on a dark theme
    const field = pick(FIELD) ?? page;
    PAGE.forEach(([name], i) => (next[name] = page[i]));
    FIELD.forEach(([name], i) => (next[name] = field[i]));
    const accent = ACCENT.map((key) => color(colors?.[key])).find(Boolean);
    if (accent) next['--d2t-accent'] = accent;
  }
  theme = next;
  await registered?.unregister();
  registered = null;
  const decls = Object.entries(next).map(([k, v]) => `${k}: ${v};`).join(' ');
  // html #dis2tract outranks the #dis2tract defaults in overlay.css whatever the injection order
  if (decls) registered = await browser.contentScripts.register({ matches: MATCHES, css: [{ code: `html #dis2tract { ${decls} }` }], runAt: 'document_start' });
  await browser.storage.local.set({ theme: next }); // pages already open restyle from this
}

browser.browserAction.onClicked.addListener(() => browser.runtime.openOptionsPage());
// the 6 am bell from five nights at freddy's, when a content script reports a block appearing. played here, not
// in the page: a page could learn the moz-extension url, whose id is random per browser and so a tracking handle.
// extension pages may sound without a click (media.autoplay.allow-extension-background-pages, on by default)
browser.runtime.onMessage.addListener((message) => {
  if (message === 'chime') new Audio(browser.runtime.getURL('sounds/chime.mp3')).play();
});
// opens after the extension is removed: someone else's page until dis2tract has its own. only this bare url
// goes out, never the user's note or stats.
browser.runtime.setUninstallURL('https://www.npr.org/2026/04/07/nx-s1-5775917/why-infinite-scrolls-inventor-wants-to-kill-his-creation');

if (browser.theme) {
  // one sync at a time: two quick theme switches must not interleave unregister and register
  let queue = Promise.resolve();
  const sync = () => (queue = queue.then(syncTheme).catch((e) => console.error('dis2tract: theme sync failed', e)));
  sync();
  browser.theme.onUpdated.addListener(sync);
}
