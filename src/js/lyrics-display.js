// ─── lyrics-display.js — 3-row lyric stage + scrollable list ─────────────────
// Depends on: data.js, player.js (rowPrev, rowCurrent, rowNext, $, fmt, glowOrb, flashRx, sectionLbl, idleMsg)

'use strict';

const glowMap = {
  CHORUS: 'rgba(0,229,255,0.08)',
  VERSE:  'rgba(0,255,136,0.07)',
  HOOK:   'rgba(255,220,100,0.05)',
  OUTRO:  'rgba(140,90,255,0.06)',
  INTRO:  'rgba(200,200,255,0.04)',
  '':     'rgba(0,255,136,0.04)',
};

const flashRx = /flash|lights|Katrina|Mona|Caesar|Gina|FEMA|Visa|Nazi|paparazzi/i;

// ── 3-row display ──────────────────────────────────────────────────────────
function showLyric(i) {
  const e = lyrics[i];
  if (!e) return;
  if (idleMsg) idleMsg.style.display = 'none';

  // Section label
  if (e.section) {
    sectionLbl.textContent = '▸ ' + e.section;
    sectionLbl.classList.add('show');
  } else {
    sectionLbl.classList.remove('show');
  }

  // ── Update content IMMEDIATELY (no setTimeout delay) ──────
  const prevText = rowCurrent.textContent;

  // Trigger exit animation on the outgoing line
  rowCurrent.classList.add('exiting');

  // Promote old current → prev instantly
  if (prevText) {
    rowPrev.textContent = prevText;
    rowPrev.classList.add('has-text');
  } else {
    rowPrev.textContent = '';
    rowPrev.classList.remove('has-text');
  }

  // Set new current row content right away
  rowCurrent.classList.remove('exiting', 'has-text');
  rowCurrent.textContent = e.text || '';
  if (e.text) {
    // Double rAF so browser paints the reset state before animating in
    requestAnimationFrame(() =>
      requestAnimationFrame(() => rowCurrent.classList.add('has-text')),
    );
  }

  // Next row — find next non-empty lyric
  let nextText = '';
  for (let n = i + 1; n < lyrics.length; n++) {
    if (lyrics[n].text) { nextText = lyrics[n].text; break; }
  }
  rowNext.textContent = nextText;
  if (nextText) rowNext.classList.add('has-text');
  else          rowNext.classList.remove('has-text');

  // Flash effect
  if (flashRx.test(e.text || '')) triggerFlash();

  // Glow orb
  const key = Object.keys(glowMap).find((k) => k && (e.section || '').includes(k)) || '';
  glowOrb.style.background = `radial-gradient(circle,${glowMap[key]} 0%,transparent 68%)`;

  // Update lyrics list panel
  updateLyricsList(i, false);
}

// ── Lyrics list panel ──────────────────────────────────────────────────────
const llInner = $('llInner');
const llScroll = $('llScroll');
const llRows = [];
const lyricIdxToRow = {};

function buildLyricsList() {
  let lastSection = '';
  lyrics.forEach((entry, i) => {
    if (entry.section && entry.section !== lastSection) {
      const h = document.createElement('div');
      h.className   = 'll-row ll-section';
      h.textContent = '▸ ' + entry.section;
      llInner.appendChild(h);
      llRows.push({ el: h, lyricIdx: -1, t: entry.t });
      lastSection = entry.section;
    }
    const r = document.createElement('div');
    r.className   = 'll-row';
    r.textContent = entry.text || '·';
    if (!entry.text) {
      r.style.opacity = '0.1';
      r.style.cursor  = 'default';
    } else {
      r.title = 'Jump to ' + fmt(entry.t);
      r.addEventListener('click', () => {
        userScrolling = false;
        seekTo(entry.t, playing);
      });
    }
    llInner.appendChild(r);
    const ri = llRows.length;
    lyricIdxToRow[i] = ri;
    llRows.push({ el: r, lyricIdx: i, t: entry.t });
  });
}
buildLyricsList();

let llActiveRow    = -1;
let userScrolling  = false;
let userScrollTimer = null;

llScroll.addEventListener('wheel',     () => pauseAutoScroll(), { passive: true });
llScroll.addEventListener('touchmove', () => pauseAutoScroll(), { passive: true });
llScroll.addEventListener('mousedown', () => pauseAutoScroll());

function pauseAutoScroll() {
  userScrolling = true;
  clearTimeout(userScrollTimer);
  userScrollTimer = setTimeout(() => { userScrolling = false; }, 1500);
}

function scrollToActive(ri, instant) {
  if (userScrolling) return;
  const row = llRows[ri];
  if (!row) return;
  const containerH = llScroll.clientHeight;
  const target = row.el.offsetTop - containerH / 2 + row.el.clientHeight / 2;
  if (instant) llScroll.scrollTop = Math.max(0, target);
  else         llScroll.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
}

function updateLyricsList(lyricIdx, instant) {
  const ri = lyricIdxToRow[lyricIdx];
  if (ri === undefined) return;
  if (llActiveRow >= 0) {
    llRows[llActiveRow].el.classList.remove('ll-active');
    [-2, -1, 1, 2].forEach((o) => {
      const n = llActiveRow + o;
      if (n >= 0 && n < llRows.length) llRows[n].el.classList.remove('ll-near');
    });
  }
  llRows[ri].el.classList.add('ll-active');
  [-2, -1, 1, 2].forEach((o) => {
    const n = ri + o;
    if (n >= 0 && n < llRows.length) llRows[n].el.classList.add('ll-near');
  });
  llActiveRow = ri;
  scrollToActive(ri, instant);
}

// ── Rebuild list when a new track loads ────────────────────────────────────
function rebuildLyricsList() {
  llInner.innerHTML = '';
  llRows.length = 0;
  Object.keys(lyricIdxToRow).forEach((k) => delete lyricIdxToRow[k]);
  llActiveRow = -1;
  buildLyricsList();
}
