'use strict';

/* Reci mi 1.4 – „Mondlicht“
   Gleiche Speicherung wie 1.0–1.3: vorhandene Notizen, PIN und Sicherungen bleiben gültig. */

const APP_VERSION = '3.8.4';
const DB_NAME = 'reci-mi-db';
const STORE_NAME = 'secure-store';
const VAULT_KEY = 'vault';
const CONFIG_SALT = 'gr_salt_v1';
const CONFIG_VERIFIER = 'gr_verifier_v1';
const BIOMETRIC_CONFIG = 'rm_biometric_v1';
const BIOMETRIC_KEY = 'biometric-key';
const SESSION_KEY = 'session-key';
const LS_LEFT_AT = 'rm_left_at';
const LS_ALIVE_AT = 'rm_alive_at';
const LS_RESUME = 'rm_resume';
const LS_BIO_CARD = 'rm_bio_card_dismissed';
const LOCK_AFTER_MS = 60 * 1000;      // erst nach mehr als 1 Minute weg sperren
const LONG_PRESS_MS = 600;
const DEFAULT_NAME = 'Merii';

let db;
let cryptoKey = null;
let state = null;
let currentTopicId = null;
let currentFilter = 'Alle';
let saveTimer = null;
let aliveTimer = null;
let biometricBusy = false;
let suppressLock = false;
let recognition = null;
let isListening = false;
let deferredInstallPrompt = null;
let confirmResolver = null;
let topicSheetMode = 'create';
let topicSheetId = null;
let selectedCategory = 'Bücher';
let editorMode = 'text';
let actionTopicId = null;
let openSheetEl = null;
let sheetSilentClose = false;

const $ = id => document.getElementById(id);
const els = {};
['lockScreen', 'homeScreen', 'editorScreen', 'trashScreen',
 'moonBtn', 'lockMoon', 'fpBadge', 'lockSubtitle', 'pinForm', 'pinLabel', 'pinInput', 'pinConfirm', 'pinSubmit', 'showPinBtn', 'lockHint', 'lockPhase',
 'menuBtn', 'quickLockHomeBtn', 'greeting', 'heroMoon', 'dailyQuote', 'moonLine', 'sunTap', 'moonOrb', 'moonTap', 'moonriseLabel', 'moonsetLabel', 'moonPhaseLabel', 'searchInput', 'filterRow', 'bioCard', 'bioCardLater', 'bioCardSetup',
 'topicList', 'emptyState', 'noResults', 'newTopicBtn',
 'backBtn', 'editorHomeBtn', 'editorMenuBtn', 'editorTitle', 'editorTag', 'dateLine', 'textModeBtn', 'listModeBtn', 'textPane', 'topicText', 'checklistPane', 'checklistForm', 'checklistInput', 'checklistAddBtn', 'checklistList', 'checklistEmpty', 'saveState', 'undoBtn', 'redoBtn', 'endBtn',
 'editBtn', 'copyBtn', 'micBtn', 'readBtn', 'deleteBtn',
 'trashBackBtn', 'trashHomeBtn', 'trashList',
 'topicSheet', 'topicForm', 'topicSheetTitle', 'topicName', 'catPicker', 'cancelTopicBtn', 'saveTopicBtn',
 'actionSheet', 'actionTitle', 'actionOpenBtn', 'actionRenameBtn', 'actionTrashBtn', 'actionCancelBtn',
 'menuSheet', 'biometricMenuBtn', 'nameMenuBtn', 'manageCategoriesBtn', 'categorySheet', 'categoryForm', 'categoryName', 'categorySaveBtn', 'categoryManageList', 'categoryCloseBtn', 'openTrashBtn', 'exportBtn', 'importInput', 'checkBackupInput', 'installBtn', 'lockBtn',
 'nameSheet', 'nameForm', 'nameInput', 'nameCancelBtn',
 'confirmSheet', 'confirmTitle', 'confirmText', 'confirmCancelBtn', 'confirmOkBtn',
 'toast'].forEach(id => { els[id] = $(id); });

const BASE_CATEGORIES = ['Bücher', 'Apps', 'Privat', 'Sonstiges'];
const QUICK_CATEGORY = 'Schnellnotizen';
const CUSTOM_CATEGORY_COLORS = ['#69B8A4', '#D7A95C', '#9C83D6', '#D98291', '#6F9ED6', '#B58A68', '#78A968', '#C27EB1'];
let editingCategoryName = null;

/* =====================================================================
   Tageszeit-Himmel: Farben wandern fließend durch den Tag
   ===================================================================== */

// Himmel (Kopfbereich + Sperrbildschirm)
const SKY = {
  nacht:           { top: '#10152E', mid: '#1B2347', hor: '#2A3160', stars: 1,    moonLit: '#F4EBD3', moonDark: [30, 36, 70, .85],    glow: [241, 228, 195, .22] , earth: 0.1, glowMul: 1 , wash: 0 },
  daemmerung:      { top: '#1E2452', mid: '#4A4580', hor: '#E9A58C', stars: .45,  moonLit: '#F6EAD0', moonDark: [60, 58, 110, .55],   glow: [246, 214, 200, .22] , earth: 0.08, glowMul: 0.8 , wash: 0.1 },
  morgen:          { top: '#86AFDB', mid: '#C4DAEE', hor: '#FADFC4', stars: 0,    moonLit: '#FFFFFF', moonDark: [255, 255, 255, .12], glow: [255, 255, 255, .35] , earth: 0, glowMul: 0.45 , wash: 0.38 },
  vormittag:       { top: '#6FA6DE', mid: '#AFD2F0', hor: '#EAF3F8', stars: 0,    moonLit: '#FFFFFF', moonDark: [255, 255, 255, .12], glow: [255, 255, 255, .35] , earth: 0, glowMul: 0.4 , wash: 0.42 },
  mittag:          { top: '#5E9FE2', mid: '#A9D4F4', hor: '#FFF4D8', stars: 0,    moonLit: '#FFFFFF', moonDark: [255, 255, 255, .12], glow: [255, 255, 255, .35] , earth: 0, glowMul: 0.4 , wash: 0.42 },
  nachmittag:      { top: '#8DB4DD', mid: '#DCD5C6', hor: '#F6D49E', stars: 0,    moonLit: '#FFFFFF', moonDark: [255, 255, 255, .14], glow: [255, 246, 225, .35] , earth: 0, glowMul: 0.45 , wash: 0.38 },
  abenddaemmerung: { top: '#33357A', mid: '#7A5788', hor: '#F2A178', stars: .3,   moonLit: '#FBEBD3', moonDark: [70, 58, 110, .55],   glow: [250, 215, 190, .25] , earth: 0.08, glowMul: 0.8 , wash: 0.1 },
  abend:           { top: '#171A42', mid: '#2A2959', hor: '#4B3A6E', stars: .8,   moonLit: '#F1E4C3', moonDark: [46, 46, 92, .85],    glow: [236, 222, 200, .22] , earth: 0.09, glowMul: 1 , wash: 0 }
};

// Fläche (Liste, Thema, Blätter). Zwischen hell und dunkel wird umgeschaltet, sonst gemischt.
const BODY = {
  // Nacht: Moonstone Blue (dunkel, mit bläulichem Mondstein-Leuchten)
  nacht:           { dark: true,  bg: '#1D2537', surface: '#273147', surface2: '#303B53', ink: '#E9EEF7', muted: '#9DAAC1', accent: '#BFD1EA', accentInk: '#172031', accentText: '#BFD1EA', accentFill: 'linear-gradient(135deg, #D3E1F2 0%, #A5BCDD 45%, #E2EBF7 70%, #B2C6E3 100%)' },
  // Morgendämmerung und Morgen: Pearl White
  daemmerung:      { dark: false, bg: '#F5F0EC', surface: '#FFFFFF', surface2: '#FFFFFF', ink: '#3B3438', muted: '#857A80', accent: '#EFE4E8', accentInk: '#3B3038', accentText: '#9A6F82', accentFill: 'linear-gradient(120deg, #FFFFFF 0%, #F6E9EE 28%, #E8EEF8 52%, #FBF3E6 76%, #FFFFFF 100%)' },
  morgen:          { dark: false, bg: '#F7F2EE', surface: '#FFFFFF', surface2: '#FFFFFF', ink: '#3B3438', muted: '#857A80', accent: '#EFE4E8', accentInk: '#3B3038', accentText: '#9A6F82', accentFill: 'linear-gradient(120deg, #FFFFFF 0%, #F6E9EE 28%, #E8EEF8 52%, #FBF3E6 76%, #FFFFFF 100%)' },
  // Vormittag: Rose Quartz
  vormittag:       { dark: false, bg: '#FBECEC', surface: '#FFFFFF', surface2: '#FFFFFF', ink: '#3E2A2E', muted: '#8C7377', accent: '#EFBDC1', accentInk: '#3A1A20', accentText: '#B4525F', accentFill: 'linear-gradient(135deg, #F8D6D8 0%, #EDB3B8 45%, #F7CDD0 70%, #E7A9AF 100%)' },
  // Mittag: Champagne Gold
  mittag:          { dark: false, bg: '#FAF4E8', surface: '#FFFFFF', surface2: '#FFFFFF', ink: '#352C1E', muted: '#857A66', accent: '#D9BD85', accentInk: '#2E2311', accentText: '#94702F', accentFill: 'linear-gradient(135deg, #BC9658 0%, #EAD39F 32%, #C9A86A 52%, #F4E5BC 74%, #BF9A5E 100%)' },
  // Nachmittag: Rainbow Prism
  nachmittag:      { dark: false, bg: '#F1F2F6', surface: '#FFFFFF', surface2: '#FFFFFF', ink: '#2D2C3C', muted: '#77768A', accent: '#E3E1F7', accentInk: '#2A2840', accentText: '#6656AE', accentFill: 'linear-gradient(115deg, #FBD3E0 0%, #FDE6C1 22%, #DDF3D2 42%, #CFE7FA 62%, #E2D5F7 82%, #FBD3E0 100%)' },
  // Abend: Soft Lavender
  abenddaemmerung: { dark: false, bg: '#F0EAF8', surface: '#FFFFFF', surface2: '#FFFFFF', ink: '#302840', muted: '#7C7290', accent: '#CDBBE8', accentInk: '#261A3A', accentText: '#7651B2', accentFill: 'linear-gradient(135deg, #D9CBEE 0%, #BCA6E0 50%, #D7C8EC 100%)' },
  abend:           { dark: false, bg: '#E9E1F4', surface: '#F8F4FD', surface2: '#F8F4FD', ink: '#2D2540', muted: '#776C8E', accent: '#C6B1E4', accentInk: '#241838', accentText: '#6E48AC', accentFill: 'linear-gradient(135deg, #D9CBEE 0%, #BCA6E0 50%, #D7C8EC 100%)' }
};

const CAT_COLORS = {
  dark:  { books: '#E8C98E', apps: '#97D3BE', private: '#C9B2EC', other: '#B3C6E6', quick: '#F0B0C2' },
  light: { books: '#D9A04E', apps: '#5FAE8C', private: '#9B78D6', other: '#7C9DD2', quick: '#E07C98' }
};

const PHASE_LABEL = {
  nacht: 'Nacht', daemmerung: 'Morgendämmerung', morgen: 'Morgen', vormittag: 'Vormittag',
  mittag: 'Mittag', nachmittag: 'Nachmittag', abenddaemmerung: 'Abenddämmerung', abend: 'Abend'
};
const GREETING = {
  nacht: 'Gute Nacht', daemmerung: 'Guten Morgen', morgen: 'Guten Morgen', vormittag: 'Guten Tag',
  mittag: 'Guten Tag', nachmittag: 'Guten Tag', abenddaemmerung: 'Guten Abend', abend: 'Guten Abend'
};

// Ungefähr Mitte Deutschlands – reicht für Sonnenauf- und -untergang auf ein paar Minuten genau
const GEO = { lat: 49.5, lon: 10.5 };

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(rgb) {
  return '#' + rgb.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}
function mixHex(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(A.map((v, i) => v + (B[i] - v) * t));
}
function mixArr(a, b, t) { return a.map((v, i) => v + (b[i] - v) * t); }
function rgba(arr) { return `rgba(${Math.round(arr[0])}, ${Math.round(arr[1])}, ${Math.round(arr[2])}, ${arr[3].toFixed(3)})`; }
function luminance(hex) {
  const c = hexToRgb(hex).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function smooth(t) { return t * t * (3 - 2 * t); }

// Sonnenauf- und -untergang (vereinfachte Sonnengleichung), Ergebnis in Minuten nach Mitternacht (Ortszeit)
function sunTimes(date) {
  const rad = Math.PI / 180;
  const noon = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  const jd = noon.getTime() / 86400000 + 2440587.5;
  const n = Math.round(jd - 2451545.0 + 0.0008);
  const jStar = n - GEO.lon / 360;
  const M = (357.5291 + 0.98560028 * jStar) % 360;
  const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
  const lambda = (M + C + 180 + 102.9372) % 360;
  const jTransit = 2451545.0 + jStar + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * lambda * rad);
  const sinDec = Math.sin(lambda * rad) * Math.sin(23.44 * rad);
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosW = (Math.sin(-0.833 * rad) - Math.sin(GEO.lat * rad) * sinDec) / (Math.cos(GEO.lat * rad) * cosDec);
  const w = Math.acos(Math.max(-1, Math.min(1, cosW))) / rad;
  const off = placeOffsetMin(noon);
  const toLocalMinutes = j => {
    const d = new Date((j - 2440587.5) * 86400000);
    return wrapMinutes(d.getUTCHours() * 60 + d.getUTCMinutes() + off);
  };
  return { rise: toLocalMinutes(jTransit - w / 360), set: toLocalMinutes(jTransit + w / 360) };
}

// Höhepunkte der einzelnen Tageszeiten; dazwischen wird fließend gemischt
function dayKeyframes(date) {
  const { rise, set } = sunTimes(date);
  const morgen = rise + 60;
  const vormittag = Math.max(630, morgen + 60);
  const mittag = Math.max(780, vormittag + 60);
  const abenddaemmerung = set - 10;
  const nachmittag = Math.max(mittag + 40, Math.min(930, abenddaemmerung - 70));
  const abend = set + 50;
  const nachtSpaet = Math.min(1435, Math.max(set + 120, 1350));
  return [
    { t: 0, name: 'nacht' },
    { t: rise - 100, name: 'nacht' },
    { t: rise - 25, name: 'daemmerung' },
    { t: morgen, name: 'morgen' },
    { t: vormittag, name: 'vormittag' },
    { t: mittag, name: 'mittag' },
    { t: nachmittag, name: 'nachmittag' },
    { t: abenddaemmerung, name: 'abenddaemmerung' },
    { t: abend, name: 'abend' },
    { t: nachtSpaet, name: 'nacht' },
    { t: 1440, name: 'nacht' }
  ];
}

// Für Vorschau/Test: ?zeit=07:30 oder ?zeit=21:00 an die Adresse hängen
function previewMinutes() {
  const m = /[?&]zeit=(\d{1,2})[:.](\d{2})/.exec(location.search);
  return m ? Math.min(1439, parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) : null;
}

