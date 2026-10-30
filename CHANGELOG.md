# changelog

newest first. each version's section becomes its github release notes.

## 0.8.0

- porn sites are blocked for good: before the site loads, the tab goes to a page in the block screen's look and theme colors, with a quote that stings, one of two meme clips and one better thing to do. no unlock, no switch
- which sites are porn comes from oisd's nsfw small list (over 18,000 domains of porn, adult, shock and gore), downloaded once a day without cookies or an id of your browser; the adult top-level domains are always blocked, and a few entries that aren't nsfw sites (public suffixes such as co.cz among them) are skipped. this is dis2tract's one download
- the porn page says what set it off, going back never lands on the page that did, and its clips play in every firefox (webm instead of mp4); a listed site behind google translate is caught too, and tabs already open are checked at start and after each list update
- the bell stays quiet in a muted tab, and on android, where it would stop other tabs' audio
- new versions install by themselves: firefox checks github once or twice a day. 0.5.0 to 0.7.0 can't: install this version's `.xpi` by hand once, over the old one; settings and counts stay
- porn on x, reddit and bluesky is caught by the sites' own adult marks, so slang and any language too: a post or profile you open, or an adult subreddit. a stranger's marked reply or follower and search results don't count, and the marked post never shows
- new permissions, which firefox asks for: browser activity during navigation, bluesky's data servers, github's raw file host (the porn list download, so it carries no id of your browser), and all of facebook.com instead of three of its hosts
- unlock challenges take only typed text, one character at a time: pastes are undone even when another extension re-enables them
- bedtime: from 23:00 to 5:00 no unlock starts, and one still running ends at 23:00
- time on social media counts per day, only while you use a page and never on the block screen. past 30 minutes, the block screen's question is that time and one random thing it was enough for: a 12 km run (~780 kcal), 72 pages of a novel, a real dinner
- a muted video counts as use only within a minute of your last tap, scroll or key: feeds loop muted clips by themselves, so an unlocked feed left on screen used up its minutes with nobody watching
- fixes from a full review: porn behind a redirect or embedded in a frame is blocked; an address with a trailing dot no longer skips every rule; a script can't type the challenge for you; a feed address passed through quickly (the reels tab) is caught; scrolling counts as use while unlocked; a changing theme no longer closes the unlock sheet; video and focus keep working in open tabs after an update; app hops count once per switch; r/all is caught in any spelling
- x's full-screen video viewer on a phone counts every video you swipe to, so the 5th in a row is blocked: the whole swipe used to count as one post
- more feeds blocked, each with its own switch: youtube's live, music, news, sports and learning pages, x communities, reddit news and topic pages, bluesky's explore page
- feeds at new addresses are caught: linkedin's for you and network tabs, threads /for_you and /global, tiktok's for you under every language address and live's tabs, youtube /index and gaming at its channel address, facebook /video, /videos and /watch/live
- facebook's language addresses (de-de.facebook.com) are covered
- hashtag pages and searches a site opens from a link (x's trends, hashtags and cashtags, threads tags) keep the scroll limit; what you type stays free
- in a row: facebook stories count once per person, and group posts opened by their link and youtube clips count too
- the block screen links "log in" on instagram, facebook and linkedin: logged out, their front page is the log-in form
- an unlock shows its time left in a pill at the top, counting down in red for the last 30 seconds, and the unlock button says how many unlocks are left today
- bedtime is a setting: it can start earlier or end later than 23:00 to 5:00, never the other way; a shorter one waits 10 minutes like any loosening. a wait that would end inside bedtime now ends with it
- after the extra minute, the next unlock waits 30 minutes from when you took it, and the block screen says 30 min apart
- the scroll limit counts screens, so rotating the phone or resizing the window no longer lifts a block; it counts while unlocked too, and survives a reload
- a link followed from another site (search results) starts a new count in a row
- private windows store nothing: the count in a row lives in memory
- an update or re-enable no longer stops or reloads open tabs, and on android a feed stopped at load shows the block screen at phone width
- the block screen: escape closes the unlock sheet, and nothing under the sheet takes focus; screen readers read it in english and hear the pause, the note and the text to type; page translation leaves the text to type alone; full-width and arabic digits count; android's double-space period no longer eats a space; moving between two blocked feeds names the new one; a half-typed search survives a cooldown ending
- themes are used only where their colors stay readable, a translucent theme no longer makes the unlock sheet see-through, and windows' high contrast mode shows buttons, fields and switches
- settings warn when private windows are off, keep two open settings tabs in sync, and say when a looser setting applies
- theater mode's cookie lasts the session and goes when theater mode or youtube is switched off: it used to keep videos wide for a year
- a click on a feed link (the youtube logo) chimes again
- a feed opened from scratch stops loading at once: none of the site runs behind the block. if it may show after all (unlocked, feed switched off), it loads once more. a click on a link to a feed (the youtube logo) becomes such a load, and any other jump into a feed is blocked the moment the address changes
- search results and profiles have no scroll limit
- past the scroll limit, "keep scrolling" gives the page 12 more screens after a 10-second wait

## 0.7.0

- a wrong answer no longer drops you back on the block screen with a silent 10-minute wait: the sheet says it was wrong (math and counting show the right number), waits 30 seconds and brings a new challenge
- enter on an empty field is ignored
- an unlock's minutes count only while a video plays or you scrolled, tapped or typed in the last 10 seconds: a paused video eats nothing
- time left from an unlock lasts until the next unlock could start (23 minutes), no longer until midnight: an unlock tried in the morning left the feed open all day
- a block that appears while you browse fades in, with the 6 am bell from five nights at freddy's (switch: settings → block screen)
- "never mind" in the unlock sheet is a full-width button

## 0.6.0

- an unlock's 3 minutes are feed time: they run only while a page the unlock lets through is on screen. leave with time left and it is still there when you come back, until the next unlock or midnight
- the 20 minutes to the next unlock count from when the time runs out

## 0.5.0

first release.

- blocks the endless feeds on youtube, x, tiktok, instagram, reddit, facebook, threads, bluesky and linkedin; search, profiles, messages and single posts stay open
- every other page: a scroll limit (12 screens) and an in-a-row limit (4 posts), kept across reloads and new tabs
- block screen: search or `@name`, links to your profile, messages and notifications, one question with one thing to do, and a note when you hop from one feed to another
- unlock: a 15-second pause with your own note, then a random challenge with no pasting. 3 min per unlock, 20 min apart, 10 a day, one extra minute that stretches the next wait to 30 min, 10 min for a wrong answer
- settings per site and per feed; loosening a setting waits 10 minutes
- firefox theme colors, youtube theater mode, a page to read on uninstall
