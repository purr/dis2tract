// per-site rules, from urls only: a redesign rarely changes them, unlike dom selectors.
// feeds: [key, label, match(url)]: the endless algorithmic feeds, each blocked unless switched off in settings.
// itemKey: id of the single video/post on this url, or null. distinct ids in a row form a swipe chain.
// free: search results and profiles, pages opened on purpose: no scroll budget there. a hashtag page (youtube's
// /hashtag/x, tiktok's /tag/x) or a search the site opens from a link (x's trends, threads' tags) is the site's pick
// of everyone's posts, not something typed: it keeps the budget. a typed "#x" search stays free.
// me: a url that opens the logged-in user's own profile; sites without one get a handle field in settings.
// route: turns special search-box input into a path (reddit's r/name).
// links: the block screen's ways on. logged out, the / of instagram, facebook and linkedin is their log-in form,
// blocked as the home feed, so they link to it ("log in"); logged in, that address opens no feed of its own.
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
      // /feed/trending and /feed/explore serve the home feed since trending was retired in 2025. so does /index,
      // which youtube swaps for / after load unless the query has one of its debug params (?app=desktop, 2026-10)
      ['home', 'home', (u) => ['/', '/index', '/feed/trending', '/feed/explore'].includes(path(u))],
      // the shorts tab jumps to a random /shorts/ID, which the feed rule in content.js keeps blocked
      ['shorts', 'shorts tab', (u) => path(u) === '/shorts'],
      // the explore menu's pages of picked videos; hub() knows their other addresses
      ['gaming', 'gaming', hub('gaming', 'UCOpNcN46UbXVtpKMrmU4Abg')],
      ['podcasts', 'podcasts', (u) => path(u) === '/podcasts'],
      ['live', 'live', hub('live', 'UC4R8DWoMoI7CAwX8_LjQHig')],
      ['music', 'music', hub('music', 'UC-9-kyTW8ZkZNDHQJ6FgpwQ')],
      ['news', 'news', hub('news', 'UCYfdidRxbB8Qhf0Nx7ioOYw')],
      ['sports', 'sports', hub('sports', 'UCEgdi0XIXXZ-qJOFPf4JSKw')],
      ['learning', 'learning', hub('learning', 'UCtFRv9O2AHqOZjjynzrv-xg')],
    ],
    itemKey: (u) => {
      // a clip is one short piece of a video (yt-dlp's youtube:clip, 2026-10)
      if (path(u) !== '/watch') return capture(u, /^\/(?:shorts|live|clip)\/([\w-]+)/);
      // a curated playlist plays as one item; mixes (ids starting RD) are endless autoplay and count per video
      const list = u.searchParams.get('list');
      return list && !list.startsWith('RD') ? `list:${list}` : u.searchParams.get('v');
    },
    search: (q) => `/results?search_query=${encodeURIComponent(q)}`,
    profile: (name) => `/@${encodeURIComponent(name)}`,
    // a typed "#funny" stays at /results; its hashtag link opens /hashtag/funny, every channel's videos with the tag
    // (525M for #funny) in a grid that pages on (#cctv9), which keeps the budget (curl, 2026-10)
    free: (u) => /^\/(results|@[^/]+|(channel|c|user)\/[^/]+)(\/|$)/.test(path(u)),
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
      // the communities nav item (/<you>/communities) and its explore tab, the top posts of all communities; a single
      // community, /i/communities/ID, stays open (control panel for twitter's URL_COMMUNITIES_RE, 2026-10)
      ['communities', 'communities', (u) => /^\/\w{1,15}\/communities(\/explore)?$/.test(path(u))],
    ],
    // the phone's video viewer (/status/ID/mediaviewer) keeps the post it opened on in the path; each swipe to the
    // next video only rewrites ?currentTweet= (as the userscript no-x-video-swipe and the xverse app read it, 2026-10)
    itemKey: (u) => (/\/status\/\d+\/mediaviewer$/i.test(path(u)) && u.searchParams.get('currentTweet')) || capture(u, /\/status\/(\d+)/),
    search: (q) => `/search?q=${encodeURIComponent(q)}&src=typed_query`,
    profile: (name) => `/${encodeURIComponent(name)}`,
    // a profile is a bare handle (and its tabs), so the site's own first-level pages are ruled out by name. a search
    // x starts from a link is its pick, not typed: a trend in the rail beside every desktop page (src=trend_click,
    // promoted_trend_click) or a hashtag or cashtag in a post (/hashtag/x?src=hashtag_click, cashtag_click), as the
    // twitter-linkify-trends userscript and maskbook's x adaptor build these links (2026-10)
    free: (u) => (path(u) === '/search' && !/(trend|hashtag|cashtag)_click$/.test(u.searchParams.get('src') ?? ''))
      || /^\/(?!(home|explore|search|hashtag|notifications|messages|settings|compose|i)(\/|$))\w{1,15}(\/(media|likes|with_replies|highlights|articles))?$/.test(path(u)),
    links: [['notifications', '/notifications'], ['messages', '/messages'], ['bookmarks', '/i/bookmarks']],
  },
  tiktok: {
    name: 'tiktok',
    // us.tiktok.com serves the full site itself instead of redirecting
    hosts: ['www.tiktok.com', 'us.tiktok.com'],
    feeds: [
      // also /en, /de-DE, /zh-Hant-TW, /es-419, /fil-PH ...: the for-you feed under a language prefix. tiktok's own
      // list (foryouWithLang, 56 prefixes, 2026-10) has 3-letter languages, scripts and numeric regions; a bare
      // 3-letter path (/tax, /kyc) is a page of its own, so 3 letters count only with a subtag after them
      ['foryou', 'for you', (u) => ['/', '/foryou'].includes(path(u)) || /^\/(?:[a-z]{2}|[a-z]{3}(?=-))(?:-[a-z0-9]{2,4})*$/i.test(path(u))],
      ['following', 'following', (u) => path(u) === '/following'],
      ['friends', 'friends', (u) => path(u) === '/friends'],
      ['explore', 'explore', (u) => path(u) === '/explore'],
      // the live feed's tabs (following, lifestyle, gaming and each game) are the same page in tiktok's live app (its
      // route manifest, 2026-10); /live/category, /event, /creators and /studio are browse and help pages
      ['live', 'live', (u) => /^\/live(\/(following|lifestyle|gaming(\/[^/]+)?))?$/.test(path(u))],
    ],
    itemKey: (u) => capture(u, /^\/@[^/]+\/(?:video|photo)\/(\d+)/),
    search: (q) => `/search?q=${encodeURIComponent(q)}`,
    profile: (name) => `/@${encodeURIComponent(name)}`,
    // a caption's tag opens /tag/<name>, every creator's videos with it (/tag/fyp), paged by cursor while there are
    // more (yt-dlp's tiktok:tag, 2026-10): a hashtag page, so it keeps the budget
    free: (u) => /^\/(search(\/\w+)?|@[^/]+)$/.test(path(u)),
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
    // a profile is a bare username (and its tabs), so the site's own first-level pages are ruled out by name. a tag
    // page (/explore/tags/x/) is a hashtag page; instagram sends it on to keyword search for #x by now anyway
    // (r/Instagram, 2026-10)
    free: (u) => path(u) === '/explore/search/keyword'
      || /^\/(?!(explore|reels?|direct|accounts|stories|p|tv|notifications)(\/|$))[\w.]+(\/(reels|tagged))?$/.test(path(u)),
    links: [['messages', '/direct/inbox/'], ['notifications', '/notifications/'], ['log in', '/accounts/login/']],
  },
  reddit: {
    name: 'reddit',
    // de., en., fr. ... serve reddit on their own host too (curl, 2026-10-27)
    hosts: ['*.reddit.com'],
    hostMatch: /^(?:www|old|[a-z]{2})\.reddit\.com$/,
    feeds: [
      ['home', 'home', (u) => ['/', '/best', '/hot', '/new', '/top', '/rising', '/controversial'].includes(path(u))],
      // any case, and old reddit's /r/all-pics (all minus a subreddit) is still all
      ['popular', 'popular and all', (u) => /^\/r\/(popular|all)([-+/]|$)/i.test(path(u))],
      // the news feed in reddit's menu, posts from communities across reddit (/news?feed=news until 2026-03, news
      // feed eradicator issue 554)
      ['news', 'news', (u) => /^\/news(\/|$)/.test(path(u))],
      // a topic page: the best posts on a topic from any subreddit, paged without end (r/changelog 2020-12, an
      // archived copy from 2024; still in search results in 2026-10)
      ['topics', 'topic feeds', (u) => /^\/t\/[^/]+$/.test(path(u))],
    ],
    itemKey: (u) => capture(u, /\/comments\/(\w+)/) || capture(u, /^\/gallery\/(\w+)/),
    search: (q) => `/search/?q=${encodeURIComponent(q)}`,
    profile: (name) => `/user/${encodeURIComponent(name)}/`,
    free: (u) => /^\/((r\/[^/]+\/)?search|u(ser)?\/[^/]+(\/(overview|submitted|comments))?)$/.test(path(u)),
    route: (v) => (/^\/?r\/\w+\/?$/.test(v) ? `/${v.replace(/^\/|\/$/g, '')}/` : null),
    me: '/user/me/', // redirects to your own profile when logged in
    links: [['messages', '/message/inbox/']],
  },
  facebook: {
    name: 'facebook',
    // de-de., es-la., pt-br. ... serve the whole desktop site themselves, and search results and shared links lead
    // there (curl, 2026-10-29); phones are sent on to m.
    hosts: ['*.facebook.com'],
    hostMatch: /^(?:www|web|m|[a-z]{2}-[a-z]{2})\.facebook\.com$/,
    feeds: [
      ['home', 'home', (u) => ['/', '/home.php'].includes(path(u))],
      // /video and /videos serve the same feed, /watch/live is its live tab, where /live leads (curl, 2026-10)
      ['watch', 'video tab', (u) => ['/watch', '/watch/live', '/video', '/videos'].includes(path(u)) && !u.searchParams.has('v')],
      ['reels', 'reels tab', (u) => ['/reel', '/reels'].includes(path(u))],
      ['groups', 'groups feed', (u) => path(u) === '/groups/feed'],
    ],
    // a photo's set (one post's photos, an album) counts once, not once per photo. so do one person's stories, as on
    // instagram: /stories/<person>/<card>/ moves on by itself (digits only: /stories/create is a page)
    itemKey: (u) => (['/watch', '/watch/live'].includes(path(u)) && u.searchParams.get('v'))
      || capture(u, /\/(?:posts|videos|reel|permalink)\/([\w.]+)/) || capture(u, /^\/stories\/(\d+)/)
      || u.searchParams.get('story_fbid') || u.searchParams.get('set') || u.searchParams.get('fbid'),
    search: (q) => `/search/top/?q=${encodeURIComponent(q)}`,
    profile: (name) => `/${encodeURIComponent(name)}`,
    // a profile is a bare name or profile.php, so the site's own first-level pages are ruled out by name
    free: (u) => /^\/(search\/\w+|profile\.php)$/.test(path(u))
      || /^\/(?!(home\.php|watch|videos?|reels?|groups|messages|notifications|marketplace|events|friends|gaming|stories|photo|photo\.php|permalink\.php|me|settings|bookmarks|saved)$)[\w.]+$/.test(path(u)),
    me: '/me', // redirects to your own profile when logged in
    links: [['messages', '/messages/'], ['notifications', '/notifications/'], ['log in', '/login/']],
  },
  threads: {
    name: 'threads',
    hosts: ['www.threads.com'],
    feeds: [
      // threads also serves the for-you feed as its own page, /for_you/ (its logo and home links go there on screens
      // 700 px and wider), and the logged-out feed at /global/: one route, /{variant}/ (getFeedVariantURL, 2026-10)
      ['home', 'for you', (u) => ['/', '/for_you', '/global'].includes(path(u))],
      ['following', 'following', (u) => path(u) === '/following'],
      ['custom', 'custom feeds', (u) => /^\/custom_feed\//.test(path(u))],
    ],
    itemKey: (u) => capture(u, /^\/@[^/]+\/post\/([\w-]+)/),
    search: (q) => `/search?q=${encodeURIComponent(q)}`,
    profile: (name) => `/@${encodeURIComponent(name)}`,
    // a tag in a post opens a search marked serp_type=tags (as jetpack's social previews link tags, 2026-10)
    free: (u) => (path(u) === '/search' && u.searchParams.get('serp_type') !== 'tags') || /^\/@[^/]+(\/(replies|reposts|media))?$/.test(path(u)),
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
    // a bare /search is bluesky's explore tab (its "explore" nav item): trending, suggestions and, scrolled to the
    // end, previews of suggested feeds (social-app Explore.tsx, 2026-10). only a query is a search; an empty q= is
    // explore too
    free: (u) => (path(u) === '/search' && Boolean(u.searchParams.get('q'))) || /^\/profile\/[^/]+$/.test(path(u)),
    links: [['notifications', '/notifications'], ['messages', '/messages']],
  },
  linkedin: {
    name: 'linkedin',
    hosts: ['www.linkedin.com', 'linkedin.com'],
    // some accounts get the home feed as two tabs since 2026-09: /feed/ swaps to /feed/foryou/, the other tab is
    // /feed/network/ (news feed eradicator 49c9b898c6, 2026-10-28)
    feeds: [['home', 'home feed', (u) => ['/', '/feed', '/feed/foryou', '/feed/network'].includes(path(u))]],
    itemKey: (u) => capture(u, /^\/posts\/([^/]+)/) || capture(u, /^\/feed\/update\/([^/]+)/),
    search: (q) => `/search/results/all/?keywords=${encodeURIComponent(q)}`,
    profile: (name) => `/in/${encodeURIComponent(name)}/`,
    free: (u) => /^\/(search\/results\/[\w-]+|in\/[^/]+(\/recent-activity\/[\w-]+)?)$/.test(path(u)),
    me: '/in/me/', // redirects to your own profile when logged in
    links: [['messages', '/messaging/'], ['notifications', '/notifications/'], ['jobs', '/jobs/'], ['log in', '/login']],
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

// a youtube explore page (gaming, live, news ...) has more addresses: /feed/<name>_destination and, as the channel
// it is, /channel/<id> and /@<name>, which free() would let through as a channel (not every page has all three).
// those in any case (youtube answers /@gaming as /@Gaming) and with the channel's tabs; the bare path only exact,
// since /live/<id> is a single stream. addresses and ids from each page's browse_id, curl 2026-10-29
function hub(name, channel) {
  const alias = new RegExp(`^/(channel/${channel}|@${name})(/|$)`, 'i');
  return (u) => [`/${name}`, `/feed/${name}_destination`].includes(path(u)) || alias.test(path(u));
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
