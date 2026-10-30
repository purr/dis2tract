// mirrors the firefox theme into the block screen and the settings page; content scripts cannot read the theme.
// storage answers only after a page's first paint, so the colors also go out as a registered stylesheet that
// firefox injects at document_start, like the manifest css. a registration dies with the page that made it,
// hence the persistent background. firefox for android has no theme api: there the default palette stays.
// a theme's pairs are meant to contrast, but nothing checks it (firefox color's own default preset is white on light
// blue, 2.2:1), so each pair is checked as the pages draw it, and taken whole or not at all
const PAGE = [['--d2t-bg', 'frame'], ['--d2t-fg', 'tab_background_text']];
const FIELD = [['--d2t-card', 'toolbar_field'], ['--d2t-card-fg', 'toolbar_field_text']];
const ACCENT = ['toolbar_field_border_focus', 'tab_line']; // the theme's own focus ring color, else its tab accent
const MATCHES = browser.runtime.getManifest().content_scripts.flatMap((cs) => cs.matches);

// theme colors are css strings in any syntax firefox knows, or [r, g, b(, a)] arrays. a canvas reads a color back
// as #rrggbb or rgba(r, g, b, a) and keeps its old one for anything that is not a plain color, var() included
// (firefox source, CanvasRenderingContext2D::SetStyleFromString and StyleColorToString, 2026-10). only these
// numbers go on: the values land in a stylesheet on the blocked sites, where a crafted string passed on as is
// could add rules or, through var(), load a url
const canvas = document.createElement('canvas').getContext('2d');
function rgba(c) {
  const v = Array.isArray(c) ? `rgb(${c.slice(0, 3).join(' ')}${c.length > 3 ? ` / ${c[3]}` : ''})` : c;
  if (typeof v !== 'string') return null;
  const read = (old) => {
    canvas.fillStyle = old;
    canvas.fillStyle = v;
    return canvas.fillStyle;
  };
  const s = read('#000000');
  if (s !== read('#ffffff')) return null; // not a color: each read kept the old one
  return s.startsWith('#') ? [...s.slice(1).match(/../g).map((x) => parseInt(x, 16)), 1] : s.match(/[\d.]+/g).map(Number);
}
// css blends in srgb: a translucent color as it shows over an opaque one (rounded, as it is passed on), and
// color-mix(in srgb, c share, under)
const over = ([r, g, b, a], under) => [r, g, b].map((x, i) => Math.round(x * a + under[i] * (1 - a)));
const mix = (c, under, share) => c.map((x, i) => x * share + under[i] * (1 - share));
// wcag 2 relative luminance and contrast ratio
const luminance = (c) => c.reduce((sum, x, i) => {
  const s = x / 255;
  return sum + [0.2126, 0.7152, 0.0722][i] * (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4);
}, 0);
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const hex = (c) => `#${c.map((x) => x.toString(16).padStart(2, '0')).join('')}`;

var theme = {}; // var: the options page reads it synchronously through getBackgroundPage(), before its first paint
let registered = null;

