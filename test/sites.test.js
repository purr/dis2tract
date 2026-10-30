const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({});
for (const f of ['settings.js', 'sites.js', 'challenges.js', 'suggestions.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', f), 'utf8'), ctx);
const { SITES, feedOf, looser, tighterPart, mergeSettings, siteFor, conversation, CHALLENGES, LIMITS, NEEDS, LATE, SHAME, URGES, URGE_LATE, instead } = ctx;
// every question with its things to do: the block screen's (the time on social media for every length a day can
// hold too) and the porn page's
const ANSWERS = [...NEEDS, LATE, ...Array.from({ length: 24 * 60 - 30 }, (_, i) => instead(30 + i)), ...URGES, URGE_LATE];

test('every roast question, suggestion, porn page quote and feed line fits one line on a phone', () => {
  // the block screen's line under "no feed" (TEXT.feed in content.js), with every feed's label
  const feeds = Object.values(SITES).flatMap((site) => site.feeds.map(([, label]) => `endless feed: ${site.name} ${label}.`));
  const lines = [...ANSWERS.flatMap(([question, ideas]) => [question, ...ideas.map(([text]) => text)]), ...SHAME.flat(), ...feeds];
  for (const line of lines) assert.ok(line.length <= 38, `${line.length} characters: ${line}`);
  assert.ok(SHAME.every((quote) => quote.length <= 2), 'a quote is one or two lines');
});

test('suggestion links are direct: https, never a search page', () => {
  const urls = ANSWERS.flatMap(([, ideas]) => ideas.map(([, url]) => url)).filter(Boolean);
  assert.ok(urls.length > 10);
  for (const url of urls) {
    const u = new URL(url);
    assert.equal(u.protocol, 'https:', url);
    assert.ok(!/search|results/.test(u.pathname) && !u.searchParams.has('q') && !u.searchParams.has('search_query'), `search page: ${url}`);
  }
});

