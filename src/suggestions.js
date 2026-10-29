// the roast on the block screen: one question per screen, picked at random, already answered with one concrete
// thing to do right now. a link wherever it does the work, and always a direct one: a timer that is already
// running, one specific video, an exercise that starts on load. never a search page, which is just another feed.
// nothing the user would have to own first. every line is 38 characters at most, so it fits one line on a phone.
// it stings on purpose, enough to break the autopilot. shame can backfire (imposed pressure lowered mood in gilbert et al.,
// communication research; jgu mainz press release 2026-01-08), so it teases the habit, never the person's worth.
// links checked 2026-10-27.
// var, not const: the binding must be visible to content.js, loaded after this file.

// a countdown that starts on open
const timer = (min) => `https://e.ggtimer.com/${min}minute${min === 1 ? '' : 's'}`;
// videos checked live through youtube's oembed endpoint, 2026-10-27
const WORKOUT = 'https://www.youtube.com/watch?v=0s5sNbzv4dc'; // lucy wyndham-read, 7 minute full body at home
const BREATHING = 'https://www.youtube.com/watch?v=zq07gbFLCAs'; // feeling healing, guided box breathing, 5 min
const NIDRA = 'https://www.youtube.com/watch?v=M0u9GST_j3s'; // yoga nidra app, guided, 10 min

var NEEDS = [
  ['bored again? wow.', [
    ['solve one chess puzzle, then close', 'https://lichess.org/training'],
    ['play today\'s wordle. one game.', 'https://www.nytimes.com/games/wordle/index.html'],
    ['name every country on the map', 'https://www.sporcle.com/games/g/world'],
    ['one free round of geoguessr', 'https://www.geoguessr.com/free'],
    ['one khan academy math exercise', 'https://www.khanacademy.org/math'],
    ['5 minutes of duolingo, finally', 'https://www.duolingo.com/'],
  ]],
  ['nobody to talk to? watching strangers?', [
    ['text a friend: "what are you up to?"'],
    ['call family until this timer ends', timer(5)],
    ['answer the message you ignored'],
  ]],
  ['too tired to think, not to scroll?', [
    ['eyes closed till this timer ends', timer(5)],
    ['10 minutes of yoga nidra, lying down', NIDRA],
    ['drink a full glass of water, now'],
  ]],
  ['stressed? numbing it with reels?', [
    ['5 minutes of box breathing', BREATHING],
    ['write the stress down in one line'],
    ['5 minutes outside, phone stays here', timer(5)],
  ]],
  ['avoiding something again? classic.', [
    ['work on it until this timer ends', timer(2)],
    ['write its next tiny step. do only that'],
  ]],
  ['zero motivation, infinite scroll?', [
    ['dishes, bed or desk. 2 minutes, go.', timer(2)],
    ['start your first task for 10 minutes', timer(10)],
  ]],
  ['your thumb works out more than you.', [
    ['7-minute workout, follow along', WORKOUT],
    ['20 squats, now'],
    ['10 pushups, now'],
    ['plank until this timer ends', timer(1)],
    ['walk the block, phone stays home'],
  ]],
  ['this is how you spend tonight?', [
    ['three monkeytype tests, beat your best', 'https://monkeytype.com/'],
    ['phone in another room for 20 minutes', timer(20)],
  ]],
];
// after 23:00 the question is always this one
var LATE = ['still up, scrolling?', [['phone away, lights off. now.']]];

