// links without tracking, a module of its own apart from the blocking: on these sites a link copied with the
// site's copy or share button, with firefox's copy link or as selected text, and a link opened, lose their tracking
// parameters. x's t.co wrappers are swapped for the real address in the data x loads (untco() in background.js).
// the address bar is left alone: rewriting it under a single-page site's router would fight the router's history.
// one switch in settings (cleanLinks). cleanLink and cleanText are function declarations: the tests read them

// per host, the tracking parameters: clearurls' rules for these sites and its global ones that show up on them
// (gitlab.com/ClearURLs/rules, data.min.json, 2026-10), and the share parameters the sites' own buttons add (youtube
// si, x s and t, tiktok's device and share fields, instagram igsh, reddit share_id, threads xmt, linkedin rcm).
// parameters that change what a link opens stay: youtube's v, t and list, x's src on a search (sites.js reads it),
// reddit's context, instagram's img_index, tiktok's lang
const TRACKING = [
  [/./, /^(utm_\w+|mtm_\w+|fbclid|gclid|dclid|gbraid|wbraid|msclkid|yclid|ttclid|twclid|li_fat_id|igshid|igsh|mc_[ce]id|_hsenc|_hsmi|mkt_tok|srsltid)$/i],
  [/(^|\.)(youtube\.com|youtu\.be)$/, /^(si|feature|pp|kw)$/],
  [/(^|\.)(x|twitter)\.com$/, /^(s|t|cn|ref_src|ref_url)$/],
  [/(^|\.)tiktok\.com$/, /^(_r|_t|_d|u_code|preview_pb|timestamp|user_id|sec_user_id|share_\w+|sender_device|sender_web_id|social_sharing|is_copy_url|is_from_webapp|web_id|checksum|tt_from|source|refer|enter_from|enter_method)$/],
  [/(^|\.)reddit\.com$/, /^(share_id|rdt|correlation_id|ref_campaign|ref_source|ref|post_index|_branch_match_id|\$deep_link|\$3p|\$original_url)$/],
  [/(^|\.)facebook\.com$/, /^(mibextid|rdid|__tn__|__cft__\[\d+\]|__xts__\[\d+\]|eav|sfnsn|paipv|rdc|rdr|_rdr|_nc_x|comment_tracking|refsrc|fref|hc_ref|hc_location|extid|wtsid|ftentidentifier|video_source|action_history)$/],
  [/(^|\.)threads\.(com|net)$/, /^(xmt|slof)$/],
  [/(^|\.)linkedin\.com$/, /^(refId|trk|trkInfo|trkEmail|trackingId|lipi|lici|midToken|midSig|rcm|eid)$/],
];

// the address without its tracking parameters, or the same string when there were none (a query rewritten for
// nothing could change how the site reads it)
function cleanLink(href) {
  const u = URL.parse(href);
  if (!u || !/^https?:$/.test(u.protocol) || !u.search) return href;
  const rules = TRACKING.filter(([host]) => host.test(u.hostname)).map(([, keys]) => keys);
  const gone = [...u.searchParams.keys()].filter((key) => rules.some((rx) => rx.test(key)));
  if (!gone.length) return href;
  for (const key of gone) u.searchParams.delete(key);
  return u.href;
}

// every address in a copied text cleaned, trailing punctuation kept out of it
function cleanText(text) {
  return text.replace(/https?:\/\/[^\s<>"'`]+/g, (found) => {
    const [, link, tail] = /^(.*?)([.,;:!?)\]]*)$/.exec(found);
    return cleanLink(link) + tail;
  });
}

(() => {
  let on = DEFAULTS.cleanLinks; // until storage answers
  browser.storage.local.get('settings').then(({ settings }) => (on = mergeSettings(settings).cleanLinks));
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) on = mergeSettings(changes.settings.newValue).cleanLinks;
  });

  // the sites' copy and share buttons write through the clipboard api
  wrap(window.wrappedJSObject.Clipboard.prototype, Clipboard.prototype.writeText, 'writeText', (writeText) => function (text) {
    return writeText(this, on ? cleanText(String(text)) : text);
  });
  // a copy of selected text, and buttons that copy a hidden field through execCommand('copy'): a field's selection
  // is not the page's
  document.addEventListener('copy', (e) => {
    if (!on) return;
    const field = document.activeElement;
    const text = typeof field?.selectionStart === 'number' ? field.value.slice(field.selectionStart, field.selectionEnd) : String(getSelection());
    const clean = cleanText(text);
    if (clean === text) return;
    e.clipboardData.setData('text/plain', clean);
    e.preventDefault();
  }, true);
  // a link about to be opened, or copied with firefox's own copy link (the context menu, a long press on android,
  // reads the href): cleaned first. a link inside a site's web component is found through composedPath()
  const tidy = (e) => {
    if (!on) return;
    const link = e.composedPath().find((node) => node.localName === 'a');
    if (typeof link?.href !== 'string') return; // an svg link's href is no string
    const clean = cleanLink(link.href);
    if (clean !== link.href) link.href = clean;
  };
  for (const type of ['pointerdown', 'contextmenu', 'focusin']) document.addEventListener(type, tidy, true);
})();
