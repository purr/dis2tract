// runs the real content script against a minimal fake dom, driving url changes, timers and storage by hand
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '../src', f), 'utf8');
const settle = () => new Promise((r) => setImmediate(r));
const SCRIPTS = ['ui.js', 'settings.js', 'sites.js', 'challenges.js', 'suggestions.js', 'content.js'];
// local noon, so "today" never straddles midnight in any timezone the tests run in
const NOON = new Date(2026, 9, 27, 12, 0).getTime();
const MIN = 60_000;

class El {
  constructor(tag, doc) {
    Object.assign(this, { tagName: tag.toUpperCase(), doc, attrs: new Map(), children: [], parentNode: null, listeners: {}, text: '', value: '', scrollTop: 0 });
    this.style = { props: {}, setProperty(k, v) { this.props[k] = v; } };
  }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  hasAttribute(k) { return this.attrs.has(k); }
  removeAttribute(k) { this.attrs.delete(k); }
  toggleAttribute(k, force) {
    const on = force ?? !this.attrs.has(k);
    if (on) this.attrs.set(k, '');
    else this.attrs.delete(k);
    return on;
  }
  get dataset() {
    return new Proxy({}, {
      get: (_, p) => this.getAttribute(`data-${String(p)}`) ?? undefined,
      set: (_, p, v) => {
        this.setAttribute(`data-${String(p)}`, v);
        return true;
      },
    });
  }
  addEventListener(t, f) { (this.listeners[t] ??= []).push(f); }
  fire(t, e = {}) { for (const f of this.listeners[t] ?? []) f({ target: this, preventDefault() {}, ...e }); }
  append(...xs) {
    for (const x of xs) {
      if (typeof x === 'string') this.text += x;
      else {
        x.remove();
        x.parentNode = this;
        this.children.push(x);
      }
    }
  }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
    this.parentNode = null;
  }
  replaceWith(x) {
    const p = this.parentNode;
    x.remove();
    p.children.splice(p.children.indexOf(this), 1, x);
    x.parentNode = p;
    this.parentNode = null;
  }
  replaceChildren(...xs) {
    for (const c of [...this.children]) c.remove();
    this.text = '';
    this.append(...xs);
  }
  get isConnected() {
    let n = this;
    while (n.parentNode) n = n.parentNode;
    return n === this.doc.documentElement;
  }
  get nextElementSibling() {
    const sibs = this.parentNode?.children ?? [];
    return sibs[sibs.indexOf(this) + 1] ?? null;
  }
  contains(x) {
    for (let n = x; n; n = n.parentNode) if (n === this) return true;
    return false;
  }
  find(pred) {
    for (const c of this.children) {
      const hit = pred(c) ? c : c.find(pred);
      if (hit) return hit;
    }
    return null;
  }
  querySelector(tag) { return this.find((n) => n.tagName === tag.toUpperCase()); }
  focus() {}
  set textContent(v) { this.children = []; this.text = String(v); }
  get textContent() { return this.text + this.children.map((c) => c.textContent).join(''); }
}

// setup(doc, root) runs before the scripts, to put the page in a starting state
// session: a Map standing in for the tab's sessionStorage; without one the page has none, as when a site refuses it
function boot(url, stored = {}, setup = () => {}, session = null) {
  const clock = { now: NOON };
  const data = structuredClone(stored);
  const changeListeners = [];
  const messageListeners = []; // what background.js sends this tab
  const doc = { listeners: {}, body: null, activeElement: null, cookie: '', visibilityState: 'visible' };
  const root = new El('html', doc);
  let stops = 0;
  const win = { listeners: {}, stop: () => { stops += 1; } };
  Object.assign(doc, {
    documentElement: root,
    scrollingElement: root,
    createElement: (t) => new El(t, doc),
    getElementById: (id) => root.find((n) => n.getAttribute('id') === id),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: (t, f) => (doc.listeners[t] ??= []).push(f),
  });
  win.addEventListener = (t, f) => (win.listeners[t] ??= []).push(f);
  // the page's own media prototype, which the content script wraps through firefox's exportFunction
  win.wrappedJSObject = {
    Promise,
    HTMLMediaElement: { prototype: { play() { this.paused = false; return Promise.resolve(); } } },
    HTMLElement: { prototype: { focus() { doc.activeElement = this; } } },
  };
  setup(doc, root);
  const loc = new URL(url);
  const assigned = [];
  const reloads = [];
  const location = {
    get href() { return loc.href; },
    set href(v) { loc.href = new URL(v, loc).href; },
    get hostname() { return loc.hostname; },
    get host() { return loc.host; },
    assign(v) { assigned.push(v); },
    reload() { reloads.push(loc.href); },
  };
  const timers = [];
  const chimes = []; // every chime asked of the background page
  const used = []; // time on social media reported to the background page
  const store = {
    async get(keys) {
      return Object.fromEntries([keys].flat().filter((k) => k in data).map((k) => [k, structuredClone(data[k])]));
    },
    async set(obj) {
      const changes = {};
      for (const [k, v] of Object.entries(obj)) {
        changes[k] = { oldValue: data[k], newValue: structuredClone(v) };
        data[k] = structuredClone(v);
      }
      for (const f of changeListeners) f(changes, 'local');
    },
    async remove(key) {
      const changes = { [key]: { oldValue: data[key] } };
      delete data[key];
      for (const f of changeListeners) f(changes, 'local');
    },
  };
  const ctx = vm.createContext({
    URL,
    console,
    document: doc,
    location,
    innerHeight: 1000,
    window: win,
    queueMicrotask,
    exportFunction: (fn, target, { defineAs }) => { target[defineAs] = fn; },
    ...(session && {
      sessionStorage: { getItem: (k) => session.get(k) ?? null, setItem: (k, v) => session.set(k, String(v)), removeItem: (k) => session.delete(k) },
    }),
    setTimeout: (f) => f(), // the sheet's closing delay, run at once
    setInterval: (f, ms) => timers.push({ f, ms }),
    clearInterval: (id) => { timers[id - 1] = null; },
    Date: class extends Date { static now() { return clock.now; } },
    browser: {
      storage: { local: store, onChanged: { addListener: (f) => changeListeners.push(f) } },
      runtime: {
        sendMessage: async (message) => {
          if (message === 'chime') chimes.push(clock.now);
          else if (message?.used) used.push(message.used);
        },
        onMessage: { addListener: (f) => messageListeners.push(f) },
      },
    },
  });
  // the first of every random pick: challenge 0 (retype) made of the first word, suggestion 0, and so on
  vm.runInContext('Math.random = () => 0', ctx);
  for (const f of SCRIPTS) vm.runInContext(read(f), ctx, { filename: f });
  const overlay = () => root.children.find((c) => c.getAttribute('id') === 'dis2tract') ?? null;
  const t = {
    ctx,
    win,
    data,
    doc,
    clock,
    chimes,
    used,
    assigned,
    reloads,
    stops: () => stops,
    overlay,
    reason: () => overlay()?.getAttribute('data-reason') ?? null,
    find: (pred) => overlay()?.find(pred) ?? null,
    button: (start) => t.find((n) => n.tagName === 'BUTTON' && n.textContent.startsWith(start)),
    unlockText: () => t.find((n) => n.getAttribute('class') === 'd2t-unlock')?.textContent,
    sheet: () => t.find((n) => n.getAttribute('class') === 'd2t-sheet'),
    tick: () => timers.find((x) => x?.ms === 400).f(),
    seconds(n) {
      for (let i = 0; i < n; i++) {
        clock.now += 1000;
        for (const x of timers.filter((x) => x?.ms === 1000)) x.f();
      }
    },
    // time passing tick by tick, with storage answering in between, the way it runs in a browser
    async run(ms) {
      for (let i = 0; i < ms / 400; i++) {
        clock.now += 400;
        t.tick();
        await settle();
      }
    },
    visible(on) {
      doc.visibilityState = on ? 'visible' : 'hidden';
      for (const f of doc.listeners.visibilitychange) f({});
    },
    // a video the page starts through its own play(); its pause() stops it
    play() {
      const video = { paused: true, ended: false, pause() { this.paused = true; } };
      win.wrappedJSObject.HTMLMediaElement.prototype.play.call(video);
      return video;
    },
    touch: () => {
      for (const f of win.listeners.pointerdown) f({});
    },
    // background.js reporting an address the page passed through
    passed: (url) => {
      for (const f of messageListeners) f({ url });
    },
    // the site's router changing the address, before the next look
    go: (v) => {
      location.href = v;
    },
    // a plain left click on a link; returns whether the page's own handlers were kept from it
    click(href, extra = {}) {
      let stopped = false;
      const link = { href: new URL(href, location.href).href, target: '' };
      const e = { button: 0, target: { closest: () => link }, preventDefault() { stopped = true; }, stopImmediatePropagation() {}, ...extra };
      for (const f of win.listeners.click ?? []) f(e);
      return stopped;
    },
    nav(v) {
      location.href = v;
      t.tick();
    },
    back(v) {
      for (const f of win.listeners.popstate) f({});
      t.nav(v);
    },
    scroll(top) {
      root.scrollTop = top;
      for (const f of doc.listeners.scroll) f({ target: doc });
    },
    setStorage: (obj) => store.set(obj),
  };
  return t;
}