// Zeitzone des gewählten Ortes: Minuten Abstand zu UTC zu einem Zeitpunkt
function placeOffsetMin(instant) {
  let p = null;
  try { p = JSON.parse(localStorage.getItem('rm_place') || 'null'); } catch {}
  if (!p || !isFinite(p.lat) || !isFinite(p.lon)) return -instant.getTimezoneOffset();
  if (p.tz) {
    try {
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: p.tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(instant).map(x => [x.type, +x.value]));
      return Math.round((Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
    } catch {}
  }
  return Math.round(p.lon / 15) * 60;   // grobe Schätzung, wenn die Zeitzone unbekannt ist
}
// „Wanduhr“ des Ortes: ein Date, dessen lokale Felder die Ortszeit zeigen
function nowForSky(dayOffset = 0) {
  const real = new Date();
  const off = placeOffsetMin(real);
  const sh = new Date(real.getTime() + off * 60000);
  const now = new Date(sh.getUTCFullYear(), sh.getUTCMonth(), sh.getUTCDate(), sh.getUTCHours(), sh.getUTCMinutes(), sh.getUTCSeconds());
  const p = previewMinutes();
  if (p !== null) now.setHours(Math.floor(p / 60), p % 60, 0, 0);
  if (dayOffset) now.setDate(now.getDate() + dayOffset);
  return now;
}
// echter Zeitpunkt zu einer Ortszeit-Wanduhr
function instantOfSky(wall) {
  const guess = new Date(wall.getTime() - wall.getTimezoneOffset() * 60000 - placeOffsetMin(wall) * 60000);
  return guess;
}

const SKY_MAX_FUTURE_DAYS = 5;
let skyDayOffset = 0;
let skySwipeStart = null;
let skySwipeJustHappened = false;

function skyDayLabel(offset = skyDayOffset) {
  if (offset === 0) return 'Heute';
  if (offset === 1) return 'Morgen';
  const d = nowForSky(offset);
  return new Intl.DateTimeFormat('de-DE', { weekday: 'short' }).format(d).replace('.', '');
}

function updatePlaceClock() {
  const el = $('placeClock');
  if (!el) return;
  const p = getPlace();
  if (!p) { el.classList.add('hidden'); el.textContent = ''; return; }
  const wall = nowForSky(skyDayOffset);
  const dateText = `${String(wall.getDate()).padStart(2, '0')}.${String(wall.getMonth() + 1).padStart(2, '0')}.${wall.getFullYear()}`;
  const timeText = `${String(wall.getHours()).padStart(2, '0')}:${String(wall.getMinutes()).padStart(2, '0')}`;
  el.textContent = `${skyDayLabel()} · ${dateText} · ${timeText}`;
  el.classList.remove('hidden');
}

function skyStateAt(date) {
  const minutes = date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
  const kf = dayKeyframes(date);
  let i = 0;
  while (i < kf.length - 2 && minutes >= kf[i + 1].t) i++;
  const a = kf[i], b = kf[i + 1];
  const t = b.t > a.t ? smooth(Math.min(1, Math.max(0, (minutes - a.t) / (b.t - a.t)))) : 0;
  return { a: a.name, b: b.name, t, phase: t < 0.5 ? a.name : b.name };
}

let lastPhase = null;
function applySky(fromWeather = false) {
  const date = nowForSky(skyDayOffset);
  const { a, b, t, phase } = skyStateAt(date);
  const A = SKY[a], B = SKY[b];
  const root = document.documentElement.style;

  let top = mixHex(A.top, B.top, t), mid = mixHex(A.mid, B.mid, t), hor = mixHex(A.hor, B.hor, t);
  // Wetter: Wolken, Regen und Nebel machen den Himmel grauer
  const wfx = currentFx();
  const grey = Math.min(.75, wfx.clouds * .45 + wfx.fog * .45 + wfx.rain * .25 + wfx.snow * .25);
  if (grey > 0.02) {
    top = desaturate(top, grey); mid = desaturate(mid, grey); hor = desaturate(hor, grey * 1.1);
    if (wfx.rain > .5 || wfx.storm) { top = mixHex(top, '#2A2F3C', .25); mid = mixHex(mid, '#3A4050', .2); }
  }
  root.setProperty('--sky-top', top);
  root.setProperty('--sky-mid', mid);
  root.setProperty('--sky-hor', hor);
  skyPaletteState = { top, mid, hor, phase };
  // Auch Sterne verschwinden hinter einer geschlossenen Wolkendecke.
  root.setProperty('--stars', ((A.stars + (B.stars - A.stars) * t) * skyWeatherVisibility(wfx, 'stars')).toFixed(3));
  root.setProperty('--moon-lit', mixHex(A.moonLit, B.moonLit, t));
  root.setProperty('--moon-lit-2', mixHex(mixHex(A.moonLit, B.moonLit, t), '#FFFFFF', .55));
  root.setProperty('--moon-dark', rgba(mixArr(A.moonDark, B.moonDark, t)));
  root.setProperty('--moon-glow', rgba(mixArr(A.glow, B.glow, t)));
  root.setProperty('--moon-wash', (A.wash + (B.wash - A.wash) * t).toFixed(3));
  root.setProperty('--earthshine', (A.earth + (B.earth - A.earth) * t).toFixed(3));
  root.setProperty('--glow-mul', (A.glowMul + (B.glowMul - A.glowMul) * t).toFixed(3));
  root.setProperty('--moon-maria', mixHex(mixHex(A.moonLit, B.moonLit, t), '#7A7468', .45));
  root.setProperty('--moon-crater', mixHex(mixHex(A.moonLit, B.moonLit, t), '#8F8268', .45));

  // Schrift im Himmel: hell oder dunkel, je nachdem was besser lesbar ist
  const skyIsLight = luminance(mid) > 0.2;
  const heroInk = skyIsLight ? '#1F2742' : '#F3F0F8';
  root.setProperty('--hero-ink', heroInk);
  root.setProperty('--hero-muted', mixHex(heroInk, mid, skyIsLight ? .32 : .3));
  const horIsLight = luminance(hor) > 0.3;
  root.setProperty('--hor-ink', horIsLight ? '#3A2E3E' : mixHex('#F3F0F8', hor, .2));

  // Fläche
  const BA = BODY[a], BB = BODY[b];
  let body;
  if (BA.dark === BB.dark) {
    body = {};
    const swap = new Set(['accent', 'accentInk', 'accentText', 'accentFill']);
    for (const k of Object.keys(BA)) body[k] = k === 'dark' ? BA.dark : swap.has(k) ? (t < 0.5 ? BA[k] : BB[k]) : mixHex(BA[k], BB[k], t);
  } else {
    // Hell/Dunkel wechselt genau dann, wenn der Himmel hell bzw. dunkel genug ist
    body = t < 0.5 ? BA : BB;
  }
  root.setProperty('--bg', body.bg);
  root.setProperty('--surface', body.surface);
  root.setProperty('--surface-2', body.surface2);
  root.setProperty('--ink', body.ink);
  root.setProperty('--muted', body.muted);
  root.setProperty('--accent', body.accent);
  root.setProperty('--accent-ink', body.accentInk);
  root.setProperty('--accent-text', body.accentText);
  root.setProperty('--accent-fill', body.accentFill || body.accent);
  root.setProperty('--line', body.dark ? 'rgba(236, 234, 244, .09)' : 'rgba(40, 40, 70, .10)');
  root.setProperty('--shadow', body.dark ? '0 14px 30px rgba(0, 0, 0, .32)' : '0 12px 26px rgba(60, 50, 40, .16)');
  root.setProperty('--shadow-soft', body.dark ? 'none' : '0 2px 10px rgba(60, 50, 40, .07)');
  root.setProperty('--danger', body.dark ? '#E8968B' : '#B4473C');
  const cats = body.dark ? CAT_COLORS.dark : CAT_COLORS.light;
  root.setProperty('--c-books', cats.books);
  root.setProperty('--c-apps', cats.apps);
  root.setProperty('--c-private', cats.private);
  root.setProperty('--c-other', cats.other);
  root.setProperty('--c-quick', cats.quick);
  document.documentElement.dataset.mode = body.dark ? 'dark' : 'light';
  document.documentElement.dataset.phase = phase;
  const nightSky = ['nacht', 'abend', 'abenddaemmerung', 'daemmerung'].includes(phase);
  document.querySelectorAll('.weather-layer').forEach(layer => layer.classList.toggle('night', nightSky));

  placeSun();
  placeMoon();
  placePlanets();
  updatePlaceClock();
  if (cloudFields.back) paintSkyClouds();
  buildStarSky();
  refreshOpenCelestialInfo();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', top);

  if (phase !== lastPhase || !applySky.renderedDay || applySky.renderedDay !== date.toDateString()) {
    lastPhase = phase;
    applySky.renderedDay = date.toDateString();
    renderDailyBits(date, phase);
    if (!fromWeather) applyWeatherFx();
  }
}

/* =====================================================================
   Sonne und Wetter
   ===================================================================== */

const LS_PLACE = 'rm_place';
const LS_WEATHER = 'rm_weather';
const WEATHER_MAX_AGE = 20 * 60 * 1000;

function getPlace() {
  try { const p = JSON.parse(localStorage.getItem(LS_PLACE) || 'null'); return p && isFinite(p.lat) && isFinite(p.lon) ? p : null; } catch { return null; }
}
function setPlace(p) {
  try {
    if (p) localStorage.setItem(LS_PLACE, JSON.stringify(p)); else localStorage.removeItem(LS_PLACE);
    localStorage.removeItem(LS_WEATHER);
  } catch {}
  weatherCurrent = null;
  weatherForecast = [];
  weatherNow = null;
  skyDayOffset = 0;
  moonPassCache = null;
  applyPlaceGeo();
}
function applyPlaceGeo() {
  const p = getPlace();
  GEO.lat = p ? p.lat : 49.5;
  GEO.lon = p ? p.lon : 10.5;
  if (els.lockMoon) renderLockMoon(nowForSky());
}

// WMO-Wettercodes → was wir zeigen
function describeWeather(code, cloud = 0, temp = 10) {
  const c = Number(code);
  const fx = { label: 'Klar', clouds: Math.min(1, (cloud || 0) / 100), rain: 0, snow: 0, fog: 0, ice: 0, storm: 0 };
  const set = (label, o) => Object.assign(fx, { label }, o);
  if (c === 0) set('Klar', { clouds: Math.min(fx.clouds, .1) });
  else if (c === 1) set('Überwiegend klar', { clouds: Math.max(fx.clouds, .2) });
  else if (c === 2) set('Teilweise bewölkt', { clouds: Math.max(fx.clouds, .5) });
  else if (c === 3) set('Bedeckt', { clouds: 1 });
  else if (c === 45) set('Nebel', { clouds: .6, fog: 1 });
  else if (c === 48) set('Nebel mit Raureif', { clouds: .6, fog: 1, ice: .8 });
  else if (c === 51 || c === 53 || c === 55) set(c === 51 ? 'Leichter Nieselregen' : c === 53 ? 'Nieselregen' : 'Starker Nieselregen', { clouds: .9, rain: c === 51 ? .25 : c === 53 ? .35 : .5 });
  else if (c === 56 || c === 57) set('Gefrierender Nieselregen', { clouds: .9, rain: .35, ice: 1 });
  else if (c === 61 || c === 63 || c === 65) set(c === 61 ? 'Leichter Regen' : c === 63 ? 'Regen' : 'Starker Regen', { clouds: 1, rain: c === 61 ? .45 : c === 63 ? .7 : 1 });
  else if (c === 66 || c === 67) set('Gefrierender Regen', { clouds: 1, rain: .6, ice: 1 });
  else if (c === 71 || c === 73 || c === 75) set(c === 71 ? 'Leichter Schneefall' : c === 73 ? 'Schneefall' : 'Starker Schneefall', { clouds: 1, snow: c === 71 ? .4 : c === 73 ? .7 : 1 });
  else if (c === 77) set('Schneegriesel', { clouds: .9, snow: .4 });
  else if (c === 80 || c === 81 || c === 82) set(c === 80 ? 'Leichte Regenschauer' : c === 81 ? 'Regenschauer' : 'Heftige Regenschauer', { clouds: .85, rain: c === 80 ? .45 : c === 81 ? .7 : 1 });
  else if (c === 85 || c === 86) set(c === 85 ? 'Leichte Schneeschauer' : 'Schneeschauer', { clouds: .9, snow: c === 85 ? .45 : .8 });
  else if (c >= 95) set(c === 95 ? 'Gewitter' : 'Gewitter mit Hagel', { clouds: 1, rain: .9, storm: 1 });
  if (isFinite(temp) && temp <= 0) fx.ice = Math.max(fx.ice, temp <= -3 ? .9 : .55);   // Frost: vereist
  return fx;
}

// Vorschau: ?wetter=regen | schnee | eis | bewoelkt | nebel | gewitter | sonnig
function previewWeather() {
  const m = /[?&]wetter=([a-zäöü]+)/i.exec(location.search);
  if (!m) return null;
  const map = { sonnig: 0, klar: 0, wolkig: 2, bewoelkt: 3, bedeckt: 3, nebel: 45, niesel: 53, regen: 63, starkregen: 65, schnee: 73, leichtschnee: 71, starkschnee: 75, eis: 67, frost: 0, gewitter: 95 };
  const code = map[m[1].toLowerCase()];
  if (code === undefined) return null;
  return { code, cloud: code === 2 ? 55 : code === 0 ? 5 : 100, temp: m[1] === 'frost' || m[1] === 'eis' || m[1].includes('schnee') ? -4 : 12, name: 'Vorschau' };
}

let weatherNow = null;      // aktuell angezeigtes Wetter
let weatherCurrent = null;  // echtes aktuelles Wetter des gewählten Ortes
let weatherForecast = [];   // Tagesvorschau, Index 0 = heute
function currentFx() { return weatherNow?.fx || describeWeather(0, 0, 10); }

// Wetter ist von der Astronomie unabhängig: Die Bahnpositionen bleiben
// korrekt berechnet, aber Bewölkung / Nebel bestimmt die Sichtbarkeit.
function skyWeatherVisibility(fx, object = 'sun') {
  const cover = Math.max(0, Math.min(1, fx.clouds || 0));
  const fog = Math.max(0, Math.min(1, fx.fog || 0));
  const precip = Math.max(fx.rain || 0, fx.snow || 0);
  // Ein dichter, geschlossener Himmel muss die Scheiben wirklich verdecken.
  if (cover >= .95 || fog >= .94 || (cover > .83 && precip >= .82)) return 0;
  // Ab etwa 75 % zunehmend starke Verdeckung, bei 95 % vollständig.
  const cloudFade = cover < .32 ? 1 - cover * .18
    : cover < .72 ? .94 - (cover - .32) * 1.45
    : Math.max(0, .36 * (1 - (cover - .72) / .23));
  const fogFade = Math.pow(1 - fog, 3.1);
  const rainFade = 1 - .42 * (fx.rain || 0);
  const snowFade = 1 - .34 * (fx.snow || 0);
  const level = Math.max(0, Math.min(1, cloudFade * fogFade * rainFade * snowFade));
  return object === 'stars' ? Math.pow(level, 1.5) : level;
}

function celestialWeatherOpacity(fx, offset = 0) {
  const base = skyWeatherVisibility(fx);
  // Ziehende Wolken führen bei halbbewölktem Himmel zu langsamem Wechsel.
  // Keine künstlichen Blitze / schnellen Helligkeitssprünge.
  if (base <= 0 || fx.clouds < .25 || fx.clouds > .87 || fx.fog > .2) return base;
  const cover = Math.sin(Math.PI * Math.min(1, Math.max(0, (fx.clouds - .25) / .62)));
  const passing = Math.sin(Date.now() / 18500 + offset) * .14 * cover;
  return Math.max(0, Math.min(1, base * (1 + passing)));
}

function weatherForView() {
  const place = getPlace();
  if (!place) return null;
  if (skyDayOffset === 0) return weatherCurrent;
  const f = weatherForecast[skyDayOffset];
  if (!f) return { name: place.name, unavailable: true, fx: describeWeather(0, 0, 10) };
  const tempMid = isFinite(f.max) && isFinite(f.min) ? (f.max + f.min) / 2 : (isFinite(f.max) ? f.max : 10);
  return { ...f, name: place.name, temp: tempMid, forecast: true, fx: describeWeather(f.code, f.cloud ?? 0, tempMid) };
}

function applyWeatherForView() {
  const prev = previewWeather();
  if (prev) weatherNow = { ...prev, fx: describeWeather(prev.code, prev.cloud, prev.temp) };
  else weatherNow = weatherForView();
  applyWeatherFx();
}

async function refreshWeather(force = false) {
  const prev = previewWeather();
  if (prev) {
    weatherCurrent = { ...prev, fx: describeWeather(prev.code, prev.cloud, prev.temp) };
    weatherForecast = Array.from({ length: SKY_MAX_FUTURE_DAYS + 1 }, () => ({ code: prev.code, cloud: prev.cloud, max: prev.temp, min: prev.temp }));
    applyWeatherForView();
    return;
  }
  const place = getPlace();
  if (!place) {
    weatherCurrent = null;
    weatherForecast = [];
    weatherNow = null;
    applyWeatherFx();
    return;
  }
  let cachedFresh = false;
  try {
    const cached = JSON.parse(localStorage.getItem(LS_WEATHER) || 'null');
    if (cached && cached.key === `${place.lat},${place.lon}`) {
      if (cached.w) weatherCurrent = { ...cached.w, name: place.name, fx: describeWeather(cached.w.code, cached.w.cloud, cached.w.temp) };
      weatherForecast = Array.isArray(cached.forecast) ? cached.forecast : [];
      applyWeatherForView();
      cachedFresh = Date.now() - cached.t < WEATHER_MAX_AGE;
      if (!force && cachedFresh && weatherForecast.length >= SKY_MAX_FUTURE_DAYS + 1) return;
    }
  } catch {}
  if (!navigator.onLine) return;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${place.lat.toFixed(3)}&longitude=${place.lon.toFixed(3)}&current=temperature_2m,weather_code,cloud_cover&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=${SKY_MAX_FUTURE_DAYS + 1}&timezone=auto`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    if (data.timezone && place.tz !== data.timezone) {
      try { localStorage.setItem(LS_PLACE, JSON.stringify({ ...place, tz: data.timezone })); } catch {}
      applyPlaceGeo();
    }
    const w = { code: data.current.weather_code, cloud: data.current.cloud_cover, temp: data.current.temperature_2m };
    const times = data.daily?.time || [];
    const codes = data.daily?.weather_code || [];
    const maxs = data.daily?.temperature_2m_max || [];
    const mins = data.daily?.temperature_2m_min || [];
    const forecast = times.map((date, i) => ({ date, code: codes[i], max: maxs[i], min: mins[i], cloud: 0 }));
    localStorage.setItem(LS_WEATHER, JSON.stringify({ key: `${place.lat},${place.lon}`, t: Date.now(), w, forecast }));
    weatherCurrent = { ...w, name: place.name, fx: describeWeather(w.code, w.cloud, w.temp) };
    weatherForecast = forecast;
    applyWeatherForView();
  } catch { /* offline oder Dienst nicht erreichbar: alter Stand bleibt */ }
}

function desaturate(hex, amount) {
  const [r, g, b] = hexToRgb(hex);
  const y = 0.3 * r + 0.59 * g + 0.11 * b;
  return rgbToHex([r + (y - r) * amount, g + (y - g) * amount, b + (y - b) * amount]);
}

/* ---------- Sonne auf ihrer Bahn ---------- */
function minutesToClock(m) {
  const safe = ((m % 1440) + 1440) % 1440;
  const h = Math.floor(safe / 60), mi = Math.round(safe % 60);
  return `${String(h).padStart(2, '0')}:${String(mi === 60 ? 59 : mi).padStart(2, '0')}`;
}
function wrapMinutes(m) { return ((m % 1440) + 1440) % 1440; }
function isBetweenWrapped(value, start, end) {
  value = wrapMinutes(value); start = wrapMinutes(start); end = wrapMinutes(end);
  return start <= end ? (value >= start && value <= end) : (value >= start || value <= end);
}

const BODY_DIAM_KM = {
  sun: 1392700, moon: 3474.8, mercury: 4879.4, venus: 12103.6, mars: 6779, jupiter: 139820, saturn: 116460
};
function apparentDiameterArcsec(diamKm, distKm) {
  const d = Math.max(1, Number(distKm) || 1);
  return 2 * Math.atan((diamKm / 2) / d) * 180 / Math.PI * 3600;
}
function angularVisualScale(arcsec, minArcsec, maxArcsec, minScale, maxScale, gamma = .52) {
  const lo = Math.max(1e-6, minArcsec), hi = Math.max(lo + 1e-6, maxArcsec);
  const val = Math.max(lo, Math.min(hi, arcsec));
  const t = (Math.log(val) - Math.log(lo)) / (Math.log(hi) - Math.log(lo));
  return minScale + (maxScale - minScale) * Math.pow(t, gamma);
}
function sunRenderSize(date, alt) {
  // Die Sonnenformel erwartet „Tage seit 2000“, nicht ein Datum. Das war der Grund für die riesige weiße Sonne.
  const dDays = astroJulian(instantOfSky(date)) - 2451543.5;
  const distKm = sunGeoXYZ(dDays).r * AU_KM;
  const ratio = Math.sqrt(apparentDiameterArcsec(BODY_DIAM_KM.sun, distKm) / 1919);
  return Math.round((176 - alt * 30) * ratio);
}
function moonRenderSize(distKm, alt) {
  const ratio = Math.sqrt(apparentDiameterArcsec(BODY_DIAM_KM.moon, distKm) / 1864);
  return Math.round((86 - alt * 6.5) * ratio);
}
function planetRenderScale(key, distAu) {
  const diamKm = BODY_DIAM_KM[key];
  if (!diamKm || !distAu) return 1;
  let arcsec = apparentDiameterArcsec(diamKm, distAu * AU_KM);
  if (key === 'saturn') arcsec *= 1.55;
  return angularVisualScale(arcsec, 4, 55, .72, 1.12, .58);
}

function placeSun() {
  const hero = document.querySelector('.hero');
  const sun = $('sun');
  if (!hero || !sun) return;
  const now = nowForSky(skyDayOffset);
  const { rise, set } = sunTimes(now);
  $('sunriseLabel').textContent = minutesToClock(rise);
  $('sunsetLabel').textContent = minutesToClock(set);

  const arc = skyArc(hero);
  if (!arc.W || !arc.H) return;
  const minutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const f = (minutes - rise) / (set - rise);
  const up = f > -0.03 && f < 1.03;
  sun.classList.toggle('hidden', !up);
  if (els.sunTap) els.sunTap.classList.toggle('hidden', !up);
  if (!up) { if (activePlanetInfoKey === 'sun') hidePlanetInfo(); return; }
  const p = arcPoint(arc, f);
  const alt = p.alt;                                   // 0 am Horizont, 1 mittags
  sun.style.left = `${p.x}px`;
  sun.style.top = `${p.y + (f < 0 || f > 1 ? 10 : 0)}px`;
  if (els.sunTap) { els.sunTap.style.left = `${p.x}px`; els.sunTap.style.top = `${p.y + (f < 0 || f > 1 ? 10 : 0)}px`; }
  // tief = warm und größer, hoch = weißgelb
  sun.style.setProperty('--sun-core', mixHex('#FFB866', '#FFFBEA', Math.min(1, alt * 1.6)));
  sun.style.setProperty('--sun-halo', mixHex('#FF9A4D', '#FFF1C2', Math.min(1, alt * 1.4)));
  sun.style.setProperty('--sun-size', `${sunRenderSize(now, alt)}px`);
  const fx = currentFx();
  const visibility = celestialWeatherOpacity(fx, .8);
  sun.style.setProperty('--sun-veil', visibility.toFixed(3));
  if (els.sunTap) els.sunTap.style.pointerEvents = visibility < .09 ? 'none' : 'auto';
}

/* ---------- Wetter-Effekte ---------- */
const precipLayers = [];
let precipAnim = null;
let flashTimer = null;

function moonIllumination(age) {
  return (1 - Math.cos(2 * Math.PI * (age / SYNODIC))) / 2;
}

/* =====================================================================
   Mond: echte Position, Auf-/Untergang, Phase und Neigung der Sichel
   (Bahnelemente nach P. Schlyter mit den wichtigsten Störungstermen,
   Genauigkeit etwa 1–2 Bogenminuten – mehr als genug für die Anzeige)
   ===================================================================== */
const MOON_RAD = Math.PI / 180;
function moonNorm(a) { return ((a % 360) + 360) % 360; }

// Mond nach Meeus (Kap. 47, wichtigste Terme) – Genauigkeit wenige Bogensekunden
const MOON_LR = [ // D, M, M', F, Σl (1e-6°), Σr (1e-3 km)
  [0,0,1,0,6288774,-20905355],[2,0,-1,0,1274027,-3699111],[2,0,0,0,658314,-2955968],[0,0,2,0,213618,-569925],
  [0,1,0,0,-185116,48888],[0,0,0,2,-114332,-3149],[2,0,-2,0,58793,246158],[2,-1,-1,0,57066,-152138],
  [2,0,1,0,53322,-170733],[2,-1,0,0,45758,-204586],[0,1,-1,0,-40923,-129620],[1,0,0,0,-34720,108743],
  [0,1,1,0,-30383,104755],[2,0,0,-2,15327,10321],[0,0,1,2,-12528,0],[0,0,1,-2,10980,79661],
  [4,0,-1,0,10675,-34782],[0,0,3,0,10034,-23210],[4,0,-2,0,8548,-21636],[2,1,-1,0,-7888,24208],
  [2,1,0,0,-6766,30824],[1,0,-1,0,-5163,-8379],[1,1,0,0,4987,-16675],[2,-1,1,0,4036,-12831],
  [2,0,2,0,3994,-10445],[4,0,0,0,3861,-11650],[2,0,-3,0,3665,14403],[0,1,-2,0,-2689,-7003],
  [2,0,-1,2,-2602,0],[2,-1,-2,0,2390,10056],[1,0,1,0,-2348,6322],[2,-2,0,0,2236,-9884],
  [0,1,2,0,-2120,5751],[0,2,0,0,-2069,0]
];
const MOON_B = [ // D, M, M', F, Σb (1e-6°)
  [0,0,0,1,5128122],[0,0,1,1,280602],[0,0,1,-1,277693],[2,0,0,-1,173237],[2,0,-1,1,55413],[2,0,-1,-1,46271],
  [2,0,0,1,32573],[0,0,2,1,17198],[2,0,1,-1,9266],[0,0,2,-1,8822],[2,-1,0,-1,8216],[2,0,-2,-1,4324],
  [2,0,1,1,4200],[2,1,0,-1,-3359],[2,-1,-1,1,2463],[2,-1,0,1,2211],[2,-1,-1,-1,2065],[0,1,-1,-1,-1870],
  [4,0,-1,-1,1828],[0,1,0,1,-1794],[0,0,0,3,-1749],[0,1,-1,1,-1565],[1,0,0,1,-1491],[0,1,1,1,-1475],
  [0,1,1,-1,-1410],[0,1,0,-1,-1344],[1,0,0,-1,-1335],[0,0,3,1,1107],[4,0,0,-1,1021],[4,0,-1,1,833]
];

function moonEcliptic(jd) {
  const T = (jd - 2451545.0) / 36525;
  const Lp = moonNorm(218.3164477 + 481267.88123421 * T);
  const D = moonNorm(297.8501921 + 445267.1114034 * T);
  const M = moonNorm(357.5291092 + 35999.0502909 * T);
  const Mp = moonNorm(134.9633964 + 477198.8675055 * T);
  const F = moonNorm(93.2720950 + 483202.0175233 * T);
  const A1 = 119.75 + 131.849 * T, A2 = 53.09 + 479264.290 * T, A3 = 313.45 + 481266.484 * T;
  const E = 1 - 0.002516 * T;
  const s = x => Math.sin(x * MOON_RAD), c = x => Math.cos(x * MOON_RAD);
  let sl = 0, sr = 0, sb = 0;
  for (const [d, m, mp, f, l, r] of MOON_LR) {
    const arg = d * D + m * M + mp * Mp + f * F;
    const e = Math.abs(m) === 1 ? E : Math.abs(m) === 2 ? E * E : 1;
    sl += l * e * s(arg); sr += r * e * c(arg);
  }
  for (const [d, m, mp, f, b] of MOON_B) {
    const e = Math.abs(m) === 1 ? E : Math.abs(m) === 2 ? E * E : 1;
    sb += b * e * s(d * D + m * M + mp * Mp + f * F);
  }
  sl += 3958 * s(A1) + 1962 * s(Lp - F) + 318 * s(A2);
  sb += -2235 * s(Lp) + 382 * s(A3) + 175 * s(A1 - F) + 175 * s(A1 + F) + 127 * s(Lp - Mp) - 115 * s(Lp + Mp);
  // Sonne (Meeus Kap. 25, vereinfacht)
  const L0 = 280.46646 + 36000.76983 * T;
  const Ms = 357.52911 + 35999.05029 * T;
  const C = (1.914602 - 0.004817 * T) * s(Ms) + 0.019993 * s(2 * Ms) + 0.000289 * s(3 * Ms);
  const ecc = 0.016708634;
  const sunR = 1.000001018 * (1 - ecc * ecc) / (1 + ecc * c(Ms + C));
  return {
    lon: moonNorm(Lp + sl / 1e6), lat: sb / 1e6, distKm: 385000.56 + sr / 1000,
    sunLon: moonNorm(L0 + C), sunR, T
  };
}

function eclToEq(lon, lat, T) {
  const ecl = (23.439291 - 0.0130042 * T) * MOON_RAD;
  const x = Math.cos(lon) * Math.cos(lat);
  const y = Math.sin(lon) * Math.cos(lat);
  const z = Math.sin(lat);
  const ye = y * Math.cos(ecl) - z * Math.sin(ecl);
  const ze = y * Math.sin(ecl) + z * Math.cos(ecl);
  return { ra: Math.atan2(ye, x), dec: Math.atan2(ze, Math.hypot(x, ye)) };
}

/* Alles, was die App über den Mond zu einem Zeitpunkt braucht */
function moonState(date, lat = GEO.lat, lon = GEO.lon) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const m = moonEcliptic(jd);
  const mq = eclToEq(m.lon * MOON_RAD, m.lat * MOON_RAD, m.T);
  const sq = eclToEq(m.sunLon * MOON_RAD, 0, m.T);
  const gmst = 280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * m.T * m.T;
  const lst = moonNorm(gmst + lon) * MOON_RAD;
  const phi = lat * MOON_RAD;
  const H = lst - mq.ra;
  const sinAlt = Math.sin(phi) * Math.sin(mq.dec) + Math.cos(phi) * Math.cos(mq.dec) * Math.cos(H);
  const altGeo = Math.asin(sinAlt);
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(mq.dec) * Math.cos(phi)) / MOON_RAD + 180;
  const parallax = Math.asin(6378.14 / m.distKm);                          // Horizontalparallaxe
  const altTopo = altGeo - parallax * Math.cos(altGeo);
  // Parallaktischer Winkel: wie weit „Norden am Mond“ gegen „oben am Himmel“ gedreht ist
  const q = Math.atan2(Math.sin(H), Math.tan(phi) * Math.cos(mq.dec) - Math.sin(mq.dec) * Math.cos(H));
  // Positionswinkel des hellen Randes (zur Sonne hin), von Norden über Osten
  const dRa = sq.ra - mq.ra;
  const chi = Math.atan2(Math.cos(sq.dec) * Math.sin(dRa), Math.sin(sq.dec) * Math.cos(mq.dec) - Math.cos(sq.dec) * Math.sin(mq.dec) * Math.cos(dRa));
  // Beleuchteter Anteil
  const elong = Math.acos(Math.sin(sq.dec) * Math.sin(mq.dec) + Math.cos(sq.dec) * Math.cos(mq.dec) * Math.cos(dRa));
  const distKm = m.distKm;
  const sunKm = m.sunR * 149597870.7;
  const phaseAngle = Math.atan2(sunKm * Math.sin(elong), distKm - sunKm * Math.cos(elong));
  const illum = (1 + Math.cos(phaseAngle)) / 2;
  const waxing = moonNorm(m.lon - m.sunLon) < 180;
  const age = moonNorm(m.lon - m.sunLon) / 360 * 29.530589;    // „Alter“ in Tagen seit Neumond
  return {
    alt: altTopo / MOON_RAD,
    altGeo: altGeo / MOON_RAD,
    az: moonNorm(az),
    parallax: parallax / MOON_RAD,
    illum, waxing, age, distKm,
    // Drehung auf dem Bildschirm (Grad, gegen den Uhrzeigersinn ab „oben“):
    limbAngle: (chi - q) / MOON_RAD,   // Richtung des hellen Randes
    northAngle: -q / MOON_RAD          // Richtung des Mond-Nordpols (für die Textur)
  };
}

/* Auf- und Untergänge im Fenster [from, to] (10-Minuten-Raster, dazwischen linear) */
function moonEvents(from, to, lat = GEO.lat, lon = GEO.lon) {
  const step = 10 * 60000;
  const h = t => { const s = moonState(new Date(t), lat, lon); return s.altGeo - (0.7275 * s.parallax - 0.5667); };
  const out = [];
  let t0 = from.getTime(), h0 = h(t0);
  for (let t1 = t0 + step; t1 <= to.getTime() + step; t1 += step) {
    const h1 = h(t1);
    if ((h0 < 0) !== (h1 < 0)) {
      const t = t0 + (t1 - t0) * (h0 / (h0 - h1));
      out.push({ type: h0 < 0 ? 'rise' : 'set', time: new Date(t) });
    }
    t0 = t1; h0 = h1;
  }
  return out;
}

/* Der aktuelle bzw. nächste „Bogen“ des Mondes: Aufgang → Untergang */
function moonPass(now, lat = GEO.lat, lon = GEO.lon) {
  const ev = moonEvents(new Date(now.getTime() - 30 * 3600000), new Date(now.getTime() + 36 * 3600000), lat, lon);
  const t = now.getTime();
  let rise = null, set = null;
  const lastRise = [...ev].reverse().find(e => e.type === 'rise' && e.time.getTime() <= t);
  const lastSet = [...ev].reverse().find(e => e.type === 'set' && e.time.getTime() <= t);
  const up = lastRise && (!lastSet || lastRise.time > lastSet.time);
  if (up) {
    rise = lastRise.time;
    set = ev.find(e => e.type === 'set' && e.time.getTime() > t)?.time || null;
  } else {
    rise = ev.find(e => e.type === 'rise' && e.time.getTime() > t)?.time || null;
    set = rise ? (ev.find(e => e.type === 'set' && e.time > rise)?.time || null) : null;
  }
  return { up: Boolean(up), rise, set };
}

/* Gemeinsamer Himmelsbogen für Sonne und Mond (Linie selbst bleibt unsichtbar) */
function skyArc(hero) {
  const W = hero.clientWidth, H = hero.clientHeight;
  const rows = hero.querySelector('.sky-rows');
  const horizon = rows ? rows.offsetTop - 14 : H - 46;
  return { W, H, pad: 26, horizon, apex: 104 };
}
function arcPoint(arc, f) {
  const ff = Math.min(1, Math.max(0, f));
  const alt = Math.sin(Math.PI * ff);
  return { x: arc.pad + ff * (arc.W - 2 * arc.pad), y: arc.horizon - (arc.horizon - arc.apex) * alt, alt };
}

/* Mondscheibe: echte Phase, echte Neigung der Sichel, dazu ein Leuchten wie bei der Sonne */
let moonSeq = 0;
function moonDiscSvg(st, variant) {
  const id = 'md' + (++moonSeq);
  const R = 50, C = 100, k = st.illum;
  const rx = Math.max(0.8, Math.abs(1 - 2 * k) * R).toFixed(2);
  const top = `${C} ${C - R}`, bottom = `${C} ${C + R}`;
  let d;
  if (k < 0.01) d = '';
  else if (k > 0.99) d = `M${top} A${R} ${R} 0 1 1 ${bottom} A${R} ${R} 0 1 1 ${top}Z`;
  else d = `M${top} A${R} ${R} 0 0 1 ${bottom} A${rx} ${R} 0 0 ${k < 0.5 ? 0 : 1} ${top}Z`;
  // heller Rand zeigt im lokalen Bild nach rechts → auf echte Richtung drehen
  const rot = -(st.limbAngle + 90);
  const tex = -st.northAngle;
  const glowOp = (0.35 + 0.65 * k).toFixed(2);
  const surface = variant === 'b'
    ? `<circle cx="${C}" cy="${C}" r="${R}" fill="url(#${id}p)"/><g transform="rotate(${tex.toFixed(1)} ${C} ${C})" opacity=".26" style="mix-blend-mode:multiply"><image href="moon.webp" x="${C - R}" y="${C - R}" width="${2 * R}" height="${2 * R}" preserveAspectRatio="xMidYMid meet"/></g>`
    : `<g transform="rotate(${tex.toFixed(1)} ${C} ${C})"><image href="moon.webp" x="${C - R}" y="${C - R}" width="${2 * R}" height="${2 * R}" preserveAspectRatio="xMidYMid meet"/></g><circle cx="${C}" cy="${C}" r="${R}" fill="url(#${id}t)" style="mix-blend-mode:multiply"/>`;
  return `<svg viewBox="0 0 200 200" width="100%" height="100%">
    <defs>
      <filter id="${id}h" x="-120%" y="-120%" width="340%" height="340%"><feGaussianBlur stdDeviation="20"/></filter>
      <filter id="${id}g" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="5"/></filter>
      <filter id="${id}s"><feGaussianBlur stdDeviation="1.3"/></filter>
      <radialGradient id="${id}p" cx="50%" cy="50%" r="50%">
        <stop offset="0" stop-color="#FFFFFF"/><stop offset=".55" stop-color="#FBF7EC"/><stop offset=".92" stop-color="#EAE4D6"/><stop offset="1" stop-color="#DCD6CA"/>
      </radialGradient>
      <radialGradient id="${id}t" cx="50%" cy="50%" r="50%">
        <stop offset="0" stop-color="#FFFDF6"/><stop offset=".8" stop-color="#F6F0E2"/><stop offset="1" stop-color="#D9D2C4"/>
      </radialGradient>
      <mask id="${id}m"><path d="${d || 'M0 0'}" fill="#fff" filter="url(#${id}s)" transform="rotate(${rot.toFixed(1)} ${C} ${C})"/></mask>
      <clipPath id="${id}c"><circle cx="${C}" cy="${C}" r="${R}"/></clipPath>
    </defs>
    ${d ? `<g transform="rotate(${rot.toFixed(1)} ${C} ${C})" opacity="${glowOp}">
      <circle cx="${C}" cy="${C}" r="${R * 1.05}" fill="var(--moon-halo, #F4F1FF)" filter="url(#${id}h)" opacity=".55"/>
      <path d="${d}" fill="#FFFFFF" filter="url(#${id}g)" opacity=".8"/>
    </g>` : ''}
    <g clip-path="url(#${id}c)">
      <circle cx="${C}" cy="${C}" r="${R}" style="fill:var(--moon-shadow, transparent)"/>
      <g style="opacity:var(--moon-earthshine, .16)">${surface}</g>
      ${d ? `<g mask="url(#${id}m)">${surface}<circle cx="${C}" cy="${C}" r="${R}" fill="#FFFFFF" style="opacity:var(--moon-wash, 0)"/></g>` : ''}
    </g>
  </svg>`;
}

const MOON_STYLE = 'a';
let moonPassCache = null;
function placeMoon() {
  const hero = document.querySelector('.hero');
  const moonOrb = $('moonOrb');
  if (!hero || !moonOrb) return;
  const wall = nowForSky(skyDayOffset);
  const now = instantOfSky(wall);
  const t = now.getTime();
  if (!moonPassCache || moonPassCache.geo !== GEO.lat + ',' + GEO.lon || t < moonPassCache.from || t > moonPassCache.to) {
    const pass = moonPass(now);
    const until = pass.up ? pass.set : pass.rise;
    moonPassCache = { pass, geo: GEO.lat + ',' + GEO.lon, from: t - 60000, to: until ? until.getTime() : t + 3600000 };
  }
  const { pass } = moonPassCache;
  const st = moonState(now);
  const clock = d => { if (!d) return '--:--'; const m = wrapMinutes(Math.round(d.getTime() / 60000) + placeOffsetMin(d)); return minutesToClock(m); };
  let labelRise = pass.rise, labelSet = pass.set;
  if (skyDayOffset > 0) {
    const dayStartWall = new Date(wall.getFullYear(), wall.getMonth(), wall.getDate(), 0, 0, 0, 0);
    const dayEndWall = new Date(dayStartWall); dayEndWall.setDate(dayEndWall.getDate() + 1);
    const ev = moonEvents(instantOfSky(dayStartWall), instantOfSky(dayEndWall));
    labelRise = ev.find(e => e.type === 'rise')?.time || null;
    labelSet = ev.find(e => e.type === 'set')?.time || null;
  }
  if (els.moonriseLabel) els.moonriseLabel.textContent = clock(labelRise);
  if (els.moonsetLabel) els.moonsetLabel.textContent = clock(labelSet);
  if (els.moonPhaseLabel) els.moonPhaseLabel.textContent = `${moonPhaseName(st.age)} · ${Math.round(st.illum * 100)} %`;
  window.__moonDebug = { alt: st.alt, az: st.az, illum: st.illum, limb: st.limbAngle, rise: pass.rise && pass.rise.toString(), set: pass.set && pass.set.toString(), up: pass.up };

  const up = pass.up && pass.rise && pass.set;
  moonOrb.classList.toggle('hidden', !up);
  if (els.moonTap) els.moonTap.classList.toggle('hidden', !up);
  if (!up) { if (activePlanetInfoKey === 'moon') hidePlanetInfo(); return; }
  const arc = skyArc(hero);
  if (!arc.W || !arc.H) return;
  const f = (t - pass.rise.getTime()) / (pass.set.getTime() - pass.rise.getTime());
  const p = arcPoint(arc, f);
  moonOrb.style.left = `${p.x}px`;
  moonOrb.style.top = `${p.y}px`;
  moonOrb.style.setProperty('--moon-size', `${moonRenderSize(st.distKm, p.alt)}px`);
  if (els.moonTap) { const hit = Math.max(48, Math.round(moonRenderSize(st.distKm, p.alt) * .7)); els.moonTap.style.left = `${p.x}px`; els.moonTap.style.top = `${p.y}px`; els.moonTap.style.width = `${hit}px`; els.moonTap.style.height = `${hit}px`; }
  const night = ['nacht', 'abend', 'abenddaemmerung', 'daemmerung'].includes(document.documentElement.dataset.phase);
  moonOrb.style.setProperty('--moon-earthshine', night ? '.1' : '.04');
  moonOrb.style.setProperty('--moon-wash', night ? '0' : '.28');
  moonOrb.style.setProperty('--moon-shadow', night ? 'color-mix(in srgb, var(--sky-mid) 88%, black)' : 'transparent');
  moonOrb.style.setProperty('--moon-halo', night ? '#F3EAD3' : '#FFFFFF');
  const fx = currentFx();
  const visibility = celestialWeatherOpacity(fx, 3.4);
  moonOrb.style.setProperty('--moon-veil', visibility.toFixed(3));
  if (els.moonTap) els.moonTap.style.pointerEvents = visibility < .09 ? 'none' : 'auto';
  const key = `${MOON_STYLE}|${st.illum.toFixed(3)}|${Math.round(st.limbAngle)}|${Math.round(st.northAngle)}`;
  if (moonOrb.dataset.key !== key) { moonOrb.dataset.key = key; moonOrb.innerHTML = moonDiscSvg(st, MOON_STYLE); }
}


/* ---------- V3.5: Planeten am gewählten Himmel ----------
   Niedrigpräzise Bahnelemente für die visuelle Orientierung im Himmelsbereich.
   Angezeigt werden die fünf klassischen, grundsätzlich freiäugig sichtbaren Planeten. */
const PLANET_META = {
  mercury: { name: 'Merkur', url: 'https://de.wikipedia.org/wiki/Merkur_(Planet)' },
  venus:   { name: 'Venus', url: 'https://de.wikipedia.org/wiki/Venus_(Planet)' },
  mars:    { name: 'Mars', url: 'https://de.wikipedia.org/wiki/Mars_(Planet)' },
  jupiter: { name: 'Jupiter', url: 'https://de.wikipedia.org/wiki/Jupiter_(Planet)' },
  saturn:  { name: 'Saturn', url: 'https://de.wikipedia.org/wiki/Saturn_(Planet)' }
};
const CELESTIAL_URLS = {
  sun: 'https://de.wikipedia.org/wiki/Sonne',
  moon: 'https://de.wikipedia.org/wiki/Mond'
};
const AU_KM = 149597870.7;

function formatDistanceKm(km) {
  if (!Number.isFinite(km)) return '–';
  if (km >= 10000000) return `${(km / 1000000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} Mio. km`;
  return `${Math.round(km).toLocaleString('de-DE')} km`;
}
function formatDaylightMinutes(mins) {
  const m = Math.max(0, Math.round(mins));
  return `${Math.floor(m / 60)} Std. ${String(m % 60).padStart(2, '0')} Min.`;
}
function infoLink(url) {
  return `<a class="sky-info-link" href="${url}" target="_blank" rel="noopener noreferrer" aria-label="Mehr Informationen im Internet öffnen">ⓘ Mehr erfahren</a>`;
}
function setSkyInfoContent(html, key) {
  const info = $('planetInfo');
  if (!info) return;
  info.innerHTML = html;
  activePlanetInfoKey = key;
}
function positionSkyInfoNear(btn) {
  const hero = document.querySelector('.hero');
  const info = $('planetInfo');
  if (!hero || !info || !btn) return;
  info.classList.remove('hidden', 'below', 'dragging');
  clearTimeout(planetInfoTimer);
  requestAnimationFrame(() => {
    const hr = hero.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    const edge = 12, gap = 8;
    const iw = Math.min(info.offsetWidth, Math.max(0, hero.clientWidth - edge * 2));
    const ih = info.offsetHeight;
    const centerX = br.left - hr.left + br.width / 2;
    const maxLeft = Math.max(edge, hero.clientWidth - iw - edge);
    const left = Math.max(edge, Math.min(maxLeft, centerX - iw / 2));
    const objectTop = br.top - hr.top;
    const objectBottom = objectTop + br.height;
    const above = objectTop - gap - ih;
    const below = objectBottom + gap;
    let top;
    if (above >= edge) top = above;
    else if (below + ih <= hero.clientHeight - edge) { top = below; info.classList.add('below'); }
    else { top = Math.max(edge, Math.min(hero.clientHeight - ih - edge, below)); info.classList.add('below'); }
    const pos = clampPlanetInfoPosition(left, top);
    info.style.left = `${pos.left}px`;
    info.style.top = `${pos.top}px`;
  });
}
function showSunInfo(btn, keepPos = false) {
  const wall = nowForSky(skyDayOffset);
  const instant = instantOfSky(wall);
  const p = sunSkyState(instant);
  const d = astroJulian(instant) - 2451543.5;
  const distKm = sunGeoXYZ(d).r * AU_KM;
  const { rise, set } = sunTimes(wall);
  const dir = planetDirection(p.az);
  const altitude = p.alt >= 0 ? `${Math.round(p.alt)}° über Horizont` : `${Math.abs(Math.round(p.alt))}° unter Horizont`;
  const daylight = formatDaylightMinutes(set - rise);
  setSkyInfoContent(`<strong>Sonne</strong><span>${dir} · ${altitude}</span><span>Entfernung: ${formatDistanceKm(distKm)}</span><span>Aufgang ${minutesToClock(rise)} · Untergang ${minutesToClock(set)}</span><span>Tageslänge: ${daylight}</span>${infoLink(CELESTIAL_URLS.sun)}`, 'sun');
  if (!keepPos) positionSkyInfoNear(btn);
}
function showMoonInfo(btn, keepPos = false) {
  const wall = nowForSky(skyDayOffset);
  const instant = instantOfSky(wall);
  const st = moonState(instant);
  const dir = planetDirection(st.az);
  const altitude = st.alt >= 0 ? `${Math.round(st.alt)}° über Horizont` : `${Math.abs(Math.round(st.alt))}° unter Horizont`;
  const rise = els.moonriseLabel?.textContent || '--:--';
  const set = els.moonsetLabel?.textContent || '--:--';
  setSkyInfoContent(`<strong>Mond</strong><span>${moonPhaseName(st.age)} · ${Math.round(st.illum * 100)} % beleuchtet</span><span>${dir} · ${altitude}</span><span>Entfernung: ${formatDistanceKm(st.distKm)}</span><span>Aufgang ${rise} · Untergang ${set}</span>${infoLink(CELESTIAL_URLS.moon)}`, 'moon');
  if (!keepPos) positionSkyInfoNear(btn);
}
/* Offene Sonnen-/Mond-Infos immer auf den aktuellen Stand bringen (sonst bleibt ein alter Wert stehen). */
function refreshOpenCelestialInfo() {
  const info = $('planetInfo');
  if (!info || info.classList.contains('hidden')) return;
  if (activePlanetInfoKey === 'sun') showSunInfo(els.sunTap, true);
  else if (activePlanetInfoKey === 'moon') showMoonInfo(els.moonTap, true);
}
function toggleCelestialInfo(key, btn) {
  const info = $('planetInfo');
  if (activePlanetInfoKey === key && info && !info.classList.contains('hidden')) { hidePlanetInfo(); return; }
  if (key === 'sun') showSunInfo(btn);
  else if (key === 'moon') showMoonInfo(btn);
}

let planetInfoTimer = null;
let activePlanetInfoKey = '';
let planetInfoDrag = null;

function astroNorm360(x) { return ((x % 360) + 360) % 360; }
function astroNorm180(x) { const n = astroNorm360(x); return n > 180 ? n - 360 : n; }
function astroRad(x) { return x * Math.PI / 180; }
function astroDeg(x) { return x * 180 / Math.PI; }

function astroJulian(date) { return date.getTime() / 86400000 + 2440587.5; }

function planetElements(key, d) {
  const E = {
    mercury: [48.3313 + 3.24587e-5*d, 7.0047 + 5.00e-8*d, 29.1241 + 1.01444e-5*d, 0.387098, 0.205635 + 5.59e-10*d, 168.6562 + 4.0923344368*d],
    venus:   [76.6799 + 2.46590e-5*d, 3.3946 + 2.75e-8*d, 54.8910 + 1.38374e-5*d, 0.723330, 0.006773 - 1.302e-9*d, 48.0052 + 1.6021302244*d],
    mars:    [49.5574 + 2.11081e-5*d, 1.8497 - 1.78e-8*d, 286.5016 + 2.92961e-5*d, 1.523688, 0.093405 + 2.516e-9*d, 18.6021 + 0.5240207766*d],
    jupiter: [100.4542 + 2.76854e-5*d, 1.3030 - 1.557e-7*d, 273.8777 + 1.64505e-5*d, 5.20256, 0.048498 + 4.469e-9*d, 19.8950 + 0.0830853001*d],
    saturn:  [113.6634 + 2.38980e-5*d, 2.4886 - 1.081e-7*d, 339.3939 + 2.97661e-5*d, 9.55475, 0.055546 - 9.499e-9*d, 316.9670 + 0.0334442282*d],
    sun:     [0, 0, 282.9404 + 4.70935e-5*d, 1.0, 0.016709 - 1.151e-9*d, 356.0470 + 0.9856002585*d]
  }[key];
  if (!E) return null;
  return { N:E[0], i:E[1], w:E[2], a:E[3], e:E[4], M:astroNorm360(E[5]) };
}

function solveKepler(Mdeg, e) {
  const M = astroRad(Mdeg);
  let E = M + e * Math.sin(M) * (1 + e * Math.cos(M));
  for (let i = 0; i < 7; i++) {
    const next = E - (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    if (Math.abs(next - E) < 1e-8) { E = next; break; }
    E = next;
  }
  return E;
}

function orbitXYZ(el) {
  const E = solveKepler(el.M, el.e);
  const xv = el.a * (Math.cos(E) - el.e);
  const yv = el.a * Math.sqrt(1 - el.e * el.e) * Math.sin(E);
  const v = Math.atan2(yv, xv);
  const r = Math.hypot(xv, yv);
  const N = astroRad(el.N), i = astroRad(el.i), vw = v + astroRad(el.w);
  return {
    x: r * (Math.cos(N) * Math.cos(vw) - Math.sin(N) * Math.sin(vw) * Math.cos(i)),
    y: r * (Math.sin(N) * Math.cos(vw) + Math.cos(N) * Math.sin(vw) * Math.cos(i)),
    z: r * Math.sin(vw) * Math.sin(i), r
  };
}

function sunGeoXYZ(d) {
  const el = planetElements('sun', d);
  const E = solveKepler(el.M, el.e);
  const xv = Math.cos(E) - el.e;
  const yv = Math.sqrt(1 - el.e * el.e) * Math.sin(E);
  const v = Math.atan2(yv, xv);
  const r = Math.hypot(xv, yv);
  const lon = v + astroRad(el.w);
  return { x:r*Math.cos(lon), y:r*Math.sin(lon), z:0, r };
}

function eclipticToRaDec(x, y, z, d) {
  const obl = astroRad(23.4393 - 3.563e-7 * d);
  const xe = x;
  const ye = y * Math.cos(obl) - z * Math.sin(obl);
  const ze = y * Math.sin(obl) + z * Math.cos(obl);
  const ra = astroNorm360(astroDeg(Math.atan2(ye, xe)));
  const dec = astroDeg(Math.atan2(ze, Math.hypot(xe, ye)));
  return { ra, dec };
}

function horizontalFromRaDec(ra, dec, instant) {
  const jd = astroJulian(instant);
  const gmst = astroNorm360(280.46061837 + 360.98564736629 * (jd - 2451545.0));
  const H = astroNorm180(gmst + GEO.lon - ra);
  const hr = astroRad(H), dr = astroRad(dec), lr = astroRad(GEO.lat);
  const sinAlt = Math.sin(lr)*Math.sin(dr) + Math.cos(lr)*Math.cos(dr)*Math.cos(hr);
  const alt = astroDeg(Math.asin(Math.max(-1, Math.min(1, sinAlt))));
  const az = astroNorm360(astroDeg(Math.atan2(Math.sin(hr), Math.cos(hr)*Math.sin(lr) - Math.tan(dr)*Math.cos(lr))) + 180);
  return { alt, az, hourAngle:H };
}

function planetApparentMagnitude(key, r, delta, phase) {
  const a = Math.max(0, Math.min(180, phase));
  const distanceTerm = 5 * Math.log10(Math.max(0.01, r * delta));
  switch (key) {
    case 'mercury': return -0.42 + distanceTerm + 0.0380*a - 0.000273*a*a + 0.000002*a*a*a;
    case 'venus':   return -4.40 + distanceTerm + 0.0009*a + 0.000239*a*a - 0.00000065*a*a*a;
    case 'mars':    return -1.52 + distanceTerm + 0.016*a;
    case 'jupiter': return -9.40 + distanceTerm + 0.005*a;
    case 'saturn':  return -8.88 + distanceTerm + 0.044*a;
    default:        return 1;
  }
}

function planetSkyState(key, instant) {
  const d = astroJulian(instant) - 2451543.5;
  const sun = sunGeoXYZ(d);
  const el = planetElements(key, d);
  if (!el) return null;
  const h = orbitXYZ(el);
  const gx = h.x + sun.x, gy = h.y + sun.y, gz = h.z;
  const delta = Math.hypot(gx, gy, gz);
  const phaseCos = Math.max(-1, Math.min(1, (h.r*h.r + delta*delta - sun.r*sun.r) / Math.max(1e-6, 2*h.r*delta)));
  const phaseAngle = astroDeg(Math.acos(phaseCos));
  const magnitude = planetApparentMagnitude(key, h.r, delta, phaseAngle);
  const eq = eclipticToRaDec(gx, gy, gz, d);
  return { ...eq, ...horizontalFromRaDec(eq.ra, eq.dec, instant), magnitude, phaseAngle, distance:delta };
}

function sunSkyState(instant) {
  const d = astroJulian(instant) - 2451543.5;
  const s = sunGeoXYZ(d);
  const eq = eclipticToRaDec(s.x, s.y, s.z, d);
  return { ...eq, ...horizontalFromRaDec(eq.ra, eq.dec, instant) };
}

function planetDirection(az) {
  const dirs = ['Norden','Nordosten','Osten','Südosten','Süden','Südwesten','Westen','Nordwesten'];
  return dirs[Math.round(astroNorm360(az) / 45) % 8];
}

function planetVisibilityText(p, sunAlt) {
  const fx = currentFx();
  if (sunAlt > -2) return 'bei Tageslicht kaum sichtbar';
  if (sunAlt > -7) return 'in der Dämmerung';
  if (fx.clouds > .78 || fx.fog > .45 || fx.rain > .35 || fx.snow > .35) return 'astronomisch sichtbar, Wetter kann die Sicht verdecken';
  if (p.alt < 8) return 'sehr tief über dem Horizont';
  return 'bei dunklem Himmel sichtbar';
}

function planetVisualLight(p, sunAlt) {
  const mag = Number.isFinite(p.magnitude) ? p.magnitude : 1;
  const magLevel = Math.max(0.16, Math.min(1, (2.2 - mag) / 6.8));
  const altitudeLevel = Math.max(0.28, Math.min(1, (p.alt + 1) / 18));
  const fx = currentFx();
  const weatherLevel = skyWeatherVisibility(fx, 'stars');
  const skyLevel = sunAlt > 0 ? .20 : sunAlt > -4 ? .36 : sunAlt > -8 ? .66 : 1;
  const visibleLevel = Math.max(.06, Math.min(1, magLevel * altitudeLevel * weatherLevel * skyLevel));
  const nightBoost = sunAlt <= -8 ? 1 : .88;
  return {
    opacity: weatherLevel < .025 ? 0 : Math.max(0, Math.min(1, visibleLevel * 1.18)),
    glow: (2.5 + 13 * magLevel * skyLevel * nightBoost).toFixed(1),
    glowAlpha: Math.max(.10, Math.min(.86, .12 + magLevel * skyLevel * .72)).toFixed(2),
    brightness: Math.max(.82, Math.min(1.38, .90 + magLevel * .48)).toFixed(2)
  };
}

function planetPoint(hero, p) {
  const arc = skyArc(hero);
  const lat = astroRad(GEO.lat), dec = astroRad(p.dec);
  let c = -Math.tan(lat) * Math.tan(dec);
  let H0;
  if (c <= -1) H0 = 180;
  else if (c >= 1) H0 = 0;
  else H0 = astroDeg(Math.acos(c));
  const f = H0 > 0 ? Math.max(0, Math.min(1, (p.hourAngle + H0) / (2 * H0))) : .5;
  const maxAlt = Math.max(8, 90 - Math.abs(GEO.lat - p.dec));
  const altNorm = Math.max(0, Math.min(1, p.alt / maxAlt));
  return {
    x: arc.pad + f * (arc.W - 2 * arc.pad),
    y: arc.horizon - (arc.horizon - arc.apex) * altNorm
  };
}

function hidePlanetInfo() {
  const info = $('planetInfo');
  if (!info) return;
  info.classList.add('hidden');
  info.classList.remove('below', 'dragging');
  activePlanetInfoKey = '';
  planetInfoDrag = null;
  clearTimeout(planetInfoTimer);
}

function clampPlanetInfoPosition(left, top) {
  const hero = document.querySelector('.hero');
  const info = $('planetInfo');
  if (!hero || !info) return { left, top };
  const edge = 12;
  const maxLeft = Math.max(edge, hero.clientWidth - info.offsetWidth - edge);
  const maxTop = Math.max(edge, hero.clientHeight - info.offsetHeight - edge);
  return {
    left: Math.max(edge, Math.min(maxLeft, left)),
    top: Math.max(edge, Math.min(maxTop, top))
  };
}

function showPlanetInfo(btn, p, sunAlt) {
  const info = $('planetInfo');
  if (!info || !btn) return;
  const key = btn.dataset.planet || '';
  const meta = PLANET_META[key];
  const name = meta?.name || key;
  const direction = planetDirection(p.az);
  const distKm = p.distance * AU_KM;
  const mag = Number.isFinite(p.magnitude) ? p.magnitude.toLocaleString('de-DE', { maximumFractionDigits: 1 }) : '–';
  setSkyInfoContent(`<strong>${name}</strong><span>${direction} · ${Math.round(p.alt)}° über Horizont · ${planetVisibilityText(p, sunAlt)}</span><span>Entfernung: ${formatDistanceKm(distKm)} · Helligkeit ${mag} mag</span>${meta?.url ? infoLink(meta.url) : ''}`, key);
  positionSkyInfoNear(btn);
}

function initPlanetInfoDrag() {
  const info = $('planetInfo');
  const hero = document.querySelector('.hero');
  if (!info || !hero || info.dataset.dragReady) return;
  info.dataset.dragReady = '1';

  info.addEventListener('pointerdown', e => {
    if (info.classList.contains('hidden') || e.button > 0 || e.target.closest('a, button')) return;
    const hr = hero.getBoundingClientRect();
    const ir = info.getBoundingClientRect();
    planetInfoDrag = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      left: ir.left - hr.left,
      top: ir.top - hr.top,
      moved: false
    };
    info.classList.add('dragging');
    info.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });

  info.addEventListener('pointermove', e => {
    const drag = planetInfoDrag;
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.hypot(dx, dy) > 3) drag.moved = true;
    const pos = clampPlanetInfoPosition(drag.left + dx, drag.top + dy);
    info.style.left = `${pos.left}px`;
    info.style.top = `${pos.top}px`;
    e.preventDefault();
  });

  const finish = e => {
    if (!planetInfoDrag || planetInfoDrag.id !== e.pointerId) return;
    info.releasePointerCapture?.(e.pointerId);
    planetInfoDrag = null;
    info.classList.remove('dragging');
  };
  info.addEventListener('pointerup', finish);
  info.addEventListener('pointercancel', finish);
}

function placePlanets() {
  const hero = document.querySelector('.hero');
  const layer = $('planetLayer');
  const info = $('planetInfo');
  if (!hero || !layer) return;
  const openPlanetKey = info && !info.classList.contains('hidden') && PLANET_META[activePlanetInfoKey] ? activePlanetInfoKey : '';
  const instant = instantOfSky(nowForSky(skyDayOffset));
  const sun = sunSkyState(instant);
  const current = Object.keys(PLANET_META).map(key => {
    const p = planetSkyState(key, instant);
    return p ? { key, ...p } : null;
  }).filter(p => p && p.alt > 2);

  if (!current.length) {
    layer.innerHTML = '';
    if (info && PLANET_META[activePlanetInfoKey]) hidePlanetInfo();
    return;
  }

  const oldFocus = document.activeElement?.closest?.('.planet-dot')?.dataset.planet || '';
  layer.innerHTML = current.map(p => {
    const pt = planetPoint(hero, p);
    const dim = sun.alt > -4 ? ' dim' : '';
    const name = PLANET_META[p.key].name;
    const light = planetVisualLight(p, sun.alt);
    const scale = planetRenderScale(p.key, p.distance);
    const style = `left:${pt.x.toFixed(1)}px;top:${pt.y.toFixed(1)}px;--planet-opacity:${light.opacity.toFixed(2)};--planet-glow:${light.glow}px;--planet-glow-alpha:${light.glowAlpha};--planet-brightness:${light.brightness};--planet-scale:${scale.toFixed(3)}`;
    return `<button type="button" class="planet-dot planet-${p.key}${dim}" data-planet="${p.key}" style="${style}" aria-label="${name} anzeigen" ${light.opacity < .045 ? 'tabindex="-1" aria-hidden="true"' : ''}><span class="planet-disc" aria-hidden="true"></span></button>`;
  }).join('');

  layer.querySelectorAll('.planet-dot').forEach(btn => {
    btn.addEventListener('click', () => {
      if (skySwipeJustHappened) return;
      const key = btn.dataset.planet;
      if (activePlanetInfoKey === key && info && !info.classList.contains('hidden')) {
        hidePlanetInfo();
        return;
      }
      const p = current.find(x => x.key === key);
      if (p) showPlanetInfo(btn, p, sun.alt);
    });
  });
  if (openPlanetKey) {
    const btn = layer.querySelector(`[data-planet="${openPlanetKey}"]`);
    const p = current.find(x => x.key === openPlanetKey);
    if (btn && p && info && !info.classList.contains('hidden')) showPlanetInfo(btn, p, sun.alt);
    else if (!p) hidePlanetInfo();
  }
  if (oldFocus) layer.querySelector(`[data-planet="${oldFocus}"]`)?.focus({ preventScroll:true });
}

/* =====================================================================
   V3.8 · Fotorealistische Wolken
   Statt weicher Farbflecken wird ein echtes Wolkenbild berechnet:
   Rauschen in mehreren Größen (wie bei Wolkenfotos), Licht von der Seite
   der Sonne, helle Ränder, dunklere Unterseiten. Die Farben folgen der
   Tageszeit (Gold am Abend, Blaugrau bei Regen, dunkles Blau nachts).
   Das Bild wird einmal berechnet und driftet danach nur noch langsam.
   ===================================================================== */
const CLOUD_TW = 360, CLOUD_TH = 300;
const cloudFields = { back: null, front: null, key: '' };
let skyPaletteState = null;
let cloudPaintKey = '';
let cloudGenTimer = null;
const cloudTiles = {};

function cloudRng(seed) {
  let a = seed | 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function cloudLattice(seed, nx, ny) {
  const r = cloudRng(seed), a = new Float32Array(nx * ny);
  for (let i = 0; i < a.length; i++) a[i] = r();
  return { a, nx, ny };
}
function cloudNoise(L, u, v) {
  const x = u * L.nx, y = Math.min(1, Math.max(0, v)) * (L.ny - 1);
  const xf = Math.floor(x), yi = Math.min(L.ny - 2, Math.max(0, Math.floor(y)));
  let fx = x - xf, fy = y - yi;
  fx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  fy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const x0 = ((xf % L.nx) + L.nx) % L.nx, x1 = (x0 + 1) % L.nx;
  const r0 = yi * L.nx, r1 = (yi + 1) * L.nx;
  const a = L.a[r0 + x0], b = L.a[r0 + x1], c = L.a[r1 + x0], d = L.a[r1 + x1];
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

/* Erzeugt Dichte (0..1) und Licht (0..1) für ein nahtlos wiederholbares Wolkenfeld. */
function genCloudField(seed, o) {
  const W = CLOUD_TW, H = CLOUD_TH;
  const lats = [];
  for (let i = 0; i < o.oct; i++) lats.push(cloudLattice(seed + i * 101, o.cx << i, (o.cy << i) + 2));
  const wA = cloudLattice(seed + 999, 3, 4), wB = cloudLattice(seed + 555, 4, 5);
  const dets = [0, 1, 2].map(i => cloudLattice(seed + 313 + i * 17, (o.dx || 12) << i, ((o.dy || 14) << i) + 2));
  const fbm = (u, v) => {
    let s = 0, amp = 1, tot = 0;
    for (let i = 0; i < lats.length; i++) { s += amp * cloudNoise(lats[i], u, v); tot += amp; amp *= o.gain; }
    return s / tot;
  };
  const raw = new Float32Array(W * H), lit = new Float32Array(W * H), det = new Float32Array(W * H);
  const lx = o.lx / W, ly = o.ly / H;
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const wu = (cloudNoise(wA, u, v) - .5) * o.warpX;
      const wv = (cloudNoise(wB, u, v) - .5) * o.warpY;
      const uu = u + wu, vv = v + wv;
      const i = y * W + x;
      raw[i] = fbm(uu, vv);
      lit[i] = fbm(uu + lx, vv + ly);
      det[i] = (cloudNoise(dets[0], uu, vv) * .55 + cloudNoise(dets[1], uu, vv) * .3 + cloudNoise(dets[2], uu, vv) * .15);
    }
  }
  // Wertebereich über ein Histogramm normieren, damit „Bewölkung 50 %“ auch wirklich etwa die halbe Fläche ist.
  const BINS = 512, hist = new Uint32Array(BINS);
  let mn = 1e9, mx = -1e9;
  for (let i = 0; i < raw.length; i++) { if (raw[i] < mn) mn = raw[i]; if (raw[i] > mx) mx = raw[i]; }
  const span = Math.max(1e-6, mx - mn);
  for (let i = 0; i < raw.length; i++) { raw[i] = (raw[i] - mn) / span; lit[i] = (lit[i] - mn) / span; hist[Math.min(BINS - 1, (raw[i] * BINS) | 0)]++; }
  return { raw, lit, det, hist, W, H, bins: BINS, o };
}

function cloudThreshold(field, coverage) {
  // Schwelle, ab der genau der Anteil `coverage` der Fläche Wolke ist
  const target = Math.max(0, Math.min(1, 1 - coverage)) * field.W * field.H;
  let acc = 0;
  for (let b = 0; b < field.bins; b++) { acc += field.hist[b]; if (acc >= target) return (b + 1) / field.bins; }
  return 1;
}

function cloudPaletteNow() {
  const p = skyPaletteState;
  if (!p) return null;
  const fx = currentFx();
  const cl = (v, a, b) => Math.max(a, Math.min(b, v));
  const kHor = cl((luminance(p.hor) - .10) / .38, 0, 1);
  const kMid = cl(luminance(p.mid) / .30, 0, 1);
  let lit = mixHex('#7B92DA', mixHex(p.hor, '#FFFFFF', .46), kHor);
  let shadow = mixHex('#171C3A', mixHex(mixHex(p.top, p.mid, .5), '#5A668E', .50), kMid);
  const dark = cl(Math.max(fx.rain * .85, fx.snow * .45, fx.storm ? 1 : 0), 0, 1);
  if (dark > 0) {
    lit = mixHex(lit, mixHex('#8F98A8', '#CBD2DC', kMid * .6), dark * .7);
    shadow = mixHex(shadow, mixHex('#232834', '#4A5364', kMid * .7), dark * .85);
  }
  if (fx.storm) { lit = mixHex(lit, '#6A7384', .5); shadow = mixHex(shadow, '#161A24', .55); }
  const ovp = Math.max(0, Math.min(1, (fx.clouds - .7) / .25)) * (fx.storm ? .45 : 1);
  shadow = mixHex(shadow, lit, (dark > .4 ? .18 : .38) + .45 * ovp);
  return { lit: hexToRgb(lit), shadow: hexToRgb(shadow), night: 1 - kMid, key: lit + shadow + (fx.rain > 0 ? 'r' : '') };
}

function paintCloudTile(name, field, cover, pal, opts) {
  if (!field) return null;
  const W = field.W, H = field.H;
  // Geschlossene Wolkendecke: keine Lücken, sonst scheint der dunkle Himmel als Flecken durch
  const th = cover >= .97 ? -.4 : cloudThreshold(field, cover) - Math.max(0, cover - .8) * .35;
  const sf = opts.soft;
  let c = cloudTiles[name];
  if (!c) { c = cloudTiles[name] = document.createElement('canvas'); c.width = W; c.height = H; }
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  const d = img.data;
  const ls = pal.lit, ss = pal.shadow;
  const alphaMul = opts.alpha * (1 - pal.night * .34);
  for (let i = 0; i < W * H; i++) {
    const r = field.raw[i];
    const rr = r + (field.det[i] - .5) * opts.erode;
    let dens = (rr - th) / sf;
    dens = dens <= 0 ? 0 : dens >= 1 ? 1 : dens * dens * (3 - 2 * dens);
    const o = i * 4;
    if (dens <= 0.03) { d[o + 3] = 0; continue; }
    // Licht: Seite zur Sonne hell, abgewandte Seite dunkel; dicke Kerne etwas dunkler
    let s = .52 + (r - field.lit[i]) * opts.gain + (field.det[i] - .5) * opts.tex;
    const core = Math.max(0, (r - th) / Math.max(.05, 1 - th));
    s -= core * .26 * opts.depth;
    if (opts.flat) s = .55 + (s - .55) * (1 - .8 * opts.flat);
    s = s < 0 ? 0 : s > 1 ? 1 : s;
    // Dünne Ränder leuchten (Silberrand)
    s = s + (1 - dens) * .22 * (1 - s * .4);
    s = s > 1 ? 1 : s;
    d[o] = ss[0] + (ls[0] - ss[0]) * s;
    d[o + 1] = ss[1] + (ls[1] - ss[1]) * s;
    d[o + 2] = ss[2] + (ls[2] - ss[2]) * s;
    d[o + 3] = Math.min(255, 255 * Math.pow(dens, .85) * alphaMul);
  }
  g.putImageData(img, 0, 0);
  return c;
}

function ensureCloudCanvases(layer) {
  const host = layer.parentElement;
  if (!host) return null;
  let back = host.querySelector(':scope > canvas.sky-cloud.back');
  if (!back) {
    back = document.createElement('canvas');
    back.className = 'sky-cloud back';
    back.setAttribute('aria-hidden', 'true');
    const stars = host.querySelector(':scope > .stars');
    host.insertBefore(back, stars ? stars.nextSibling : host.firstChild);
  }
  const box = layer.querySelector('.clouds');
  let front = box && box.querySelector('canvas.sky-cloud.front');
  if (box && !front) {
    front = document.createElement('canvas');
    front.className = 'sky-cloud front';
    front.setAttribute('aria-hidden', 'true');
    box.innerHTML = '';
    box.appendChild(front);
  }
  return { back, front };
}

function blitCloud(cv, tile) {
  if (!cv) return;
  if (!tile) { cv.style.display = 'none'; return; }
  cv.style.display = '';
  if (cv.width !== CLOUD_TW * 2 || cv.height !== CLOUD_TH) { cv.width = CLOUD_TW * 2; cv.height = CLOUD_TH; }
  const g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height);
  g.drawImage(tile, 0, 0);
  g.drawImage(tile, CLOUD_TW, 0);
}

/* Färbt das Wolkenbild passend zur aktuellen Tageszeit und zum Wetter ein. */
function paintSkyClouds(force = false) {
  const fx = currentFx();
  const pal = cloudPaletteNow();
  if (!pal) return;
  const cover = Math.max(0, Math.min(1, fx.clouds));
  const paintKey = [pal.key, cover.toFixed(2), fx.rain.toFixed(1), fx.snow.toFixed(1), cloudFields.key].join('|');
  if (!force && paintKey === cloudPaintKey) return;
  cloudPaintKey = paintKey;
  const heavy = fx.rain > .5 || fx.storm || fx.snow > .5;
  const ov = Math.max(0, Math.min(1, (cover - .7) / .25));
  const backTile = cover < .1 || !cloudFields.back ? null
    : paintCloudTile('back', cloudFields.back, cover < .99 ? (cover > .8 ? cover : Math.pow(cover, 1.45) * .8) : 1, pal,
        { soft: .17 + .07 * cover + .06 * ov, alpha: heavy ? 1 : .80 + .10 * ov, gain: 3.2 - 1.4 * ov, depth: (heavy ? .6 : .22) * (1 - .5 * ov), erode: .09 - .07 * ov, tex: .20 - .16 * ov, flat: ov * (fx.storm ? .45 : 1) });
  const frontCover = cover < .3 ? 0 : Math.min(.85, cover * .72);
  const frontTile = !frontCover || !cloudFields.front ? null
    : paintCloudTile('front', cloudFields.front, frontCover, pal,
        { soft: .16, alpha: cover > .85 ? .30 : .30, gain: 2.0, depth: .2, erode: .08, tex: .12, flat: ov * .8 });
  document.querySelectorAll('.weather-layer').forEach(layer => {
    const cvs = ensureCloudCanvases(layer);
    if (!cvs) return;
    [cvs.back, cvs.front].forEach(c => c && c.classList.toggle('full', cover >= .75));
    blitCloud(cvs.back, backTile);
    blitCloud(cvs.front, frontTile);
  });
}

/* Rechnet die Wolkenfelder nur dann neu, wenn es nötig ist (Form hängt kaum vom Wetter ab). */
function renderSkyClouds() {
  const fx = currentFx();
  if (fx.clouds < .1) {
    document.querySelectorAll('.weather-layer').forEach(layer => {
      const cvs = ensureCloudCanvases(layer);
      if (cvs) { blitCloud(cvs.back, null); blitCloud(cvs.front, null); }
    });
    cloudPaintKey = '';
    return;
  }
  if (!cloudFields.back) {
    clearTimeout(cloudGenTimer);
    // erst nach dem ersten Bild rechnen, damit die App sofort startet
    cloudGenTimer = setTimeout(() => {
      cloudFields.back = genCloudField(11, { dx: 6, dy: 8, oct: 4, cx: 4, cy: 6, gain: .46, warpX: .09, warpY: .10, lx: 4, ly: -1.2 });
      cloudFields.front = genCloudField(73, { dx: 6, dy: 8, oct: 3, cx: 3, cy: 10, gain: .5, warpX: .12, warpY: .10, lx: 5, ly: -1 });
      cloudFields.key = 'v1';
      paintSkyClouds(true);
    }, 30);
    return;
  }
  paintSkyClouds();
}

function applyWeatherFx() {
  const fx = currentFx();
  const night = ['nacht', 'abend', 'abenddaemmerung', 'daemmerung'].includes(document.documentElement.dataset.phase);
  document.querySelectorAll('.weather-layer').forEach(layer => {
    const coverage = Math.max(0, Math.min(1, fx.clouds));
    // Gemisch aus einzelnen Wolken und der geschlossenen Decke.
    const deck = coverage < .33 ? 0 : Math.pow((coverage - .33) / .67, 1.75);
    layer.style.setProperty('--cloud-op', (0.24 + coverage * .54).toFixed(2));
    layer.style.setProperty('--deck-opacity', deck.toFixed(3));
    layer.style.setProperty('--texture-opacity', (deck * .63).toFixed(3));
    layer.style.setProperty('--fog', fx.fog.toFixed(2));
    layer.style.setProperty('--ice', fx.ice.toFixed(2));
    layer.classList.toggle('night', night);
    layer.classList.toggle('dark-clouds', fx.rain > .3 || fx.storm > 0 || fx.clouds > .9);
    layer.classList.toggle('overcast', fx.clouds >= .88);
    layer.classList.toggle('snowing', fx.snow > .12);
    layer.classList.toggle('rainy', fx.rain > .12);
  });
  precipLayers.forEach(p => p.setup(fx));
  clearTimeout(flashTimer);
  if (fx.storm) scheduleFlash();
  // Text unten im Himmel
  const label = $('weatherLabel');
  if (label) {
    const place = getPlace();
    if (weatherNow?.unavailable && place) {
      label.textContent = `${place.name}, Vorschau nicht verfügbar`;
      label.classList.remove('link');
    } else if (weatherNow?.forecast && place) {
      label.textContent = `${place.name}, ${Math.round(weatherNow.max)}°/${Math.round(weatherNow.min)}°, ${weatherNow.fx.label}`;
      label.classList.remove('link');
    } else if (weatherNow && place) {
      label.textContent = `${place.name}, ${Math.round(weatherNow.temp)}°, ${weatherNow.fx.label}`;
      label.classList.remove('link');
    } else if (weatherNow) {
      label.textContent = weatherNow.fx.label;
      label.classList.remove('link');
    } else {
      label.textContent = 'Ort für Wetter festlegen';
      label.classList.add('link');
    }
  }
  applySky(true);
  renderSkyClouds();
  startPrecip();
}

function scheduleFlash() {
  flashTimer = setTimeout(() => {
    document.querySelectorAll('.weather-layer .flash').forEach(f => { f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); });
    precipLayers.forEach(p => p.strike && p.strike());
    scheduleFlash();
  }, 5000 + Math.random() * 9000);
}

/* Regen und Schnee: unverändert aus V3.7.6 (Naturregen mit Tropfenform, Eiskristalle), von dir ausgewählt. */
function makeWaterDropSprite() {
  const sprite = document.createElement('canvas');
  sprite.width = 56;
  sprite.height = 112;
  const g = sprite.getContext('2d');
  if (!g) return sprite;

  // Hintergrund bleibt vollständig transparent. Die Form hat eine sanfte,
  // gebrochene Lichtkante, eine gläserne Mitte und eine leicht gerundete Basis.
  g.beginPath();
  g.moveTo(28, 7);
  g.bezierCurveTo(25, 21, 13, 48, 11, 68);
  g.bezierCurveTo(8, 88, 17, 103, 28, 104);
  g.bezierCurveTo(40, 104, 48, 89, 45, 70);
  g.bezierCurveTo(43, 49, 31, 19, 28, 7);
  g.closePath();
  const glass = g.createLinearGradient(8, 15, 47, 100);
  glass.addColorStop(0, 'rgba(246,251,255,.10)');
  glass.addColorStop(.19, 'rgba(220,237,252,.52)');
  glass.addColorStop(.42, 'rgba(171,203,234,.12)');
  glass.addColorStop(.75, 'rgba(204,228,252,.25)');
  glass.addColorStop(1, 'rgba(244,251,255,.65)');
  g.fillStyle = glass;
  g.fill();
  g.lineWidth = 2.5;
  g.strokeStyle = 'rgba(235,247,255,.72)';
  g.stroke();

  const glint = g.createLinearGradient(15, 21, 26, 82);
  glint.addColorStop(0, 'rgba(255,255,255,.82)');
  glint.addColorStop(.45, 'rgba(255,255,255,.31)');
  glint.addColorStop(1, 'rgba(255,255,255,0)');
  g.strokeStyle = glint;
  g.lineWidth = 3.8;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(24, 28);
  g.bezierCurveTo(18, 45, 16, 63, 17, 80);
  g.stroke();
  const lowLight = g.createRadialGradient(32, 87, 1, 32, 88, 18);
  lowLight.addColorStop(0, 'rgba(253,255,255,.42)');
  lowLight.addColorStop(1, 'rgba(253,255,255,0)');
  g.fillStyle = lowLight;
  g.fillRect(11, 68, 34, 36);
  return sprite;
}

const WATER_DROP_SPRITE = makeWaterDropSprite();

/* Winterhimmel V3.7.3: gecachte Eiskristall-Sprites, zarte Brechungslichter.
   Nicht jede Flocke ist perfekt sechseckig. Größere Kristalle zeigen Struktur,
   entfernte Teilchen bleiben klein und weich. */
function makeSnowCrystalSprite(variant = 0) {
  const surface = document.createElement('canvas');
  surface.width = 96;
  surface.height = 96;
  const g = surface.getContext('2d');
  if (!g) return surface;
  const c = 48;
  const halo = g.createRadialGradient(c,c,1,c,c,38);
  halo.addColorStop(0,'rgba(242,251,255,.35)');
  halo.addColorStop(.42,'rgba(210,236,255,.11)');
  halo.addColorStop(1,'rgba(230,248,255,0)');
  g.fillStyle = halo;
  g.fillRect(0,0,96,96);
  g.save();
  g.translate(c,c);
  g.rotate(variant * Math.PI/10);
  g.lineCap = 'round';
  // Kleine Asymmetrie verhindert die Wirkung eines immer gleichen Symbols.
  for (let a=0; a<6; a++) {
    g.save(); g.rotate(a*Math.PI/3);
    const len = (variant===1 ? 30 : variant===2 ? 25 : 28) * (a===4 ? .92 : 1);
    const edge = g.createLinearGradient(0,0,0,-len);
    edge.addColorStop(0,'rgba(255,255,255,.94)');
    edge.addColorStop(.6,'rgba(231,247,255,.83)');
    edge.addColorStop(1,'rgba(205,232,255,.3)');
    g.strokeStyle = edge; g.lineWidth=2.3;
    g.beginPath();g.moveTo(0,0);g.lineTo(0,-len);g.stroke();
    const branches = variant===1 ? [12,21] : [10,18,24];
    for (const b of branches) {
      if (b>len-2) continue;
      const arm=variant===2 ? 6 : 5.5;
      g.lineWidth=1.5;
      g.beginPath();g.moveTo(0,-b);g.lineTo(-arm,-b-arm*1.05);
      g.moveTo(0,-b);g.lineTo(arm,-b-arm*1.05);g.stroke();
    }
    g.restore();
  }
  g.fillStyle='rgba(255,255,255,.96)';
  g.beginPath();g.arc(0,0,3.4,0,Math.PI*2);g.fill();
  g.restore();
  return surface;
}
const SNOW_CRYSTALS = [0,1,2].map(makeSnowCrystalSprite);

function makePrecip(canvas) {
  const ctx = canvas.getContext('2d', { alpha:true });
  let drops = [];
  let kind = 'none';
  let amount = 0;
  let motionReduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const layer = {
    canvas,
    w: 0,
    h: 0,
    setup(fx) {
      const nextKind = fx.snow > 0 ? 'snow' : fx.rain > 0 ? 'rain' : 'none';
      const nextAmount = nextKind === 'snow' ? fx.snow : fx.rain;
      const changed = nextKind !== kind || Math.abs(nextAmount - amount) > .08;
      kind = nextKind;
      amount = nextAmount;
      this.resize();
      if (!changed && drops.length && kind !== 'none') return;
      if (kind === 'none') { drops = []; ctx.clearRect(0, 0, this.w, this.h); return; }
      const areaScale = Math.max(.68, Math.min(1.55, Math.sqrt((this.w * this.h) / 195000)));
      const count = Math.round((kind === 'snow' ? 19 + amount * 47 : 26 + amount * 108) * areaScale);
      drops = Array.from({length:count}, () => this.spawn(true));
    },
    resize() {
      const r = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(r.width));
      const h = Math.max(1, Math.round(r.height));
      const dpr = Math.min(1.8, window.devicePixelRatio || 1);
      if (this.w === w && this.h === h && this.dpr === dpr) return;
      this.w = w;
      this.h = h;
      this.dpr = dpr;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    },
    spawn(anywhere = false) {
      // z beschreibt die Entfernung. Größere Tropfen bewegen sich optisch
      // schneller, kleine Tropfen bleiben zart im Hintergrund.
      const roll = Math.random();
      const depth = roll < .25 ? 0 : roll < .78 ? 1 : 2;
      const jitter = .72 + Math.random() * .58;
      const snow = kind === 'snow';
      const size = snow ? [1.3, 3.1, 6.3][depth] * jitter : [1.25, 2.85, 5.35][depth] * jitter;
      const speed = snow ? [17, 32, 52][depth] * jitter : [115, 195, 315][depth] * jitter;
      return {
        x: Math.random() * (this.w + 32) - 16,
        y: anywhere ? Math.random() * this.h : -(12 + Math.random() * 42),
        w: size, h: snow ? size : size * (2.1 + Math.random() * .65),
        speed,
        phase: Math.random() * Math.PI * 2,
        depth,
        opacity: snow ? [.13, .54, .83][depth] : [.32, .55, .84][depth],
        sprite: Math.floor(Math.random()*SNOW_CRYSTALS.length),
        rotation: Math.random()*Math.PI*2,
        spin: (Math.random()-.5)*.6,
        shimmer: .6 + Math.random()*.4,
        drift: (Math.random() - .5) * (snow ? 18 : 23)
      };
    },
    active() {
      return kind !== 'none' && canvas.offsetParent !== null && this.w > 3 && this.h > 3;
    },
    frame(dt, elapsed) {
      const {w, h} = this;
      ctx.clearRect(0, 0, w, h);
      const isNight = canvas.parentElement?.classList.contains('night');
      if (kind === 'rain') {
        for (const d of drops) {
          // Jede Ebene hat eine eigene Lichtdurchlässigkeit. Dezente
          // Highlights ersetzen die früheren auffälligen weißen Striche.
          const twinkle = .94 + .06 * Math.sin(elapsed * 1.3 + d.phase);
          ctx.globalAlpha = d.opacity * (isNight ? 1.12 : .92) * twinkle;
          const drift = d.speed * .055 + d.drift;
          ctx.drawImage(WATER_DROP_SPRITE,
            d.x - d.w * .5, d.y - d.h * .48, d.w, d.h);
          d.y += d.speed * dt;
          d.x -= drift * dt;
          if (d.y > h + 20 || d.x < -24) Object.assign(d, this.spawn(false));
        }
      } else if (kind === 'snow') {
        for (const d of drops) {
          const glow = (Math.sin(elapsed * .78 + d.phase * 4) + 1) * .5;
          // Schimmer nur bei einzelnen Flocken, kein stroboskopisches Blinken.
          const glint = d.depth === 2 ? (1 + glow * .13 * d.shimmer) : 1;
          ctx.globalAlpha = Math.min(.95, d.opacity * (isNight ? .91 : .82) * glint);
          ctx.save();
          ctx.translate(d.x,d.y);
          // Alle Schneepartikel haben eine Kristallform. Im Hintergrund
          // transparent und klein, im Vordergrund detailreich mit Schimmer.
          // Keine deckenden weißen Kreise mehr über dem Himmel.
          ctx.rotate(d.rotation);
          const size=d.w*(d.depth === 0 ? 5.5 : d.depth === 2 ? 3.5 : 2.8);
          const crystal=SNOW_CRYSTALS[d.sprite];
          ctx.drawImage(crystal,-size/2,-size/2,size,size);
          ctx.restore();
          if (d.depth === 2 && glow > .93 && d.shimmer > .87) {
            ctx.globalAlpha = d.opacity * (glow-.93) * 1.3;
            ctx.fillStyle = '#ffffff';
            ctx.beginPath(); ctx.arc(d.x,d.y,.9,0,Math.PI*2); ctx.fill();
          }
          d.y += d.speed * dt;
          d.phase += dt * (1.0 + d.depth*.15);
          d.rotation += d.spin*dt;
          d.x += (d.drift + Math.sin(d.phase) * 11) * dt;
          if (d.y > h + 18 || d.x < -28 || d.x > w + 28) Object.assign(d, this.spawn(false));
        }
      }
      ctx.globalAlpha = 1;
    }
  };
  return layer;
}

let lastPrecipTime = 0;
let lastPrecipPaint = 0;
function startPrecip() {
  if (precipAnim) return;
  lastPrecipTime = 0;
  lastPrecipPaint = 0;
  const loop = (time) => {
    precipAnim = null;
    if (document.hidden) return;
    const live = precipLayers.filter(p => p.active());
    if (!live.length) {
      precipLayers.forEach(p => {
        const ctx = p.canvas.getContext('2d');
        ctx.clearRect(0, 0, p.w, p.h);
      });
      return;
    }
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Maximal 30 Bilder/Sekunde, schont Akku und hält Regenbewegung ruhig.
    if (!lastPrecipTime) lastPrecipTime = time;
    if (!lastPrecipPaint || time - lastPrecipPaint >= 32 || reduced) {
      const dt = reduced ? 0 : Math.min(.065, (time - lastPrecipTime) / 1000);
      lastPrecipTime = time;
      lastPrecipPaint = time;
      live.forEach(p => p.frame(dt, time / 1000));
      if (reduced) return;
    }
    precipAnim = requestAnimationFrame(loop);
  };
  precipAnim = requestAnimationFrame(loop);
}

function setSkyDayOffset(next) {
  const clamped = Math.max(0, Math.min(SKY_MAX_FUTURE_DAYS, next));
  if (clamped === skyDayOffset) return;
  skyDayOffset = clamped;
  if (activePlanetInfoKey === 'sun' || activePlanetInfoKey === 'moon') hidePlanetInfo();
  moonPassCache = null;
  skySwipeJustHappened = true;
  setTimeout(() => { skySwipeJustHappened = false; }, 350);
  applyWeatherForView();
}

function resetSkyDayOffset(render = true) {
  skyDayOffset = 0;
  moonPassCache = null;
  weatherNow = previewWeather() ? { ...previewWeather(), fx: describeWeather(previewWeather().code, previewWeather().cloud, previewWeather().temp) } : weatherCurrent;
  if (render) applyWeatherFx();
}

function initSkySwipe() {
  const hero = document.querySelector('.hero');
  if (!hero || hero.dataset.swipeReady) return;
  hero.dataset.swipeReady = '1';
  hero.addEventListener('touchstart', e => {
    if (e.touches.length !== 1 || e.target.closest('#menuBtn, #quickLockHomeBtn, #planetInfo, .planet-dot, .celestial-tap')) { skySwipeStart = null; return; }
    const t = e.touches[0];
    skySwipeStart = { x: t.clientX, y: t.clientY };
  }, { passive: true });
  hero.addEventListener('touchend', e => {
    if (!skySwipeStart || !e.changedTouches.length) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - skySwipeStart.x;
    const dy = t.clientY - skySwipeStart.y;
    skySwipeStart = null;
    if (Math.abs(dx) < 52 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
    if (dx < 0) setSkyDayOffset(skyDayOffset + 1);
    else setSkyDayOffset(skyDayOffset - 1);
  }, { passive: true });
}

function initSkyExtras() {
  const hero = document.querySelector('.hero');
  initSkySwipe();
  initPlanetInfoDrag();
  if (els.sunTap && !els.sunTap.dataset.infoReady) { els.sunTap.dataset.infoReady = '1'; els.sunTap.addEventListener('click', () => { if (!skySwipeJustHappened) toggleCelestialInfo('sun', els.sunTap); }); }
  if (els.moonTap && !els.moonTap.dataset.infoReady) { els.moonTap.dataset.infoReady = '1'; els.moonTap.addEventListener('click', () => { if (!skySwipeJustHappened) toggleCelestialInfo('moon', els.moonTap); }); }
  if (hero && 'ResizeObserver' in window) new ResizeObserver(() => { placeSun(); placeMoon(); placePlanets(); fitGreeting(); }).observe(hero);
  if (document.fonts) { document.fonts.ready.then(fitGreeting); document.fonts.addEventListener?.('loadingdone', fitGreeting); }
  document.querySelectorAll('.weather-layer canvas').forEach(c => precipLayers.push(makePrecip(c)));
  window.addEventListener('resize', () => { precipLayers.forEach(p => p.resize()); placeSun(); placeMoon(); placePlanets(); });
  applyPlaceGeo();
  refreshWeather();
  setInterval(() => { if (!document.hidden) refreshWeather(); }, 10 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { refreshWeather(); startPrecip(); placeSun(); placeMoon(); placePlanets(); } });
}

/* ---------- Ort einstellen ---------- */
function openPlaceSheet() {
  const p = getPlace();
  $('placeCurrent').textContent = p ? `Jetzt: ${p.name}` : 'Noch kein Ort festgelegt.';
  $('placeInput').value = '';
  $('placeResults').innerHTML = '';
  $('placeHint').textContent = '';
  openSheet($('placeSheet'));
  setTimeout(() => $('placeInput').focus(), 100);
}

async function searchPlace() {
  const q = $('placeInput').value.trim();
  if (q.length < 2) return;
  $('placeHint').textContent = 'Suche …';
  $('placeResults').innerHTML = '';
  try {
    const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=de&format=json`);
    const data = await res.json();
    const list = data.results || [];
    $('placeHint').textContent = list.length ? '' : 'Nichts gefunden. Versuch einen anderen Namen.';
    $('placeResults').innerHTML = list.map((r, i) => {
      const sub = [r.admin1, r.country].filter(Boolean).join(', ');
      return `<button type="button" class="sheet-item place-item" data-i="${i}"><strong>${escapeHtml(r.name)}</strong><small>${escapeHtml(sub)}</small></button>`;
    }).join('');
    $('placeResults').querySelectorAll('.place-item').forEach(btn => btn.addEventListener('click', () => {
      const r = list[Number(btn.dataset.i)];
      choosePlace({ name: r.name, lat: r.latitude, lon: r.longitude, tz: r.timezone });
    }));
  } catch {
    $('placeHint').textContent = 'Die Suche braucht Internet. Versuch es gleich nochmal.';
  }
}

