# changelog

newest first. each version's section becomes its github release notes.

## 0.8.0

- porn sites are blocked for good: before the site loads, the tab goes to a page in the block screen's look and theme colors, with a quote that stings, one of two meme clips and one better thing to do. no unlock, no switch
- which sites are porn comes from oisd's nsfw small list (over 18,000 domains), downloaded once a day; the adult top-level domains are always blocked. this is dis2tract's one network request
- porn on x, reddit and bluesky (a search, a profile, a post) is caught by the sites' own adult labels in what the page loads, so slang and any language too. new permissions: reading requests, and bluesky's data servers
- unlock challenges take only typed text, one character at a time: pastes are undone even when another extension re-enables them
- bedtime: from 23:00 to 5:00 no unlock starts, and one still running ends at 23:00
- fixes from a full review: porn behind a redirect or embedded in a frame is blocked; an address with a trailing dot no longer skips every rule; a script can't type the challenge for you; a feed address passed through quickly (the reels tab) is caught; scrolling counts as use while unlocked; a changing theme no longer closes the unlock sheet; video and focus keep working in open tabs after an update; app hops count once per switch; r/all is caught in any spelling
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