// clicks unlock, waits out the pause, returns the challenge's field and what it shows
function startChallenge(t, site) {
  t.button(`unlock ${site}`).fire('click');
  t.seconds(t.ctx.UNLOCK.waitSeconds);
  const input = t.find((n) => n.getAttribute('placeholder') === 'your answer');
  return { input, shown: t.find((n) => n.getAttribute('class') === 'd2t-sentence').textContent, form: input.parentNode };
}

// types like a person: one character per input event
function type(input, text) {
  for (let i = 1; i <= text.length; i++) {
    input.value = text.slice(0, i);
    input.fire('input', { isTrusted: true });
  }
}

test('a feed is covered before storage answers and stays covered; search is free', async () => {
  const t = boot('https://www.youtube.com/');
  assert.equal(t.reason(), 'feed');
  await settle();
  assert.equal(t.reason(), 'feed');
  t.nav('https://www.youtube.com/results?search_query=cats');
  assert.equal(t.reason(), null);
});

test('the 5th different video in a row is blocked; the back button steps out', async () => {
  const t = boot('https://www.youtube.com/results?search_query=cats');
  await settle();
  for (const v of ['a', 'b', 'c', 'd']) {
    t.nav(`https://www.youtube.com/watch?v=${v}`);
    assert.equal(t.reason(), null, v);
  }
  t.nav('https://www.youtube.com/watch?v=e');
  assert.equal(t.reason(), 'chain');
  t.nav('https://www.youtube.com/watch?v=d');
  assert.equal(t.reason(), null, 'back to the 4th');
  t.nav('https://www.youtube.com/watch?v=f');
  assert.equal(t.reason(), 'chain', 'forward to a new one');
  t.nav('https://www.youtube.com/@someone');
  t.nav('https://www.youtube.com/watch?v=g');
  assert.equal(t.reason(), null, 'a profile resets the chain');
});

test('a curated playlist is one item, a mix counts per video', async () => {
  const t = boot('https://www.youtube.com/feed/subscriptions');
  await settle();
  for (const v of 'abcdefgh') t.nav(`https://www.youtube.com/watch?v=${v}&list=PLcourse&index=1`);
  assert.equal(t.reason(), null);
  for (const v of 'abcde') t.nav(`https://www.youtube.com/watch?v=${v}&list=RDMM`);
  assert.equal(t.reason(), 'chain');
});

test('instagram reels tab stays blocked after it jumps to a reel; a later item is a real page', async () => {
  const t = boot('https://www.instagram.com/natgeo/');
  await settle();
  t.nav('https://www.instagram.com/reels/');
  assert.equal(t.reason(), 'feed');
  t.clock.now += 500;
  t.nav('https://www.instagram.com/reels/ABC/');
  assert.equal(t.reason(), 'feed');
  t.nav('https://www.instagram.com/');
  t.clock.now += 5000;
  t.nav('https://www.instagram.com/p/XYZ/');
  assert.equal(t.reason(), null);
});

test('a reload or new tab within a minute keeps the shorts tab blocked and the chain counting', async () => {
  const t = boot('https://www.youtube.com/shorts');
  await settle();
  t.nav('https://www.youtube.com/shorts/A');
  assert.equal(t.reason(), 'feed');
  const reloaded = boot('https://www.youtube.com/shorts/A', { 'trail:youtube': t.data['trail:youtube'] });
  await settle();
  assert.equal(reloaded.reason(), 'feed', 'a reload is not a way out of the shorts tab');
  const c = boot('https://www.youtube.com/results?search_query=x');
  await settle();
  for (const v of 'abcde') c.nav(`https://www.youtube.com/watch?v=${v}`);
  assert.equal(c.reason(), 'chain');
  const again = boot('https://www.youtube.com/watch?v=e', { 'trail:youtube': c.data['trail:youtube'] });
  await settle();
  assert.equal(again.reason(), 'chain', 'a reload is not a fresh chain');
  const later = boot('https://www.youtube.com/watch?v=e', { 'trail:youtube': { ...c.data['trail:youtube'], at: NOON - 2 * MIN } });
  await settle();
  assert.equal(later.reason(), null, 'after a minute the run is over');
});

test('a slow feed-to-item swap is still the feed; back/forward is not', async () => {
  const t = boot('https://www.instagram.com/reels/');
  await settle();
  for (let i = 0; i < 12; i++) {
    t.clock.now += 400;
    t.tick();
  }
  t.nav('https://www.instagram.com/reels/C0de/');
  assert.equal(t.reason(), 'feed', 'swapped 4.8 s after load');
  const y = boot('https://www.youtube.com/watch?v=a');
  await settle();
  y.nav('https://www.youtube.com/');
  assert.equal(y.reason(), 'feed');
  y.clock.now += 500;
  y.back('https://www.youtube.com/watch?v=a');
  assert.equal(y.reason(), null, 'back from an accidental home click');
});

