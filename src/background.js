// mirrors the firefox theme into the block screen and the settings page; content scripts cannot read the theme.
// storage answers only after a page's first paint, so the colors also go out as a registered stylesheet that
// firefox injects at document_start, like the manifest css. a registration dies with the page that made it,
// hence the persistent background. firefox for android has no theme api: there the default palette stays.
// a theme's pairs are meant to contrast, but nothing checks it (firefox color's own default preset is white on light
// blue, 2.2:1), so each pair is checked as the pages draw it. a theme's backgrounds are always kept: dropping a pair
// over its text threw out the colors of every mid-tone theme, for the default palette, with no word why
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
  // a pair as the pages draw it, or null without a background: the page opaque (overlay.css drops its alpha), a field
  // over the page, text over its background. text under 4.5:1, or none, gives way to black or white: the better of
  // the two reaches 4.58:1 on any background
  const pair = ([[, back], [, text]], under) => {
    const [b, t] = [rgba(colors?.[back]), rgba(colors?.[text])];
    if (!b) return null;
    const bg = under ? over(b, under) : b.slice(0, 3);
    const fg = t && over(t, bg);
    if (fg && contrast(fg, bg) >= 4.5) return [bg, fg];
    return [bg, contrast([0, 0, 0], bg) > contrast([255, 255, 255], bg) ? [0, 0, 0] : [255, 255, 255]];
  };
  // how much of the text the muted color (overlay.css, options.css) needs to keep 4.5:1 for small text: 70% of it
  // where that reads, the look the default palette has, else as little more as it takes
  const mute = ([bg, fg]) => `${[70, 75, 80, 85, 90, 95, 100].find((share) => contrast(mix(fg, bg, share / 100), bg) >= 4.5)}%`;
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
    next['--d2t-mute'] = mute(page);
    next['--d2t-card-mute'] = mute(field);
  }
  theme = next;
  await registered?.unregister();
  registered = null;
  const decls = Object.entries(next).map(([k, v]) => `${k}: ${v};`).join(' ');
  // firefox takes an injected sheet out of a page only when the page goes (ExtensionContent.sys.mjs, 2026-10), not
  // on unregister(), so a page loaded under an older theme keeps this one. it therefore covers only the first paint:
  // content.js marks the overlay's host data-live once it paints the stored theme, and keys a newer theme lacks fall back
  // to the overlay.css defaults. still outranks those defaults whatever the injection order
  if (decls) registered = await browser.contentScripts.register({ matches: MATCHES, css: [{ code: `html #dis2tract-host:not([data-live]) { ${decls} }` }], runAt: 'document_start' });
  await browser.storage.local.set({ theme: next }); // pages already open restyle from this
}