async function syncTheme() {
  const { colors } = await browser.theme.getCurrent();
  // a pair as the pages draw it, or null: the page opaque (overlay.css drops its alpha), a field over the page,
  // text over its background. readable: the 70% muted mix of the text (overlay.css) keeps 4.5:1 for small text
  const pair = ([[, back], [, text]], under) => {
    const [b, t] = [rgba(colors?.[back]), rgba(colors?.[text])];
    if (!b || !t) return null;
    const bg = under ? over(b, under) : b.slice(0, 3);
    const fg = over(t, bg);
    return contrast(mix(fg, bg, 0.7), bg) >= 4.5 ? [bg, fg] : null;
  };
  const next = {};
  const page = pair(PAGE);
  if (page) {
    // fields fall back to the page pair: the stylesheet's white default field would be unreadable on a dark theme.
    // a translucent field is taken as it shows over the page, so the unlock sheet hides the block screen under it
    const field = pair(FIELD, page[0]) ?? page;
    // focus rings and the caret sit on the page and in fields: 3:1 against both (wcag 1.4.11). the default accent
    // is no safe fallback on a themed page, so a text color stands in, or between a dark page and a light field
    // (where each text color vanishes on the other) the gray as far in contrast from both
    const y = Math.sqrt((luminance(page[0]) + 0.05) * (luminance(field[0]) + 0.05)) - 0.05;
    const gray = Array(3).fill(Math.round(255 * (y <= 0.0031308 ? 12.92 * y : 1.055 * y ** (1 / 2.4) - 0.055)));
    const accent = [...ACCENT.map((key) => rgba(colors?.[key])).filter(Boolean).map((c) => over(c, page[0])), page[1], field[1], gray]
      .find((c) => contrast(c, page[0]) >= 3 && contrast(c, field[0]) >= 3) ?? page[1];
    PAGE.forEach(([name], i) => (next[name] = hex(page[i])));
    FIELD.forEach(([name], i) => (next[name] = hex(field[i])));
    next['--d2t-accent'] = hex(accent);
  }
  theme = next;
  await registered?.unregister();
  registered = null;
  const decls = Object.entries(next).map(([k, v]) => `${k}: ${v};`).join(' ');
  // firefox takes an injected sheet out of a page only when the page goes (ExtensionContent.sys.mjs, 2026-10), not
  // on unregister(), so a page loaded under an older theme keeps this one. it therefore covers only the first paint:
  // content.js marks the overlay data-live once it paints the stored theme, and keys a newer theme lacks fall back
  // to the overlay.css defaults. still outranks those defaults whatever the injection order
  if (decls) registered = await browser.contentScripts.register({ matches: MATCHES, css: [{ code: `html #dis2tract:not([data-live]) { ${decls} }` }], runAt: 'document_start' });
  await browser.storage.local.set({ theme: next }); // pages already open restyle from this
}