function useMyLocation() {
  if (!navigator.geolocation) { $('placeHint').textContent = 'Dein Browser kann den Standort nicht abfragen.'; return; }
  $('placeHint').textContent = 'Standort wird abgefragt …';
  suppressLock = true;
  navigator.geolocation.getCurrentPosition(pos => {
    suppressLock = false;
    choosePlace({ name: 'Mein Standort', lat: +pos.coords.latitude.toFixed(3), lon: +pos.coords.longitude.toFixed(3) });
  }, () => {
    suppressLock = false;
    $('placeHint').textContent = 'Der Standort ist nicht erlaubt. Gib stattdessen deine Stadt ein.';
  }, { timeout: 15000, maximumAge: 3600000 });
}

function choosePlace(p) {
  setPlace(p);
  closeSheet($('placeSheet'));
  showToast(p ? `Ort: ${p.name}` : 'Wetter ausgeschaltet');
  weatherNow = null;
  refreshWeather(true);
  applySky(true);
}

/* =====================================================================
   Mond: echte Mondphase des Tages
   ===================================================================== */

const SYNODIC = 29.530588853;
const KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);
const FULL_MOON_NAMES = ['Wolfsmond', 'Schneemond', 'Lenzmond', 'Ostermond', 'Wonnemond', 'Brachmond', 'Heumond', 'Erntemond', 'Herbstmond', 'Weinmond', 'Nebelmond', 'Julmond'];

function moonAge(date) {
  const days = (date.getTime() - KNOWN_NEW_MOON) / 86400000;
  return ((days % SYNODIC) + SYNODIC) % SYNODIC;
}

function moonPhaseName(age) {
  if (age < 1.0 || age > SYNODIC - 1.0) return 'Neumond';
  if (age < 6.4) return 'Zunehmende Mondsichel';
  if (age < 8.4) return 'Zunehmender Halbmond';
  if (age < 13.8) return 'Zunehmender Mond';
  if (age < 15.8) return 'Vollmond';
  if (age < 21.1) return 'Abnehmender Mond';
  if (age < 23.1) return 'Abnehmender Halbmond';
  return 'Abnehmende Mondsichel';
}

function moonLineText(date) {
  const age = moonAge(date);
  const name = moonPhaseName(age);
  if (name === 'Vollmond') return `Heute ist Vollmond, der ${FULL_MOON_NAMES[date.getMonth()]}.`;
  const half = SYNODIC / 2;
  const toFull = Math.round(((half - age) % SYNODIC + SYNODIC) % SYNODIC);
  if (toFull <= 1) return `${name}, morgen ist Vollmond.`;
  return `${name}, Vollmond in ${toFull} Tagen.`;
}

let moonUid = 0;
// Realistischer Mond: Oberfläche mit Meeren (Maria), Kratern, Randabdunklung,
// weichem Schattenrand, Erdschein auf der dunklen Seite und Leuchten der hellen Seite.
function moonSvg(date) {
  const age = moonAge(date);
  const f = age / SYNODIC;
  const c = Math.cos(2 * Math.PI * f);
  const k = moonIllumination(age);
  const R = 96, C = 100;
  const rx = Math.max(2.5, Math.abs(c) * R);
  const waxing = f < 0.5;
  const top = `${C} ${C - R}`, bottom = `${C} ${C + R}`;
  let d;
  if (k < 0.015) d = '';
  else if (k > 0.985) d = `M${top} A${R} ${R} 0 1 1 ${bottom} A${R} ${R} 0 1 1 ${top}Z`;
  else if (waxing) d = `M${top} A${R} ${R} 0 0 1 ${bottom} A${rx.toFixed(2)} ${R} 0 0 ${k < 0.5 ? 0 : 1} ${top}Z`;
  else d = `M${top} A${R} ${R} 0 0 0 ${bottom} A${rx.toFixed(2)} ${R} 0 0 ${k < 0.5 ? 1 : 0} ${top}Z`;
  const id = `m${++moonUid}`;
  const glow = (0.42 + 0.58 * k).toFixed(2);
  const maria = `
    <ellipse cx="78" cy="84" rx="21" ry="17" fill="var(--moon-maria)" opacity=".30"/>
    <ellipse cx="122" cy="74" rx="16" ry="13" fill="var(--moon-maria)" opacity=".24"/>
    <ellipse cx="130" cy="118" rx="18" ry="15" fill="var(--moon-maria)" opacity=".20"/>
    <ellipse cx="88" cy="126" rx="14" ry="11" fill="var(--moon-maria)" opacity=".18"/>
    <circle cx="63" cy="62" r="5.5" fill="var(--moon-crater)" opacity=".22"/>
    <circle cx="110" cy="98" r="4.8" fill="var(--moon-crater)" opacity=".20"/>
    <circle cx="140" cy="56" r="6" fill="var(--moon-crater)" opacity=".18"/>
    <circle cx="146" cy="138" r="5" fill="var(--moon-crater)" opacity=".18"/>
  `;

  return `<svg viewBox="0 0 200 200" role="img" aria-label="${moonPhaseName(age)}" style="--k:${glow}">
    <defs>
      <clipPath id="${id}c"><circle cx="${C}" cy="${C}" r="${R}"/></clipPath>
      <filter id="${id}g" x="-90%" y="-90%" width="280%" height="280%"><feGaussianBlur stdDeviation="10"/></filter>
      <filter id="${id}h" x="-140%" y="-140%" width="380%" height="380%"><feGaussianBlur stdDeviation="24"/></filter>
      <filter id="${id}s" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.2"/></filter>
      <radialGradient id="${id}lit" cx="35%" cy="30%" r="72%">
        <stop offset="0%" stop-color="#FFFFFF"/>
        <stop offset="28%" stop-color="var(--moon-lit-2)"/>
        <stop offset="78%" stop-color="var(--moon-lit)"/>
        <stop offset="100%" stop-color="var(--moon-maria)"/>
      </radialGradient>
      <radialGradient id="${id}base" cx="34%" cy="28%" r="80%">
        <stop offset="0%" stop-color="color-mix(in srgb, var(--moon-dark) 70%, white)" stop-opacity=".55"/>
        <stop offset="55%" stop-color="var(--moon-dark)"/>
        <stop offset="100%" stop-color="color-mix(in srgb, var(--moon-dark) 88%, black)"/>
      </radialGradient>
      <mask id="${id}m"><path d="${d || 'M0 0'}" fill="#fff" filter="url(#${id}s)"/></mask>
    </defs>
    ${d ? `<path class="moon-glow wide" d="${d}" fill="var(--moon-lit)" filter="url(#${id}h)"/><path class="moon-glow" d="${d}" fill="var(--moon-lit)" filter="url(#${id}g)"/>` : ''}
    <circle cx="${C}" cy="${C}" r="${R}" fill="url(#${id}base)"/>
    <circle cx="${C}" cy="${C}" r="${R - 1.5}" fill="var(--moon-lit)" opacity="calc(var(--earthshine) * .85)"/>
    ${d ? `<path d="${d}" fill="url(#${id}lit)"/>` : ''}
    <g clip-path="url(#${id}c)" ${d ? `mask="url(#${id}m)"` : ''}>${maria}</g>
    <circle cx="${C}" cy="${C}" r="${R - 1.5}" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="1.5"/>
  </svg>`;
}