test('a settings write keeps the feed carry and the scroll budget', async () => {
  const t = boot('https://www.instagram.com/reels/');
  await settle();
  t.nav('https://www.instagram.com/reels/C0de/');
  await t.setStorage({ settings: { version: 2, note: 'hi' } });
  assert.equal(t.reason(), 'feed');
  const x = boot('https://x.com/i/bookmarks');
  await settle();
  x.scroll(0);
  for (let top = 500; top <= 7000; top += 500) x.scroll(top);
  await x.setStorage({ settings: { version: 2, note: 'hi' } });
  for (let top = 7500; top <= 12_000; top += 500) x.scroll(top);
  assert.equal(x.reason(), 'scroll');
});

test('switching a feed off while on it lifts the block at once', async () => {
  const t = boot('https://www.tiktok.com/live');
  await settle();
  assert.equal(t.reason(), 'feed');
  await t.setStorage({ settings: { version: 2, toggles: { 'tiktok.live': false } } });
  assert.equal(t.reason(), null);
});

test('conversations have no scroll budget', async () => {
  const t = boot('https://x.com/messages/1-2');
  await settle();
  t.scroll(0);
  for (let top = 500; top <= 30_000; top += 500) t.scroll(top);
  assert.equal(t.reason(), null);
});

test('a leftover overlay from an earlier instance is removed; fullscreen is left for the block screen', async () => {
  let exited = false;
  const t = boot('https://www.youtube.com/', {}, (doc, root) => {
    const stale = new El('div', doc);
    stale.setAttribute('id', 'dis2tract');
    stale.setAttribute('data-reason', 'stale');
    root.append(stale);
    doc.fullscreenElement = {};
    doc.exitFullscreen = () => {
      exited = true;
      return Promise.resolve();
    };
  });
  await settle();
  assert.equal(t.doc.documentElement.children.filter((c) => c.getAttribute('id') === 'dis2tract').length, 1);
  assert.equal(t.reason(), 'feed');
  assert.ok(exited);
});

test('unlock: a pause, a challenge with no pasting, then the site opens for its minutes', async () => {
  const t = boot('https://www.tiktok.com/foryou');
  await settle();
  assert.match(t.button('unlock').textContent, /for 3 min/);
  const before = t.unlockText();
  t.button('unlock').fire('click');
  assert.match(t.sheet().textContent, /starts in 15 s/, 'the flow opens in a sheet');
  assert.equal(t.unlockText(), before, 'the page under the sheet does not change');
  t.seconds(14);
  assert.match(t.sheet().textContent, /starts in 1 s/, 'no challenge before the pause ends');
  t.seconds(1);
  const input = t.find((n) => n.getAttribute('placeholder') === 'your answer');
  assert.equal(input.tagName, 'TEXTAREA', 'a sentence wraps, so typos stay visible');
  const shown = t.find((n) => n.getAttribute('class') === 'd2t-sentence').textContent;
  let refused = false;
  input.fire('paste', { preventDefault: () => { refused = true; } });
  assert.ok(refused, 'paste is refused');
  type(input, shown.split(' ').slice(0, -1).join(' '));
  await settle();
  assert.equal(t.reason(), 'feed', 'a partial answer does nothing');
  type(input, `${shown.toUpperCase()}.`);
  await settle();
  assert.equal(t.reason(), null);
  assert.equal(t.data.stats.unlocks, 1);
  t.play();
  await t.run(3 * MIN - 2000);
  assert.equal(t.reason(), null);
  await t.run(3000);
  assert.equal(t.reason(), 'feed');
});

test('unlock minutes run only on screen: time left waits for a later visit, and a newer unlock ends it', async () => {
  const t = boot('https://www.tiktok.com/foryou', { unlocks: [{ site: 'tiktok', at: NOON }] });
  await settle();
  t.play();
  await t.run(MIN);
  t.nav('https://www.tiktok.com/@someone');
  await settle();
  const away = t.data.spent.ms;
  assert.ok(away >= MIN - 1000 && away <= MIN, 'leaving the feed saves the time spent on it');
  await t.run(8 * MIN);
  t.nav('https://www.tiktok.com/foryou');
  t.visible(false);
  await t.run(8 * MIN);
  await settle();
  assert.equal(t.data.spent.ms, away, 'a profile and a hidden tab spend nothing');
  t.visible(true);
  assert.equal(t.reason(), null, 'still unlocked after 16 minutes away');
  const other = boot('https://www.tiktok.com/foryou', t.data);
  await settle();
  assert.equal(other.reason(), null, 'another tab sees the same time left');
  await t.run(2 * MIN - 2000);
  assert.equal(t.reason(), null);
  await t.run(3000);
  assert.equal(t.reason(), 'feed');
  assert.ok(t.button('+1 min'), 'the extra minute is offered once the time is used up');

  const replaced = boot('https://www.tiktok.com/foryou', { unlocks: [{ site: 'tiktok', at: NOON - 5 * MIN }, { site: 'x', at: NOON - MIN }] });
  await settle();
  assert.equal(replaced.reason(), 'feed', 'a newer unlock elsewhere ends it');
});

test('an unused unlock from earlier does not open the feed: time left lasts until the next unlock could start', async () => {
  const t = boot('https://www.youtube.com/', { unlocks: [{ site: 'youtube', at: NOON - 3 * 60 * MIN }] });
  assert.equal(t.reason(), 'feed');
  await settle();
  assert.equal(t.reason(), 'feed', 'still blocked once storage answers');
  const { minutes, cooldownMinutes } = t.ctx.UNLOCK;
  const fresh = boot('https://www.youtube.com/', { unlocks: [{ site: 'youtube', at: NOON - (minutes + cooldownMinutes) * MIN + 1000 }] });
  await settle();
  assert.equal(fresh.reason(), null, 'until then it waits');
});

test('unlock minutes stop while nothing plays and nobody touches the page', async () => {
  const t = boot('https://www.tiktok.com/foryou', { unlocks: [{ site: 'tiktok', at: NOON }] });
  await settle();
  const video = t.play();
  await t.run(MIN);
  video.pause();
  await t.run(10 * MIN);
  const paused = t.data.spent.ms;
  assert.ok(paused > MIN - 1000 && paused <= MIN, 'a paused video eats nothing');
  t.touch();
  await t.run(MIN);
  const read = t.data.spent.ms - paused;
  assert.ok(read > 9000 && read <= 10_000, 'input keeps the minutes running for 10 s: scrolling a text feed counts');
  assert.equal(t.reason(), null);
  t.scroll(0);
  t.scroll(300); // autoscroll or the scrollbar: scrolling with no other input
  await t.run(MIN);
  assert.ok(t.data.spent.ms - paused - read > 9000, 'scrolling itself counts as use');
});