browser.browserAction.onClicked.addListener(() => browser.runtime.openOptionsPage());
// firefox for android differs twice here. it lets one tab sound at a time and counts this page as a tab
// (media.audioFocus.management, on only there), so the bell would stop audio playing in other tabs, and nothing
// there tells whether one is. and its tabs.update has no loadReplace: its schema rejects the property, and with
// it the whole call (mobile/shared/components/extensions/schemas/tabs.json, 2026-10)
const android = browser.runtime.getPlatformInfo().then(({ os }) => os === 'android');
// the 6 am bell from five nights at freddy's, when a content script reports a block appearing. played here, not
// in the page: a page could learn the moz-extension url, whose id is random per browser and so a tracking handle.
// extension pages may sound without a click (media.autoplay.allow-extension-background-pages, on by default).
// a muted tab stays quiet: its mute silences its own media only, never this page, where the bell plays
async function chime(tab) {
  if (!tab?.mutedInfo?.muted && !(await android)) new Audio(browser.runtime.getURL('sounds/chime.mp3')).play();
}
browser.runtime.onMessage.addListener((message, sender) => {
  if (message === 'chime') chime(sender.tab);
  else if (message === 'use') countUse();
  else if (message?.trail) privateTrails.set(message.trail, message.value);
  else if (message?.getTrail) return Promise.resolve(privateTrails.get(message.getTrail) ?? null);
});
// a private window's run of items (trail:<site> in content.js) lives here, in memory only: storage.local is on disk
// for good, and what was watched in a private window must not outlive it
const privateTrails = new Map();
// time on the social sites per day. every tab with one of their pages in use and no block screen up says so on
// each look (track() in content.js), and the time between two notes from any tabs counts when they are under 2 s
// apart: two windows in use side by side count once, and a sleeping machine or a clock set back adds nothing.
// one writer, so two tabs never overwrite each other's time; saved within 5 s, not on every note
let usedAt = 0; // the last note, from any tab
let unsaved = 0; // counted, not in storage yet
let usageQueue = Promise.resolve();
function countUse() {
  const now = Date.now();
  const gap = now - usedAt;
  usedAt = now;
  if (gap <= 0 || gap >= 2000) return;
  if (!unsaved) setTimeout(saveUsage, 5000);
  unsaved += gap;
}
function saveUsage() {
  const ms = unsaved;
  unsaved = 0;
  usageQueue = usageQueue.then(async () => {
    const { usage } = await browser.storage.local.get('usage');
    const now = Date.now();
    const before = usage && new Date(usage.at).toDateString() === new Date(now).toDateString() ? usage.ms : 0;
    await browser.storage.local.set({ usage: { at: now, ms: before + ms } });
  }).catch((e) => console.error('dis2tract: time on social media not saved', e));
}
// porn sites: no feed rules, no unlock. the tab leaves for the extension's own page before the site loads.
// the list is oisd's nsfw small: the nsfw sites among the top million domains, porn, adult, shock and gore alike
// (oisd.nl, 2026-10). it does not say which is which, so every one of them gets the porn page. downloaded here,
// not kept in the repo: it stays current, and no hand-picked list of sites is published; it is gpl, and this way
// it is never redistributed. fetched once a day; the last good copy stays in storage, so an offline start still
// blocks. the manifest grants raw.githubusercontent.com for this download alone: without it the fetch is a cors
// request, which firefox sends with Origin: moz-extension://<this install's id>, the same handle on the user
// every day (bug 1405971; firefox's test_ext_secfetch.js, 2026-10). an anonymous xhr (mozAnon) sends it too: it
// only leaves out cookies (XMLHttpRequestMainThread.cpp, nsCORSListenerProxy.cpp, 2026-10)
const PORN_LIST = 'https://raw.githubusercontent.com/sjhgvr/oisd/main/domainswild2_nsfw_small.txt';
// the adult top-level domains, which the list also names whole. kept here rather than taken from the download:
// a single word from a download (a broken line saying "com") would block the whole web
const ADULT_TLDS = ['xxx', 'porn', 'sex', 'adult'];
// list entries that are not porn sites, and porn has no unlock or switch: web fiction platforms (17k.com,
// zongheng.com), sofia's public transport (sofiatraffic.bg), the preview addresses of hosting tools (sslip.io:
// coolify; cpanel.site: cpanel), and public suffixes, which would block every site registered under them (co.cz,
// in.net, mex.com; publicsuffix.org). all on the list on 2026-10-30
const NOT_PORN = ['17k.com', 'zongheng.com', 'sofiatraffic.bg', 'sslip.io', 'cpanel.site', 'co.cz', 'in.net', 'mex.com'];
const DAY = 86_400_000;
// the download and the stored copy both go through here, so an exception holds from the first start after an update
const pornSet = (domains) => new Set([...ADULT_TLDS, ...domains.filter((d) => !NOT_PORN.includes(d))]);
let porn = pornSet([]);
let pornAt = 0;

async function updatePorn() {
  if (Date.now() - pornAt < DAY) return;
  // no cookies: with the host permission the download counts as the extension's own, which would send them
  const response = await fetch(PORN_LIST, { cache: 'no-store', credentials: 'omit' });
  if (!response.ok) throw new Error(`http ${response.status}`);
  // one domain per line, each covering its subdomains; comments start with #
  const domains = (await response.text()).split('\n').map((line) => line.trim()).filter((line) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(line));
  // a cut-off or changed download must not replace a good list
  if (domains.length < 1000) throw new Error(`only ${domains.length} domains in the download`);
  porn = pornSet(domains);
  pornAt = Date.now();
  recheck(); // sites the update added
  await browser.storage.local.set({ pornList: { at: pornAt, domains } });
}

