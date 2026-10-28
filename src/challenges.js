// unlock challenges. each call makes a fresh puzzle: { ask, show, check(answer), live }.
// live ones unlock the moment the answer is right; the rest are judged only on enter, so trying number after
// number is not a way through: every wrong enter costs UNLOCK.penaltyMinutes.
// var, not const: the bindings must be visible to content.js, loaded after this file.
var WORDS = (
  'apple river stone cloud quiet garden yellow window paper candle forest gentle market silver bridge orange ' +
  'winter summer pocket hollow ladder mirror basket rabbit thunder island coffee pencil sunset harbor meadow ' +
  'violet lantern feather velvet marble button cotton saddle tunnel pepper copper anchor blanket kettle puzzle ' +
  'garlic walnut ribbon rocket jungle circus barrel magnet pillow shadow timber canyon falcon glacier honey ' +
  'insect jacket kitten lemon monkey noodle oyster parrot quartz radish salmon tomato umbrella violin wallet ' +
  'yogurt zebra bakery cactus dolphin engine fabric gravel hammer kayak laptop mango olive pickle spoon tiger'
).split(' ');

const randomInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const randomWords = (n) => Array.from({ length: n }, () => WORDS[randomInt(0, WORDS.length - 1)]);
// case, punctuation and extra spaces never fail an answer: phone keyboards add them on their own
const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean).join(' ');
const asNumber = (s) => (/^\s*\d[\d\s.,']*$/.test(s) ? Number(s.replace(/\D/g, '')) : NaN);

var CHALLENGES = [
  function retype(words) {
    const w = randomWords(words).join(' ');
    return { ask: 'type this, no pasting', show: w, live: true, check: (v) => normalize(v) === w };
  },
  function backwards(words) {
    const w = randomWords(Math.max(6, Math.ceil(words / 2)));
    return { ask: 'type these words in reverse order, last word first', show: w.join(' '), live: true, check: (v) => normalize(v) === [...w].reverse().join(' ') };
  },
  // sized for a head, not a calculator: two steps that take focus for half a minute. 410 × 78 sent people to
  // the calculator, which trains reaching for a tool instead of pausing
  function arithmetic() {
    const a = randomInt(12, 49);
    const b = randomInt(3, 9);
    const c = randomInt(11, 89);
    return { ask: 'work it out in your head, then press enter', show: `${a} × ${b} + ${c}`, live: false, check: (v) => asNumber(v) === a * b + c };
  },
  function count(words) {
    // a letter that shows up at least 3 times, so the answer is never a lucky 0 or 1
    for (;;) {
      const w = randomWords(Math.max(8, Math.ceil(words / 2))).join(' ');
      const tally = {};
      for (const ch of w.replace(/ /g, '')) tally[ch] = (tally[ch] ?? 0) + 1;
      const letters = Object.keys(tally).filter((ch) => tally[ch] >= 3);
      if (!letters.length) continue;
      const letter = letters[randomInt(0, letters.length - 1)];
      return { ask: `count every "${letter}" below, then press enter`, show: w, live: false, check: (v) => asNumber(v) === tally[letter] };
    }
  },
];
