'use strict';

/* Reci mi 1.4 – „Mondlicht“
   Gleiche Speicherung wie 1.0–1.3: vorhandene Notizen, PIN und Sicherungen bleiben gültig. */

const APP_VERSION = '2.9.3';
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
let actionTopicId = null;
let openSheetEl = null;
let sheetSilentClose = false;

const $ = id => document.getElementById(id);
const els = {};
['lockScreen', 'homeScreen', 'editorScreen', 'trashScreen',
 'moonBtn', 'lockMoon', 'fpBadge', 'lockSubtitle', 'pinForm', 'pinLabel', 'pinInput', 'pinConfirm', 'pinSubmit', 'showPinBtn', 'lockHint', 'lockPhase',
 'menuBtn', 'greeting', 'heroMoon', 'dailyQuote', 'moonLine', 'moonPath', 'moonArc', 'moonOrb', 'moonriseLabel', 'moonsetLabel', 'moonPhaseLabel', 'searchInput', 'filterRow', 'bioCard', 'bioCardLater', 'bioCardSetup',
 'topicList', 'emptyState', 'noResults', 'newTopicBtn',
 'backBtn', 'editorHomeBtn', 'editorMenuBtn', 'editorTitle', 'editorTag', 'dateLine', 'topicText', 'saveState', 'undoBtn', 'redoBtn', 'endBtn',
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
  nacht: 'Schöne Nacht', daemmerung: 'Guten Morgen', morgen: 'Guten Morgen', vormittag: 'Schönen Vormittag',
  mittag: 'Schönen Mittag', nachmittag: 'Schönen Nachmittag', abenddaemmerung: 'Guten Abend', abend: 'Guten Abend'
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
  const toLocalMinutes = j => {
    const d = new Date((j - 2440587.5) * 86400000);
    return d.getHours() * 60 + d.getMinutes();
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

function nowForSky() {
  const now = new Date();
  const p = previewMinutes();
  if (p !== null) now.setHours(Math.floor(p / 60), p % 60, 0, 0);
  return now;
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
  const date = nowForSky();
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
  root.setProperty('--stars', (A.stars + (B.stars - A.stars) * t).toFixed(3));
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

  placeSun();
  placeMoon();
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
  applyPlaceGeo();
}
function applyPlaceGeo() {
  const p = getPlace();
  GEO.lat = p ? p.lat : 49.5;
  GEO.lon = p ? p.lon : 10.5;
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
  const map = { sonnig: 0, klar: 0, wolkig: 2, bewoelkt: 3, bedeckt: 3, nebel: 45, niesel: 53, regen: 63, starkregen: 65, schnee: 73, eis: 67, frost: 0, gewitter: 95 };
  const code = map[m[1].toLowerCase()];
  if (code === undefined) return null;
  return { code, cloud: code === 2 ? 55 : code === 0 ? 5 : 100, temp: m[1] === 'frost' || m[1] === 'eis' ? -4 : 12, name: 'Vorschau' };
}

let weatherNow = null;      // { code, cloud, temp, name, fx }
function currentFx() { return weatherNow?.fx || describeWeather(0, 0, 10); }

async function refreshWeather(force = false) {
  const prev = previewWeather();
  if (prev) { weatherNow = { ...prev, fx: describeWeather(prev.code, prev.cloud, prev.temp) }; applyWeatherFx(); return; }
  const place = getPlace();
  if (!place) { weatherNow = null; applyWeatherFx(); return; }
  try {
    const cached = JSON.parse(localStorage.getItem(LS_WEATHER) || 'null');
    if (cached && cached.key === `${place.lat},${place.lon}`) {
      weatherNow = { ...cached.w, name: place.name, fx: describeWeather(cached.w.code, cached.w.cloud, cached.w.temp) };
      applyWeatherFx();
      if (!force && Date.now() - cached.t < WEATHER_MAX_AGE) return;
    }
  } catch {}
  if (!navigator.onLine) return;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${place.lat.toFixed(3)}&longitude=${place.lon.toFixed(3)}&current=temperature_2m,weather_code,cloud_cover&timezone=auto`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    const w = { code: data.current.weather_code, cloud: data.current.cloud_cover, temp: data.current.temperature_2m };
    localStorage.setItem(LS_WEATHER, JSON.stringify({ key: `${place.lat},${place.lon}`, t: Date.now(), w }));
    weatherNow = { ...w, name: place.name, fx: describeWeather(w.code, w.cloud, w.temp) };
    applyWeatherFx();
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

function placeSun() {
  const hero = document.querySelector('.hero');
  const svg = $('sunPath');
  const sun = $('sun');
  if (!hero || !svg || !sun) return;
  const now = nowForSky();
  const { rise, set } = sunTimes(now);
  $('sunriseLabel').textContent = minutesToClock(rise);
  $('sunsetLabel').textContent = minutesToClock(set);

  const W = hero.clientWidth, H = hero.clientHeight;
  if (!W || !H) return;
  const pad = 22, horizon = H - 46, apex = 54;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const pts = [];
  for (let i = 0; i <= 40; i++) {
    const f = i / 40;
    pts.push(`${(pad + f * (W - 2 * pad)).toFixed(1)},${(horizon - (horizon - apex) * Math.sin(Math.PI * f)).toFixed(1)}`);
  }
  $('sunArc').setAttribute('points', pts.join(' '));

  const minutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const f = (minutes - rise) / (set - rise);
  const up = f > -0.03 && f < 1.03;
  sun.classList.toggle('hidden', !up);
  if (!up) return;
  const ff = Math.min(1, Math.max(0, f));
  const x = pad + ff * (W - 2 * pad);
  const alt = Math.sin(Math.PI * ff);                 // 0 am Horizont, 1 mittags
  const y = horizon - (horizon - apex) * alt + (f < 0 || f > 1 ? 10 : 0);
  sun.style.left = `${x}px`;
  sun.style.top = `${y}px`;
  // tief = warm und größer, hoch = weißgelb
  sun.style.setProperty('--sun-core', mixHex('#FFB866', '#FFFBEA', Math.min(1, alt * 1.6)));
  sun.style.setProperty('--sun-halo', mixHex('#FF9A4D', '#FFF1C2', Math.min(1, alt * 1.4)));
  sun.style.setProperty('--sun-size', `${Math.round(150 - alt * 30)}px`);
  const fx = currentFx();
  sun.style.setProperty('--sun-veil', (1 - Math.min(.7, fx.clouds * .5 + fx.fog * .4 + fx.rain * .2 + fx.snow * .2)).toFixed(2));
}

/* ---------- Wetter-Effekte ---------- */
const precipLayers = [];
let precipAnim = null;
let flashTimer = null;

function buildClouds(box, count) {
  if (box.childElementCount === count) return;
  let html = '';
  for (let i = 0; i < count; i++) {
    const top = 4 + (i * 37) % 70;
    const scale = 0.7 + ((i * 53) % 60) / 100;
    const dur = 70 + (i * 29) % 80;
    const delay = -((i * 47) % dur);
    html += `<i class="cloud" style="top:${top}%;--s:${scale.toFixed(2)};animation-duration:${dur}s;animation-delay:${delay}s"></i>`;
  }
  box.innerHTML = html;
}


function moonIllumination(age) {
  return (1 - Math.cos(2 * Math.PI * (age / SYNODIC))) / 2;
}

function moonTimes(date) {
  const age = moonAge(date);
  const phase = age / SYNODIC;
  const sun = sunTimes(date);
  const rise = wrapMinutes(sun.rise + phase * 24 * 60);
  const set = wrapMinutes(rise + 12 * 60 + 25);
  return { rise, set, age, phase, illum: moonIllumination(age) };
}

function placeMoon() {
  const hero = document.querySelector('.hero');
  const svg = $('moonPath');
  const moonOrb = $('moonOrb');
  if (!hero || !svg || !moonOrb) return;
  const now = nowForSky();
  const info = moonTimes(now);
  if (els.moonriseLabel) els.moonriseLabel.textContent = minutesToClock(info.rise);
  if (els.moonsetLabel) els.moonsetLabel.textContent = minutesToClock(info.set);
  if (els.moonPhaseLabel) {
    els.moonPhaseLabel.textContent = `${moonPhaseName(info.age)} · ${Math.round(info.illum * 100)} %`;
  }

  const W = hero.clientWidth, H = hero.clientHeight;
  if (!W || !H) return;
  const pad = 28, horizon = H - 66, apex = 112;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const pts = [];
  for (let i = 0; i <= 40; i++) {
    const f = i / 40;
    pts.push(`${(pad + f * (W - 2 * pad)).toFixed(1)},${(horizon - (horizon - apex) * Math.sin(Math.PI * f)).toFixed(1)}`);
  }
  $('moonArc').setAttribute('points', pts.join(' '));

  const minutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const cycle = info.set >= info.rise ? (info.set - info.rise) : (1440 - info.rise + info.set);
  const progressed = info.set >= info.rise ? (minutes - info.rise) : (minutes >= info.rise ? minutes - info.rise : 1440 - info.rise + minutes);
  const f = progressed / cycle;
  const up = isBetweenWrapped(minutes, info.rise, info.set);
  moonOrb.classList.toggle('hidden', !up);
  if (!up) return;
  const ff = Math.min(1, Math.max(0, f));
  const x = pad + ff * (W - 2 * pad);
  const alt = Math.sin(Math.PI * ff);
  const y = horizon - (horizon - apex) * alt;
  moonOrb.style.left = `${x}px`;
  moonOrb.style.top = `${y}px`;
  moonOrb.style.setProperty('--moon-size', `${Math.round(74 - alt * 10)}px`);
  moonOrb.innerHTML = homeMoonSvgV29(now);
}

function applyWeatherFx() {
  const fx = currentFx();
  const night = ['nacht', 'abend', 'abenddaemmerung', 'daemmerung'].includes(document.documentElement.dataset.phase);
  document.querySelectorAll('.weather-layer').forEach(layer => {
    const clouds = layer.querySelector('.clouds');
    const n = fx.clouds < .08 ? 0 : Math.round(2 + fx.clouds * 7);
    buildClouds(clouds, n);
    layer.style.setProperty('--cloud-op', (0.25 + fx.clouds * 0.6).toFixed(2));
    layer.style.setProperty('--fog', fx.fog.toFixed(2));
    layer.style.setProperty('--ice', fx.ice.toFixed(2));
    layer.classList.toggle('night', night);
    layer.classList.toggle('dark-clouds', fx.rain > .3 || fx.storm > 0 || fx.clouds > .9);
  });
  precipLayers.forEach(p => p.setup(fx));
  clearTimeout(flashTimer);
  if (fx.storm) scheduleFlash();
  // Text unten im Himmel
  const label = $('weatherLabel');
  if (label) {
    const place = getPlace();
    if (weatherNow && place) {
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
  startPrecip();
}

function scheduleFlash() {
  flashTimer = setTimeout(() => {
    document.querySelectorAll('.weather-layer .flash').forEach(f => { f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); });
    scheduleFlash();
  }, 5000 + Math.random() * 9000);
}

function makePrecip(canvas) {
  const ctx = canvas.getContext('2d');
  let drops = [], kind = 'none', amount = 0;
  const layer = {
    canvas,
    setup(fx) {
      kind = fx.snow > 0 ? 'snow' : fx.rain > 0 ? 'rain' : 'none';
      amount = kind === 'snow' ? fx.snow : fx.rain;
      this.resize();
      const n = kind === 'none' ? 0 : Math.round((kind === 'snow' ? 70 : 110) * amount + 10);
      drops = Array.from({ length: n }, () => this.spawn(true));
    },
    resize() {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.w = r.width; this.h = r.height;
    },
    spawn(anywhere) {
      return { x: Math.random() * (this.w || 400), y: anywhere ? Math.random() * (this.h || 300) : -10,
        v: kind === 'snow' ? 0.4 + Math.random() * 0.8 : 7 + Math.random() * 6,
        r: kind === 'snow' ? 1 + Math.random() * 2.4 : 10 + Math.random() * 10, p: Math.random() * 6.28 };
    },
    active() { return kind !== 'none' && canvas.offsetParent !== null; },
    frame() {
      const { w, h } = this;
      ctx.clearRect(0, 0, w, h);
      if (kind === 'rain') {
        ctx.strokeStyle = 'rgba(220,230,250,.45)';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        for (const d of drops) {
          ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - d.r * .25, d.y + d.r);
          d.y += d.v; d.x -= d.v * .25;
          if (d.y > h) Object.assign(d, this.spawn(false));
          if (d.x < -10) d.x = w + 5;
        }
        ctx.stroke();
      } else if (kind === 'snow') {
        ctx.fillStyle = 'rgba(255,255,255,.85)';
        for (const d of drops) {
          ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, 6.283); ctx.fill();
          d.y += d.v; d.p += 0.02; d.x += Math.sin(d.p) * 0.5;
          if (d.y > h + 5) Object.assign(d, this.spawn(false));
        }
      }
    }
  };
  return layer;
}

function startPrecip() {
  if (precipAnim) return;
  const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const loop = () => {
    precipAnim = null;
    if (document.hidden) return;
    const live = precipLayers.filter(p => p.active());
    if (!live.length) { precipLayers.forEach(p => p.canvas.getContext('2d').clearRect(0, 0, p.canvas.width, p.canvas.height)); return; }
    live.forEach(p => p.frame());
    if (!reduced) precipAnim = requestAnimationFrame(loop);
  };
  precipAnim = requestAnimationFrame(loop);
}

function initSkyExtras() {
  const hero = document.querySelector('.hero');
  if (hero && 'ResizeObserver' in window) new ResizeObserver(() => { placeSun(); placeMoon(); fitGreeting(); }).observe(hero);
  if (document.fonts) { document.fonts.ready.then(fitGreeting); document.fonts.addEventListener?.('loadingdone', fitGreeting); }
  document.querySelectorAll('.weather-layer canvas').forEach(c => precipLayers.push(makePrecip(c)));
  window.addEventListener('resize', () => { precipLayers.forEach(p => p.resize()); placeSun(); placeMoon(); });
  applyPlaceGeo();
  refreshWeather();
  setInterval(() => { if (!document.hidden) refreshWeather(); }, 10 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { refreshWeather(); startPrecip(); placeSun(); placeMoon(); } });
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
      choosePlace({ name: r.name, lat: r.latitude, lon: r.longitude });
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

// Startseiten-Mond fest auf die Darstellung aus Reci mi V2.9 eingefroren.
function homeMoonSvgV29(date) {
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

// Klassischer Reci-mi-Mond nur für die Sperrseite. Das ist bewusst die Optik
// von vor V2.8; die neue Mondgrafik auf der Himmelsbahn bleibt unverändert.
function lockMoonSvgClassic(date) {
  const age = moonAge(date);
  const f = age / SYNODIC;
  const c = Math.cos(2 * Math.PI * f);
  const k = (1 - c) / 2;
  const R = 96, C = 100;
  const rx = Math.abs(c) * R;
  const waxing = f < 0.5;
  const top = `${C} ${C - R}`, bottom = `${C} ${C + R}`;
  let d;
  if (k < 0.015) d = '';
  else if (k > 0.985) d = `M${top} A${R} ${R} 0 1 1 ${bottom} A${R} ${R} 0 1 1 ${top}Z`;
  else if (waxing) d = `M${top} A${R} ${R} 0 0 1 ${bottom} A${rx.toFixed(2)} ${R} 0 0 ${k < 0.5 ? 0 : 1} ${top}Z`;
  else d = `M${top} A${R} ${R} 0 0 0 ${bottom} A${rx.toFixed(2)} ${R} 0 0 ${k < 0.5 ? 1 : 0} ${top}Z`;
  const id = `lm${++moonUid}`;
  const glow = (0.35 + 0.65 * k).toFixed(2);

  return `<svg viewBox="0 0 200 200" role="img" aria-label="${moonPhaseName(age)}" style="--k:${glow}">
    <defs>
      <clipPath id="${id}c"><circle cx="${C}" cy="${C}" r="${R}"/></clipPath>
      <filter id="${id}t" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="1.6"/></filter>
      <filter id="${id}g" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="9"/></filter>
      <filter id="${id}h" x="-120%" y="-120%" width="340%" height="340%"><feGaussianBlur stdDeviation="26"/></filter>
      <mask id="${id}m"><path d="${d || 'M0 0'}" fill="#fff" filter="url(#${id}t)"/></mask>
      <g id="${id}sf">
        <circle cx="${C}" cy="${C}" r="${R - 2}" style="fill:#CFCAC0"/>
        <image href="moon.webp" x="${C - R}" y="${C - R}" width="${2 * R}" height="${2 * R}" preserveAspectRatio="xMidYMid meet"/>
        <circle cx="${C}" cy="${C}" r="${R}" style="fill:var(--moon-lit);mix-blend-mode:multiply"/>
      </g>
    </defs>
    ${d ? `<path class="moon-glow wide" d="${d}" style="fill:var(--moon-lit)" filter="url(#${id}h)"/><path class="moon-glow" d="${d}" style="fill:var(--moon-lit)" filter="url(#${id}g)"/>` : ''}
    <circle cx="${C}" cy="${C}" r="${R - 1.5}" style="fill:var(--moon-dark)"/>
    <use href="#${id}sf" style="opacity:var(--earthshine)"/>
    ${d ? `<use href="#${id}sf" mask="url(#${id}m)"/><circle cx="${C}" cy="${C}" r="${R}" mask="url(#${id}m)" style="fill:var(--sky-mid);opacity:var(--moon-wash, 0)"/>` : ''}
  </svg>`;
}

function renderDailyBits(date = nowForSky(), phase = document.documentElement.dataset.phase || 'nacht') {
  const age = moonAge(date);
  const illumination = moonIllumination(age);
  const phaseName = moonPhaseName(age);
  const lockMoon = lockMoonSvgClassic(date);
  const moon = moonSvg(date);

  // Der Mond auf der Sperrseite bleibt in der ursprünglichen Reci-mi-Optik und zeigt trotzdem die echte aktuelle Phase.
  // Zunehmend = rechts hell, abnehmend = links hell.
  els.lockMoon.innerHTML = lockMoon;
  els.lockMoon.dataset.moonPhase = phaseName;
  els.moonBtn.setAttribute('aria-label', `Mit Fingerabdruck entsperren. ${phaseName}, ${Math.round(illumination * 100)} Prozent beleuchtet.`);

  // Für die ausgeblendete Startseiten-Mondgrafik bleibt die bisherige Struktur erhalten.
  els.heroMoon.innerHTML = moonSvg(date);
  els.greeting.textContent = `${GREETING[phase] || 'Hallo'}, ${userName()}`;
  requestAnimationFrame(fitGreeting);
  els.dailyQuote.textContent = quoteOfDay(date);
  const line = moonLineText(date);
  els.moonLine.textContent = line;
  els.lockPhase.textContent = `${PHASE_LABEL[phase] || ''}
${line}`;
}

function placeStars() {
  document.querySelectorAll('.stars').forEach(box => {
    if (box.childElementCount) return;
    let seed = box.closest('.hero') ? 7 : 3;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const count = box.closest('.hero') ? 18 : 34;
    let html = '';
    for (let i = 0; i < count; i++) {
      const size = rnd() < 0.15 ? 3 : 2;
      html += `<i style="left:${(rnd() * 100).toFixed(1)}%;top:${(rnd() * 92).toFixed(1)}%;opacity:${(0.2 + rnd() * 0.6).toFixed(2)};width:${size}px;height:${size}px"></i>`;
    }
    box.innerHTML = html;
  });
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
  if (!Array.isArray(state.topics)) state.topics = [];
  state.version = APP_VERSION;
  state.settings = { ...(state.settings || {}) };
  delete state.settings.autoLockMinutes;
  delete state.settings.lockMode;
  if (!state.settings.name) state.settings.name = DEFAULT_NAME;
  if (!Array.isArray(state.settings.customCategories)) state.settings.customCategories = [];
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
  if (screen === els.homeScreen) requestAnimationFrame(() => { placeSun(); placeMoon(); });
  [els.lockScreen, els.homeScreen, els.editorScreen, els.trashScreen, $('quickScreen')].forEach(el => el.classList.toggle('active', el === screen));
  window.scrollTo(0, 0);
}

function configureLockScreen() {
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
  ensureInboxKeys().then(openInbox).then(n => {
    if (n) { renderTopics(); showToast(n === 1 ? 'Eine Schnellnotiz wurde einsortiert' : `${n} Schnellnotizen wurden einsortiert`, 3000); }
  }).catch(() => {});
  renderDailyBits();
  renderCategoryControls();
  renderTopics();
  maybeShowBioCard();
  maybeShowBackupCard();
  // Verlauf neu aufbauen: Startseite ist die Basis
  history.replaceState({ rm: 'home' }, '');
  if (resume.screen === 'editor' && state.topics.some(t => t.id === resume.id && !t.deletedAt)) {
    openTopic(resume.id, { verified: true });
  } else if (resume.screen === 'trash') {
    openTrash();
  } else {
    showScreen(els.homeScreen);
  }
}

function goHomeFromScreen() {
  // Für die Zurück-Pfeile in der App: wie die Zurück-Taste des Handys
  if (history.state && (history.state.rm === 'editor' || history.state.rm === 'trash')) history.back();
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
const activeTopics = () => state.topics.filter(t => !t.deletedAt);
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

function renderCategoryControls() {
  const cats = categoryNames();
  if (!cats.includes(currentFilter) && currentFilter !== 'Alle') currentFilter = 'Alle';
  els.filterRow.innerHTML = `<button class="chip${currentFilter === 'Alle' ? ' active' : ''}" data-filter="Alle" type="button">Alle</button>` + cats.map(cat => `<button class="chip${currentFilter === cat ? ' active' : ''}" data-filter="${escapeHtml(cat)}" type="button">${dotHtml(cat)}${escapeHtml(cat)}</button>`).join('');
  els.catPicker.innerHTML = cats.map(cat => `<button type="button" class="cat${cat === QUICK_CATEGORY ? ' cat-wide' : ''}${selectedCategory === cat ? ' selected' : ''}" data-cat="${escapeHtml(cat)}">${dotHtml(cat)}${escapeHtml(cat)}</button>`).join('');
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
  if (q) topics = topics.filter(t => (t.locked ? t.title : `${t.title} ${t.content}`).toLowerCase().includes(q));
  topics.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || new Date(b.updatedAt) - new Date(a.updatedAt));

  els.topicList.innerHTML = topics.map(t => `
    <article class="row${t.locked ? ' is-locked' : ''}" data-id="${escapeHtml(t.id)}" data-cat="${escapeHtml(catOf(t))}" style="--row-cat-color:${escapeHtml(categoryColor(catOf(t)))}" tabindex="0">
      <div class="row-top"><h2>${t.pinned ? PIN_ICON : ''}${t.locked ? LOCK_ICON : ''}${escapeHtml(t.title)}</h2><time>${escapeHtml(formatDate(t.updatedAt))}</time></div>
      <p>${t.locked ? 'Geschützt. Zum Öffnen Fingerabdruck oder PIN.' : (!(t.content || '').trim() && t.sketches?.length ? 'Zeichnung' : escapeHtml(excerpt(t.content)))}</p>
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
  resetEditHistory(topic.content || '');
  renderSketches();
  if (findOpen) closeFind();
  stopReading();
  versionStart(topic);
  setEditing(!topic.content);
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
    const topic = { id: uid(), title, category: selectedCategory, content: '', createdAt: now, updatedAt: now, deletedAt: null };
    if ($('protectToggle').checked) { topic.locked = true; openedProtected.add(topic.id); }
    state.topics.push(topic);
    await persistState(true);
    renderTopics();
    closeSheetAndReplace(els.topicSheet, { rm: 'editor', id: topic.id });
    openTopic(topic.id, { push: false });
    setEditing(true, true);
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
  $('actionShareBtn').classList.toggle('hidden', topic.locked && !openedProtected.has(id));
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
    purge: `Bestätige mit ${how}, um das Thema endgültig zu löschen.`
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
  const text = els.topicText.value;
  if (!text.trim()) return showToast('Hier steht noch nichts');
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ro = els.topicText.readOnly;
    els.topicText.readOnly = false;
    els.topicText.select();
    document.execCommand('copy');
    els.topicText.readOnly = ro;
  }
  showToast('Ganzer Text kopiert');
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
  setEditing(true);
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
  setEditing(true, true);
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
  const text = els.topicText.value;
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
    hint.textContent = `Sicherung ist vollständig lesbar: ${active} Themen${deleted ? `, ${deleted} im Papierkorb` : ''}, ${totalText.toLocaleString('de-DE')} Textzeichen. Deine aktuellen Daten wurden nicht verändert.`;
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
  els.manageCategoriesBtn.addEventListener('click', openCategoryManager);
  els.categoryForm.addEventListener('submit', e => { e.preventDefault(); saveCategoryManager(); });
  els.categoryCloseBtn.addEventListener('click', () => closeSheet(els.categorySheet));
  els.categoryManageList.addEventListener('click', e => {
    const row = e.target.closest('.category-manage-row'); if (!row) return;
    const name = row.dataset.name;
    if (e.target.closest('.category-edit')) { editingCategoryName = name; els.categoryName.value = name; els.categorySaveBtn.textContent = 'Speichern'; els.categoryName.focus(); }
    if (e.target.closest('.category-delete')) deleteCustomCategory(name);
  });
  els.catPicker.addEventListener('click', e => { const b = e.target.closest('.cat'); if (b) selectCategory(b.dataset.cat); });
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

  els.filterRow.addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
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
  els.editBtn.addEventListener('click', () => setEditing(els.topicText.readOnly, true));
  els.copyBtn.addEventListener('click', copyAll);
  els.readBtn.addEventListener('click', readText);
  els.deleteBtn.addEventListener('click', () => { if (currentTopicId) moveTopicToTrash(currentTopicId); });
  els.micBtn.addEventListener('click', () => { dictTarget = null; dictMicBtn = null; toggleRecognition(); });
  wireQuick();
  wireV22();
  wireV25();
  els.editorMenuBtn.addEventListener('click', () => openActionSheet(currentTopicId));

  els.topicText.addEventListener('input', () => {
    const topic = currentTopic();
    if (!topic) return;
    recordEditorChange(topic.content || '');
    versionOnInput(topic, els.topicText.value);
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
  $('weatherLabel').addEventListener('click', () => { if (!getPlace() && !previewWeather()) openPlaceSheet(); });
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

  els.confirmCancelBtn.addEventListener('click', () => closeSheet(els.confirmSheet));
  els.confirmOkBtn.addEventListener('click', () => {
    const r = confirmResolver;
    confirmResolver = null;
    closeSheet(els.confirmSheet);
    if (r) r(true);
  });

  [els.topicSheet, els.actionSheet, els.menuSheet, els.nameSheet, els.confirmSheet, $('protectSheet'), $('placeSheet'), $('sketchSheet'), $('versionsSheet'), $('versionViewSheet'), $('attachSheet'), $('pinSheet'), $('backupCheckSheet')].forEach(dlg => {
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

boot().catch(() => {
  els.lockHint.textContent = 'Reci mi konnte nicht starten. Lade die Seite bitte neu.';
});
