# changelog

newest first. each version's section becomes its github release notes.

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