test('a jump into a feed blocks at once: a link click becomes a stopped full load, a router change is judged when reported', async () => {
  const t = boot('https://www.youtube.com/watch?v=abc');
  await settle();
  assert.equal(t.click('/'), true, 'the site never gets the click');
  assert.deepEqual(t.assigned, ['https://www.youtube.com/'], 'a full load instead, which stops at its start');
  assert.equal(t.click('/@someone'), false, 'other links work as usual');
  assert.equal(t.click('/', { ctrlKey: true }), false, 'a new tab loads, and stops, by itself');
  t.go('https://www.youtube.com/'); // the router got there some other way
  assert.equal(t.reason(), null);
  t.passed('https://www.youtube.com/');
  assert.equal(t.reason(), 'feed', 'blocked when reported, not at the next look');
  const open = boot('https://www.youtube.com/watch?v=abc', { unlocks: [{ site: 'youtube', at: NOON }] });
  await settle();
  assert.equal(open.click('/'), false, 'unlocked: the feed opens the usual way');
});

test('a feed address the page passed through between two looks still makes its item the feed', async () => {
  const t = boot('https://www.instagram.com/natgeo/');
  await settle();
  t.passed('https://www.instagram.com/reels/'); // reported by background.js, gone before the next look
  t.nav('https://www.instagram.com/reels/C0de/');
  assert.equal(t.reason(), 'feed');
  const late = boot('https://www.instagram.com/natgeo/');
  await settle();
  late.nav('https://www.instagram.com/reels/C0de/'); // the report arrives after the look at the item
  assert.equal(late.reason(), null);
  late.passed('https://www.instagram.com/reels/');
  assert.equal(late.reason(), 'feed');
  const profile = boot('https://www.instagram.com/natgeo/');
  await settle();
  profile.passed('https://www.instagram.com/explore/');
  assert.equal(profile.reason(), null, 'a page that is not an item is left alone');
});

test('a new instance of the script (an update or reload) wraps the page\'s own play(), not a dead wrapper', async () => {
  const t = boot('https://www.youtube.com/@someone');
  await settle();
  const proto = t.win.wrappedJSObject.HTMLMediaElement.prototype;
  const page = proto.play.dis2tractPage;
  // the old instance's sandbox is gone: its wrapper throws, with the page's own play() still carried on it
  proto.play = Object.assign(() => { throw new Error('can\'t access dead object'); }, { dis2tractPage: page });
  vm.runInContext(read('content.js'), t.ctx, { filename: 'content.js' });
  const video = { paused: true, ended: false, pause() { this.paused = true; } };
  proto.play.call(video);
  assert.equal(video.paused, false);
  assert.equal(proto.play.dis2tractPage, page);
});

test('a block that appears while browsing fades in and chimes; the first paint and a redraw do neither', async () => {
  const t = boot('https://www.youtube.com/');
  assert.equal(t.overlay().getAttribute('data-enter'), null, 'a page load covers the feed at once');
  await settle();
  assert.equal(t.overlay().getAttribute('data-enter'), null);
  assert.equal(t.chimes.length, 0);
  t.nav('https://www.youtube.com/@someone');
  t.nav('https://www.youtube.com/');
  assert.equal(t.overlay().getAttribute('data-enter'), '');
  assert.equal(t.chimes.length, 1);
  await t.setStorage({ settings: { version: 2, note: 'hi' } });
  assert.equal(t.overlay().getAttribute('data-enter'), null, 'a redraw replaces it in place');
  assert.equal(t.chimes.length, 1);
  t.button('unlock youtube').fire('click');
  await t.setStorage({ theme: { '--d2t-bg': '#000000' } });
  assert.equal(t.overlay().style.props['--d2t-bg'], '#000000', 'new theme colors are painted on');
  assert.ok(t.sheet(), 'and an open unlock sheet stays');
  const quiet = boot('https://www.youtube.com/@someone', { settings: { version: 2, chime: false } });
  await settle();
  quiet.nav('https://www.youtube.com/');
  assert.equal(quiet.chimes.length, 0, 'switched off in settings');
  const hidden = boot('https://www.youtube.com/@someone');
  await settle();
  hidden.doc.visibilityState = 'hidden';
  hidden.nav('https://www.youtube.com/');
  assert.equal(hidden.chimes.length, 0, 'a tab out of sight stays quiet');
});

test('a wrong answer in another tab holds a challenge open here too', async () => {
  const t = boot('https://x.com/home');
  await settle();
  const { input, shown } = startChallenge(t, 'x');
  await t.setStorage({ unlockBan: t.clock.now + 60_000 });
  type(input, shown);
  await settle();
  assert.equal(t.data.unlocks, undefined, 'no unlock during the wait');
  assert.match(t.sheet().textContent, /the challenge starts in 60 s/);
});

test('feed time saved by another tab does not redraw an open unlock sheet', async () => {
  const t = boot('https://x.com/home');
  await settle();
  t.button('unlock x').fire('click');
  await t.setStorage({ spent: { at: NOON - MIN, ms: 5000 } });
  assert.ok(t.sheet(), 'the sheet stays open');
});

test('a wrong number: the right answer, a wait, then a new challenge in the same sheet', async () => {
  const t = boot('https://x.com/home');
  await settle();
  vm.runInContext('Math.random = () => 0.5', t.ctx); // the third challenge, arithmetic: 31 × 6 + 50
  const { input, form, shown } = startChallenge(t, 'x');
  assert.equal(shown, '31 × 6 + 50');
  form.fire('submit');
  assert.equal(t.sheet().querySelector('input'), input, 'an empty enter is a slip, not an answer');
  type(input, '7');
  form.fire('submit');
  form.fire('submit');
  await settle();
  assert.match(t.sheet().textContent, /^wrong\. 31 × 6 \+ 50 is 236\./, 'the sheet says what was wrong');
  assert.match(t.sheet().textContent, /a new challenge in 30 s/);
  assert.equal(t.data.stats.wrong, 1, 'a second enter is not a second wrong answer');
  assert.equal(t.data.unlockBan, NOON + 15_000 + 30_000);
  assert.match(t.unlockText(), /^unlock x/, 'the block screen behind keeps its unlock button');
  t.button('never mind').fire('click');
  t.seconds(10);
  t.button('unlock x').fire('click');
  assert.match(t.sheet().textContent, /starts in 20 s/, 'closing and reopening does not skip the wait');
  t.seconds(20);
  assert.ok(t.sheet().querySelector('input'), 'a new challenge');
});

test('only text typed one character at a time counts: pastes in any form are undone or ignored', async () => {
  const t = boot('https://x.com/home');
  await settle();
  const { input, shown, form } = startChallenge(t, 'x');
  type(input, 'apple');
  input.value = shown; // a clipboard chip or dictation: many characters in one input event
  input.fire('input', { isTrusted: true });
  assert.equal(input.value, 'apple');
  input.value = 'xyzab'; // pasted over the selected word: same length, still five characters at once
  input.fire('input', { isTrusted: true });
  assert.equal(input.value, 'apple');
  input.value = 'apples'; // a script typing for the user: one character, but an event no key made
  input.fire('input', { isTrusted: false });
  assert.equal(input.value, 'apple');
  input.value = 'x'; // typed over the selected word: one character
  input.fire('input', { isTrusted: true });
  assert.equal(input.value, 'x');
  // an extension that re-enables paste swallowed the events: the text never reached the listener
  input.value = shown;
  form.fire('submit');
  assert.equal(input.value, 'x', 'thrown away on enter');
  await settle();
  assert.equal(t.reason(), 'feed');
  assert.equal(t.data.unlocks, undefined);
});