browser.browserAction.onClicked.addListener(() => browser.runtime.openOptionsPage());
// a new install opens the settings once: the note, the handles, the chime and the private-window warning live there,
// and the toolbar button starts hidden in the extensions panel
browser.runtime.onInstalled.addListener(({ reason }) => reason === 'install' && browser.runtime.openOptionsPage());
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
// the media hosts of listed sites, which the list leaves out: a picture or video opened at its own address (from an
// image search, say). a short list by hand, for hosts that serve nothing else (gallery-dl and yt-dlp's extractors, 2026-10)
const MEDIA_HOSTS = ['phncdn.com', 'highwebmedia.com', 'mmcdn.com', 'xhcdn.com', 'sb-cd.com', 'doppiocdn.com', 'rdtcdn.com', 'ypncdn.com', 't8cdn.com'];
const DAY = 86_400_000;
// the download and the stored copy both go through here, so an exception holds from the first start after an update
const pornSet = (domains) => new Set([...ADULT_TLDS, ...MEDIA_HOSTS, ...domains.filter((d) => !NOT_PORN.includes(d))]);
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
async function toPorn(tabId, why, committed, address) {
  const url = browser.runtime.getURL(`porn/porn.html?${new URLSearchParams(why)}`);
  if (!committed) return browser.tabs.update(tabId, { url });
  if (!(await android)) return browser.tabs.update(tabId, { url, loadReplace: true });
  const page = address ?? (await browser.webNavigation.getFrame({ tabId, frameId: 0 }).catch(() => null))?.url;
  if (page) caught.set(tabId, (caught.get(tabId) ?? new Set()).add(page));
  return browser.tabs.update(tabId, { url: `${url}&skip` });
}
// android: the addresses per tab whose history entry stayed behind the porn page. the system back button lands on one
// (firefox skips it only if the user never touched that page) and it would send the tab forward again, for good. so
// back from the porn page steps over it. coming from anywhere else, it is a new visit
const caught = new Map();
async function stepOver(details) {
  const { tabId } = details;
  const page = await browser.webNavigation.getFrame({ tabId, frameId: 0 }).catch(() => null);
  if (page?.url.startsWith(browser.runtime.getURL('porn/'))) browser.tabs.goBack(tabId);
  else guard(details, false);
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
  if (isPorn(named)) return toPorn(tabId, { host: named }, committed, frameId === 0 ? url : undefined);
  if (frameId === 0 && host !== u.hostname && onSites(host)) {
    u.hostname = host;
    return browser.tabs.update(tabId, { url: u.href });
  }
}
browser.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return;
  if (caught.get(details.tabId)?.has(details.url)) stepOver(details);
  else guard(details, false);
});
browser.webNavigation.onCommitted.addListener((details) => {
  // back that restored the page without a load before it (the back-forward cache)
  const back = details.frameId === 0 && details.transitionQualifiers?.includes('forward_back') && caught.get(details.tabId)?.has(details.url);
  if (back) browser.tabs.goBack(details.tabId);
  else guard(details, true);
});
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
// graphic_violence), reddit tags posts nsfw and the posts of adult communities subreddit-nsfw (one flag for sexual
// and graphic content alike, so the porn page names the site whose mark it was), bluesky labels posts and accounts
// porn, sexual or sexual-figurative (drawn; nudity is non-sexual art, shown by default: atproto labels.json and
// bluesky's labeler definitions, 2026-10). no word lists, so any language and any slang. only the item the tab's
// address names counts, never its neighbours: a stranger marks their own reply, account or post beside it in a list,
// and the sites hide or blur those by default. search, home, notifications and other lists name no item and are not
// judged. a marked answer never reaches the page; the tab goes to the porn page instead
const ADULT_LABELS = ['porn', 'sexual', 'sexual-figurative'];

