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
  prepend(...xs) {
    for (const x of xs.reverse()) {
      x.remove();
      x.parentNode = this;
      this.children.unshift(x);
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
  // the selectors the scripts use: a tag, .class or tag[attr=value]
  matches(sel) {
    const [, tag, cls, attr, value] = /^(\w*)(?:\.([\w-]+))?(?:\[([\w-]+)=([\w-]+)\])?$/.exec(sel);
    return (!tag || this.tagName === tag.toUpperCase()) && (!cls || (this.getAttribute('class') ?? '').split(' ').includes(cls))
      && (!attr || this.getAttribute(attr) === value);
  }
  querySelector(sel) { return this.find((n) => n.matches(sel)); }
  querySelectorAll(sel) {
    const all = [];
    const walk = (n) => {
      for (const c of n.children) {
        all.push(c);
        walk(c);
      }
    };
    walk(this);
    return sel === '*' ? all : all.filter((n) => sel.split(',').some((s) => n.matches(s.trim())));
  }
  // focus moves, and the window's capturing listeners hear of it first, as in a browser
  focus() {
    this.doc.activeElement = this;
    let stopped = false;
    const e = { target: this, stopImmediatePropagation() { stopped = true; } };
    for (const f of this.doc.defaultView?.listeners.focusin ?? []) if (!stopped) f(e);
  }
  set textContent(v) { this.children = []; this.text = String(v); }
  get textContent() { return this.text + this.children.map((c) => c.textContent).join(''); }
}

// setup(doc, root, browser) runs before the scripts, to put the page in a starting state. doc.navigationType is how
// the page was loaded (performance navigation timing), 'navigate' unless set there
// session: a Map standing in for the tab's sessionStorage; without one the page has none, as when a site refuses it
function boot(url, stored = {}, setup = () => {}, session = null) {
  const clock = { now: NOON };
  const data = structuredClone(stored);
  const changeListeners = [];
  const messageListeners = []; // what background.js sends this tab
  const doc = { listeners: {}, body: null, activeElement: null, cookie: '', visibilityState: 'visible', readyState: 'loading', referrer: '' };
  const root = new El('html', doc);
  let stops = 0;
  const win = { listeners: {}, stop: () => { stops += 1; } };
  Object.assign(doc, {
    defaultView: win,
    documentElement: root,
    scrollingElement: root,
    createElement: (t) => new El(t, doc),
    getElementById: (id) => root.find((n) => n.getAttribute('id') === id),
    querySelector: () => null,
    querySelectorAll: (sel) => root.querySelectorAll(sel),
    addEventListener: (t, f) => (doc.listeners[t] ??= []).push(f),
  });
  win.addEventListener = (t, f) => (win.listeners[t] ??= []).push(f);
  // the browser's own methods: what the page's prototypes hold until the content script wraps them through firefox's
  // exportFunction, and what the content script always reads through its xray view of them
  const native = {
    play() {
      if (typeof this?.pause !== 'function') throw new TypeError('\'play\' called on an object that does not implement interface HTMLMediaElement.');
      this.paused = false;
      return Promise.resolve();
    },
    focus() { doc.activeElement = this; },
  };
  win.wrappedJSObject = {
    Promise,
    HTMLMediaElement: { prototype: { play: native.play } },
    HTMLElement: { prototype: { focus: native.focus } },
  };
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
  const uses = []; // when the page told the background page it is in use (time on social media)
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
  const browser = {
    extension: { inIncognitoContext: false },
    storage: { local: store, onChanged: { addListener: (f) => changeListeners.push(f) } },
    runtime: {
      sendMessage: async (message) => {
        if (message === 'chime') chimes.push(clock.now);
        else if (message === 'use') uses.push(clock.now);
      },
      onMessage: { addListener: (f) => messageListeners.push(f) },
    },
  };
  setup(doc, root, browser);
  const ctx = vm.createContext({
    URL,
    console,
    document: doc,
    location,
    innerHeight: 1000,
    window: win,
    queueMicrotask,
    exportFunction: (fn, target, { defineAs }) => { target[defineAs] = fn; },
    HTMLMediaElement: { prototype: { play: native.play } },
    HTMLElement: { prototype: { focus: native.focus } },
    performance: { getEntriesByType: (type) => (type === 'navigation' ? [{ type: doc.navigationType ?? 'navigate' }] : []) },
    ...(session && {
      sessionStorage: { getItem: (k) => session.get(k) ?? null, setItem: (k, v) => session.set(k, String(v)), removeItem: (k) => session.delete(k) },
    }),
    setTimeout: (f) => f(), // the sheet's closing delay, run at once
    setInterval: (f, ms) => timers.push({ f, ms }),
    clearInterval: (id) => { timers[id - 1] = null; },
    Date: class extends Date { static now() { return clock.now; } },
    browser,
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
    uses,
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
    // a video the page starts through its own play(), with sound unless told otherwise; its pause() stops it
    play(props) {
      const video = { paused: true, ended: false, muted: false, volume: 1, ...props, pause() { this.paused = true; } };
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
    // a plain left click on a link; returns whether the page's own handlers were kept from it. `link` changes the
    // link, `path` is what the event passed through on its way down, the link first
    click(href, extra = {}, link = {}) {
      let stopped = false;
      const a = { localName: 'a', href: new URL(href, location.href).href, target: '', ...link };
      const e = { button: 0, detail: 1, composedPath: () => [a, root, doc, win], preventDefault() { stopped = true; }, stopImmediatePropagation() {}, ...extra };
      for (const f of win.listeners.click ?? []) f(e);
      return stopped;
    },
    nav(v) {
      location.href = v;
      t.tick();
    },
    // firefox sets the address first, then fires popstate
    back(v) {
      location.href = v;
      for (const f of win.listeners.popstate) f({});
      t.tick();
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
  assert.equal(again.overlay().getAttribute('data-enter'), null, 'a page load, not a block while browsing: no fade');
  assert.equal(again.chimes.length, 0, 'and no bell');
  const later = boot('https://www.youtube.com/watch?v=e', { 'trail:youtube': { ...c.data['trail:youtube'], at: NOON - 2 * MIN } });
  await settle();
  assert.equal(later.reason(), null, 'after a minute the run is over');
});

test('a link from another site starts a new run; a reload or a link from the same site does not', async () => {
  const c = boot('https://www.reddit.com/r/aww/');
  await settle();
  for (const p of 'abcd') c.nav(`https://www.reddit.com/r/aww/comments/${p}/x/`);
  const trail = { 'trail:reddit': c.data['trail:reddit'] };
  const from = (referrer, navigationType = 'navigate') => (doc) => Object.assign(doc, { referrer, navigationType });
  const google = boot('https://www.reddit.com/r/aww/comments/e/x/', trail, from('https://www.google.com/'));
  await settle();
  assert.equal(google.reason(), null, 'the 5th thread in a row, opened from search results');
  const reloaded = boot('https://www.reddit.com/r/aww/comments/e/x/', trail, from('https://www.google.com/', 'reload'));
  await settle();
  assert.equal(reloaded.reason(), 'chain', 'firefox sends the first referrer again on a reload');
  const old = boot('https://www.reddit.com/r/aww/comments/e/x/', trail, from('https://old.reddit.com/r/aww/'));
  await settle();
  assert.equal(old.reason(), 'chain', 'another host of the same site');
});

test('a private window stores none of its browsing; its run of items stays in background.js memory', async () => {
  const kept = new Map(); // background.js's memory
  const incognito = (doc, root, browser) => {
    browser.extension.inIncognitoContext = true;
    const send = browser.runtime.sendMessage;
    browser.runtime.sendMessage = async (message) => {
      if (message?.trail) kept.set(message.trail, structuredClone(message.value));
      else if (message?.getTrail) return kept.get(message.getTrail) ?? null;
      else return send(message);
    };
  };
  const t = boot('https://www.youtube.com/results?search_query=x', { recent: [{ site: 'x', at: NOON - MIN }] }, incognito);
  await settle();
  for (const v of 'abcde') t.nav(`https://www.youtube.com/watch?v=${v}`);
  assert.equal(t.reason(), 'chain');
  assert.equal(t.data['trail:youtube'], undefined, 'no watched ids on disk');
  assert.deepEqual(t.data.recent, [{ site: 'x', at: NOON - MIN }], 'and no visit for the mirror of other windows');
  const again = boot('https://www.youtube.com/watch?v=e', {}, incognito);
  await settle();
  assert.equal(again.reason(), 'chain', 'a reload in the private window is still no way out');
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

test('back onto a feed is judged before the feed jumps on to an item; a hash change is no back/forward', async () => {
  for (const [start, feed, item, next] of [
    ['https://www.instagram.com/natgeo/', 'https://www.instagram.com/reels/', 'https://www.instagram.com/reels/A/', 'https://www.instagram.com/reels/B/'],
    ['https://www.youtube.com/@someone', 'https://www.youtube.com/shorts', 'https://www.youtube.com/shorts/A', 'https://www.youtube.com/shorts/B'],
  ]) {
    const t = boot(start);
    await settle();
    t.nav(feed);
    t.nav(item);
    assert.equal(t.reason(), 'feed');
    t.clock.now += 5000;
    t.go(feed); // back: firefox sets the address, then fires popstate
    for (const f of t.win.listeners.popstate) f({});
    t.go(next); // the site's own popstate handler jumps on, before the next look
    t.passed(feed); // and background.js's report comes after it
    t.clock.now += 400;
    t.tick();
    assert.equal(t.reason(), 'feed', next);
  }
  const h = boot('https://www.instagram.com/natgeo/');
  await settle();
  const anchor = (url) => {
    h.go(url); // an in-page anchor fires popstate too
    for (const f of h.win.listeners.popstate) f({});
    h.tick();
  };
  anchor('https://www.instagram.com/natgeo/#comments');
  h.clock.now += 60_000;
  h.go('https://www.instagram.com/reels/C0de/');
  h.passed('https://www.instagram.com/reels/');
  assert.equal(h.reason(), 'feed', 'the next feed jump is still carried');
  anchor('https://www.instagram.com/reels/C0de/#comments');
  assert.equal(h.reason(), 'feed', 'and an anchor on the carried item does not let it out');
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
  const sentence = t.find((n) => n.getAttribute('class') === 'd2t-sentence');
  assert.equal(sentence.getAttribute('translate'), 'no', 'a page translator would swap the very words to type');
  assert.equal(input.getAttribute('aria-describedby'), sentence.getAttribute('id'), 'a screen reader reads them with the field');
  const shown = sentence.textContent;
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
  const cut = boot('https://www.tiktok.com/foryou', { unlocks: [{ site: 'tiktok', at: NOON }] });
  await settle();
  cut.play();
  await cut.run(3000); // spent here, not saved yet
  await cut.setStorage({ unlocks: [{ site: 'tiktok', at: NOON }, { site: 'x', at: cut.clock.now }] });
  await settle();
  assert.equal(cut.reason(), 'feed');
  assert.equal(cut.data.spent, undefined, 'the time spent here is not charged to the newer unlock on x');
});

test('an unlock shows its time left over the page, in seconds near the end, and the block follows it', async () => {
  const pill = (t) => t.doc.documentElement.children.find((c) => c.getAttribute('id') === 'dis2tract-left') ?? null;
  const t = boot('https://www.tiktok.com/foryou', { unlocks: [{ site: 'tiktok', at: NOON }] });
  await settle();
  t.play();
  t.tick();
  assert.equal(pill(t).textContent, '3 min left');
  assert.equal(pill(t).getAttribute('data-ending'), null);
  assert.equal(t.overlay(), null, 'not the block screen: the page plays on');
  await t.run(160_000);
  assert.match(pill(t).textContent, /^\d+ s left$/);
  assert.equal(pill(t).getAttribute('data-ending'), '', 'the last 30 s stand out');
  await t.run(30_000);
  assert.equal(t.reason(), 'feed');
  assert.equal(pill(t), null);
  const at = (h, m) => new Date(2026, 9, 27, h, m).getTime();
  const late = boot('https://www.tiktok.com/foryou', { unlocks: [{ site: 'tiktok', at: at(22, 58) }] });
  late.clock.now = at(22, 59);
  await settle();
  late.tick();
  assert.equal(pill(late).textContent, '1 min left', 'bedtime ends it before its feed time runs out');
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

test('time spent just before leaving is saved, though firefox never answers a read on the way out', async () => {
  const t = boot('https://www.tiktok.com/foryou', { unlocks: [{ site: 'tiktok', at: NOON }] });
  await settle();
  t.play();
  await t.run(3000); // under the 5 s between saves
  t.ctx.browser.storage.local.get = () => new Promise(() => {}); // a page gone or in the back-forward cache
  for (const f of t.win.listeners.pagehide) f({});
  await settle();
  assert.ok(t.data.spent?.ms >= 2000, `${t.data.spent?.ms} ms`);
});

test('a jump into a feed blocks at once: a link click becomes a stopped full load, a router change is judged when reported', async () => {
  const t = boot('https://www.youtube.com/watch?v=abc');
  await settle();
  assert.equal(t.click('/'), true, 'the site never gets the click');
  assert.deepEqual(t.assigned, ['https://www.youtube.com/'], 'a full load instead, which stops at its start');
  assert.equal(t.chimes.length, 1, 'the bell goes with the click: the full load only paints and redraws');
  assert.equal(t.click('/@someone'), false, 'other links work as usual');
  assert.equal(t.click('/', { ctrlKey: true }), false, 'a new tab loads, and stops, by itself');
  assert.equal(t.click('/', {}, { target: '_blank' }), false, 'so does a link that opens one');
  assert.equal(t.click('/', {}, { target: 'player' }), false, 'or a named window');
  assert.equal(t.click('/', { detail: 2 }), true, 'a double click loads it once more');
  assert.equal(t.chimes.length, 1, 'with no second bell');
  // reddit draws home and popular in its left nav inside a web component: the click reaches the window retargeted
  // to the component, and only the composed path still holds the link
  const r = boot('https://www.reddit.com/r/aww/');
  await settle();
  const home = { localName: 'a', href: 'https://www.reddit.com/?feed=home', target: '' };
  assert.equal(r.click('/?feed=home', { composedPath: () => [{ localName: 'span' }, home, { localName: 'left-nav-top-section' }] }), true);
  assert.deepEqual(r.assigned, ['https://www.reddit.com/?feed=home']);
  assert.equal(r.click('/', { composedPath: () => [{ localName: 'a', href: { baseVal: '/' } }] }), false, 'an svg link is no page link');
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
  // 0.7.0 and older left their wrappers without the mark: dead after the update, they look like the page's own
  const update = boot('https://www.youtube.com/@someone', {}, (doc) => {
    const dead = () => { throw new TypeError('can\'t access dead object'); };
    doc.defaultView.wrappedJSObject.HTMLMediaElement.prototype.play = dead;
    doc.defaultView.wrappedJSObject.HTMLElement.prototype.focus = dead;
  });
  await settle();
  const clip = { paused: true, ended: false, pause() { this.paused = true; } };
  update.win.wrappedJSObject.HTMLMediaElement.prototype.play.call(clip);
  assert.equal(clip.paused, false, 'firefox\'s own play() stands in');
  const field = new El('input', update.doc);
  update.win.wrappedJSObject.HTMLElement.prototype.focus.call(field);
  assert.equal(update.doc.activeElement, field, 'and its own focus()');
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

test('a cooldown ending under the open block screen keeps the search being typed; so does a redraw', async () => {
  const t = boot('https://www.youtube.com/', { unlocks: [{ site: 'x', at: NOON - MIN }] });
  await settle();
  assert.match(t.unlockText(), /^next unlock at /);
  const search = () => t.find((n) => n.getAttribute('type') === 'search');
  const roast = () => t.find((n) => n.getAttribute('class') === 'd2t-answer');
  const q = search();
  const question = roast();
  q.value = 'lo-fi';
  q.focus();
  t.clock.now = NOON + 22 * MIN;
  t.tick();
  assert.match(t.unlockText(), /^unlock youtube/, 'the cooldown is over');
  assert.equal(search(), q, 'the same field: its text, focus and phone keyboard stay');
  assert.equal(t.doc.activeElement, q);
  assert.equal(roast(), question, 'and the same question');
  await t.setStorage({ settings: { version: 2, note: 'hi' } }); // a redraw: another tab saved the settings
  await settle();
  assert.notEqual(search(), q);
  assert.equal(search().value, 'lo-fi');
  assert.equal(t.doc.activeElement, search());
});

test('a move from one blocked feed to another under the block screen names the new one', async () => {
  const line = (t) => t.find((n) => n.getAttribute('class') === 'd2t-sub').children[0].textContent;
  const t = boot('https://www.youtube.com/');
  await settle();
  assert.equal(line(t), 'endless feed: youtube home.');
  t.clock.now += MIN;
  t.back('https://www.youtube.com/gaming');
  assert.equal(line(t), 'endless feed: youtube gaming.');
  assert.equal(t.data.recent.at(-1).at, NOON + MIN, 'and notes the attempt there');
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

test('a page back from the back-forward cache catches up on what changed while it was there', async () => {
  const t = boot('https://bsky.app/');
  await settle();
  assert.equal(t.reason(), 'feed');
  t.data.unlocks = [{ site: 'bluesky', at: NOON }]; // an unlock in another tab: firefox drops the event for a cached page
  for (const f of t.win.listeners.pageshow) await f({ persisted: true });
  assert.equal(t.reason(), null);
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

test('full-width digits from a japanese or chinese ime count as the number they show', async () => {
  const t = boot('https://x.com/home');
  await settle();
  vm.runInContext('Math.random = () => 0.5', t.ctx); // arithmetic: 31 × 6 + 50
  const { input, form } = startChallenge(t, 'x');
  type(input, '２３６');
  form.fire('submit');
  await settle();
  assert.equal(t.reason(), null);
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

test('a keyboard edit that deletes and then inserts (android\'s double-space period) keeps the space', async () => {
  const t = boot('https://x.com/home');
  await settle();
  const { input } = startChallenge(t, 'x');
  type(input, 'apple ');
  input.value = 'apple'; // the second space: the keyboard takes the first one out
  input.fire('input', { isTrusted: true });
  input.value = 'apple. '; // and puts '. ' in its place
  input.fire('input', { isTrusted: true });
  assert.equal(input.value, 'apple. ');
  input.value = 'apple.'; // a delete, then a paste
  input.fire('input', { isTrusted: true });
  input.value = 'apple.river stone';
  input.fire('input', { isTrusted: true });
  assert.equal(input.value, 'apple.', 'a paste after a delete is still undone');
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
  t.button('unlock x').fire('click');
  const under = t.overlay().children.filter((c) => c !== t.sheet().parentNode);
  assert.ok(under.length && under.every((c) => c.hasAttribute('inert')), 'shift+tab cannot reach the covered unlock button');
  for (const f of t.win.listeners.keydown) f({ type: 'keydown', key: 'Escape', isComposing: false, stopImmediatePropagation() {} });
  assert.equal(t.sheet(), null, 'escape closes it, like a dialog');
  assert.ok(under.every((c) => !c.hasAttribute('inert')));
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
  const early = boot('https://x.com/home', { settings: { version: 2, bedtimeFrom: 21 } });
  early.clock.now = at(21, 30);
  await settle();
  early.tick();
  assert.match(early.unlockText(), /^bedtime: no unlocks until /, 'bedtime made earlier in the settings');
});

test('a cooldown that ends at bedtime promises the morning, and the screen turns to bedtime at 23:00', async () => {
  const at = (h, m) => new Date(2026, 9, 27, h, m).getTime();
  const t = boot('https://www.youtube.com/', { unlocks: [{ site: 'x', at: at(22, 42) }] });
  t.clock.now = at(22, 50);
  await settle();
  t.tick();
  const night = boot('https://www.youtube.com/');
  night.clock.now = at(23, 30);
  await settle();
  night.tick();
  assert.match(night.unlockText(), /^bedtime: no unlocks until /);
  assert.equal(t.unlockText(), night.unlockText(), 'the morning, not the 23:05 the cooldown alone gives');
  const roast = () => t.find((n) => n.getAttribute('class') === 'd2t-answer').textContent;
  assert.ok(!roast().startsWith(t.ctx.LATE[0]));
  t.clock.now = at(23, 0);
  t.tick();
  assert.ok(roast().startsWith(t.ctx.LATE[0]), 'the open screen turns to the late-night question');
});

test('unlocks: spaced across all sites, a daily cap, and the old storage shape is ignored', async () => {
  const { cooldownMinutes, perDay, minutes } = boot('https://x.com/home').ctx.UNLOCK;
  const t = boot('https://www.youtube.com/', { unlocks: [{ site: 'x', at: NOON - MIN }] });
  await settle();
  assert.match(t.unlockText(), /^next unlock at /);
  t.clock.now = NOON - MIN + (minutes + cooldownMinutes) * MIN;
  t.tick();
  assert.match(t.unlockText(), /^unlock youtube for 3 min/, 'the button returns when the cooldown ends');
  assert.match(t.unlockText(), /9 of 10 unlocks left today\.$/, 'and what is left of the day\'s');
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
  assert.match(t.unlockText(), /^next unlock at .+\. 10 a day, 30 min apart\.$/, 'the wait it really is');
  t.clock.now = NOON + 32 * MIN;
  t.tick();
  assert.ok(t.button('unlock tiktok'));
  const late = boot('https://www.tiktok.com/foryou', ran(NOON - 3 * MIN));
  await settle();
  assert.equal(late.button('+1 min'), null, 'not once the grace window has passed');
  // an unlock used in pieces, run out 20 min after it began: an extra minute left half unused still waits 30 min
  // from when it was taken, not from the unlock's start
  const pieces = boot('https://www.tiktok.com/foryou', { unlocks: [{ site: 'tiktok', at: NOON - 20 * MIN, doneAt: NOON - 30_000 }], spent: { at: NOON - 20 * MIN, ms: 3 * MIN } });
  await settle();
  pieces.touch();
  pieces.button('+1 min').fire('click');
  await settle();
  pieces.play();
  await pieces.run(30_000);
  pieces.nav('https://www.tiktok.com/@someone');
  await settle();
  const x = boot('https://x.com/home', pieces.data);
  x.clock.now = NOON + 30 * MIN;
  await settle();
  x.tick();
  assert.match(x.unlockText(), /^next unlock at /);
  x.clock.now = NOON + 31 * MIN + 1000;
  x.tick();
  assert.ok(x.button('unlock x'));
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

test('time on social media: a note on every look while a page is in use, none behind the block screen', async () => {
  const t = boot('https://x.com/jack/status/1');
  await settle();
  t.touch();
  await t.run(2000);
  assert.deepEqual(t.uses, [400, 800, 1200, 1600, 2000].map((ms) => NOON + ms));
  t.nav('https://x.com/home');
  t.touch();
  await t.run(2000);
  assert.equal(t.uses.length, 5, 'none while the block screen is up');
  t.nav('https://x.com/search?q=cats');
  await t.run(20_000);
  assert.equal(t.uses.at(-1), NOON + 2000 + 10_000, 'none from 10 s after the last input');
});

test('a muted video counts as use for a minute after the last input; one with sound, while it plays', async () => {
  const t = boot('https://x.com/jack/status/1');
  await settle();
  t.touch();
  const clip = t.play({ muted: true });
  await t.run(2 * MIN);
  assert.equal(t.uses.at(-1), NOON + MIN, 'feeds loop muted clips on their own: nobody may be there');
  clip.muted = false;
  await t.run(MIN);
  assert.equal(t.uses.at(-1), NOON + 3 * MIN, 'with sound on, someone is listening');
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

test('tab focus stays in the block screen, and the page hears of none of it', async () => {
  const t = boot('https://x.com/home');
  await settle();
  const { input } = startChallenge(t, 'x');
  const heard = [];
  t.win.addEventListener('focusin', (e) => heard.push(e.target)); // a site's own focus trap, as on reddit
  new El('button', t.doc).focus(); // tabbing past the end lands on the page
  assert.equal(t.doc.activeElement, input, 'back in the answer field, not on the dialog');
  input.focus(); // a tap on the field
  assert.deepEqual(heard, [], 'a trap that blurs what took focus would close the phone keyboard on every tap');
  const free = boot('https://x.com/jack');
  await settle();
  const seen = [];
  free.win.addEventListener('focusin', (e) => seen.push(e.target));
  const link = new El('a', free.doc);
  link.focus();
  assert.deepEqual(seen, [link], 'an allowed page hears its focus as usual');
});

test('keys never reach the page behind the block screen; on an allowed page they do', async () => {
  const key = (t) => {
    let stopped = false;
    for (const f of t.win.listeners.keydown) f({ type: 'keydown', key: 'k', stopImmediatePropagation() { stopped = true; } });
    return stopped;
  };
  const t = boot('https://www.youtube.com/');
  await settle();
  assert.ok(key(t), 'youtube\'s k (play) and j (rewind) would act behind it');
  const free = boot('https://www.youtube.com/@someone');
  await settle();
  assert.ok(!key(free));
});

test('the block screen moves back to the end of the page, never while it holds focus', async () => {
  const t = boot('https://x.com/home');
  await settle();
  startChallenge(t, 'x');
  const body = new El('body', t.doc);
  t.doc.documentElement.append(body); // <body> comes after the block screen, and would paint above it
  t.tick();
  assert.equal(t.overlay().nextElementSibling, body, 'moving it would blur the field and close the phone keyboard');
  t.doc.activeElement = null;
  t.tick();
  assert.equal(t.overlay().nextElementSibling, null, 'moved once nothing in it has focus');
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
  assert.throws(() => media(t).play.call({}), TypeError, 'a page probing play() with something that is no player');
  t.nav('https://www.tiktok.com/foryou');
  assert.equal(earlier.paused, true, 'paused the moment the block screen comes up, the probe not kept as playing');
});

test('players in the page and in shadow roots (reddit\'s) are paused by the block, and again when they start', async () => {
  const t = boot('https://www.reddit.com/r/aww/');
  await settle();
  const video = (doc) => Object.assign(new El('video', doc), { paused: false, pause() { this.paused = true; } });
  const page = video(t.doc);
  const inner = video(t.doc);
  const host = new El('shreddit-player', t.doc);
  host.openOrClosedShadowRoot = new El('div', t.doc); // stands in for its shadow root
  host.openOrClosedShadowRoot.append(inner);
  t.doc.documentElement.append(page, host);
  t.scroll(0);
  for (let top = 500; top <= 12_000; top += 500) t.scroll(top);
  assert.equal(t.reason(), 'scroll');
  assert.ok(page.paused && inner.paused);
  page.paused = false;
  for (const f of t.doc.listeners.play) f({ target: page });
  inner.paused = false;
  host.openOrClosedShadowRoot.fire('play', { target: inner }); // a play event never leaves a shadow root
  assert.ok(page.paused && inner.paused, 'started again by the page: paused at once');
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
  assert.deepEqual(sub.children.map((s) => s.textContent), ['endless feed: tiktok for you.', 'go somewhere on purpose.'], 'one sentence per line');
});

test('youtube watch pages ask for theater mode, unless it is switched off', async () => {
  const t = boot('https://www.youtube.com/watch?v=a');
  await settle();
  assert.match(t.doc.cookie, /^wide=1/);
  assert.ok(!/max-age|expires/.test(t.doc.cookie), 'for this session only');
  assert.equal(t.data.wideSet, true, 'marked as written by dis2tract');
  const off = boot('https://www.youtube.com/watch?v=a', { settings: { version: 2, toggles: { 'youtube.theater': false } } });
  await settle();
  off.tick();
  assert.equal(off.doc.cookie, '');
  // a player the tweak never finds (the site changed): it gives up instead of writing the cookie every 400 ms
  let writes = 0;
  const lost = boot('https://www.youtube.com/watch?v=a', {}, (doc) => Object.defineProperty(doc, 'cookie', { set: () => { writes += 1; }, get: () => '' }));
  await settle();
  for (let i = 0; i < 40; i++) lost.tick();
  assert.equal(writes, 26);
});

test('theater mode or youtube switched off takes back the cookie dis2tract wrote, once', async () => {
  const off = { version: 2, toggles: { 'youtube.theater': false } };
  // marked as written by dis2tract, or not marked at all: up to 0.7.0 it was a year-long cookie with no mark
  for (const stored of [{ settings: off, wideSet: true }, { settings: { version: 2, sites: { youtube: false } }, wideSet: true }, { settings: off }]) {
    const t = boot('https://www.youtube.com/watch?v=a', stored, (doc) => { doc.cookie = 'wide=1'; });
    await settle();
    t.tick();
    await settle();
    assert.equal(t.doc.cookie, 'wide=; domain=.youtube.com; path=/; max-age=0', JSON.stringify(stored));
    assert.equal(t.data.wideSet, false, 'once');
  }
  // a wide layout picked by hand after that stays
  const own = boot('https://www.youtube.com/watch?v=a', { settings: off, wideSet: false }, (doc) => { doc.cookie = 'wide=1'; });
  await settle();
  own.tick();
  await settle();
  assert.equal(own.doc.cookie, 'wide=1');
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

test('a reload or new tab within a minute keeps what the page used of its scroll budget', async () => {
  const t = boot('https://www.reddit.com/r/aww/');
  await settle();
  t.scroll(0);
  for (let top = 500; top <= 12_000; top += 500) t.scroll(top);
  assert.equal(t.reason(), 'scroll');
  const reloaded = boot('https://www.reddit.com/r/aww/', { 'trail:reddit': t.data['trail:reddit'] });
  await settle();
  assert.equal(reloaded.reason(), 'scroll', 'a reload is not a fresh budget');
  const part = boot('https://www.reddit.com/r/aww/');
  await settle();
  part.scroll(0);
  for (let top = 500; top <= 11_000; top += 500) part.scroll(top);
  for (const f of part.win.listeners.pagehide) f({}); // reloaded at 11 screens
  const next = boot('https://www.reddit.com/r/aww/', { 'trail:reddit': part.data['trail:reddit'] });
  await settle();
  next.scroll(0);
  next.scroll(500);
  assert.equal(next.reason(), null);
  next.scroll(1000);
  assert.equal(next.reason(), 'scroll', 'one more screen');
});

test('the scroll budget is counted in screens: a taller or shorter window does not change what was used', async () => {
  const t = boot('https://www.reddit.com/r/aww/');
  await settle();
  t.ctx.innerHeight = 400;
  t.scroll(0);
  for (let top = 400; top <= 4800; top += 400) t.scroll(top);
  assert.equal(t.reason(), 'scroll');
  t.ctx.innerHeight = 900; // turned to portrait, or the window maximized
  t.tick();
  assert.equal(t.reason(), 'scroll', 'the block holds');
  const v = boot('https://www.reddit.com/r/aww/');
  await settle();
  v.ctx.innerHeight = 900;
  v.scroll(0);
  for (let top = 900; top <= 5400; top += 900) v.scroll(top); // half the budget
  v.ctx.innerHeight = 400; // a video fullscreened in landscape
  v.tick();
  assert.equal(v.reason(), null, 'no block halfway through');
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
  assert.equal(t.find((n) => n.tagName === 'H2').textContent, '24 screens deep', 'the budgets used, the extra one too');
  // the wait is for the page it was asked on: back to another page past its budget keeps this block screen
  const r = boot('https://www.reddit.com/r/pics/');
  await settle();
  const deep = () => {
    r.scroll(0);
    for (let top = 500; top <= 12_000; top += 500) r.scroll(top);
  };
  deep();
  r.back('https://www.reddit.com/r/aww/');
  deep();
  r.button('keep scrolling').fire('click');
  r.back('https://www.reddit.com/r/pics/');
  r.seconds(10);
  assert.equal(r.reason(), 'scroll', 'no budget for a page that did not wait');
  assert.equal(r.button('keep scrolling').disabled, false, 'its own offer is open');
  r.back('https://www.reddit.com/r/aww/');
  assert.equal(r.reason(), 'scroll', 'and the page that was left gets none either');
});

test('scrolling during an unlock counts: past the budget the page spends the unlock\'s minutes', async () => {
  const t = boot('https://www.reddit.com/r/aww/', { unlocks: [{ site: 'reddit', at: NOON }] });
  await settle();
  t.scroll(0);
  for (let top = 500; top <= 20_000; top += 500) t.scroll(top);
  t.touch();
  await t.run(10_000);
  assert.equal(t.reason(), null, 'the unlock lets it through');
  assert.ok(t.data.spent?.ms > 0, 'and its minutes run');
  t.play();
  await t.run(3 * MIN);
  assert.equal(t.reason(), 'scroll', 'blocked once they run out');
  assert.equal(t.find((n) => n.tagName === 'H2').textContent, '20 screens deep');
  t.button('keep scrolling').fire('click');
  t.seconds(10);
  assert.equal(t.reason(), null, 'one wait is a full budget from where the page is');
  for (let top = 20_500; top < 32_000; top += 500) t.scroll(top);
  assert.equal(t.reason(), null);
  t.scroll(32_000);
  assert.equal(t.reason(), 'scroll');
});

test('a feed opened from scratch stops loading at once; if it may show after all, it loads again, once', async () => {
  const session = new Map();
  const viewport = (x) => x.doc.documentElement.children.find((c) => c.tagName === 'META' && c.getAttribute('name') === 'viewport') ?? null;
  const t = boot('https://www.youtube.com/', {}, undefined, session);
  assert.equal(t.stops(), 1, 'stopped before the site loads');
  assert.ok(viewport(t), 'the site\'s own viewport meta never comes: a phone would lay the block screen out 980px wide');
  await settle();
  assert.equal(t.reason(), 'feed');
  assert.deepEqual(t.reloads, [], 'still blocked: nothing more to load');
  await t.setStorage({ unlocks: [{ site: 'youtube', at: t.clock.now }] });
  assert.deepEqual(t.reloads, ['https://www.youtube.com/'], 'unlocked: the page loads for real');
  const again = boot('https://www.youtube.com/', { unlocks: [{ site: 'youtube', at: NOON }] }, undefined, session);
  assert.equal(again.stops(), 0, 'the marked reload is let through');
  assert.equal(viewport(again), null, 'with the site\'s own viewport');
  assert.equal(session.size, 0, 'the mark is used once');
  await settle();
  assert.equal(again.reason(), null);
  assert.equal(boot('https://www.youtube.com/@someone', {}, undefined, new Map()).stops(), 0, 'other pages load as usual');
  assert.equal(boot('https://www.youtube.com/').stops(), 0, 'no stop where no mark could undo it');
});

test('an update or re-enable leaves pages already up alone: no stop, no reload, no block flashed over an open feed', async () => {
  const video = (doc) => Object.assign(new El('video', doc), { paused: false, pause() { this.paused = true; } });
  let clip;
  const t = boot('https://www.youtube.com/', { unlocks: [{ site: 'youtube', at: NOON }] }, (doc, root) => {
    doc.readyState = 'complete';
    clip = video(doc);
    root.append(clip);
  }, new Map());
  assert.equal(t.reason(), null, 'not covered with default settings first');
  await settle();
  assert.equal(t.reason(), null);
  assert.equal(t.stops(), 0);
  assert.deepEqual(t.reloads, []);
  assert.equal(clip.paused, false, 'its video plays on');
  // a page the old instance stopped and blocked stays covered, and loads for real once it may show
  const held = boot('https://www.youtube.com/', {}, (doc, root) => {
    doc.readyState = 'interactive';
    root.setAttribute('data-dis2tract-stopped', '');
    const stale = new El('div', doc);
    stale.setAttribute('id', 'dis2tract');
    root.append(stale);
  }, new Map());
  assert.equal(held.reason(), 'feed');
  await settle();
  assert.equal(held.stops(), 0, 'stopped once already');
  await held.setStorage({ unlocks: [{ site: 'youtube', at: NOON }] });
  assert.deepEqual(held.reloads, ['https://www.youtube.com/']);
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
  assert.equal(t.overlay().getAttribute('data-live'), null, 'the first paint takes the theme registered at load');
  await settle();
  assert.equal(t.overlay().style.props['--d2t-bg'], 'rgb(1 2 3)');
  assert.equal(t.overlay().getAttribute('data-live'), '', 'then the one in storage, which a theme switched since then wins');
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

// a file the extension loads at runtime must not be left out of the package. web-ext reads every webExt.ignoreFiles
// entry as a glob from the project root (* and ? within one name, ** across folders), and a folder left out takes
// everything in it (web-ext's src/util/file-filter.js, zip-dir 2.0.0, 2026-10)
const PKG = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
const GLOB = { '**/': '(.*/)?', '**': '.*', '*': '[^/]*', '?': '[^/]' };
const glob = (f) => path.posix.normalize(f).replace(/\/$/, '').replace(/[.+^$(){}|\\]/g, '\\$&').replace(/\*\*\/|\*\*|\*|\?/g, (m) => GLOB[m]);
const IGNORED = PKG.webExt.ignoreFiles.map((f) => new RegExp(`^${glob(f)}$`));
const packed = (file) => !file.split('/').some((_, i, parts) => IGNORED.some((re) => re.test(parts.slice(0, i + 1).join('/'))));

test('the porn page is built from the block screen\'s parts, look and theme, and says what set it off', async () => {
  const html = fs.readFileSync(path.join(__dirname, '../porn/porn.html'), 'utf8');
  const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(refs, ['../css/overlay.css', '../src/settings.js', '../src/ui.js', '../src/suggestions.js', 'porn.js']);
  // the page at an address (?host=, ?mark=, &skip from background.js). background: null in a private window
  const open = (search, { background = { theme: { '--d2t-bg': '#123456' } }, stored = {}, length = 1, reduced = false, refuse = false, hidden = false } = {}) => {
    const doc = {};
    const played = [];
    const went = []; // history.go() steps
    const shown = []; // visibilitychange listeners
    let changed;
    Object.assign(doc, {
      body: new El('body', doc),
      visibilityState: hidden ? 'hidden' : 'visible',
      addEventListener: (type, f) => type === 'visibilitychange' && shown.push(f),
      createElement: (t) => {
        const el = new El(t, doc);
        // a video that plays, or with refuse only muted, as in a firefox set to block sound even on extension pages.
        // removing the style attribute drops the theme painted into it
        if (t === 'video') {
          el.play = () => {
            played.push(el.src);
            return refuse && !el.muted ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve();
          };
        }
        el.removeAttribute = (k) => {
          if (k === 'style') el.style.props = {};
          El.prototype.removeAttribute.call(el, k);
        };
        return el;
      },
    });
    const ctx = vm.createContext({
      document: doc,
      URLSearchParams,
      location: { search },
      history: { length, go: (n) => went.push(n) },
      matchMedia: (q) => ({ matches: reduced && q === '(prefers-reduced-motion: reduce)' }),
      browser: {
        extension: { getBackgroundPage: () => background },
        tabs: {},
        storage: { local: { get: async () => stored }, onChanged: { addListener: (f) => (changed = f) } },
      },
    });
    for (const f of ['../src/settings.js', '../src/ui.js', '../src/suggestions.js', '../porn/porn.js']) {
      vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f });
    }
    const screen = doc.body.children[0];
    const has = (cls) => screen.find((n) => n.getAttribute('class') === cls);
    const button = (text) => screen.find((n) => n.tagName === 'BUTTON' && n.textContent === text);
    // what set it off: the lines above the buttons
    const why = has('d2t-unlock').find((n) => n.getAttribute('class') === 'd2t-sub')?.children.map((s) => s.textContent) ?? null;
    const show = () => {
      doc.visibilityState = 'visible';
      for (const f of shown.splice(0)) f();
    };
    return { screen, has, button, why, played, went, ctx, show, change: (theme) => changed({ theme: { newValue: theme } }, 'local') };
  };
  const page = open('?host=www.example.test');
  assert.equal(page.screen.getAttribute('id'), 'dis2tract');
  assert.equal(page.screen.style.props['--d2t-bg'], '#123456', 'the firefox theme, like the block screen');
  assert.equal(page.screen.find((n) => n.tagName === 'H2').textContent, 'no porn');
  assert.ok(page.has('d2t-sub') && page.has('d2t-answer') && page.has('d2t-unlock'));
  assert.equal(page.button('go back').hidden, true, 'nothing to go back to in a new tab');
  // the clip plays at once, with its controls showing: firefox gives an extension page sound without a click
  const clip = page.has('d2t-clip');
  assert.equal(clip.getAttribute('controls'), '');
  assert.deepEqual(page.played, [clip.src]);
  // every clip the page picks from, not only today's pick: in the repo and in the package, like the page itself and
  // every file it loads
  const clips = vm.runInContext('CLIPS', page.ctx);
  assert.ok(clips.includes(clip.src));
  for (const file of ['porn/porn.html', ...refs.map((r) => path.posix.join('porn', r)), ...clips.map((c) => `porn/${c}`)]) {
    assert.ok(fs.statSync(path.join(__dirname, '..', file)).size > 0, file);
    assert.ok(packed(file), `${file} is left out of the package`);
  }
  assert.ok(!packed('test/content.test.js') && !packed('docs/install.md'), 'the check sees what is left out');
  // what set it off, in the voice of the quotes: 38 characters a line at most, the address on a line of its own
  const LISTED = vm.runInContext('LISTED', page.ctx);
  const MARKED = vm.runInContext('MARKED', page.ctx);
  assert.deepEqual(page.why, ['www.example.test', LISTED]);
  for (const mark of ['x', 'reddit', 'bluesky']) assert.deepEqual(open(`?mark=${mark}`).why, [...MARKED[mark]]);
  for (const line of [LISTED, ...Object.values(MARKED).flat()]) assert.ok(line.length <= 38, `${line.length} characters: ${line}`);
  assert.equal(open('?mark=__proto__').why, null, 'an unknown mark names nothing');
  // go back: one step, or two where the caught page still sits right behind this one (android); never into it
  const went = (search, length) => {
    const p = open(search, { length });
    if (!p.button('go back').hidden) p.button('go back').fire('click');
    return p.went;
  };
  assert.deepEqual(went('?host=example.test', 2), [-1]);
  assert.deepEqual(went('?host=example.test&skip', 2), [], 'only the caught page behind it: nothing to go back to');
  assert.deepEqual(went('?mark=reddit&skip', 3), [-2]);
  // a private window has no background page: the theme comes from storage, and every later change follows
  const priv = open('?mark=x', { background: null, stored: { theme: { '--d2t-bg': '#654321' } } });
  await settle();
  assert.equal(priv.screen.style.props['--d2t-bg'], '#654321');
  priv.change({ '--d2t-fg': '#ffffff' });
  assert.deepEqual(priv.screen.style.props, { '--d2t-fg': '#ffffff' }, 'colors of the old theme are dropped');
  // reduced motion: the clip waits for its play button
  const still = open('?mark=x', { reduced: true });
  assert.deepEqual(still.played, []);
  assert.equal(still.has('d2t-clip').getAttribute('controls'), '');
  // a tab sent here while hidden: the clip starts once the tab is shown, not out of sight
  const away = open('?host=example.test', { hidden: true });
  assert.deepEqual(away.played, []);
  away.show();
  assert.deepEqual(away.played, [away.has('d2t-clip').src]);
  // sound refused: the clip plays muted, and its controls bring the sound back
  const hushed = open('?mark=x', { refuse: true });
  await settle();
  const muted = hushed.has('d2t-clip');
  assert.deepEqual(hushed.played, [muted.src, muted.src]);
  assert.equal(muted.muted, true);
  assert.equal(muted.getAttribute('controls'), '');
});

test('background: theme pairs become a document_start stylesheet and a storage mirror; bad colors are dropped', async () => {
  let saved = {};
  let current = { colors: { frame: [10, 20, 30], tab_background_text: '#fff', toolbar_field: 'red', toolbar_field_text: 'red} body {display:none', toolbar_field_border_focus: 'var(--x, url(https://collector.example/c.png))', tab_line: '#0af' } };
  const registered = [];
  const on = {};
  const played = [];
  const sent = []; // tabs sent elsewhere: [tabId, url], and 'replace' when the url takes the place of the current entry
  const reported = []; // history changes passed on to a tab: [tabId, url, frameId]
  const watched = []; // webRequest listeners: { f, filter, extra }
  // tabs open before the background page runs, with their frames: a listed page, a listed player inside another
  // site after a frame that has shown nothing yet (no url), a tab closed meanwhile (getAllFrames rejects) and a
  // discarded one (no frames)
  const open = {
    20: [{ frameId: 0, parentFrameId: -1, url: 'https://example.test/videos' }],
    21: [
      { frameId: 0, parentFrameId: -1, url: 'https://news.test/' },
      { frameId: 4, parentFrameId: 0 },
      { frameId: 5, parentFrameId: 0, url: 'https://example.test/embed/2' },
    ],
    22: 'closed',
    23: null,
  };
  class Audio {
    constructor(src) { this.src = src; }
    play() { played.push(this.src); }
  }
  const fakeBrowser = (withTheme) => ({
    runtime: {
      getManifest: () => ({ content_scripts: [{ matches: ['*://x.com/*'] }] }),
      getURL: (p) => p,
      getPlatformInfo: async () => ({ os: withTheme ? 'win' : 'android' }), // android: the one without a theme api
      onMessage: { addListener: (f) => (on.message = f) },
      openOptionsPage() {},
      setUninstallURL: (url) => (on.farewell = url),
    },
    webNavigation: {
      onBeforeNavigate: { addListener: (f) => (on.navigate = f) },
      onCommitted: { addListener: (f) => (on.committed = f) },
      onHistoryStateUpdated: { addListener: (f, filter) => Object.assign(on, { history: f, historyFilter: filter }) },
      getAllFrames: async ({ tabId }) => {
        if (open[tabId] === 'closed') throw new Error(`no tab with id ${tabId}`);
        return open[tabId];
      },
    },
    webRequest: {
      onBeforeRequest: { addListener: (f, filter, extra) => watched.push({ f, filter, extra }) },
    },
    tabs: {
      update: (tabId, { url, loadReplace }) => {
        sent.push(loadReplace ? [tabId, url, 'replace'] : [tabId, url]);
        if (Array.isArray(open[tabId])) open[tabId] = [{ frameId: 0, parentFrameId: -1, url: `moz-extension://d2t/${url}` }]; // shown now
      },
      sendMessage: async (tabId, message, options) => reported.push([tabId, message.url, options.frameId]),
      query: async () => Object.keys(open).map((id) => ({ id: Number(id) })),
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
  // a canvas in the background page, as firefox's behaves: anything that is not a plain color (var() too) leaves
  // fillStyle as it was, and a color reads back as #rrggbb, or rgba(r, g, b, a) when translucent. knows hex,
  // rgb() and rgba() with numbers, and red
  const parseColor = (v) => {
    const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(v === 'red' ? '#f00' : v)?.[1];
    if (hex) return [...(hex.length === 3 ? [...hex].map((x) => x + x) : hex.match(/../g)).map((x) => parseInt(x, 16)), 1];
    const m = /^rgba?\(([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+))?\)$/.exec(v);
    return m && [...m.slice(1, 4).map(Number), Number(m[4] ?? 1)];
  };
  const context2d = {
    style: '#000000',
    get fillStyle() { return this.style; },
    set fillStyle(v) {
      const [r, g, b, a] = parseColor(String(v)) ?? [];
      if (r === undefined) return;
      this.style = a === 1 ? `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}` : `rgba(${r}, ${g}, ${b}, ${a})`;
    },
  };
  const document = { createElement: () => ({ getContext: () => context2d }) };
  // the porn list download: oisd's format, a comment and one domain per line. co.cz is a public suffix it names
  let download = `# oisd nsfw small\n${Array.from({ length: 1000 }, (_, i) => `site${i}.test`).join('\n')}\nexample.test\nco.cz\n`;
  const fetched = []; // { url, ...options }
  const fetch = async (url, options) => {
    fetched.push({ url, ...options });
    return { ok: true, text: async () => download };
  };
  const clock = { now: NOON };
  const timeouts = []; // run by hand, when the test lets that time pass
  const background = (withTheme) => {
    const ctx = vm.createContext({
      browser: fakeBrowser(withTheme), document, console, Audio, URL, URLSearchParams, TextDecoder, fetch,
      setInterval: () => 0, setTimeout: (f) => timeouts.push(f), Date: class extends Date { static now() { return clock.now; } },
    });
    vm.runInContext(read('background.js'), ctx, { filename: 'background.js' });
    return ctx;
  };
  const bg = background(true);
  await settle();
  // porn: the list comes from a host the manifest grants, so firefox sends the download as the extension's own,
  // without the moz-extension origin (this install's id) a cross-origin request carries, and with no cookies
  assert.equal(new URL(fetched[0].url).hostname, 'raw.githubusercontent.com');
  assert.ok(JSON.parse(fs.readFileSync(path.join(__dirname, '../manifest.json'), 'utf8')).permissions.includes('*://raw.githubusercontent.com/*'));
  assert.equal(fetched[0].credentials, 'omit');
  assert.equal(saved.pornList.domains.length, 1002, 'kept for offline starts');
  // tabs already open when the list came in are checked too: a listed page, and a listed player inside a page
  assert.deepEqual(sent.sort(([a], [b]) => a - b), [20, 21].map((tab) => [tab, 'porn/porn.html?host=example.test', 'replace']));
  sent.length = 0;
  // a top-level load of a listed site or any subdomain of it goes to the extension's page before it loads, so back
  // leads to the page before. a page caught once committed (a redirect, a page with a listed frame) is replaced
  on.navigate({ frameId: 0, tabId: 7, url: 'https://www.example.test/videos' });
  on.navigate({ frameId: 3, tabId: 8, url: 'https://example.test/embed/1' }); // a frame starting: a blocker may still cancel it
  on.committed({ frameId: 3, tabId: 8, url: 'https://example.test/embed/1' }); // the player inside another site, loaded
  on.committed({ frameId: 0, tabId: 9, url: 'https://example.test/' }); // where a short link redirected to
  on.navigate({ frameId: 0, tabId: 10, url: 'https://example.test./' }); // a trailing dot
  on.navigate({ frameId: 0, tabId: 11, url: 'https://anything.xxx/' }); // an adult top-level domain
  on.navigate({ frameId: 0, tabId: 12, url: 'https://notexample.test/' }); // only a look-alike name
  on.navigate({ frameId: 0, tabId: 13, url: 'about:blank' });
  on.committed({ frameId: 0, tabId: 15, url: 'https://www-example-test.translate.goog/?_x_tr_sl=auto&_x_tr_tl=en' }); // google translate's copy
  on.navigate({ frameId: 0, tabId: 16, url: 'https://test.translate.goog/?_x_tr_hp=example-' }); // its form for long names
  on.committed({ frameId: 0, tabId: 17, url: 'https://www-notexample-test.translate.goog/' }); // a copy of a site not listed
  on.navigate({ frameId: 0, tabId: 18, url: 'https://shop.co.cz/' }); // under a public suffix the list names
  await settle();
  assert.deepEqual(sent.sort(([a], [b]) => a - b), [
    [7, 'porn/porn.html?host=www.example.test'],
    [8, 'porn/porn.html?host=example.test', 'replace'],
    [9, 'porn/porn.html?host=example.test', 'replace'],
    [10, 'porn/porn.html?host=example.test'],
    [11, 'porn/porn.html?host=anything.xxx'],
    [15, 'porn/porn.html?host=www.example.test', 'replace'],
    [16, 'porn/porn.html?host=example.test'],
  ]);
  assert.ok(fs.statSync(path.join(__dirname, '../porn/porn.html')).size > 0);
  // more of google's own decoding examples (developers.google.com/search/docs/appearance/ad-network-and-translation):
  // a doubled '-', internationalized names (0-, their xn-- dropped), a leading 1-, a long name's start in _x_tr_hp
  const untranslated = (url) => vm.runInContext('untranslated', bg)(new URL(url), new URL(url).hostname);
  for (const [url, host] of [
    ['https://foo--example-com.translate.goog/', 'foo-example.com'],
    ['https://0-57hw060o-com.translate.goog/?_x_tr_enc=0', 'xn--57hw060o.com'],
    ['https://1-0-----16pw588q-com.translate.goog/?_x_tr_enc=0,1', 'xn----16pw588q.com'],
    ['https://g5h3969ntadg44juhyah3c9aza87iiar4i410avdl8d3f1fuq3nz05dg5b-com.translate.goog/?_x_tr_enc=0&_x_tr_hp=0-', 'xn--g5h3969ntadg44juhyah3c9aza87iiar4i410avdl8d3f1fuq3nz05dg5b.com'],
  ]) assert.equal(untranslated(url), host, url);
  // a trailing dot on one of the sites: the same address without it, where the rules apply. other sites keep it
  sent.length = 0;
  on.navigate({ frameId: 0, tabId: 14, url: 'https://x.com./home' });
  on.navigate({ frameId: 0, tabId: 19, url: 'https://news.example./' });
  assert.deepEqual(sent, [[14, 'https://x.com/home']]);
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
  on.message('chime', { tab: { mutedInfo: { muted: true } } }); // a tab the user muted
  on.message('chime', { tab: { mutedInfo: { muted: false } } });
  await settle();
  assert.equal(played.length, 1, 'the chime, only on its own message and never for a muted tab');
  // a private window's run of items is kept in memory, never written to storage
  const before = JSON.stringify(saved);
  on.message({ trail: 'trail:youtube', value: { chain: ['a', 'b'], at: NOON } });
  assert.deepEqual(JSON.parse(JSON.stringify(await on.message({ getTrail: 'trail:youtube' }))), { chain: ['a', 'b'], at: NOON });
  assert.equal(await on.message({ getTrail: 'trail:x' }), null);
  assert.equal(JSON.stringify(saved), before, 'nothing on disk');
  // the file it plays is in the repo and in the package
  assert.ok(fs.statSync(path.join(__dirname, '..', played[0])).size > 0, played[0]);
  assert.ok(packed(played[0]), 'not left out of the package');
  // time on social media: the time between notes from any tabs under 2 s apart, one writer, each day from zero
  const look = (ms) => {
    clock.now += ms;
    on.message('use');
  };
  const save = async () => {
    for (const f of timeouts.splice(0)) f();
    await settle();
  };
  look(0);
  for (let i = 0; i < 25; i++) look(400); // 10 s in use
  for (let i = 0; i < 50; i++) look(200); // two windows in use, their notes 200 ms apart: 10 s, not 20
  look(60_000); // a sleeping machine
  look(-3_600_000); // the clock set back an hour
  look(400);
  await save();
  assert.equal(saved.usage.ms, 20_400);
  clock.now += 24 * 60 * MIN;
  look(0);
  look(1000);
  await save();
  assert.equal(saved.usage.ms, 1000, 'a new day starts from zero');
  const themed = () => JSON.parse(JSON.stringify(saved.theme));
  assert.deepEqual(
    themed(),
    { '--d2t-bg': '#0a141e', '--d2t-fg': '#ffffff', '--d2t-card': '#0a141e', '--d2t-card-fg': '#ffffff', '--d2t-accent': '#00aaff' },
    'the field pair has a crafted value, so fields fall back to the page pair; a var() focus color is no color',
  );
  assert.equal(registered.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(registered[0].options)), {
    matches: ['*://x.com/*'],
    css: [{ code: 'html #dis2tract:not([data-live]) { --d2t-bg: #0a141e; --d2t-fg: #ffffff; --d2t-card: #0a141e; --d2t-card-fg: #ffffff; --d2t-accent: #00aaff; }' }],
    runAt: 'document_start',
  });
  // a translucent field goes out as it shows over the page, so the unlock sheet never lets the block screen through.
  // the tab accent is too light for that field and each text color vanishes on the other side: the gray between
  current = { colors: { frame: '#000', tab_background_text: '#fff', toolbar_field: 'rgba(255, 255, 255, 0.9)', toolbar_field_text: '#000', tab_line: '#0af' } };
  on.updated();
  await settle();
  assert.deepEqual(themed(), { '--d2t-bg': '#000000', '--d2t-fg': '#ffffff', '--d2t-card': '#e6e6e6', '--d2t-card-fg': '#000000', '--d2t-accent': '#6e6e6e' });
  // firefox color's default preset: white on light blue, 2.2:1, so the default palette stays
  current = { colors: { frame: 'rgb(142, 179, 201)', tab_background_text: '#fff' } };
  on.updated();
  await settle();
  assert.deepEqual(themed(), {});
  assert.equal(registered.length, 2, 'nothing to register for an unreadable theme');
  current = { colors: null }; // switched to a theme without colors
  on.updated();
  await settle();
  assert.ok(registered.every((r) => r.gone), 'the old stylesheets are unregistered');
  assert.equal(registered.length, 2, 'nothing to register for a colorless theme');
  assert.deepEqual(themed(), {});
  assert.equal(typeof on.click, 'function', 'the toolbar button opens the settings');
  assert.match(on.farewell, /^https:\/\/[^#?]+$/, 'a plain https page, nothing about the user appended');
  // android: no theme api, no error. a day later the list is due again, and a cut-off download keeps the last copy
  saved.pornList.at -= 86_400_000;
  download = 'one.test\n';
  sent.length = 0;
  played.length = 0;
  open[20] = [{ frameId: 0, parentFrameId: -1, url: 'https://example.test/videos' }]; // tabs restored at the next start
  open[21] = [{ frameId: 0, parentFrameId: -1, url: 'https://shop.co.cz/' }];
  background(false);
  await settle();
  assert.equal(fetched.length, 2);
  // android cannot replace a history entry: a page caught once committed stays behind the porn page, which is told
  // to step over it. the open tabs are checked from the stored copy, its exceptions included
  assert.deepEqual(sent, [[20, 'porn/porn.html?host=example.test&skip']]);
  sent.length = 0;
  on.navigate({ frameId: 0, tabId: 7, url: 'https://example.test/' });
  on.committed({ frameId: 0, tabId: 9, url: 'https://example.test/' });
  on.navigate({ frameId: 0, tabId: 18, url: 'https://shop.co.cz/' });
  // and no chime there: it would stop audio playing in other tabs
  on.message('chime', { tab: { mutedInfo: { muted: false } } });
  await settle();
  assert.deepEqual(sent, [[7, 'porn/porn.html?host=example.test'], [9, 'porn/porn.html?host=example.test&skip']]);
  assert.equal(played.length, 0);
  assert.equal(saved.pornList.domains.length, 1002);
});

test('background: an adult mark counts only on the item the tab\'s address names, and a marked answer never reaches the page', async () => {
  const sent = []; // [tabId, tabs.update properties]
  const watched = []; // webRequest listeners: { f, filter }
  const streams = {}; // response filters by request id
  const addresses = {}; // each tab's address now; none for a tab on a site without host permission
  const browser = {
    runtime: {
      getManifest: () => ({ content_scripts: [{ matches: ['*://x.com/*'] }] }),
      getURL: (p) => p,
      getPlatformInfo: async () => ({ os: 'win' }),
      onMessage: { addListener() {} },
      setUninstallURL() {},
    },
    webNavigation: { onBeforeNavigate: { addListener() {} }, onCommitted: { addListener() {} }, onHistoryStateUpdated: { addListener() {} } },
    webRequest: {
      onBeforeRequest: { addListener: (f, filter) => watched.push({ f, filter }) },
      filterResponseData: (id) => (streams[id] = { written: [], write(d) { this.written.push(d); }, close() { this.closed = true; } }),
    },
    tabs: { get: async (tabId) => ({ url: addresses[tabId] }), update: (tabId, props) => sent.push([tabId, props]), query: async () => [] },
    browserAction: { onClicked: { addListener() {} } },
    storage: { local: { get: async () => ({}), set: async () => {} } },
  };
  const document = { createElement: () => ({ getContext: () => ({}) }) };
  // the porn list download never answers: only the labels are under test
  vm.runInContext(read('background.js'), vm.createContext({ browser, document, console, URL, URLSearchParams, TextDecoder, fetch: () => new Promise(() => {}), setInterval() {} }));
  const pattern = { x: '*://x.com/i/api/graphql/*', reddit: '*://*.reddit.com/*', bluesky: '*://public.api.bsky.app/xrpc/*' };
  let tabs = 0;
  // one request from a tab at that address, its answer split the way a response streams in: what went to the porn
  // page and what reached the page
  const answer = async ({ site, address, request = address, type = 'xmlhttprequest' }, ...chunks) => {
    const tabId = ++tabs;
    addresses[tabId] = address;
    watched.find((w) => w.filter.urls.includes(pattern[site])).f({ requestId: tabId, tabId, type, url: request });
    const stream = streams[tabId];
    for (const chunk of chunks) {
      if (!stream || stream.closed) break; // no events once a filter is closed
      stream.ondata({ data: new TextEncoder().encode(chunk) });
      await settle();
    }
    if (stream && !stream.closed) stream.onstop();
    await settle();
    return { sent: sent.filter(([t]) => t === tabId).map(([, props]) => ({ ...props })), page: stream?.written.map((d) => new TextDecoder().decode(d)).join('') };
  };
  const PORN = (site) => [{ url: `porn/porn.html?mark=${site}`, loadReplace: true }];

  // x: a post the way TweetDetail and the timelines carry it (twscrape's live captures): the handle in the author's
  // core, the media's flags in legacy
  const post = (id, handle, flags, more) => ({
    __typename: 'Tweet', rest_id: id, core: { user_results: { result: { __typename: 'User', core: { screen_name: handle } } } },
    legacy: { user_id_str: `9${id}`, extended_entities: { media: [{ sensitive_media_warning: flags }] } }, ...more,
  });
  const timeline = (...posts) => JSON.stringify({ data: { instructions: [{ entries: posts.map((result) => ({ content: { itemContent: { tweet_results: { result } } } })) }] } });
  const call = (name, variables) => `https://x.com/i/api/graphql/q/${name}?variables=${encodeURIComponent(JSON.stringify(variables))}`;
  const status = { site: 'x', address: 'https://x.com/alice/status/1', request: call('TweetDetail', { focalTweetId: '1' }) };
  const adult = timeline(post('1', 'alice', { adult_content: true }));
  assert.deepEqual(await answer(status, adult.slice(0, 50), adult.slice(50)), { sent: PORN('x'), page: '' }, 'the opened post: none of it reaches the page');
  // a stranger's marked reply, and a marked post the opened one quotes, are neighbours; violence is no adult mark
  const thread = timeline(post('1', 'alice', { graphic_violence: true }, { quoted_status_result: { result: post('2', 'bob', { adult_content: true }) } }), post('3', 'carol', { adult_content: true }));
  assert.deepEqual(await answer(status, thread.slice(0, 99), thread.slice(99)), { sent: [], page: thread }, 'passed on unchanged');
  assert.deepEqual((await answer(status, adult.slice(0, 50))).sent, [], 'an answer cut off by leaving the page');
  assert.deepEqual((await answer({ ...status, address: 'https://x.com/home' }, adult)).sent, [], 'the page moved on before the answer ended');
  assert.deepEqual((await answer({ ...status, address: undefined }, adult)).sent, [], 'the tab went to another site');
  // a profile and its tabs: the profile's own posts in its timelines, not a post it reposts
  const media = { site: 'x', address: 'https://x.com/Alice/media', request: call('UserMedia', { userId: '91' }) };
  assert.deepEqual((await answer(media, timeline(post('1', 'alice', { adult_content: true })))).sent, PORN('x'));
  const repost = post('5', 'alice', {}, { legacy: { user_id_str: '91', retweeted_status_result: { result: post('6', 'bob', { adult_content: true }) } } });
  assert.deepEqual((await answer(media, timeline(repost))).sent, []);
  // x's own pages sit where a handle would, and their calls carry no profile's userId
  assert.deepEqual((await answer({ site: 'x', address: 'https://x.com/home', request: call('HomeTimeline', { count: 20 }) }, timeline(post('7', 'home', { adult_content: true })))).sent, []);

  // reddit: the post of the address by its own nsfw or its community's subreddit-nsfw, as the page streams in. a
  // title, a community description and a related post beside it are no marks
  const page = { site: 'reddit', address: 'https://www.reddit.com/r/pics/comments/abc/cats/', type: 'main_frame' };
  const clean = ['<shreddit-subreddit-header name="pics" description="be civil, no nsfw posts.">', '<shreddit-post id="t3_rel" nsfw="">', '<shreddit-post id="t3_abc" post-title="is this nsfw > or not" subreddit-prefixed-name="r/pics">', '<div>comments</div>'];
  assert.deepEqual(await answer(page, ...clean), { sent: [], page: clean.join('') });
  // the chunk that completes the marked tag, and all after it, never reach the page
  assert.deepEqual(await answer(page, '<p>header</p><shreddit-post id="t3_abc" post-title="a > b" ', 'score="5" nsfw="">', '<img src="https://i.redd.it/x.jpg">'), { sent: PORN('reddit'), page: '<p>header</p><shreddit-post id="t3_abc" post-title="a > b" ' });
  assert.deepEqual((await answer({ ...page, address: 'https://old.reddit.com/r/pics/comments/abc/cats/' }, '<div class=" thing id-t3_abc odd link over18 " id="thing_t3_abc" data-fullname="t3_abc">')).sent, PORN('reddit'));
  // a subreddit by its community mark, not by a marked post in it; search names no item and is not read at all
  const sub = { ...page, address: 'https://www.reddit.com/r/pics/' };
  assert.deepEqual((await answer(sub, '<shreddit-post id="t3_a" subreddit-prefixed-name="r/pics" nsfw="">')).sent, []);
  assert.deepEqual((await answer({ ...sub, address: 'https://www.reddit.com/r/Adult_Sub/' }, '<shreddit-post id="t3_b" subreddit-prefixed-name="r/Adult_Sub" nsfw="" subreddit-nsfw="">')).sent, PORN('reddit'));
  // in 2025 the posts of an adult community carried only their own mark; the page data after them names the community's
  const older = ['<shreddit-post id="t3_d" subreddit-prefixed-name="r/Adult_Sub" nsfw="">', '<reddit-page-data data="{&quot;subreddit&quot;:{&quot;isNsfw&quot;:true,&quot;prefixedName&quot;:&quot;r/Adult_Sub&quot;}}">'];
  assert.deepEqual(await answer({ ...sub, address: 'https://www.reddit.com/r/Adult_Sub/' }, ...older), { sent: PORN('reddit'), page: older[0] });
  assert.deepEqual(await answer({ ...sub, address: 'https://www.reddit.com/search/?q=nsfw' }, '<shreddit-post id="t3_c" nsfw="">'), { sent: [], page: undefined });
  // a partial is judged by the tab's address
  const partial = { site: 'reddit', address: page.address, request: 'https://www.reddit.com/svc/shreddit/partial' };
  assert.deepEqual((await answer(partial, '<shreddit-post id="t3_abc" nsfw="">')).sent, PORN('reddit'));
  assert.deepEqual(await answer({ ...partial, address: 'https://www.reddit.com/user/bob/' }, '<shreddit-post id="t3_abc" nsfw="">'), { sent: [], page: '<shreddit-post id="t3_abc" nsfw="">' });

  // bluesky: the post of the address by its own labels (self-labels among them), a profile by its own and its posts'
  const view = (who, rkey, labels = [], author = []) => ({
    uri: `at://did:plc:${who}/app.bsky.feed.post/${rkey}`, author: { did: `did:plc:${who}`, handle: `${who}.test`, labels: author.map((val) => ({ val })) },
    record: {}, labels: labels.map((val) => ({ src: 'did:plc:mod', val })),
  });
  const thread2 = (anchor, ...replies) => JSON.stringify({ thread: [anchor, ...replies].map((p, depth) => ({ depth, value: { post: p } })) });
  const opened = { site: 'bluesky', address: 'https://bsky.app/profile/alice.test/post/3k' };
  assert.deepEqual((await answer(opened, thread2(view('alice', '3k'), view('bob', '3m', ['porn'], ['porn'])))).sent, [], 'a stranger\'s labeled reply');
  assert.deepEqual((await answer(opened, JSON.stringify({ notifications: [{ uri: 'at://did:plc:bob/app.bsky.graph.follow/1', reason: 'follow', author: view('bob', '1', [], ['porn']).author }] }))).sent, [], 'a labeled follower in the notification poll');
  assert.deepEqual((await answer(opened, thread2(view('alice', '3k', ['nudity'])))).sent, [], 'non-sexual nudity');
  assert.deepEqual((await answer(opened, thread2(view('alice', '3k', ['sexual-figurative'])))).sent, PORN('bluesky'));
  const profile = { site: 'bluesky', address: 'https://bsky.app/profile/alice.test' };
  assert.deepEqual((await answer(profile, JSON.stringify({ did: 'did:plc:alice', handle: 'alice.test', labels: [{ val: 'porn' }] }))).sent, PORN('bluesky'));
  assert.deepEqual((await answer(profile, JSON.stringify({ feed: [{ post: view('alice', '1', ['sexual']) }] }))).sent, PORN('bluesky'));
  assert.deepEqual((await answer(profile, JSON.stringify({ feed: [{ post: view('bob', '2', ['porn']), reason: { by: view('alice').author } }] }))).sent, [], 'a repost');
  watched[0].f({ requestId: 'none', tabId: -1, type: 'xmlhttprequest', url: status.request });
  assert.equal(streams.none, undefined, 'no tab, nothing read');
});
