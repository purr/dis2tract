const form = document.querySelector('form');
const store = browser.storage.local;
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function el(tag, props = {}, ...kids) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids);
  return node;
}
const row = (name, ...controls) => el('label', { className: 'row' }, el('span', { textContent: name }), ...controls);
function toggle(name, label) {
  const box = el('input', { type: 'checkbox', name });
  box.setAttribute('role', 'switch');
  return row(label, box, el('span', { className: 'switch' }));
}

// one group per site: limit it at all, each feed, its tweaks, and a handle where the site has no "me" url
const defaults = {}; // toggle name -> its default
for (const [id, site] of Object.entries(SITES)) {
  const rows = [toggle(`site:${id}`, `limit ${site.name}`)];
  for (const [key, label] of site.feeds) {
    defaults[`${id}.${key}`] = true;
    rows.push(toggle(`toggle:${id}.${key}`, `block ${label}`));
  }
  for (const [key, t] of Object.entries(site.tweaks ?? {})) {
    defaults[`${id}.${key}`] = t.on;
    rows.push(toggle(`toggle:${id}.${key}`, t.label));
  }
  if (!site.me) {
    const handle = el('input', { type: 'text', name: `handle:${id}`, placeholder: '@handle', autocomplete: 'off', spellcheck: false });
    // the name starts with the visible label, so voice control finds "my handle" (wcag 2.5.3)
    handle.setAttribute('aria-label', `my handle on ${site.name}, for a "my profile" link`);
    rows.push(row('my handle', handle));
  }
  document.getElementById('sites').append(el('section', {}, el('h2', { textContent: site.name }), el('div', { className: 'group' }, ...rows)));
}
for (const [name, [min, max]] of Object.entries(LIMITS)) Object.assign(form.elements[name], { min, max });
document.getElementById('limits-note').textContent =
  `0 turns a limit off. an unlock gives ${UNLOCK.minutes} min of feed, counted only while you watch or scroll; the next waits ` +
  `${UNLOCK.cooldownMinutes} min after they run out; ${UNLOCK.perDay} a day, across all sites; none from ` +
  `${UNLOCK.bedtime[0]}:00 to ${UNLOCK.bedtime[1]}:00. anything that loosens a ` +
  `setting applies ${LOOSEN_DELAY_MINUTES} min after you change it.`;

function applyTheme(theme = {}) {
  document.documentElement.style.cssText = '';
  for (const [k, v] of Object.entries(theme)) document.documentElement.style.setProperty(k, v);
}
// synchronous, so the first paint already has the theme; storage carries later theme changes
applyTheme(browser.extension.getBackgroundPage()?.theme);

function fill(s) {
  for (const field of form.elements) {
    // the field being typed in keeps its text: it saves on every keystroke, and a refill would drop what was typed
    // since and move the cursor
    if (field === document.activeElement && ['text', 'textarea'].includes(field.type)) continue;
    const [kind, id] = field.name.split(':');
    if (kind === 'site') field.checked = s.sites[id] !== false;
    else if (kind === 'toggle') field.checked = s.toggles[id] ?? defaults[id];
    else if (kind === 'handle') field.value = s.handles[id] ?? '';
    else if (field.type === 'checkbox') field.checked = s[field.name];
    else if (field.name) field.value = s[field.name];
  }
}

function showPending(pending) {
  const banner = document.getElementById('pending');
  banner.hidden = !pending;
  if (pending) banner.querySelector('span').textContent = `looser settings below apply at ${clock(pending.at)}.`;
}

