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
  const PASS = 'dis2tract:pass'; // sessionStorage mark: this load is the reload after a stop, let it through
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
  let usage = { at: 0, ms: 0 }; // time on social media on the day of `at`, every site and tab (background.js keeps it)
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
  let feedPassed = false; // background.js reported a feed address passed through between two looks
  let traversed = false; // the url change came from back/forward
  let unlimited = false; // a conversation, search results or a profile: no scroll budget
  let tweaked = null; // the url the site's tweaks are done for
  let tweakTries = 0;
  const chain = []; // distinct items viewed in a row, oldest first
  let scrolled = 0; // px scrolled down on this url
  const scrolledOn = new Map(); // per url, so coming back to a page resumes its budget
  const moreOn = new Map(); // per url, how many more budgets the user waited for
  const lastTop = new WeakMap();
  const watchedRoots = new WeakSet(); // shadow roots with a play listener
  let pauseTicks = 0;
  let overlay = null;
  let stopped = false; // this load was stopped before the site loaded: nothing of it is under the block
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
    if (last?.site !== siteId || last.doneAt || lateNight() || Date.now() >= last.at + budget(last) + cooldown(last)) return 0;
    return budget(last) - (spent.at === last.at ? spent.ms : 0) - unsaved;
  }
  const unlocked = () => left() > 0;
  const scrollCap = () => settings.scrollScreens * innerHeight * (1 + (moreOn.get(href) ?? 0));
  const active = () => settings.sites[siteId] !== false && !unlocked();
  // when bedtime ends: the next morning hour from now
  function morning() {
    const d = new Date(Date.now());
    if (d.getHours() >= UNLOCK.bedtime[1]) d.setDate(d.getDate() + 1);
    d.setHours(UNLOCK.bedtime[1], 0, 0, 0);
    return d.getTime();
  }
  // when the next unlock may start: Infinity once today's are used up, never before bedtime ends
  function nextUnlockAt() {
    if (unlocks.filter((u) => today(u.at)).length >= UNLOCK.perDay) return Infinity;
    const last = unlocks.at(-1);
    return Math.max(end(last) + cooldown(last), lateNight() ? morning() : 0);
  }
  // the extra minute: only for this site's unlock, only if it was the latest anywhere, once, only right after it
  // ran out, and not at bedtime
  function canExtend() {
    const last = unlocks.at(-1);
    return last?.site === siteId && !last.extended && !lateNight() && last.doneAt > Date.now() - UNLOCK.extendGraceMinutes * 60_000;
  }
  // how many characters an edit inserted: what lies between the part both texts start with and the part both end
  // with. typing over a selection inserts one, a paste over the same selection inserts all of it
  function added(before, after) {
    let start = 0;
    while (start < before.length && start < after.length && before[start] === after[start]) start++;
    let end = 0;
    while (end < before.length - start && end < after.length - start && before.at(-1 - end) === after.at(-1 - end)) end++;
    return after.length - start - end;
  }
  const clock = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const ago = (t) => {
    const m = Math.floor((Date.now() - t) / 60_000);
    return m < 1 ? 'just now' : `${m} min ago`;
  };

  // title and the sentences under it (sub() in ui.js)
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
    // one random roast per screen, already answered with one thing to do right now; after a lot of social media
    // today, that time and one thing it was enough for
    const minutes = Math.floor((today(usage.at) ? usage.ms : 0) / 60_000);
    return h('div', { class: 'd2t-card' },
      h('h2', { id: 'dis2tract-title' }, title),
      sub(sentences),
      go, links, answer(lateNight() ? LATE : instead(minutes) ?? pick(NEEDS)));
  }

  // past the scroll limit on a page opened on purpose (a long thread, a subreddit; search results and profiles have
  // no limit): another full budget for this page, as often as needed, each after a short wait so it stays a choice
  function moreScroll() {
    const more = `keep scrolling: ${settings.scrollScreens} more screens`;
    const button = h('button', {
      type: 'button',
      onclick: () => {
        if (button.disabled) return;
        button.disabled = true;
        let left = UNLOCK.moreScrollSeconds;
        button.textContent = `${more} in ${left} s`;
        const timer = setInterval(() => {
          if (!button.isConnected) clearInterval(timer);
          else if (--left > 0) button.textContent = `${more} in ${left} s`;
          else {
            clearInterval(timer);
            moreOn.set(href, (moreOn.get(href) ?? 0) + 1);
            evaluate();
          }
        }, 1000);
      },
    }, more);
    return h('p', {}, button);
  }

  function unlockBox(reason) {
    const box = h('div', { class: 'd2t-unlock' });
    if (reason === 'scroll') box.append(moreScroll());
    if (canExtend()) {
      box.append(
        h('button', { type: 'button', onclick: extend }, `+${UNLOCK.extendMinutes} min to finish up`),
        h('p', { class: 'd2t-small' }, `the next unlock then waits ${UNLOCK.extendedCooldownMinutes} min instead of ${UNLOCK.cooldownMinutes}.`),
      );
      return box;
    }
    const next = nextUnlockAt();
    if (next > Date.now()) {
      let why = `next unlock at ${clock(next)}. ${UNLOCK.perDay} a day, ${UNLOCK.cooldownMinutes} min apart.`;
      if (next === Infinity) why = `no unlocks left today: ${UNLOCK.perDay} a day.`;
      else if (lateNight()) why = `bedtime: no unlocks until ${clock(next)}.`;
      box.append(h('p', {}, why));
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
    // the answer is only what arrived one character at a time. a paste, a drop, a keyboard's clipboard chip,
    // dictation and swiped words land many at once and are undone. text another extension slips past these
    // listeners (one that re-enables paste can swallow the events) never reaches `typed`, the only thing judged
    let typed = '';
    const submit = () => {
      if (input.value !== typed) input.value = typed;
      if (done || !typed.trim()) return; // an empty enter is a slip, not an answer
      // a wrong answer in another tab since this challenge appeared: its wait holds here too, or a second open
      // sheet would be a way around it
      if (banUntil > Date.now()) return pause(sheet, close);
      done = true;
      if (c.check(typed)) unlock();
      else penalize(sheet, close, c.wrong);
    };
    input.addEventListener('input', (e) => {
      // and only real keys: a script (a bookmarklet, the console, a userscript) could set the text one character
      // at a time and fire input itself, but its events are never trusted
      if (!e.isTrusted || added(typed, input.value) > 1) input.value = typed;
      typed = input.value;
      if (c.live && c.check(typed)) submit();
    });
    // enter in the textarea answers instead of starting a new line. beforeinput, because key events are
    // swallowed at the window while the block screen is up
    input.addEventListener('beforeinput', (e) => {
      if (e.inputType !== 'insertLineBreak' && e.inputType !== 'insertParagraph') return;
      e.preventDefault();
      submit();
    });
    for (const type of ['paste', 'drop']) input.addEventListener(type, (e) => e.preventDefault());
    const form = h('form', {
      class: c.live ? 'd2t-field d2t-plain d2t-multi' : 'd2t-field d2t-plain',
      onsubmit: (e) => {
        e.preventDefault();
        submit();
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
  // in a shadow root. `heard`: only one with its sound on
  const playingNow = (heard) => [...document.querySelectorAll('video, audio'), ...playing]
    .some((m) => !m.paused && !m.ended && (!heard || (!m.muted && m.volume > 0)));
  // on screen and in use: the user did something lately, or something plays. playing alone would make a text feed
  // free, and a tab left open is not time spent: feeds loop muted clips on their own, and firefox keeps a phone's
  // screen on while a video with a sound track plays, muted or not (HTMLVideoElement::ShouldCreateVideoWakeLock),
  // so a muted player counts only within UNLOCK.mutedSeconds of the last input
  function inUse() {
    const idle = Date.now() - lastInput;
    if (document.visibilityState !== 'visible') return false;
    return idle <= UNLOCK.idleSeconds * 1000 || playingNow(true) || (idle <= UNLOCK.mutedSeconds * 1000 && playingNow());
  }

  // an unlock's minutes are feed minutes: they run only while a page the unlock lets through is in use, so time
  // left when the user goes elsewhere or pauses the video is still there later. saved every few seconds and on
  // leaving, not on every tick
  function spend() {
    if (!inUse()) return stopSpending();
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

  // time on social media today: any page of these sites while in use, never the block screen. background.js
  // counts the day's total for every tab from these notes, one per look
  function track() {
    if (!overlay && inUse()) browser.runtime.sendMessage('use');
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
    const mine = recent.find((r) => r.site === siteId)?.at ?? 0;
    hopFrom = recent.filter((r) => r.site !== siteId && now - r.at < HOP_MS);
    recent = [...hopFrom, { site: siteId, at: now }];
    browser.storage.local.set({ recent });
    // a hop is arriving here from another site's feed; more blocked pages here, or reloads, are not new hops
    if (hopFrom.some((r) => r.at > mine)) bump('hops');
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
        ...[mirror(), card(reason), unlockBox(reason)].filter(Boolean));
      if (fresh) chime();
      paint(overlay, theme);
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
    if (!unlimited && settings.scrollScreens && scrolled >= scrollCap()) return 'scroll';
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
    if (stopped && (!reason || unlocked())) return reopen();
    if (reason && unlocked()) {
      hide();
      spend();
    } else {
      stopSpending();
      if (reason) show(reason);
      else hide();
    }
    track();
    if (overlay && ++pauseTicks % 3 === 0) pauseAll(); // players that load later, every ~1.2 s while blocked
    if (!overlay) for (const m of playing) if (m.paused) playing.delete(m); // remember only what still plays
  }

  // a stopped page may show after all (unlocked, feed switched off): it loads for real, marked so that load is
  // let through instead of stopped again
  function reopen() {
    stopped = false;
    sessionStorage.setItem(PASS, location.href);
    location.reload();
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
    inFeed = Boolean(feed) || (!traversed && (inFeed || feedPassed) && key !== null && Date.now() - feedAt < 3000);
    feedPassed = false;
    traversed = false;
    unlimited = conversation(u) || site.free(u);
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
    if (d !== 0 && Math.abs(d) <= innerHeight) lastInput = Date.now(); // autoscroll and the scrollbar send no other input
    if (d <= 0 || d > innerHeight || overlay || unlimited || !active()) return;
    scrolled += d;
    scrolledOn.set(href, scrolled);
    if (settings.scrollScreens && scrolled >= scrollCap()) evaluate();
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
  // puts a wrapper of ours over a page method. an exported wrapper dies with this script's sandbox (an extension
  // update, reload or disable), and a page calling it then throws until reload. so each wrapper carries the page's
  // own method along, and the next instance of this script wraps that one, never a dead wrapper of an old instance.
  // after a disable nothing comes next: the dead wrappers stay until the tab reloads
  function wrap(proto, name, make) {
    const page = proto[name].dis2tractPage ?? proto[name];
    exportFunction(make(page), proto, { defineAs: name });
    proto[name].dis2tractPage = page;
  }
  const playing = new Set();
  wrap(window.wrappedJSObject.HTMLMediaElement.prototype, 'play', (play) => function () {
    playing.add(this);
    if (!overlay) return play.call(this);
    this.pause();
    return window.wrappedJSObject.Promise.resolve();
  });
  // pages call focus() on their own players and feeds all the time (tiktok, youtube, x). behind the block screen
  // that pulled the cursor out of the answer field mid-word, so while it is up such calls are ignored. our own
  // focus() calls go through firefox's xray to the original method and are not affected
  wrap(window.wrappedJSObject.HTMLElement.prototype, 'focus', (focus) => function (options) {
    if (overlay && !overlay.contains(this)) return;
    return focus.call(this, options);
  });
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
    if (changes.usage) usage = changes.usage.newValue ?? { at: 0, ms: 0 };
    // the wait after a wrong answer only lengthens the next pause. no redraw: that removed the open sheet, so a
    // wrong answer used to drop the user back on the block screen without a word
    if (changes.unlockBan) banUntil = changes.unlockBan.newValue ?? 0;
    // new theme colors are painted onto the open block screen, not redrawn: a theme that changes all the time
    // (one following the tab or the time of day) would close an open unlock sheet over and over
    if (changes.theme) {
      theme = changes.theme.newValue ?? {};
      overlay?.removeAttribute('style');
      if (overlay) paint(overlay, theme);
    }
    if (!['settings', 'unlocks', 'pending'].some((k) => k in changes)) return;
    if (changes.settings) settings = mergeSettings(changes.settings.newValue);
    if (changes.unlocks) unlocks = Array.isArray(changes.unlocks.newValue) ? changes.unlocks.newValue : [];
    if (changes.pending) pendingAt = changes.pending.newValue?.at ?? 0;
    if (overlay) overlay.dataset.state = ''; // stale: show() rebuilds it in place with the new values
    // a feed switched off or on changes what this url is
    if (changes.settings) refeed();
    else evaluate();
  });

  // background.js reports every history change of the page, so a new address is judged right away instead of at
  // the next look, before the site has drawn much of a feed. and a feed address the page already left again
  // (between two looks) still arms the carry, so the item it jumped to counts as the feed
  browser.runtime.onMessage.addListener((message) => {
    if (!message?.url) return;
    const reported = message.url.split('#')[0];
    const now = location.href.split('#')[0];
    const feed = reported !== now && reported !== href && feedOf(siteId, new URL(message.url), settings.toggles);
    if (feed) {
      [feedKey, feedLabel] = feed;
      feedAt = Date.now();
      feedPassed = true;
      // already looked at the item it jumped to: that item is the feed
      if (now === href && key !== null && !traversed) inFeed = true;
    }
    if (now !== href) onUrl();
    else evaluate();
  });

  // a click on a link to a feed becomes a full load of it, which stops before the site's own scripts run (see
  // below). otherwise the site's router fetches and draws the whole feed before this script can block it.
  // a new tab, a modified click or an unlocked site goes its usual way
  window.addEventListener('click', (e) => {
    if (!ready || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const link = e.target?.closest?.('a[href]');
    if (!link || link.target === '_blank') return;
    const u = new URL(link.href);
    if (u.host !== location.host || settings.sites[siteId] === false || unlocked() || !feedOf(siteId, u, settings.toggles)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    location.assign(u.href);
  }, true);

  onUrl(); // with defaults, so a feed is covered before storage answers and never flashes
  // a feed opened from scratch stops loading right here, before the site's own scripts and the feed itself: nothing
  // of it runs or downloads behind the block. sessionStorage is the one place the reload mark reopen() needs
  // survives a reload and can be read at once
  let pass = null;
  try {
    pass = sessionStorage.getItem(PASS) === location.href;
    sessionStorage.removeItem(PASS);
  } catch {
    // storage refused on this site: a stop could not be undone by a marked reload, so the page is not stopped
  }
  if (pass === false && overlay && inFeed) {
    window.stop();
    stopped = true;
  }
  Promise.all([loadSettings(), browser.storage.local.get(['unlocks', 'spent', 'usage', 'theme', 'unlockBan', 'pending', 'recent', TRAIL])]).then(([s, stored]) => {
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
    usage = stored.usage ?? usage;
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