// a parsed json answer, or null. a cut-off answer is no valid json: firefox fires stop for a cancelled request too
// (StreamFilterChild::RecvStopRequest drops the status), so this is what keeps a request cut off by leaving the page
// from sending the tab anywhere. a site's error page is no json either
function json(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
// whether test holds for an object anywhere in parsed json
const anyObject = (v, test) => Boolean(v) && typeof v === 'object' && (test(v) || Object.values(v).some((x) => anyObject(x, test)));

// x: on a status address the post it names (and the one on screen in the phone's media viewer, ?currentTweet=), on a
// profile and its tabs the profile's own posts in its timelines, the calls that carry variables.userId (x's own pages,
// /home or /search, sit where a handle would and load none). posts are __typename Tweet or the .tweet of a
// TweetWithVisibilityResults, the handle sits in the author's core (earlier in its legacy), and a post it quotes or
// reposts is a post of its own (twscrape's captures of live answers, 2026-10-21; gallery-dl's graphql calls, 2026-04)
function xItem(u) {
  if (u.hostname !== 'x.com') return null;
  const status = /^\/\w+(?:\/web)?\/status\/(\d+)/.exec(u.pathname)?.[1];
  if (status) return { posts: [status, u.searchParams.get('currentTweet')] };
  const handle = /^\/(\w{1,15})(?:\/\w+)?\/?$/.exec(u.pathname)?.[1];
  return handle ? { handle: handle.toLowerCase() } : null;
}
const tweetOf = (v) => (v.__typename === 'TweetWithVisibilityResults' ? v.tweet : v.__typename === 'Tweet' ? v : null);
const handleOf = ({ core }) => (core?.user_results?.result?.core?.screen_name ?? core?.user_results?.result?.legacy?.screen_name)?.toLowerCase();
const flagged = (v, post) => Boolean(v) && typeof v === 'object' && (v === post || !tweetOf(v))
  && (v.adult_content === true || Object.values(v).some((x) => flagged(x, post)));
function xMarked(text, { posts, handle }, request) {
  if (handle && !JSON.parse(new URL(request).searchParams.get('variables'))?.userId) return false;
  return anyObject(json(text), (v) => {
    const post = tweetOf(v);
    return Boolean(post) && (posts ? posts.includes(post.rest_id) : handleOf(post) === handle) && flagged(post, post);
  });
}

// bluesky: the post of /profile/<actor>/post/<rkey> (and its likes, reposts and quotes pages), or on /profile/<actor>
// the profile's own labels and its own posts'. actor is a handle or a did. a post's labels are its self-labels and
// those on its uri, a profile's those on its account and its profile record (atproto bsky views/index.ts, 2026-10)
function blueskyItem(u) {
  if (u.hostname !== 'bsky.app') return null;
  const [, actor, rkey] = /^\/profile\/([^/]+)(?:\/post\/([^/]+)|\/?$)/.exec(u.pathname) ?? [];
  return actor ? { actor: decodeURIComponent(actor).toLowerCase(), rkey } : null;
}
function blueskyMarked(text, { actor, rkey }) {
  const isActor = (p) => typeof p?.did === 'string' && (p.did === actor || p.handle?.toLowerCase() === actor);
  const adult = (v) => Array.isArray(v.labels) && v.labels.some((l) => ADULT_LABELS.includes(l?.val) && !l.neg);
  return anyObject(json(text), (v) => (typeof v.uri === 'string' && v.uri.includes('/app.bsky.feed.post/') && isActor(v.author)
    ? (!rkey || v.uri.endsWith(`/${rkey}`)) && adult(v)
    : !rkey && isActor(v) && adult(v)));
}

// reddit: the post of /comments/<id> (or /gallery/<id>) by its own mark or its community's, a subreddit's other pages
// by its community's. new reddit puts both on the post's tag: nsfw="" (sheddit, checked live 2026-08-18) and
// subreddit-nsfw (xta and surfsense 2026-10-22, mkornreich/old_reddit's probe 2026-10-29); before that a post of an
// adult community carried only nsfw, and the community's own flag sits in <reddit-page-data>, after a listing's posts
// (saved pages, 2024-12 and 2025-08). old reddit's over18 class on a post means its own flag or its subreddit's (r2
// link.py), and its subreddit pages carry no mark of their own
function redditItem(u) {
  if (!/(^|\.)reddit\.com$/.test(u.hostname)) return null;
  const post = /\/comments\/([a-z0-9]+)|^\/gallery\/([a-z0-9]+)/i.exec(u.pathname);
  if (post) return { post: `t3_${(post[1] ?? post[2]).toLowerCase()}` };
  const sub = /^\/r\/(\w+)(?:\/|$)/.exec(u.pathname)?.[1];
  return sub ? { sub: `r/${sub.toLowerCase()}` } : null;
}
// tags are read attribute by attribute, quoted values stepped over whole: titles and community descriptions sit in
// attributes, so their words are never read as a mark (and a > in them ends no tag)
const TAG_START = /<(shreddit-post|reddit-page-data|div)\s/gi;
const TAG_REST = /(?:[^>"']|"[^"]*"|'[^']*')*>/y;
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
// the complete tags in text, and where to read on once more arrives: at a tag still arriving, else near the end
function redditTags(text) {
  const tags = [];
  let end = 0;
  TAG_START.lastIndex = 0;
  for (let m; (m = TAG_START.exec(text)); ) {
    TAG_REST.lastIndex = TAG_START.lastIndex;
    if (!TAG_REST.test(text)) return { tags, rest: m.index };
    const attrs = {};
    for (const [, name, ...values] of text.slice(TAG_START.lastIndex, TAG_REST.lastIndex - 1).matchAll(ATTRIBUTE)) attrs[name.toLowerCase()] = values.find((v) => v !== undefined) ?? '';
    tags.push({ name: m[1].toLowerCase(), attrs });
    end = TAG_START.lastIndex = TAG_REST.lastIndex;
  }
  return { tags, rest: Math.max(end, text.length - '<reddit-page-data'.length) }; // a tag's name may be cut off at the end
}
const on = (attrs, name) => name in attrs && attrs[name] !== 'false';
// a tag's verdict on the item: true (marked), false (unmarked, by the item's own tag or data), undefined (not decided).
// a post of the subreddit without the community mark decides nothing: the 2025 posts did not carry it
function redditMark({ name, attrs }, { post, sub }) {
  if (name === 'shreddit-post' && post && attrs.id === post) return on(attrs, 'nsfw') || on(attrs, 'subreddit-nsfw');
  if (name === 'shreddit-post' && sub && attrs['subreddit-prefixed-name']?.toLowerCase() === sub && on(attrs, 'subreddit-nsfw')) return true;
  const page = name === 'reddit-page-data' && sub ? json((attrs.data ?? '').replaceAll('&quot;', '"'))?.subreddit : null;
  if (page && page.prefixedName?.toLowerCase() === sub) return page.isNsfw === true;
  if (name === 'div' && post && attrs['data-fullname'] === post) return /(?:^|\s)over18(?:\s|$)/.test(attrs.class ?? '');
  return undefined;
}

// a json answer is read whole (an app can use it only whole anyway) and passed on unchanged unless the item the tab's
// address names is marked in it. the address is the tab's at the end: a single-page site's request can outlive the
// route it started on, and details.documentUrl is the address the page was first loaded at (the loading principal's,
// which pushState never changes: ChannelWrapper::GetDocumentURI, nsDocShell::UpdateURLAndHistory, 2026-10)
// clean links (settings, links.js): x wraps every link in a t.co redirect, and its api answers carry each one's real
// address next to it (an entity's url and expanded_url; a card's card_url is the same t.co), as the twitter-direct
// userscript reads them (chocolateboy, 2026-10). every t.co value in an answer becomes its real address before x
// gets it, so x shows, opens and copies the real link. whole values only: a post's text keeps its t.co, which its
// entities' indices point into. null when there is nothing to swap
let cleanLinks = DEFAULTS.cleanLinks;
browser.storage.local.get('settings').then(({ settings }) => (cleanLinks = mergeSettings(settings).cleanLinks));
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) cleanLinks = mergeSettings(changes.settings.newValue).cleanLinks;
});
function untco(text) {
  const data = json(text);
  const real = new Map();
  anyObject(data, (v) => {
    const expanded = v.expanded_url ?? v.expanded; // expanded: a quoted post's permalink
    if (/^https?:\/\/t\.co\/\w+$/.test(v.url) && typeof expanded === 'string') real.set(v.url, expanded);
    return false;
  });
  if (!real.size) return null;
  // url and a card's string_value, as twitter-direct does. not legacy.url: left as it is, x keeps a card's link
  // clickable in the post's text. and not a card's rest_id, which is its id
  const swap = (v, legacy) => {
    for (const [key, x] of Object.entries(v)) {
      if (x && typeof x === 'object') swap(x, key === 'legacy');
      else if (((key === 'url' && !legacy) || key === 'string_value') && real.has(x)) v[key] = real.get(x);
    }
  };
  swap(data, false);
  return JSON.stringify(data);
}
function readJson(site, itemOf, marked, rewrite) {
  return ({ requestId, tabId, url: request }) => {
    const filter = browser.webRequest.filterResponseData(requestId);
    const chunks = [];
    filter.ondata = ({ data }) => chunks.push(data);
    filter.onstop = async () => {
      let hit = false;
      let text = null;
      try {
        // no url: a tab gone to a site without host permission. a closed tab has nothing to send anywhere
        const { url } = await browser.tabs.get(tabId).catch(() => ({}));
        const item = url && itemOf(new URL(url));
        const decoder = new TextDecoder();
        text = chunks.map((d) => decoder.decode(d, { stream: true })).join('') + decoder.decode();
        hit = Boolean(item) && marked(text, item, request);
      } catch (e) {
        console.error(`dis2tract: reading ${site}'s adult labels failed, the answer goes through`, e);
      }
      const clean = !hit && cleanLinks && rewrite && text !== null ? rewrite(text) : null;
      if (clean !== null) filter.write(new TextEncoder().encode(clean));
      else if (!hit) for (const data of chunks) filter.write(data);
      filter.close(); // a marked answer ends empty: the app shows its own error until the porn page loads
      // the labeled page has committed by then: toPorn() takes its history entry, or on android steps over it
      if (hit) toPorn(tabId, { mark: site }, true);
    };
  };
}
// reddit's pages are read as they stream in, each chunk passed on at once unless it completes the tag of the marked
// item the address names: then neither it nor anything after it reaches the page (an unfinished tag never renders),
// so the post never paints. a page load is the page at its own address; a partial asks for the tab's address when its
// first tag arrives. decided only as tags arrive, never at the end, which a cut-off request reaches too. once the
// item's own tag or data is in unmarked, the rest goes to the page unread. not disconnect(): chunks can wait in the
// queue behind the address, and a write after disconnect() is dropped
function readReddit({ requestId, tabId, type, url }) {
  let item = type === 'main_frame' ? redditItem(new URL(url)) : undefined;
  if (item === null) return; // a page that names no post or subreddit
  const filter = browser.webRequest.filterResponseData(requestId);
  const decoder = new TextDecoder();
  let text = '';
  let state; // 'clear' once the item's own tag is in unmarked or the address names nothing, 'sent' once it is marked
  let queue = Promise.resolve();
  filter.ondata = ({ data }) => (queue = queue.then(async () => {
    if (state === 'sent') return;
    if (state !== 'clear') {
      text += decoder.decode(data, { stream: true });
      const { tags, rest } = redditTags(text);
      text = text.slice(rest);
      for (const tag of tags) {
        if (item === undefined) {
          const { url: address } = await browser.tabs.get(tabId).catch(() => ({})); // a closed tab names nothing
          item = address ? redditItem(new URL(address)) : null;
        }
        const mark = item ? redditMark(tag, item) : undefined;
        if (mark) {
          state = 'sent';
          filter.close();
          toPorn(tabId, { mark: 'reddit' }, true);
          return;
        }
        if (mark === false || item === null) {
          state = 'clear';
          break;
        }
      }
    }
    filter.write(data);
  }));
  filter.onstop = () => (queue = queue.then(() => state === 'sent' || filter.close()));
}