// [site, url, expected]: 'feed', an item key, or null for a normal page
const CASES = [
  ['youtube', 'https://www.youtube.com/', 'feed'],
  ['youtube', 'https://m.youtube.com/?app=m', 'feed'],
  ['youtube', 'https://www.youtube.com/shorts/', 'feed'],
  ['youtube', 'https://www.youtube.com/feed/trending', 'feed'],
  ['youtube', 'https://www.youtube.com/index?app=desktop', 'feed'],
  // the explore pages at their other addresses: handle (any case, with tabs), channel url, /feed/*_destination
  ['youtube', 'https://www.youtube.com/@Gaming', 'feed'],
  ['youtube', 'https://www.youtube.com/channel/UCOpNcN46UbXVtpKMrmU4Abg/', 'feed'],
  ['youtube', 'https://www.youtube.com/feed/live_destination', 'feed'],
  ['youtube', 'https://www.youtube.com/news', 'feed'],
  ['youtube', 'https://www.youtube.com/@news/videos', 'feed'],
  ['youtube', 'https://www.youtube.com/channel/UC-9-kyTW8ZkZNDHQJ6FgpwQ', 'feed'],
  ['youtube', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10', 'dQw4w9WgXcQ'],
  ['youtube', 'https://www.youtube.com/watch?v=abc&list=PLcourse&index=3', 'list:PLcourse'],
  ['youtube', 'https://www.youtube.com/watch?v=abc&list=RDabc', 'abc'],
  ['youtube', 'https://www.youtube.com/shorts/abc_DEF-1', 'abc_DEF-1'],
  ['youtube', 'https://www.youtube.com/live/abcDEF12345', 'abcDEF12345'],
  ['youtube', 'https://www.youtube.com/clip/UgytZKpehg-hEMBSn3F4AaABCQ', 'UgytZKpehg-hEMBSn3F4AaABCQ'],
  ['youtube', 'https://www.youtube.com/@mkbhd/videos', null],
  ['youtube', 'https://www.youtube.com/@gamingfan', null],
  ['youtube', 'https://www.youtube.com/results?search_query=cats', null],
  ['youtube', 'https://www.youtube.com/feed/subscriptions', null],
  ['x', 'https://x.com/home', 'feed'],
  ['x', 'https://x.com/explore/tabs/for-you', 'feed'],
  ['x', 'https://x.com/jack/communities', 'feed'],
  ['x', 'https://x.com/jack/communities/explore', 'feed'],
  ['x', 'https://x.com/jack/status/20', '20'],
  ['x', 'https://x.com/jack/status/20/photo/1', '20'],
  ['x', 'https://x.com/i/web/status/20', '20'],
  ['x', 'https://x.com/jack/status/20/mediaviewer?currentTweet=20&currentTweetUser=jack', '20'],
  ['x', 'https://x.com/jack/status/20/mediaViewer?currentTweet=30&currentTweetUser=bob', '30'],
  ['x', 'https://x.com/jack?currentTweet=30', null],
  ['x', 'https://x.com/jack', null],
  ['x', 'https://x.com/i/communities/1493446837214187523', null],
  ['x', 'https://x.com/search?q=cats&src=typed_query', null],
  ['tiktok', 'https://www.tiktok.com/', 'feed'],
  ['tiktok', 'https://www.tiktok.com/foryou', 'feed'],
  ['tiktok', 'https://www.tiktok.com/en', 'feed'],
  ['tiktok', 'https://www.tiktok.com/zh-Hant-TW/', 'feed'],
  ['tiktok', 'https://www.tiktok.com/zh-Hans/', 'feed'],
  ['tiktok', 'https://www.tiktok.com/es-419/', 'feed'],
  ['tiktok', 'https://www.tiktok.com/fil-PH/', 'feed'],
  ['tiktok', 'https://www.tiktok.com/ceb-PH/', 'feed'],
  ['tiktok', 'https://us.tiktok.com/live', 'feed'],
  ['tiktok', 'https://www.tiktok.com/live/gaming/Minecraft?lang=en', 'feed'],
  ['tiktok', 'https://www.tiktok.com/live/following', 'feed'],
  ['tiktok', 'https://www.tiktok.com/@user/video/7123456789', '7123456789'],
  ['tiktok', 'https://www.tiktok.com/@user/photo/7123456789', '7123456789'],
  ['tiktok', 'https://www.tiktok.com/@user', null],
  ['tiktok', 'https://www.tiktok.com/tax', null],
  ['tiktok', 'https://www.tiktok.com/live/category/gaming', null],
  ['tiktok', 'https://www.tiktok.com/live/studio/help/article/x', null],
  ['tiktok', 'https://www.tiktok.com/search/video?q=cats', null],
  ['instagram', 'https://www.instagram.com/', 'feed'],
  ['instagram', 'https://www.instagram.com/explore/', 'feed'],
  ['instagram', 'https://www.instagram.com/reels/', 'feed'],
  ['instagram', 'https://www.instagram.com/reels/C0deAbc/', 'C0deAbc'],
  ['instagram', 'https://www.instagram.com/reel/C0deAbc/', 'C0deAbc'],
  ['instagram', 'https://www.instagram.com/natgeo/p/C0deAbc/', 'C0deAbc'],
  ['instagram', 'https://www.instagram.com/stories/natgeo/3456/', 'natgeo'],
  ['instagram', 'https://www.instagram.com/stories/highlights/1789/', '1789'],
  ['instagram', 'https://www.instagram.com/natgeo/', null],
  ['instagram', 'https://www.instagram.com/explore/search/keyword/?q=cats', null],
  ['instagram', 'https://www.instagram.com/direct/inbox/', null],
  ['instagram', 'https://www.instagram.com/notifications/', null],
  ['reddit', 'https://www.reddit.com/', 'feed'],
  ['reddit', 'https://www.reddit.com/best/', 'feed'],
  ['reddit', 'https://old.reddit.com/r/all/top/', 'feed'],
  ['reddit', 'https://de.reddit.com/', 'feed'],
  ['reddit', 'https://www.reddit.com/r/popular/', 'feed'],
  ['reddit', 'https://old.reddit.com/r/All/', 'feed'],
  ['reddit', 'https://old.reddit.com/r/all-pics/', 'feed'],
  ['reddit', 'https://www.reddit.com/news/', 'feed'],
  ['reddit', 'https://www.reddit.com/news?feed=news', 'feed'],
  ['reddit', 'https://www.reddit.com/t/technology/', 'feed'],
  ['reddit', 'https://www.reddit.com/r/allergies/', null],
  ['reddit', 'https://www.reddit.com/r/news/', null],
  ['reddit', 'https://www.reddit.com/r/AskHistorians/comments/1abcde/why_did/', '1abcde'],
  ['reddit', 'https://www.reddit.com/r/AskHistorians/', null],
  ['reddit', 'https://www.reddit.com/user/spez/', null],
  ['facebook', 'https://www.facebook.com/', 'feed'],
  ['facebook', 'https://m.facebook.com/home.php', 'feed'],
  ['facebook', 'https://www.facebook.com/watch/', 'feed'],
  ['facebook', 'https://de-de.facebook.com/watch/', 'feed'],
  ['facebook', 'https://www.facebook.com/video/', 'feed'],
  ['facebook', 'https://www.facebook.com/watch/live/', 'feed'],
  ['facebook', 'https://www.facebook.com/watch/?v=123456', '123456'],
  ['facebook', 'https://www.facebook.com/watch/live/?ref=watch_permalink&v=1647359463450220', '1647359463450220'],
  ['facebook', 'https://www.facebook.com/reel/987654', '987654'],
  ['facebook', 'https://www.facebook.com/somepage/posts/pfbid0abc', 'pfbid0abc'],
  ['facebook', 'https://www.facebook.com/groups/164828000315060/permalink/764967300301124/', '764967300301124'],
  ['facebook', 'https://www.facebook.com/stories/107066907747341/UzpfSVNDOjYzOTAwMDk0OTIwOTE5Mw==/', '107066907747341'],
  ['facebook', 'https://www.facebook.com/permalink.php?story_fbid=555&id=1', '555'],
  ['facebook', 'https://www.facebook.com/photo/?fbid=111&set=pcb.999', 'pcb.999'],
  ['facebook', 'https://www.facebook.com/photo/?fbid=112&set=pcb.999', 'pcb.999'],
  ['facebook', 'https://www.facebook.com/photo/?fbid=113', '113'],
  ['facebook', 'https://www.facebook.com/zuck', null],
  ['facebook', 'https://www.facebook.com/stories/create/', null],
  ['threads', 'https://www.threads.com/', 'feed'],
  ['threads', 'https://www.threads.com/for_you/', 'feed'],
  ['threads', 'https://www.threads.com/global', 'feed'],
  ['threads', 'https://www.threads.com/@zuck/post/C0deAbc', 'C0deAbc'],
  ['threads', 'https://www.threads.com/custom_feed/12345', 'feed'],
  ['threads', 'https://www.threads.com/@zuck', null],
  ['bluesky', 'https://bsky.app/', 'feed'],
  ['bluesky', 'https://bsky.app/profile/bsky.app/feed/whats-hot', 'feed'],
  ['bluesky', 'https://bsky.app/profile/jay.bsky.team/post/3abc', '3abc'],
  ['bluesky', 'https://bsky.app/profile/jay.bsky.team', null],
  ['linkedin', 'https://www.linkedin.com/feed/', 'feed'],
  ['linkedin', 'https://www.linkedin.com/feed/foryou/', 'feed'],
  ['linkedin', 'https://www.linkedin.com/feed/network/', 'feed'],
  ['linkedin', 'https://www.linkedin.com/posts/someone_activity-123-abc', 'someone_activity-123-abc'],
  ['linkedin', 'https://www.linkedin.com/feed/update/urn:li:activity:1/', 'urn:li:activity:1'],
  ['linkedin', 'https://www.linkedin.com/in/someone/', null],
];

for (const [id, url, want] of CASES) {
  test(`${id} ${url}`, () => {
    const u = new URL(url);
    assert.equal(siteFor(u.hostname), id, 'host belongs to the site');
    assert.equal(feedOf(id, u) ? 'feed' : SITES[id].itemKey(u), want);
  });
}

// search results and profiles are free of the scroll budget; feeds, items, hashtag pages, searches the site starts
// from a link and the sites' other pages are not
const FREE = [
  ['youtube', 'https://www.youtube.com/results?search_query=cats', true],
  ['youtube', 'https://www.youtube.com/@mkbhd/videos', true],
  ['youtube', 'https://www.youtube.com/channel/UC123', true],
  ['youtube', 'https://www.youtube.com/feed/subscriptions', false],
  ['youtube', 'https://www.youtube.com/watch?v=abc', false],
  ['youtube', 'https://www.youtube.com/hashtag/funny', false],
  ['x', 'https://x.com/search?q=cats&src=typed_query', true],
  ['x', 'https://x.com/search?q=cats&src=recent_search_click', true],
  ['x', 'https://x.com/jack', true],
  ['x', 'https://x.com/jack/media', true],
  ['x', 'https://x.com/search?q=%23Teapot&src=trend_click&vertical=trends', false],
  ['x', 'https://x.com/search?q=Teapot&src=promoted_trend_click', false],
  ['x', 'https://x.com/search?q=%24TSLA&src=cashtag_click', false],
  ['x', 'https://x.com/hashtag/Teapot?src=hashtag_click', false],
  ['x', 'https://x.com/jack/status/20', false],
  ['x', 'https://x.com/notifications', false],
  ['x', 'https://x.com/i/bookmarks', false],
  ['x', 'https://x.com/home', false],
  ['tiktok', 'https://www.tiktok.com/search/video?q=cats', true],
  ['tiktok', 'https://www.tiktok.com/@user', true],
  ['tiktok', 'https://www.tiktok.com/@user/video/7123456789', false],
  ['tiktok', 'https://www.tiktok.com/foryou', false],
  ['tiktok', 'https://www.tiktok.com/tag/fyp', false],
  ['instagram', 'https://www.instagram.com/explore/search/keyword/?q=cats', true],
  ['instagram', 'https://www.instagram.com/natgeo/', true],
  ['instagram', 'https://www.instagram.com/natgeo/reels/', true],
  ['instagram', 'https://www.instagram.com/natgeo/p/C0deAbc/', false],
  ['instagram', 'https://www.instagram.com/direct/inbox/', false],
  ['instagram', 'https://www.instagram.com/reels/', false],
  ['instagram', 'https://www.instagram.com/explore/', false],
  ['instagram', 'https://www.instagram.com/explore/tags/nature/', false],
  ['reddit', 'https://www.reddit.com/search/?q=cats', true],
  ['reddit', 'https://www.reddit.com/r/aww/search/?q=cats', true],
  ['reddit', 'https://www.reddit.com/user/spez/submitted/', true],
  ['reddit', 'https://www.reddit.com/r/aww/', false],
  ['facebook', 'https://www.facebook.com/search/top/?q=cats', true],
  ['facebook', 'https://www.facebook.com/zuck', true],
  ['facebook', 'https://www.facebook.com/profile.php?id=4', true],
  ['facebook', 'https://www.facebook.com/marketplace', false],
  ['facebook', 'https://www.facebook.com/groups/feed/', false],
  ['facebook', 'https://www.facebook.com/video/', false],
  ['threads', 'https://www.threads.com/search?q=cats', true],
  ['threads', 'https://www.threads.com/@zuck', true],
  ['threads', 'https://www.threads.com/@zuck/post/C0deAbc', false],
  ['threads', 'https://www.threads.com/search?q=cats&serp_type=tags&tag_id=1', false],
  ['bluesky', 'https://bsky.app/search?q=cats', true],
  ['bluesky', 'https://bsky.app/profile/jay.bsky.team', true],
  ['bluesky', 'https://bsky.app/profile/jay.bsky.team/post/3abc', false],
  // bare, empty or tab-only: bluesky's explore page
  ['bluesky', 'https://bsky.app/search', false],
  ['bluesky', 'https://bsky.app/search?q=', false],
  ['bluesky', 'https://bsky.app/search?tab=user', false],
  ['linkedin', 'https://www.linkedin.com/search/results/all/?keywords=cats', true],
  ['linkedin', 'https://www.linkedin.com/in/someone/', true],
  ['linkedin', 'https://www.linkedin.com/jobs/', false],
];

test('free pages: search results and profiles', () => {
  for (const [id, url, want] of FREE) assert.equal(SITES[id].free(new URL(url)), want, url);
});

test('a feed switched off in toggles is no longer a feed; the others still are', () => {
  const toggles = { 'tiktok.live': false };
  assert.equal(feedOf('tiktok', new URL('https://www.tiktok.com/live'), toggles), null);
  assert.equal(feedOf('tiktok', new URL('https://www.tiktok.com/foryou'), toggles)[0], 'foryou');
});

test('manifest matches and host permissions cover exactly the hosts in SITES', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../manifest.json'), 'utf8'));
  const matches = manifest.content_scripts.flatMap((cs) => cs.matches);
  const hosts = Object.values(SITES).flatMap((s) => s.hosts);
  assert.deepEqual(matches.map((m) => new URL(m.replace('*://', 'https://')).hostname).sort(), [...hosts].sort());
  // background.js registers the theme stylesheet for the same matches, which needs them as host permissions; the
  // only others are bluesky's data hosts, whose answers background.js reads for adult labels
  const api = ['*://*.bsky.network/*', '*://public.api.bsky.app/*'];
  assert.deepEqual(manifest.permissions.filter((p) => p.includes('://')).sort(), [...matches, ...api].sort());
});