/* =====================================================================
   Begrüßung und Spruch des Tages
   ===================================================================== */

const DAILY_QUOTES = [
  'Jeder Gedanke, den du aufschreibst, muss nicht mehr im Kopf wohnen.',
  'Auch der Mond ist nicht jeden Tag voll – und trotzdem immer ganz.',
  'Ein Satz am Tag ist am Ende ein ganzes Buch.',
  'Du musst heute nicht alles schaffen. Nur das Nächste.',
  'Was du sagst, darf erst mal unfertig sein.',
  'Langsam ist auch eine Geschwindigkeit.',
  'Die besten Ideen kommen oft, wenn du gerade nicht suchst.',
  'Heute ist ein guter Tag, um freundlich zu dir selbst zu sein.',
  'Geschichten beginnen oft mit einer Frage, nicht mit einer Antwort.',
  'Pausen gehören zur Melodie.',
  'Du hast schon schwierigere Tage gemeistert als diesen.',
  'Schreib es auf, bevor es verfliegt.',
  'Kleine Schritte hinterlassen auch Spuren.',
  'Nicht jeder Tag muss perfekt sein, um gut zu sein.',
  'Was dich heute beschäftigt, darf hier landen.',
  'Mut ist manchmal nur ein leiser Satz: Ich versuch’s.',
  'Jede Figur, die du erschaffst, trägt ein Stück von dir.',
  'Der Mond braucht keine Erlaubnis, um zu leuchten.',
  'Ordnung im Kopf beginnt mit einer leeren Seite.',
  'Du darfst Pläne ändern, ohne aufzugeben.',
  'Heute zählt, was du tust, nicht wie perfekt es ist.',
  'Ein ruhiger Moment ist auch ein Fortschritt.',
  'Neugier ist der Anfang jeder guten Geschichte.',
  'Hör auf deine Gedanken. Sie haben dir etwas zu sagen.',
  'Auch Umwege zeigen dir Neues.',
  'Freu dich über das, was heute schon gelungen ist.',
  'Du bist nicht zu spät. Du bist auf deinem Weg.',
  'Manchmal reicht ein einziges Wort, um weiterzumachen.',
  'Was du liebst, darf Zeit bekommen.',
  'Ein freundlicher Gedanke kann einen ganzen Tag drehen.',
  'Lass heute etwas Kleines schön werden.',
  'Zweifel sind normal. Weitermachen auch.',
  'Jede Seite war einmal leer.',
  'Die Nacht macht Platz für neue Ideen.',
  'Gönn dir heute einen Moment nur für dich.',
  'Du musst nicht laut sein, um gehört zu werden.',
  'Ideen wachsen, wenn man sie aufschreibt.',
  'Auch ein halber Mond ist wunderschön.',
  'Heute darfst du stolz auf dich sein. Einfach so.',
  'Erzähl mir, was dich bewegt.',
  'Schritt für Schritt wird aus einer Idee ein Weg.',
  'Was heute schwer ist, lässt sich morgen leichter erzählen.',
  'Dein Tempo ist das richtige Tempo.',
  'Auch Pausen schreiben an deiner Geschichte mit.',
  'Vertrau dem ersten Entwurf. Verbessern kannst du später.',
  'Ein Lächeln kostet nichts und schenkt viel.',
  'Manchmal ist der beste Plan: tief durchatmen.',
  'Dein Kopf ist ein Garten. Pflanz heute etwas Schönes.',
  'Was du anfängst, darf wachsen.',
  'Du bist mehr als deine To-do-Liste.',
  'Heute ist eine neue Seite.',
  'Auch Sterne brauchen Dunkelheit, um zu leuchten.',
  'Erlaub dir, Neues auszuprobieren.',
  'Jede gute Geschichte hat Wendepunkte.',
  'Mach heute eine Sache, auf die du dich freust.',
  'Stille ist kein Stillstand.',
  'Gedanken ordnen sich, wenn man ihnen Platz gibt.',
  'Du hast etwas zu erzählen.',
  'Ein guter Tag beginnt mit einem guten Gedanken.',
  'Fehler sind Notizen fürs nächste Mal.',
  'Behalte, was dir guttut. Lass los, was dich bremst.',
  'Ein Kapitel nach dem anderen.',
  'Wer träumt, baut schon an morgen.',
  'Heute reicht es, da zu sein.',
  'Deine Ideen sind es wert, festgehalten zu werden.',
  'Der Mond wächst auch nicht an einem Tag.',
  'Sei heute deine eigene beste Freundin.',
  'Wenn du nicht weiterweißt: Schreib die Frage auf.',
  'Kleine Freuden zählen doppelt.',
  'Man muss nicht alles verstehen, um anzufangen.',
  'Was du heute säst, wächst später.',
  'Einatmen. Ausatmen. Weiter geht’s.',
  'Jede Erinnerung ist ein kleiner Schatz.',
  'Lass deine Fantasie heute frei laufen.',
  'Gute Dinge brauchen Zeit und ein bisschen Geduld.',
  'Du darfst Nein sagen, um Ja zu dir zu sagen.',
  'Ein offener Gedanke ist wie ein offenes Fenster.',
  'Jede Welt beginnt mit einem einzigen Ort.',
  'Was du heute schaffst, ist genug.',
  'Licht findet immer einen Weg.',
  'Das Leben schreibt mit. Lass es zu.',
  'Müde sein heißt auch: Du hast viel gegeben.',
  'Schreib so, wie du sprichst. Ehrlich.',
  'Was dir wichtig ist, verdient deine Zeit.',
  'Heute darf leicht sein.',
  'Zwischen zwei Gedanken liegt oft die beste Idee.',
  'Hoffnung ist ein Licht, das man mitnehmen kann.',
  'Du bist die Heldin deiner eigenen Geschichte.',
  'Der erste Satz ist der mutigste.',
  'Manchmal ist weniger einfach mehr.',
  'Morgen ist auch noch ein Tag, und heute ist schön genug.',
  'Deine Stimme zählt.',
  'Ein Tag ohne Eile ist ein Geschenk.',
  'Halte fest, was dich heute berührt hat.',
  'Jedes Ende ist auch ein Anfang.',
  'Frag dich heute: Was macht mir Freude?',
  'Die Welt braucht deine Geschichten.',
  'Der Mond zeigt jeden Monat: Veränderung ist ganz normal.',
  'Vertrau dem Weg, auch wenn du noch nicht alles siehst.',
  'Ruhe ist der Boden, auf dem Neues wächst.'
];

function dayNumber(date) {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
}

function quoteOfDay(date) {
  // 37 und 100 sind teilerfremd: jeder Spruch kommt dran, bevor sich einer wiederholt
  return DAILY_QUOTES[(dayNumber(date) * 37) % DAILY_QUOTES.length];
}

function userName() {
  const n = state?.settings?.name;
  return (typeof n === 'string' && n.trim()) ? n.trim() : DEFAULT_NAME;
}

// Begrüßung immer in einer Zeile: notfalls etwas kleiner
function fitGreeting() {
  const el = els.greeting;
  if (!el || !el.clientWidth) return;
  let size = 24;
  el.style.fontSize = size + 'px';
  while (el.scrollWidth > el.clientWidth && size > 17) { size -= 0.5; el.style.fontSize = size + 'px'; }
}

function renderLockMoon(date = nowForSky()) {
  if (!els.lockMoon) return;
  const st = moonState(instantOfSky(date));
  const phase = document.documentElement.dataset.phase || 'nacht';
  const night = ['nacht', 'abend', 'abenddaemmerung', 'daemmerung'].includes(phase);

  // Exakt dieselbe Mondscheibe wie auf der Startseite, nur größer im Anmeldebereich.
  els.lockMoon.style.setProperty('--moon-earthshine', night ? '.1' : '.04');
  els.lockMoon.style.setProperty('--moon-wash', night ? '0' : '.28');
  els.lockMoon.style.setProperty('--moon-shadow', night ? 'color-mix(in srgb, var(--sky-mid) 88%, black)' : 'transparent');
  els.lockMoon.style.setProperty('--moon-halo', night ? '#F3EAD3' : '#FFFFFF');
  els.lockMoon.style.transform = 'scale(1.45)';
  els.lockMoon.style.transformOrigin = 'center';
  els.lockMoon.innerHTML = moonDiscSvg(st, MOON_STYLE);
}

function renderDailyBits(date = nowForSky(), phase = document.documentElement.dataset.phase || 'nacht') {
  renderLockMoon(date);
  els.heroMoon.innerHTML = moonSvg(new Date());
  els.greeting.textContent = `${GREETING[phase] || 'Hallo'}, ${userName()}`;
  requestAnimationFrame(fitGreeting);
  els.dailyQuote.textContent = quoteOfDay(new Date());
  const line = moonLineText(new Date());
  els.moonLine.textContent = line;
  els.lockPhase.textContent = `${PHASE_LABEL[phase] || ''}\n${line}`;
}

/* =====================================================================
   V3.8.4 · Echter Sternenhimmel über deinem Ort
   Etwa 251 der hellsten Sterne (Rektaszension, Deklination, Helligkeit, Farbe)
   und die Linien der bekannten Sternbilder. Aus der aktuellen Uhrzeit und dem Ort
   wird berechnet, wie der Himmel jetzt zum Pol hin gedreht ist. Danach dreht er sich
   zur Show schneller als in Wirklichkeit.
   ===================================================================== */
const SKY_STAR_DATA = '37.95,89.27,2,0.6;263.05,86.58,4.36,0.1;251.70,82.03,4.2,0.1;236.02,77.80,4.3,0;244.38,75.75,4.95,0.3;230.18,71.83,3.05,0;222.68,74.15,2.08,1.47;165.93,61.75,1.79,1.06;165.45,56.38,2.37,0;178.45,53.68,2.44,0;183.85,57.03,3.31,0.08;193.50,55.97,1.77,-0.02;200.97,54.93,2.27,0.02;206.88,49.32,1.86,-0.1;127.58,60.72,3.36,0.85;134.80,48.03,3.14,0.2;154.28,42.92,3.45,0;155.57,41.50,3.05,1.6;167.43,44.50,3,1.4;169.62,33.10,3.5,1.4;169.55,31.53,3.8,0.6;143.22,51.68,3.17,0.4;135.90,47.15,3.6,0;10.12,56.53,2.24,1.17;2.30,59.15,2.27,0.38;14.18,60.72,2.47,-0.15;21.45,60.23,2.68,0.13;28.60,63.67,3.37,-0.15;319.65,62.58,2.45,0.22;322.17,70.55,3.23,-0.2;354.83,77.63,3.2,1.03;332.73,58.20,3.35,1.5;342.43,66.20,3.5,1.3;269.15,51.48,2.23,1.52;262.60,52.30,2.79,1.17;268.38,56.87,3.75,1.2;263.05,55.18,4.9,0.1;288.23,67.65,3.07,0.9;257.20,65.72,3.17,-0.1;245.97,61.52,2.74,0.9;240.47,58.57,4,0.3;211.10,64.38,3.65,-0.05;231.22,58.97,3.3,1.5;188.38,69.78,3.87,0;172.85,69.33,3.84,1.7;213.93,19.18,-0.05,1.23;221.25,27.07,2.7,0.97;218.03,38.30,3.03,0.19;225.47,40.38,3.5,0.96;217.95,30.37,3.6,0;208.68,18.40,2.68,0.58;228.88,33.32,3.5,0.95;233.68,26.72,2.23,0.03;231.95,29.10,3.68,0.3;233.22,31.35,4.1,-0.1;235.67,26.30,3.84,0;237.40,26.07,4.6,0.1;239.40,26.88,4.15,1;258.65,14.38,3.06,1.16;247.55,21.48,2.77,0.94;250.32,31.60,2.8,0.65;250.72,38.92,3.5,0.9;258.75,36.82,3.16,1.4;255.07,30.93,3.9,0;258.75,24.83,3.1,0;266.62,27.72,3.42,0.75;245.47,19.15,3.75,0.3;279.22,38.78,0.03,0;281.07,39.67,4.7,0.1;281.20,37.60,4.3,0.1;282.53,33.37,3.5,0;284.72,32.68,3.25,-0.05;283.62,36.90,4.2,1.7;310.35,45.28,1.25,0.09;305.55,40.25,2.2,0.67;292.68,27.97,3.18,1.1;311.55,33.97,2.46,1.03;296.25,45.13,2.87,-0;318.23,30.22,3.2,1;316.23,43.93,3.7,1.7;297.70,8.87,0.77,0.22;296.58,10.62,2.72,1.5;298.82,6.40,3.7,0.85;291.38,3.12,3.36,0.3;286.35,13.87,2.99,0;302.80,-0.82,3.2,-0.07;346.20,15.20,2.49,-0;345.95,28.08,2.42,1.67;3.30,15.18,2.83,-0.2;326.05,9.87,2.39,1.5;340.38,10.83,3.4,-0.1;340.75,30.22,2.94,0.9;332.55,6.20,3.5,0.1;2.10,29.08,2.06,-0.1;17.43,35.62,2.05,1.58;30.97,42.33,2.1,1.4;9.82,30.87,3.27,1.3;51.08,49.87,1.79,0.48;47.05,40.95,2.1,-0.05;46.20,53.50,2.9,0.7;55.65,47.78,3,-0.1;59.47,40.02,2.9,-0.1;58.53,31.88,2.85,-0.1;59.72,35.78,4,0;42.68,55.90,3.76,2;32.38,34.98,3,0.1;28.27,29.58,3.4,0.5;34.32,33.85,4,0;31.80,23.45,2,1.15;28.65,20.80,2.64,0.13;42.50,27.27,3.6,-0.1;79.17,46.00,0.08,0.8;89.88,44.95,1.9,0.03;89.92,37.22,2.6,-0.1;74.25,33.17,2.7,1.5;68.98,16.52,0.85,1.54;81.58,28.60,1.65,-0.13;84.40,21.15,3,-0.2;64.95,15.63,3.65,1;65.73,17.55,3.8,1;67.15,19.18,3.5,1;67.17,15.87,3.4,0.2;60.17,12.48,3.5,-0.1;56.75,24.12,2.87,-0.09;116.33,28.03,1.14,1;113.65,31.88,1.58,0.03;99.43,16.40,1.9,0;95.73,22.50,2.9,1.6;93.72,22.52,3.3,1.6;100.97,25.13,3,1.4;101.33,12.88,3.4,0.4;110.03,21.98,3.5,0.3;116.10,24.40,3.57,0.9;124.12,9.18,3.5,1.5;152.10,11.97,1.35,-0.11;177.28,14.57,2.14,0.09;155.00,19.83,2,1.15;168.52,20.52,2.56,0.13;168.55,15.43,3.3,-0;154.17,23.42,3.4,0.3;148.20,26.00,3.9,1;146.48,23.77,3,0.8;151.82,16.75,3.5,-0;201.30,-11.17,0.97,-0.23;195.55,10.95,2.8,0.9;190.43,-1.45,2.7,0.36;193.90,3.40,3.4,1.5;177.68,1.77,3.6,0.5;184.97,-0.67,3.9,0.1;229.25,-9.38,2.6,-0.1;222.72,-16.03,2.75,0.15;247.35,-26.43,1.06,1.85;240.07,-22.62,2.3,-0.12;241.35,-19.80,2.6,-0.07;239.73,-26.12,2.9,-0.2;245.30,-25.60,2.9,0.1;248.97,-28.22,2.8,-0.2;252.55,-34.30,2.3,1.15;263.40,-37.10,1.62,-0.2;264.32,-42.98,1.87,0.4;265.62,-39.03,2.4,-0.2;263.73,12.57,2.07,0.15;257.60,-15.72,2.4,0.06;265.88,4.57,2.77,1.17;243.57,-3.68,2.7,1.6;244.57,-4.68,3.2,1;249.30,-10.57,2.56,0;254.42,9.37,3.2,1.2;247.73,1.98,3.8,0;276.05,-34.38,1.85,-0.03;283.82,-26.30,2.05,-0.1;285.65,-29.87,2.6,0.1;275.25,-29.83,2.7,1.4;276.98,-25.42,2.8,1;271.45,-30.42,3,1;281.43,-26.98,3.2,-0.1;286.72,-27.67,3.3,1;326.75,-16.13,2.85,0.3;305.25,-14.78,3.05,0.8;304.52,-12.55,3.6,0.9;311.50,-25.27,4.1,0.5;312.95,-26.92,4.1,1.5;321.68,-22.42,3.7,0.9;325.02,-16.67,3.7,0.3;316.72,-17.23,4.1,0;320.50,-16.83,4.3,0.7;322.90,-5.57,2.9,0.8;331.45,-0.32,3,0.97;343.67,-15.82,3.27,0;335.43,-1.38,3.84,0;45.57,4.08,2.5,1.6;10.90,-17.98,2,1;34.83,-2.98,3.5,1.5;40.83,3.23,3.5,0.1;88.80,7.40,0.5,1.85;78.62,-8.20,0.13,-0.03;81.27,6.35,1.64,-0.22;83.00,-0.30,2.2,-0.2;84.05,-1.20,1.7,-0.18;85.20,-1.95,1.77,-0.2;86.95,-9.67,2.06,-0.17;83.78,9.93,3.5,-0.15;72.73,6.95,3.2,0.4;72.75,5.60,3.7,-0.2;81.12,-2.40,3.35,-0.2;83.85,-5.92,2.77,-0.2;101.28,-16.72,-1.46,0;104.65,-28.97,1.5,-0.21;107.10,-26.40,1.83,0.68;95.67,-17.95,1.98,-0.24;111.02,-29.30,2.45,-0.08;114.83,5.22,0.34,0.42;111.80,8.28,2.9,-0.09;83.17,-17.82,2.58,0.2;82.05,-20.77,2.8,1.1;141.90,-8.67,2,1.44;183.95,-17.55,2.6,-0.1;187.47,-16.52,2.95,0;188.60,-23.40,2.65,0.9;182.53,-22.62,3,1.3;194.00,38.32,2.9,-0.1;188.43,41.35,4.26,0.6;197.98,27.88,4.26,0.6;197.50,17.53,4.3,0.5;186.70,28.27,4.35,1.1;140.25,34.38,3.1,1.55;337.83,50.28,3.77,0;309.38,14.60,3.6,0.4;309.90,15.92,3.77,0;311.68,16.12,4.4,0.8;310.88,15.07,4.4,0;308.30,11.30,4,0;299.70,19.50,3.5,1.6;296.85,18.53,3.8,1.4;295.02,18.02,4.4,1;295.25,17.47,4.4,0;344.43,-29.62,1.16,0.09;77.02,-5.08,2.8,0.1;236.07,6.43,2.65,1.17;237.70,4.47,3.7,0.1;233.70,10.53,3.8,0.2;236.60,15.42,3.65,0;239.12,15.67,3.85,0.5;22.88,15.35,3.6,0.96;30.50,2.77,3.8,0;349.30,3.28,3.7,0;75.85,60.43,4,0.9;73.52,66.33,4.3,0;76.62,41.23,3.2,-0.2;75.62,41.08,3.7,1;75.50,43.82,3,1'.split(';').map(s => { const a = s.split(',').map(Number); return { ra: a[0], dec: a[1], mag: a[2], bv: a[3] }; });
const SKY_LINE_DATA = '7 8 9 10 7|10 11 12 13|0 1 2 3 4 5 6 3|24 23 25 26 27|28 29 30 32 28|28 31|34 33 35 36 34|38 39 40 42 41 43 44|73 74 75|77 74 76|67 69 70 71 72 69|81 80 82|80 83|67 73 80 67|86 87 93 88 86|93 94 95|98 97 100 101 102|97 99 104|111 112 113 114 116 111|117 115 118 119 120 116|118 122|194 201 196 197 198 199 200 195 197|194 199|196 194|125 129 127 128|124 131 126|125 124|129 131|134 142 136 137 135 138 134|136 139 140 141|45 46 51 48 47 49 45|54 53 52 55 56 57|61 60 63 62 61|60 59|151 155 152 153|152 154|151 156 157 159 160 158|169 172 173 175 170 171 169|169 174 172|179 178 180 181 182 183 177|206 209|206 208 207|208 210|211 212|227 228 229 230 227|108 109 110|105 106 107 105|143 145 146 144|147 148 145|216 217 218 219 216|161 167 168 164 165 166 162|161 163'.split('|').map(s => s.split(' ').map(Number));

let starSkyKey = '';
function starSkyLST(date, lonDeg) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  return astroNorm360(280.46061837 + 360.98564736629 * (jd - 2451545.0) + lonDeg);
}
function starColor(bv) {
  // B-V → Farbe: blau-weiß, weiß, gelblich, orange
  if (bv < -.05) return [200, 218, 255];
  if (bv < .3) return [234, 240, 255];
  if (bv < .65) return [255, 247, 230];
  if (bv < 1.0) return [255, 232, 190];
  if (bv < 1.4) return [255, 211, 160];
  return [255, 190, 140];
}
function starRadius(mag) { return Math.max(.5, .62 + (4.9 - mag) * .46); }