// the host or any domain above it: www.example.com is caught by example.com
const isPorn = (host) => host.split('.').some((_, i, parts) => porn.has(parts.slice(i).join('.')));
// google translate's website proxy shows any site under a host of its own: www-example-com.translate.goog ('.'
// made '-', '-' doubled), the start of a long name moved into _x_tr_hp. decoded as google documents it
// (developers.google.com/search/docs/appearance/ad-network-and-translation, 2026-10), for the list check only:
// the address itself stays as it is
function untranslated(u, host) {
  if (!host.endsWith('.translate.goog')) return host;
  const enc = u.searchParams.get('_x_tr_enc')?.split(',') ?? [];
  let name = ((u.searchParams.get('_x_tr_hp') ?? '') + host.slice(0, -'.translate.goog'.length)).toLowerCase();
  if (enc.includes('1') && name.startsWith('1-')) name = name.slice(2);
  const idn = enc.includes('0') && name.startsWith('0-'); // an internationalized name, its xn-- dropped
  if (idn) name = name.slice(2);
  return (idn ? 'xn--' : '') + name.replace(/\b-\b/g, '.').replaceAll('--', '-');
}
// the porn page, told why the tab is there: ?host= the listed site, or ?mark= the platform (x, reddit, bluesky)
// that marked what the page loaded as adult itself. a page caught after it committed has a history entry of its
// own, and going back to it would load it and send the tab here again: that entry is replaced, or, where
// tabs.update cannot replace (android), the porn page is told to step over it
async function toPorn(tabId, why, committed) {
  const url = browser.runtime.getURL(`porn/porn.html?${new URLSearchParams(why)}`);
  if (!committed) return browser.tabs.update(tabId, { url });
  if (await android) return browser.tabs.update(tabId, { url: `${url}&skip` });
  return browser.tabs.update(tabId, { url, loadReplace: true });
}
// every top-level navigation, before it loads and again once it commits: a redirect (a link shortener, an alias
// domain) shows its real address only then. a frame (reddit's redgifs players) counts once it commits: firefox
// reports a frame's onBeforeNavigate before a blocker (ublock origin, tracking protection) can cancel its request,
// and a cancelled frame shows nothing (WebNavigation.sys.mjs, DocumentChannelChild.cpp, 2026-10).
// returns what it did, if anything
function guard({ frameId, tabId, url }, committed) {
  const u = new URL(url);
  // a trailing dot ("tiktok.com.") is the same site to its server but matches no content script or rule here, so
  // a tab on one of the sites goes to the address without it. other sites keep theirs: there it is a way to shed
  // a site's cookies, or to keep a short intranet name from being completed
  const host = u.hostname.replace(/\.+$/, '');
  const named = untranslated(u, host);
  if (isPorn(named)) return toPorn(tabId, { host: named }, committed);
  if (frameId === 0 && host !== u.hostname && onSites(host)) {
    u.hostname = host;
    return browser.tabs.update(tabId, { url: u.href });
  }
}
browser.webNavigation.onBeforeNavigate.addListener((details) => details.frameId === 0 && guard(details, false));
browser.webNavigation.onCommitted.addListener((details) => guard(details, true));
// navigations made before this page ran sent no event, and nothing queues them: at app startup firefox starts a
// persistent background page only after session restore, after android reclaimed the extension process only
// once firefox is back on screen (ext-backgroundPage.js; webNavigation is not startup-blocking, ext-toolkit.json;
// 2026-10). an install or enable finds tabs already open, and a list update adds sites. so the open tabs are
// checked whenever the list is (re)loaded
function recheck() {
  browser.tabs.query({}).then(async (tabs) => {
    for (const { id } of tabs) {
      // null for a discarded tab, checked when it loads; a tab closed since the query rejects: nothing left there
      const frames = await browser.webNavigation.getAllFrames({ tabId: id }).catch(() => null);
      // the first hit sends the tab away. a frame that has shown nothing yet has no url (currentURI?.spec,
      // WebNavigationFrames.sys.mjs), and new URL() of nothing would end the check of every tab after it
      frames?.some((frame) => frame.url && guard({ ...frame, tabId: id }, true));
    }
  }).catch((e) => console.error('dis2tract: open tabs not checked', e));
}