test('enter on a typo in the sentence is a wrong answer too, and never says which word', async () => {
  const t = boot('https://x.com/home');
  await settle();
  const { input } = startChallenge(t, 'x');
  type(input, 'apple apple apple aple');
  let kept = true;
  input.fire('beforeinput', { inputType: 'insertLineBreak', preventDefault: () => { kept = false; } });
  assert.ok(!kept, 'no new line');
  await settle();
  assert.equal(t.sheet().textContent, 'wrong. the text did not match.a new challenge in 30 s.never mind');
  assert.equal(t.data.stats.wrong, 1);
});

test('never mind goes back to the unlock button without a penalty', async () => {
  const t = boot('https://x.com/home');
  await settle();
  t.button('unlock x').fire('click');
  const closing = t.sheet().parentNode;
  t.button('never mind').fire('click');
  assert.equal(closing.getAttribute('data-closing'), '', 'it plays the closing animation first');
  assert.equal(t.sheet(), null, 'the sheet is gone');
  assert.ok(t.button('unlock x'));
  assert.equal(t.data.unlockBan, undefined);
  t.button('unlock x').fire('click');
  const layer = t.sheet().parentNode;
  layer.fire('click', { target: layer });
  assert.equal(t.sheet(), null, 'a tap outside the sheet closes it too');
});

test('bedtime: from 23:00 to 5:00 no unlock starts, and one still running ends', async () => {
  const at = (h, m) => new Date(2026, 9, 27, h, m).getTime();
  const t = boot('https://x.com/home');
  t.clock.now = at(23, 30);
  await settle();
  t.tick();
  assert.match(t.unlockText(), /^bedtime: no unlocks until /);
  assert.equal(t.button('unlock'), null);
  const u = boot('https://www.tiktok.com/foryou', { unlocks: [{ site: 'tiktok', at: at(22, 58) }] });
  u.clock.now = at(22, 59);
  await settle();
  assert.equal(u.reason(), null, 'unlocked before bedtime');
  u.clock.now = at(23, 0);
  u.tick();
  assert.equal(u.reason(), 'feed');
  assert.equal(u.button('+1 min'), null, 'no extra minute at bedtime either');
});

test('unlocks: spaced across all sites, a daily cap, and the old storage shape is ignored', async () => {
  const { cooldownMinutes, perDay, minutes } = boot('https://x.com/home').ctx.UNLOCK;
  const t = boot('https://www.youtube.com/', { unlocks: [{ site: 'x', at: NOON - MIN }] });
  await settle();
  assert.match(t.unlockText(), /^next unlock at /);
  t.clock.now = NOON - MIN + (minutes + cooldownMinutes) * MIN;
  t.tick();
  assert.match(t.unlockText(), /^unlock youtube for 3 min/, 'the button returns when the cooldown ends');
  const spent = boot('https://www.youtube.com/', { unlocks: Array.from({ length: perDay }, (_, i) => ({ site: 'tiktok', at: NOON - (i + 1) * MIN })) });
  await settle();
  assert.match(spent.unlockText(), /^no unlocks left today/);
  const old = boot('https://www.youtube.com/', { unlocks: { youtube: NOON + MIN } });
  await settle();
  assert.equal(old.reason(), 'feed');
});

test('one extra minute right after an unlock ends, paid for with a longer cooldown', async () => {
  const ran = (doneAt) => ({ unlocks: [{ site: 'tiktok', at: NOON - 10 * MIN, doneAt }], spent: { at: NOON - 10 * MIN, ms: 3 * MIN } });
  const t = boot('https://www.tiktok.com/foryou', ran(NOON - 30_000));
  await settle();
  assert.equal(t.reason(), 'feed');
  t.touch(); // the click's pointerdown
  t.button('+1 min').fire('click');
  await settle();
  assert.equal(t.reason(), null, 'open again');
  t.play();
  await t.run(MIN);
  assert.equal(t.reason(), 'feed');
  assert.equal(t.button('+1 min'), null, 'only once');
  // the extra minute ran out at about NOON + 1 min; the next unlock waits the longer cooldown from there
  t.clock.now = NOON + 30 * MIN;
  t.tick();
  assert.match(t.unlockText(), /^next unlock at /);
  t.clock.now = NOON + 32 * MIN;
  t.tick();
  assert.ok(t.button('unlock tiktok'));
  const late = boot('https://www.tiktok.com/foryou', ran(NOON - 3 * MIN));
  await settle();
  assert.equal(late.button('+1 min'), null, 'not once the grace window has passed');
});

test('the mirror names the other apps the user went for just before, and only then', async () => {
  const mirror = (t) => t.find((n) => n.getAttribute('class') === 'd2t-mirror')?.textContent;
  const t = boot('https://www.tiktok.com/foryou', { recent: [{ site: 'x', at: NOON - 2 * MIN }, { site: 'youtube', at: NOON - 30_000 }] });
  await settle();
  assert.equal(mirror(t), 'x 2 min ago, youtube just now, now tiktok. same urge, new app.');
  assert.equal(t.data.stats.hops, 1);
  t.nav('https://www.tiktok.com/@user');
  t.nav('https://www.tiktok.com/following');
  await settle();
  assert.equal(t.data.stats.hops, 1, 'another blocked page here is not another hop');
  const calm = boot('https://www.tiktok.com/foryou', { recent: [{ site: 'x', at: NOON - 30 * MIN }] });
  await settle();
  assert.equal(mirror(calm), undefined, 'an old attempt elsewhere is not a hop, and there is no count to show');
});

test('each block screen roasts with one random question, already answered', async () => {
  const t = boot('https://x.com/home');
  await settle();
  const roast = t.find((n) => n.getAttribute('class') === 'd2t-answer');
  assert.equal(roast.textContent, 'bored again? wow.solve one chess puzzle, then close', 'the first pick with Math.random at 0');
  assert.equal(t.find((n) => n.tagName === 'BUTTON' && n.textContent.endsWith('?')), null, 'no buttons to press');
  const other = boot('https://x.com/home');
  vm.runInContext('Math.random = () => 0.99', other.ctx);
  await settle();
  other.nav('https://x.com/explore');
  assert.match(other.find((n) => n.getAttribute('class') === 'd2t-answer').textContent, /^this is how you spend tonight\?/);
});

test('after half an hour of social media today, the roast is that time and one thing it was enough for', async () => {
  const roast = (t) => t.find((n) => n.getAttribute('class') === 'd2t-answer').textContent;
  const t = boot('https://x.com/home', { usage: { at: NOON - MIN, ms: 72 * MIN } });
  await settle();
  assert.equal(roast(t), '1 h 12 min on social media today.enough to run 12 km, ~780 kcal');
  for (const usage of [{ at: NOON - MIN, ms: 29 * MIN }, { at: NOON - 24 * 60 * MIN, ms: 72 * MIN }]) {
    const calm = boot('https://x.com/home', { usage });
    await settle();
    assert.match(roast(calm), /^bored again\? wow\./, 'not a lot yet, or not today');
  }
});