/* Baut den Sternenhimmel für alle .stars-Flächen: ein großes Bild, das sich um den Himmelspol dreht. */
function buildStarSky(force = false) {
  const now = new Date();
  const key = `${GEO.lat.toFixed(2)},${GEO.lon.toFixed(2)},${Math.floor(now.getTime() / 1800000)}`;
  if (!force && key === starSkyKey) return;
  starSkyKey = key;
  const lst = starSkyLST(now, GEO.lon);
  const SC = 4.2;                          // Pixel pro Grad Himmel
  document.querySelectorAll('.stars').forEach(box => {
    const lock = !box.closest('.hero');
    const R = lock ? 620 : 480;
    box.style.cssText = `left:50%;top:${lock ? 34 : 24}%;width:${R * 2}px;height:${R * 2}px;margin:${-R}px 0 0 ${-R}px;`;
    box.innerHTML = '';
    const dpr = Math.min(1.4, window.devicePixelRatio || 1);
    const cv = document.createElement('canvas');
    cv.width = Math.round(R * 2 * dpr); cv.height = cv.width;
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
    const g = cv.getContext('2d');
    g.scale(dpr, dpr);
    const pos = s => {
      const H = astroRad(lst - s.ra), r = (90 - s.dec) * SC;
      return { x: R - r * Math.sin(H), y: R - r * Math.cos(H), r };
    };
    // Sternbild-Linien
    g.lineWidth = 1; g.strokeStyle = 'rgba(170,190,255,.20)'; g.lineJoin = 'round';
    for (const line of SKY_LINE_DATA) {
      g.beginPath();
      line.forEach((idx, n) => { const p = pos(SKY_STAR_DATA[idx]); n ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); });
      g.stroke();
    }
    // feine Hintergrundsterne (Dekoration, kein echter Katalog)
    let seed = lock ? 91 : 37;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < (lock ? 1900 : 1400); i++) {
      const a = rnd() * 6.2832, rr = Math.sqrt(rnd()) * R;
      g.fillStyle = `rgba(225,232,255,${(.22 + rnd() * .34).toFixed(2)})`;
      g.fillRect(R + rr * Math.cos(a), R + rr * Math.sin(a), 1, 1);
    }
    // echte Sterne: schwächere ins Bild, hellere als funkelnde Punkte
    let html = '';
    SKY_STAR_DATA.forEach((s, n) => {
      const p = pos(s);
      if (p.r > R - 6) return;
      const rad = starRadius(s.mag), c = starColor(s.bv);
      if (s.mag > 3.3) {
        g.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${Math.min(.95, .55 + (4.9 - s.mag) * .18).toFixed(2)})`;
        g.beginPath(); g.arc(p.x, p.y, rad, 0, 6.2832); g.fill();
      } else {
        const d = rad * 2;
        const glow = s.mag < 2.2 ? `box-shadow:0 0 ${(rad * 3.2).toFixed(1)}px ${(rad * .9).toFixed(1)}px rgba(${c[0]},${c[1]},${c[2]},.55);` : '';
        const dur = (2.6 + ((n * 37) % 40) / 10).toFixed(1), del = (-((n * 53) % 70) / 10).toFixed(1);
        html += `<i class="tw${s.mag < 2.2 ? ' big' : ''}" style="left:${(p.x - rad).toFixed(1)}px;top:${(p.y - rad).toFixed(1)}px;width:${d.toFixed(1)}px;height:${d.toFixed(1)}px;background:rgb(${c[0]},${c[1]},${c[2]});${glow}animation-duration:${dur}s;animation-delay:${del}s"></i>`;
      }
    });
    box.appendChild(cv);
    box.insertAdjacentHTML('beforeend', html);
  });
}
function placeStars() { buildStarSky(true); }

/* Sternschnuppen: ab und zu eine, nur wenn der Himmel dunkel genug ist */
function shootingStar() {
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const boxes = [...document.querySelectorAll('.stars')].filter(b => b.offsetParent !== null);
  const visible = boxes[0];
  const dark = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--stars')) > 0.6;
  if (visible && dark && !reduce && !document.hidden) {
    const host = visible.parentElement;
    const w = host.clientWidth, h = host.clientHeight;
    const star = document.createElement('b');
    star.className = 'shoot';
    const fromRight = Math.random() < 0.5;
    const len = 130 + Math.random() * 90;
    const dx = (fromRight ? -1 : 1) * len * 1.7, dy = len * 0.6;
    star.style.left = `${(fromRight ? 0.55 + Math.random() * 0.4 : 0.05 + Math.random() * 0.4) * w}px`;
    star.style.top = `${(0.03 + Math.random() * 0.3) * h}px`;
    star.style.setProperty('--dx', `${dx}px`);
    star.style.setProperty('--dy', `${dy}px`);
    star.style.setProperty('--rot', `${Math.atan2(dy, dx) * 180 / Math.PI}deg`);
    host.appendChild(star);
    setTimeout(() => star.remove(), 1700);
  }
  setTimeout(shootingStar, 9000 + Math.random() * 14000);
}

/* =====================================================================
   Speicher und Verschlüsselung (unverändert kompatibel)
   ===================================================================== */

function initDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const upgradeDb = request.result;
      if (!upgradeDb.objectStoreNames.contains(STORE_NAME)) upgradeDb.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => { db = request.result; resolve(db); };
    request.onerror = () => reject(request.error);
  });
}
function idbGet(key) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function idbSet(key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
function idbDelete(key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
function base64ToBytes(str) {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function sameBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function deriveKey(pin, saltBytes) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: 250000, hash: 'SHA-256' },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}
async function encryptValue(value, key = cryptoKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
  return { iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(cipher)) };
}
async function decryptValue(payload, key = cryptoKey) {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(payload.iv) }, key, base64ToBytes(payload.data));
  return JSON.parse(new TextDecoder().decode(plain));
}

function initialState() {
  return { version: APP_VERSION, createdAt: new Date().toISOString(), settings: { name: DEFAULT_NAME, customCategories: [] }, topics: [] };
}
function hasVaultConfig() {
  return Boolean(localStorage.getItem(CONFIG_SALT) && localStorage.getItem(CONFIG_VERIFIER));
}

async function setupVault(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(pin, salt);
  const verifier = await encryptValue({ ok: true, marker: 'reci-mi' }, key);
  const fresh = initialState();
  const encryptedVault = await encryptValue(fresh, key);
  localStorage.setItem(CONFIG_SALT, bytesToBase64(salt));
  localStorage.setItem(CONFIG_VERIFIER, JSON.stringify(verifier));
  localStorage.removeItem(BIOMETRIC_CONFIG);
  await idbDelete(BIOMETRIC_KEY).catch(() => {});
  await idbSet(VAULT_KEY, encryptedVault);
  cryptoKey = key;
  state = fresh;
}

async function loadVaultWithKey(key) {
  const verifier = JSON.parse(localStorage.getItem(CONFIG_VERIFIER));
  const check = await decryptValue(verifier, key);
  if (!check || check.marker !== 'reci-mi') throw new Error('Entsperren nicht möglich');
  const encryptedVault = await idbGet(VAULT_KEY);
  if (!encryptedVault) throw new Error('Keine verschlüsselten Daten gefunden');
  const decrypted = await decryptValue(encryptedVault, key);
  cryptoKey = key;
  state = decrypted;
  ensureThoughtMemory();
  if (!Array.isArray(state.topics)) state.topics = [];
  state.version = APP_VERSION;
  state.settings = { ...(state.settings || {}) };
  delete state.settings.autoLockMinutes;
  delete state.settings.lockMode;
  if (!state.settings.name) state.settings.name = DEFAULT_NAME;
  if (!Array.isArray(state.settings.customCategories)) state.settings.customCategories = [];
  state.topics.forEach(t => { if (!Array.isArray(t.checklist)) t.checklist = []; });
}

async function unlockVault(pin) {
  const key = await deriveKey(pin, base64ToBytes(localStorage.getItem(CONFIG_SALT)));
  try { await loadVaultWithKey(key); } catch { throw new Error('Falsche PIN'); }
}

async function persistState(immediate = false) {
  if (!cryptoKey || !state) return;
  if (!immediate) {
    clearTimeout(saveTimer);
    els.saveState.textContent = 'Speichert …';
    saveTimer = setTimeout(() => persistState(true).catch(() => {}), 500);
    return;
  }
  clearTimeout(saveTimer);
  const payload = await encryptValue(state);
  await idbSet(VAULT_KEY, payload);
  els.saveState.textContent = 'Gespeichert';
}

/* =====================================================================
   Sperren: erst wenn du länger als 1 Minute weg warst
   ===================================================================== */

function saveResume() {
  let resume = { screen: 'home' };
  if (els.editorScreen.classList.contains('active') && currentTopicId) {
    rememberEditorPosition();
    resume = { screen: 'editor', id: currentTopicId };
  }
  else if (els.trashScreen.classList.contains('active')) resume = { screen: 'trash' };
  else if ($('thoughtScreen').classList.contains('active')) resume = { screen: 'thought' };
  try { localStorage.setItem(LS_RESUME, JSON.stringify(resume)); } catch {}
}
function readResume() {
  try { return JSON.parse(localStorage.getItem(LS_RESUME) || 'null') || { screen: 'home' }; } catch { return { screen: 'home' }; }
}

function markAlive() {
  if (!cryptoKey) return;
  try { localStorage.setItem(LS_ALIVE_AT, String(Date.now())); } catch {}
}
function startAliveTicker() {
  clearInterval(aliveTimer);
  markAlive();
  aliveTimer = setInterval(() => { if (!document.hidden) markAlive(); }, 10000);
}

async function startSession() {
  // Schlüssel kurz merken, damit Android die App im Hintergrund schließen darf,
  // ohne dass du innerhalb einer Minute neu entsperren musst.
  try { await idbSet(SESSION_KEY, cryptoKey); } catch {}
  localStorage.removeItem(LS_LEFT_AT);
  startAliveTicker();
}

async function endSession() {
  clearInterval(aliveTimer);
  localStorage.removeItem(LS_LEFT_AT);
  localStorage.removeItem(LS_ALIVE_AT);
  await idbDelete(SESSION_KEY).catch(() => {});
}

async function tryResumeSession() {
  const leftAt = Number(localStorage.getItem(LS_LEFT_AT) || 0);
  const aliveAt = Number(localStorage.getItem(LS_ALIVE_AT) || 0);
  const last = Math.max(leftAt, aliveAt);
  const key = await idbGet(SESSION_KEY).catch(() => null);
  if (!key || !last || Date.now() - last > LOCK_AFTER_MS) {
    await endSession();
    return false;
  }
  try {
    await loadVaultWithKey(key);
    await startSession();
    showUnlocked(readResume());
    return true;
  } catch {
    await endSession();
    return false;
  }
}

let dictHiddenTimer = null;
function onHidden() {
  stopReading();
  versionCheckpoint('pause');
  closeProtectedOnHide();
  if (dictWanted) {
    // Beim Sprechen legt das Handy oft kurz sein eigenes Sprach-Fenster über die App.
    // Das zählt nicht als „weg“ – Diktat läuft weiter (Sicherheitsstopp nach 5 Minuten).
    clearTimeout(dictHiddenTimer);
    dictHiddenTimer = setTimeout(() => { if (document.hidden) stopRecognition(); }, 5 * 60 * 1000);
  }
  if (!cryptoKey) return;
  saveResume();
  if (!suppressLock && !biometricBusy && !dictWanted) {
    try { localStorage.setItem(LS_LEFT_AT, String(Date.now())); } catch {}
  }
  persistState(true).catch(() => {});
}

function onVisible() {
  clearTimeout(dictHiddenTimer);
  applySky();
  if (!cryptoKey) {
    if (els.lockScreen.classList.contains('active')) autoBiometric();
    return;
  }
  const leftAt = Number(localStorage.getItem(LS_LEFT_AT) || 0);
  localStorage.removeItem(LS_LEFT_AT);
  if (leftAt && !suppressLock && !biometricBusy && Date.now() - leftAt > LOCK_AFTER_MS) {
    lockApp('Gesperrt, weil du länger als 1 Minute weg warst.');
    autoBiometric();
    return;
  }
  markAlive();
}

function lockApp(message = '') {
  resetSkyDayOffset(true);
  versionCheckpoint('leave');
  openedProtected.clear();
  stopRecognition();
  stopReading();
  saveResume();
  if (cryptoKey && state) persistState(true).catch(() => {});
  closeAnySheet(true);
  cryptoKey = null;
  state = null;
  currentTopicId = null;
  endSession();
  showScreen(els.lockScreen);
  configureLockScreen();
  if (message) els.lockHint.textContent = message;
}

/* =====================================================================
   Fingerabdruck (WebAuthn)
   ===================================================================== */

function getBiometricConfig() {
  try { return JSON.parse(localStorage.getItem(BIOMETRIC_CONFIG) || 'null'); } catch { return null; }
}
function hasBiometricConfig() { return Boolean(getBiometricConfig()?.credentialId); }

async function platformBiometricsAvailable() {
  if (!window.PublicKeyCredential || !navigator.credentials) return false;
  if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== 'function') return true;
  try { return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); } catch { return false; }
}

function biometricErrorText(err, action) {
  const name = err?.name || 'Fehler';
  if (name === 'NotAllowedError') return `${action} wurde abgebrochen oder nicht bestätigt. Versuch es nochmal${action === 'Entsperren' ? ' oder nutze deine PIN' : ''}.`;
  if (name === 'InvalidStateError') return 'Dieser Fingerabdruck ist schon eingerichtet. Schalte ihn im Menü aus und richte ihn neu ein.';
  if (name === 'SecurityError') return 'Fingerabdruck geht nur, wenn Reci mi über https geöffnet ist.';
  if (name === 'NotSupportedError') return 'Dieses Handy oder dieser Browser unterstützt den Fingerabdruck hier nicht.';
  if (name === 'AbortError') return `${action} wurde unterbrochen. Versuch es nochmal.`;
  return `${err?.message || 'Unbekannter Fehler'} (${name})`;
}

async function enableBiometrics() {
  if (!cryptoKey || !state) return showToast('Bitte zuerst mit deiner PIN entsperren');
  if (!(await platformBiometricsAvailable())) {
    return showToast('Auf diesem Gerät ist keine Fingerabdruck-Sperre eingerichtet oder der Browser unterstützt sie nicht.', 5000);
  }
  biometricBusy = true;
  try {
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: 'Reci mi', id: location.hostname },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'Reci mi', displayName: 'Reci mi' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', requireResidentKey: false, userVerification: 'required' },
        timeout: 60000,
        attestation: 'none'
      }
    });
    if (!credential) throw new Error('Kein Fingerabdruck-Zugang erstellt');
    await idbSet(BIOMETRIC_KEY, cryptoKey);
    localStorage.setItem(BIOMETRIC_CONFIG, JSON.stringify({
      credentialId: bytesToBase64(new Uint8Array(credential.rawId)),
      createdAt: new Date().toISOString(),
      version: 2
    }));
    localStorage.setItem(LS_BIO_CARD, '1');
    updateBiometricUi();
    showToast('Fingerabdruck ist eingerichtet. Ab jetzt reicht ein Tipp auf den Mond.', 3600);
  } catch (err) {
    showToast(biometricErrorText(err, 'Das Einrichten'), 6000);
  } finally {
    biometricBusy = false;
    markAlive();
  }
}

async function disableBiometrics() {
  const yes = await askConfirm('Fingerabdruck ausschalten?', 'Danach entsperrst du Reci mi wieder mit deiner PIN.', 'Ausschalten');
  if (!yes) return;
  localStorage.removeItem(BIOMETRIC_CONFIG);
  await idbDelete(BIOMETRIC_KEY).catch(() => {});
  updateBiometricUi();
  showToast('Fingerabdruck ausgeschaltet');
}

// Fragt den Fingerabdruck ab. Wirft einen Fehler, wenn es nicht klappt.
async function biometricAssert() {
  const cfg = getBiometricConfig();
  if (!cfg?.credentialId) throw new Error('Kein Fingerabdruck eingerichtet');
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge,
      rpId: location.hostname,
      allowCredentials: [{ type: 'public-key', id: base64ToBytes(cfg.credentialId) }],
      userVerification: 'required',
      timeout: 60000
    }
  });
  if (!assertion) throw new Error('Kein Fingerabdruck erkannt');
  if (!sameBytes(base64ToBytes(cfg.credentialId), new Uint8Array(assertion.rawId))) throw new Error('Unbekannter Fingerabdruck-Zugang');
  const clientData = JSON.parse(new TextDecoder().decode(assertion.response.clientDataJSON));
  if (clientData.type !== 'webauthn.get' || clientData.challenge !== bytesToBase64Url(challenge)) throw new Error('Bestätigung passt nicht');
  const authData = new Uint8Array(assertion.response.authenticatorData);
  if (!(authData[32] & 0x04)) throw new Error('Der Fingerabdruck wurde nicht geprüft');
}

async function verifyPin(pin) {
  if (!/^\d{4,6}$/.test(pin)) return false;
  try {
    const key = await deriveKey(pin, base64ToBytes(localStorage.getItem(CONFIG_SALT)));
    const check = await decryptValue(JSON.parse(localStorage.getItem(CONFIG_VERIFIER)), key);
    return check?.marker === 'reci-mi';
  } catch { return false; }
}

async function unlockWithBiometrics({ silent = false } = {}) {
  const cfg = getBiometricConfig();
  if (!cfg?.credentialId || biometricBusy) return;
  biometricBusy = true;
  els.moonBtn.classList.add('busy');
  if (!silent) els.lockHint.textContent = '';
  try {
    await biometricAssert();
    const storedKey = await idbGet(BIOMETRIC_KEY);
    if (!storedKey) throw new Error('Fingerabdruck bitte im Menü neu einrichten');
    await loadVaultWithKey(storedKey);
    await startSession();
    showUnlocked(readResume());
  } catch (err) {
    if (!silent) els.lockHint.textContent = biometricErrorText(err, 'Entsperren');
  } finally {
    els.moonBtn.classList.remove('busy');
    biometricBusy = false;
  }
}

// Beim Öffnen gleich nach dem Finger fragen – klappt das ohne Antippen nicht, passiert einfach nichts
let lastAutoBio = 0;
function autoBiometric() {
  if (!hasBiometricConfig() || cryptoKey || biometricBusy) return;
  // nicht in Schleife fragen, wenn du das Fingerabdruck-Fenster wegdrückst
  if (Date.now() - lastAutoBio < 20000) return;
  lastAutoBio = Date.now();
  setTimeout(() => {
    if (!document.hidden && !cryptoKey && document.hasFocus()) unlockWithBiometrics({ silent: true });
  }, 350);
}

function updateBiometricUi() {
  const enabled = hasBiometricConfig();
  els.fpBadge.classList.toggle('hidden', !enabled);
  els.biometricMenuBtn.textContent = enabled ? 'Fingerabdruck ausschalten' : 'Fingerabdruck einrichten';
}

async function maybeShowBioCard() {
  const show = !hasBiometricConfig() && !localStorage.getItem(LS_BIO_CARD) && await platformBiometricsAvailable();
  els.bioCard.classList.toggle('hidden', !show);
}

/* =====================================================================
   Bildschirme und Zurück-Taste
   ===================================================================== */

function showScreen(screen) {
  [els.lockScreen, els.homeScreen, els.editorScreen, els.trashScreen, $('quickScreen'), $('thoughtScreen')].forEach(el => el.classList.toggle('active', el === screen));
  // Der Himmel braucht die echte Größe der sichtbaren Startseite. Zwei Frames warten,
  // damit Sonne, Mond und Planeten nicht erst mit 0 px berechnet und danach neu gezeichnet werden.
  if (screen === els.homeScreen) requestAnimationFrame(() => requestAnimationFrame(() => applySky(true)));
  window.scrollTo(0, 0);
}

function configureLockScreen() {
  renderLockMoon(nowForSky());
  const firstRun = !hasVaultConfig();
  const bio = !firstRun && hasBiometricConfig();
  els.pinInput.value = '';
  els.pinConfirm.value = '';
  els.pinConfirm.classList.toggle('hidden', !firstRun);
  els.pinConfirm.required = firstRun;
  els.pinLabel.textContent = firstRun ? 'Neue PIN festlegen (6 Ziffern)' : 'PIN';
  els.pinInput.placeholder = firstRun ? '6 Ziffern' : 'Deine PIN';
  els.pinSubmit.textContent = firstRun ? 'Reci mi einrichten' : 'Entsperren';
  els.pinForm.classList.toggle('hidden', bio);
  els.showPinBtn.classList.toggle('hidden', !bio);
  updateBiometricUi();
  els.lockSubtitle.textContent = firstRun
    ? 'Leg eine PIN fest. Damit schützt du deine Gedanken.'
    : (bio ? 'Tippe auf den Mond und leg deinen Finger auf.' : 'Erzähl mir, was dich bewegt.');
  els.lockHint.textContent = firstRun
    ? 'Merk dir die PIN gut. Ohne sie lassen sich die verschlüsselten Notizen nicht wiederherstellen.'
    : '';
}

function showUnlocked(resume = { screen: 'home' }) {
  resetSkyDayOffset(false);
  applyWeatherForView();
  ensureInboxKeys().then(openInbox).then(n => {
    if (n) { renderTopics(); showToast(n === 1 ? 'Eine Schnellnotiz wurde einsortiert' : `${n} Schnellnotizen wurden einsortiert`, 3000); }
  }).catch(() => {});
  renderDailyBits();
  renderCategoryControls();
  renderTopics();
  updateThoughtPortal();
  maybeShowBioCard();
  maybeShowBackupCard();
  // Verlauf neu aufbauen: Startseite ist die Basis
  history.replaceState({ rm: 'home' }, '');
  if (resume.screen === 'editor' && state.topics.some(t => t.id === resume.id && !t.deletedAt)) {
    openTopic(resume.id, { verified: true });
  } else if (resume.screen === 'trash') {
    openTrash();
  } else if (resume.screen === 'thought') {
    openThoughtWorld();
  } else {
    showScreen(els.homeScreen);
  }
}

function goHomeFromScreen() {
  // Für die Zurück-Pfeile in der App: wie die Zurück-Taste des Handys
  if (history.state && (['editor', 'trash', 'thought'].includes(history.state.rm))) history.back();
  else showHome();
}

async function jumpHome() {
  if (openSheetEl) { sheetSilentClose = true; openSheetEl.close(); sheetSilentClose = false; openSheetEl = null; }
  history.replaceState({ rm: 'home' }, '');
  await showHome();
}

async function showHome() {
  rememberEditorPosition();
  versionCheckpoint('leave');
  if (findOpen) closeFind();
  openedProtected.clear();   // geschützte Themen beim Verlassen sofort wieder zu
  stopRecognition();
  stopReading();
  if (cryptoKey) await persistState(true).catch(() => {});
  currentTopicId = null;
  renderTopics();
  showScreen(els.homeScreen);
}

function onPopState(e) {
  if (quickClosing) { quickClosing = false; return; }
  if ($('quickScreen').classList.contains('active')) {
    if (openSheetEl) { sheetSilentClose = true; const sh = openSheetEl; openSheetEl = null; sh.close(); sheetSilentClose = false; if (sh === els.confirmSheet) resolveConfirm(false); return; }
    leaveQuick({ save: true, viaHistory: true });   // Zurück-Taste: nichts geht verloren
    return;
  }
  if (!cryptoKey) return;
  if (openSheetEl) {
    sheetSilentClose = true;
    const sheet = openSheetEl;
    openSheetEl = null;
    sheet.close();
    sheetSilentClose = false;
    if (sheet === els.confirmSheet) resolveConfirm(false);
  }
  const s = e.state || { rm: 'home' };
  if (s.rm === 'editor') {
    const t = state?.topics.find(x => x.id === s.id);
    if (t?.locked && !openedProtected.has(s.id)) {
      history.replaceState({ rm: 'home' }, '');
      if (!els.homeScreen.classList.contains('active')) showHome();
    } else if (!(els.editorScreen.classList.contains('active') && currentTopicId === s.id)) openTopic(s.id, { push: false });
  } else if (s.rm === 'trash') {
    if (!els.trashScreen.classList.contains('active')) openTrash({ push: false });
  } else if (s.rm === 'thought') {
    if (!$('thoughtScreen').classList.contains('active')) openThoughtWorld({ push: false });
  } else if (s.rm !== 'sheet') {
    if (!els.homeScreen.classList.contains('active')) showHome();
  }
}

/* Blätter: jedes offene Blatt bekommt einen Verlaufseintrag, damit „Zurück“ es schließt */
function openSheet(dlg) {
  if (openSheetEl && openSheetEl !== dlg) {
    sheetSilentClose = true;
    openSheetEl.close();
    sheetSilentClose = false;
  } else if (!openSheetEl) {
    history.pushState({ rm: 'sheet' }, '');
  }
  openSheetEl = dlg;
  if (!dlg.open) dlg.showModal();
}

function closeSheet(dlg) {
  if (dlg.open) dlg.close();
}

// Blatt schließen und direkt woanders hin (ohne Verlaufs-Durcheinander)
function closeSheetAndReplace(dlg, newState) {
  sheetSilentClose = true;
  if (dlg.open) dlg.close();
  sheetSilentClose = false;
  openSheetEl = null;
  if (history.state?.rm === 'sheet') history.replaceState(newState, '');
  else history.pushState(newState, '');
}

function onSheetClosed(e) {
  if (sheetSilentClose) return;
  const dlg = e.target;
  if (openSheetEl !== dlg) return;
  openSheetEl = null;
  if (dlg === els.confirmSheet) resolveConfirm(false);
  if (dlg === $('backupCheckSheet')) pendingBackupCheck = null;
  if (history.state?.rm === 'sheet') history.back();
}

function closeAnySheet(silent = false) {
  if (!openSheetEl) return;
  const dlg = openSheetEl;
  openSheetEl = null;
  sheetSilentClose = silent;
  dlg.close();
  sheetSilentClose = false;
  if (dlg === els.confirmSheet) resolveConfirm(false);
}

/* =====================================================================
   Themen
   ===================================================================== */

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
const activeTopics = () => state.topics.filter(t => !t.deletedAt && !t.archivedAt);
const archivedTopics = () => state.topics.filter(t => !t.deletedAt && Boolean(t.archivedAt));
const deletedTopics = () => state.topics.filter(t => Boolean(t.deletedAt));

function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return time;
  if (d.toDateString() === yesterday.toDateString()) return 'Gestern';
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) + '.';
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function formatLong(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return `Heute, ${time}`;
  return `${d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })}, ${time}`;
}
function excerpt(text, max = 160) {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'Noch nichts geschrieben';
  return clean.length > max ? clean.slice(0, max).trimEnd() + ' …' : clean;
}
function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}
function customCategories() {
  if (!state) return [];
  state.settings = { ...(state.settings || {}) };
  if (!Array.isArray(state.settings.customCategories)) state.settings.customCategories = [];
  return state.settings.customCategories.filter(c => c && typeof c.name === 'string' && c.name.trim()).map(c => ({ name: c.name.trim(), color: c.color || '#8FA3B8' }));
}
function categoryNames() { return [...BASE_CATEGORIES, ...customCategories().map(c => c.name), QUICK_CATEGORY]; }
function categoryColor(cat) {
  const base = { 'Bücher': 'var(--c-books)', 'Apps': 'var(--c-apps)', 'Privat': 'var(--c-private)', 'Sonstiges': 'var(--c-other)', 'Schnellnotizen': 'var(--c-quick)' };
  if (base[cat]) return base[cat];
  return customCategories().find(c => c.name === cat)?.color || 'var(--c-other)';
}
function dotHtml(cat) { return `<span class="dot" data-cat="${escapeHtml(cat)}" style="--cat-c:${escapeHtml(categoryColor(cat))}"></span>`; }
function catOf(t) { return categoryNames().includes(t.category) ? t.category : 'Sonstiges'; }
function checklistItems(topic) {
  if (!topic) return [];
  if (!Array.isArray(topic.checklist)) topic.checklist = [];
  return topic.checklist;
}
function checklistPlainText(topic, includeState = true) {
  return checklistItems(topic).map(i => `${includeState ? (i.done ? '☑ ' : '☐ ') : ''}${i.text || ''}`.trim()).filter(Boolean).join('\n');
}
function combinedTopicText(topic) {
  const parts = [];
  if ((topic?.content || '').trim()) parts.push(topic.content.trim());
  const list = checklistPlainText(topic, true);
  if (list) parts.push(list);
  return parts.join('\n\n');
}

function renderCategoryControls() {
  const cats = categoryNames();
  if (!cats.includes(currentFilter) && currentFilter !== 'Alle') currentFilter = 'Alle';
  els.filterRow.innerHTML = `<button class="chip${currentFilter === 'Alle' ? ' active' : ''}" data-filter="Alle" type="button">Alle</button>` + cats.map(cat => `<button class="chip${currentFilter === cat ? ' active' : ''}" data-filter="${escapeHtml(cat)}" type="button">${dotHtml(cat)}${escapeHtml(cat)}</button>`).join('') + `<button class="chip add-category-chip" data-action="add-category" type="button" aria-label="Bereich hinzufügen">+</button>`;
  els.catPicker.innerHTML = cats.map(cat => `<button type="button" class="cat${cat === QUICK_CATEGORY ? ' cat-wide' : ''}${selectedCategory === cat ? ' selected' : ''}" data-cat="${escapeHtml(cat)}">${dotHtml(cat)}${escapeHtml(cat)}</button>`).join('') + `<button type="button" class="cat add-category-cat" data-action="add-category">+ Bereich</button>`;
}

function renderCategoryManager() {
  const list = customCategories();
  els.categoryManageList.innerHTML = list.length ? list.map(c => `<div class="category-manage-row" data-name="${escapeHtml(c.name)}"><div class="category-manage-name">${dotHtml(c.name)}<span>${escapeHtml(c.name)}</span></div><button class="category-mini category-edit" type="button" aria-label="${escapeHtml(c.name)} umbenennen"><svg class="ui-icon" viewBox="0 0 24 24"><path d="M4 20h4l11-11a2.1 2.1 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/></svg></button><button class="category-mini category-delete danger" type="button" aria-label="${escapeHtml(c.name)} löschen"><svg class="ui-icon" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"/></svg></button></div>`).join('') : '<p class="sheet-text">Noch keine eigenen Bereiche.</p>';
}
function openCategoryManager() {
  editingCategoryName = null;
  els.categoryName.value = '';
  els.categorySaveBtn.textContent = 'Hinzufügen';
  renderCategoryManager();
  openSheet(els.categorySheet);
}
async function saveCategoryManager() {
  const name = els.categoryName.value.trim().replace(/\s+/g, ' ');
  if (!name) return;
  const reserved = [...BASE_CATEGORIES, QUICK_CATEGORY];
  const custom = customCategories();
  const collision = [...reserved, ...custom.map(c => c.name)].some(n => n.toLocaleLowerCase('de') === name.toLocaleLowerCase('de') && n !== editingCategoryName);
  if (collision) { showToast('Diesen Bereich gibt es schon'); return; }
  if (editingCategoryName) {
    const item = state.settings.customCategories.find(c => c.name === editingCategoryName);
    if (item) item.name = name;
    state.topics.forEach(t => { if (t.category === editingCategoryName) t.category = name; });
    if (currentFilter === editingCategoryName) currentFilter = name;
    if (selectedCategory === editingCategoryName) selectedCategory = name;
  } else {
    const color = CUSTOM_CATEGORY_COLORS[custom.length % CUSTOM_CATEGORY_COLORS.length];
    state.settings.customCategories.push({ name, color });
  }
  editingCategoryName = null;
  els.categoryName.value = '';
  els.categorySaveBtn.textContent = 'Hinzufügen';
  await persistState(true);
  renderCategoryControls(); renderCategoryManager(); renderTopics();
}
async function deleteCustomCategory(name) {
  state.settings.customCategories = customCategories().filter(c => c.name !== name);
  state.topics.forEach(t => { if (t.category === name) t.category = 'Sonstiges'; });
  if (currentFilter === name) currentFilter = 'Alle';
  if (selectedCategory === name) selectedCategory = 'Sonstiges';
  if (editingCategoryName === name) { editingCategoryName = null; els.categoryName.value = ''; els.categorySaveBtn.textContent = 'Hinzufügen'; }
  await persistState(true);
  renderCategoryControls(); renderCategoryManager(); renderTopics();
  showToast('Bereich gelöscht. Themen sind jetzt unter Sonstiges.');
}

const LOCK_ICON = '<svg class="ui-icon lock-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
const PIN_ICON = '<svg class="ui-icon pin-icon" viewBox="0 0 24 24" aria-label="angeheftet"><path d="M9 4h6l-1 6 3 3H7l3-3-1-6Z"/><path d="M12 13v7"/></svg>';
const openedProtected = new Set();
let protectRequest = null;   // { id, purpose }

function renderTopics() {
  if (!state) return;
  const q = els.searchInput.value.trim().toLowerCase();
  const all = activeTopics();
  let topics = all;
  if (currentFilter !== 'Alle') topics = topics.filter(t => catOf(t) === currentFilter);
  if (q) topics = topics.filter(t => (t.locked ? t.title : `${t.title} ${t.content || ''} ${checklistPlainText(t, false)}`).toLowerCase().includes(q));
  topics.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || new Date(b.updatedAt) - new Date(a.updatedAt));

  els.topicList.innerHTML = topics.map(t => `
    <article class="row${t.locked ? ' is-locked' : ''}" data-id="${escapeHtml(t.id)}" data-cat="${escapeHtml(catOf(t))}" style="--row-cat-color:${escapeHtml(categoryColor(catOf(t)))}" tabindex="0">
      <div class="row-top"><h2>${t.pinned ? PIN_ICON : ''}${t.locked ? LOCK_ICON : ''}${escapeHtml(t.title)}</h2><time>${escapeHtml(formatDate(t.updatedAt))}</time></div>
      <p>${t.locked ? 'Geschützt. Zum Öffnen Fingerabdruck oder PIN.' : (!(t.content || '').trim() && checklistItems(t).length ? escapeHtml(excerpt(checklistPlainText(t, true))) : (!(t.content || '').trim() && t.sketches?.length ? 'Zeichnung' : escapeHtml(excerpt(t.content))))}</p>
    </article>`).join('');

  els.emptyState.classList.toggle('hidden', all.length !== 0);
  els.noResults.classList.toggle('hidden', !(all.length && !topics.length));
  els.noResults.textContent = q ? 'Nichts gefunden.' : 'In diesem Bereich gibt es noch kein Thema.';

  els.topicList.querySelectorAll('.row').forEach(wireRow);
}

function wireRow(row) {
  let timer = null, startX = 0, startY = 0, longPressed = false;
  const cancel = () => { clearTimeout(timer); timer = null; row.classList.remove('pressing'); };
  row.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    startX = e.clientX; startY = e.clientY; longPressed = false;
    row.classList.add('pressing');
    timer = setTimeout(() => {
      longPressed = true;
      row.classList.remove('pressing');
      if (navigator.vibrate) navigator.vibrate(20);
      openActionSheet(row.dataset.id);
    }, LONG_PRESS_MS);
  });
  row.addEventListener('pointermove', e => { if (Math.hypot(e.clientX - startX, e.clientY - startY) > 10) cancel(); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => row.addEventListener(ev, cancel));
  row.addEventListener('contextmenu', e => e.preventDefault());
  row.addEventListener('click', e => {
    if (longPressed) { longPressed = false; e.preventDefault(); return; }
    openTopic(row.dataset.id);
  });
  row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTopic(row.dataset.id); } });
}


/* =====================================================================
   Editor-Komfort: Position merken, ans Ende, Rückgängig/Wiederholen
   ===================================================================== */

const EDIT_HISTORY_LIMIT = 60;
let editUndoStack = [];
let editRedoStack = [];
let editGroupOpen = false;
let editGroupTimer = null;
let editApplying = false;
let editPrevSnapshot = null;

function editorSnapshot(text = els.topicText.value) {
  const len = text.length;
  const start = Math.min(Number(els.topicText.selectionStart ?? len), len);
  const end = Math.min(Number(els.topicText.selectionEnd ?? start), len);
  return { text, start, end, scrollTop: Number(els.topicText.scrollTop || 0) };
}

function updateEditHistoryButtons() {
  if (!els.undoBtn || !els.redoBtn) return;
  const canEdit = !els.topicText.readOnly;
  els.undoBtn.disabled = !canEdit || editUndoStack.length === 0;
  els.redoBtn.disabled = !canEdit || editRedoStack.length === 0;
}

function resetEditHistory(text = els.topicText.value) {
  clearTimeout(editGroupTimer);
  editUndoStack = [];
  editRedoStack = [];
  editGroupOpen = false;
  editPrevSnapshot = editorSnapshot(text);
  updateEditHistoryButtons();
}

function syncEditSnapshotPosition() {
  if (!editPrevSnapshot || editPrevSnapshot.text !== els.topicText.value) return;
  editPrevSnapshot = editorSnapshot(els.topicText.value);
}

function recordEditorChange(previousText) {
  if (editApplying) return;
  const before = editPrevSnapshot && editPrevSnapshot.text === previousText
    ? editPrevSnapshot
    : { text: previousText, start: previousText.length, end: previousText.length, scrollTop: els.topicText.scrollTop || 0 };

  if (!editGroupOpen) {
    editUndoStack.push({ ...before });
    if (editUndoStack.length > EDIT_HISTORY_LIMIT) editUndoStack.shift();
    editRedoStack = [];
    editGroupOpen = true;
  }
  clearTimeout(editGroupTimer);
  editGroupTimer = setTimeout(() => { editGroupOpen = false; }, 900);
}

async function applyEditorSnapshot(snap) {
  const topic = currentTopic();
  if (!topic || !snap) return;
  editApplying = true;
  clearTimeout(editGroupTimer);
  editGroupOpen = false;
  els.topicText.value = snap.text;
  const max = snap.text.length;
  try { els.topicText.setSelectionRange(Math.min(snap.start, max), Math.min(snap.end, max)); } catch {}
  els.topicText.scrollTop = Math.max(0, Number(snap.scrollTop || 0));
  versionOnInput(topic, snap.text);
  topic.content = snap.text;
  topic.updatedAt = new Date().toISOString();
  els.dateLine.textContent = formatLong(topic.updatedAt);
  if (findOpen) renderFind(false);
  editPrevSnapshot = editorSnapshot(snap.text);
  rememberEditorPosition();
  editApplying = false;
  updateEditHistoryButtons();
  await persistState(true);
}

async function undoEdit() {
  if (els.topicText.readOnly || !editUndoStack.length) return;
  const current = editorSnapshot();
  const previous = editUndoStack.pop();
  editRedoStack.push(current);
  if (editRedoStack.length > EDIT_HISTORY_LIMIT) editRedoStack.shift();
  await applyEditorSnapshot(previous);
}

async function redoEdit() {
  if (els.topicText.readOnly || !editRedoStack.length) return;
  const current = editorSnapshot();
  const next = editRedoStack.pop();
  editUndoStack.push(current);
  if (editUndoStack.length > EDIT_HISTORY_LIMIT) editUndoStack.shift();
  await applyEditorSnapshot(next);
}

function rememberEditorPosition() {
  const topic = currentTopic();
  if (!topic || !els.editorScreen.classList.contains('active')) return;
  const len = els.topicText.value.length;
  topic.viewState = {
    start: Math.min(Number(els.topicText.selectionStart ?? len), len),
    end: Math.min(Number(els.topicText.selectionEnd ?? len), len),
    scrollTop: Math.max(0, Number(els.topicText.scrollTop || 0))
  };
}

function restoreEditorPosition(topic) {
  const view = topic?.viewState;
  if (!view) return;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (currentTopicId !== topic.id) return;
    const len = els.topicText.value.length;
    const start = Math.min(Math.max(0, Number(view.start ?? len)), len);
    const end = Math.min(Math.max(start, Number(view.end ?? start)), len);
    try { els.topicText.setSelectionRange(start, end); } catch {}
    const maxScroll = Math.max(0, els.topicText.scrollHeight - els.topicText.clientHeight);
    els.topicText.scrollTop = Math.min(Math.max(0, Number(view.scrollTop || 0)), maxScroll);
    syncEditSnapshotPosition();
  }));
}

function goEditorEnd() {
  const len = els.topicText.value.length;
  try { els.topicText.setSelectionRange(len, len); } catch {}
  els.topicText.scrollTop = els.topicText.scrollHeight;
  rememberEditorPosition();
  syncEditSnapshotPosition();
}

function setEditorMode(mode, { focus = false, persist = true } = {}) {
  editorMode = mode === 'list' ? 'list' : 'text';
  const listOn = editorMode === 'list';
  els.textModeBtn.classList.toggle('active', !listOn);
  els.listModeBtn.classList.toggle('active', listOn);
  els.textModeBtn.setAttribute('aria-selected', String(!listOn));
  els.listModeBtn.setAttribute('aria-selected', String(listOn));
  els.textPane.classList.toggle('hidden', listOn);
  els.checklistPane.classList.toggle('hidden', !listOn);
  const topic = currentTopic();
  if (topic) {
    topic.editorMode = editorMode;
    if (persist) persistState();
  }
  if (listOn) {
    setEditing(false);
    renderChecklist();
    if (focus) setTimeout(() => els.checklistInput.focus(), 40);
  } else if (focus) {
    setEditing(true, true);
  }
}

function renderChecklist() {
  const topic = currentTopic();
  const items = checklistItems(topic);
  els.checklistList.innerHTML = items.map(i => `<div class="checklist-item${i.done ? ' done' : ''}" data-id="${escapeHtml(i.id)}">
    <input class="checklist-check" type="checkbox" ${i.done ? 'checked' : ''} aria-label="${i.done ? 'Als offen markieren' : 'Abhaken'}" />
    <div class="checklist-text">${escapeHtml(i.text || '')}</div>
    <button class="checklist-delete" type="button" aria-label="Punkt löschen">×</button>
  </div>`).join('');
  els.checklistEmpty.classList.toggle('hidden', items.length > 0);
}

function touchTopic(topic) {
  if (!topic) return;
  topic.updatedAt = new Date().toISOString();
  els.dateLine.textContent = formatLong(topic.updatedAt);
}

function addChecklistItem(text = els.checklistInput.value) {
  const topic = currentTopic();
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!topic || !clean) return false;
  checklistItems(topic).push({ id: uid(), text: clean, done: false, createdAt: new Date().toISOString() });
  els.checklistInput.value = '';
  touchTopic(topic);
  renderChecklist();
  persistState();
  setTimeout(() => els.checklistInput.focus(), 0);
  return true;
}

function updateChecklistItem(id, changes) {
  const topic = currentTopic();
  const item = checklistItems(topic).find(i => i.id === id);
  if (!item) return;
  Object.assign(item, changes);
  touchTopic(topic);
  renderChecklist();
  persistState();
}

function removeChecklistItem(id) {
  const topic = currentTopic();
  if (!topic) return;
  topic.checklist = checklistItems(topic).filter(i => i.id !== id);
  touchTopic(topic);
  renderChecklist();
  persistState();
}

function setEditorTag(topic) {
  const cat = catOf(topic);
  els.editorTag.innerHTML = `${dotHtml(cat)}${escapeHtml(cat)}`;
  els.editorTag.style.setProperty('--tag-c', categoryColor(cat));
}

function openTopic(id, { push = true, verified = false } = {}) {
  const topic = state?.topics.find(t => t.id === id && !t.deletedAt);
  if (!topic) return;
  if (topic.locked && !verified && !openedProtected.has(id)) {
    requestProtectedAccess(id, 'open');
    return;
  }
  if (topic.locked) openedProtected.add(id);
  currentTopicId = id;
  els.editorTitle.textContent = topic.title;
  setEditorTag(topic);
  els.topicText.value = topic.content || '';
  checklistItems(topic);
  resetEditHistory(topic.content || '');
  renderSketches();
  renderChecklist();
  if (findOpen) closeFind();
  stopReading();
  versionStart(topic);
  const initialMode = topic.editorMode === 'list' ? 'list' : 'text';
  setEditorMode(initialMode, { focus: false, persist: false });
  if (initialMode === 'text') setEditing(!topic.content);
  els.dateLine.textContent = formatLong(topic.updatedAt);
  els.saveState.textContent = 'Gespeichert';
  if (push) history.pushState({ rm: 'editor', id }, '');
  showScreen(els.editorScreen);
  restoreEditorPosition(topic);
}

function currentTopic() {
  return state?.topics.find(t => t.id === currentTopicId) || null;
}

function setEditing(on, focus = false) {
  if (!on) rememberEditorPosition();
  els.topicText.readOnly = !on;
  els.editBtn.classList.toggle('active', on);
  els.editBtn.querySelector('span').textContent = on ? 'Fertig' : 'Bearbeiten';
  if (on && focus) {
    const len = els.topicText.value.length;
    const start = Math.min(Number(els.topicText.selectionStart ?? len), len);
    const end = Math.min(Number(els.topicText.selectionEnd ?? start), len);
    const scrollTop = els.topicText.scrollTop;
    try { els.topicText.focus({ preventScroll: true }); } catch { els.topicText.focus(); }
    try { els.topicText.setSelectionRange(start, end); } catch {}
    els.topicText.scrollTop = scrollTop;
  }
  if (!on) els.topicText.blur();
  updateEditHistoryButtons();
}

function openTopicSheet(mode = 'create', id = null) {
  renderCategoryControls();
  topicSheetMode = mode;
  topicSheetId = id;
  if (mode === 'edit') {
    const topic = state.topics.find(t => t.id === id);
    if (!topic) return;
    els.topicSheetTitle.textContent = 'Thema bearbeiten';
    els.saveTopicBtn.textContent = 'Speichern';
    els.topicName.value = topic.title;
    selectCategory(catOf(topic));
    $('protectRow').classList.add('hidden');
  } else {
    $('protectRow').classList.remove('hidden');
    $('protectToggle').checked = false;
    els.topicSheetTitle.textContent = 'Neues Thema';
    els.saveTopicBtn.textContent = 'Thema anlegen';
    els.topicName.value = '';
    selectCategory(currentFilter !== 'Alle' ? currentFilter : 'Bücher');
  }
  openSheet(els.topicSheet);
  setTimeout(() => els.topicName.focus(), 80);
}

function selectCategory(cat) {
  if (!categoryNames().includes(cat)) cat = 'Sonstiges';
  selectedCategory = cat;
  els.catPicker.querySelectorAll('.cat').forEach(b => b.classList.toggle('selected', b.dataset.cat === cat));
}

async function saveTopicSheet() {
  const title = els.topicName.value.trim();
  if (!title) { els.topicName.focus(); return; }
  const now = new Date().toISOString();
  if (topicSheetMode === 'edit') {
    const topic = state.topics.find(t => t.id === topicSheetId);
    if (!topic) return closeSheet(els.topicSheet);
    topic.title = title;
    topic.category = selectedCategory;
    topic.updatedAt = now;
    closeSheet(els.topicSheet);
    await persistState(true);
    if (currentTopicId === topic.id) {
      els.editorTitle.textContent = topic.title;
      setEditorTag(topic);
      els.dateLine.textContent = formatLong(topic.updatedAt);
    }
    renderTopics();
    showToast('Gespeichert');
  } else {
    const topic = { id: uid(), title, category: selectedCategory, content: '', checklist: [], createdAt: now, updatedAt: now, deletedAt: null };
    if ($('protectToggle').checked) { topic.locked = true; openedProtected.add(topic.id); }
    state.topics.push(topic);
    await persistState(true);
    renderTopics();
    closeSheetAndReplace(els.topicSheet, { rm: 'editor', id: topic.id });
    openTopic(topic.id, { push: false });
    setEditing(true, true);
  }
}

/* ---------- Archiv ---------- */
async function toggleArchiveTopic(id) {
  const topic = state?.topics.find(t => t.id === id && !t.deletedAt);
  if (!topic) return;
  if (topic.locked && !openedProtected.has(id)) return requestProtectedAccess(id, 'archive');
  const wasArchived = Boolean(topic.archivedAt);
  topic.archivedAt = wasArchived ? null : new Date().toISOString();
  await persistState(true);
  if (openSheetEl === els.actionSheet) closeSheet(els.actionSheet);
  if (!wasArchived && currentTopicId === id && els.editorScreen.classList.contains('active')) goHomeFromScreen();
  else renderTopics();
  showToast(wasArchived ? 'Aus dem Archiv geholt' : 'Archiviert');
}

function openArchive() {
  renderArchive();
  openSheet($('archiveSheet'));
}

function renderArchive() {
  const box = $('archiveList');
  const topics = archivedTopics().sort((a, b) => new Date(b.archivedAt) - new Date(a.archivedAt));
  if (!topics.length) {
    box.innerHTML = '<div class="empty-state small"><h2>Archiv ist leer</h2><p>Archivierte Themen erscheinen hier.</p></div>';
    return;
  }
  box.innerHTML = topics.map(t => `<article class="archive-row" data-id="${escapeHtml(t.id)}">
    <h3>${t.locked ? LOCK_ICON : ''}${escapeHtml(t.title)}</h3>
    <p>${t.locked ? 'Geschützt.' : escapeHtml(excerpt((t.content || '').trim() ? t.content : checklistPlainText(t, true), 110))}</p>
    <div class="archive-actions">
      <button class="btn btn-main btn-small archive-open" type="button">Öffnen</button>
      <button class="btn btn-ghost btn-small archive-restore" type="button">Zurückholen</button>
    </div>
  </article>`).join('');
  box.querySelectorAll('.archive-open').forEach(btn => btn.addEventListener('click', () => {
    const id = btn.closest('.archive-row').dataset.id;
    closeSheetAndReplace($('archiveSheet'), { rm: 'editor', id });
    openTopic(id, { push: false });
  }));
  box.querySelectorAll('.archive-restore').forEach(btn => btn.addEventListener('click', async () => {
    const id = btn.closest('.archive-row').dataset.id;
    const topic = state.topics.find(t => t.id === id);
    if (!topic) return;
    if (topic.locked && !openedProtected.has(id)) { closeSheet($('archiveSheet')); return requestProtectedAccess(id, 'archive'); }
    topic.archivedAt = null;
    topic.updatedAt = new Date().toISOString();
    await persistState(true);
    renderArchive(); renderTopics();
    showToast('Aus dem Archiv geholt');
  }));
}

/* ---------- Themen zusammenführen ---------- */
let mergeSourceId = null;
function openMergePicker(sourceId) {
  const src = state?.topics.find(t => t.id === sourceId && !t.deletedAt && !t.archivedAt);
  if (!src) return;
  if (src.locked && !openedProtected.has(sourceId)) return requestProtectedAccess(sourceId, 'merge');
  mergeSourceId = sourceId;
  $('mergeText').textContent = `„${src.title}“ wird an das ausgewählte Thema angehängt. Das ursprüngliche Thema kommt danach ins Archiv.`;
  const targets = activeTopics().filter(t => t.id !== sourceId && t.category !== QUICK_CATEGORY && (!t.locked || openedProtected.has(t.id)))
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || new Date(b.updatedAt) - new Date(a.updatedAt));
  $('mergeList').innerHTML = targets.length
    ? targets.map(t => `<button type="button" class="sheet-item merge-item" data-id="${escapeHtml(t.id)}">${dotHtml(catOf(t))}<span>${t.pinned ? PIN_ICON : ''}${escapeHtml(t.title)}</span></button>`).join('')
    : '<p class="sheet-text">Es gibt kein geeignetes anderes Thema zum Zusammenführen.</p>';
  $('mergeList').querySelectorAll('.merge-item').forEach(b => b.addEventListener('click', () => mergeIntoTopic(b.dataset.id)));
  openSheet($('mergeSheet'));
}

async function mergeIntoTopic(targetId) {
  const src = state?.topics.find(t => t.id === mergeSourceId && !t.deletedAt);
  const target = state?.topics.find(t => t.id === targetId && !t.deletedAt && !t.archivedAt);
  if (!src || !target || src.id === target.id) return;
  await makeEmergencyCopy('Vor dem Zusammenführen zweier Themen');
  const old = target.content || '';
  const add = (src.content || '').trim();
  pushVersion(target, old, 'Vor dem Zusammenführen');
  const sep = !add || !old ? '' : old.endsWith('\n\n') ? '' : old.endsWith('\n') ? '\n' : '\n\n';
  const offset = old.length + sep.length;
  target.content = add ? old + sep + add : old;
  if (src.sketches?.length) target.sketches = [...(target.sketches || []), ...src.sketches];
  if (checklistItems(src).length) target.checklist = [...checklistItems(target), ...checklistItems(src).map(i => ({ ...i, id: uid() }))];
  if (src.markers?.length) {
    target.markers = [...(target.markers || []), ...src.markers.map(m => ({ ...m, id: uid(), pos: Math.max(0, offset + Number(m.pos || 0)) }))];
  }
  const now = new Date().toISOString();
  target.updatedAt = now;
  src.archivedAt = now;
  src.updatedAt = now;
  src.mergeTargetId = target.id;
  await persistState(true);
  closeSheet($('mergeSheet'));
  renderTopics();
  if (currentTopicId === src.id && els.editorScreen.classList.contains('active')) {
    history.replaceState({ rm: 'editor', id: target.id }, '');
    openTopic(target.id, { push: false });
  }
  showToast(`Mit „${target.title}“ zusammengeführt`);
  mergeSourceId = null;
}

/* ---------- Markierungen in langen Texten ---------- */
function topicMarkers(topic) {
  if (!topic) return [];
  if (!Array.isArray(topic.markers)) topic.markers = [];
  return topic.markers;
}
function markerExcerpt(topic, pos) {
  const text = topic?.content || '';
  const p = Math.min(Math.max(0, Number(pos || 0)), text.length);
  const start = Math.max(0, p - 34), end = Math.min(text.length, p + 70);
  return text.slice(start, end).replace(/\s+/g, ' ').trim() || 'Leere Textstelle';
}
function renderMarkers() {
  const topic = currentTopic();
  const box = $('markerList');
  if (!topic || !box) return;
  const list = topicMarkers(topic).slice().sort((a, b) => a.pos - b.pos);
  box.innerHTML = list.length ? list.map((m, i) => `<div class="marker-row" data-id="${escapeHtml(m.id)}">
    <button type="button" class="marker-jump"><h3>${escapeHtml(m.label || `Markierung ${i + 1}`)}</h3><p>${escapeHtml(markerExcerpt(topic, m.pos))}</p></button>
    <div class="marker-actions"><button type="button" class="btn btn-ghost btn-small marker-delete">Entfernen</button></div>
  </div>`).join('') : '<p class="sheet-text">Noch keine Markierungen in diesem Thema.</p>';
  box.querySelectorAll('.marker-jump').forEach(btn => btn.addEventListener('click', () => jumpToMarker(btn.closest('.marker-row').dataset.id)));
  box.querySelectorAll('.marker-delete').forEach(btn => btn.addEventListener('click', async () => {
    const id = btn.closest('.marker-row').dataset.id;
    topic.markers = topicMarkers(topic).filter(m => m.id !== id);
    await persistState(true); renderMarkers(); showToast('Markierung entfernt');
  }));
}
function openMarkers() {
  if (!currentTopic()) return;
  $('markerName').value = '';
  renderMarkers();
  openSheet($('markersSheet'));
}
async function addMarkerHere() {
  const topic = currentTopic();
  if (!topic) return;
  const pos = Math.min(Number(els.topicText.selectionStart ?? topic.content.length), topic.content.length);
  const label = $('markerName').value.trim() || `Markierung ${topicMarkers(topic).length + 1}`;
  topicMarkers(topic).push({ id: uid(), label, pos, createdAt: new Date().toISOString() });
  $('markerName').value = '';
  await persistState(true); renderMarkers(); showToast('Markierung gesetzt');
}
function jumpToMarker(id) {
  const topic = currentTopic();
  const marker = topicMarkers(topic).find(m => m.id === id);
  if (!topic || !marker) return;
  const pos = Math.min(Math.max(0, Number(marker.pos || 0)), els.topicText.value.length);
  closeSheet($('markersSheet'));
  requestAnimationFrame(() => {
    try { els.topicText.focus({ preventScroll: true }); els.topicText.setSelectionRange(pos, pos); } catch {}
    const before = els.topicText.value.slice(0, pos);
    const line = before.split('\n').length - 1;
    const lineHeight = parseFloat(getComputedStyle(els.topicText).lineHeight) || 24;
    const approx = Math.max(0, line * lineHeight - els.topicText.clientHeight * .35);
    els.topicText.scrollTop = Math.min(approx, els.topicText.scrollHeight);
    rememberEditorPosition(); syncEditSnapshotPosition();
  });
}
function adjustMarkersForEdit(topic, oldText, newText) {
  const list = topicMarkers(topic);
  if (!list.length || oldText === newText) return;
  let start = 0;
  while (start < oldText.length && start < newText.length && oldText[start] === newText[start]) start++;
  let oldTail = oldText.length, newTail = newText.length;
  while (oldTail > start && newTail > start && oldText[oldTail - 1] === newText[newTail - 1]) { oldTail--; newTail--; }
  const delta = (newTail - start) - (oldTail - start);
  for (const m of list) {
    const p = Number(m.pos || 0);
    if (p > oldTail) m.pos = p + delta;
    else if (p >= start) m.pos = newTail;
    m.pos = Math.min(Math.max(0, m.pos), newText.length);
  }
}

function openActionSheet(id) {
  const topic = state?.topics.find(t => t.id === id && !t.deletedAt);
  if (!topic) return;
  actionTopicId = id;
  els.actionTitle.textContent = topic.title;
  els.actionOpenBtn.classList.toggle('hidden', currentTopicId === id && els.editorScreen.classList.contains('active'));
  $('actionProtectBtn').textContent = topic.locked ? 'Schutz aufheben' : 'Extra schützen (Fingerabdruck oder PIN)';
  const inEditor = currentTopicId === id && els.editorScreen.classList.contains('active');
  $('actionFindBtn').classList.toggle('hidden', !inEditor);
  $('actionVersionsBtn').classList.toggle('hidden', !inEditor);
  $('actionDrawBtn').classList.toggle('hidden', !inEditor);
  $('actionMarkersBtn').classList.toggle('hidden', !inEditor);
  $('actionShareBtn').classList.toggle('hidden', topic.locked && !openedProtected.has(id));
  $('actionMergeBtn').classList.toggle('hidden', topic.category === QUICK_CATEGORY || Boolean(topic.archivedAt));
  $('actionArchiveBtn').textContent = topic.archivedAt ? 'Aus Archiv holen' : 'Archivieren';
  $('actionPinBtn').textContent = topic.pinned ? 'Nicht mehr anheften' : 'Oben anheften';
  $('actionAttachBtn').classList.toggle('hidden', topic.category !== 'Schnellnotizen');
  openSheet(els.actionSheet);
}

function requestProtectedAccess(id, purpose) {
  const topic = state?.topics.find(t => t.id === id);
  if (!topic) return;
  protectRequest = { id, purpose };
  const bio = hasBiometricConfig();
  const how = bio ? 'deinem Fingerabdruck oder deiner PIN' : 'deiner PIN';
  const texts = {
    open: `Dieses Thema ist geschützt. Öffne es mit ${how}.`,
    unprotect: `Bestätige mit ${how}, um den Schutz aufzuheben.`,
    trash: `Bestätige mit ${how}, um das Thema in den Papierkorb zu legen.`,
    purge: `Bestätige mit ${how}, um das Thema endgültig zu löschen.`,
    archive: `Bestätige mit ${how}, um das Thema zu archivieren oder zurückzuholen.`,
    merge: `Bestätige mit ${how}, um dieses Thema mit einem anderen zusammenzuführen.`
  };
  $('protectTitle').textContent = topic.title;
  $('protectText').textContent = texts[purpose] || texts.open;
  $('protectOkBtn').textContent = purpose === 'open' ? 'Mit PIN öffnen' : 'Bestätigen';
  $('protectBioBtn').lastChild.textContent = purpose === 'open' ? ' Mit Fingerabdruck öffnen' : ' Mit Fingerabdruck bestätigen';
  $('protectBioBtn').classList.toggle('hidden', !bio);
  $('protectOr').classList.toggle('hidden', !bio);
  $('protectPin').value = '';
  $('protectHint').textContent = '';
  openSheet($('protectSheet'));
  if (bio) protectWithFingerprint();
  else setTimeout(() => $('protectPin').focus(), 120);
}

async function protectWithFingerprint() {
  if (biometricBusy) return;
  biometricBusy = true;
  $('protectHint').textContent = '';
  try {
    await biometricAssert();
    biometricBusy = false;
    grantProtectedAccess();
  } catch (err) {
    if (err?.name !== 'NotAllowedError') $('protectHint').textContent = biometricErrorText(err, 'Öffnen');
    else $('protectHint').textContent = 'Kein Fingerabdruck? Dann gib deine PIN ein.';
  } finally {
    biometricBusy = false;
    markAlive();
  }
}

async function protectWithPin() {
  const btn = $('protectOkBtn');
  btn.disabled = true;
  const ok = await verifyPin($('protectPin').value.trim());
  btn.disabled = false;
  if (ok) grantProtectedAccess();
  else { $('protectHint').textContent = 'Die PIN stimmt nicht.'; $('protectPin').value = ''; $('protectPin').focus(); }
}

async function grantProtectedAccess() {
  const req = protectRequest;
  protectRequest = null;
  if (!req) return;
  const sheet = $('protectSheet');
  const topic = state?.topics.find(t => t.id === req.id);
  if (!topic) return closeSheet(sheet);
  if (req.purpose === 'open') {
    closeSheetAndReplace(sheet, { rm: 'editor', id: req.id });
    openTopic(req.id, { push: false, verified: true });
  } else if (req.purpose === 'unprotect') {
    closeSheet(sheet);
    topic.locked = false;
    await persistState(true);
    renderTopics();
    showToast('Schutz aufgehoben');
  } else if (req.purpose === 'trash') {
    closeSheet(sheet);
    moveTopicToTrash(req.id);
  } else if (req.purpose === 'purge') {
    const yes = await askConfirm('Endgültig löschen?', `„${topic.title}“ lässt sich danach nicht mehr zurückholen.`, 'Endgültig löschen');
    if (!yes) return;
    state.topics = state.topics.filter(x => x.id !== topic.id);
    await persistState(true);
    renderTrash();
    showToast('Endgültig gelöscht');
  } else if (req.purpose === 'archive') {
    closeSheet(sheet);
    openedProtected.add(req.id);
    await toggleArchiveTopic(req.id);
    if ($('archiveSheet')?.open) renderArchive();
  } else if (req.purpose === 'merge') {
    closeSheet(sheet);
    openedProtected.add(req.id);
    openMergePicker(req.id);
  }
}

async function toggleProtection(id) {
  const topic = state?.topics.find(t => t.id === id);
  if (!topic) return;
  const openNow = els.editorScreen.classList.contains('active') && currentTopicId === id;
  if (!topic.locked) {
    closeSheet(els.actionSheet);
    topic.locked = true;
    if (openNow) openedProtected.add(id);
    await persistState(true);
    renderTopics();
    showToast('Dieses Thema ist jetzt extra geschützt');
  } else if (openNow) {
    closeSheet(els.actionSheet);
    topic.locked = false;
    await persistState(true);
    renderTopics();
    showToast('Schutz aufgehoben');
  } else {
    requestProtectedAccess(id, 'unprotect');
  }
}

async function moveTopicToTrash(id) {
  const topic = state?.topics.find(t => t.id === id && !t.deletedAt);
  if (!topic) return;
  topic.deletedAt = new Date().toISOString();
  topic.archivedAt = null;
  topic.updatedAt = topic.deletedAt;
  await persistState(true);
  showToast('In den Papierkorb gelegt');
  if (currentTopicId === id && els.editorScreen.classList.contains('active')) {
    goHomeFromScreen();
  } else {
    renderTopics();
  }
}

/* Bestätigen */
function askConfirm(title, text, okLabel = 'Löschen') {
  els.confirmTitle.textContent = title;
  els.confirmText.textContent = text;
  els.confirmOkBtn.textContent = okLabel;
  resolveConfirm(false);
  openSheet(els.confirmSheet);
  return new Promise(resolve => { confirmResolver = resolve; });
}
function resolveConfirm(value) {
  const r = confirmResolver;
  confirmResolver = null;
  if (r) r(value);
}

/* Papierkorb */
function openTrash({ push = true } = {}) {
  renderTrash();
  if (push) history.pushState({ rm: 'trash' }, '');
  showScreen(els.trashScreen);
}

function renderTrash() {
  const topics = deletedTopics().sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
  if (!topics.length) {
    els.trashList.innerHTML = '<div class="empty-state"><h2>Der Papierkorb ist leer</h2><p>Hier landen Themen, die du löschst.</p></div>';
    return;
  }
  els.trashList.innerHTML = topics.map(t => `
    <article class="row trash" data-cat="${escapeHtml(catOf(t))}">
      <div class="row-top"><h2>${escapeHtml(t.title)}</h2><time>${escapeHtml(formatDate(t.deletedAt))}</time></div>
      <p>${t.locked ? 'Geschützt.' : escapeHtml(excerpt(t.content))}</p>
      <div class="trash-actions">
        <button class="btn btn-main btn-small restore-btn" data-id="${escapeHtml(t.id)}" type="button">Zurückholen</button>
        <button class="btn btn-ghost btn-small purge-btn" data-id="${escapeHtml(t.id)}" type="button">Endgültig löschen</button>
      </div>
    </article>`).join('');

  els.trashList.querySelectorAll('.restore-btn').forEach(btn => btn.addEventListener('click', async () => {
    const t = state.topics.find(x => x.id === btn.dataset.id);
    if (!t) return;
    t.deletedAt = null;
    t.archivedAt = null;
    t.updatedAt = new Date().toISOString();
    await persistState(true);
    renderTrash();
    showToast('Thema zurückgeholt');
  }));
  els.trashList.querySelectorAll('.purge-btn').forEach(btn => btn.addEventListener('click', async () => {
    const t = state.topics.find(x => x.id === btn.dataset.id);
    if (!t) return;
    if (t.locked) return requestProtectedAccess(t.id, 'purge');
    const yes = await askConfirm('Endgültig löschen?', `„${t.title}“ lässt sich danach nicht mehr zurückholen.`, 'Endgültig löschen');
    if (!yes) return;
    state.topics = state.topics.filter(x => x.id !== t.id);
    await persistState(true);
    renderTrash();
    showToast('Endgültig gelöscht');
  }));
}

/* =====================================================================
   Kopieren, Vorlesen, Spracheingabe
   ===================================================================== */

let toastTimer = null;
function showToast(message, duration = 2000) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), duration);
}

async function copyAll() {
  const topic = currentTopic();
  const text = combinedTopicText(topic);
  if (!text.trim()) return showToast('Hier steht noch nichts');
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const tmp = document.createElement('textarea');
    tmp.value = text;
    tmp.setAttribute('readonly', '');
    tmp.style.position = 'fixed';
    tmp.style.opacity = '0';
    document.body.appendChild(tmp);
    tmp.select();
    document.execCommand('copy');
    tmp.remove();
  }
  showToast('Ganzer Inhalt kopiert');
}

function stopReading() {
  tts.playing = false;
  tts.token = (tts.token || 0) + 1;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  els.readBtn.classList.remove('active');
  const p = document.getElementById('player');
  if (p) p.classList.add('hidden');
  if (!findOpen && document.getElementById('hlLayer')) renderHighlights([], -1);
}
function readText() {
  if (!$('player').classList.contains('hidden')) return stopReading();
  openPlayer();
}

/* ---------- Spracheingabe ----------
   Hört so lange zu, bis du das Mikrofon wieder antippst – auch wenn du zwischendurch
   nachdenkst. Satzzeichen werden nach Pausen und typischen Bindewörtern ergänzt. */

let dictWanted = false;
let dictInsertPos = null;
let dictLastAuto = null;      // { pos } – Stelle eines automatisch gesetzten Punkts/Fragezeichens
let dictQuickFails = 0;
let dictSessionStart = 0;
let dictSessionFinal = '';
let dictProcessed = new Set();
let wakeLock = null;

const FILLERS = /^(ä+h+m*|ö+h+m*|e+h+m+|h+m+|m+h+m+)[,.]?$/i;
const COMMA_BEFORE = new Set(['dass', 'weil', 'obwohl', 'sondern', 'sodass', 'nachdem', 'bevor', 'wobei', 'falls', 'sobald', 'ob', 'wenn', 'aber', 'denn']);
const COMMA_ONLY_MID = new Set(['dass', 'weil', 'obwohl', 'sondern', 'sodass', 'nachdem', 'bevor', 'wobei', 'falls', 'sobald', 'ob', 'wenn']);
const NO_COMMA_AFTER = new Set(['und', 'oder', 'auch', 'nur', 'selbst', 'außer', 'als', 'wie', 'so', 'ohne', 'statt', 'anstatt', 'bis', 'aber', 'denn']);
const JOIN_PLAIN = new Set(['und', 'oder', 'bzw', 'sowie', 'beziehungsweise']);
const W_QUESTION = new Set(['wer', 'wen', 'wem', 'wessen', 'was', 'wann', 'wo', 'woher', 'wohin', 'warum', 'wieso', 'weshalb', 'wie', 'welche', 'welcher', 'welches', 'welchen', 'welchem', 'wozu', 'womit', 'wofür', 'worüber', 'wovon']);
const VERB_FIRST = new Set(['kann', 'kannst', 'könnte', 'könntest', 'können', 'hast', 'hat', 'habe', 'haben', 'hattest', 'bist', 'ist', 'sind', 'seid', 'war', 'warst', 'soll', 'sollte', 'sollen', 'darf', 'dürfen', 'willst', 'will', 'wollen', 'gibt', 'weißt', 'magst', 'muss', 'musst', 'müssen', 'wirst', 'wird', 'werden', 'würdest', 'würde', 'glaubst', 'meinst', 'findest', 'denkst', 'kennst', 'gehst', 'kommst', 'machst']);
const PRONOUNS = new Set(['du', 'ihr', 'sie', 'er', 'es', 'wir', 'man', 'das', 'ich', 'der', 'die', 'dies', 'dieser', 'diese']);

function capitalize(s) { return s.replace(/^(\s*)(\p{Ll})/u, (m, sp, ch) => sp + ch.toUpperCase()); }
function lowerFirstWord(s) { return s.replace(/^(\s*)(\p{Lu})(\p{Ll}*)/u, (m, sp, a, b) => sp + a.toLowerCase() + b); }
function bare(word) { return (word || '').toLowerCase().replace(/[^\p{L}]/gu, ''); }

// Gesprochene Befehle, Füllwörter, Kommas vor Bindewörtern
function cleanSpoken(raw) {
  let t = ' ' + raw.trim() + ' ';
  t = t.replace(/\s+neuer\s+absatz\s+/gi, '\n\n').replace(/\s+neue\s+zeile\s+/gi, '\n')
       .replace(/\s+komma\s+/gi, ', ').replace(/\s+fragezeichen\s*/gi, '? ')
       .replace(/\s+ausrufezeichen\s*/gi, '! ').replace(/\s+doppelpunkt\s+/gi, ': ');
  const lines = t.split('\n').map(line => {
    const words = line.split(/\s+/).filter(Boolean).filter(w => !FILLERS.test(w));
    for (let i = 1; i < words.length; i++) {
      const w = bare(words[i]);
      if (!COMMA_BEFORE.has(w) || !COMMA_ONLY_MID.has(w)) continue;
      const prev = words[i - 1];
      if (/[,.;:!?]$/.test(prev)) continue;
      const p = bare(prev);
      if (NO_COMMA_AFTER.has(p)) {
        // „so dass“, „als ob“, „auch wenn“ → Komma vor das erste Wort
        if (['so', 'als', 'ohne', 'statt', 'anstatt', 'auch', 'nur', 'selbst', 'bis'].includes(p) && i >= 2 && !/[,.;:!?]$/.test(words[i - 2]) && !['und', 'oder'].includes(bare(words[i - 2]))) {
          words[i - 2] += ',';
        }
        continue;
      }
      words[i - 1] = prev + ',';
    }
    return words.join(' ');
  });
  return lines.join('\n').replace(/[ \t]+([,.;:!?])/g, '$1').replace(/ *\n */g, '\n').replace(/^[ \t]+|[ \t]+$/g, '');
}

function looksLikeQuestion(sentence) {
  const words = sentence.trim().split(/\s+/).map(bare);
  if (!words[0]) return false;
  if (W_QUESTION.has(words[0])) return true;
  return VERB_FIRST.has(words[0]) && PRONOUNS.has(words[1]);
}

// Kleine Wörter, die mitten im Satz kleingeschrieben werden (Nomen bleiben groß)
const LOWER_WORDS = new Set(('der die das den dem des ein eine einen einem einer eines und oder aber denn weil dass ob wenn als wie wo was wer ' +
  'auch noch schon dann da so nur nicht kein keine keinen ich du er sie es wir ihr man mich mir dich dir sich uns euch ihn ihm ihnen ' +
  'mein meine meinen dein deine sein seine unser zu zum zur mit von vom bei beim nach vor aus auf in im an am um für über unter durch ' +
  'gegen ohne bis seit hat habe haben hast ist bin bist sind seid war waren wird werden wurde kann können könnte muss müssen soll ' +
  'sollte will möchte gibt sehr mal also einfach ganz immer jetzt hier dort dabei dafür daraus damit darauf dazu daher davon wieder ' +
  'etwa eben ja nein vielleicht doch viel viele mehr alle alles etwas nichts diese dieser dieses welche welcher bzw beziehungsweise ' +
  'sowie zusammen dann denn deshalb trotzdem sondern obwohl nachdem bevor während falls sobald').split(' '));
const SENTENCE_PAUSE_MS = 2500;   // erst nach so einer echten Pause kommt ein Punkt
let dictSentenceTimer = null;

let dictTarget = null;
let dictMicBtn = null;
function dictTA() { return dictTarget || els.topicText; }
function dictBtn() { return dictMicBtn || els.micBtn; }

function insertSpokenSegment(raw) {
  let seg = cleanSpoken(raw);
  if (!seg) return;
  clearTimeout(dictSentenceTimer);
  const ta = dictTA();
  if (ta === els.topicText) setEditing(true);
  const value = ta.value;
  let pos = document.activeElement === ta ? ta.selectionEnd : (dictInsertPos ?? value.length);
  pos = Math.min(Math.max(0, pos), value.length);
  const undoEntry = { ta, before: value, pos, auto: dictLastAuto };
  let before = value.slice(0, pos);
  const after = value.slice(pos);

  const firstWord = bare(seg.split(/\s+/)[0]);
  const autoEnded = dictLastAuto && dictLastAuto.pos === before.length - 1 && /[.?!]$/.test(before);
  if (autoEnded && /^[,;:.!?]/.test(seg)) {
    // gesagtes Satzzeichen ersetzt den automatischen Punkt
    before = before.slice(0, -1);
    seg = seg.replace(/^([,;:.!?])\s*/, '$1 ');
  } else if (autoEnded && (JOIN_PLAIN.has(firstWord) || COMMA_BEFORE.has(firstWord))) {
    // Pause war doch mitten im Satz: automatischen Punkt wieder wegnehmen
    before = before.slice(0, -1) + (JOIN_PLAIN.has(firstWord) ? '' : ',');
    seg = lowerFirstWord(seg);
  } else {
    const trimmed = before.replace(/\s+$/, '');
    const sentenceStart = !trimmed || /[.?!]$/.test(trimmed) || /\n\s*$/.test(before);
    if (sentenceStart) {
      seg = capitalize(seg);
    } else {
      // mitten im Satz: kleine Wörter klein, Komma vor „dass“, „weil“ usw.
      if (LOWER_WORDS.has(firstWord)) seg = lowerFirstWord(seg);
      if (COMMA_ONLY_MID.has(firstWord) && !/[,;:]$/.test(trimmed) && !NO_COMMA_AFTER.has(bare(trimmed.split(/\s+/).pop()))) {
        before = trimmed + ',';
      }
    }
  }

  const needsSpace = before.length && !/[\s\n]$/.test(before) && !/^[,.;:!?\n]/.test(seg);
  const inserted = (needsSpace ? ' ' : '') + seg;
  const afterNeedsSpace = after.length && !/^[\s\n,.;:!?]/.test(after);
  ta.value = before + inserted + (afterNeedsSpace ? ' ' : '') + after;
  const caret = before.length + inserted.length;
  dictInsertPos = caret;
  dictLastAuto = null;
  try { ta.setSelectionRange(caret, caret); } catch {}
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  undoEntry.after = ta.value;
  rememberDictUndo(undoEntry);
  if (caret >= ta.value.length - 2) ta.scrollTop = ta.scrollHeight;
  scheduleSentenceEnd();
}

// Punkt oder Fragezeichen erst setzen, wenn du wirklich eine Pause machst
function scheduleSentenceEnd() {
  clearTimeout(dictSentenceTimer);
  dictSentenceTimer = setTimeout(endSpokenSentence, dictMode() === 'simple' ? SENTENCE_PAUSE_MS + 1500 : SENTENCE_PAUSE_MS);
}
function holdSentenceEnd() {
  // du sprichst gerade weiter → noch keinen Punkt
  if (dictSentenceTimer) scheduleSentenceEnd();
}
function endSpokenSentence() {
  clearTimeout(dictSentenceTimer);
  dictSentenceTimer = null;
  const ta = dictTA();
  if (dictInsertPos == null) return;
  const value = ta.value;
  const pos = Math.min(dictInsertPos, value.length);
  const before = value.slice(0, pos);
  const trimmed = before.replace(/\s+$/, '');
  if (!trimmed || /[.?!,;:]$/.test(trimmed) || /\n\s*$/.test(before)) return;
  const sentence = trimmed.split(/[.?!\n]/).pop();
  const mark = looksLikeQuestion(sentence) ? '?' : '.';
  const wasUndoable = lastDictUndo && lastDictUndo.ta === ta && lastDictUndo.after === value;
  ta.value = trimmed + mark + value.slice(trimmed.length);
  if (wasUndoable) lastDictUndo.after = ta.value;
  dictInsertPos = trimmed.length + 1 + (pos - trimmed.length);
  dictLastAuto = { pos: trimmed.length };
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

function speechRecognitionCtor() { return window.SpeechRecognition || window.webkitSpeechRecognition || null; }

function showDictation(on) {
  $('dictation').classList.toggle('hidden', !on);
  if (!on) $('dictText').textContent = '';
}

async function holdScreenOn(on) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) wakeLock = await navigator.wakeLock.request('screen');
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { wakeLock = null; }
}

let dictGotResult = false;
let dictNoResultEnds = 0;
let dictStartFails = 0;
let dictWatchdog = null;

function dictMode() {
  try { return localStorage.getItem('rm_dict_mode') || 'live'; } catch { return 'live'; }
}
function setDictMode(m) { try { localStorage.setItem('rm_dict_mode', m); } catch {} }
function setDictStatus(text) { const h = $('dictHead'); if (h) h.textContent = text; }

function startRecognizer() {
  const Ctor = speechRecognitionCtor();
  if (!Ctor || !dictWanted) return;
  const mode = dictMode();
  const rec = new Ctor();
  recognition = rec;
  rec.lang = 'de-DE';
  // „live“: zeigt Text schon während du sprichst. „einfach“: wie früher, falls das Handy live nicht kann.
  rec.continuous = mode === 'live';
  rec.interimResults = mode === 'live';
  rec.maxAlternatives = 1;
  dictSessionStart = Date.now();
  dictSessionFinal = '';
  dictProcessed = new Set();
  let started = false;

  const markStarted = () => {
    if (started) return;
    started = true;
    clearTimeout(dictWatchdog);
    setDictStatus('Ich höre zu. Tippe auf das Mikrofon zum Beenden.');
  };
  rec.onstart = markStarted;
  rec.onaudiostart = markStarted;
  rec.onspeechstart = () => { markStarted(); holdSentenceEnd(); };
  rec.onsoundstart = () => holdSentenceEnd();

  rec.onresult = event => {
    markStarted();
    dictGotResult = true;
    dictNoResultEnds = 0;
    let interim = '';
    for (let i = 0; i < event.results.length; i++) {
      const res = event.results[i];
      const text = res[0].transcript;
      if (res.isFinal) {
        if (dictProcessed.has(i)) continue;
        dictProcessed.add(i);
        let piece = text;
        // manche Android-Versionen liefern den bisherigen Text noch einmal mit
        if (dictSessionFinal && piece.toLowerCase().startsWith(dictSessionFinal.toLowerCase())) piece = piece.slice(dictSessionFinal.length);
        dictSessionFinal = text;
        if (piece.trim()) insertSpokenSegment(piece);
        dictQuickFails = 0;
      } else {
        interim += text;
      }
    }
    if (interim.trim()) holdSentenceEnd();
    $('dictText').textContent = interim.trim();
  };
  rec.onerror = event => {
    const e = event.error;
    if (e === 'no-speech' || e === 'aborted') return;   // einfach weiter zuhören
    if (e === 'not-allowed' || e === 'service-not-allowed') {
      dictWanted = false;
      showToast('Das Mikrofon ist nicht erlaubt. Erlaube es in den Einstellungen des Browsers für diese Seite.', 6000);
    } else if (e === 'audio-capture') {
      dictWanted = false;
      showToast('Das Mikrofon wird gerade von einer anderen App benutzt.', 4500);
    } else if (e === 'network') {
      dictWanted = false;
      showToast('Die Spracheingabe braucht gerade Internet.', 4500);
    } else if (e === 'language-not-supported') {
      dictWanted = false;
      keyboardDictationFallback();
    } else if (mode === 'live') {
      setDictMode('simple');
    } else {
      setDictStatus(`Problem mit dem Mikrofon (${e}). Ich versuche es weiter …`);
    }
  };
  rec.onend = () => {
    if (recognition !== rec) return;
    clearTimeout(dictWatchdog);
    const short = Date.now() - dictSessionStart < 1200;
    dictQuickFails = short ? dictQuickFails + 1 : 0;
    if (!dictGotResult && mode === 'live') {
      dictNoResultEnds++;
      // Live-Modus liefert auf diesem Handy nichts → auf einfachen Modus umschalten
      if (dictNoResultEnds >= 2) { setDictMode('simple'); dictNoResultEnds = 0; }
    }
    if (dictWanted && dictQuickFails < 8 && dictTA().closest('.screen')?.classList.contains('active')) {
      setTimeout(() => { if (dictWanted) startRecognizer(); }, 150);
    } else {
      if (dictWanted && dictQuickFails >= 8) showToast('Die Spracheingabe hat aufgehört. Tippe nochmal auf das Mikrofon.', 4000);
      dictWanted = false;
      finishDictationUi();
    }
  };

  // Falls das Handy gar nicht reagiert, sag es mir
  clearTimeout(dictWatchdog);
  dictWatchdog = setTimeout(() => {
    if (!started && dictWanted) setDictStatus('Das Mikrofon startet nicht. Prüfe, ob der Browser das Mikrofon benutzen darf.');
  }, 5000);

  try {
    rec.start();
    dictStartFails = 0;
  } catch (err) {
    dictStartFails++;
    if (mode === 'live') setDictMode('simple');
    if (dictStartFails >= 4) {
      dictWanted = false;
      finishDictationUi();
      showToast(`Spracheingabe konnte nicht starten (${err?.name || err?.message || 'Fehler'}).`, 6000);
      return;
    }
    setTimeout(() => { if (dictWanted) startRecognizer(); }, 400);
  }
}

function finishDictationUi() {
  isListening = false;
  [els.micBtn, $('quickMicBtn')].forEach(b => { b.classList.remove('listening'); b.setAttribute('aria-label', 'Spracheingabe starten'); });
  showDictation(false);
  holdScreenOn(false);
  if (dictTarget === els.checklistInput && els.checklistInput.value.trim()) addChecklistItem(els.checklistInput.value);
  if (dictTarget === els.checklistInput) { dictTarget = null; dictMicBtn = null; }
}

function startDictation() {
  if (!speechRecognitionCtor()) return keyboardDictationFallback();
  stopReading();
  dictWanted = true;
  isListening = true;
  dictQuickFails = 0;
  dictGotResult = false;
  dictNoResultEnds = 0;
  dictStartFails = 0;
  setDictStatus('Mikrofon startet …');
  const ta = dictTA();
  dictInsertPos = document.activeElement === ta ? ta.selectionEnd : ta.value.length;
  dictLastAuto = null;
  if (ta === els.topicText) setEditing(true);
  dictBtn().classList.add('listening');
  dictBtn().setAttribute('aria-label', 'Spracheingabe beenden');
  showDictation(true);
  startRecognizer();
  holdScreenOn(true);
}

function stopRecognition() {
  const wasOn = dictWanted || isListening;
  dictWanted = false;
  if (dictSentenceTimer) endSpokenSentence();
  if (recognition) { try { recognition.stop(); } catch {} }
  finishDictationUi();
  return wasOn;
}

function keyboardDictationFallback() {
  const ta = dictTA();
  if (ta === els.topicText) setEditing(true, true);
  else { try { ta.focus(); } catch {} }
  showToast('Direkte Spracheingabe geht in diesem Browser nicht. Tippe auf das Mikrofon deiner Tastatur.', 5000);
}

function toggleRecognition() {
  if (dictWanted || isListening) stopRecognition();
  else startDictation();
}

/* =====================================================================
   Schnellnotiz: auch ohne Entsperren
   Die Notiz wird mit einem öffentlichen Schlüssel verschlüsselt. Lesen kann man
   sie nur mit dem privaten Schlüssel, und der liegt im verschlüsselten Tresor.
   ===================================================================== */

const LS_INBOX_PUB = 'rm_inbox_pub';
const INBOX_KEY = 'inbox';
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
let quickMode = 'new';          // 'new' = neue Schnellnotiz, 'attach' = Zeichnung an Thema anhängen
let quickAttachId = null;
let quickTab = 'write';
let quickReturn = null;          // Bildschirm, zu dem wir zurückgehen

function hasInboxKey() { return Boolean(localStorage.getItem(LS_INBOX_PUB)); }

async function ensureInboxKeys() {
  if (!state) return;
  try {
    if (!state.settings.inboxPriv) {
      const pair = await crypto.subtle.generateKey(ECDH, true, ['deriveKey']);
      state.settings.inboxPriv = await crypto.subtle.exportKey('jwk', pair.privateKey);
      const pub = await crypto.subtle.exportKey('jwk', pair.publicKey);
      localStorage.setItem(LS_INBOX_PUB, JSON.stringify(pub));
      await persistState(true);
    } else if (!hasInboxKey()) {
      const { kty, crv, x, y } = state.settings.inboxPriv;
      localStorage.setItem(LS_INBOX_PUB, JSON.stringify({ kty, crv, x, y, ext: true }));
    }
  } catch {}
  updateQuickButton();
}

async function inboxSealKey(pubJwk, ephPriv) {
  const pub = await crypto.subtle.importKey('jwk', pubJwk, ECDH, false, []);
  return crypto.subtle.deriveKey({ name: 'ECDH', public: pub }, ephPriv, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function sealToInbox(note) {
  const pubJwk = JSON.parse(localStorage.getItem(LS_INBOX_PUB));
  const eph = await crypto.subtle.generateKey(ECDH, true, ['deriveKey']);
  const key = await inboxSealKey(pubJwk, eph.privateKey);
  const sealed = await encryptValue(note, key);
  sealed.epk = await crypto.subtle.exportKey('jwk', eph.publicKey);
  const box = (await idbGet(INBOX_KEY)) || [];
  box.push(sealed);
  await idbSet(INBOX_KEY, box);
}

async function openInbox() {
  if (!state?.settings?.inboxPriv) return 0;
  const box = (await idbGet(INBOX_KEY).catch(() => null)) || [];
  if (!box.length) return 0;
  const priv = await crypto.subtle.importKey('jwk', state.settings.inboxPriv, ECDH, false, ['deriveKey']);
  let added = 0;
  for (const sealed of box) {
    try {
      const key = await inboxSealKey(sealed.epk, priv);
      const note = await decryptValue(sealed, key);
      addQuickTopic(note);
      added++;
    } catch { /* gehört zu einem anderen Tresor (z. B. nach Sicherung laden) */ }
  }
  await persistState(true);
  await idbDelete(INBOX_KEY).catch(() => {});
  return added;
}

function quickTitle(note) {
  const firstLine = (note.text || '').trim().split('\n')[0].replace(/\s+/g, ' ');
  if (firstLine) return firstLine.length > 42 ? firstLine.slice(0, 40).replace(/\s+\S*$/, '') + ' …' : firstLine;
  const d = new Date(note.createdAt || Date.now());
  return `${note.sketch ? 'Zeichnung' : 'Notiz'} vom ${d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
}

function addQuickTopic(note) {
  const when = note.createdAt || new Date().toISOString();
  const topic = {
    id: uid(), title: quickTitle(note), category: 'Schnellnotizen', content: note.text || '',
    sketches: note.sketch ? [note.sketch] : [], createdAt: when, updatedAt: when, deletedAt: null
  };
  state.topics.push(topic);
  return topic;
}

function updateQuickButton() {
  const btn = $('quickLockBtn');
  if (btn) btn.classList.toggle('hidden', !hasInboxKey() || !hasVaultConfig());
}

/* ---------- Bildschirm ---------- */
function openQuick(mode = 'new', attachId = null, tab = 'write', replace = false) {
  quickMode = mode;
  quickAttachId = attachId;
  quickReturn = cryptoKey ? (els.editorScreen.classList.contains('active') ? 'editor' : 'home') : 'lock';
  $('quickText').value = '';
  pad.clear();
  $('quickTitle').textContent = mode === 'attach' ? 'Zeichnung hinzufügen' : 'Schnellnotiz';
  $('quickTabs').classList.toggle('hidden', mode === 'attach');
  $('quickNote').textContent = cryptoKey
    ? (mode === 'attach' ? 'Die Zeichnung kommt in dein Thema.' : 'Landet in „Schnellnotizen“.')
    : 'Wird sofort verschlüsselt. Lesen kannst du sie erst nach dem Entsperren.';
  if (replace) history.replaceState({ rm: 'quick' }, ''); else history.pushState({ rm: 'quick' }, '');
  showScreen($('quickScreen'));
  setQuickTab(mode === 'attach' ? 'draw' : tab);
}

function setQuickTab(tab) {
  quickTab = tab;
  document.querySelectorAll('#quickTabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $('quickWrite').classList.toggle('hidden', tab !== 'write');
  $('quickDraw').classList.toggle('hidden', tab !== 'draw');
  if (tab === 'draw') { requestAnimationFrame(() => pad.resize()); $('quickText').blur(); }
  else setTimeout(() => $('quickText').focus(), 60);
}

function quickHasContent() { return Boolean($('quickText').value.trim()) || !pad.isEmpty(); }

async function saveQuick() {
  stopRecognition();
  const text = $('quickText').value.trim();
  const sketch = pad.isEmpty() ? null : pad.toDataURL();
  if (!text && !sketch) return false;
  const note = { text, sketch, createdAt: new Date().toISOString() };
  if (quickMode === 'attach' && cryptoKey) {
    const topic = state.topics.find(t => t.id === quickAttachId);
    if (topic && sketch) {
      topic.sketches = [...(topic.sketches || []), sketch];
      topic.updatedAt = note.createdAt;
      await persistState(true);
    }
  } else if (cryptoKey) {
    addQuickTopic(note);
    await persistState(true);
    renderTopics();
  } else {
    await sealToInbox(note);
  }
  $('quickText').value = '';
  pad.clear();
  return true;
}

async function leaveQuick({ save = true, viaHistory = false } = {}) {
  let saved = false;
  if (save) {
    try { saved = await saveQuick(); } catch { showToast('Speichern hat nicht geklappt. Versuch es nochmal.', 4000); return; }
  }
  stopRecognition();
  const back = quickReturn;
  if (!viaHistory && history.state?.rm === 'quick') { quickClosing = true; history.back(); }
  if (back === 'editor' && cryptoKey && quickAttachId) {
    showScreen(els.editorScreen);
    renderSketches();
  } else if (cryptoKey) {
    showScreen(els.homeScreen);
    renderTopics();
  } else {
    showScreen(els.lockScreen);
    configureLockScreen();
  }
  if (saved) showToast(cryptoKey ? 'Gespeichert' : 'Gespeichert und verschlüsselt. Du findest sie nach dem Entsperren in „Schnellnotizen“.', cryptoKey ? 1800 : 4200);
}
let quickClosing = false;

/* ---------- Zeichenfläche ---------- */
const pad = (() => {
  let canvas, ctx, strokes = [], current = null, dpr = 1;
  const INK = '#22253A', PAPER = '#FFFDF8';
  function init(c) {
    canvas = c; ctx = c.getContext('2d');
    c.addEventListener('pointerdown', e => {
      e.preventDefault();
      c.setPointerCapture(e.pointerId);
      current = { pts: [pt(e)], pen: e.pointerType === 'pen' };
      strokes.push(current);
      redraw();
    });
    c.addEventListener('pointermove', e => {
      if (!current) return;
      e.preventDefault();
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      evs.forEach(ev => current.pts.push(pt(ev)));
      drawLast();
    });
    const end = () => { current = null; updateButtons(); };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }
  function pt(e) {
    const r = canvas.getBoundingClientRect();
    const p = e.pressure && e.pointerType === 'pen' ? e.pressure : 0.5;
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, p };
  }
  function width(p, w) { return Math.max(1.2, (1.4 + p * 3.2) * (w / 390)); }
  function strokePath(s, W, H) {
    const pts = s.pts;
    if (pts.length === 1) {
      ctx.beginPath(); ctx.arc(pts[0].x * W, pts[0].y * H, width(pts[0].p, W) / 2, 0, 6.283); ctx.fill(); return;
    }
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      ctx.lineWidth = width((a.p + b.p) / 2, W);
      ctx.beginPath();
      if (i === 1) ctx.moveTo(a.x * W, a.y * H);
      else { const z = pts[i - 2]; ctx.moveTo(((z.x + a.x) / 2) * W, ((z.y + a.y) / 2) * H); }
      ctx.quadraticCurveTo(a.x * W, a.y * H, ((a.x + b.x) / 2) * W, ((a.y + b.y) / 2) * H);
      ctx.stroke();
    }
  }
  function setup(W, H) {
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = INK; ctx.fillStyle = INK; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  }
  function redraw() {
    if (!canvas) return;
    const W = canvas.width / dpr, H = canvas.height / dpr;
    setup(W, H);
    strokes.forEach(s => strokePath(s, W, H));
  }
  function drawLast() {
    const W = canvas.width / dpr, H = canvas.height / dpr;
    const s = current; const n = s.pts.length;
    if (n < 2) return;
    strokePath({ pts: s.pts.slice(Math.max(0, n - 3)) }, W, H);
  }
  function resize() {
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    if (!r.width) return;
    dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redraw();
  }
  function updateButtons() {
    $('padUndo').disabled = !strokes.length;
    $('padClear').disabled = !strokes.length;
  }
  return {
    init, resize,
    clear() { strokes = []; current = null; redraw(); if (canvas) updateButtons(); },
    undo() { strokes.pop(); redraw(); updateButtons(); },
    isEmpty() { return !strokes.length; },
    toDataURL() {
      // nur den bemalten Bereich (mit etwas Rand) speichern – kleine Datei, gute Vorschau
      const r = canvas.getBoundingClientRect();
      const aspect = r.height / r.width;
      let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
      strokes.forEach(st => st.pts.forEach(q => { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }));
      const m = 0.06;
      x0 = Math.max(0, x0 - m); x1 = Math.min(1, x1 + m);
      y0 = Math.max(0, y0 - m / aspect); y1 = Math.min(1, y1 + m / aspect);
      // nicht zu schmal oder zu flach
      if ((x1 - x0) < 0.35) { const c = (x0 + x1) / 2; x0 = Math.max(0, c - .175); x1 = Math.min(1, c + .175); }
      if ((y1 - y0) * aspect < 0.2) { const c = (y0 + y1) / 2, h = 0.1 / aspect; y0 = Math.max(0, c - h); y1 = Math.min(1, c + h); }
      const FW = 1100;
      const fullH = Math.round(FW * aspect);
      const sx = Math.round(x0 * FW), sy = Math.round(y0 * fullH);
      const W = Math.max(1, Math.round((x1 - x0) * FW)), H = Math.max(1, Math.round((y1 - y0) * fullH));
      const off = document.createElement('canvas'); off.width = W; off.height = H;
      const keep = { canvas, ctx, dpr };
      canvas = off; ctx = off.getContext('2d'); dpr = 1;
      ctx.translate(-sx, -sy);
      setup(FW, fullH); strokes.forEach(st => strokePath(st, FW, fullH));
      const url = off.toDataURL('image/png');
      ({ canvas, ctx, dpr } = keep);
      return url;
    }
  };
})();

