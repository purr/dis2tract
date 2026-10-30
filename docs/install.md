# install

## keep it

firefox release only installs signed extensions. every release is signed by mozilla, free and private ("unlisted": not published on the add-on store).

1. download `dis2tract-<version>.xpi` from the [latest release](https://github.com/purr/dis2tract/releases/latest).
2. desktop: about:addons → gear icon → "install add-on from file…" → pick the `.xpi`.
3. android: copy the `.xpi` to the phone. firefox → settings → about firefox → tap the firefox logo 5 times → back to settings → "install extension from file" → pick the `.xpi`.
4. private windows: firefox does not run extensions there unless you allow it, so a private window would skip every block. desktop: about:addons → dis2tract → "run in private windows" → allow. android: settings → extensions → dis2tract → run in private browsing. the settings page says when it's off.

after that, new versions install by themselves: firefox checks github once a day on desktop, every 12 hours on android. a version that asks for a new permission waits for your ok (desktop: the firefox menu; android: a notification). 0.5.0 to 0.7.0 can't update themselves: install the newest `.xpi` once the same way, over the old copy; settings and counts stay.

## try it

about:debugging → this firefox → "load temporary add-on…" → pick `manifest.json`, or the unsigned `.zip` of any build (see [builds and releases](development.md#builds-and-releases)). it stays until firefox restarts, and removing it wipes its settings and counts.

## make it hard to uninstall (desktop, optional)

a firefox enterprise policy can force-install the extension so it cannot be removed or disabled from about:addons, and keep it on in private windows. create `distribution\policies.json` next to `firefox.exe` (needs admin rights; undoing it means deleting that file, again as admin):

```json
{
  "policies": {
    "ExtensionSettings": {
      "@dis2tract": {
        "installation_mode": "force_installed",
        "install_url": "file:///C:/path/to/dis2tract.xpi",
        "private_browsing": true
      }
    }
  }
}
```

firefox reinstalls the extension whenever a newer `.xpi` is at that path, never an older one, and the installed copy also updates itself from github, without asking, unless `"updates_disabled": true` is added next to `private_browsing`. `private_browsing` needs firefox 136 or later. check it took effect at about:policies. android has no policy support.

## block more porn (optional)

oisd's list misses some porn sites, and porn pictures still load inside other pages (image search). a family dns filter catches both and turns on google and bing safesearch. an extension can't set it, so it's a firefox setting. [cleanbrowsing's adult filter](https://cleanbrowsing.org/filters/) blocks porn and leaves reddit and youtube as they are:

- desktop: settings → privacy & security → dns over https → advanced settings → custom. keep "always warn me if secure dns isn't available" ticked, then choose provider → custom → `https://doh.cleanbrowsing.org/doh/adult-filter/`. on esr 140: max protection → choose provider → custom. not increased protection: there firefox asks your normal dns again and nothing is blocked.
- android (firefox 143 or later): settings → privacy and security → dns over https → max protection → choose provider → custom, with the same address.
- a blocked site offers "always continue for this site", which lets it through for good. on desktop, add this next to `ExtensionSettings` in the `policies.json` above to lock the setting:

```json
"DNSOverHTTPS": { "Enabled": true, "ProviderURL": "https://doh.cleanbrowsing.org/doh/adult-filter/", "Fallback": false, "ExcludedDomains": [], "Locked": true }
```

what it costs: every site address you open goes to cleanbrowsing, its free filter is throttled and unsupported, and when it's down no site loads. its family filter and adguard family go further and block reddit or turn on youtube's restricted mode, which hides comments and live streams.
