// the parts the block screen (content.js) and the porn page (porn/porn.js) share, so both look and read the same.
// both style them with css/overlay.css. function declarations: content scripts and extension pages share
// globals, not modules.

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  el.append(...kids);
  return el;
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// bedtime (bedtimeFrom to bedtimeTo in the settings, settings.js) at time t: no unlocks, and the late-night question
// replaces the others. a page without the user's settings (the porn page) goes by the default hours
function lateNight(s = DEFAULTS, t = Date.now()) {
  const hour = new Date(t).getHours();
  return hour >= s.bedtimeFrom || hour < s.bedtimeTo;
}

// the line under the title, each sentence on its own line, so a line never breaks inside one
function sub(sentences) {
  return h('p', { class: 'd2t-sub' }, ...sentences.map((s) => h('span', {}, s)));
}

// one question, already answered with one thing to do: a link when the idea has one
function answer([question, ideas]) {
  const [text, url] = pick(ideas);
  return h('div', { class: 'd2t-answer' }, h('p', { class: 'd2t-ask' }, question), h('p', { class: 'd2t-idea' }, url ? h('a', { href: url }, text) : text));
}

// the firefox theme's colors (background.js) as the css variables overlay.css reads. cssom, not a style
// attribute: a strict page csp blocks style attributes but not setProperty
function paint(el, theme = {}) {
  for (const [k, v] of Object.entries(theme)) el.style.setProperty(k, v);
}

// puts a wrapper of ours over a page method. an exported wrapper dies with this script's sandbox (an extension
// update, reload or disable), and a page calling it then throws until reload. so each wrapper carries the page's
// own method along, and the next instance of this script wraps that one, never a dead wrapper of an old instance.
// 0.7.0 and older left theirs without that mark: dead since that version's sandbox went, one passes for the page's
// own method and throws on every call, so firefox's own method (`own`, read through the xray) stands in for it.
// after a disable nothing comes next: the dead wrappers stay until the tab reloads. content scripts only
// (exportFunction): content.js and links.js
function wrap(proto, own, name, make) {
  const page = proto[name].dis2tractPage ?? proto[name];
  const call = (self, ...args) => {
    try {
      return page.call(self, ...args);
    } catch (e) {
      if (e?.message !== 'can\'t access dead object') throw e;
      return own.call(self, ...args);
    }
  };
  exportFunction(make(call), proto, { defineAs: name });
  proto[name].dis2tractPage = page;
}