/* ---------- Zeichnungen im Thema ---------- */
function renderSketches() {
  const box = $('sketchStrip');
  const topic = currentTopic();
  const list = topic?.sketches || [];
  box.classList.toggle('hidden', !list.length);
  box.innerHTML = list.map((src, i) => `<button type="button" class="sketch-thumb" data-i="${i}" aria-label="Zeichnung ${i + 1} ansehen"><img src="${src}" alt=""></button>`).join('');
  box.querySelectorAll('.sketch-thumb').forEach(b => b.addEventListener('click', () => openSketchViewer(Number(b.dataset.i))));
}

let viewerIndex = 0;
function openSketchViewer(i) {
  const topic = currentTopic();
  if (!topic?.sketches?.[i]) return;
  viewerIndex = i;
  $('sketchBig').src = topic.sketches[i];
  openSheet($('sketchSheet'));
}

async function deleteSketch() {
  const topic = currentTopic();
  if (!topic) return;
  const yes = await askConfirm('Zeichnung löschen?', 'Die Zeichnung wird aus diesem Thema entfernt.', 'Löschen');
  if (!yes) return;
  topic.sketches.splice(viewerIndex, 1);
  topic.updatedAt = new Date().toISOString();
  await persistState(true);
  renderSketches();
  showToast('Zeichnung gelöscht');
}

