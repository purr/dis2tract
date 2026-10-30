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
  document.getElementById('dis2tract-left')?.remove(); // its time-left pill too, which would never count down again
  // a load is judged with default settings before storage answers, so no feed flashes. a page already up when this
  // instance starts and not blocked by the old one (an unlocked feed) waits for storage instead: the default pass put
  // the block screen over it for a moment, pausing its video and leaving fullscreen
  const coverEarly = Boolean(stale) || document.readyState === 'loading';
  const TRAIL = `trail:${siteId}`; // this site's run of items, kept a minute so a reload or new tab continues it
  const PASS = 'dis2tract:pass'; // sessionStorage mark: this load is the reload after a stop, let it through
  const STOPPED = 'data-dis2tract-stopped'; // on <html>: an instance stopped this load, so the site's page is not here
  // add-on policy 6.3.2: nothing from a private window is stored. its run of items lives in background.js's memory
  // (firefox does not open storage.session to content scripts), and its visits stay out of other windows' mirror
  const PRIVATE = browser.extension.inIncognitoContext;
  const UNLOCK_MS = UNLOCK.minutes * 60_000;
  const EXTEND_MS = UNLOCK.extendMinutes * 60_000;
  const HOP_MS = 10 * 60_000; // a block on another site this recently means the scroll just moved apps

  let settings = mergeSettings();
  let theme = {}; // css variables from background.js; the registered stylesheet paints them first, these keep an open page current
  let unlocks = []; // unlocks on every site, oldest first: [{ site, at, extended?, extendedAt?, doneAt? }]
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
  let booted = false; // the page load was judged with what storage holds: a block from now on appears while browsing
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
  let undone = null; // the url the switched-off tweaks were taken back on
  let tweakTries = 0;
  const chain = []; // distinct items viewed in a row, oldest first
  let scrolled = 0; // screens scrolled down on this url, each step measured against the window height at that moment
  const scrolledOn = new Map(); // per url, so coming back to a page resumes its budget
  const moreOn = new Map(); // per url, the screens keep scrolling added to its budget
  const lastTop = new WeakMap();
  const watchedRoots = new WeakSet(); // shadow roots with a play listener
  let pauseTicks = 0;
  let overlay = null;
  let closeSheet = null; // closes the open unlock sheet
  let pill = null; // the unlock's time left, over the page it lets through
  let stopped = false; // this load was stopped before the site loaded: nothing of it is under the block
  let countedHref = null; // the blocked url already counted, so a redraw is not a second block
  let hopFrom = []; // other sites the user went for within HOP_MS before this one

  const late = (t) => lateNight(settings, t); // bedtime now, or at time t
  const budget = (u) => UNLOCK_MS + (u.extended ? EXTEND_MS : 0);
  // when an unlock's time ran out, or would have if used in one go. an extra minute left unfinished counts from when
  // it was taken: counted from the unlock's start, an extra minute taken late in an unlock used in pieces moved the
  // next unlock earlier instead of 10 min later
  const end = (u) => (u ? u.doneAt ?? (u.extendedAt ? u.extendedAt + EXTEND_MS : u.at + budget(u)) : -Infinity);
  const today = (t) => new Date(t).toDateString() === new Date(Date.now()).toDateString();
  const cooldown = (u) => (u?.extended ? UNLOCK.extendedCooldownMinutes : UNLOCK.cooldownMinutes) * 60_000;
  // feed time left on this site's unlock. only the newest unlock counts, so a new one ends what was left of the
  // last, and only until the next unlock could start had it been used in one go. until midnight was too long:
  // an unlock tried in the morning left the feed open all day, and the block seemed broken
  function left() {
    const last = unlocks.at(-1);
    if (last?.site !== siteId || last.doneAt || late() || Date.now() >= end(last) + cooldown(last)) return 0;
    return budget(last) - (spent.at === last.at ? spent.ms : 0) - unsaved;
  }
  const unlocked = () => left() > 0;
  const scrollCap = () => settings.scrollScreens + (moreOn.get(href) ?? 0);
  // when bedtime ends: the next morning hour from t
  function morning(t = Date.now()) {
    const d = new Date(t);
    if (d.getHours() >= settings.bedtimeTo) d.setDate(d.getDate() + 1);
    d.setHours(settings.bedtimeTo, 0, 0, 0);
    return d.getTime();
  }
  const usedToday = () => unlocks.filter((u) => today(u.at)).length;
  // when the next unlock may start: Infinity once today's are used up, never inside bedtime
  function nextUnlockAt() {
    if (usedToday() >= UNLOCK.perDay) return Infinity;
    const last = unlocks.at(-1);
    const t = end(last) + cooldown(last);
    // a cooldown that ends inside bedtime waits for its end: the screen promised a time no unlock could start at
    return Math.max(late(t) ? morning(t) : t, late() ? morning() : 0);
  }
  // the extra minute: only for this site's unlock, only if it was the latest anywhere, once, only right after it
  // ran out, and not at bedtime
  function canExtend() {
    const last = unlocks.at(-1);
    return last?.site === siteId && !last.extended && !late() && last.doneAt > Date.now() - UNLOCK.extendGraceMinutes * 60_000;
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
  // 'numeric', not '2-digit': en-us reads 2:05 pm, not 02:05 pm. lowercased like every other line of the block screen
  const clock = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  const ago = (t) => {
    const m = Math.floor((Date.now() - t) / 60_000);
    return m < 1 ? 'just now' : `${m} min ago`;
  };
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`; // the settings can set a count to 1

  // title and the sentences under it (sub() in ui.js)
  const TEXT = {
    // no verb: the feed labels are written for the settings switches ("block popular and all"), and "reddit popular
    // and all is an endless feed." broke the grammar. 38 characters at most, like the roast (test/sites.test.js)
    feed: () => ['no feed', [`endless feed: ${site.name} ${feedLabel}.`, 'go somewhere on purpose.']],
    chain: () => [`${settings.chainLimit} in a row`, ['one after another is the feed again.']],
    // how deep the page is scrolled, keep scrolling's budgets included: 24 screens deep after one of them, not 12
    scroll: () => [`${plural(Math.floor(scrolled), 'screen')} deep`, ['this page turned into a feed.']],
  };

  // the mirror at the top, only when the user went for other feeds just before: which apps, how long ago. no
  // daily count: page loads and reloads made any count of attempts wrong
  function mirror() {
    if (!hopFrom.length) return null;
    return h('p', { class: 'd2t-mirror' }, `${hopFrom.map((r) => `${SITES[r.site].name} ${ago(r.at)}`).join(', ')}, now ${site.name}. same urge, new app.`);
  }

  function card(reason) {
    const [title, sentences] = TEXT[reason]();
    // the query is the user's own words, in any language: unknown language and its own direction, under an
    // english block screen
    const q = h('input', { type: 'search', placeholder: 'search, or @name for a profile', 'aria-label': `search ${site.name}, or @name for a profile`, autocomplete: 'off', enterkeyhint: 'go', lang: '', dir: 'auto' });
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
    const line = sub(sentences);
    line.setAttribute('id', 'dis2tract-sub'); // the dialog's description
    // one random roast per screen, already answered with one thing to do right now; after a lot of social media
    // today, that time and one thing it was enough for. it waits for storage (the day's time): picked on the first
    // paint, it flipped a moment later. its slot is reserved (overlay.css), so filling it in moves nothing
    const minutes = Math.floor((today(usage.at) ? usage.ms : 0) / 60_000);
    const roast = ready ? answer(late() ? LATE : instead(minutes) ?? pick(NEEDS)) : h('div', { class: 'd2t-answer' });
    return h('div', { class: 'd2t-card' }, h('h2', { id: 'dis2tract-title' }, title), line, go, links, roast);
  }

  // past the scroll limit on a page opened on purpose (a long thread, a subreddit; search results and profiles have
  // no limit): another full budget for this page, as often as needed, each after a short wait so it stays a choice
  function moreScroll() {
    const more = `keep scrolling: ${plural(settings.scrollScreens, 'more screen')}`;
    const button = h('button', {
      type: 'button',
      onclick: () => {
        if (button.disabled) return;
        button.disabled = true;
        // the wait is for this page. back/forward to another page past its budget keeps this block screen, and the
        // extra budget went to whichever page was shown when the wait ended
        const page = href;
        let left = UNLOCK.moreScrollSeconds;
        button.textContent = `${more} in ${left} s`;
        const timer = setInterval(() => {
          if (!button.isConnected) clearInterval(timer);
          else if (href !== page) {
            // left before the wait was over: no budget, and the offer is open again on the page now shown
            clearInterval(timer);
            button.disabled = false;
            button.textContent = more;
          } else if (--left > 0) button.textContent = `${more} in ${left} s`;
          else {
            clearInterval(timer);
            // a full budget from where the page is: scrolling during an unlock counts, so a page can end up far past
            // its cap, and one more budget on top of the cap left it blocked through wait after wait
            moreOn.set(page, Math.max(scrollCap(), scrolled));
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
      // the wait the last unlock really left: 30 min after the extra minute, not the 20 of the rule
      let why = `next unlock at ${clock(next)}. ${UNLOCK.perDay} a day, ${cooldown(unlocks.at(-1)) / 60_000} min apart.`;
      if (next === Infinity) why = `no unlocks left today: ${UNLOCK.perDay} a day.`;
      // bedtime now, or the wait ends with it (a cooldown that ran into it)
      else if (late(next - 1)) why = `bedtime: no unlocks until ${clock(next)}.`;
      box.append(h('p', {}, why));
    } else {
      const open = h('button', { type: 'button', onclick: () => openSheet(open) }, `unlock ${site.name} for ${UNLOCK.minutes} min`);
      // the day's unlocks left, under the button: in its 36 px pill the line would wrap. a blank line (a no-break
      // space: a plain one makes no line at all) until storage answers, so the screen does not move when it comes in
      const count = ready ? `${UNLOCK.perDay - usedToday()} of ${UNLOCK.perDay} unlocks left today.` : '\u00a0';
      box.append(open, h('p', { class: 'd2t-small' }, count));
    }
    return box;
  }

  // the unlock flow runs in a sheet over the block screen, so nothing on the page moves while it grows
  function openSheet(opener) {
    // the block screen under the sheet is inert while it is up: no tab stops behind it, and the covered unlock button
    // cannot open a second sheet. these are the overlay's own nodes, which go away with it (unlike an inert <body>)
    const behind = [...overlay.children];
    const sheet = h('div', { class: 'd2t-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': `unlock ${site.name}`, 'aria-describedby': 'dis2tract-lead dis2tract-note dis2tract-count' });
    // closing plays the opening backwards (css [data-closing]), then removes the layer. a timer, not
    // animationend, so a missing stylesheet or a skipped animation can never leave the layer up
    const close = () => {
      if (layer.hasAttribute('data-closing')) return;
      layer.setAttribute('data-closing', '');
      closeSheet = null;
      for (const el of behind) el.removeAttribute('inert');
      opener.focus(); // back where the keyboard user started; it can take focus again now that it is not inert
      setTimeout(() => layer.remove(), 250);
    };
    const layer = h('div', { class: 'd2t-layer', onclick: (e) => e.target === layer && close() }, sheet);
    for (const el of behind) el.setAttribute('inert', '');
    overlay.append(layer);
    closeSheet = close;
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
    const count = h('p', { id: 'dis2tract-count' }, line());
    const timer = setInterval(() => {
      if (!sheet.isConnected) clearInterval(timer);
      else if (--left > 0) count.textContent = line();
      else {
        clearInterval(timer);
        challenge(sheet, close);
      }
    }, 1000);
    // the user's own words, in their own language and direction, and never machine-translated
    const note = settings.note && h('p', { class: 'd2t-sentence', id: 'dis2tract-note', lang: '', dir: 'auto', translate: 'no' }, settings.note);
    const lead = verdict
      ? h('p', { role: 'alert' }, `wrong. ${verdict}`)
      : h('p', { id: 'dis2tract-lead' }, note ? 'take a breath. you wrote this for this moment:' : 'take a breath.');
    const stop = neverMind(close);
    sheet.replaceChildren(...[lead, note, count, stop].filter(Boolean));
    stop.focus(); // focus moves into the sheet with the user
  }

  function challenge(sheet, close) {
    const c = pick(CHALLENGES)(settings.sentenceWords);
    let done = false; // one verdict per challenge: a second enter must not count a second wrong answer
    // a sentence wraps in a textarea, so a typo stays visible on a phone; a number fits one line. what to type is
    // the field's description, so a screen reader reads it out with the field
    const input = h(c.live ? 'textarea' : 'input', {
      'aria-label': c.ask, 'aria-describedby': 'dis2tract-show', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false',
      inputmode: c.live ? 'text' : 'numeric', placeholder: 'your answer', ...(c.live && { rows: '3' }),
    });
    // the answer is only what arrived one character at a time. a paste, a drop, a keyboard's clipboard chip,
    // dictation and swiped words land many at once and are undone. text another extension slips past these
    // listeners (one that re-enables paste can swallow the events) never reaches `typed`, the only thing judged
    let typed = '';
    let beforeDelete = null; // the text before the last event, when that event only took text away
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
      // at a time and fire input itself, but its events are never trusted. a keyboard's own edit can land as a
      // delete and then an insert (android's double-space period: ' ' out, '. ' in): an insert refused on its own
      // is judged together with the delete before it, or the user's space was lost and the next word ran into it
      const ok = e.isTrusted && (added(typed, input.value) <= 1 || (beforeDelete !== null && added(beforeDelete, input.value) <= 1));
      if (!ok) input.value = typed;
      beforeDelete = input.value.length < typed.length ? typed : null;
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
    // translate=no: a page translator (firefox's own takes in all of <html> on a stopped page, which has no <body>)
    // replaced the very words the answer is checked against
    sheet.replaceChildren(h('p', {}, ask), h('p', { class: 'd2t-sentence', id: 'dis2tract-show', translate: 'no' }, c.show), form, neverMind(close));
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
    const last = { ...unlocks.at(-1), extended: true, extendedAt: Date.now() };
    delete last.doneAt; // running again, for the extra minute; its wait counts from now (end())
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

  function stopSpending(leaving = false) {
    spentAt = 0;
    if (unsaved) save(leaving);
  }

  async function save(leaving = false) {
    const ms = unsaved;
    unsaved = 0;
    // leaving reads nothing first: firefox never settles an api promise of a page that is gone or in the back-forward
    // cache (wrapPromise in ExtensionCommon.sys.mjs), so the write after the read never happened. this tab's copies
    // follow every storage change
    const stored = leaving ? { unlocks, spent } : await browser.storage.local.get(['unlocks', 'spent']);
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
    // a note background.js can't take (firefox stopped restarting it after repeated crashes) loses one look of the
    // day's time; logging it would only fill the console every 400 ms
    if (!overlay && inUse()) browser.runtime.sendMessage('use').catch(() => {});
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
    if (!PRIVATE) browser.storage.local.set({ recent });
    // a hop is arriving here from another site's feed; more blocked pages here, or reloads, are not new hops
    if (hopFrom.some((r) => r.at > mine)) bump('hops');
  }

  function show(reason) {
    // what the card says (its text, bedtime's question) and what the unlock part offers. a move between two blocked
    // feeds or pages under the open block screen kept the first one's name; the promised time is part of it, so the
    // screen is redrawn when bedtime moves it
    const next = nextUnlockAt();
    const face = `${TEXT[reason]().flat().join(' ')} ${late()}`;
    const state = `${face} ${canExtend() ? 'extend' : next > Date.now() ? `wait ${next}` : 'open'}`;
    const was = overlay?.dataset.state ?? '';
    if (was !== state && was.startsWith(`${face} `) && !was.endsWith(' open')) {
      // only the unlock part moved on (a cooldown ended, the extra minute's window closed): its content alone is
      // swapped, so a half-typed search keeps its text, focus and phone keyboard. never from 'open', where a sheet
      // may be up that has to go. a running keep-scrolling wait (first in the box) stays where it is, with its focus
      const box = overlay.querySelector('.d2t-unlock');
      const kept = reason === 'scroll' ? 1 : 0;
      for (const el of [...box.children].slice(kept)) el.remove();
      box.append(...[...unlockBox(reason).children].slice(kept));
      overlay.dataset.state = state;
    } else if (was !== state) {
      // only a block that was not up a moment ago fades in and chimes; a redraw replaces it in place. never a page
      // load, which has to cover the feed at once, also when its block needed storage first (the chain, the carry)
      const fresh = !overlay && booted;
      // a redraw keeps what was typed in the search, and the focus on it
      const search = overlay?.querySelector('input[type=search]');
      const typing = Boolean(search) && document.activeElement === search;
      hide();
      if (ready && href !== countedHref) record();
      // mirror pinned at the top, the block centered, the unlock at the bottom. english whatever the site's
      // language: inherited, a screen reader read it with the site's voice and right-to-left scrambled it.
      // data-live: the theme from storage is painted on, the registered stylesheet (first paint only) steps aside
      overlay = h('div', { id: 'dis2tract', lang: 'en', dir: 'ltr', 'data-reason': reason, 'data-state': state, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dis2tract-title', 'aria-describedby': 'dis2tract-sub', tabindex: '-1', ...(ready && { 'data-live': '' }), ...(fresh && { 'data-enter': '' }) },
        ...[mirror(), card(reason), unlockBox(reason)].filter(Boolean));
      const q = overlay.querySelector('input[type=search]');
      if (search) q.value = search.value;
      if (fresh) chime();
      paint(overlay, theme);
      pauseAll();
      // a fullscreen player sits in the top layer, above any z-index, and would hide the block screen.
      // a refused exit only means the page stays fullscreen; there is nothing else to try
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      // focus goes to the dialog, not into the field: keyboard users tab from there, nobody gets a glowing
      // field they did not ask for, and no phone keyboard pops up
      queueMicrotask(() => (typing ? q : overlay)?.focus());
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
    closeSheet = null;
    root.removeAttribute('data-dis2tract-blocked');
  }

  // the unlock's time left, in a pill over the page it lets through: minutes, then seconds for the last 30, so the
  // block does not land out of nowhere. its own element, never the block screen: every `overlay` check treats the
  // page as blocked (paused players, swallowed keys)
  function timeLeft(on) {
    const last = unlocks.at(-1);
    const now = Date.now();
    // the feed time, or the clock where it ends sooner: when the next unlock could start, or bedtime (an unlock
    // runs only outside it, so today's start of it is still ahead)
    const ms = on ? Math.min(left(), end(last) + cooldown(last) - now, new Date(now).setHours(settings.bedtimeFrom, 0, 0, 0) - now) : 0;
    if (ms <= 0) {
      pill?.remove();
      pill = null;
      return;
    }
    pill ??= h('div', { id: 'dis2tract-left', role: 'timer', lang: 'en', dir: 'ltr' });
    const text = ms > 30_000 ? `${Math.ceil(ms / 60_000)} min left` : `${Math.ceil(ms / 1000)} s left`;
    if (pill.textContent !== text) pill.textContent = text; // runs every tick: no mutation unless it changed
    pill.toggleAttribute('data-ending', ms <= 30_000);
    if (!pill.isConnected || pill.nextElementSibling) root.append(pill); // above <body>, like the overlay
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

  // where this site's run of items stands, and how much of this page's scroll budget is used, for a reload or a new
  // tab within a minute. a private window's goes to background.js's memory instead (PRIVATE)
  function saveTrail() {
    const value = { chain: [...chain], inFeed, feedKey, feedLabel, at: Date.now(), scroll: { href, screens: scrolled, more: moreOn.get(href) ?? 0 } };
    if (PRIVATE) browser.runtime.sendMessage({ trail: TRAIL, value });
    else browser.storage.local.set({ [TRAIL]: value });
  }

  // the site's extras (youtube theater mode): tried each tick until done for this url, given up after ~10 s
  function tweak() {
    // not before storage answers: a tweak switched off in settings must never run, not even once
    if (!ready || tweaked === href) return;
    const u = new URL(location.href);
    const tweaks = Object.entries(site.tweaks ?? {});
    const on = ([name, t]) => settings.sites[siteId] !== false && (settings.toggles[`${siteId}.${name}`] ?? t.on);
    // one switched off, or its whole site, takes back what it left behind (theater's cookie), once per url
    if (undone !== href) {
      undone = href;
      for (const entry of tweaks) if (!on(entry)) entry[1].undo?.(u);
    }
    if (settings.sites[siteId] === false) return;
    const left = tweaks.filter((entry) => on(entry) && !entry[1].run(u));
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
    if (!ready && !coverEarly) return;
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
    const open = Boolean(reason) && unlocked();
    if (open) {
      hide();
      spend();
    } else {
      stopSpending();
      if (reason) show(reason);
      else hide();
    }
    timeLeft(open);
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
    else if (seen === -1) {
      chain.push(key);
      // past the highest possible limit the verdict is the same, and the whole run is written on every url change
      if (chain.length > LIMITS.chainLimit[1] + 1) chain.shift();
    } else chain.length = seen + 1;
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
    // counted during an unlock too: past its budget the page spends the unlock's minutes and is blocked when they
    // run out. skipped while unlocked, budgeted pages scrolled free for the unlock's whole 23 minutes
    if (d <= 0 || d > innerHeight || overlay || unlimited || settings.sites[siteId] === false) return;
    // in screens, each step measured against the window height at that moment: pixels held against the live height
    // let a taller window (turned to portrait, maximized) lift the block, and a shorter one (a video fullscreened in
    // landscape) block early
    scrolled += d / innerHeight;
    scrolledOn.set(href, scrolled);
    if (settings.scrollScreens && scrolled >= scrollCap() && !unlocked()) {
      if (ready) saveTrail(); // a reload or a new tab of this page within a minute keeps the budget used
      evaluate();
    }
  }, { capture: true, passive: true });
  // firefox has set the new address when popstate fires (nsDocShell.cpp: SetDocumentURI, then DispatchSyncPopState),
  // and this listener, added at document_start, runs before the site's. so where back/forward lands is judged here,
  // before a feed there can jump on to an item of its own pick (instagram's reels tab). a fragment navigation fires
  // popstate too, with the page unchanged: counting it left the flag up and cancelled the next feed carry
  window.addEventListener('popstate', () => {
    if (location.href.split('#')[0] === href) return;
    traversed = true;
    onUrl();
  }, true);
  // another tab, another app or a locked screen pauses the unlock's minutes
  document.addEventListener('visibilitychange', () => evaluate());
  // closing or leaving the tab saves the minutes spent, and where this site's run and this page's budget stand
  window.addEventListener('pagehide', () => {
    stopSpending(true);
    if (ready) saveTrail();
  });
  for (const type of ['pointerdown', 'wheel', 'touchmove', 'keydown']) {
    window.addEventListener(type, () => { lastInput = Date.now(); }, { capture: true, passive: true });
  }

  // registered at document_start, so these run before any page listener: site shortcuts (k, j, arrows)
  // cannot fire behind the overlay. typing still works, text input is the default action, not a listener.
  for (const type of ['keydown', 'keyup', 'keypress']) {
    window.addEventListener(type, (e) => {
      if (!overlay) return;
      e.stopImmediatePropagation();
      // escape closes the unlock sheet, as it does a dialog. not while an ime composes: there it cancels the word
      if (e.type === 'keydown' && e.key === 'Escape' && !e.isComposing) closeSheet?.();
    }, true);
  }
  document.addEventListener('play', (e) => overlay && e.target.pause(), true);
  // puts a wrapper of ours over a page method. an exported wrapper dies with this script's sandbox (an extension
  // update, reload or disable), and a page calling it then throws until reload. so each wrapper carries the page's
  // own method along, and the next instance of this script wraps that one, never a dead wrapper of an old instance.
  // 0.7.0 and older left theirs without that mark: dead since that version's sandbox went, one passes for the page's
  // own method and throws on every call, so firefox's own method (`own`, read through the xray) stands in for it.
  // after a disable nothing comes next: the dead wrappers stay until the tab reloads
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
  // players in no document at all (tiktok's photo-post music is a new Audio() that is never attached) are out of
  // reach of every pause path above. so the page's own play() is wrapped: while the block screen is up nothing
  // starts, and whatever started before is remembered to be paused. the set is emptied on every pause, so it only
  // ever holds what is playing now
  const playing = new Set();
  wrap(window.wrappedJSObject.HTMLMediaElement.prototype, HTMLMediaElement.prototype.play, 'play', (play) => function () {
    // remembered only once play() or pause() accepted `this`: a non-media one (a page's tamper probe) stayed in the
    // set for good, counted as playing, and made pauseAll() throw before it paused players or left fullscreen
    const started = overlay ? (this.pause(), window.wrappedJSObject.Promise.resolve()) : play(this);
    playing.add(this);
    return started;
  });
  // pages call focus() on their own players and feeds all the time (tiktok, youtube, x). behind the block screen
  // that pulled the cursor out of the answer field mid-word, so while it is up such calls are ignored. our own
  // focus() calls go through firefox's xray to the original method and are not affected
  wrap(window.wrappedJSObject.HTMLElement.prototype, HTMLElement.prototype.focus, 'focus', (focus) => function (options) {
    if (overlay && !overlay.contains(this)) return;
    return focus(this, options);
  });
  // tab focus stays in the block screen: focus that lands outside it (tabbing past the end) goes back to the
  // field the user was in, not to the dialog, so typing carries on. and the page hears of no focus while it is up:
  // a site's own focus trap answers focusin by blurring whatever took focus (reddit's modals listen on the window),
  // which would close the phone keyboard on every tap of the answer field
  let lastFocus = null;
  window.addEventListener('focusin', (e) => {
    if (!overlay) return;
    e.stopImmediatePropagation();
    if (overlay.contains(e.target)) lastFocus = e.target;
    else (lastFocus?.isConnected && overlay.contains(lastFocus) ? lastFocus : overlay).focus();
  }, true);

  function onStorage(changes, area) {
    if (area !== 'local') return;
    if (changes.recent) recent = changes.recent.newValue ?? [];
    if (changes.spent) spent = changes.spent.newValue ?? { at: 0, ms: 0 };
    if (changes.usage) usage = changes.usage.newValue ?? { at: 0, ms: 0 };
    // the wait after a wrong answer only lengthens the next pause. no redraw: that removed the open sheet, so a
    // wrong answer used to drop the user back on the block screen without a word
    if (changes.unlockBan) banUntil = changes.unlockBan.newValue ?? 0;
    // new theme colors are painted onto the open block screen, not redrawn: a theme that changes all the time
    // (one following the tab or the time of day) would close an open unlock sheet over and over. data-live: the
    // registered stylesheet, which firefox keeps in pages loaded under an older theme, steps aside
    if (changes.theme) {
      theme = changes.theme.newValue ?? {};
      if (overlay) {
        overlay.removeAttribute('style');
        overlay.setAttribute('data-live', '');
        paint(overlay, theme);
      }
    }
    if (!['settings', 'unlocks', 'pending'].some((k) => k in changes)) return;
    if (changes.settings) settings = mergeSettings(changes.settings.newValue);
    if (changes.unlocks) unlocks = Array.isArray(changes.unlocks.newValue) ? changes.unlocks.newValue : [];
    if (changes.pending) pendingAt = changes.pending.newValue?.at ?? 0;
    if (overlay) overlay.dataset.state = ''; // stale: show() rebuilds it in place with the new values
    // a feed switched off or on changes what this url is
    if (changes.settings) refeed();
    else evaluate();
  }
  browser.storage.onChanged.addListener(onStorage);
  // firefox drops extension events while a page sits in the back-forward cache (shouldFire in ExtensionCommon.sys.mjs),
  // so a page restored from it catches up on everything it may have missed
  window.addEventListener('pageshow', async (e) => {
    if (!e.persisted) return;
    const keys = ['recent', 'spent', 'usage', 'unlockBan', 'theme', 'settings', 'unlocks', 'pending'];
    const stored = await browser.storage.local.get(keys);
    onStorage(Object.fromEntries(keys.map((k) => [k, { newValue: stored[k] }])), 'local');
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
    // the composed path, not target.closest(): a link inside a web component (reddit's left nav: home, popular)
    // reaches the window retargeted to its host. an svg link (its href an object) is no page link
    const link = e.composedPath().find((n) => n.localName === 'a' && typeof n.href === 'string' && n.href);
    // a target other than this tab (_blank, a named window, in any case) loads elsewhere by itself
    if (!link || (link.target && !/^_(self|top|parent)$/i.test(link.target))) return;
    const u = URL.parse(link.href);
    if (!u || u.host !== location.host || settings.sites[siteId] === false || unlocked() || !feedOf(siteId, u, settings.toggles)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    // the full load paints its block at once and only redraws it, so it never chimes (`fresh` in show()): the bell
    // goes with the click. not on a double click's second, which only loads the same address again
    if (e.detail < 2) chime();
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
  // only a load still at its start: an update, reload or re-enable of the extension runs this again in open tabs,
  // where a stop cut the page's requests and reopen() reloaded a page in use. a page an earlier instance stopped
  // carries the mark on <html>, so it still loads for real once it may show
  if (pass === false && overlay && inFeed && document.readyState === 'loading') {
    // the stop can come before the site's own viewport meta (m.youtube.com has a script first): firefox for android
    // then laid the page out 980px wide (browser.viewport.desktopWidth) and showed the block screen at ~40%
    root.prepend(h('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }));
    window.stop();
    root.setAttribute(STOPPED, '');
  }
  stopped = root.hasAttribute(STOPPED);
  Promise.all([
    loadSettings(),
    browser.storage.local.get(['unlocks', 'spent', 'usage', 'theme', 'unlockBan', 'pending', 'recent', TRAIL]),
    PRIVATE && browser.runtime.sendMessage({ getTrail: TRAIL }).catch((e) => console.error('dis2tract: private run of items not read', e)),
  ]).then(([s, stored, kept]) => {
    settings = s;
    // a reload or a new tab within a minute continues the run of items, the feed this item was carried from and
    // this page's scroll budget. a private window's own run is in background.js; one from a normal window counts too
    const trail = kept?.at > (stored[TRAIL]?.at ?? 0) ? kept : stored[TRAIL];
    // a link followed from another site (a search engine's results) starts a new run, as the block screen's search
    // does. only on a fresh navigation: firefox sends a tab's first referrer again on reload and keeps it across
    // pushState (whatwg/html#6813), so the referrer alone would make a reload a way out of a chain block
    const elsewhere = performance.getEntriesByType('navigation')[0]?.type === 'navigate'
      && Boolean(document.referrer) && siteFor(new URL(document.referrer).hostname) !== siteId;
    if (trail && !elsewhere && Date.now() - trail.at < 60_000) {
      chain.splice(0, chain.length, ...trail.chain);
      if (trail.inFeed && trail.chain.at(-1) === key) {
        inFeed = true;
        feedAt = Date.now();
        [feedKey, feedLabel] = [trail.feedKey, trail.feedLabel];
      }
      // the larger of the two: steps of a scroll restore counted before storage answered are not counted twice
      if (trail.scroll?.href === href) {
        scrolledOn.set(href, Math.max(scrolledOn.get(href) ?? 0, trail.scroll.screens));
        moreOn.set(href, trail.scroll.more);
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
    booted = true;

    // single-page apps change the url without a load; polling catches every router.
    // evaluate on the other ticks re-blocks the moment an unlock runs out, and redraws when a cooldown ends.
    setInterval(() => (location.href.split('#')[0] === href ? evaluate() : onUrl()), 400);
  });
})();