test('search and profile urls are site-relative and encoded', () => {
  for (const site of Object.values(SITES)) {
    assert.match(site.search('a b&c'), /^\/[^/]/);
    assert.match(site.profile('name'), /^\/[^/]/);
    assert.ok(!site.search('a b&c').includes(' '), 'query is encoded');
  }
  assert.equal(SITES.bluesky.profile('jay'), '/profile/jay.bsky.social');
  assert.equal(SITES.bluesky.profile('jay.example.com'), '/profile/jay.example.com');
});

// a link that is a feed would be turned into a load that is blocked again: a dead end, worst for "log in" while the
// site's front page is its log-in form
test('block screen links never lead to a feed', () => {
  for (const [id, site] of Object.entries(SITES)) {
    for (const [label, link] of [['my profile', site.me], ...site.links].filter(([, link]) => link)) {
      assert.equal(feedOf(id, new URL(link, 'https://example.com')), null, `${id} ${label}`);
    }
  }
});

test('looser: what waits and what applies at once', () => {
  const base = mergeSettings({ version: 2 });
  const with_ = (patch) => mergeSettings({ version: 2, ...patch });
  assert.ok(looser(with_({ sites: { x: false } }), base), 'a site switched off');
  assert.ok(looser(with_({ toggles: { 'tiktok.live': false } }), base), 'a feed let through');
  assert.ok(looser(with_({ scrollScreens: 30 }), base), 'a limit raised');
  assert.ok(looser(with_({ chainLimit: 0 }), base), 'a limit turned off');
  assert.ok(looser(with_({ sentenceWords: 12 }), base), 'a shorter sentence');
  assert.ok(!looser(with_({ scrollScreens: 5, chainLimit: 2, sentenceWords: 30 }), base), 'all tighter');
  assert.ok(!looser(with_({ toggles: { 'youtube.theater': false }, handles: { x: 'jack' }, note: 'hi' }), base), 'tweaks, handles and the note');
  assert.ok(!looser(base, with_({ scrollScreens: 0 })), 'turning a limit back on');
  assert.ok(looser(with_({ bedtimeFrom: 23 }), with_({ bedtimeFrom: 21 })), 'a later bedtime');
  assert.ok(looser(base, with_({ bedtimeTo: 7 })), 'an earlier morning');
  assert.ok(!looser(with_({ bedtimeFrom: 21, bedtimeTo: 7 }), base), 'a longer bedtime');
  // bedtime only widens 23:00-5:00: a saved value outside its range (tampered storage) is clamped back into it
  const clamped = mergeSettings({ version: 2, bedtimeFrom: 3, bedtimeTo: 20 });
  assert.deepEqual([clamped.bedtimeFrom, clamped.bedtimeTo], [LIMITS.bedtimeFrom[0], LIMITS.bedtimeTo[1]]);
});