function closeProtectedOnHide() {
  const t = currentTopic();
  if (!t?.locked || !els.editorScreen.classList.contains('active')) return;
  // Ausnahmen: Sprach-Fenster beim Diktieren, Fingerabdruck, Teilen/Dateiauswahl
  if (dictWanted || biometricBusy || suppressLock) return;
  versionCheckpoint('leave');
  persistState(true).catch(() => {});
  openedProtected.delete(t.id);
  els.topicText.value = '';
  closeAnySheet(true);
  if (findOpen) closeFind();
  currentTopicId = null;
  history.replaceState({ rm: 'home' }, '');
  showScreen(els.homeScreen);
  renderTopics();
}

function wireQuick() {
  pad.init($('padCanvas'));
  window.addEventListener('resize', () => { if ($('quickScreen').classList.contains('active')) pad.resize(); });
  $('quickLockBtn').addEventListener('click', () => openQuick('new'));
  $('quickTabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setQuickTab(b.dataset.tab); });
  $('quickSaveBtn').addEventListener('click', async () => {
    if (!quickHasContent()) { showToast(quickTab === 'draw' ? 'Zeichne zuerst etwas' : 'Schreib oder sprich zuerst etwas'); return; }
    leaveQuick({ save: true });
  });
  $('quickCloseBtn').addEventListener('click', async () => {
    if (quickHasContent()) {
      const yes = await askConfirm('Verwerfen?', 'Was du gerade notiert hast, wird nicht gespeichert.', 'Verwerfen');
      if (!yes) return;
    }
    leaveQuick({ save: false });
  });
  $('quickMicBtn').addEventListener('click', () => { dictTarget = $('quickText'); dictMicBtn = $('quickMicBtn'); toggleRecognition(); });
  $('padUndo').addEventListener('click', () => pad.undo());
  $('padClear').addEventListener('click', () => pad.clear());
  $('sketchDeleteBtn').addEventListener('click', deleteSketch);
  $('sketchCloseBtn').addEventListener('click', () => closeSheet($('sketchSheet')));
  $('actionDrawBtn').addEventListener('click', () => {
    const id = actionTopicId;
    sheetSilentClose = true; els.actionSheet.close(); sheetSilentClose = false; openSheetEl = null;
    openQuick('attach', id, 'draw', history.state?.rm === 'sheet');
  });
}

/* =====================================================================
   Versionsverlauf: die letzten 10 Stände pro Thema (im verschlüsselten Tresor)
   ===================================================================== */

const MAX_VERSIONS = 10;
const BIG_DELETE = 150;               // so viele Zeichen auf einmal weg = vorher sichern
const VERSION_PAUSE_MS = 3 * 60 * 1000;
let verTopicId = null, verBaseline = '', verPrev = '', verTimer = null;

function versionStart(topic) {
  versionCheckpoint('leave');
  verTopicId = topic.id;
  verBaseline = topic.content || '';
  verPrev = verBaseline;
}

function pushVersion(topic, content, reason) {
  content = String(content || '');
  if (!content.trim()) return false;
  topic.versions = Array.isArray(topic.versions) ? topic.versions : [];
  if (topic.versions[0]?.content === content) return false;
  topic.versions.unshift({ at: new Date().toISOString(), content, reason });
  if (topic.versions.length > MAX_VERSIONS) topic.versions.length = MAX_VERSIONS;
  return true;
}

function versionOnInput(topic, value) {
  if (verTopicId !== topic.id) { verTopicId = topic.id; verBaseline = verPrev = topic.content || ''; }
  if (verPrev.length - value.length >= BIG_DELETE) {
    if (pushVersion(topic, verPrev, 'Vor dem Löschen')) verBaseline = value;
  }
  verPrev = value;
  clearTimeout(verTimer);
  verTimer = setTimeout(() => versionCheckpoint('pause'), VERSION_PAUSE_MS);
}

function versionCheckpoint(reason) {
  clearTimeout(verTimer);
  if (!verTopicId || !state) return;
  const t = state.topics.find(x => x.id === verTopicId);
  if (!t) { verTopicId = null; return; }
  if ((t.content || '') !== verBaseline) {
    pushVersion(t, verBaseline, reason === 'pause' ? 'Zwischenstand' : 'Früherer Stand');
    verBaseline = t.content || '';
    persistState().catch?.(() => {});
  }
  if (reason === 'leave') verTopicId = null;
}

function openVersions() {
  const topic = currentTopic();
  if (!topic) return;
  versionCheckpoint('pause');
  const list = topic.versions || [];
  $('versionsTitle').textContent = 'Frühere Versionen';
  $('versionsList').innerHTML = list.length
    ? list.map((v, i) => `<button type="button" class="sheet-item version-item" data-i="${i}">
        <strong>${escapeHtml(formatLong(v.at))}</strong>
        <small>${escapeHtml(v.reason || 'Früherer Stand')}, ${v.content.length.toLocaleString('de-DE')} Zeichen</small>
        <span>${escapeHtml(v.content.replace(/\s+/g, ' ').trim().slice(0, 90))}${v.content.length > 90 ? ' …' : ''}</span>
      </button>`).join('')
    : '<p class="sheet-text">Noch keine früheren Versionen. Reci mi hebt automatisch einen Stand auf, wenn du ein Thema verlässt, länger Pause machst oder viel Text auf einmal löschst.</p>';
  $('versionsList').querySelectorAll('.version-item').forEach(b => b.addEventListener('click', () => openVersionView(Number(b.dataset.i))));
  openSheet($('versionsSheet'));
}

let viewVersionIndex = 0;
function openVersionView(i) {
  const topic = currentTopic();
  const v = topic?.versions?.[i];
  if (!v) return;
  viewVersionIndex = i;
  $('versionViewTitle').textContent = formatLong(v.at);
  $('versionViewText').textContent = v.content;
  openSheet($('versionViewSheet'));
}

async function restoreVersion() {
  const topic = currentTopic();
  const v = topic?.versions?.[viewVersionIndex];
  if (!v) return;
  const restored = v.content;
  pushVersion(topic, topic.content || '', 'Vor dem Wiederherstellen');
  topic.content = restored;
  topic.updatedAt = new Date().toISOString();
  verTopicId = topic.id; verBaseline = verPrev = restored;
  els.topicText.value = restored;
  resetEditHistory(restored);
  els.dateLine.textContent = formatLong(topic.updatedAt);
  await persistState(true);
  closeSheet($('versionViewSheet'));
  if (findOpen) renderFind();
  showToast('Version wiederhergestellt. Der vorige Stand ist auch als Version aufgehoben.', 3500);
}

/* =====================================================================
   Anheften und Teilen
   ===================================================================== */

async function togglePin(id) {
  const t = state?.topics.find(x => x.id === id);
  if (!t) return;
  closeSheet(els.actionSheet);
  t.pinned = !t.pinned;
  await persistState(true);
  renderTopics();
  showToast(t.pinned ? 'Oben angeheftet' : 'Nicht mehr angeheftet');
}

async function dataUrlToFile(url, name) {
  const blob = await (await fetch(url)).blob();
  return new File([blob], name, { type: blob.type || 'image/png' });
}

async function shareTopic(id) {
  const t = state?.topics.find(x => x.id === id);
  if (!t) return;
  if (t.locked) {
    const yes = await askConfirm('Geschütztes Thema teilen?', 'Der Text verlässt dann Reci mi und ist dort nicht mehr geschützt.', 'Teilen');
    if (!yes) return;
  } else {
    closeSheet(els.actionSheet);
  }
  const text = (t.content || '').trim();
  const payload = { title: t.title, text: text ? `${t.title}\n\n${text}` : t.title };
  try {
    if (t.sketches?.length && navigator.canShare) {
      const files = await Promise.all(t.sketches.map((s, i) => dataUrlToFile(s, `Zeichnung-${i + 1}.png`)));
      if (navigator.canShare({ ...payload, files })) payload.files = files;
    }
    if (navigator.share) {
      suppressLock = true;
      await navigator.share(payload);
      return;
    }
    throw new Error('kein Teilen');
  } catch (err) {
    if (err?.name === 'AbortError') return;
    try { await navigator.clipboard.writeText(payload.text); showToast('Teilen geht hier nicht. Der Text ist kopiert, du kannst ihn einfügen.', 4000); }
    catch { showToast('Teilen geht hier leider nicht.'); }
  } finally {
    setTimeout(() => { suppressLock = false; }, 1500);
  }
}

/* =====================================================================
   Im Text suchen (mit Markierung)
   ===================================================================== */

let findOpen = false, findMatches = [], findIndex = 0;

function openFind() {
  closeSheet(els.actionSheet);
  stopReading();
  findOpen = true;
  $('findBar').classList.remove('hidden');
  $('findInput').value = '';
  renderFind();
  setTimeout(() => $('findInput').focus(), 120);
}

function closeFind() {
  findOpen = false;
  findMatches = [];
  $('findBar').classList.add('hidden');
  renderHighlights([], -1);
}

function renderFind(jump = true) {
  const q = $('findInput').value.trim().toLowerCase();
  const text = els.topicText.value;
  findMatches = [];
  if (q.length) {
    const low = text.toLowerCase();
    let i = low.indexOf(q);
    while (i !== -1) { findMatches.push([i, i + q.length]); i = low.indexOf(q, i + q.length); }
  }
  if (findIndex >= findMatches.length) findIndex = 0;
  $('findCount').textContent = !q ? '' : findMatches.length ? `${findIndex + 1} von ${findMatches.length}` : 'Nichts gefunden';
  $('findPrev').disabled = $('findNext').disabled = findMatches.length < 2;
  renderHighlights(findMatches, findMatches.length ? findIndex : -1, jump);
}

function findStep(dir) {
  if (!findMatches.length) return;
  findIndex = (findIndex + dir + findMatches.length) % findMatches.length;
  $('findCount').textContent = `${findIndex + 1} von ${findMatches.length}`;
  renderHighlights(findMatches, findIndex, true);
}

// Zeichnet Markierungen hinter das Textfeld und scrollt zur aktuellen Stelle
function renderHighlights(ranges, current, jump = false) {
  const layer = $('hlLayer');
  const ta = els.topicText;
  if (!ranges.length) { layer.innerHTML = ''; layer.classList.add('hidden'); return; }
  const text = ta.value;
  let html = '', pos = 0;
  ranges.forEach(([a, b], i) => {
    html += escapeHtml(text.slice(pos, a)) + `<mark${i === current ? ' class="cur"' : ''}>${escapeHtml(text.slice(a, b))}</mark>`;
    pos = b;
  });
  html += escapeHtml(text.slice(pos)) + '\n';
  layer.innerHTML = html;
  layer.classList.remove('hidden');
  if (jump && current >= 0) {
    const mark = layer.querySelector('mark.cur');
    if (mark) ta.scrollTop = Math.max(0, mark.offsetTop - ta.clientHeight * 0.35);
  }
  layer.scrollTop = ta.scrollTop;
}

/* =====================================================================
   Vorlese-Player (Satz für Satz)
   ===================================================================== */

const TTS_RATES = [0.8, 1, 1.2, 1.5];
const tts = {
  sentences: [], idx: 0, playing: false, token: 0,
  rate: Number(localStorage.getItem('rm_tts_rate')) || 1,
  voice: localStorage.getItem('rm_tts_voice') || ''
};

function splitSentences(text) {
  const out = [];
  const re = /[^.!?…\n]+(?:[.!?…]+["“”»«')\]]*)?|\n+/g;
  let m;
  while ((m = re.exec(text))) {
    const raw = m[0];
    if (!raw.trim()) continue;
    const lead = raw.length - raw.trimStart().length;
    out.push({ start: m.index + lead, end: m.index + raw.trimEnd().length, text: raw.trim() });
  }
  return out;
}

function germanVoices() {
  const all = ('speechSynthesis' in window) ? speechSynthesis.getVoices() : [];
  const de = all.filter(v => (v.lang || '').toLowerCase().startsWith('de'));
  return de.length ? de : all;
}

function fillVoices() {
  const sel = $('playerVoice');
  const voices = germanVoices();
  sel.innerHTML = voices.map(v => `<option value="${escapeHtml(v.voiceURI)}">${escapeHtml(v.name.replace(/^(Google|Samsung|Microsoft)\s+/i, ''))}</option>`).join('');
  if (tts.voice && voices.some(v => v.voiceURI === tts.voice)) sel.value = tts.voice;
  sel.classList.toggle('hidden', voices.length < 2);
}

function openPlayer() {
  if (!('speechSynthesis' in window)) return showToast('Vorlesen geht auf diesem Gerät nicht');
  const topic = currentTopic();
  const text = combinedTopicText(topic);
  if (!text.trim()) return showToast('Hier steht noch nichts');
  stopRecognition();
  if (findOpen) closeFind();
  tts.sentences = splitSentences(text);
  // Wenn der Cursor im Text steht, ab diesem Satz vorlesen
  const caret = document.activeElement === els.topicText ? els.topicText.selectionStart : 0;
  tts.idx = Math.max(0, tts.sentences.findIndex(s => s.end >= caret));
  fillVoices();
  $('playerSpeed').textContent = `${String(tts.rate).replace('.', ',')}×`;
  $('player').classList.remove('hidden');
  els.readBtn.classList.add('active');
  tts.playing = true;
  speakCurrent();
}

function speakCurrent() {
  const tok = ++tts.token;
  speechSynthesis.cancel();
  const s = tts.sentences[tts.idx];
  if (!s) return finishPlayer();
  const u = new SpeechSynthesisUtterance(s.text);
  u.lang = 'de-DE';
  u.rate = tts.rate;
  const v = germanVoices().find(x => x.voiceURI === tts.voice);
  if (v) { u.voice = v; u.lang = v.lang; }
  u.onend = () => {
    if (tok !== tts.token || !tts.playing) return;
    if (tts.idx + 1 >= tts.sentences.length) return finishPlayer();
    tts.idx++;
    speakCurrent();
  };
  u.onerror = e => {
    if (tok !== tts.token || e.error === 'interrupted' || e.error === 'canceled') return;
    tts.playing = false; updatePlayerUi();
  };
  // kleiner Abstand, sonst verschluckt Android manchmal den Anfang
  setTimeout(() => { if (tok === tts.token) speechSynthesis.speak(u); }, 60);
  updatePlayerUi();
}

function updatePlayerUi() {
  const n = tts.sentences.length;
  $('playerInfo').textContent = n ? `Satz ${Math.min(tts.idx + 1, n)} von ${n}` : '';
  $('playerPlay').classList.toggle('paused', !tts.playing);
  $('playerPlay').setAttribute('aria-label', tts.playing ? 'Pause' : 'Weiter');
  const s = tts.sentences[tts.idx];
  if (s && !findOpen) renderHighlights([[s.start, s.end]], 0, true);
}

function finishPlayer() {
  tts.playing = false;
  tts.token++;
  tts.idx = 0;
  updatePlayerUi();
  $('playerInfo').textContent = 'Fertig vorgelesen';
  renderHighlights([], -1);
}

function playerToggle() {
  if (tts.playing) { tts.playing = false; tts.token++; speechSynthesis.cancel(); updatePlayerUi(); }
  else { tts.playing = true; speakCurrent(); }
}
function playerJump(dir) {
  tts.idx = Math.min(Math.max(0, tts.idx + dir), Math.max(0, tts.sentences.length - 1));
  if (tts.playing) speakCurrent(); else updatePlayerUi();
}
function playerSpeed() {
  const i = TTS_RATES.indexOf(tts.rate);
  tts.rate = TTS_RATES[(i + 1) % TTS_RATES.length];
  localStorage.setItem('rm_tts_rate', String(tts.rate));
  $('playerSpeed').textContent = `${String(tts.rate).replace('.', ',')}×`;
  if (tts.playing) speakCurrent();
}

/* =====================================================================
   Sicherung: Anzeige und dezente Erinnerung
   ===================================================================== */

const LS_LAST_BACKUP = 'rm_last_backup';
const LS_BACKUP_SNOOZE = 'rm_backup_snooze';
const BACKUP_REMIND_DAYS = 14;

function daysSince(ts) { return Math.floor((Date.now() - ts) / 86400000); }

function backupAgeText() {
  const ts = Number(localStorage.getItem(LS_LAST_BACKUP) || 0);
  if (!ts) return 'Noch nie gesichert';
  const d = daysSince(ts);
  return d === 0 ? 'Letzte Sicherung: heute' : d === 1 ? 'Letzte Sicherung: gestern' : `Letzte Sicherung: vor ${d} Tagen`;
}

function maybeShowBackupCard() {
  const card = $('backupCard');
  if (!state || !card) return;
  const ts = Number(localStorage.getItem(LS_LAST_BACKUP) || 0);
  const snooze = Number(localStorage.getItem(LS_BACKUP_SNOOZE) || 0);
  const created = new Date(state.createdAt || Date.now()).getTime();
  const hasContent = activeTopics().some(t => (t.content || '').trim() || t.sketches?.length);
  const due = ts ? daysSince(ts) >= BACKUP_REMIND_DAYS : daysSince(created) >= 7;
  const show = hasContent && due && Date.now() > snooze;
  card.classList.toggle('hidden', !show);
  if (show) $('backupCardText').textContent = ts ? `Deine letzte Sicherung ist ${daysSince(ts)} Tage her.` : 'Du hast noch nie eine Sicherung gemacht.';
}

function wireV22() {
  $('versionsList');
  $('actionVersionsBtn').addEventListener('click', openVersions);
  $('versionRestoreBtn').addEventListener('click', restoreVersion);
  $('versionBackBtn').addEventListener('click', () => openVersions());
  $('versionsCloseBtn').addEventListener('click', () => closeSheet($('versionsSheet')));
  $('actionPinBtn').addEventListener('click', () => togglePin(actionTopicId));
  $('actionShareBtn').addEventListener('click', () => shareTopic(actionTopicId));
  $('actionFindBtn').addEventListener('click', openFind);
  $('findInput').addEventListener('input', () => { findIndex = 0; renderFind(); });
  $('findInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); findStep(e.shiftKey ? -1 : 1); } });
  $('findNext').addEventListener('click', () => findStep(1));
  $('findPrev').addEventListener('click', () => findStep(-1));
  $('findClose').addEventListener('click', closeFind);
  els.topicText.addEventListener('scroll', () => { $('hlLayer').scrollTop = els.topicText.scrollTop; });
  $('playerPlay').addEventListener('click', playerToggle);
  $('playerPrev').addEventListener('click', () => playerJump(-1));
  $('playerNext').addEventListener('click', () => playerJump(1));
  $('playerSpeed').addEventListener('click', playerSpeed);
  $('playerVoice').addEventListener('change', e => { tts.voice = e.target.value; localStorage.setItem('rm_tts_voice', tts.voice); if (tts.playing) speakCurrent(); });
  $('playerClose').addEventListener('click', stopReading);
  if ('speechSynthesis' in window) speechSynthesis.addEventListener?.('voiceschanged', () => { if (!$('player').classList.contains('hidden')) fillVoices(); });
  $('backupLater').addEventListener('click', () => { localStorage.setItem(LS_BACKUP_SNOOZE, String(Date.now() + 3 * 86400000)); $('backupCard').classList.add('hidden'); });
  $('backupNow').addEventListener('click', async () => { await exportBackup(); $('backupCard').classList.add('hidden'); });
}

/* =====================================================================
   2.5: Schnellnotiz anhängen, Diktat rückgängig, Notfallkopie, PIN ändern
   ===================================================================== */

/* ---------- Schnellnotiz an ein bestehendes Thema anhängen ---------- */
let attachSourceId = null;

function openAttachPicker(sourceId) {
  const src = state?.topics.find(t => t.id === sourceId);
  if (!src) return;
  attachSourceId = sourceId;
  const targets = activeTopics().filter(t => t.id !== sourceId && t.category !== 'Schnellnotizen')
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || new Date(b.updatedAt) - new Date(a.updatedAt));
  $('attachList').innerHTML = targets.length
    ? targets.map(t => `<button type="button" class="sheet-item attach-item" data-id="${escapeHtml(t.id)}">${dotHtml(catOf(t))}<span>${t.pinned ? PIN_ICON : ''}${t.locked ? LOCK_ICON : ''}${escapeHtml(t.title)}</span></button>`).join('')
    : '<p class="sheet-text">Es gibt noch kein anderes Thema. Leg zuerst ein Thema an.</p>';
  $('attachList').querySelectorAll('.attach-item').forEach(b => b.addEventListener('click', () => attachToTopic(b.dataset.id)));
  openSheet($('attachSheet'));
}

async function attachToTopic(targetId) {
  const src = state?.topics.find(t => t.id === attachSourceId);
  const target = state?.topics.find(t => t.id === targetId);
  if (!src || !target) return;
  const add = (src.content || '').trim();
  const old = target.content || '';
  pushVersion(target, old, 'Vor dem Anhängen');
  if (add) target.content = old.replace(/\s+$/, '') + (old.trim() ? '\n\n' : '') + add;
  if (src.sketches?.length) target.sketches = [...(target.sketches || []), ...src.sketches];
  target.updatedAt = new Date().toISOString();
  state.topics = state.topics.filter(t => t.id !== src.id);
  await persistState(true);
  closeSheet($('attachSheet'));
  renderTopics();
  showToast(`An „${target.title}“ angehängt`);
  attachSourceId = null;
}

/* ---------- Diktat: letztes Stück rückgängig ---------- */
let lastDictUndo = null;
let dictUndoTimer = null;

function rememberDictUndo(entry) {
  // Alles seit der letzten Sprechpause zählt als ein Stück
  const prev = lastDictUndo;
  if (prev && prev.ta === entry.ta && prev.after === entry.before && Date.now() - prev.t < 2500) {
    entry.before = prev.before; entry.pos = prev.pos; entry.auto = prev.auto;
  }
  entry.t = Date.now();
  lastDictUndo = entry;
  const pill = $('dictUndo');
  pill.classList.remove('hidden');
  clearTimeout(dictUndoTimer);
  dictUndoTimer = setTimeout(() => pill.classList.add('hidden'), 7000);
}

function undoLastDictation() {
  const u = lastDictUndo;
  $('dictUndo').classList.add('hidden');
  if (!u) return;
  if (u.ta.value !== u.after) { showToast('Der Text wurde inzwischen geändert. Rückgängig geht hier nicht mehr.', 3500); lastDictUndo = null; return; }
  clearTimeout(dictSentenceTimer);
  dictSentenceTimer = null;
  u.ta.value = u.before;
  dictInsertPos = u.pos;
  dictLastAuto = u.auto;
  try { u.ta.setSelectionRange(u.pos, u.pos); } catch {}
  u.ta.dispatchEvent(new Event('input', { bubbles: true }));
  lastDictUndo = null;
  showToast('Letztes Stück entfernt');
}

/* ---------- Notfallkopie ---------- */
const EMERGENCY_KEY = 'emergency-copy';

async function makeEmergencyCopy(reason) {
  try {
    if (cryptoKey && state) await persistState(true);
    const copy = {
      at: new Date().toISOString(), reason,
      salt: localStorage.getItem(CONFIG_SALT),
      verifier: localStorage.getItem(CONFIG_VERIFIER),
      vault: await idbGet(VAULT_KEY)
    };
    if (copy.salt && copy.verifier && copy.vault) await idbSet(EMERGENCY_KEY, copy);
  } catch {}
}

async function updateEmergencyMenu() {
  const copy = await idbGet(EMERGENCY_KEY).catch(() => null);
  const btn = $('emergencyBtn');
  btn.classList.toggle('hidden', !copy);
  if (copy) $('emergencyAge').textContent = `${copy.reason}, ${formatLong(copy.at)}`;
}

async function restoreEmergencyCopy() {
  const copy = await idbGet(EMERGENCY_KEY).catch(() => null);
  if (!copy) return;
  const yes = await askConfirm('Notfallkopie zurückholen?',
    `Reci mi geht zurück auf den Stand vom ${formatLong(copy.at)} (${copy.reason}). Danach entsperrst du mit der PIN, die damals galt.`, 'Zurückholen');
  if (!yes) return;
  clearTimeout(saveTimer); cryptoKey = null; state = null;
  localStorage.setItem(CONFIG_SALT, copy.salt);
  localStorage.setItem(CONFIG_VERIFIER, copy.verifier);
  localStorage.removeItem(BIOMETRIC_CONFIG);
  await idbDelete(BIOMETRIC_KEY).catch(() => {});
  await idbSet(VAULT_KEY, copy.vault);
  lockApp('Notfallkopie zurückgeholt. Bitte mit der damaligen PIN entsperren.');
}

/* ---------- PIN ändern (neue PINs immer 6 Ziffern) ---------- */
function openPinChange() {
  ['pinOld', 'pinNew', 'pinNew2'].forEach(id => { $(id).value = ''; });
  $('pinChangeHint').textContent = '';
  openSheet($('pinSheet'));
  setTimeout(() => $('pinOld').focus(), 100);
}

async function changePin() {
  const oldPin = $('pinOld').value.trim();
  const p1 = $('pinNew').value.trim();
  const p2 = $('pinNew2').value.trim();
  const hint = $('pinChangeHint');
  if (!/^\d{6}$/.test(p1)) { hint.textContent = 'Die neue PIN braucht genau 6 Ziffern.'; return; }
  if (p1 !== p2) { hint.textContent = 'Die beiden neuen PINs sind nicht gleich.'; return; }
  const btn = $('pinChangeOk');
  btn.disabled = true;
  hint.textContent = '';
  try {
    if (!(await verifyPin(oldPin))) { hint.textContent = 'Die jetzige PIN stimmt nicht.'; return; }
    await makeEmergencyCopy('Vor dem PIN-Wechsel');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(p1, salt);
    const verifier = await encryptValue({ ok: true, marker: 'reci-mi' }, key);
    const vault = await encryptValue(state, key);
    await idbSet(VAULT_KEY, vault);
    localStorage.setItem(CONFIG_SALT, bytesToBase64(salt));
    localStorage.setItem(CONFIG_VERIFIER, JSON.stringify(verifier));
    cryptoKey = key;
    if (hasBiometricConfig()) await idbSet(BIOMETRIC_KEY, key).catch(() => {});
    await idbSet(SESSION_KEY, key).catch(() => {});
    closeSheet($('pinSheet'));
    showToast('Neue PIN ist gespeichert. Mach am besten gleich eine neue Sicherung.', 4000);
  } catch {
    hint.textContent = 'Das hat nicht geklappt. Deine alte PIN gilt weiter.';
  } finally {
    btn.disabled = false;
  }
}

function wireV25() {
  $('actionAttachBtn').addEventListener('click', () => openAttachPicker(actionTopicId));
  $('attachCancelBtn').addEventListener('click', () => closeSheet($('attachSheet')));
  $('dictUndo').addEventListener('click', undoLastDictation);
  $('emergencyBtn').addEventListener('click', restoreEmergencyCopy);
  $('pinMenuBtn').addEventListener('click', openPinChange);
  $('pinChangeForm').addEventListener('submit', e => { e.preventDefault(); changePin(); });
  $('pinChangeCancel').addEventListener('click', () => closeSheet($('pinSheet')));
}

/* =====================================================================
   Sicherung
   ===================================================================== */

async function exportBackup() {
  await persistState(true);
  const payload = {
    format: 'ReciMi-Backup', version: 1, appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    salt: localStorage.getItem(CONFIG_SALT),
    verifier: JSON.parse(localStorage.getItem(CONFIG_VERIFIER)),
    vault: await idbGet(VAULT_KEY)
  };
  suppressLock = true;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Reci-mi-Sicherung-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => { URL.revokeObjectURL(url); suppressLock = false; }, 4000);
  localStorage.setItem(LS_LAST_BACKUP, String(Date.now()));
  maybeShowBackupCard();
  showToast('Sicherung gespeichert (verschlüsselt). Sie liegt im Ordner Downloads.', 3500);
}


let pendingBackupCheck = null;

function parseBackupPayload(text) {
  const parsed = JSON.parse(text);
  if (parsed.format !== 'ReciMi-Backup' || !parsed.salt || !parsed.verifier || !parsed.vault) throw new Error('invalid');
  if (!parsed.verifier.iv || !parsed.verifier.data || !parsed.vault.iv || !parsed.vault.data) throw new Error('invalid');
  return parsed;
}

async function openBackupCheck(file) {
  let parsed;
  try {
    parsed = parseBackupPayload(await file.text());
  } catch {
    pendingBackupCheck = null;
    return showToast('Diese Datei ist keine gültige Reci-mi-Sicherung', 3500);
  }
  pendingBackupCheck = parsed;
  const when = parsed.exportedAt ? formatLong(parsed.exportedAt) : 'Datum unbekannt';
  const fromVersion = parsed.appVersion ? `Version ${parsed.appVersion}` : 'App-Version unbekannt';
  $('backupCheckMeta').textContent = `Datei erkannt. Gespeichert: ${when}. ${fromVersion}. Dabei wird nichts verändert.`;
  $('backupCheckPin').value = '';
  $('backupCheckHint').textContent = 'Gib die PIN dieser Sicherung ein, um zu prüfen, ob sie wirklich entschlüsselt werden kann.';
  $('backupCheckOk').disabled = false;
  openSheet($('backupCheckSheet'));
  setTimeout(() => $('backupCheckPin').focus(), 100);
}

async function verifyBackupCheck() {
  const parsed = pendingBackupCheck;
  if (!parsed) return;
  const pin = $('backupCheckPin').value.trim();
  const hint = $('backupCheckHint');
  if (!/^\d{4,6}$/.test(pin)) {
    hint.textContent = 'Bitte die PIN der Sicherung eingeben.';
    return;
  }
  $('backupCheckOk').disabled = true;
  hint.textContent = 'Prüfe Sicherung …';
  try {
    const key = await deriveKey(pin, base64ToBytes(parsed.salt));
    const verifier = await decryptValue(parsed.verifier, key);
    if (!verifier || verifier.marker !== 'reci-mi') throw new Error('pin');
    const vault = await decryptValue(parsed.vault, key);
    if (!vault || !Array.isArray(vault.topics)) throw new Error('vault');
    const active = vault.topics.filter(t => !t.deletedAt).length;
    const deleted = vault.topics.filter(t => Boolean(t.deletedAt)).length;
    const totalText = vault.topics.reduce((n, t) => n + String(t.content || '').length, 0);
    const memories = Array.isArray(vault.memory?.entries) ? vault.memory.entries.length : 0;
    hint.textContent = `Sicherung ist vollständig lesbar: ${active} Themen${deleted ? `, ${deleted} im Papierkorb` : ''}, ${totalText.toLocaleString('de-DE')} Textzeichen${memories ? ` und ${memories} Gedanken` : ''}. Deine aktuellen Daten wurden nicht verändert.`;
  } catch {
    hint.textContent = 'Die Sicherung konnte mit dieser PIN nicht entschlüsselt werden. Prüfe die PIN oder wähle eine andere Sicherungsdatei.';
  } finally {
    $('backupCheckOk').disabled = false;
  }
}

async function importBackup(file) {
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
    if (parsed.format !== 'ReciMi-Backup' || !parsed.salt || !parsed.verifier || !parsed.vault) throw new Error();
  } catch {
    return showToast('Diese Datei ist keine Reci-mi-Sicherung');
  }
  const yes = await askConfirm('Sicherung laden?', 'Alles, was jetzt auf diesem Gerät ist, wird durch die Sicherung ersetzt. Danach brauchst du die PIN aus der Sicherung.', 'Laden');
  if (!yes) return;
  await makeEmergencyCopy('Vor dem Laden einer Sicherung');
  // Wichtig: aktuellen Stand nicht mehr speichern, sonst überschreibt er die geladene Sicherung
  clearTimeout(saveTimer); cryptoKey = null; state = null;
  localStorage.setItem(CONFIG_SALT, parsed.salt);
  localStorage.setItem(CONFIG_VERIFIER, JSON.stringify(parsed.verifier));
  localStorage.removeItem(BIOMETRIC_CONFIG);
  await idbDelete(BIOMETRIC_KEY).catch(() => {});
  await idbSet(VAULT_KEY, parsed.vault);
  lockApp('Sicherung geladen. Bitte einmal mit der PIN dieser Sicherung entsperren. Dein vorheriger Stand liegt als Notfallkopie im Menü.');
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(reg => reg.update()).catch(() => {}));
  }
}

/* =====================================================================
   Ereignisse
   ===================================================================== */

