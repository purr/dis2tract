# how it works

## what happens where

| you open | you get |
| --- | --- |
| a feed | the block screen: search, `@name` for a profile, links to your profile, messages and notifications, and one question with something better to do. opened from scratch, the site stops loading at once, so none of it runs behind the block |
| search results, a profile, messages | allowed, with no scroll limit: you opened them on purpose |
| any other page | allowed, until you scroll 12 screens deep. then "keep scrolling" gives that page 12 more screens after a 10-second wait, as often as you like |
| a single video or post | allowed. 4 different ones in a row are fine, the 5th is blocked. back steps out again; a profile or a search starts a new count |
| a porn site | never loads: a page roasts you instead, with a meme clip. no unlock, no switch |

## porn sites

blocked for good: the tab goes to the roast page before the site shows. that includes a page that embeds a listed site (a porn player inside a reddit post) and a link that redirects to one (a short link, a mirror domain). which sites count comes from [oisd's nsfw small list](https://oisd.nl): the porn sites among the top million domains, each with its subdomains, maintained so it doesn't catch normal sites. dis2tract downloads it once a day from github and keeps the last copy for offline starts; the adult top-level domains (.xxx, .porn, .sex, .adult) are blocked even before the first download. a site the list doesn't know isn't blocked.

x, reddit and bluesky allow porn among everything else, so their porn is caught by what they say about it themselves. x marks adult pictures and videos as adult content (apart from violence), reddit tags posts nsfw, bluesky labels posts and accounts porn, sexual or nudity. dis2tract reads those marks in what the page loads, and a page that loaded any goes to the roast page: a search, a profile or a single post. there's no word list, so slang and other languages are caught too. firefox only runs dis2tract in private windows if you allow it ([install guide](install.md)).

## blocked feeds

every feed can be switched off on its own in settings, for example to allow tiktok live.

| site | blocked | still open |
| --- | --- | --- |
| youtube | home (trending too), shorts tab, gaming, podcasts | search, channels, videos, subscriptions, history, playlists |
| x | home timeline, explore | search, profiles, posts, notifications, messages, bookmarks |
| tiktok | for you, following, friends, explore, live | search, profiles, videos, messages |
| instagram | home, explore, reels tab | search, profiles, posts, single reels, stories, messages, notifications |
| reddit | front page and its sort tabs, r/popular, r/all | subreddits, posts, search, profiles, messages |
| facebook | home, video tab, reels tab, groups feed | profiles, posts, single groups, messages, notifications |
| threads | for you, following, custom feeds | search, profiles, posts, activity |
| bluesky | home, custom feeds | search, profiles, posts, notifications, messages |
| linkedin | home feed | search, profiles, posts, messages, notifications, jobs |

a youtube playlist counts as one video in a row; a mix counts every video, since it autoplays forever.

## no easy way out

- a reload or a new tab within a minute keeps your place in the count.
- a video opened from a feed within 3 seconds still counts as the feed. instagram's reels tab and youtube's shorts tab jump straight into a random video.
- players behind the block screen pause, fullscreen closes, and the page can't pull the cursor out of the block screen.

## the mirror and the roast

jump from one feed to another within 10 minutes and the top of the block screen says so:

> tiktok 1 min ago, now youtube. same urge, new app.

every block screen asks one question, picked at random, and answers it with one thing to do right now. a link goes straight to the thing (a running timer, a follow-along workout, a chess puzzle), never to a search page, which is just another feed.

| question | for example |
| --- | --- |
| bored again? wow. | solve one chess puzzle, then close |
| your thumb works out more than you. | 7-minute workout, follow along |
| avoiding something again? classic. | work on it until this timer ends |
| this is how you spend tonight? | three monkeytype tests, beat your best |

from 23:00 to 5:00 there is only one: *still up, scrolling? phone away, lights off. now.*

## unlocking

<p align="center">
  <img src="unlock-sheet.png" alt="the unlock sheet: a 15-second pause that shows your own note, with a never mind button">
</p>

sometimes you do want the feed. you can unlock it, but slowly, on purpose:

1. **a 15-second pause** shows the note you wrote to yourself, with a "never mind" button. in a field study, the option to back off changed behaviour more than the delay itself (one sec, pnas 2023).
2. **a random challenge**, one of:
   - retype a line of random words (15 by default)
   - type a line of words backwards, last word first
   - work out something like `37 × 6 + 52` in your head
   - count one letter in a line of words

   only typing counts, one character at a time. pastes, drops, keyboard clipboard chips, dictation and swipe typing are undone, and text that another extension slips in (one that re-enables right click and paste) is thrown away on enter.
3. **a wrong enter costs 30 seconds**: the sheet says it was wrong (math and counting show the right number), waits, then brings a new challenge. closing and reopening the sheet doesn't skip the wait. a typing challenge opens by itself the moment the text is right, so enter on a typo counts as wrong.

| rule | value |
| --- | --- |
| one unlock | 3 min of feed on that site. they run only while a page the unlock lets through is on screen and in use: a video plays, or you scrolled, tapped or typed in the last 10 s. pause the video or leave with time left and it waits for you until the next unlock could start (23 min after unlocking), or until you take an unlock elsewhere |
| between unlocks | 20 min after the time runs out (or would have, used in one go), across all sites |
| per day | 10, across all sites |
| bedtime | from 23:00 to 5:00 no unlock starts, and one still running ends at 23:00 |
| one more minute | offered once, for 2 min after the time runs out. the next unlock then waits 30 min |

these rules have no setting on purpose: a setting would be the way around them. they live in `UNLOCK` in `src/settings.js`.

## settings

<p align="center">
  <img src="settings.png" width="420" alt="the settings page: a note to future you, limits, and a group per site with its feeds">
</p>

open them with the dis2tract toolbar button, or about:addons → dis2tract → preferences. on android: firefox menu (⋮) → extensions → dis2tract.

- **note to future you**: shown in the pause before every unlock.
- **limits**: scroll limit (12 screens), in a row (4 posts), unlock sentence (15 words, at least 12). 0 turns a limit off.
- **per site**: limit the site at all, each feed on its own, extras like youtube theater mode, and your handle where the site has no own-profile url (tiktok, x, instagram, threads, bluesky).
- **loosening waits**: switching a site or feed off, raising a limit or shortening the sentence applies 10 minutes later, with a cancel button meanwhile. tightening applies at once.
- **stats**: unlocks, wrong answers and app hops so far, with the date the count started.

## also

- **a chime**: a block that appears while you browse fades in with the 6 am bell from five nights at freddy's, in the tab you're looking at. settings → block screen switches it off.
- **your theme's colors**: the block screen, the porn page and settings follow your firefox theme, live, from the first frame. desktop only: firefox for android has no themes.
- **theater mode**: youtube opens every video in theater mode, which moves the recommendations below the video. switchable per site.
- **uninstall**: removing dis2tract opens npr's piece on the inventor of infinite scroll, who now wants to kill it. nothing about you is sent along.
- **privacy**: no servers, no analytics. its one request is the porn list, once a day, from github; nothing about you goes with it. everything else stays in `browser.storage.local`.

## known limits

- every time rule trusts the system clock. setting it back stretches an unlock, setting it forward skips a cooldown.
- mobile youtube has no theater mode.
- without the [uninstall policy](install.md#make-it-hard-to-uninstall-desktop-optional), anyone can still remove the extension. it is a speed bump, not a lock.
