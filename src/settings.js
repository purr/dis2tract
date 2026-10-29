// settings shared by the content scripts and the options page.
// var, not const: the binding must be visible to the other script files loaded next to this one.
var DEFAULTS = {
  version: 2, // bump when the saved shape changes; saved settings of another version are discarded
  sites: {}, // siteId -> false when switched off; every site in SITES is on by default
  handles: {}, // siteId -> your handle, for the "my profile" link on sites without SITES[id].me
  toggles: {}, // "siteId.feed" -> false lets that feed through; "siteId.tweak" -> true/false overrides its default
  note: '', // a note to your future self, shown before an unlock and on the farewell page
  scrollScreens: 12, // screens of scrolling allowed per page, 0 = no limit
  chainLimit: 4, // different videos/posts in a row, 0 = no limit
  sentenceWords: 15,
  chime: true, // a clock chime when a block appears while browsing
};
// [min, max] of each number setting; the options page builds its inputs from this, loading clamps older saves
var LIMITS = { scrollScreens: [0, 500], chainLimit: [0, 100], sentenceWords: [12, 60] };

// fixed on purpose, no settings: nothing to stretch in a weak moment. the limits span all sites, so hopping
// from one unlocked feed to the next is not a way around them.
var UNLOCK = {
  minutes: 3,
  cooldownMinutes: 20, // from the end of one unlock to the start of the next
  perDay: 10,
  bedtime: [23, 5], // hours: from the first to the second no unlock starts or runs; late scrolling costs sleep
  waitSeconds: 15, // the pause before a challenge
  idleSeconds: 10, // nothing playing and no input this long: an unlock's minutes stop running
  penaltySeconds: 30, // a wrong number waits this long for a new challenge
  moreScrollSeconds: 10, // past the scroll limit: the wait before another full budget for that page
  // right after an unlock ends: one extra minute to finish a video, paid for with a longer cooldown
  extendMinutes: 1,
  extendGraceMinutes: 2,
  extendedCooldownMinutes: 30,
};
// a change that loosens anything waits this long before it applies; tightening applies at once
var LOOSEN_DELAY_MINUTES = 10;

// only values that differ from DEFAULTS are saved, so a changed default reaches everyone who kept it
function mergeSettings(saved) {
  if (saved?.version !== DEFAULTS.version) saved = {};
  const merged = { ...DEFAULTS, ...saved, sites: { ...saved.sites }, handles: { ...saved.handles }, toggles: { ...saved.toggles } };
  for (const [key, [min, max]] of Object.entries(LIMITS)) merged[key] = Math.min(max, Math.max(min, merged[key]));
  return merged;
}

// true when next lets more through than current: a site switched off, a feed let through, a limit raised or
// turned off (0), or a shorter unlock sentence. tweaks are neither looser nor tighter.
const feedKeys = () => Object.entries(SITES).flatMap(([id, site]) => site.feeds.map(([key]) => `${id}.${key}`));
function looser(next, current) {
  const limit = (key) => (next[key] === 0 ? current[key] !== 0 : current[key] !== 0 && next[key] > current[key]);
  return Object.entries(next.sites).some(([id, on]) => on === false && current.sites[id] !== false)
    || feedKeys().some((key) => next.toggles[key] === false && current.toggles[key] !== false)
    || limit('scrollScreens') || limit('chainLimit') || next.sentenceWords < current.sentenceWords;
}

// the part of a saved change that applies at once: everything in next except what loosens, which keeps its
// live value. so a tightening or a note made while a loosening waits does not wait with it.
function tighterPart(next, live) {
  const n = mergeSettings(next);
  const c = mergeSettings(live);
  const out = { ...next, sites: { ...next.sites }, toggles: { ...next.toggles } };
  const keep = (bag, key, value) => {
    if (value === undefined) delete bag[key];
    else bag[key] = value;
  };
  for (const id of Object.keys(n.sites)) if (n.sites[id] === false && c.sites[id] !== false) keep(out.sites, id, live?.sites?.[id]);
  for (const key of feedKeys()) if (n.toggles[key] === false && c.toggles[key] !== false) keep(out.toggles, key, live?.toggles?.[key]);
  for (const key of Object.keys(LIMITS)) {
    if (looser({ ...c, [key]: n[key] }, c)) keep(out, key, c[key] === DEFAULTS[key] ? undefined : c[key]);
  }
  return out;
}

// a loosening change waits in `pending` until its time; whoever loads settings after that puts it in place
async function loadSettings() {
  const { settings, pending } = await browser.storage.local.get(['settings', 'pending']);
  if (!pending || Date.now() < pending.at) return mergeSettings(settings);
  await browser.storage.local.set({ settings: pending.settings });
  await browser.storage.local.remove('pending');
  return mergeSettings(pending.settings);
}
