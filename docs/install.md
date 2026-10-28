# install

## keep it

firefox release only installs signed extensions. every release is signed by mozilla, free and private ("unlisted": not published on the add-on store).

1. download `dis2tract-<version>.xpi` from the [latest release](https://github.com/purr/dis2tract/releases/latest).
2. desktop: about:addons → gear icon → "install add-on from file…" → pick the `.xpi`.
3. android: copy the `.xpi` to the phone. firefox → settings → about firefox → tap the firefox logo 5 times → back to settings → "install extension from file" → pick the `.xpi`.
4. private windows: firefox does not run extensions there unless you allow it, so a private window would skip every block. desktop: about:addons → dis2tract → "run in private windows" → allow. android: settings → add-ons → dis2tract → allow in private browsing.

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

firefox reinstalls the extension whenever the `.xpi` at that path changes. `private_browsing` needs firefox 136 or later. check it took effect at about:policies. android has no policy support.
