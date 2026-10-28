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