const LABELED = [
  { urls: ['*://x.com/i/api/graphql/*'], types: ['xmlhttprequest'], read: readJson('x', xItem, xMarked, untco) },
  { urls: ['*://*.reddit.com/*'], types: ['main_frame', 'xmlhttprequest'], read: readReddit },
  { urls: ['*://*.bsky.network/xrpc/*', '*://public.api.bsky.app/xrpc/*'], types: ['xmlhttprequest'], read: readJson('bluesky', blueskyItem, blueskyMarked) },
];
for (const { urls, types, read } of LABELED) {
  browser.webRequest.onBeforeRequest.addListener((details) => {
    if (details.tabId >= 0) read(details); // a request of no tab (a service worker) has no page to send anywhere
  }, { urls, types }, ['blocking']);
}
// the rest of x's api (notifications, direct messages ...) carries t.co links too. only json: an answer is held whole
// here, and an event stream never ends, so this waits for the headers (graphql goes through the label reader above)
browser.webRequest.onHeadersReceived.addListener(({ requestId, tabId, url, responseHeaders }) => {
  if (!cleanLinks || tabId < 0 || url.includes('/i/api/graphql/')) return;
  const type = responseHeaders.find(({ name }) => name.toLowerCase() === 'content-type')?.value ?? '';
  if (!type.startsWith('application/json')) return;
  const filter = browser.webRequest.filterResponseData(requestId);
  const chunks = [];
  filter.ondata = ({ data }) => chunks.push(data);
  filter.onstop = () => {
    const decoder = new TextDecoder();
    const clean = untco(chunks.map((d) => decoder.decode(d, { stream: true })).join('') + decoder.decode());
    if (clean !== null) filter.write(new TextEncoder().encode(clean));
    else for (const data of chunks) filter.write(data);
    filter.close();
  };
}, { urls: ['*://x.com/i/api/*'], types: ['xmlhttprequest'] }, ['blocking', 'responseHeaders']);

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