test('reddit wildcard host: language subdomains count, unrelated subdomains do not', () => {
  for (const host of ['www.reddit.com', 'old.reddit.com', 'en.reddit.com', 'de.reddit.com']) assert.equal(siteFor(host), 'reddit', host);
  for (const host of ['ads.reddit.com', 'developers.reddit.com', 'reddit.com.evil.example']) assert.equal(siteFor(host), undefined, host);
});

test('facebook wildcard host: locale subdomains count, unrelated subdomains do not', () => {
  for (const host of ['www.facebook.com', 'web.facebook.com', 'm.facebook.com', 'de-de.facebook.com', 'es-la.facebook.com']) assert.equal(siteFor(host), 'facebook', host);
  for (const host of ['business.facebook.com', 'l.facebook.com', 'facebook.com', 'facebook.com.evil.example']) assert.equal(siteFor(host), undefined, host);
});

test('conversations are told apart from feeds and profiles', () => {
  for (const url of ['https://x.com/messages/1-2', 'https://x.com/i/chat/1', 'https://www.instagram.com/direct/t/123/', 'https://www.linkedin.com/messaging/thread/1/', 'https://www.reddit.com/message/inbox/']) {
    assert.ok(conversation(new URL(url)), url);
  }
  for (const url of ['https://x.com/jack', 'https://www.instagram.com/directors/', 'https://www.reddit.com/r/messages_sub/']) assert.ok(!conversation(new URL(url)), url);
});

