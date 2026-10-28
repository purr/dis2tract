// runs the real content script against a minimal fake dom, driving url changes, timers and storage by hand
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '../src', f), 'utf8');
const settle = () => new Promise((r) => setImmediate(r));
const SCRIPTS = ['settings.js', 'sites.js', 'challenges.js', 'suggestions.js', 'content.js'];
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
  get dataset() { return new Proxy({}, { get: (_, p) => this.getAttribute(`data-${String(p)}`) ?? undefined }); }
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
function boot(url, stored = {}, setup = () => {}) {
  const clock = { now: NOON };
  const data = structuredClone(stored);
  const changeListeners = [];
  const doc = { listeners: {}, body: null, activeElement: null, cookie: '' };
  const root = new El('html', doc);
  const win = { listeners: {} };
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
  const location = {
    get href() { return loc.href; },
    set href(v) { loc.href = new URL(v, loc).href; },
    get hostname() { return loc.hostname; },
    assign(v) { assigned.push(v); },
  };
  const timers = [];
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
    setTimeout: (f) => f(), // the sheet's closing delay, run at once
    setInterval: (f, ms) => timers.push({ f, ms }),
    clearInterval: (id) => { timers[id - 1] = null; },
    Date: class extends Date { static now() { return clock.now; } },
    browser: { storage: { local: store, onChanged: { addListener: (f) => changeListeners.push(f) } } },
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
    assigned,
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

// types like a person: one word per input event
function type(input, text) {
  const ws = text.split(' ');
  for (let i = 1; i <= ws.length; i++) {
    input.value = ws.slice(0, i).join(' ');
    input.fire('input');
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
  const x = boot('https://x.com/jack');
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
  t.clock.now += 3 * MIN - 1000;
  t.tick();
  assert.equal(t.reason(), null);
  t.clock.now += 2000;
  t.tick();
  assert.equal(t.reason(), 'feed');
});

test('a wrong enter costs time, and a second enter is not a second penalty', async () => {
  const t = boot('https://x.com/home');
  await settle();
  const { input, form } = startChallenge(t, 'x');
  input.value = 'definitely wrong';
  form.fire('submit');
  form.fire('submit');
  await settle();
  assert.equal(t.data.unlockBan, NOON + 15_000 + t.ctx.UNLOCK.penaltyMinutes * MIN);
  assert.equal(t.data.stats.wrong, 1);
  assert.match(t.unlockText(), /^next unlock at /);
});

test('a whole sentence arriving in one input (clipboard chip, dictation) is undone', async () => {
  const t = boot('https://x.com/home');
  await settle();
  const { input, shown } = startChallenge(t, 'x');
  type(input, 'apple');
  input.value = shown;
  input.fire('input');
  assert.equal(input.value, 'apple');
  await settle();
  assert.equal(t.reason(), 'feed');
});

test('enter in the sentence field answers: a wrong one costs time', async () => {
  const t = boot('https://x.com/home');
  await settle();
  const { input } = startChallenge(t, 'x');
  type(input, 'not the sentence');
  let kept = true;
  input.fire('beforeinput', { inputType: 'insertLineBreak', preventDefault: () => { kept = false; } });
  assert.ok(!kept, 'no new line');
  await settle();
  assert.ok(t.data.unlockBan > NOON);
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
  const t = boot('https://www.tiktok.com/foryou', { unlocks: [{ site: 'tiktok', at: NOON - 3 * MIN - 30_000 }] });
  await settle();
  assert.equal(t.reason(), 'feed');
  t.button('+1 min').fire('click');
  await settle();
  assert.equal(t.reason(), null, 'open again');
  t.clock.now += MIN;
  t.tick();
  assert.equal(t.reason(), 'feed');
  assert.equal(t.button('+1 min'), null, 'only once');
  // the extended unlock ended at NOON + 30 s; the next one waits the longer cooldown from there
  assert.match(t.unlockText(), /^next unlock at /);
  t.clock.now = NOON + 30_000 + 30 * MIN;
  t.tick();
  assert.ok(t.button('unlock tiktok'));
  const late = boot('https://www.tiktok.com/foryou', { unlocks: [{ site: 'tiktok', at: NOON - 6 * MIN }] });
  await settle();
  assert.equal(late.button('+1 min'), null, 'not once the grace window has passed');
});

test('the mirror names the other apps the user went for just before, and only then', async () => {
  const mirror = (t) => t.find((n) => n.getAttribute('class') === 'd2t-mirror')?.textContent;
  const t = boot('https://www.tiktok.com/foryou', { recent: [{ site: 'x', at: NOON - 2 * MIN }, { site: 'youtube', at: NOON - 30_000 }] });
  await settle();
  assert.equal(mirror(t), 'x 2 min ago, youtube just now, now tiktok. same urge, new app.');
  assert.equal(t.data.stats.hops, 1);
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
  const t = boot('https://x.com/jack');
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

test('background: theme pairs become a document_start stylesheet and a storage mirror; bad colors are dropped', async () => {
  let saved;
  let current = { colors: { frame: [10, 20, 30], tab_background_text: '#fff', toolbar_field: 'red', toolbar_field_text: 'red} body {display:none', tab_line: '#0af' } };
  const registered = [];
  const on = {};
  const fakeBrowser = (withTheme) => ({
    runtime: { getManifest: () => ({ content_scripts: [{ matches: ['*://x.com/*'] }] }), openOptionsPage() {}, setUninstallURL: (url) => (on.farewell = url) },
    browserAction: { onClicked: { addListener: (f) => (on.click = f) } },
    contentScripts: {
      register: async (options) => {
        const r = { options, gone: false, unregister: async () => { r.gone = true; } };
        registered.push(r);
        return r;
      },
    },
    storage: { local: { set: async (o) => { saved = o; } } },
    ...(withTheme && { theme: { getCurrent: async () => current, onUpdated: { addListener: (f) => (on.updated = f) } } }),
  });
  // stand-in for the browser's css parser: hex, rgb() and plain names count as colors
  const CSS = { supports: (_, v) => /^(#[\da-f]{3,8}|rgb\([\d\s./]+\)|[a-z]+)$/i.test(v) };
  vm.runInContext(read('background.js'), vm.createContext({ browser: fakeBrowser(true), CSS, console }));
  await settle();
  const page = { '--d2t-bg': 'rgb(10 20 30)', '--d2t-fg': '#fff' };
  assert.deepEqual(
    JSON.parse(JSON.stringify(saved)),
    { theme: { ...page, '--d2t-card': 'rgb(10 20 30)', '--d2t-card-fg': '#fff', '--d2t-accent': '#0af' } },
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
  assert.deepEqual(JSON.parse(JSON.stringify(saved)), { theme: {} });
  assert.equal(typeof on.click, 'function', 'the toolbar button opens the settings');
  assert.match(on.farewell, /^https:\/\/[^#?]+$/, 'a plain https page, nothing about the user appended');
  // android: no theme api; only the toolbar button is wired, no error
  vm.runInContext(read('background.js'), vm.createContext({ browser: fakeBrowser(false), CSS, console }));
});