// once today holds a lot of social media, the question is that time, answered with what it was enough for.
// a lot: over 30 minutes, the daily cap that eased loneliness and depression in hunt et al. 2018 (j soc clin
// psychol 37:751). calories for a 70 kg adult, met × kg × hours, with mets from the 2024 adult compendium of
// physical activities (its code after each line). a novel page takes about a minute (adults read fiction at 260
// words a minute, brysbaert 2019)
const LOTS_MINUTES = 30;
const num = (x) => (x < 10 ? Math.round(x * 10) / 10 : Math.round(x)).toLocaleString();
const kcal = (met, minutes) => (Math.round((met * 70 * minutes) / 600) * 10).toLocaleString();
// [fewest minutes the line fits, the line for m minutes]
const INSTEAD = [
  [30, (m) => `enough to run ${num(m / 6)} km, ~${kcal(9.3, m)} kcal`], // 10 km/h, 12050
  [30, (m) => `enough to walk ${num(m / 12)} km, ~${kcal(3.8, m)} kcal`], // 5 km/h, 17190
  [30, (m) => `enough to bike ${num(m / 3)} km, ~${kcal(8, m)} kcal`], // 20 km/h, 01030
  [30, (m) => `enough to swim ${num(m / 30)} km, ~${kcal(5.8, m)} kcal`], // 2 km/h, 18292
  // an hour each, gym and weights in one visit, 02061
  [60, (m) => (m < 120 ? `enough for a full workout, ~${kcal(5, 60)} kcal` : `enough for ${Math.floor(m / 60)} workouts, ~${kcal(5, Math.floor(m / 60) * 60)} kcal`)],
  [30, (m) => `enough to read ${m.toLocaleString()} pages of a novel`],
  [30, (m) => `enough for ${Math.floor(m / 5)} short language lessons`],
  [30, (m) => `enough for ${Math.floor(m / 10)} ten-minute meditations`],
  [30, (m) => (m < 60 ? 'enough for a long call with a friend' : `enough for ${Math.floor(m / 30)} long calls with friends`)],
  [30, () => 'enough to write someone a real letter'],
  [45, (m) => (m < 90 ? 'enough to cook a real dinner' : `enough to cook ${Math.floor(m / 45)} real dinners`)],
  [60, () => 'enough to clean your whole place'],
  [60, (m) => (m < 120 ? 'enough for a whole yoga class' : `enough for ${Math.floor(m / 60)} yoga classes`)],
  [90, (m) => (m < 180 ? 'enough for a whole extra sleep cycle' : `enough for ${Math.floor(m / 90)} full sleep cycles`)],
  [480, (m) => (m < 960 ? 'enough for a full night of sleep' : `enough for ${Math.floor(m / 480)} full nights of sleep`)],
];
// the block screen's question for m minutes of social media today, or null while that is not a lot yet
function instead(m) {
  if (m < LOTS_MINUTES) return null;
  const time = m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
  return [`${time} on social media today.`, INSTEAD.filter(([from]) => m >= from).map(([, line]) => [line(m)])];
}

// the porn page (porn/porn.js): one of these under the title. they mock the giving in, and each says something
// true about what it costs, so the sting carries a reason to stop
var SHAME = [
  ['pixels will not love you back.'],
  ['all the hours spent on this', 'would have built your dream body.'],
  ['escaping reality again, weakling?'],
  ['the urge lasts minutes.', 'the regret lasts all day.'],
  ['nobody ever wished they had', 'watched more porn.'],
  ['a stranger on a screen gets your', 'best energy. your goals get none.'],
  ['discipline is choosing what you', 'want most over what you want now.'],
  ['every no makes the next one easier.'],
  ['the weak obey every urge.', 'be the one who says no.'],
  ['real people are out there.', 'they are not in this tab.'],
  ['you would never let a friend', 'waste their life like this.'],
  ['the person you want to be', 'closed this tab already.'],
  ['this is not rest.', 'it is hiding.'],
  ['cheap dopamine makes', 'everything else feel dull.'],
  ['you are trading your drive', 'for ten minutes of nothing.'],
  ['your future self is watching.', 'they are not impressed.'],
  ['imagine this energy in the gym,', 'in your work, in a real date.'],
  ['confidence is keeping promises', 'to yourself. keep this one.'],
  ['you are not horny. you are bored.', 'go do something.'],
  ['a screen cannot hold you,', 'call you, or miss you.'],
  ['weakling move.', 'close the tab and prove otherwise.'],
];
// and one better thing to do, the way the block screen does it
var URGES = [
  ['urges fade in minutes. outlast it.', [
    ['50 pushups, right now'],
    ['cold shower, 2 minutes', timer(2)],
    ['7-minute workout, follow along', WORKOUT],
  ]],
  ['bored? that is all this is.', [
    ['solve one chess puzzle, then close', 'https://lichess.org/training'],
    ['three monkeytype tests, beat your best', 'https://monkeytype.com/'],
    ['walk the block, phone stays home'],
  ]],
  ['lonely? a screen will not fix it.', [
    ['text a friend: "free tonight?"'],
    ['call family until this timer ends', timer(5)],
  ]],
  ['stressed? breathe, do not escape.', [
    ['5 minutes of box breathing', BREATHING],
    ['write down what is bothering you'],
  ]],
  ['restless? spend it on your body.', [
    ['20 squats, now'],
    ['plank until this timer ends', timer(1)],
    ['go for a run. 10 minutes.', timer(10)],
  ]],
];
var URGE_LATE = ['up late? this is when it wins.', [['phone away, lights off. now.'], ['10 minutes of yoga nidra, lying down', NIDRA]]];
