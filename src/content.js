// the engine. per url: block feeds, cap scrolling and swipe chains, unlock a site after a pause and a challenge.
(() => {
  const siteId = siteFor(location.hostname);
  if (!siteId) return;
  const site = SITES[siteId];
  const root = document.documentElement;
  // firefox injects this script again into open tabs when the extension is updated, reloaded or re-enabled; the
  // old instance's overlay stays behind with dead buttons, and older versions also left <body> inert
  const stale = document.getElementById('dis2tract');
  if (stale) {
    stale.remove();
    root.removeAttribute('data-dis2tract-blocked');
    document.body?.removeAttribute('inert');
  }
  const TRAIL = `trail:${siteId}`; // this site's run of items, kept a minute so a reload or new tab continues it
  const UNLOCK_MS = UNLOCK.minutes * 60_000;
  const EXTEND_MS = UNLOCK.extendMinutes * 60_000;
  const HOP_MS = 10 * 60_000; // a block on another site this recently means the scroll just moved apps

  let settings = mergeSettings();
  let theme = {}; // css variables from background.js; the registered stylesheet paints them first, these keep an open page current
  let unlocks = []; // unlocks on every site, oldest first: [{ site, at, extended?, doneAt? }]
  // feed time used of the newest unlock, apart from `unlocks`: a write to `unlocks` redraws every block screen
  // (an open challenge sheet included), and this one is written every few seconds
  let spent = { at: 0, ms: 0 };
  let spentAt = 0; // the last tick that spent feed time, 0 while not spending
  let unsaved = 0; // feed time spent in this tab, not yet in storage
  let lastInput = 0; // the last pointer, wheel, touch or key input on the page
  let banUntil = 0; // after a wrong answer, no new challenge before this, in any tab
  let pendingAt = 0; // when a waiting loosening change is due
  let recent = []; // the latest attempt per site within HOP_MS, all sites: [{ site, at }]
  let ready = false; // storage has answered; until then nothing is counted
  let href = ''; // current url without hash
  let key = null; // id of the video/post on the current url
  let inFeed = false;
  let onFeedUrl = false; // the url itself is a feed, not an item carried over from one
  let feedKey = ''; // which feed, for its settings switch
  let feedLabel = ''; // which feed, for the block screen
  let feedAt = 0; // the last moment the url was still a feed
  let traversed = false; // the url change came from back/forward
  let talking = false; // a conversation: no scroll budget
  let tweaked = null; // the url the site's tweaks are done for
  let tweakTries = 0;
  const chain = []; // distinct items viewed in a row, oldest first
  let scrolled = 0; // px scrolled down on this url
  const scrolledOn = new Map(); // per url, so coming back to a page resumes its budget
  const lastTop = new WeakMap();
  const watchedRoots = new WeakSet(); // shadow roots with a play listener
  let pauseTicks = 0;
  let overlay = null;
  let countedHref = null; // the blocked url already counted, so a redraw is not a second block
  let hopFrom = []; // other sites the user went for within HOP_MS before this one

  const budget = (u) => UNLOCK_MS + (u.extended ? EXTEND_MS : 0);
  // when an unlock's time ran out, or would have if used in one go
  const end = (u) => (u ? u.doneAt ?? u.at + budget(u) : -Infinity);
  const today = (t) => new Date(t).toDateString() === new Date(Date.now()).toDateString();
  const cooldown = (u) => (u?.extended ? UNLOCK.extendedCooldownMinutes : UNLOCK.cooldownMinutes) * 60_000;
  // feed time left on this site's unlock. only the newest unlock counts, so a new one ends what was left of the
  // last, and only until the next unlock could start had it been used in one go. until midnight was too long:
  // an unlock tried in the morning left the feed open all day, and the block seemed broken
  function left() {
    const last = unlocks.at(-1);
    if (last?.site !== siteId || last.doneAt || Date.now() >= last.at + budget(last) + cooldown(last)) return 0;
    return budget(last) - (spent.at === last.at ? spent.ms : 0) - unsaved;
  }
  const unlocked = () => left() > 0;
  const active = () => settings.sites[siteId] !== false && !unlocked();
  // when the next unlock may start: Infinity once today's are used up
  function nextUnlockAt() {
    if (unlocks.filter((u) => today(u.at)).length >= UNLOCK.perDay) return Infinity;
    const last = unlocks.at(-1);
    return end(last) + cooldown(last);
  }
  // the extra minute: only for this site's unlock, only if it was the latest anywhere, once, and only right after it ran out
  function canExtend() {
    const last = unlocks.at(-1);
    return last?.site === siteId && !last.extended && last.doneAt > Date.now() - UNLOCK.extendGraceMinutes * 60_000;
  }
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const words = (s) => s.split(/\s+/).filter(Boolean).length;
  const clock = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  function h(tag, props = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    el.append(...kids);
    return el;
  }
  // a suggestion line: a link when the idea has one
  const idea = ([text, url]) => h('p', { class: 'd2t-idea' }, url ? h('a', { href: url }, text) : text);
  const ago = (t) => {
    const m = Math.floor((Date.now() - t) / 60_000);
    return m < 1 ? 'just now' : `${m} min ago`;
  };

  // each sentence on its own line, so a line never breaks inside one
  const TEXT = {
    feed: () => ['no feed', [`${site.name} ${feedLabel} is an endless feed.`, 'go somewhere on purpose.']],
    chain: () => [`${settings.chainLimit} in a row`, ['one after another is the feed again.']],
    scroll: () => [`${settings.scrollScreens} screens deep`, ['this page turned into a feed.']],
  };

  // the mirror at the top, only when the user went for other feeds just before: which apps, how long ago. no
  // daily count: page loads and reloads made any count of attempts wrong
  function mirror() {
    if (!hopFrom.length) return null;
    return h('p', { class: 'd2t-mirror' }, `${hopFrom.map((r) => `${SITES[r.site].name} ${ago(r.at)}`).join(', ')}, now ${site.name}. same urge, new app.`);
  }

  function card(reason) {
    const [title, sentences] = TEXT[reason]();
    const q = h('input', { type: 'search', placeholder: 'search, or @name for a profile', 'aria-label': `search ${site.name}, or @name for a profile`, autocomplete: 'off', enterkeyhint: 'go' });
    const go = h('form', {
      class: 'd2t-field',
      onsubmit: (e) => {
        e.preventDefault();
        const v = q.value.trim();
        const name = v.startsWith('@') && v.slice(1).trim();
        const special = site.route?.(v);
        if (special) location.assign(special);
        else if (name) location.assign(site.profile(name));
        else if (v && !v.startsWith('@')) location.assign(site.search(v));
      },
    }, q);
    const handle = settings.handles[siteId];
    const me = site.me ?? (handle && site.profile(handle));
    const links = h('nav', { 'aria-label': 'go to' }, ...[me && ['my profile', me], ...site.links].filter(Boolean).map(([label, path]) => h('a', { href: path }, label)));
    // one random roast per screen, already answered with one thing to do right now
    const hour = new Date(Date.now()).getHours();
    const [question, ideas] = hour >= 23 || hour < 5 ? LATE : pick(NEEDS);
    const roast = h('div', { class: 'd2t-answer' }, h('p', { class: 'd2t-ask' }, question), idea(pick(ideas)));
    return h('div', { class: 'd2t-card' },
      h('h2', { id: 'dis2tract-title' }, title),
      h('p', { class: 'd2t-sub' }, ...sentences.map((s) => h('span', {}, s))),
      go, links, roast);
  }

  function unlockBox() {
    const box = h('div', { class: 'd2t-unlock' });
    if (canExtend()) {
      box.append(
        h('button', { type: 'button', onclick: extend }, `+${UNLOCK.extendMinutes} min to finish up`),
        h('p', { class: 'd2t-small' }, `the next unlock then waits ${UNLOCK.extendedCooldownMinutes} min instead of ${UNLOCK.cooldownMinutes}.`),
      );
      return box;
    }
    const next = nextUnlockAt();
    if (next > Date.now()) {
      box.append(h('p', {}, next === Infinity ? `no unlocks left today: ${UNLOCK.perDay} a day.` : `next unlock at ${clock(next)}. ${UNLOCK.perDay} a day, ${UNLOCK.cooldownMinutes} min apart.`));
    } else {
      const open = h('button', { type: 'button', onclick: () => openSheet(open) }, `unlock ${site.name} for ${UNLOCK.minutes} min`);
      box.append(open);
    }
    return box;
  }

  // the unlock flow runs in a sheet over the block screen, so nothing on the page moves while it grows
  function openSheet(opener) {
    const sheet = h('div', { class: 'd2t-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': `unlock ${site.name}` });
    // closing plays the opening backwards (css [data-closing]), then removes the layer. a timer, not
    // animationend, so a missing stylesheet or a skipped animation can never leave the layer up
    const close = () => {
      if (layer.hasAttribute('data-closing')) return;
      layer.setAttribute('data-closing', '');
      opener.focus(); // back where the keyboard user started
      setTimeout(() => layer.remove(), 250);
    };
    const layer = h('div', { class: 'd2t-layer', onclick: (e) => e.target === layer && close() }, sheet);
    overlay.append(layer);
    pause(sheet, close);
  }
  const neverMind = (close) => h('button', { type: 'button', class: 'd2t-back', onclick: close }, 'never mind');

  // a pause before the challenge, with a way back: in a field study the option to back off changed behaviour
  // the most, more than the delay itself (one sec, pnas 2023, doi 10.1073/pnas.2213114120). the pause shows
  // the user's own note: their own reasons, not ours. after a wrong answer it says what was wrong and waits out
  // the penalty, and a sheet closed and opened again waits whatever is left of it
  function pause(sheet, close, verdict) {
    let left = Math.max(UNLOCK.waitSeconds, Math.ceil((banUntil - Date.now()) / 1000));
    const line = () => (verdict ? `a new challenge in ${left} s.` : `the challenge starts in ${left} s.`);
    const count = h('p', {}, line());
    const timer = setInterval(() => {
      if (!sheet.isConnected) clearInterval(timer);
      else if (--left > 0) count.textContent = line();
      else {
        clearInterval(timer);
        challenge(sheet, close);
      }
    }, 1000);
    const note = settings.note && h('p', { class: 'd2t-sentence' }, settings.note);
    const lead = verdict
      ? h('p', { role: 'alert' }, `wrong. ${verdict}`)
      : h('p', {}, note ? 'take a breath. you wrote this for this moment:' : 'take a breath.');
    const stop = neverMind(close);
    sheet.replaceChildren(...[lead, note, count, stop].filter(Boolean));
    stop.focus(); // focus moves into the sheet with the user
  }

  function challenge(sheet, close) {
    const c = pick(CHALLENGES)(settings.sentenceWords);
    let done = false; // one verdict per challenge: a second enter must not count a second wrong answer
    // a sentence wraps in a textarea, so a typo stays visible on a phone; a number fits one line
    const input = h(c.live ? 'textarea' : 'input', {
      'aria-label': c.ask, autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false',
      inputmode: c.live ? 'text' : 'numeric', placeholder: 'your answer', ...(c.live && { rows: '3' }),
    });
    const answer = () => {
      if (done || !input.value.trim()) return; // an empty enter is a slip, not an answer
      // a wrong answer in another tab since this challenge appeared: its wait holds here too, or a second open
      // sheet would be a way around it
      if (banUntil > Date.now()) return pause(sheet, close);
      done = true;
      if (c.check(input.value)) unlock();
      else penalize(sheet, close, c.wrong);
    };
    let typed = '';
    input.addEventListener('input', () => {
      // several words landing at once come from a keyboard's clipboard chip or dictation, which fire no paste
      // event: they are undone, so the sentence has to be typed
      if (words(input.value) - words(typed) > 2) input.value = typed;
      typed = input.value;
      if (c.live && c.check(typed)) answer();
    });
    // enter in the textarea answers instead of starting a new line. beforeinput, because key events are
    // swallowed at the window while the block screen is up
    input.addEventListener('beforeinput', (e) => {
      if (e.inputType !== 'insertLineBreak' && e.inputType !== 'insertParagraph') return;
      e.preventDefault();
      answer();
    });
    for (const type of ['paste', 'drop']) input.addEventListener(type, (e) => e.preventDefault());
    const form = h('form', {
      class: c.live ? 'd2t-field d2t-plain d2t-multi' : 'd2t-field d2t-plain',
      onsubmit: (e) => {
        e.preventDefault();
        answer();
      },
    }, input);
    const ask = `${c.ask}. a wrong enter means a new one in ${UNLOCK.penaltySeconds} s.`;
    sheet.replaceChildren(h('p', {}, ask), h('p', { class: 'd2t-sentence' }, c.show), form, neverMind(close));
    input.focus();
  }

  // one read-modify-write per counter: two bumps at once would overwrite each other
  async function bump(field) {
    const { stats = {} } = await browser.storage.local.get('stats');
    await browser.storage.local.set({ stats: { since: Date.now(), ...stats, [field]: (stats[field] ?? 0) + 1 } });
  }

  async function unlock() {
    const stored = (await browser.storage.local.get('unlocks')).unlocks;
    unlocks = Array.isArray(stored) ? stored : [];
    if (nextUnlockAt() > Date.now()) return; // another tab unlocked first; that storage change redraws this one
    const now = Date.now();
    // a day of history is all the limits need
    await browser.storage.local.set({ unlocks: [...unlocks.filter((u) => now - u.at < 86_400_000), { site: siteId, at: now }] });
    bump('unlocks');
  }

  async function extend() {
    const stored = (await browser.storage.local.get('unlocks')).unlocks;
    unlocks = Array.isArray(stored) ? stored : [];
    if (!canExtend()) return; // the grace window closed or another tab extended first
    const last = { ...unlocks.at(-1), extended: true };
    delete last.doneAt; // running again, for the extra minute
    await browser.storage.local.set({ unlocks: [...unlocks.slice(0, -1), last] });
    bump('extensions');
  }

  // a player running now: one in the page, or one the page started through play() that sits in no document or
  // in a shadow root
  const playingNow = () => [...document.querySelectorAll('video, audio'), ...playing].some((m) => !m.paused && !m.ended);

  // an unlock's minutes are feed minutes: they run only while a page the unlock lets through is on screen and
  // in use, so time left when the user goes elsewhere or pauses the video is still there later. in use means
  // something plays or the user did something lately: playing alone would make a text feed free. saved every
  // few seconds and on leaving, not on every tick
  function spend() {
    const idle = !playingNow() && Date.now() - lastInput > UNLOCK.idleSeconds * 1000;
    if (document.visibilityState !== 'visible' || idle) return stopSpending();
    const now = Date.now();
    // a tick more than a second late is a sleeping machine, not time on the feed
    if (spentAt) unsaved += Math.min(now - spentAt, 1000);
    spentAt = now;
    if (unsaved >= 5000 || !unlocked()) save();
  }

  function stopSpending() {
    spentAt = 0;
    if (unsaved) save();
  }

  async function save() {
    const ms = unsaved;
    unsaved = 0;
    const stored = await browser.storage.local.get(['unlocks', 'spent']);
    const list = Array.isArray(stored.unlocks) ? stored.unlocks : [];
    const last = list.at(-1);
    if (last?.site !== siteId) return; // a newer unlock on another site ended this one
    const used = (stored.spent?.at === last.at ? stored.spent.ms : 0) + ms;
    // running out is written to `unlocks`, which redraws every tab: here the block comes back, elsewhere the next
    // unlock time moves
    const done = !last.doneAt && used >= budget(last);
    await browser.storage.local.set({
      spent: { at: last.at, ms: used },
      ...(done && { unlocks: [...list.slice(0, -1), { ...last, doneAt: Date.now() }] }),
    });
  }

  // a wrong answer: what was wrong, a wait, then a new challenge, all in the same sheet. the wait is stored, so a
  // sheet closed and opened again, a reload or another site waits it out too
  async function penalize(sheet, close, verdict) {
    banUntil = Date.now() + UNLOCK.penaltySeconds * 1000;
    pause(sheet, close, verdict);
    await browser.storage.local.set({ unlockBan: banUntil });
    bump('wrong');
  }

  // notes, once per url, which other sites the user went for just before (in another tab at the same moment
  // counts too)
  function record() {
    countedHref = href;
    const now = Date.now();
    hopFrom = recent.filter((r) => r.site !== siteId && now - r.at < HOP_MS);
    recent = [...hopFrom, { site: siteId, at: now }];
    browser.storage.local.set({ recent });
    if (hopFrom.length) bump('hops');
  }

  function show(reason) {
    // the unlock part changes when the extra-minute window closes or a cooldown ends, so it is part of what
    // the open overlay must match
    const state = `${reason} ${canExtend() ? 'extend' : nextUnlockAt() > Date.now() ? 'wait' : 'open'}`;
    if (overlay?.dataset.state !== state) {
      // only a block that was not up a moment ago fades in and chimes; a redraw replaces it in place. never the
      // first paint of a page load, which has to cover the feed at once
      const fresh = !overlay && ready;
      hide();
      if (ready && href !== countedHref) record();
      // mirror pinned at the top, the block centered, the unlock at the bottom
      overlay = h('div', { id: 'dis2tract', 'data-reason': reason, 'data-state': state, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dis2tract-title', tabindex: '-1', ...(fresh && { 'data-enter': '' }) },
        ...[mirror(), card(reason), unlockBox()].filter(Boolean));
      if (fresh) chime();
      // cssom, not a style attribute: a strict page csp blocks style attributes but not setProperty
      for (const [k, v] of Object.entries(theme)) overlay.style.setProperty(k, v);
      pauseAll();
      // a fullscreen player sits in the top layer, above any z-index, and would hide the block screen.
      // a refused exit only means the page stays fullscreen; there is nothing else to try
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      // focus goes to the dialog, not into the field: keyboard users tab from there, nobody gets a glowing
      // field they did not ask for, and no phone keyboard pops up
      queueMicrotask(() => overlay?.focus());
    }
    // last child of <html>: at document_start <body> does not exist yet and would otherwise paint above us.
    // never while it holds focus: moving an element blurs it, which closes the phone keyboard mid-sentence.
    if (!overlay.isConnected || (overlay.nextElementSibling && !overlay.contains(document.activeElement))) root.append(overlay);
    root.toggleAttribute('data-dis2tract-blocked', true); // no mutation when already set; this runs every tick
  }

  // the 6 am bell, played by background.js; only for a tab on screen
  function chime() {
    if (settings.chime && document.visibilityState === 'visible') browser.runtime.sendMessage('chime');
  }

  function hide() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    root.removeAttribute('data-dis2tract-blocked');
  }

  // pauses every player, including ones inside shadow roots (reddit's), which neither document.querySelectorAll
  // nor a play listener on the document reach. firefox lets content scripts into closed roots too.
  function pauseAll(scope = document) {
    if (scope === document) {
      for (const m of playing) m.pause();
      playing.clear();
    }
    scope.querySelectorAll('video, audio').forEach((m) => m.pause());
    for (const el of scope.querySelectorAll('*')) {
      const shadow = el.openOrClosedShadowRoot;
      if (!shadow) continue;
      if (!watchedRoots.has(shadow)) {
        watchedRoots.add(shadow);
        shadow.addEventListener('play', (e) => overlay && e.target.pause(), true);
      }
      pauseAll(shadow);
    }
  }

  // where this site's run of items stands, for a reload or a new tab within a minute
  function saveTrail() {
    browser.storage.local.set({ [TRAIL]: { chain: [...chain], inFeed, feedKey, feedLabel, at: Date.now() } });
  }

  // the site's extras (youtube theater mode): tried each tick until done for this url, given up after ~10 s
  function tweak() {
    // not before storage answers: a tweak switched off in settings must never run, not even once
    if (!ready || tweaked === href || settings.sites[siteId] === false) return;
    const u = new URL(location.href);
    const left = Object.entries(site.tweaks ?? {}).filter(([name, t]) => (settings.toggles[`${siteId}.${name}`] ?? t.on) && !t.run(u));
    if (!left.length) tweaked = href;
    else if (++tweakTries > 25) {
      console.warn(`dis2tract: ${left.map(([name]) => name).join(', ')} found nothing to act on at ${href}; the site may have changed`);
      tweaked = href;
    }
  }

  // why this page would be blocked without an unlock, or null
  function blocked() {
    if (inFeed) return 'feed';
    if (settings.chainLimit && chain.length > settings.chainLimit) return 'chain';
    if (!talking && settings.scrollScreens && scrolled >= settings.scrollScreens * innerHeight) return 'scroll';
    return null;
  }

  function evaluate() {
    if (pendingAt && Date.now() >= pendingAt) {
      // a waiting loosening change is due: loadSettings puts it in place, and its storage change redraws every tab
      pendingAt = 0;
      loadSettings();
    }
    // the 3 s carry counts from the last moment the url was still a feed, so a slow router swap is caught too
    if (onFeedUrl) feedAt = Date.now();
    tweak();
    const reason = settings.sites[siteId] !== false && blocked();
    if (reason && unlocked()) {
      hide();
      spend();
    } else {
      stopSpending();
      if (reason) show(reason);
      else hide();
    }
    if (overlay && ++pauseTicks % 3 === 0) pauseAll(); // players that load later, every ~1.2 s while blocked
    if (!overlay) for (const m of playing) if (m.paused) playing.delete(m); // remember only what still plays
  }

  function onUrl() {
    const u = new URL(location.href);
    href = u.href.split('#')[0];
    key = site.itemKey(u);
    const feed = feedOf(siteId, u, settings.toggles);
    onFeedUrl = Boolean(feed);
    if (feed) {
      [feedKey, feedLabel] = feed;
      feedAt = Date.now();
    }
    tweakTries = 0;
    // instagram's /reels/ swaps its url to a random /reels/CODE/ a moment after load: that item is still the
    // feed. back/forward is the user leaving, so an item reached that way is a real page.
    inFeed = Boolean(feed) || (!traversed && inFeed && key !== null && Date.now() - feedAt < 3000);
    traversed = false;
    talking = conversation(u);
    // back to an earlier item steps out of the chain instead of growing it, so the back button escapes a block
    const seen = key ? chain.indexOf(key) : -1;
    if (!key) chain.length = 0;
    else if (seen === -1) chain.push(key);
    else chain.length = seen + 1;
    scrolled = scrolledOn.get(href) ?? 0;
    if (ready) saveTrail();
    evaluate();
  }

  // settings changed under an unchanged url: judge the feed again with the new switches, keep the rest
  function refeed() {
    const feed = feedOf(siteId, new URL(location.href), settings.toggles);
    onFeedUrl = Boolean(feed);
    if (feed) {
      [feedKey, feedLabel] = feed;
      inFeed = true;
    } else if (inFeed && settings.toggles[`${siteId}.${feedKey}`] === false) inFeed = false;
    evaluate();
  }

  // scroll does not bubble, but capture sees every scroller: the window and the inner feed containers
  document.addEventListener('scroll', (e) => {
    const el = e.target === document ? document.scrollingElement : e.target;
    if (!el || overlay?.contains(el)) return;
    const top = el.scrollTop;
    const d = top - (lastTop.get(el) ?? top);
    lastTop.set(el, top);
    // a jump over a screen is the site restoring a position, not the user scrolling
    if (d <= 0 || d > innerHeight || overlay || talking || !active()) return;
    scrolled += d;
    scrolledOn.set(href, scrolled);
    if (settings.scrollScreens && scrolled >= settings.scrollScreens * innerHeight) evaluate();
  }, { capture: true, passive: true });
  window.addEventListener('popstate', () => {
    traversed = true;
  });
  // another tab, another app or a locked screen pauses the unlock's minutes; closing the tab saves them
  document.addEventListener('visibilitychange', () => evaluate());
  window.addEventListener('pagehide', stopSpending);
  for (const type of ['pointerdown', 'wheel', 'touchmove', 'keydown']) {
    window.addEventListener(type, () => { lastInput = Date.now(); }, { capture: true, passive: true });
  }

  // registered at document_start, so these run before any page listener: site shortcuts (k, j, arrows)
  // cannot fire behind the overlay. typing still works, text input is the default action, not a listener.
  for (const type of ['keydown', 'keyup', 'keypress']) {
    window.addEventListener(type, (e) => overlay && e.stopImmediatePropagation(), true);
  }
  document.addEventListener('play', (e) => overlay && e.target.pause(), true);
  // players in no document at all (tiktok's photo-post music is a new Audio() that is never attached) are out of
  // reach of every pause path above. so the page's own play() is wrapped: while the block screen is up nothing
  // starts, and whatever started before is remembered to be paused. the set is emptied on every pause, so it only
  // ever holds what is playing now
  const playing = new Set();
  const media = window.wrappedJSObject.HTMLMediaElement.prototype;
  const play = media.play;
  exportFunction(function () {
    playing.add(this);
    if (!overlay) return play.call(this);
    this.pause();
    return window.wrappedJSObject.Promise.resolve();
  }, media, { defineAs: 'play' });
  // pages call focus() on their own players and feeds all the time (tiktok, youtube, x). behind the block screen
  // that pulled the cursor out of the answer field mid-word, so while it is up such calls are ignored. our own
  // focus() calls go through firefox's xray to the original method and are not affected
  const elements = window.wrappedJSObject.HTMLElement.prototype;
  const focus = elements.focus;
  exportFunction(function (options) {
    if (overlay && !overlay.contains(this)) return;
    return focus.call(this, options);
  }, elements, { defineAs: 'focus' });
  // tab focus stays in the block screen: focus that lands outside it (tabbing past the end) goes back to the
  // field the user was in, not to the dialog, so typing carries on
  let lastFocus = null;
  document.addEventListener('focusin', (e) => {
    if (!overlay) return;
    if (overlay.contains(e.target)) lastFocus = e.target;
    else (lastFocus?.isConnected && overlay.contains(lastFocus) ? lastFocus : overlay).focus();
  }, true);

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.recent) recent = changes.recent.newValue ?? [];
    if (changes.spent) spent = changes.spent.newValue ?? { at: 0, ms: 0 };
    // the wait after a wrong answer only lengthens the next pause. no redraw: that removed the open sheet, so a
    // wrong answer used to drop the user back on the block screen without a word
    if (changes.unlockBan) banUntil = changes.unlockBan.newValue ?? 0;
    if (!['settings', 'unlocks', 'theme', 'pending'].some((k) => k in changes)) return;
    if (changes.settings) settings = mergeSettings(changes.settings.newValue);
    if (changes.unlocks) unlocks = Array.isArray(changes.unlocks.newValue) ? changes.unlocks.newValue : [];
    if (changes.theme) theme = changes.theme.newValue ?? {};
    if (changes.pending) pendingAt = changes.pending.newValue?.at ?? 0;
    if (overlay) overlay.dataset.state = ''; // stale: show() rebuilds it in place with the new values
    // a feed switched off or on changes what this url is
    if (changes.settings) refeed();
    else evaluate();
  });

  onUrl(); // with defaults, so a feed is covered before storage answers and never flashes
  Promise.all([loadSettings(), browser.storage.local.get(['unlocks', 'spent', 'theme', 'unlockBan', 'pending', 'recent', TRAIL])]).then(([s, stored]) => {
    settings = s;
    // a reload or a new tab within a minute continues the run of items, and the feed this item was carried from
    const trail = stored[TRAIL];
    if (trail && Date.now() - trail.at < 60_000) {
      chain.splice(0, chain.length, ...trail.chain);
      if (trail.inFeed && trail.chain.at(-1) === key) {
        inFeed = true;
        feedAt = Date.now();
        [feedKey, feedLabel] = [trail.feedKey, trail.feedLabel];
      }
    }
    // older versions stored an object here; anything but a list means no unlocks
    unlocks = Array.isArray(stored.unlocks) ? stored.unlocks : [];
    spent = stored.spent ?? spent;
    theme = stored.theme ?? {};
    banUntil = stored.unlockBan ?? 0;
    pendingAt = stored.pending?.at ?? 0;
    recent = Array.isArray(stored.recent) ? stored.recent : [];
    ready = true;
    if (overlay) overlay.dataset.state = ''; // stale, rebuilt in place below
    onUrl(); // again: the first pass judged the url with default settings, and a feed may be switched off

    // single-page apps change the url without a load; polling catches every router.
    // evaluate on the other ticks re-blocks the moment an unlock runs out, and redraws when a cooldown ends.
    setInterval(() => (location.href.split('#')[0] === href ? evaluate() : onUrl()), 400);
  });
})();