test('time on social media counts any page in use, never the block screen', async () => {
  const t = boot('https://x.com/jack/status/1');
  await settle();
  t.touch();
  await t.run(6000);
  assert.deepEqual(t.used, [5200], 'sent every few seconds');
  t.nav('https://x.com/home');
  assert.deepEqual(t.used, [5200, 400], 'the rest as the block screen comes up');
  t.touch();
  await t.run(6000);
  assert.deepEqual(t.used, [5200, 400], 'nothing while it is up');
  t.nav('https://x.com/search?q=cats');
  t.touch();
  await t.run(2000);
  for (const f of t.win.listeners.pagehide) f({});
  assert.deepEqual(t.used, [5200, 400, 2000], 'and the rest on leaving');
});

test('the page cannot pull focus out of the answer field while blocked', async () => {
  const t = boot('https://www.tiktok.com/foryou');
  await settle();
  const pageFocus = t.win.wrappedJSObject.HTMLElement.prototype.focus;
  const field = t.find((n) => n.tagName === 'INPUT');
  pageFocus.call(field);
  assert.equal(t.doc.activeElement, field, 'focus inside the block screen still works');
  const player = new El('div', t.doc);
  pageFocus.call(player);
  assert.equal(t.doc.activeElement, field, 'the page focusing its own player is ignored');
  const free = boot('https://www.tiktok.com/@someone');
  await settle();
  const other = new El('div', free.doc);
  free.win.wrappedJSObject.HTMLElement.prototype.focus.call(other);
  assert.equal(free.doc.activeElement, other, 'on an allowed page the page focuses what it wants');
});

test('music from a player in no document is stopped while blocked', async () => {
  const media = (t) => t.win.wrappedJSObject.HTMLMediaElement.prototype;
  const player = () => ({ paused: true, pause() { this.paused = true; } });
  const blocked = boot('https://www.tiktok.com/foryou');
  await settle();
  const song = player();
  media(blocked).play.call(song);
  assert.equal(song.paused, true, 'cannot start behind the block screen');
  const t = boot('https://www.tiktok.com/@someone');
  await settle();
  const earlier = player();
  media(t).play.call(earlier);
  assert.equal(earlier.paused, false, 'plays on an allowed page');
  t.nav('https://www.tiktok.com/foryou');
  assert.equal(earlier.paused, true, 'paused the moment the block screen comes up');
});

test('a loosening change waits, then applies without a reload', async () => {
  const t = boot('https://www.youtube.com/', { pending: { settings: { version: 2, sites: { youtube: false } }, at: NOON + MIN } });
  await settle();
  assert.equal(t.reason(), 'feed');
  t.clock.now += MIN;
  t.tick();
  await settle();
  assert.equal(t.reason(), null);
  assert.equal(t.data.pending, undefined);
  assert.equal(t.data.settings.sites.youtube, false);
});

test('a feed switched off in settings lets that feed through, and only that one', async () => {
  const t = boot('https://www.tiktok.com/live', { settings: { version: 2, toggles: { 'tiktok.live': false } } });
  await settle();
  assert.equal(t.reason(), null);
  t.nav('https://www.tiktok.com/foryou');
  assert.equal(t.reason(), 'feed');
  const sub = t.find((n) => n.getAttribute('class') === 'd2t-sub');
  assert.deepEqual(sub.children.map((s) => s.textContent), ['tiktok for you is an endless feed.', 'go somewhere on purpose.'], 'one sentence per line');
});

test('youtube watch pages ask for theater mode, unless it is switched off', async () => {
  const t = boot('https://www.youtube.com/watch?v=a');
  await settle();
  assert.match(t.doc.cookie, /^wide=1/);
  const off = boot('https://www.youtube.com/watch?v=a', { settings: { version: 2, toggles: { 'youtube.theater': false } } });
  await settle();
  off.tick();
  assert.equal(off.doc.cookie, '');
});

test('scroll budget: 12 screens, restore jumps ignored, reset by navigation', async () => {
  const t = boot('https://x.com/i/bookmarks');
  await settle();
  t.scroll(0);
  t.scroll(50_000); // a site restoring its position
  for (let top = 50_500; top < 50_000 + 12_000; top += 500) t.scroll(top);
  assert.equal(t.reason(), null);
  t.scroll(62_000);
  assert.equal(t.reason(), 'scroll');
  t.nav('https://x.com/jack/status/1');
  assert.equal(t.reason(), null);
});

test('search results and profiles have no scroll budget', async () => {
  for (const url of ['https://x.com/search?q=cats', 'https://x.com/jack', 'https://www.tiktok.com/@user']) {
    const t = boot(url);
    await settle();
    t.scroll(0);
    for (let top = 500; top <= 30_000; top += 500) t.scroll(top);
    assert.equal(t.reason(), null, url);
  }
});

test('past the scroll limit, keep scrolling gives the page another budget after a wait, as often as needed', async () => {
  const t = boot('https://www.reddit.com/r/aww/');
  await settle();
  t.scroll(0);
  for (let top = 500; top <= 12_000; top += 500) t.scroll(top);
  assert.equal(t.reason(), 'scroll');
  t.button('keep scrolling').fire('click');
  t.seconds(9);
  assert.equal(t.reason(), 'scroll', 'not before the wait is over');
  t.seconds(1);
  assert.equal(t.reason(), null);
  for (let top = 12_500; top < 24_000; top += 500) t.scroll(top);
  assert.equal(t.reason(), null, 'a second full budget');
  t.scroll(24_000);
  assert.equal(t.reason(), 'scroll');
  assert.ok(t.button('keep scrolling'), 'and the offer again');
});

test('a feed opened from scratch stops loading at once; if it may show after all, it loads again, once', async () => {
  const session = new Map();
  const t = boot('https://www.youtube.com/', {}, undefined, session);
  assert.equal(t.stops(), 1, 'stopped before the site loads');
  await settle();
  assert.equal(t.reason(), 'feed');
  assert.deepEqual(t.reloads, [], 'still blocked: nothing more to load');
  await t.setStorage({ unlocks: [{ site: 'youtube', at: t.clock.now }] });
  assert.deepEqual(t.reloads, ['https://www.youtube.com/'], 'unlocked: the page loads for real');
  const again = boot('https://www.youtube.com/', { unlocks: [{ site: 'youtube', at: NOON }] }, undefined, session);
  assert.equal(again.stops(), 0, 'the marked reload is let through');
  assert.equal(session.size, 0, 'the mark is used once');
  await settle();
  assert.equal(again.reason(), null);
  assert.equal(boot('https://www.youtube.com/@someone', {}, undefined, new Map()).stops(), 0, 'other pages load as usual');
  assert.equal(boot('https://www.youtube.com/').stops(), 0, 'no stop where no mark could undo it');
});

