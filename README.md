<p align="center">
  <img src="icons/icon.svg" width="112" alt="dis2tract icon: a fishhook, snapped">
</p>

<h1 align="center">dis2tract</h1>

<p align="center">
  <b>the feed ends here. everything else stays.</b><br>
  a firefox extension for desktop and android that blocks endless feeds, not whole sites.
</p>

<p align="center">
  youtube · x · tiktok · instagram · reddit · facebook · threads · bluesky · linkedin
</p>

<p align="center">
  <img src="docs/block-screen.png" alt="the block screen on youtube home: a search box, links to your profile, subscriptions, history and playlists, one question with one thing to do, and the unlock button at the bottom">
</p>

most blockers shut the whole site. then you need one video, one profile or one message, and the blocker gets removed. dis2tract blocks only the part built to keep you scrolling.

## what it does

- **feeds are gone**: home, for you, explore, shorts and reels tabs show a block screen with search, `@name` for a profile, and links to your profile and messages.
- **everything else stays**: search, profiles, messages and single posts work, until you scroll 12 screens deep or open the 5th post in a row.
- **one question, one task**: every block screen asks why you're here and gives one thing to do instead, linked straight to it.
- **unlocking is slow on purpose**: a 15-second pause, then a challenge with no pasting. 3 minutes per unlock, 20 minutes apart, 10 a day.
- **nothing leaves the browser**: no servers, no analytics.

[how it works in detail →](docs/how-it-works.md)

## install

download the `.xpi` from the [latest release](https://github.com/purr/dis2tract/releases/latest) and open it in firefox. android, private windows and making it hard to uninstall: [install guide →](docs/install.md)

## develop

```sh
npm ci && npm test && npm run lint
```

every push builds and tests on github; raising the version in `manifest.json` signs and releases it. [development →](docs/development.md) · [changelog →](CHANGELOG.md)

<p align="center"><sub>close the feed. keep the internet.</sub></p>
