// links without tracking (src/links.js): the cleaner on the sites' own share links, and the three ways a link gets
// copied or opened, against a fake page
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '../src', f), 'utf8');
const settle = () => new Promise((r) => setImmediate(r));

// the page as links.js sees it: the page's clipboard api behind the xray, document events, a selection
function page(settings) {
  const copied = [];
  const listeners = {};
  const changed = [];
  const own = { writeText() {} }; // firefox's own method, read through the xray
  const pageClipboard = { writeText(text) { copied.push(text); return Promise.resolve(); } };
  const doc = { activeElement: null, addEventListener: (type, f) => (listeners[type] ??= []).push(f) };
  const ctx = vm.createContext({
    URL,
    window: { wrappedJSObject: { Clipboard: { prototype: pageClipboard } } },
    Clipboard: { prototype: own },
    exportFunction: (fn, target, { defineAs }) => { target[defineAs] = fn; },
    document: doc,
    getSelection: () => ctx.selection,
    selection: '',
    browser: { storage: { local: { get: async () => ({ settings }) }, onChanged: { addListener: (f) => changed.push(f) } } },
  });
  for (const f of ['ui.js', 'settings.js', 'links.js']) vm.runInContext(read(f), ctx, { filename: f });
  const fire = (type, event) => {
    for (const f of listeners[type] ?? []) f(event);
  };
  return { ctx, doc, copied, fire, changed, writeText: (text) => pageClipboard.writeText(text) };
}

test('links: the sites\' share links lose their tracking, and what a link opens stays', () => {
  const { ctx } = page();
  const clean = (href) => vm.runInContext('cleanLink', ctx)(href);
  for (const [shared, kept] of [
    ['https://youtu.be/dQw4w9WgXcQ?si=Hx1ubCpTzw9QI6Vb', 'https://youtu.be/dQw4w9WgXcQ'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42&si=abc&feature=shared', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42'],
    ['https://www.youtube.com/watch?v=a&list=PL1&index=2&pp=ygUFY2F0cw%3D%3D', 'https://www.youtube.com/watch?v=a&list=PL1&index=2'],
    ['https://x.com/jack/status/20?s=46&t=AbCdEfGh', 'https://x.com/jack/status/20'],
    ['https://www.tiktok.com/@a/video/7123?_r=1&_t=8kLm&u_code=xyz&preview_pb=0&sender_device=pc&web_id=713&is_from_webapp=1&share_app_id=1233&lang=en', 'https://www.tiktok.com/@a/video/7123?lang=en'],
    ['https://www.instagram.com/p/C1a2B3/?igsh=MWQ1ZGUxMzBkMA%3D%3D&img_index=2', 'https://www.instagram.com/p/C1a2B3/?img_index=2'],
    ['https://www.reddit.com/r/aww/comments/1abc/cats/?share_id=Xy&utm_medium=android_app&utm_source=share&context=3', 'https://www.reddit.com/r/aww/comments/1abc/cats/?context=3'],
    ['https://www.facebook.com/share/p/1A2b/?mibextid=WC7FNe', 'https://www.facebook.com/share/p/1A2b/'],
    ['https://www.threads.com/@a/post/C1a?xmt=AQGz&slof=1', 'https://www.threads.com/@a/post/C1a'],
    ['https://www.linkedin.com/posts/a_b-activity-1?utm_source=share&utm_medium=member_desktop&rcm=ACoAA', 'https://www.linkedin.com/posts/a_b-activity-1'],
    ['https://example.com/a?utm_source=x&fbclid=IwAR0&id=5', 'https://example.com/a?id=5'],
  ]) assert.equal(clean(shared), kept, shared);
  // nothing to remove: the very same string, never one rewritten for nothing
  for (const href of ['https://x.com/search?q=cats&src=trend_click', 'https://example.com/?a=1+2', 'mailto:a@example.com', 'not a link']) {
    assert.equal(clean(href), href);
  }
  assert.equal(vm.runInContext('cleanText', ctx)('look https://youtu.be/x?si=1. and (https://x.com/a/status/1?s=20)'), 'look https://youtu.be/x. and (https://x.com/a/status/1)');
});

test('links: copied through the site\'s button, as a selection or a field, and opened from a link, without tracking', async () => {
  const p = page();
  await settle();
  // the site's copy-link button: the clipboard api
  p.writeText('https://youtu.be/a?si=1');
  assert.deepEqual(p.copied, ['https://youtu.be/a']);
  // selected text, and a hidden field a button copies through execCommand('copy')
  const copy = () => {
    const event = { data: null, prevented: false, clipboardData: { setData(_, v) { event.data = v; } }, preventDefault() { event.prevented = true; } };
    p.fire('copy', event);
    return event;
  };
  p.ctx.selection = 'https://x.com/a/status/1?s=20&t=x';
  assert.equal(copy().data, 'https://x.com/a/status/1');
  p.doc.activeElement = { value: 'link: https://www.instagram.com/p/A/?igsh=x', selectionStart: 6, selectionEnd: 43 };
  assert.equal(copy().data, 'https://www.instagram.com/p/A/');
  p.doc.activeElement = null;
  p.ctx.selection = 'just words';
  assert.equal(copy().prevented, false, 'a copy with nothing to clean is left to the page');
  // a link: cleaned before firefox opens it or its context menu copies it
  const link = { localName: 'a', href: 'https://example.com/?utm_source=x&id=1' };
  p.fire('contextmenu', { composedPath: () => [{ localName: 'span' }, link] });
  assert.equal(link.href, 'https://example.com/?id=1');
  const svg = { localName: 'a', href: { baseVal: 'https://example.com/?utm_source=x' } };
  p.fire('pointerdown', { composedPath: () => [svg] });
  assert.deepEqual(svg.href, { baseVal: 'https://example.com/?utm_source=x' }, 'an svg link is left alone');
  // switched off in settings: everything as the site made it
  for (const f of p.changed) f({ settings: { newValue: { version: 2, cleanLinks: false } } }, 'local');
  p.writeText('https://youtu.be/a?si=1');
  assert.equal(p.copied.at(-1), 'https://youtu.be/a?si=1');
  const off = page({ version: 2, cleanLinks: false });
  await settle();
  off.writeText('https://youtu.be/b?si=2');
  assert.deepEqual(off.copied, ['https://youtu.be/b?si=2'], 'off from the start');
});