test('a switched-off site is left alone; settings from another version are discarded', async () => {
  const off = boot('https://www.youtube.com/', { settings: { version: 2, sites: { youtube: false } } });
  await settle();
  assert.equal(off.reason(), null);
  const old = boot('https://www.youtube.com/', { settings: { sites: { youtube: false } } });
  await settle();
  assert.equal(old.reason(), 'feed');
});

test('block screen: @profile, reddit r/name, search, my profile link and theme colors', async () => {
  const t = boot('https://x.com/home', { settings: { version: 2, handles: { x: 'jack' } }, theme: { '--d2t-bg': 'rgb(1 2 3)' } });
  await settle();
  assert.equal(t.overlay().style.props['--d2t-bg'], 'rgb(1 2 3)');
  assert.ok(t.find((n) => n.tagName === 'A' && n.getAttribute('href') === '/jack' && n.textContent === 'my profile'));
  const form = t.find((n) => n.tagName === 'FORM');
  const input = form.querySelector('input');
  input.value = '@';
  form.fire('submit');
  assert.deepEqual(t.assigned, []);
  input.value = ' @ elonmusk ';
  form.fire('submit');
  input.value = 'cats & dogs';
  form.fire('submit');
  assert.deepEqual(t.assigned, ['/elonmusk', '/search?q=cats%20%26%20dogs&src=typed_query']);
  await t.setStorage({ theme: { '--d2t-bg': 'rgb(9 9 9)' } });
  assert.equal(t.overlay().style.props['--d2t-bg'], 'rgb(9 9 9)', 'a theme change restyles the open overlay');
  const r = boot('https://www.reddit.com/');
  await settle();
  const rf = r.find((n) => n.tagName === 'FORM');
  rf.querySelector('input').value = 'r/AskHistorians';
  rf.fire('submit');
  assert.deepEqual(r.assigned, ['/r/AskHistorians/']);
});

test('youtube links to your own channel without a handle', async () => {
  const t = boot('https://www.youtube.com/');
  await settle();
  assert.ok(t.find((n) => n.tagName === 'A' && n.getAttribute('href') === '/profile'));
});

test('the porn page is built from the block screen\'s parts, look and theme', async () => {
  const html = fs.readFileSync(path.join(__dirname, '../porn/porn.html'), 'utf8');
  assert.deepEqual([...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]), ['../css/overlay.css', '../src/settings.js', '../src/ui.js', '../src/suggestions.js', 'porn.js']);
  const doc = {};
  Object.assign(doc, {
    body: new El('body', doc),
    // a video that plays; the rest of the fake dom stands in as usual
    createElement: (t) => Object.assign(new El(t, doc), t === 'video' && { play: () => Promise.resolve() }),
  });
  const ctx = vm.createContext({
    document: doc,
    history: { length: 1 },
    browser: { extension: { getBackgroundPage: () => ({ theme: { '--d2t-bg': '#123456' } }) }, tabs: {} },
  });
  for (const f of ['../src/settings.js', '../src/ui.js', '../src/suggestions.js', '../porn/porn.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f });
  }
  const screen = doc.body.children[0];
  const has = (cls) => screen.find((n) => n.getAttribute('class') === cls);
  assert.equal(screen.getAttribute('id'), 'dis2tract');
  assert.equal(screen.style.props['--d2t-bg'], '#123456', 'the firefox theme, like the block screen');
  assert.equal(screen.find((n) => n.tagName === 'H2').textContent, 'no porn');
  assert.ok(has('d2t-sub') && has('d2t-answer') && has('d2t-unlock'));
  const clip = has('d2t-clip');
  assert.ok(fs.statSync(path.join(__dirname, '../porn', clip.src)).size > 0, clip.src);
  assert.equal(screen.find((n) => n.textContent === 'go back').hidden, true, 'nothing to go back to in a new tab');
});