async function render() {
  await loadSettings(); // puts a change that is already due in place, so the page never shows a past time
  const { settings, pending, stats } = await store.get(['settings', 'pending', 'stats']);
  // a waiting change shows as it will be, so editing builds on it; the note and handles never wait,
  // so they always come from the live settings
  const live = mergeSettings(settings);
  fill({ ...mergeSettings(pending?.settings ?? settings), note: live.note, handles: live.handles });
  showPending(pending);
  if (stats?.since) {
    const parts = [[stats.unlocks, 'unlocks'], [stats.wrong, 'wrong answers'], [stats.hops, 'app hops']];
    document.getElementById('stats').textContent =
      `since ${new Date(stats.since).toLocaleDateString()}: ${parts.map(([n, what]) => `${n ?? 0} ${what}`).join(', ')}.`;
  }
}

// handles and the note save on every keystroke too: closing the tab while a field still has focus fires no
// change event. numbers wait for change, or typing 20 would briefly save 2 and block other tabs. tidy rewrites
// the fields to what was saved, only on change, so typing is never fought.
async function save(tidy) {
  const next = { version: DEFAULTS.version, sites: {}, handles: {}, toggles: {} };
  for (const field of form.elements) {
    const [kind, id] = field.name.split(':');
    if (kind === 'site') {
      if (!field.checked) next.sites[id] = false;
    } else if (kind === 'toggle') {
      if (field.checked !== defaults[id]) next.toggles[id] = field.checked;
    } else if (kind === 'handle') {
      const handle = field.value.trim().replace(/^@/, '');
      if (handle) next.handles[id] = handle;
      if (tidy) field.value = handle;
    } else if (kind === 'note') {
      if (field.value.trim()) next.note = field.value.trim();
    } else if (field.type === 'checkbox') {
      if (field.checked !== DEFAULTS[field.name]) next[field.name] = field.checked;
    } else if (field.name in LIMITS) {
      // an emptied or invalid field means the default, not 0 (0 would switch the limit off).
      // clamp to LIMITS: a typed value skips the browser's range check.
      const [min, max] = LIMITS[field.name];
      const n = field.value === '' ? NaN : Math.round(Number(field.value));
      const value = Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : DEFAULTS[field.name];
      if (value !== DEFAULTS[field.name]) next[field.name] = value;
      if (tidy) field.value = value;
    }
  }
  const { settings, pending: waiting } = await store.get(['settings', 'pending']);
  const live = settings?.version === DEFAULTS.version ? settings : { version: DEFAULTS.version };
  const now = tighterPart(next, live);
  let at = null; // when the waiting part applies
  if (looser(mergeSettings(next), mergeSettings(now))) {
    // only the loosening part waits. its timer keeps running through later edits, and starts over only when
    // the change loosens more than what was already waiting.
    const more = !waiting || looser(mergeSettings(next), mergeSettings(waiting.settings));
    const pending = { settings: next, at: more ? Date.now() + LOOSEN_DELAY_MINUTES * 60_000 : waiting.at };
    await store.set({ pending, settings: now });
    showPending(pending);
    at = pending.at;
  } else {
    await store.set({ settings: next });
    await store.remove('pending');
    showPending(null);
  }
  // the live status speaks on a change, not on every keystroke of the note or a handle, and a loosening says it
  // waits: the banner saying so is not read out, and is often scrolled out of view
  if (tidy) form.querySelector('output').textContent = at ? `saved. looser settings apply at ${clock(at)}.` : 'saved';
}

form.addEventListener('input', (e) => ['text', 'textarea'].includes(e.target.type) && save(false));
form.addEventListener('change', () => save(true));
document.getElementById('cancel').addEventListener('click', async () => {
  await store.remove('pending');
  render();
  form.querySelector('output').textContent = 'cancelled'; // the status no longer names a time that is gone
});
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.theme) applyTheme(changes.theme.newValue);
  // a change from another settings tab (a duplicate, or android's new one per toolbar tap) or a waiting change that
  // applied: refill, or this tab's next save writes its older form back, and a limit tightened over there returns
  // as a waiting loosening
  if (changes.settings || changes.pending) render();
});
// firefox runs an add-on in private windows only once the user allows it there, and nothing else says so
browser.extension.isAllowedIncognitoAccess().then((allowed) => (document.getElementById('private').hidden = allowed));
render();
