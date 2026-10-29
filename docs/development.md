# development

```sh
npm ci           # once: installs web-ext
npm test         # url rules for every site, settings, challenges, and the engine against a fake dom
npm run lint     # web-ext lint, warnings count as errors
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
| `src/suggestions.js` | the roast questions and their tasks |
| `src/background.js` | theme colors, toolbar button, uninstall page, the day's time on social media |
| `css/overlay.css` | block screen and unlock sheet |
| `options/` | the settings page |

rules are url-based, so a site redesign rarely breaks them; a site that moves a feed to a new url needs a new rule in `src/sites.js`. `DESIGN.md` is the apple-style reference the ui follows. `pages/why-the-scroll-wins.html` explains why feeds are hard to put down and what research says helps; open it in any browser.

## builds and releases

github actions (`.github/workflows/build.yml`) runs on every push and pull request:

- **every commit**: tests, lint, and an unsigned `dis2tract-<version>-<commit>.zip`, downloadable from the run's page in the actions tab.
- **a new version**: published as release `v<version>`, signed by mozilla, with its `CHANGELOG.md` section as the release notes.

to release:

1. raise `version` in `manifest.json`, the only place the version lives. a fix raises the last number (0.5.0 → 0.5.1), a feature the middle one (0.5.1 → 0.6.0).
2. add a `## <version>` section at the top of `CHANGELOG.md`, one line per change. the build fails without it, before anything is signed.
3. push to main.

signing needs two repository secrets, once: settings → secrets and variables → actions → new repository secret, `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`, with the values from https://addons.mozilla.org/developers/addon/api/key/. without them the release step fails and says so; the unsigned builds keep working. mozilla signs each version once, so a release that fails after signing needs a new version.