test('tighterPart: what tightens or is neutral applies now, what loosens keeps its live value', () => {
  const live = { version: 2, chainLimit: 3 };
  const now = tighterPart({ version: 2, sites: { x: false }, toggles: { 'tiktok.live': false, 'youtube.theater': false }, scrollScreens: 5, chainLimit: 10, note: 'hi' }, live);
  assert.deepEqual(JSON.parse(JSON.stringify(now)), { version: 2, sites: {}, toggles: { 'youtube.theater': false }, scrollScreens: 5, chainLimit: 3, note: 'hi' });
});

test('saved numbers outside LIMITS are clamped on load', () => {
  const s = mergeSettings({ version: 2, sentenceWords: 1, scrollScreens: 9999 });
  assert.equal(s.sentenceWords, LIMITS.sentenceWords[0]);
  assert.equal(s.scrollScreens, LIMITS.scrollScreens[1]);
});

test('every challenge accepts its answer and refuses others', () => {
  for (let round = 0; round < 50; round++) {
    const [retype, backwards, arithmetic, count] = CHALLENGES.map((make) => make(15));
    assert.ok(retype.check(` ${retype.show.toUpperCase()}. `), 'retype ignores case, punctuation and spaces');
    assert.ok(!retype.check(retype.show.split(' ').slice(1).join(' ')));
    assert.ok(backwards.check(backwards.show.split(' ').reverse().join(' ')));
    assert.ok(!backwards.check(backwards.show), 'the original order is wrong');
    const [, a, b, c] = /^(\d+) × (\d+) \+ (\d+)$/.exec(arithmetic.show).map(Number);
    const sum = a * b + c;
    assert.ok(sum <= 49 * 9 + 89, 'small enough to do in your head');
    assert.ok(arithmetic.check(String(sum)) && arithmetic.check(` ${sum} `));
    assert.ok(!arithmetic.check(String(sum + 1)) && !arithmetic.check('') && !arithmetic.check(`${sum} or so`));
    const letter = /"(.)"/.exec(count.ask)[1];
    const n = [...count.show].filter((ch) => ch === letter).length;
    assert.ok(n >= 3 && count.check(String(n)) && !count.check(String(n + 1)));
  }
});
