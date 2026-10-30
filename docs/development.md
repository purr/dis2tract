# development

```sh
npm ci           # once: installs web-ext
npm test         # url rules for every site, settings, challenges, and the engine against a fake dom
npm run lint     # web-ext lint --self-hosted (allows update_url), warnings count as errors
npm run build    # unsigned .zip in web-ext-artifacts/
npm start        # desktop firefox with the extension loaded
npx web-ext run -t firefox-android --adb-device DEVICE --firefox-apk org.mozilla.firefox
```

which files stay out of the package is set once, in `webExt.ignoreFiles` in `package.json`; every web-ext command reads it.

## files

| file | does |
| --- | --- |
| `src/content.js` | the engine: feeds, scroll limit, in a row, block screen, unlock flow |
| `src/sites.js` | url rules per site: feeds, single items, search and profile urls |
| `src/settings.js` | defaults, limits and the unlock rules |
| `src/challenges.js` | the unlock challenges |
| `src/suggestions.js` | the roast questions and their tasks, the porn page's lines, what the day's time was enough for |
| `src/ui.js` | the block screen's parts that the porn page shares |
| `src/background.js` | theme colors, toolbar button, the chime, porn sites and adult labels, address changes passed to the tab, the day's time on social media, private windows' runs of items, uninstall page |
| `css/overlay.css` | block screen, unlock sheet and the porn page |
| `options/` | the settings page |
| `porn/` | the page porn tabs are sent to, and its two clips |
| `sounds/` | the chime |

rules are url-based, so a site redesign rarely breaks them; a site that moves a feed to a new url needs a new rule in `src/sites.js`. `DESIGN.md` is the stock apple.com design analysis (from awesome-design-md) the base colors, type and pills come from; where the block screen and settings follow ios instead (sheet shadow, field focus glow, green switches, press scale, radii from 4 to 22 px), `css/overlay.css` and `options/options.css` win. `pages/why-the-scroll-wins.html` explains why feeds are hard to put down and what research says helps; open it in any browser.

## builds and releases

github actions (`.github/workflows/build.yml`) runs on every push to main, every pull request, and on demand:

- **every run** (a push builds its last commit): tests, lint, and an unsigned `dis2tract-<version>-<commit>.zip`, downloadable from the run's page in the actions tab.
- **a new version**: published as release `v<version>`, signed by mozilla, with its `CHANGELOG.md` section as the release notes, and an `updates.json` that installed copies check through `update_url` in `manifest.json`. that address must stay `https://github.com/purr/dis2tract/releases/latest/download/updates.json`: every installed copy keeps checking the address its version shipped with, so the release fails before signing when it doesn't match the repository (after a rename, or in a fork).

to release:

1. raise `version` in `manifest.json`, the only place the version lives. a fix raises the last number (0.5.0 → 0.5.1), a feature the middle one (0.5.1 → 0.6.0).
2. add a `## <version>` section at the top of `CHANGELOG.md`, one line per change. the build fails without it, before anything is signed.
3. push to main.

signing needs two repository secrets, once: settings → secrets and variables → actions → new repository secret, `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`, with the values from https://addons.mozilla.org/developers/addon/api/key/. without them the release step fails and says so; the unsigned builds keep working. mozilla signs each version once, so a release that fails after signing needs a new version.
