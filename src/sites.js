// per-site rules, from urls only: a redesign rarely changes them, unlike dom selectors.
// feeds: [key, label, match(url)]: the endless algorithmic feeds, each blocked unless switched off in settings.
// itemKey: id of the single video/post on this url, or null. distinct ids in a row form a swipe chain.
// me: a url that opens the logged-in user's own profile; sites without one get a handle field in settings.
// route: turns special search-box input into a path (reddit's r/name).
// tweaks: optional extras with a label and a default; run(url) returns true once done for that page.
// hosts: only hosts that serve pages. youtube.com, m.tiktok.com, twitter.com, mobile.x.com, instagram.com,
// m.instagram.com, reddit.com, new/m/sh/np/i.reddit.com and threads.net answer with redirects to these, so the
// content script never runs there (checked with curl, 2026-10-27). a "*." host is a manifest wildcard; hostMatch
// then says which of its subdomains count, so the rules never land on an unrelated subdomain.
// var, not const: the binding must be visible to content.js, loaded after this file.
var SITES = {
  youtube: {
    name: 'youtube',
    hosts: ['www.youtube.com', 'm.youtube.com'],
    feeds: [
      // /feed/trending and /feed/explore serve the home feed since trending was retired in 2025
      ['home', 'home', (u) => ['/', '/feed/trending', '/feed/explore'].includes(path(u))],
      // the shorts tab jumps to a random /shorts/ID, which the feed rule in content.js keeps blocked
      ['shorts', 'shorts tab', (u) => path(u) === '/shorts'],
      ['gaming', 'gaming', (u) => path(u) === '/gaming'],
      ['podcasts', 'podcasts', (u) => path(u) === '/podcasts'],
    ],
    itemKey: (u) => {
      if (path(u) !== '/watch') return capture(u, /^\/(?:shorts|live)\/([\w-]+)/);
      // a curated playlist plays as one item; mixes (ids starting RD) are endless autoplay and count per video
      const list = u.searchParams.get('list');
      return list && !list.startsWith('RD') ? `list:${list}` : u.searchParams.get('v');
    },
    search: (q) => `/results?search_query=${encodeURIComponent(q)}`,
    profile: (name) => `/@${encodeURIComponent(name)}`,
    me: '/profile', // login-gated redirect to your own channel
    links: [['subscriptions', '/feed/subscriptions'], ['history', '/feed/history'], ['playlists', '/feed/playlists']],
    tweaks: { theater: { label: 'theater mode on every video', on: true, run: theater } },
  },
  x: {
    name: 'x',
    hosts: ['x.com'],
    feeds: [
      ['home', 'home timeline', (u) => path(u) === '/home'],
      ['explore', 'explore', (u) => /^\/explore(\/|$)/.test(path(u))],
    ],
    itemKey: (u) => capture(u, /\/status\/(\d+)/),
    search: (q) => `/search?q=${encodeURIComponent(q)}&src=typed_query`,
    profile: (name) => `/${encodeURIComponent(name)}`,
    links: [['notifications', '/notifications'], ['messages', '/messages'], ['bookmarks', '/i/bookmarks']],
  },
  tiktok: {
    name: 'tiktok',
    // us.tiktok.com serves the full site itself instead of redirecting
    hosts: ['www.tiktok.com', 'us.tiktok.com'],
    feeds: [
      // also /en, /de, ...: the for-you feed under a language prefix
      ['foryou', 'for you', (u) => ['/', '/foryou'].includes(path(u)) || /^\/[a-z]{2}(-[a-z]{2})?$/i.test(path(u))],
      ['following', 'following', (u) => path(u) === '/following'],
      ['friends', 'friends', (u) => path(u) === '/friends'],
      ['explore', 'explore', (u) => path(u) === '/explore'],
      ['live', 'live', (u) => path(u) === '/live'],
    ],
    itemKey: (u) => capture(u, /^\/@[^/]+\/(?:video|photo)\/(\d+)/),
    search: (q) => `/search?q=${encodeURIComponent(q)}`,
    profile: (name) => `/@${encodeURIComponent(name)}`,
    links: [['messages', '/messages']],
  },
  instagram: {
    name: 'instagram',
    hosts: ['www.instagram.com'],
    feeds: [
      ['home', 'home', (u) => path(u) === '/'],
      ['explore', 'explore', (u) => path(u) === '/explore'],
      ['reels', 'reels tab', (u) => path(u) === '/reels'],
    ],
    // a story set counts once per account, not once per frame
    itemKey: (u) => capture(u, /\/(?:p|reels?|tv)\/([\w-]+)/) || capture(u, /^\/stories\/(?:highlights\/)?([^/]+)/),
    search: (q) => `/explore/search/keyword/?q=${encodeURIComponent(q)}`,
    profile: (name) => `/${encodeURIComponent(name)}/`,
    links: [['messages', '/direct/inbox/'], ['notifications', '/notifications/']],
  },
  reddit: {
    name: 'reddit',
    // de., en., fr. ... serve reddit on their own host too (curl, 2026-10-27)
    hosts: ['*.reddit.com'],
    hostMatch: /^(?:www|old|[a-z]{2})\.reddit\.com$/,
    feeds: [
      ['home', 'home', (u) => ['/', '/best', '/hot', '/new', '/top', '/rising', '/controversial'].includes(path(u))],
      ['popular', 'popular and all', (u) => /^\/r\/(popular|all)(\/|$)/.test(path(u))],
    ],
    itemKey: (u) => capture(u, /\/comments\/(\w+)/) || capture(u, /^\/gallery\/(\w+)/),
    search: (q) => `/search/?q=${encodeURIComponent(q)}`,
    profile: (name) => `/user/${encodeURIComponent(name)}/`,
    route: (v) => (/^\/?r\/\w+\/?$/.test(v) ? `/${v.replace(/^\/|\/$/g, '')}/` : null),
    me: '/user/me/', // redirects to your own profile when logged in
    links: [['messages', '/message/inbox/']],
  },
  facebook: {
    name: 'facebook',
    hosts: ['www.facebook.com', 'web.facebook.com', 'm.facebook.com'],
    feeds: [
      ['home', 'home', (u) => ['/', '/home.php'].includes(path(u))],
      ['watch', 'video tab', (u) => path(u) === '/watch' && !u.searchParams.has('v')],
      ['reels', 'reels tab', (u) => ['/reel', '/reels'].includes(path(u))],
      ['groups', 'groups feed', (u) => path(u) === '/groups/feed'],
    ],
    // a photo's set (one post's photos, an album) counts once, not once per photo
    itemKey: (u) => (path(u) === '/watch' && u.searchParams.get('v')) || capture(u, /\/(?:posts|videos|reel)\/([\w.]+)/)
      || u.searchParams.get('story_fbid') || u.searchParams.get('set') || u.searchParams.get('fbid'),
    search: (q) => `/search/top/?q=${encodeURIComponent(q)}`,
    profile: (name) => `/${encodeURIComponent(name)}`,
    me: '/me', // redirects to your own profile when logged in
    links: [['messages', '/messages/'], ['notifications', '/notifications/']],
  },
  threads: {
    name: 'threads',
    hosts: ['www.threads.com'],
    feeds: [
      ['home', 'for you', (u) => path(u) === '/'],
      ['following', 'following', (u) => path(u) === '/following'],
      ['custom', 'custom feeds', (u) => /^\/custom_feed\//.test(path(u))],
    ],
    itemKey: (u) => capture(u, /^\/@[^/]+\/post\/([\w-]+)/),
    search: (q) => `/search?q=${encodeURIComponent(q)}`,
    profile: (name) => `/@${encodeURIComponent(name)}`,
    links: [['activity', '/activity']],
  },
  bluesky: {
    name: 'bluesky',
    hosts: ['bsky.app'],
    feeds: [
      ['home', 'home', (u) => path(u) === '/'],
      ['feeds', 'custom feeds', (u) => path(u) === '/feeds' || /^\/profile\/[^/]+\/feed\//.test(path(u))],
    ],
    itemKey: (u) => capture(u, /^\/profile\/[^/]+\/post\/(\w+)/),
    search: (q) => `/search?q=${encodeURIComponent(q)}`,
    // a bare name is a bsky.social handle; bluesky only resolves full handles
    profile: (name) => `/profile/${encodeURIComponent(name.includes('.') ? name : `${name}.bsky.social`)}`,
    links: [['notifications', '/notifications'], ['messages', '/messages']],
  },
  linkedin: {
    name: 'linkedin',
    hosts: ['www.linkedin.com', 'linkedin.com'],
    feeds: [['home', 'home feed', (u) => ['/', '/feed'].includes(path(u))]],
    itemKey: (u) => capture(u, /^\/posts\/([^/]+)/) || capture(u, /^\/feed\/update\/([^/]+)/),
    search: (q) => `/search/results/all/?keywords=${encodeURIComponent(q)}`,
    profile: (name) => `/in/${encodeURIComponent(name)}/`,
    me: '/in/me/', // redirects to your own profile when logged in
    links: [['messages', '/messaging/'], ['notifications', '/notifications/'], ['jobs', '/jobs/']],
  },
};

// the site a hostname belongs to, or undefined
function siteFor(hostname) {
  return Object.keys(SITES).find((id) => SITES[id].hostMatch?.test(hostname) ?? SITES[id].hosts.includes(hostname));
}

// a conversation (dms, chat): long by nature, so the scroll budget does not apply
function conversation(u) {
  return /^\/(?:messages|messaging|message|direct|chat|i\/chat)(?:\/|$)/.test(path(u));
}

// the feed this url is, among the ones still blocked in toggles, or null
function feedOf(id, u, toggles = {}) {
  return SITES[id].feeds.find(([key, , match]) => toggles[`${id}.${key}`] !== false && match(u)) ?? null;
}

// pathname without trailing slashes, so /explore and /explore/ are one route
function path(u) {
  return u.pathname.replace(/\/+$/, '') || '/';
}

function capture(u, rx) {
  return rx.exec(u.pathname)?.[1] ?? null;
}

// the one place that touches a site's dom. selectors as used by improvedtube (appearance.js) and control panel
// for youtube (page.js), both maintained in 2026-10. desktop only: mobile youtube has no theater mode.
function theater(u) {
  if (location.hostname !== 'www.youtube.com' || path(u) !== '/watch') return true;
  document.cookie = 'wide=1; domain=.youtube.com; path=/; max-age=31536000'; // the next full load opens in theater
  const watch = document.querySelector('ytd-watch-flexy');
  if (watch?.hasAttribute('theater')) return true;
  const button = watch && document.querySelector('.ytp-chrome-bottom .ytp-size-button');
  button?.click();
  return Boolean(button);
}
