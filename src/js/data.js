// ═══════════════════════════════════════════════════════════
//  DEFAULT TRACK DATA — Flashing Lights by Kanye West
//  Matched to YouTube: https://youtu.be/ZAz3rnLGthg
// ═══════════════════════════════════════════════════════════

const DEFAULT_LYRICS = [
  // ── INTRO — Dwele ─────────────────────────────
  { t: 0.0,   text: '',                section: 'INTRO — DWELE' },
  { t: 22.62, text: 'Flashing lights', section: '' },
  { t: 27.92, text: 'Flashing lights', section: '' },
  { t: 33.17, text: 'Flashing lights', section: '' },
  { t: 38.49, text: 'Flashing lights', section: '' },

  // ── VERSE 1 — Kanye West ──────────────────────
  { t: 42.62, text: "She don't believe in shootin' stars",    section: 'VERSE 1 — KANYE WEST' },
  { t: 45.35, text: 'But she believe in shoes and cars',       section: '' },
  { t: 48.15, text: 'Wood floors in the new apartment',        section: '' },
  { t: 50.78, text: "Couture from the store's departments",    section: '' },
  { t: 53.44, text: 'You more like love to start shit',        section: '' },
  { t: 56.12, text: "I'm more of the trips to Florida",        section: '' },
  { t: 58.46, text: "Ordered the hors d'oeuvres, views of the water", section: '' },
  { t: 61.05, text: 'Straight from a page of your favorite author',   section: '' },
  { t: 64.61, text: 'And the weather so breezy',               section: '' },
  { t: 66.49, text: "Man, why can't life always be this easy?", section: '' },
  { t: 69.1,  text: "She in the mirror, dancin' so sleazy",    section: '' },
  { t: 71.83, text: 'I get a call like, "Where are you, Yeezy?"', section: '' },
  { t: 74.56, text: 'And try to hit you with the ol-wu-wopte', section: '' },
  { t: 77.05, text: 'Till I got flashed by the paparazzi',     section: '' },
  { t: 80.28, text: 'Damn, these niggas got me',               section: '' },
  { t: 82.42, text: 'I hate these niggas more than a Nazi',    section: '' },

  // ── CHORUS 1 — Dwele ──────────────────────────
  { t: 83.66, text: 'As I recall, I know you love to show off',       section: 'CHORUS — DWELE' },
  { t: 88.78, text: 'But I never thought that you would take it this far', section: '' },
  { t: 94.17, text: 'What do I know?',                                section: '' },
  { t: 96.87, text: 'Flashing lights',                                section: '' },
  { t: 99.51, text: 'What do I know?',                                section: '' },
  { t: 102.21, text: 'Flashing lights (Know)',                        section: '' },

  // ── VERSE 2 — Kanye West ──────────────────────
  { t: 107.36, text: "I know it's been a while, sweetheart",         section: 'VERSE 2 — KANYE WEST' },
  { t: 109.21, text: "We hardly talk, I was doin' my thing",          section: '' },
  { t: 112.65, text: 'I know it was foul, baby',                      section: '' },
  { t: 114.5,  text: "Ay, babe, lately you've been all on my brain",  section: '' },
  { t: 117.65, text: 'And if somebody woulda told me a month ago',    section: '' },
  { t: 120.08, text: "Frontin', though, yo, I wouldn't wanna know",   section: '' },
  { t: 123.1,  text: 'If somebody woulda told me a year ago',         section: '' },
  { t: 125.41, text: "It'll go get this difficult",                   section: '' },
  { t: 127.71, text: "Feelin' like Katrina with no FEMA",             section: '' },
  { t: 130.88, text: 'Like Martin with no Gina',                      section: '' },
  { t: 133.52, text: 'Like a flight with no Visa',                    section: '' },
  { t: 135.38, text: 'First class with the seat back, I still see ya', section: '' },
  { t: 138.31, text: 'In my past, you on the other side of the glass', section: '' },
  { t: 141.5,  text: "Of my memory's museum",                         section: '' },
  { t: 143.53, text: "I'm just sayin', hey, Mona Lisa",               section: '' },
  { t: 145.78, text: "Come home, you know you can't roam without Caesar", section: '' },

  // ── CHORUS 2 — Dwele ──────────────────────────
  { t: 147.25, text: 'As I recall, I know you love to show off',       section: 'CHORUS — DWELE' },
  { t: 152.42, text: 'But I never thought that you would take it this far', section: '' },
  { t: 157.76, text: 'What do I know?',                                section: '' },
  { t: 160.53, text: 'Flashing lights',                                section: '' },
  { t: 163.19, text: 'What do I know?',                                section: '' },
  { t: 165.79, text: 'Flashing lights (Know)',                         section: '' },

  // ── OUTRO — Dwele & Kanye ─────────────────────
  { t: 168.51, text: 'As you recall, you know I love to show off',     section: 'OUTRO — DWELE & KANYE' },
  { t: 173.6,  text: 'But you never thought that I would take it this far', section: '' },
  { t: 178.96, text: 'What do you know?',                              section: '' },
  { t: 181.74, text: 'Flashing lights',                                section: '' },
  { t: 184.32, text: 'What do you know?',                              section: '' },
  { t: 187.04, text: 'Flashing lights (Know)',                         section: '' },

  // ── OUTRO INSTRUMENTAL ────────────────────────
  { t: 191.7,  text: '♪',             section: 'OUTRO INSTRUMENTAL' },
  { t: 202.96, text: 'Flashing lights', section: '' },
  { t: 208.29, text: 'Flashing lights', section: '' },
  { t: 215.0,  text: '',              section: '' },
];

const DEFAULT_SECTIONS = [
  { t: 22.62,  label: 'INTRO'  },
  { t: 42.62,  label: 'VERSE 1' },
  { t: 83.66,  label: 'CHORUS' },
  { t: 107.36, label: 'VERSE 2' },
  { t: 147.25, label: 'CHORUS' },
  { t: 168.51, label: 'OUTRO'  },
];

const DEFAULT_YT_ID = 'ZAz3rnLGthg';
const FALLBACK_TOTAL = 237; // 3:57 fallback if YT duration unavailable

// Mutable working copies (populated on load / track switch)
const lyrics   = DEFAULT_LYRICS.slice();
const sections = DEFAULT_SECTIONS.slice();
let   YT_ID_current = DEFAULT_YT_ID;
