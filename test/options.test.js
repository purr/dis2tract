// runs the real settings page (options/options.js) against a minimal fake dom, in tabs that share one storage
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const NOON = new Date(2026, 9, 27, 12, 0).getTime();
const MIN = 60_000;
const NUMBERS = [...fs.readFileSync(path.join(__dirname, '../options/options.html'), 'utf8').matchAll(/type="number" name="(\w+)"/g)].map((m) => m[1]);
const settle = async () => {
  for (let i = 0; i < 50; i++) await new Promise((r) => setImmediate(r));
};

// just enough dom for options.html and what options.js builds: tags, ids, names, values and events
class El {
  constructor(tag, props = {}) {
    Object.assign(this, { tagName: tag.toUpperCase(), name: '', type: tag, value: '', checked: false, hidden: false, textContent: '', children: [], listeners: {} }, props);
  }
  append(...kids) { this.children.push(...kids.filter((k) => typeof k !== 'string')); }
  setAttribute(k, v) { this[k] = String(v); }
  addEventListener(t, f) { (this.listeners[t] ??= []).push(f); }
  fire(t, target) { for (const f of this.listeners[t] ?? []) f({ target }); }
  * all() {
    for (const c of this.children) {
      yield c;
      yield* c.all();
    }
  }
  querySelector(tag) { return [...this.all()].find((n) => n.tagName === tag.toUpperCase()) ?? null; }
}

// storage.local as firefox runs it: every write is reported to every page, after the write
function storage() {
  let data = {};
  const listeners = [];
  const report = (changes) => setImmediate(() => listeners.forEach((f) => f(changes, 'local')));
  const local = {
    get: async (keys) => structuredClone(Object.fromEntries([keys].flat().filter((k) => k in data).map((k) => [k, data[k]]))),
    set: async (o) => {
      report(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { oldValue: data[k], newValue: structuredClone(v) }])));
      data = { ...data, ...structuredClone(o) };
    },
    remove: async (keys) => {
      const gone = [keys].flat().filter((k) => k in data);
      report(Object.fromEntries(gone.map((k) => [k, { oldValue: data[k] }])));
      data = Object.fromEntries(Object.entries(data).filter(([k]) => !gone.includes(k)));
    },
  };
  return { local, listeners, get data() { return data; } };
}

const clock = { now: NOON };
function tab(store, { privateWindows }) {
  const form = new El('form');
  const pending = new El('div', { id: 'pending', hidden: true });
  pending.append(new El('span'), new El('button', { id: 'cancel' }));
  form.append(
    new El('p', { id: 'stats' }),
    new El('div', { id: 'private', hidden: true }),
    pending,
    new El('textarea', { name: 'note' }),
    // the number fields options.html really has: options.js sets min and max on one per LIMITS key, and the page
    // breaks when one is missing
    ...NUMBERS.map((name) => new El('input', { type: 'number', name })),
    new El('p', { id: 'limits-note' }),
    new El('input', { type: 'checkbox', name: 'chime' }),
    new El('div', { id: 'sites' }),
    new El('output'),
  );
  Object.defineProperty(form, 'elements', {
    get() {
      const list = [...form.all()].filter((n) => ['INPUT', 'TEXTAREA', 'BUTTON', 'OUTPUT'].includes(n.tagName));
      return Object.assign(list, Object.fromEntries(list.filter((n) => n.name).map((n) => [n.name, n])));
    },
  });
  const document = {
    activeElement: null,
    documentElement: { style: { cssText: '', setProperty() {} } },
    querySelector: () => form,
    getElementById: (id) => [...form.all()].find((n) => n.id === id) ?? null,
    createElement: (tag) => new El(tag),
  };
  const ctx = vm.createContext({
    document,
    browser: {
      storage: { local: store.local, onChanged: { addListener: (f) => store.listeners.push(f) } },
      extension: { getBackgroundPage: () => ({ theme: {} }), isAllowedIncognitoAccess: async () => privateWindows },
    },
    Date: class extends Date { static now() { return clock.now; } },
  });
  for (const f of ['src/settings.js', 'src/sites.js', 'options/options.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
  }
  const field = (name) => form.elements[name];
  return {
    ctx,
    shown: (id) => !document.getElementById(id).hidden,
    status: () => form.querySelector('output').textContent,
    // a switch flipped or a number typed, then left: one change event
    change(name, value) {
      Object.assign(field(name), typeof value === 'boolean' ? { checked: value } : { value });
      form.fire('change', field(name));
    },
    // typed into a focused field a key at a time, each key saved before the next, as a person types
    async type(name, text) {
      document.activeElement = field(name);
      for (const key of text) {
        field(name).value += key;
        form.fire('input', field(name));
        await settle();
      }
    },
  };
}

test('settings: a loosening waits, a tightening applies at once, and an older tab never saves its stale form', async () => {
  const store = storage();
  const a = tab(store, { privateWindows: true });
  const b = tab(store, { privateWindows: false }); // opened earlier, still showing the defaults
  await settle();
  assert.ok(!a.shown('private') && b.shown('private'), 'a warning only where firefox keeps dis2tract out of private windows');
  const due = NOON + a.ctx.LOOSEN_DELAY_MINUTES * MIN;

  a.change('site:youtube', false);
  await settle();
  assert.equal(store.data.settings.sites.youtube, undefined, 'youtube is still limited');
  assert.equal(store.data.pending.settings.sites.youtube, false);
  assert.equal(store.data.pending.at, due);
  assert.match(a.status(), /^saved\. looser settings apply at .+\.$/);
  assert.ok(b.shown('pending'), 'the other tab shows the waiting change too');

  clock.now += MIN;
  a.change('chainLimit', '2');
  await settle();
  assert.equal(store.data.settings.chainLimit, 2, 'a tightening applies at once');
  assert.equal(store.data.pending.at, due, 'and keeps the timer of what waits');

  // every keystroke saves the whole form of the other tab
  await b.type('note', 'not now');
  assert.equal(store.data.settings.note, 'not now', 'a note never waits, and typing is never undone (a space would be trimmed)');
  assert.equal(store.data.settings.chainLimit, 2);
  assert.equal(store.data.pending.settings.chainLimit, 2, 'the tightening does not come back as a waiting loosening');
  assert.equal(store.data.pending.at, due);
  assert.equal(b.status(), '', 'keystrokes are not announced');

  a.change('site:youtube', true);
  await settle();
  assert.equal(store.data.pending, undefined, 'undoing the loosening drops the wait');
  assert.equal(store.data.settings.note, 'not now', 'the note typed in the other tab stays');
  assert.equal(a.status(), 'saved');
});