// sites with porn among everything else mark it in the data they load: x flags media "adult_content" (apart from
// graphic_violence), reddit tags posts nsfw (new reddit's shreddit elements) or over18 (old reddit), bluesky labels
// posts and accounts porn, sexual or nudity. those answers are read on their way to the page (passed on untouched)
// and a tab that loaded any such content goes to the porn page: no word lists, so any language and any slang
const LABELED = [
  { urls: ['*://x.com/i/api/graphql/*'], types: ['xmlhttprequest'], adult: /"adult_content":\s*true/ },
  { urls: ['*://*.reddit.com/*'], types: ['main_frame', 'xmlhttprequest'], adult: /<shreddit-[\w-]+\s[^>]*\bnsfw[\s=>]|class="[^"]*\bover18\b/ },
  { urls: ['*://*.bsky.network/xrpc/*', '*://public.api.bsky.app/xrpc/*'], types: ['xmlhttprequest'], adult: /"val":"(porn|sexual|nudity)"/ },
];
for (const { urls, types, adult } of LABELED) {
  browser.webRequest.onBeforeRequest.addListener(({ requestId, tabId }) => {
    if (tabId < 0) return; // a request of no tab (a service worker): no page to send anywhere
    const filter = browser.webRequest.filterResponseData(requestId);
    const decoder = new TextDecoder();
    let text = '';
    filter.ondata = ({ data }) => {
      filter.write(data); // first, so the page gets its data whatever happens below
      text += decoder.decode(data, { stream: true });
    };
    filter.onstop = () => {
      filter.close();
      if (adult.test(text + decoder.decode())) browser.tabs.update(tabId, { url: browser.runtime.getURL('porn/porn.html') });
    };
  }, { urls, types }, ['blocking']);
}

// single-page sites change the address through the history api, and content.js only looks every 400 ms: a feed
// address passed through faster (instagram's reels tab jumping to a reel) is reported to the tab right away
const HOSTS = MATCHES.map((m) => /^\*:\/\/(\*\.)?([^/]+)\//.exec(m)).map(([, any, host]) => (any ? { hostSuffix: `.${host}` } : { hostEquals: host }));
// a host the content scripts run on, as the manifest's patterns match it (*.reddit.com takes reddit.com too)
const onSites = (host) => HOSTS.some(({ hostEquals, hostSuffix }) => host === hostEquals || (hostSuffix !== undefined && `.${host}`.endsWith(hostSuffix)));
browser.webNavigation.onHistoryStateUpdated.addListener(({ frameId, tabId, url }) => {
  // a tab whose content script has not started yet has no listener; it reads the address itself when it starts
  if (frameId === 0) browser.tabs.sendMessage(tabId, { url }, { frameId: 0 }).catch(() => {});
}, { url: HOSTS });
browser.storage.local.get('pornList').then(({ pornList }) => {
  if (pornList) [porn, pornAt] = [pornSet(pornList.domains), pornList.at];
  recheck();
  const update = () => updatePorn().catch((e) => console.error('dis2tract: porn list update failed, the last copy stays', e));
  update();
  setInterval(update, 60 * 60_000); // checked hourly, fetched once it is a day old
});
// opens after the extension is removed, on desktop only: firefox for android keeps the address and never opens it
// (bug 1461882, 2026-10). someone else's page until dis2tract has its own. only this bare url goes out, never the
// user's note or stats.
browser.runtime.setUninstallURL('https://www.npr.org/2026/04/07/nx-s1-5775917/why-infinite-scrolls-inventor-wants-to-kill-his-creation');

if (browser.theme) {
  // one sync at a time: two quick theme switches must not interleave unregister and register
  let queue = Promise.resolve();
  const sync = () => (queue = queue.then(syncTheme).catch((e) => console.error('dis2tract: theme sync failed', e)));
  sync();
  browser.theme.onUpdated.addListener(sync);
}