function wireEvents() {
  els.pinForm.addEventListener('submit', async e => {
    e.preventDefault();
    const pin = els.pinInput.value.trim();
    const firstSetup = !hasVaultConfig();
    if (firstSetup ? !/^\d{6}$/.test(pin) : !/^\d{4,6}$/.test(pin)) { els.lockHint.textContent = firstSetup ? 'Die neue PIN braucht genau 6 Ziffern.' : 'Bitte deine PIN eingeben (4 bis 6 Ziffern).'; return; }
    els.pinSubmit.disabled = true;
    els.lockHint.textContent = '';
    try {
      if (!hasVaultConfig()) {
        if (pin !== els.pinConfirm.value.trim()) throw new Error('Die beiden PINs sind nicht gleich.');
        await setupVault(pin);
      } else {
        await unlockVault(pin);
      }
      els.pinInput.value = '';
      els.pinConfirm.value = '';
      els.pinInput.blur();
      await startSession();
      showUnlocked(readResume());
    } catch (err) {
      els.lockHint.textContent = err.message === 'Falsche PIN' ? 'Die PIN stimmt nicht. Versuch es nochmal.' : (err.message || 'Entsperren hat nicht geklappt.');
      cryptoKey = null;
      state = null;
    } finally {
      els.pinSubmit.disabled = false;
    }
  });

  els.moonBtn.addEventListener('click', () => {
    if (hasBiometricConfig()) unlockWithBiometrics();
    else if (!els.pinForm.classList.contains('hidden')) els.pinInput.focus();
  });
  els.showPinBtn.addEventListener('click', () => {
    els.pinForm.classList.remove('hidden');
    els.showPinBtn.classList.add('hidden');
    els.pinInput.focus();
  });

  els.newTopicBtn.addEventListener('click', () => openTopicSheet('create'));
  wireThoughtWorld();
  els.manageCategoriesBtn.addEventListener('click', openCategoryManager);
  els.categoryForm.addEventListener('submit', e => { e.preventDefault(); saveCategoryManager(); });
  els.categoryCloseBtn.addEventListener('click', () => closeSheet(els.categorySheet));
  els.categoryManageList.addEventListener('click', e => {
    const row = e.target.closest('.category-manage-row'); if (!row) return;
    const name = row.dataset.name;
    if (e.target.closest('.category-edit')) { editingCategoryName = name; els.categoryName.value = name; els.categorySaveBtn.textContent = 'Speichern'; els.categoryName.focus(); }
    if (e.target.closest('.category-delete')) deleteCustomCategory(name);
  });
  els.catPicker.addEventListener('click', e => { const b = e.target.closest('.cat'); if (!b) return; if (b.dataset.action === 'add-category') { closeSheet(els.topicSheet); openCategoryManager(); return; } selectCategory(b.dataset.cat); });
  els.topicForm.addEventListener('submit', e => { e.preventDefault(); saveTopicSheet(); });
  els.cancelTopicBtn.addEventListener('click', () => closeSheet(els.topicSheet));

  els.actionOpenBtn.addEventListener('click', () => {
    const id = actionTopicId;
    const t = state?.topics.find(x => x.id === id);
    if (t?.locked && !openedProtected.has(id)) return requestProtectedAccess(id, 'open');
    closeSheetAndReplace(els.actionSheet, { rm: 'editor', id });
    openTopic(id, { push: false });
  });
  els.actionRenameBtn.addEventListener('click', () => openTopicSheet('edit', actionTopicId));
  $('actionArchiveBtn').addEventListener('click', () => toggleArchiveTopic(actionTopicId));
  $('actionMergeBtn').addEventListener('click', () => openMergePicker(actionTopicId));
  $('actionMarkersBtn').addEventListener('click', openMarkers);
  $('actionProtectBtn').addEventListener('click', () => toggleProtection(actionTopicId));
  $('protectForm').addEventListener('submit', e => { e.preventDefault(); protectWithPin(); });
  $('protectBioBtn').addEventListener('click', protectWithFingerprint);
  $('protectCancelBtn').addEventListener('click', () => { protectRequest = null; closeSheet($('protectSheet')); });
  els.actionTrashBtn.addEventListener('click', () => {
    const id = actionTopicId;
    const t = state?.topics.find(x => x.id === id);
    if (t?.locked && !openedProtected.has(id)) return requestProtectedAccess(id, 'trash');
    if (els.editorScreen.classList.contains('active') && currentTopicId === id) {
      // Blatt-Eintrag durch nichts ersetzen, dann zurück zur Startseite
      closeSheetAndReplace(els.actionSheet, { rm: 'editor', id });
    } else {
      closeSheet(els.actionSheet);
    }
    moveTopicToTrash(id);
  });
  els.actionCancelBtn.addEventListener('click', () => closeSheet(els.actionSheet));
  $('mergeCloseBtn').addEventListener('click', () => { mergeSourceId = null; closeSheet($('mergeSheet')); });
  $('markerForm').addEventListener('submit', e => { e.preventDefault(); addMarkerHere(); });
  $('markersCloseBtn').addEventListener('click', () => closeSheet($('markersSheet')));

  els.filterRow.addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    if (chip.dataset.action === 'add-category') { openCategoryManager(); return; }
    currentFilter = chip.dataset.filter;
    els.filterRow.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c === chip));
    renderTopics();
  });
  els.searchInput.addEventListener('input', renderTopics);

  els.bioCardLater.addEventListener('click', () => { localStorage.setItem(LS_BIO_CARD, '1'); els.bioCard.classList.add('hidden'); });
  els.bioCardSetup.addEventListener('click', async () => { await enableBiometrics(); maybeShowBioCard(); });

  els.backBtn.addEventListener('click', goHomeFromScreen);
  els.editorHomeBtn.addEventListener('click', jumpHome);
  els.trashBackBtn.addEventListener('click', goHomeFromScreen);
  els.trashHomeBtn.addEventListener('click', jumpHome);
  els.editBtn.addEventListener('click', () => { if (editorMode === 'list') setEditorMode('text', { focus: true }); else setEditing(els.topicText.readOnly, true); });
  els.copyBtn.addEventListener('click', copyAll);
  els.readBtn.addEventListener('click', readText);
  els.deleteBtn.addEventListener('click', () => { if (currentTopicId) moveTopicToTrash(currentTopicId); });
  els.micBtn.addEventListener('click', () => {
    if (editorMode === 'list') { dictTarget = els.checklistInput; dictMicBtn = els.micBtn; }
    else { dictTarget = null; dictMicBtn = null; }
    toggleRecognition();
  });
  wireQuick();
  wireV22();
  wireV25();
  els.editorMenuBtn.addEventListener('click', () => openActionSheet(currentTopicId));
  els.textModeBtn.addEventListener('click', () => { if (dictWanted || isListening) stopRecognition(); setEditorMode('text', { focus: true }); });
  els.listModeBtn.addEventListener('click', () => { if (dictWanted || isListening) stopRecognition(); setEditorMode('list', { focus: true }); });
  els.checklistForm.addEventListener('submit', e => { e.preventDefault(); addChecklistItem(); });
  els.checklistList.addEventListener('change', e => {
    const row = e.target.closest('.checklist-item');
    if (row && e.target.matches('.checklist-check')) updateChecklistItem(row.dataset.id, { done: e.target.checked });
  });
  els.checklistList.addEventListener('click', e => {
    const row = e.target.closest('.checklist-item');
    if (row && e.target.closest('.checklist-delete')) removeChecklistItem(row.dataset.id);
  });

  els.topicText.addEventListener('input', () => {
    const topic = currentTopic();
    if (!topic) return;
    const previousContent = topic.content || '';
    recordEditorChange(previousContent);
    versionOnInput(topic, els.topicText.value);
    adjustMarkersForEdit(topic, previousContent, els.topicText.value);
    topic.content = els.topicText.value;
    topic.updatedAt = new Date().toISOString();
    if (findOpen) renderFind(false);
    els.dateLine.textContent = formatLong(topic.updatedAt);
    editPrevSnapshot = editorSnapshot(els.topicText.value);
    rememberEditorPosition();
    updateEditHistoryButtons();
    persistState();
  });

  ['keyup', 'click', 'select'].forEach(ev => els.topicText.addEventListener(ev, () => { syncEditSnapshotPosition(); rememberEditorPosition(); }));
  els.topicText.addEventListener('scroll', () => { syncEditSnapshotPosition(); rememberEditorPosition(); });
  els.undoBtn.addEventListener('click', undoEdit);
  els.redoBtn.addEventListener('click', redoEdit);
  els.endBtn.addEventListener('click', goEditorEnd);

  els.menuBtn.addEventListener('click', () => { updateBiometricUi(); $('backupAge').textContent = backupAgeText(); updateEmergencyMenu(); openSheet(els.menuSheet); });
  $('openArchiveBtn').addEventListener('click', openArchive);
  $('archiveCloseBtn').addEventListener('click', () => closeSheet($('archiveSheet')));
  els.openTrashBtn.addEventListener('click', () => { closeSheetAndReplace(els.menuSheet, { rm: 'trash' }); openTrash({ push: false }); });
  els.biometricMenuBtn.addEventListener('click', async () => {
    if (hasBiometricConfig()) { disableBiometrics(); }
    else { closeSheet(els.menuSheet); await enableBiometrics(); maybeShowBioCard(); }
  });
  $('placeMenuBtn').addEventListener('click', openPlaceSheet);
  $('placeForm').addEventListener('submit', e => { e.preventDefault(); searchPlace(); });
  $('placeGpsBtn').addEventListener('click', useMyLocation);
  $('placeOffBtn').addEventListener('click', () => choosePlace(null));
  $('placeCancelBtn').addEventListener('click', () => closeSheet($('placeSheet')));
  $('weatherLabel').addEventListener('click', () => { if (skySwipeJustHappened) return; if (!getPlace() && !previewWeather()) openPlaceSheet(); });
  els.nameMenuBtn.addEventListener('click', () => { els.nameInput.value = userName(); openSheet(els.nameSheet); setTimeout(() => els.nameInput.focus(), 80); });
  els.nameForm.addEventListener('submit', async e => {
    e.preventDefault();
    state.settings.name = els.nameInput.value.trim() || DEFAULT_NAME;
    closeSheet(els.nameSheet);
    await persistState(true);
    renderDailyBits();
    showToast(`Schön, ${userName()}!`);
  });
  els.nameCancelBtn.addEventListener('click', () => closeSheet(els.nameSheet));
  els.exportBtn.addEventListener('click', () => { closeSheet(els.menuSheet); exportBackup(); });
  els.checkBackupInput.addEventListener('click', () => { suppressLock = true; setTimeout(() => { suppressLock = false; }, 120000); });
  els.checkBackupInput.addEventListener('change', e => {
    suppressLock = false;
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) openBackupCheck(file);
  });
  $('backupCheckForm').addEventListener('submit', e => { e.preventDefault(); verifyBackupCheck(); });
  $('backupCheckClose').addEventListener('click', () => { pendingBackupCheck = null; closeSheet($('backupCheckSheet')); });
  els.importInput.addEventListener('click', () => { suppressLock = true; setTimeout(() => { suppressLock = false; }, 120000); });
  els.importInput.addEventListener('change', e => {
    suppressLock = false;
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) importBackup(file);
  });
  els.lockBtn.addEventListener('click', () => lockApp('Reci mi ist gesperrt.'));
  els.quickLockHomeBtn?.addEventListener('click', () => lockApp('Reci mi ist gesperrt.'));

  els.confirmCancelBtn.addEventListener('click', () => closeSheet(els.confirmSheet));
  els.confirmOkBtn.addEventListener('click', () => {
    const r = confirmResolver;
    confirmResolver = null;
    closeSheet(els.confirmSheet);
    if (r) r(true);
  });

  [els.topicSheet, els.actionSheet, els.menuSheet, els.nameSheet, els.confirmSheet, $('protectSheet'), $('placeSheet'), $('sketchSheet'), $('versionsSheet'), $('versionViewSheet'), $('attachSheet'), $('pinSheet'), $('backupCheckSheet'), $('archiveSheet'), $('mergeSheet'), $('markersSheet'), $('thoughtAiSheet')].forEach(dlg => {
    dlg.addEventListener('close', onSheetClosed);
    // Tippen auf den abgedunkelten Bereich schließt das Blatt
    dlg.addEventListener('click', e => { if (e.target === dlg) { const r = dlg.getBoundingClientRect(); if (e.clientY < r.top) closeSheet(dlg); } });
  });

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredInstallPrompt = e;
    els.installBtn.classList.remove('hidden');
  });
  els.installBtn.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    closeSheet(els.menuSheet);
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    els.installBtn.classList.add('hidden');
  });

  // Zoomen mit zwei Fingern verhindern (rein und raus)
  document.addEventListener('touchmove', e => { if (e.touches && e.touches.length > 1) e.preventDefault(); }, { passive: false });
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('gesturechange', e => e.preventDefault());
  document.addEventListener('dblclick', e => { if (!e.target.closest('textarea, input')) e.preventDefault(); });

  window.addEventListener('popstate', onPopState);
  document.addEventListener('visibilitychange', () => { if (document.hidden) onHidden(); else onVisible(); });
  window.addEventListener('pagehide', onHidden);
  window.addEventListener('focus', () => { if (suppressLock) setTimeout(() => { suppressLock = false; }, 800); });
}

async function boot() {
  placeStars();
  setTimeout(shootingStar, 4000);
  applySky();
  initSkyExtras();
  setInterval(applySky, 60000);
  if (!window.crypto?.subtle || !window.indexedDB) {
    els.lockHint.textContent = 'Dieser Browser kann die Notizen nicht sicher speichern.';
    els.pinSubmit.disabled = true;
    return;
  }
  await initDb();
  configureLockScreen();
  wireEvents();
  registerServiceWorker();
  updateQuickButton();
  try {
    const seen = localStorage.getItem('rm_seen_version');
    if (seen && seen !== APP_VERSION) setTimeout(() => showToast(`Reci mi ist jetzt auf Version ${APP_VERSION.replace(/\.0$/, '')}`, 3000), 900);
    localStorage.setItem('rm_seen_version', APP_VERSION);
  } catch {}
  const wantsQuick = /[?&]schnell=1/.test(location.search);
  if (wantsQuick) history.replaceState(null, '', location.pathname);
  const resumed = hasVaultConfig() && await tryResumeSession();
  if (wantsQuick && hasVaultConfig() && (resumed || hasInboxKey())) { openQuick('new'); return; }
  if (resumed) return;
  autoBiometric();
}


/* =====================================================================
   Reci mi 3.7 · Gedankenwelt mit optionaler KI-Verbindung
   - vorhandener Tresor bleibt unverändert (DB, PIN, Verschlüsselung)
   - alle Originalaussagen bleiben im Gespräch
   - regelbasierte Aufteilung, erkennbar als vorläufige Zuordnung
   - KI nur nach bewusster Verbindung, transparent mit Kontext-Freigabe
   ===================================================================== */
let thoughtView = 'talk';
let thoughtProjectFilter = 'Alle';
const THOUGHT_PROJECTS = ['Litterum','Reci mi','Njam Njam','Wildora','Numera','KI-Kleiderschrank','Valora','Aelyr','Der, der ist','Rahel und Adam','Bibel','Weitere Ideen','Allgemein'];
const THOUGHT_HINTS = [
  ['KI-Kleiderschrank',/kleider|kleidung|klamott|outfit|anzieh|anzug|blazer|garderobe|schuhe|schrank|artikelnummer|anprob/i],
  ['Litterum',/litterum|story\s*studio|schreib.?app|lektora|manuskript|buchprüfung/i],
  ['Reci mi',/reci\s*mi|rezimi|gedanken.?app|notiz.?app|gedächtnis.?app/i],
  ['Njam Njam',/njam\s*njam|unsere\s*küche|rezept.?app|rezept[e\s]/i],
  ['Wildora',/wildora|natur.?app|tiergeräusch|pflanzen.?app|artenkart/i],
  ['Numera',/numera|stempeluhr|zeiterfass|arbeitszeit.?app/i],
  ['Rahel und Adam',/rahel|adam|ich\s*habe\s*dich\s*nicht\s*vergessen/i],
  ['Der, der ist',/der,?\s*der\s*ist|\bnara\b|\bliri\b|\btarem\b/i],
  ['Aelyr',/aelyr|sternenstaub/i],
  ['Valora',/valora|vaelora|liora|aren\s*sar/i],
  ['Bibel',/bibel|jesus|matthäus|evangelium|gebet|gleichnis/i]
];
const THOUGHT_STOPWORDS = new Set('ich du wir ihr sie er es das der die den dem ein eine einen einem einer mein meine mit für und oder aber auch noch mal so wie was wer wo wann warum wieviel habe hast hat haben hatte wollte will möchte möchte zu zum zur von vor nach über bei beim ins im ist sind war waren werden wäre wäre das dir mir mich dich uns das diese dieser diesen diese dies welche welcher etwas dann jetzt schon doch ja nein bitte können kann könntest'.split(' '));

function ensureThoughtMemory() {
  if (!state) return;
  if (!state.memory || typeof state.memory !== 'object' || Array.isArray(state.memory)) state.memory = {};
  if (!Array.isArray(state.memory.messages)) state.memory.messages = [];
  if (!Array.isArray(state.memory.entries)) state.memory.entries = [];
  if (typeof state.memory.draft !== 'string') state.memory.draft = '';
  if (!state.memory.ai || typeof state.memory.ai !== 'object') state.memory.ai = { endpoint:'', accessCode:'', allowNotes:false };
  if (typeof state.memory.ai.endpoint !== 'string') state.memory.ai.endpoint = '';
  if (typeof state.memory.ai.accessCode !== 'string') state.memory.ai.accessCode = '';
  if (typeof state.memory.ai.allowNotes !== 'boolean') state.memory.ai.allowNotes = false;
  if (!state.memory.aiUsage || typeof state.memory.aiUsage !== 'object') state.memory.aiUsage = {input:0, output:0, calls:0};
}
function thoughtNorm(s) {
  return String(s||'').toLocaleLowerCase('de').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
}
function thoughtKeywords(s) {
  return [...new Set(thoughtNorm(s).split(' ').filter(w => w.length >= 3 && !THOUGHT_STOPWORDS.has(w)))];
}
function thoughtProject(text) {
  const value = String(text||'');
  for (const [name,re] of THOUGHT_HINTS) if (re.test(value)) return name;
  const normal = thoughtNorm(value);
  for (const name of THOUGHT_PROJECTS) {
    if (name !== 'Allgemein' && name !== 'Weitere Ideen' && normal.includes(thoughtNorm(name))) return name;
  }
  for (const t of (state?.topics || [])) {
    if (t.deletedAt || t.locked || (t.title||'').trim().length < 6) continue;
    if (normal.includes(thoughtNorm(t.title))) return t.title;
  }
  if (/idee|app|entwickel|funktion|projekt|erfind|wunsch/i.test(value)) return 'Weitere Ideen';
  return 'Allgemein';
}
function thoughtSplit(raw) {
  // Nur eindeutige Themenwechsel trennen, damit wir keine zusammengehörigen Sätze zerstückeln.
  const original = String(raw||'').trim();
  const splitSignals = /(?:[.!?;,]\s+|\s+)(?=(?:Ach[, ]+und|Außerdem|Übrigens|Noch\s+eine\s+Idee|Und\s+bei|Und\s+für|Anderes\s+Thema|Zum\s+Thema|Apropos)\b)/giu;
  let parts = original.replace(splitSignals,'\n\n').split(/\n{2,}|\n(?=\s*(?:[-*•]|\d+[.)]\s))/u).map(x=>x.replace(/^\s*(?:[-*•]|\d+[.)])\s*/u,'').trim()).filter(Boolean);
  if (parts.length === 1) {
    parts = original.replace(/[,;.]\s+(?=(?:ach\s+und|außerdem|übrigens|noch\s+eine\s+idee|und\s+bei|und\s+für|anderes\s+thema)\b)/giu, '.\n').split('\n').map(x=>x.trim()).filter(Boolean);
  }
  // Eine Aussage ohne deutliche Trennstelle immer als ein Gedanke erhalten.
  return parts.length > 12 ? [original] : parts;
}
function thoughtTitle(s) {
  const c = String(s||'').replace(/^(und |ach[, ]+und |außerdem[, ]*|übrigens[, ]*|ich (habe|möchte|wollte|will) (noch )?(eine |die )?idee[, :]*|zum thema\s+)/i,'').trim();
  const words = c.split(/\s+/).slice(0,11).join(' ');
  return words.length > 78 ? words.slice(0,75).trim()+' …' : (words || 'Neuer Gedanke');
}
function updateThoughtPortal() {
  if (!state) return;
  ensureThoughtMemory();
  const count = state.memory.entries.length;
  const el = $('thoughtMiniCount');
  if (el) el.textContent = count ? `${count} Gedanken` : '';
}
function openThoughtWorld({push=true}={}) {
  if (!state || !cryptoKey) return;
  ensureThoughtMemory();
  if (push) history.pushState({rm:'thought'}, '');
  $('thoughtInput').value = state.memory.draft;
  thoughtSetView(thoughtView);
  thoughtUpdateAiStatus();
  showScreen($('thoughtScreen'));
  if (thoughtView==='talk') thoughtToBottom();
}
function thoughtToBottom() { requestAnimationFrame(() => { const el=$('thoughtThread'); if (el) el.scrollTop = el.scrollHeight; }); }
function thoughtSetView(view) {
  thoughtView = ['talk','world','search'].includes(view) ? view : 'talk';
  for (const key of ['talk','world','search']) {
    const btn=document.querySelector(`.thought-tab[data-view="${key}"]`);
    if (btn) { btn.classList.toggle('active',key===thoughtView); btn.setAttribute('aria-selected',String(key===thoughtView)); }
    $(key==='talk'?'thoughtTalkView':key==='world'?'thoughtWorldView':'thoughtSearchView').classList.toggle('active',key===thoughtView);
  }
  if (thoughtView==='talk') { thoughtRenderChat(); thoughtToBottom(); }
  if (thoughtView==='world') thoughtRenderEntries();
  if (thoughtView==='search') thoughtRenderSearch();
}
function thoughtRenderChat() {
  if (!state) return;
  const arr=state.memory.messages;
  const welcome=arr.length ? '' : `<div class="thought-welcome"><h2>Erzähl mir, was dir einfällt.</h2><p>Ich bewahre deine Gedanken auf. Für echte KI-Antworten verbindest du Reci mi einmalig unter „KI verbinden“.</p></div>`;
  $('thoughtThread').innerHTML = welcome + arr.slice(-100).map(m=>`<article class="thought-message ${m.role==='user'?'from-user':'from-reci'}"><span class="thought-msg-name">${m.role==='user'?'Du':'Reci mi'}</span><p>${escapeHtml(m.text)}</p><time>${escapeHtml(formatDate(m.at))}</time></article>`).join('');
}
function thoughtFind(query, limit=15) {
  const keys=thoughtKeywords(query);
  if (!keys.length) return [];
  const corpus=[];
  for (const x of (state?.memory?.entries||[])) corpus.push({type:'gedanke',id:x.id,title:x.title,text:x.text,project:x.project,at:x.at});
  for (const x of (state?.memory?.messages||[])) corpus.push({type:'gespraech',id:x.id,title:x.role==='user'?'Deine Aussage':'Antwort von Reci mi',text:x.text,project:'Gespräch',at:x.at});
  for (const t of (state?.topics||[])) {
    if (t.deletedAt) continue;
    corpus.push({type:'notiz',id:t.id,title:t.title,text:t.locked?'':combinedTopicText(t),project:catOf(t),at:t.updatedAt,locked:!!t.locked});
  }
  const scored=corpus.map(item=>{
    const title=thoughtNorm(item.title+' '+item.project);
    const content=thoughtNorm(item.text);
    const score=keys.reduce((s,k)=>s + (title.includes(k)?4:0) + (content.includes(k)?1:0),0);
    return {...item,score};
  }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||new Date(b.at)-new Date(a.at));
  return scored.slice(0,limit);
}
function thoughtAnswerQuestion(input) {
  const found=thoughtFind(input,4);
  if (!found.length) return 'Dazu finde ich noch keinen passenden Eintrag in deinen gespeicherten Gedanken oder Notizen. Du kannst mir mehr dazu erzählen.';
  const names=found.map(x=>`„${x.title}“ (${x.type==='notiz'?'bisherige Notiz':x.project})`).join(', ');
  return `Ich habe ${found.length} passende Einträge gefunden: ${names}. Unter „Wiederfinden“ kannst du die Originaltexte ansehen. Das ist eine lokale Suche, noch keine KI-Antwort.`;
}
function thoughtIsQuery(input) {
  return /^(was|wann|wie|wo|welche[rsn]?|wer|finde|such[e]?|zeig[e]?|erinnerst du dich|weißt du noch|haben wir|wozu|woran)\b/i.test(input.trim()) && /\?|finde|suche|zeig|erinner|weißt|haben wir/i.test(input);
}
let thoughtSending=false;
function thoughtAiConnected() {
  const ai=state?.memory?.ai;
  return Boolean(ai?.endpoint && ai?.accessCode);
}
function thoughtUpdateAiStatus(message='') {
  const connected=thoughtAiConnected();
  const chip=$('thoughtAiBadge');
  if (chip) { chip.textContent=connected?'KI eingerichtet':'KI verbinden'; chip.classList.toggle('connected',connected); }
  const info=$('thoughtStatus');
  if (info) info.textContent=message || (connected
    ? 'KI aktiv. Für eine Antwort werden Gesprächsausschnitte über deine Verbindung an den KI-Dienst gesendet. Lokale Daten bleiben verschlüsselt.'
    : 'Lokal und verschlüsselt gespeichert. Für echte Gespräche: oben „KI verbinden“ wählen.');
}
function thoughtOpenAiSettings() {
  if (!cryptoKey || !state) return;
  ensureThoughtMemory();
  $('thoughtAiEndpoint').value=state.memory.ai.endpoint;
  $('thoughtAiAccess').value=state.memory.ai.accessCode;
  $('thoughtAiNotes').checked=state.memory.ai.allowNotes;
  const usage=state.memory.aiUsage;
  $('thoughtAiUsage').textContent=usage.calls
    ? `${usage.calls} erfolgreiche KI-Anfragen, ${Number(usage.input||0).toLocaleString('de-DE')} Eingabe-Tokens, ${Number(usage.output||0).toLocaleString('de-DE')} Ausgabe-Tokens (seit Verbindung; keine Euro-Abrechnung).`
    : 'Bisher keine erfolgreichen KI-Anfragen erfasst.';
  $('thoughtAiFeedback').textContent='';
  openSheet($('thoughtAiSheet'));
}
function thoughtCleanEndpoint(value) {
  const url=new URL(value.trim());
  if (url.protocol!=='https:' || url.username || url.password || url.search || url.hash || url.port) throw new Error('Bitte eine HTTPS-Adresse ohne Zusätze eintragen.');
  if (!url.hostname || url.hostname==='api.openai.com' || url.hostname==='openai.com') throw new Error('Hier gehört die Adresse deines geschützten Reci-mi-Vermittlungsdienstes hinein, nicht die OpenAI-Adresse.');
  if (url.pathname!=='/' && url.pathname!=='') throw new Error('Bitte nur die Hauptadresse des Vermittlungsdienstes ohne weiteren Pfad eingeben.');
  return url.origin+url.pathname.replace(/\/+$/,'');
}
async function thoughtSaveAiSettings(event) {
  event.preventDefault();
  const feedback=$('thoughtAiFeedback');
  let endpoint='';
  try { endpoint=thoughtCleanEndpoint($('thoughtAiEndpoint').value); }
  catch(err) {feedback.textContent=err.message;return;}
  const accessCode=$('thoughtAiAccess').value.trim();
  if (accessCode.length<20 || accessCode.length>200) {feedback.textContent='Der Zugangscode muss mindestens 20 Zeichen lang sein.';return;}
  const previous={...state.memory.ai};
  state.memory.ai={endpoint,accessCode,allowNotes:$('thoughtAiNotes').checked};
  try {
    await persistState(true);
    closeSheet($('thoughtAiSheet'));
    thoughtUpdateAiStatus('KI-Zugang gespeichert. Ab der nächsten Nachricht beantwortet Reci mi deine Fragen über den verbundenen Dienst.');
    showToast('KI-Verbindung gespeichert');
  } catch {state.memory.ai=previous;feedback.textContent='Speichern fehlgeschlagen. Bitte noch einmal versuchen.';}
}
async function thoughtDisconnectAi() {
  const previous={...state.memory.ai};
  state.memory.ai={endpoint:'',accessCode:'',allowNotes:false};
  try {
    await persistState(true);
    $('thoughtAiEndpoint').value=''; $('thoughtAiAccess').value=''; $('thoughtAiNotes').checked=false;
    closeSheet($('thoughtAiSheet'));
    thoughtUpdateAiStatus('KI-Verbindung getrennt. Neue Eingaben werden wieder nur lokal verarbeitet.');
    showToast('Verbindung getrennt');
  } catch {state.memory.ai=previous;$('thoughtAiFeedback').textContent='Trennen konnte nicht gespeichert werden.';}
}
function thoughtSelectAiContext(query) {
  // Nur begrenzte, relevante Informationen verlassen das Gerät. Extra geschützte Notizen nie.
  const ai=state.memory.ai;
  if (!ai?.allowNotes) return [];
  return thoughtFind(query,7)
    .filter(r=>r.type!=='gespraech' && !r.locked && r.text)
    .slice(0,5)
    .map(r=>({project:String(r.project||'').slice(0,80),title:String(r.title||'').slice(0,140),text:String(r.text||'').slice(0,900)}));
}
async function thoughtAiRequest(text) {
  const config=state.memory.ai;
  const history=state.memory.messages.slice(-13,-1)
    .filter(m=>['user','assistant'].includes(m.role))
    .map(m=>({role:m.role,content:String(m.text||'').slice(0,2200)}));
  const context=thoughtSelectAiContext(text);
  const ctrl=new AbortController();
  const timeout=setTimeout(()=>ctrl.abort(),42000);
  try {
    const response=await fetch(config.endpoint+'/chat',{
      method:'POST', mode:'cors', cache:'no-store', signal:ctrl.signal,
      headers:{'Content-Type':'application/json','X-Reci-Access':config.accessCode},
      body:JSON.stringify({message:text.slice(0,12000),history,context})
    });
    const data=await response.json().catch(()=>({}));
    if (!response.ok) throw new Error(data.error || `Server antwortet mit Fehler ${response.status}.`);
    if (typeof data.answer!=='string' || !data.answer.trim()) throw new Error('Die KI hat keine gültige Antwort geliefert.');
    return data;
  } catch(err) {
    if (err.name==='AbortError') throw new Error('Die KI antwortet nicht rechtzeitig. Bitte prüfe die Verbindung.');
    if (err instanceof TypeError) throw new Error('KI-Dienst nicht erreichbar. Prüfe Adresse, Freigabe und Internetverbindung.');
    throw err;
  } finally {clearTimeout(timeout);}
}
function thoughtCaptureAiItems(aiItems, msgid, at) {
  if (!Array.isArray(aiItems)) return 0;
  let count=0;
  for (const item of aiItems.slice(0,8)) {
    if (!item || typeof item.text!=='string' || !item.text.trim()) continue;
    const kind=['Idee','Projekt-Update','Wunsch','Erinnerung'].includes(item.kind)?item.kind:'Idee';
    const text=item.text.trim().slice(0,3500);
    let project=typeof item.project==='string'?item.project.trim().slice(0,80):'';
    if (!project || project==='Unbekannt') project=thoughtProject(text);
    const title=typeof item.title==='string' && item.title.trim()?item.title.trim().slice(0,100):thoughtTitle(text);
    // Erkennung und Zuordnung bleiben als Vorschlag veränderbar.
    state.memory.entries.push({id:uid(),messageId:msgid,text,title,project,kind,at,source:'ki-vorschlag'});
    count++;
  }
  return count;
}
async function thoughtSend(e) {
  e.preventDefault();
  if (thoughtSending || !cryptoKey || !state) return;
  if (dictWanted || isListening) stopRecognition();
  const input=$('thoughtInput');
  const text=input.value.trim();
  if (!text) {input.focus();return;}
  thoughtSending=true;$('thoughtSendBtn').disabled=true;
  ensureThoughtMemory();
  const msgid=uid();
  const now=new Date().toISOString();
  const userMessage={id:msgid,role:'user',text,at:now};
  // Original vor Netzwerkverbindung lokal und verschlüsselt sichern.
  state.memory.messages.push(userMessage);
  try {
    await persistState(true);
  } catch {
    state.memory.messages=state.memory.messages.filter(m=>m!==userMessage);
    thoughtUpdateAiStatus('Speichern nicht möglich. Deine Eingabe bleibt im Textfeld.');
    showToast('Deine Eingabe wurde nicht gespeichert.',4000);
    thoughtSending=false;$('thoughtSendBtn').disabled=false;
    return;
  }
  input.value='';state.memory.draft='';
  thoughtRenderChat();thoughtToBottom();
  let response='';
  let count=0;
  if (thoughtAiConnected()) {
    thoughtUpdateAiStatus('Reci mi überlegt gerade …');
    try {
      const data=await thoughtAiRequest(text);
      if (!cryptoKey || !state) return; // Während der Anfrage automatisch gesperrt: Original ist bereits gespeichert.
      response=data.answer;
      count=thoughtCaptureAiItems(data.items,msgid,now);
      if (data.usage && typeof data.usage==='object') {
        state.memory.aiUsage.calls=(state.memory.aiUsage.calls||0)+1;
        state.memory.aiUsage.input=(state.memory.aiUsage.input||0)+(Number(data.usage.input_tokens)||0);
        state.memory.aiUsage.output=(state.memory.aiUsage.output||0)+(Number(data.usage.output_tokens)||0);
      }
      thoughtUpdateAiStatus(count?`Antwort erhalten. ${count} ${count===1?'Gedanke':'Gedanken'} als Vorschlag gespeichert.`:'Antwort erhalten. Gespräch verschlüsselt gespeichert.');
    } catch(err) {
      if (!cryptoKey || !state) return;
      response=`Ich konnte gerade keine KI-Antwort abrufen. Deine Aussage ist aber sicher im Gespräch gespeichert. ${err.message}`;
      thoughtUpdateAiStatus('KI momentan nicht erreichbar. Die ursprüngliche Nachricht bleibt gespeichert.');
    }
  } else {
    const query=thoughtIsQuery(text);
    if (query) response=thoughtAnswerQuestion(text);
    else {
      const parts=thoughtSplit(text);
      for (const part of parts) state.memory.entries.push({id:uid(),messageId:msgid,text:part,title:thoughtTitle(part),project:thoughtProject(part),kind:'Vorläufig',at:now,source:'lokal'});
      count=parts.length;
      response=`${count} ${count===1?'Gedanke wurde':'Gedanken wurden'} lokal gespeichert. Für ein echtes KI-Gespräch wähle oben „KI verbinden“. Die Sortierung erfolgt bis dahin nur nach Stichwörtern.`;
    }
    thoughtUpdateAiStatus('Lokaler Modus. Keine Übertragung an eine externe KI.');
  }
  state.memory.messages.push({id:uid(),role:'assistant',text:response,at:new Date().toISOString()});
  try {
    await persistState(true);
    updateThoughtPortal();thoughtRenderChat();thoughtToBottom();
  } catch {
    // Der Nutzertext wurde bereits VOR dem Netzwerkabruf separat gespeichert.
    thoughtUpdateAiStatus('Die Antwort konnte nicht dauerhaft gespeichert werden. Bitte eine neue Sicherung erstellen.');
  } finally {thoughtSending=false;$('thoughtSendBtn').disabled=false;}
}

function thoughtAllProjects() {
  return [...new Set([...THOUGHT_PROJECTS,...(state?.memory?.entries||[]).map(e=>e.project),...(state?.topics||[]).filter(t=>!t.deletedAt).map(t=>t.title)].filter(Boolean))];
}
function thoughtRenderEntries() {
  const entries=(state?.memory?.entries||[]).slice().reverse();
  $('thoughtWorldCount').textContent=`${entries.length} ${entries.length===1?'Gedanke':'Gedanken'}`;
  const available=[...new Set(entries.map(e=>e.project))];
  const projects=['Alle', ...available];
  if (!projects.includes(thoughtProjectFilter)) thoughtProjectFilter='Alle';
  $('thoughtProjectTabs').innerHTML=projects.map(p=>`<button type="button" class="thought-project-chip${p===thoughtProjectFilter?' active':''}" data-project="${escapeHtml(p)}">${escapeHtml(p)}${p!=='Alle'?` <small>${entries.filter(x=>x.project===p).length}</small>`:''}</button>`).join('');
  const list=entries.filter(x=>thoughtProjectFilter==='Alle'||x.project===thoughtProjectFilter);
  $('thoughtEntries').innerHTML=list.length ? list.map(e=>`<article class="thought-entry" data-id="${escapeHtml(e.id)}"><div class="thought-entry-meta"><span class="thought-entry-dot"></span><time>${escapeHtml(formatDate(e.at))}</time></div><h3>${escapeHtml(e.title)}</h3><p>${escapeHtml(e.text)}</p><label class="thought-project-label">Projekt <select class="thought-project-select" aria-label="Projektzuordnung ändern">${thoughtAllProjects().map(p=>`<option value="${escapeHtml(p)}" ${p===e.project?'selected':''}>${escapeHtml(p)}</option>`).join('')}</select></label></article>`).join('') : '<p class="thought-blank">Hier erscheinen deine Ideen, sobald du sie im Gespräch erzählst.</p>';
}
function thoughtRenderSearch() {
  const q=$('thoughtSearchInput').value.trim();
  if (!q) { $('thoughtSearchResults').innerHTML='<p class="thought-blank">Zum Beispiel: „Litterum“, „Kleiderschrank“ oder „Bibel“.</p>'; return; }
  const results=thoughtFind(q,50);
  $('thoughtSearchResults').innerHTML=results.length ? results.map(r=>`<button class="thought-result" type="button" data-kind="${escapeHtml(r.type)}" data-id="${escapeHtml(r.id)}"><span>${r.type==='notiz'?'BESTEHENDE NOTIZ':r.type==='gespraech'?'GESPRÄCH':'GESPEICHERTER GEDANKE'} · ${escapeHtml(r.project)}</span><strong>${escapeHtml(r.title)}</strong><small>${r.locked?'Extra geschützt, Text wird nicht angezeigt':escapeHtml(excerpt(r.text,250))}</small></button>`).join('') : '<p class="thought-blank">Dazu ist noch nichts gespeichert.</p>';
}
function wireThoughtWorld() {
  $('thoughtHomeBtn').addEventListener('click', () => openThoughtWorld());
  $('thoughtBackBtn').addEventListener('click', goHomeFromScreen);
  $('thoughtSearchShortcut').addEventListener('click', () => {thoughtSetView('search');$('thoughtSearchInput').focus();});
  $('thoughtAiBadge').addEventListener('click',thoughtOpenAiSettings);
  $('thoughtAiSettingsForm').addEventListener('submit',thoughtSaveAiSettings);
  $('thoughtAiClose').addEventListener('click',()=>closeSheet($('thoughtAiSheet')));
  $('thoughtAiDisconnect').addEventListener('click',thoughtDisconnectAi);
  document.querySelectorAll('.thought-tab').forEach(b=>b.addEventListener('click',()=>thoughtSetView(b.dataset.view)));
  $('thoughtForm').addEventListener('submit',thoughtSend);
  $('thoughtInput').addEventListener('input', () => {
    if (!cryptoKey || !state) return;
    ensureThoughtMemory();
    state.memory.draft=$('thoughtInput').value;
    persistState();
  });
  $('thoughtMicBtn').addEventListener('click', () => {
    dictTarget=$('thoughtInput'); dictMicBtn=$('thoughtMicBtn');
    toggleRecognition();
  });
  $('thoughtProjectTabs').addEventListener('click', e=>{
    const b=e.target.closest('[data-project]'); if(!b) return;
    thoughtProjectFilter=b.dataset.project; thoughtRenderEntries();
  });
  $('thoughtEntries').addEventListener('change',async e=>{
    if (!e.target.matches('.thought-project-select')) return;
    const row=e.target.closest('[data-id]');
    const item=state?.memory?.entries.find(t=>t.id===row?.dataset.id);
    if (!item) return;
    const previous=item.project;
    item.project=e.target.value;
    try {await persistState(true);thoughtRenderEntries();showToast('Zuordnung gespeichert');}
    catch {item.project=previous;thoughtRenderEntries();showToast('Zuordnung konnte nicht gespeichert werden');}
  });
  $('thoughtSearchInput').addEventListener('input',thoughtRenderSearch);
  $('thoughtSearchResults').addEventListener('click',e=>{
    const b=e.target.closest('.thought-result'); if(!b) return;
    if (b.dataset.kind==='notiz') { openTopic(b.dataset.id); return; }
    if (b.dataset.kind==='gespraech') { thoughtSetView('talk'); thoughtToBottom(); return; }
    const entry=state?.memory?.entries.find(x=>x.id===b.dataset.id);
    if (!entry) return;
    thoughtProjectFilter=entry.project;thoughtSetView('world');
    const row=[...$('thoughtEntries').querySelectorAll('[data-id]')].find(x=>x.dataset.id===entry.id);
    if (row) {row.scrollIntoView({block:'center',behavior:'smooth'});row.classList.add('thought-highlight');setTimeout(()=>row.classList.remove('thought-highlight'),2500);}
  });
}

boot().catch(() => {
  els.lockHint.textContent = 'Reci mi konnte nicht starten. Lade die Seite bitte neu.';
});