test('background: theme pairs become a document_start stylesheet and a storage mirror; bad colors are dropped', async () => {
  let saved = {};
  let current = { colors: { frame: [10, 20, 30], tab_background_text: '#fff', toolbar_field: 'red', toolbar_field_text: 'red} body {display:none', tab_line: '#0af' } };
  const registered = [];
  const on = {};
  const played = [];
  const sent = []; // tabs sent elsewhere: [tabId, url]
  const reported = []; // history changes passed on to a tab: [tabId, url, frameId]
  const watched = []; // webRequest listeners: { f, filter, extra }
  const streams = {}; // response filters by request id
  class Audio {
    constructor(src) { this.src = src; }
    play() { played.push(this.src); }
  }
  const fakeBrowser = (withTheme) => ({
    runtime: {
      getManifest: () => ({ content_scripts: [{ matches: ['*://x.com/*'] }] }),
      getURL: (p) => p,
      onMessage: { addListener: (f) => (on.message = f) },
      openOptionsPage() {},
      setUninstallURL: (url) => (on.farewell = url),
    },
    webNavigation: {
      onBeforeNavigate: { addListener: (f) => (on.navigate = f) },
      onCommitted: { addListener: (f) => (on.committed = f) },
      onHistoryStateUpdated: { addListener: (f, filter) => Object.assign(on, { history: f, historyFilter: filter }) },
    },
    webRequest: {
      onBeforeRequest: { addListener: (f, filter, extra) => watched.push({ f, filter, extra }) },
      filterResponseData: (requestId) => (streams[requestId] = { written: [], write(d) { this.written.push(d); }, close() { this.closed = true; } }),
    },
    tabs: {
      update: (tabId, { url }) => sent.push([tabId, url]),
      sendMessage: async (tabId, message, options) => reported.push([tabId, message.url, options.frameId]),
    },
    browserAction: { onClicked: { addListener: (f) => (on.click = f) } },
    contentScripts: {
      register: async (options) => {
        const r = { options, gone: false, unregister: async () => { r.gone = true; } };
        registered.push(r);
        return r;
      },
    },
    storage: { local: { get: async () => structuredClone(saved), set: async (o) => { saved = { ...saved, ...o }; } } },
    ...(withTheme && { theme: { getCurrent: async () => current, onUpdated: { addListener: (f) => (on.updated = f) } } }),
  });
  // stand-in for the browser's css parser: hex, rgb() and plain names count as colors
  const CSS = { supports: (_, v) => /^(#[\da-f]{3,8}|rgb\([\d\s./]+\)|[a-z]+)$/i.test(v) };
  // the porn list download: oisd's format, a comment and one domain per line
  let download = `# oisd nsfw small\n${Array.from({ length: 1000 }, (_, i) => `site${i}.test`).join('\n')}\nexample.test\n`;
  const fetched = [];
  const fetch = async (url) => {
    fetched.push(url);
    return { ok: true, text: async () => download };
  };
  const clock = { now: NOON };
  const background = (withTheme) => {
    const ctx = vm.createContext({ browser: fakeBrowser(withTheme), CSS, console, Audio, URL, TextDecoder, fetch, setInterval: () => 0, Date: class extends Date { static now() { return clock.now; } } });
    vm.runInContext(read('background.js'), ctx, { filename: 'background.js' });
    return ctx;
  };
  background(true);
  await settle();
  // porn: a top-level load of a listed site or any subdomain of it goes to the extension's page
  assert.equal(new URL(fetched[0]).hostname, 'raw.githubusercontent.com', 'a host that lets any origin read it');
  assert.equal(saved.pornList.domains.length, 1001, 'kept for offline starts');
  on.navigate({ frameId: 0, tabId: 7, url: 'https://www.example.test/videos' });
  on.navigate({ frameId: 3, tabId: 8, url: 'https://example.test/embed/1' }); // a player inside another site
  on.committed({ frameId: 0, tabId: 9, url: 'https://example.test/' }); // where a short link redirected to
  on.navigate({ frameId: 0, tabId: 10, url: 'https://example.test./' }); // a trailing dot
  on.navigate({ frameId: 0, tabId: 11, url: 'https://anything.xxx/' }); // an adult top-level domain
  on.navigate({ frameId: 0, tabId: 12, url: 'https://notexample.test/' }); // only a look-alike name
  on.navigate({ frameId: 0, tabId: 13, url: 'about:blank' });
  assert.deepEqual(sent, [7, 8, 9, 10, 11].map((tab) => [tab, 'porn/porn.html']));
  assert.ok(fs.statSync(path.join(__dirname, '..', sent[0][1])).size > 0);
  // a trailing dot on any other site: the same address without it, where the rules apply
  on.navigate({ frameId: 0, tabId: 14, url: 'https://www.tiktok.com./foryou' });
  assert.deepEqual(sent.at(-1), [14, 'https://www.tiktok.com/foryou']);
  // adult labels in what x, reddit and bluesky load: the data reaches the page untouched, and the tab goes to the
  // porn page. each answer arrives split, the way a response streams in
  const encode = (s) => new TextEncoder().encode(s);
  const answer = (pattern, tabId, ...chunks) => {
    const { f } = watched.find((w) => w.filter.urls.includes(pattern));
    f({ requestId: `${pattern}${tabId}`, tabId });
    const stream = streams[`${pattern}${tabId}`];
    if (!stream) return null;
    for (const chunk of chunks) stream.ondata({ data: encode(chunk) });
    stream.onstop();
    return stream;
  };
  sent.length = 0;
  const xs = answer('*://x.com/i/api/graphql/*', 30, '{"media":[{"sensitive_media_warning":{"adult_', 'content":true}}]}');
  answer('*://x.com/i/api/graphql/*', 31, '{"sensitive_media_warning":{"adult_content":false,"graphic_violence":true}}');
  answer('*://*.reddit.com/*', 32, '<article><shreddit-post post-title="pics" nsfw="" score="5">');
  answer('*://*.reddit.com/*', 33, '<div class=" thing id-t3_1 over18 link">');
  answer('*://*.reddit.com/*', 34, '<shreddit-post post-title="cat pics" score="5">');
  answer('*://*.bsky.network/xrpc/*', 35, '{"labels":[{"src":"did:plc:x","val":"porn"}]}');
  answer('*://*.bsky.network/xrpc/*', 36, '{"labels":[{"val":"graphic-media"}]}');
  assert.equal(answer('*://x.com/i/api/graphql/*', -1, '{}'), null, 'no tab, nothing read');
  assert.deepEqual(sent, [30, 32, 33, 35].map((tab) => [tab, 'porn/porn.html']));
  assert.deepEqual(xs.written.map((d) => new TextDecoder().decode(d)), ['{"media":[{"sensitive_media_warning":{"adult_', 'content":true}}]}']);
  assert.ok(xs.closed);
  // every address read is one the manifest grants, or firefox would not hand over the answer
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../manifest.json'), 'utf8'));
  const granted = manifest.permissions.filter((p) => p.includes('://')).map((p) => p.split('/')[2]);
  for (const pattern of watched.flatMap((w) => w.filter.urls)) assert.ok(granted.includes(pattern.split('/')[2]), pattern);
  assert.ok(watched.every((w) => w.extra.includes('blocking')));
  sent.length = 0;
  // history changes on the blocked sites reach their tab at once
  assert.deepEqual(JSON.parse(JSON.stringify(on.historyFilter.url)), [{ hostEquals: 'x.com' }]);
  on.history({ frameId: 0, tabId: 7, url: 'https://x.com/home' });
  on.history({ frameId: 2, tabId: 7, url: 'https://x.com/i/frame' });
  assert.deepEqual(reported, [[7, 'https://x.com/home', 0]]);
  sent.length = 0;
  on.message('something else');
  on.message('chime');
  assert.equal(played.length, 1, 'the chime, and only on its own message');
  // the file it plays is in the repo and in the package
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
  assert.ok(fs.statSync(path.join(__dirname, '..', played[0])).size > 0, played[0]);
  assert.ok(!pkg.webExt.ignoreFiles.some((f) => played[0] === f || played[0].startsWith(`${f}/`)), 'not left out of the package');
  // time on social media: one writer for every tab, never more than the clock moved, each day from zero
  on.message({ used: 5000 });
  clock.now += 5000;
  on.message({ used: 5000 });
  on.message({ used: 5000 }); // a second window in use at the same moments
  await settle();
  assert.equal(saved.usage.ms, 10_000);
  clock.now += 24 * 60 * MIN;
  on.message({ used: 3000 });
  await settle();
  assert.equal(saved.usage.ms, 3000, 'a new day starts from zero');
  const page = { '--d2t-bg': 'rgb(10 20 30)', '--d2t-fg': '#fff' };
  assert.deepEqual(
    JSON.parse(JSON.stringify(saved.theme)),
    { ...page, '--d2t-card': 'rgb(10 20 30)', '--d2t-card-fg': '#fff', '--d2t-accent': '#0af' },
    'the field pair has a crafted value, so fields fall back to the page pair',
  );
  assert.equal(registered.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(registered[0].options)), {
    matches: ['*://x.com/*'],
    css: [{ code: 'html #dis2tract { --d2t-bg: rgb(10 20 30); --d2t-fg: #fff; --d2t-card: rgb(10 20 30); --d2t-card-fg: #fff; --d2t-accent: #0af; }' }],
    runAt: 'document_start',
  });
  current = { colors: null }; // switched to a theme without colors
  on.updated();
  await settle();
  assert.ok(registered[0].gone, 'the old stylesheet is unregistered');
  assert.equal(registered.length, 1, 'nothing to register for a colorless theme');
  assert.deepEqual(JSON.parse(JSON.stringify(saved.theme)), {});
  assert.equal(typeof on.click, 'function', 'the toolbar button opens the settings');
  assert.match(on.farewell, /^https:\/\/[^#?]+$/, 'a plain https page, nothing about the user appended');
  // android: no theme api, no error. a day later the list is due again, and a cut-off download keeps the last copy
  saved.pornList.at -= 86_400_000;
  download = 'one.test\n';
  sent.length = 0;
  background(false);
  await settle();
  assert.equal(fetched.length, 2);
  on.navigate({ frameId: 0, tabId: 7, url: 'https://example.test/' });
  assert.deepEqual(sent, [[7, 'porn/porn.html']]);
  assert.equal(saved.pornList.domains.length, 1001);
});
