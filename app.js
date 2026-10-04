'use strict';

/* Reci mi 1.4 – „Mondlicht“
   Gleiche Speicherung wie 1.0–1.3: vorhandene Notizen, PIN und Sicherungen bleiben gültig. */

const APP_VERSION = '1.5.0';
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
 'menuBtn', 'greeting', 'heroMoon', 'dailyQuote', 'moonLine', 'searchInput', 'filterRow', 'bioCard', 'bioCardLater', 'bioCardSetup',
 'topicList', 'emptyState', 'noResults', 'newTopicBtn',
 'backBtn', 'editorMenuBtn', 'editorTitle', 'editorTag', 'dateLine', 'topicText', 'saveState',
 'editBtn', 'copyBtn', 'micBtn', 'readBtn', 'deleteBtn',
 'trashBackBtn', 'trashList',
 'topicSheet', 'topicForm', 'topicSheetTitle', 'topicName', 'catPicker', 'cancelTopicBtn', 'saveTopicBtn',
 'actionSheet', 'actionTitle', 'actionOpenBtn', 'actionRenameBtn', 'actionTrashBtn', 'actionCancelBtn',
 'menuSheet', 'biometricMenuBtn', 'nameMenuBtn', 'openTrashBtn', 'exportBtn', 'importInput', 'installBtn', 'lockBtn',
 'nameSheet', 'nameForm', 'nameInput', 'nameCancelBtn',
 'confirmSheet', 'confirmTitle', 'confirmText', 'confirmCancelBtn', 'confirmOkBtn',
 'toast'].forEach(id => { els[id] = $(id); });

const categoryOrder = ['Bücher', 'Apps', 'Privat', 'Sonstiges'];

/* =====================================================================
   Tageszeit-Himmel: Farben wandern fließend durch den Tag
   ===================================================================== */

// Himmel (Kopfbereich + Sperrbildschirm)
const SKY = {
  nacht:           { top: '#10152E', mid: '#1B2347', hor: '#2A3160', stars: 1,    moonLit: '#F1E4C3', moonDark: [42, 49, 88, .9],    glow: [241, 228, 195, .22] },
  daemmerung:      { top: '#1E2452', mid: '#4A4580', hor: '#E9A58C', stars: .45,  moonLit: '#F6EAD0', moonDark: [60, 58, 110, .55],   glow: [246, 214, 200, .22] },
  morgen:          { top: '#86AFDB', mid: '#C4DAEE', hor: '#FADFC4', stars: 0,    moonLit: '#FFFFFF', moonDark: [255, 255, 255, .12], glow: [255, 255, 255, .35] },
  vormittag:       { top: '#6FA6DE', mid: '#AFD2F0', hor: '#EAF3F8', stars: 0,    moonLit: '#FFFFFF', moonDark: [255, 255, 255, .12], glow: [255, 255, 255, .35] },
  mittag:          { top: '#5E9FE2', mid: '#A9D4F4', hor: '#FFF4D8', stars: 0,    moonLit: '#FFFFFF', moonDark: [255, 255, 255, .12], glow: [255, 255, 255, .35] },
  nachmittag:      { top: '#8DB4DD', mid: '#DCD5C6', hor: '#F6D49E', stars: 0,    moonLit: '#FFFFFF', moonDark: [255, 255, 255, .14], glow: [255, 246, 225, .35] },
  abenddaemmerung: { top: '#33357A', mid: '#7A5788', hor: '#F2A178', stars: .3,   moonLit: '#FBEBD3', moonDark: [70, 58, 110, .55],   glow: [250, 215, 190, .25] },
  abend:           { top: '#171A42', mid: '#2A2959', hor: '#4B3A6E', stars: .8,   moonLit: '#F1E4C3', moonDark: [46, 46, 92, .85],    glow: [236, 222, 200, .22] }
};

// Fläche (Liste, Thema, Blätter). Zwischen hell und dunkel wird umgeschaltet, sonst gemischt.
const BODY = {
  nacht:           { dark: true,  bg: '#1B2140', surface: '#232A4D', surface2: '#2D3560', ink: '#ECEAF4', muted: '#9AA1C2', accent: '#F1E4C3', accentInk: '#1B2140', accentText: '#F1E4C3' },
  daemmerung:      { dark: true,  bg: '#211F42', surface: '#2B2952', surface2: '#363361', ink: '#F1ECF6', muted: '#AAA4C6', accent: '#F4BBA4', accentInk: '#2A1E33', accentText: '#F4BBA4' },
  morgen:          { dark: false, bg: '#F8F3EC', surface: '#FFFFFF', surface2: '#FFFFFF', ink: '#2A2B45', muted: '#6E6D86', accent: '#F2B48F', accentInk: '#2E1D16', accentText: '#B4562E' },
  vormittag:       { dark: false, bg: '#F2F6F9', surface: '#FFFFFF', surface2: '#FFFFFF', ink: '#22304A', muted: '#66738C', accent: '#9CCBEE', accentInk: '#14243A', accentText: '#2F6FA6' },
  mittag:          { dark: false, bg: '#FBF8F0', surface: '#FFFFFF', surface2: '#FFFFFF', ink: '#2B2B3A', muted: '#73726C', accent: '#F3CD69', accentInk: '#2B2410', accentText: '#94680C' },
  nachmittag:      { dark: false, bg: '#F8F0E4', surface: '#FFFDF9', surface2: '#FFFDF9', ink: '#33293A', muted: '#7A6C66', accent: '#ECB47E', accentInk: '#2E1F14', accentText: '#A45A1E' },
  abenddaemmerung: { dark: true,  bg: '#251F3F', surface: '#30294F', surface2: '#3B335F', ink: '#F4ECF2', muted: '#B5A8C3', accent: '#F2A983', accentInk: '#2B1B26', accentText: '#F2A983' },
  abend:           { dark: true,  bg: '#1D1C40', surface: '#28274F', surface2: '#32315E', ink: '#ECE9F6', muted: '#A4A1C7', accent: '#CDB6EE', accentInk: '#1D1C40', accentText: '#CDB6EE' }
};

const CAT_COLORS = {
  dark:  { books: '#E7B776', apps: '#8CC7B4', private: '#C3A8E6', other: '#AEB4CC' },
  light: { books: '#C4862C', apps: '#3A967C', private: '#9270CC', other: '#878DA6' }
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
function applySky() {
  const date = nowForSky();
  const { a, b, t, phase } = skyStateAt(date);
  const A = SKY[a], B = SKY[b];
  const root = document.documentElement.style;

  const top = mixHex(A.top, B.top, t), mid = mixHex(A.mid, B.mid, t), hor = mixHex(A.hor, B.hor, t);
  root.setProperty('--sky-top', top);
  root.setProperty('--sky-mid', mid);
  root.setProperty('--sky-hor', hor);
  root.setProperty('--stars', (A.stars + (B.stars - A.stars) * t).toFixed(3));
  root.setProperty('--moon-lit', mixHex(A.moonLit, B.moonLit, t));
  root.setProperty('--moon-lit-2', mixHex(mixHex(A.moonLit, B.moonLit, t), '#FFFFFF', .55));
  root.setProperty('--moon-dark', rgba(mixArr(A.moonDark, B.moonDark, t)));
  root.setProperty('--moon-glow', rgba(mixArr(A.glow, B.glow, t)));
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
    const swap = new Set(['accent', 'accentInk', 'accentText']);
    for (const k of Object.keys(BA)) body[k] = k === 'dark' ? BA.dark : swap.has(k) ? (t < 0.5 ? BA[k] : BB[k]) : mixHex(BA[k], BB[k], t);
  } else {
    // Hell/Dunkel wechselt genau dann, wenn der Himmel hell bzw. dunkel genug ist
    body = skyIsLight ? (BA.dark ? BB : BA) : (BA.dark ? BA : BB);
  }
  root.setProperty('--bg', body.bg);
  root.setProperty('--surface', body.surface);
  root.setProperty('--surface-2', body.surface2);
  root.setProperty('--ink', body.ink);
  root.setProperty('--muted', body.muted);
  root.setProperty('--accent', body.accent);
  root.setProperty('--accent-ink', body.accentInk);
  root.setProperty('--accent-text', body.accentText);
  root.setProperty('--line', body.dark ? 'rgba(236, 234, 244, .09)' : 'rgba(40, 40, 70, .10)');
  root.setProperty('--shadow', body.dark ? '0 14px 30px rgba(0, 0, 0, .32)' : '0 12px 26px rgba(60, 50, 40, .16)');
  root.setProperty('--shadow-soft', body.dark ? 'none' : '0 2px 10px rgba(60, 50, 40, .07)');
  root.setProperty('--danger', body.dark ? '#E8968B' : '#B4473C');
  const cats = body.dark ? CAT_COLORS.dark : CAT_COLORS.light;
  root.setProperty('--c-books', cats.books);
  root.setProperty('--c-apps', cats.apps);
  root.setProperty('--c-private', cats.private);
  root.setProperty('--c-other', cats.other);
  document.documentElement.dataset.mode = body.dark ? 'dark' : 'light';
  document.documentElement.dataset.phase = phase;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', top);

  if (phase !== lastPhase || !applySky.renderedDay || applySky.renderedDay !== date.toDateString()) {
    lastPhase = phase;
    applySky.renderedDay = date.toDateString();
    renderDailyBits(date, phase);
  }
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
function moonSvg(date) {
  const age = moonAge(date);
  const f = age / SYNODIC;
  const c = Math.cos(2 * Math.PI * f);
  const k = (1 - c) / 2;              // beleuchteter Anteil
  const rx = Math.abs(c) * 100;
  const waxing = f < 0.5;             // Nordhalbkugel: zunehmend rechts hell
  let d;
  if (k < 0.02) d = '';
  else if (k > 0.98) d = 'M100 0 A100 100 0 1 1 100 200 A100 100 0 1 1 100 0Z';
  else if (waxing) d = `M100 0 A100 100 0 0 1 100 200 A${rx.toFixed(2)} 100 0 0 ${k < 0.5 ? 0 : 1} 100 0Z`;
  else d = `M100 0 A100 100 0 0 0 100 200 A${rx.toFixed(2)} 100 0 0 ${k < 0.5 ? 1 : 0} 100 0Z`;
  const id = `m${++moonUid}`;
  return `<svg viewBox="0 0 200 200" role="img" aria-label="${moonPhaseName(age)}">
    <defs>
      <radialGradient id="${id}g" cx="40%" cy="36%" r="72%"><stop offset="0" style="stop-color:var(--moon-lit-2)"/><stop offset="1" style="stop-color:var(--moon-lit)"/></radialGradient>
      <clipPath id="${id}c"><path d="${d || 'M0 0'}"/></clipPath>
    </defs>
    <circle cx="100" cy="100" r="99" style="fill:var(--moon-dark)"/>
    ${d ? `<path d="${d}" fill="url(#${id}g)"/>
    <g clip-path="url(#${id}c)" style="fill:var(--moon-crater);opacity:.45">
      <circle cx="62" cy="64" r="15"/><circle cx="44" cy="126" r="9"/><circle cx="82" cy="150" r="12"/>
      <circle cx="132" cy="58" r="10"/><circle cx="146" cy="120" r="14"/><circle cx="112" cy="104" r="6"/>
    </g>` : ''}
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

function renderDailyBits(date = nowForSky(), phase = document.documentElement.dataset.phase || 'nacht') {
  const moon = moonSvg(new Date());
  els.lockMoon.innerHTML = moon;
  els.heroMoon.innerHTML = moonSvg(new Date());
  els.greeting.textContent = `${GREETING[phase] || 'Hallo'}, ${userName()}`;
  els.dailyQuote.textContent = quoteOfDay(new Date());
  const line = moonLineText(new Date());
  els.moonLine.textContent = line;
  els.lockPhase.textContent = `${PHASE_LABEL[phase] || ''}\n${line}`;
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
  return { version: APP_VERSION, createdAt: new Date().toISOString(), settings: { name: DEFAULT_NAME }, topics: [] };
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
  if (els.editorScreen.classList.contains('active') && currentTopicId) resume = { screen: 'editor', id: currentTopicId };
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

function onHidden() {
  stopReading();
  stopRecognition();
  if (!cryptoKey) return;
  saveResume();
  if (!suppressLock && !biometricBusy) {
    try { localStorage.setItem(LS_LEFT_AT, String(Date.now())); } catch {}
  }
  persistState(true).catch(() => {});
}

function onVisible() {
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

async function unlockWithBiometrics({ silent = false } = {}) {
  const cfg = getBiometricConfig();
  if (!cfg?.credentialId || biometricBusy) return;
  biometricBusy = true;
  els.moonBtn.classList.add('busy');
  if (!silent) els.lockHint.textContent = '';
  try {
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
  [els.lockScreen, els.homeScreen, els.editorScreen, els.trashScreen].forEach(el => el.classList.toggle('active', el === screen));
  window.scrollTo(0, 0);
}

function configureLockScreen() {
  const firstRun = !hasVaultConfig();
  const bio = !firstRun && hasBiometricConfig();
  els.pinInput.value = '';
  els.pinConfirm.value = '';
  els.pinConfirm.classList.toggle('hidden', !firstRun);
  els.pinConfirm.required = firstRun;
  els.pinLabel.textContent = firstRun ? 'Neue PIN festlegen' : 'PIN';
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
  renderDailyBits();
  renderTopics();
  maybeShowBioCard();
  // Verlauf neu aufbauen: Startseite ist die Basis
  history.replaceState({ rm: 'home' }, '');
  if (resume.screen === 'editor' && state.topics.some(t => t.id === resume.id && !t.deletedAt)) {
    openTopic(resume.id);
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

async function showHome() {
  stopRecognition();
  stopReading();
  if (cryptoKey) await persistState(true).catch(() => {});
  currentTopicId = null;
  renderTopics();
  showScreen(els.homeScreen);
}

function onPopState(e) {
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
    if (!(els.editorScreen.classList.contains('active') && currentTopicId === s.id)) openTopic(s.id, { push: false });
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
function excerpt(text) {
  return (text || '').replace(/\s+/g, ' ').trim() || 'Noch nichts geschrieben';
}
function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}
function catOf(t) { return categoryOrder.includes(t.category) ? t.category : 'Sonstiges'; }

function renderTopics() {
  if (!state) return;
  const q = els.searchInput.value.trim().toLowerCase();
  const all = activeTopics();
  let topics = all;
  if (currentFilter !== 'Alle') topics = topics.filter(t => catOf(t) === currentFilter);
  if (q) topics = topics.filter(t => `${t.title} ${t.content}`.toLowerCase().includes(q));
  topics.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  els.topicList.innerHTML = topics.map(t => `
    <article class="row" data-id="${escapeHtml(t.id)}" data-cat="${escapeHtml(catOf(t))}" tabindex="0">
      <div class="row-top"><h2>${escapeHtml(t.title)}</h2><time>${escapeHtml(formatDate(t.updatedAt))}</time></div>
      <p>${escapeHtml(excerpt(t.content))}</p>
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

function setEditorTag(topic) {
  const cat = catOf(topic);
  const varName = { 'Bücher': '--c-books', 'Apps': '--c-apps', 'Privat': '--c-private', 'Sonstiges': '--c-other' }[cat];
  els.editorTag.innerHTML = `<span class="dot" data-cat="${escapeHtml(cat)}"></span>${escapeHtml(cat)}`;
  els.editorTag.style.setProperty('--tag-c', `var(${varName})`);
}

function openTopic(id, { push = true } = {}) {
  const topic = state?.topics.find(t => t.id === id && !t.deletedAt);
  if (!topic) return;
  currentTopicId = id;
  els.editorTitle.textContent = topic.title;
  setEditorTag(topic);
  els.topicText.value = topic.content || '';
  setEditing(!topic.content);
  els.dateLine.textContent = formatLong(topic.updatedAt);
  els.saveState.textContent = 'Gespeichert';
  if (push) history.pushState({ rm: 'editor', id }, '');
  showScreen(els.editorScreen);
}

function currentTopic() {
  return state?.topics.find(t => t.id === currentTopicId) || null;
}

function setEditing(on, focus = false) {
  els.topicText.readOnly = !on;
  els.editBtn.classList.toggle('active', on);
  els.editBtn.querySelector('span').textContent = on ? 'Fertig' : 'Bearbeiten';
  if (on && focus) {
    els.topicText.focus();
    const len = els.topicText.value.length;
    els.topicText.setSelectionRange(len, len);
  }
  if (!on) els.topicText.blur();
}

function openTopicSheet(mode = 'create', id = null) {
  topicSheetMode = mode;
  topicSheetId = id;
  if (mode === 'edit') {
    const topic = state.topics.find(t => t.id === id);
    if (!topic) return;
    els.topicSheetTitle.textContent = 'Thema bearbeiten';
    els.saveTopicBtn.textContent = 'Speichern';
    els.topicName.value = topic.title;
    selectCategory(catOf(topic));
  } else {
    els.topicSheetTitle.textContent = 'Neues Thema';
    els.saveTopicBtn.textContent = 'Thema anlegen';
    els.topicName.value = '';
    selectCategory(currentFilter !== 'Alle' ? currentFilter : 'Bücher');
  }
  openSheet(els.topicSheet);
  setTimeout(() => els.topicName.focus(), 80);
}

function selectCategory(cat) {
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
  openSheet(els.actionSheet);
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
      <p>${escapeHtml(excerpt(t.content))}</p>
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
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  els.readBtn.classList.remove('active');
}
function readText() {
  if (!('speechSynthesis' in window)) return showToast('Vorlesen geht auf diesem Gerät nicht');
  if (speechSynthesis.speaking || speechSynthesis.pending) { stopReading(); return showToast('Vorlesen gestoppt'); }
  const text = els.topicText.value.trim();
  if (!text) return showToast('Hier steht noch nichts');
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'de-DE';
  u.rate = 0.95;
  u.onend = u.onerror = () => els.readBtn.classList.remove('active');
  els.readBtn.classList.add('active');
  speechSynthesis.speak(u);
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

function insertSpokenSegment(raw) {
  let seg = cleanSpoken(raw);
  if (!seg) return;
  setEditing(true);
  const ta = els.topicText;
  const value = ta.value;
  let pos = document.activeElement === ta ? ta.selectionEnd : (dictInsertPos ?? value.length);
  pos = Math.min(Math.max(0, pos), value.length);
  let before = value.slice(0, pos);
  const after = value.slice(pos);

  const firstWord = bare(seg.split(/\s+/)[0]);
  const continuing = dictLastAuto && dictLastAuto.pos === before.length - 1 && /[.?!]$/.test(before);
  if (continuing && /^[,;:.!?]/.test(seg)) {
    // gesagtes Satzzeichen ersetzt den automatischen Punkt
    before = before.slice(0, -1);
    seg = seg.replace(/^([,;:.!?])\s*/, '$1 ');
  } else if (continuing && (JOIN_PLAIN.has(firstWord) || COMMA_BEFORE.has(firstWord))) {
    // Pause war mitten im Satz: automatischen Punkt wieder wegnehmen
    before = before.slice(0, -1) + (JOIN_PLAIN.has(firstWord) ? '' : ',');
    seg = lowerFirstWord(seg);
  } else {
    const trimmed = before.replace(/\s+$/, '');
    if (!trimmed || /[.?!]$/.test(trimmed) || /\n\s*$/.test(before)) seg = capitalize(seg);
  }

  // Satzende ergänzen
  if (!/[.?!,:;]$/.test(seg) && !/\n$/.test(seg)) {
    const fullBefore = (before + ' ' + seg);
    const lastSentence = fullBefore.split(/[.?!\n]/).pop();
    seg += looksLikeQuestion(lastSentence) ? '?' : '.';
  }

  const needsSpace = before.length && !/[\s\n]$/.test(before) && !/^[,.;:!?\n]/.test(seg);
  const inserted = (needsSpace ? ' ' : '') + seg;
  const afterNeedsSpace = after.length && !/^[\s\n,.;:!?]/.test(after);
  ta.value = before + inserted + (afterNeedsSpace ? ' ' : '') + after;
  const caret = before.length + inserted.length;
  dictInsertPos = caret;
  dictLastAuto = /[.?]$/.test(seg) ? { pos: caret - 1 } : null;
  try { ta.setSelectionRange(caret, caret); } catch {}
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  // Mitscrollen, damit du siehst, was geschrieben wird
  if (caret >= ta.value.length - 2) ta.scrollTop = ta.scrollHeight;
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

function startRecognizer() {
  const Ctor = speechRecognitionCtor();
  if (!Ctor || !dictWanted) return;
  const rec = new Ctor();
  recognition = rec;
  rec.lang = 'de-DE';
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  dictSessionStart = Date.now();
  dictSessionFinal = '';
  dictProcessed = new Set();

  rec.onresult = event => {
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
    $('dictText').textContent = interim.trim();
  };
  rec.onerror = event => {
    const e = event.error;
    if (e === 'no-speech' || e === 'aborted') return;   // einfach weiter zuhören
    if (e === 'not-allowed' || e === 'service-not-allowed') {
      dictWanted = false;
      showToast('Das Mikrofon ist nicht erlaubt. Erlaube es in den Einstellungen des Browsers für diese Seite.', 5000);
    } else if (e === 'audio-capture') {
      dictWanted = false;
      showToast('Das Mikrofon wird gerade von einer anderen App benutzt.', 4500);
    } else if (e === 'network') {
      dictWanted = false;
      showToast('Die Spracheingabe braucht gerade Internet.', 4500);
    } else if (e === 'language-not-supported') {
      dictWanted = false;
      keyboardDictationFallback();
    }
  };
  rec.onend = () => {
    if (recognition !== rec) return;
    const short = Date.now() - dictSessionStart < 1200;
    dictQuickFails = short ? dictQuickFails + 1 : 0;
    if (dictWanted && dictQuickFails < 8 && !document.hidden && els.editorScreen.classList.contains('active')) {
      // Pause erkannt: sofort wieder zuhören
      setTimeout(() => { if (dictWanted) { try { startRecognizer(); } catch { finishDictationUi(); } } }, 120);
    } else {
      if (dictWanted && dictQuickFails >= 8) showToast('Die Spracheingabe hat aufgehört. Tippe nochmal auf das Mikrofon.', 4000);
      dictWanted = false;
      finishDictationUi();
    }
  };
  try { rec.start(); } catch { setTimeout(() => { if (dictWanted) startRecognizer(); }, 400); }
}

function finishDictationUi() {
  isListening = false;
  els.micBtn.classList.remove('listening');
  els.micBtn.setAttribute('aria-label', 'Spracheingabe starten');
  showDictation(false);
  holdScreenOn(false);
}

function startDictation() {
  if (!speechRecognitionCtor()) return keyboardDictationFallback();
  stopReading();
  dictWanted = true;
  isListening = true;
  dictQuickFails = 0;
  const ta = els.topicText;
  dictInsertPos = document.activeElement === ta ? ta.selectionEnd : ta.value.length;
  dictLastAuto = null;
  setEditing(true);
  els.micBtn.classList.add('listening');
  els.micBtn.setAttribute('aria-label', 'Spracheingabe beenden');
  showDictation(true);
  holdScreenOn(true);
  startRecognizer();
}

function stopRecognition() {
  const wasOn = dictWanted || isListening;
  dictWanted = false;
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
  showToast('Sicherung gespeichert (verschlüsselt)');
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
  localStorage.setItem(CONFIG_SALT, parsed.salt);
  localStorage.setItem(CONFIG_VERIFIER, JSON.stringify(parsed.verifier));
  localStorage.removeItem(BIOMETRIC_CONFIG);
  await idbDelete(BIOMETRIC_KEY).catch(() => {});
  await idbSet(VAULT_KEY, parsed.vault);
  lockApp('Sicherung geladen. Bitte einmal mit der PIN dieser Sicherung entsperren.');
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }
}

/* =====================================================================
   Ereignisse
   ===================================================================== */

function wireEvents() {
  els.pinForm.addEventListener('submit', async e => {
    e.preventDefault();
    const pin = els.pinInput.value.trim();
    if (!/^\d{4,6}$/.test(pin)) { els.lockHint.textContent = 'Bitte 4 bis 6 Ziffern eingeben.'; return; }
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
  els.catPicker.addEventListener('click', e => { const b = e.target.closest('.cat'); if (b) selectCategory(b.dataset.cat); });
  els.topicForm.addEventListener('submit', e => { e.preventDefault(); saveTopicSheet(); });
  els.cancelTopicBtn.addEventListener('click', () => closeSheet(els.topicSheet));

  els.actionOpenBtn.addEventListener('click', () => {
    const id = actionTopicId;
    closeSheetAndReplace(els.actionSheet, { rm: 'editor', id });
    openTopic(id, { push: false });
  });
  els.actionRenameBtn.addEventListener('click', () => openTopicSheet('edit', actionTopicId));
  els.actionTrashBtn.addEventListener('click', () => {
    const id = actionTopicId;
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
  els.trashBackBtn.addEventListener('click', goHomeFromScreen);
  els.editBtn.addEventListener('click', () => setEditing(els.topicText.readOnly, true));
  els.copyBtn.addEventListener('click', copyAll);
  els.readBtn.addEventListener('click', readText);
  els.deleteBtn.addEventListener('click', () => { if (currentTopicId) moveTopicToTrash(currentTopicId); });
  els.micBtn.addEventListener('click', toggleRecognition);
  els.editorMenuBtn.addEventListener('click', () => openActionSheet(currentTopicId));

  els.topicText.addEventListener('input', () => {
    const topic = currentTopic();
    if (!topic) return;
    topic.content = els.topicText.value;
    topic.updatedAt = new Date().toISOString();
    els.dateLine.textContent = formatLong(topic.updatedAt);
    persistState();
  });

  els.menuBtn.addEventListener('click', () => { updateBiometricUi(); openSheet(els.menuSheet); });
  els.openTrashBtn.addEventListener('click', () => { closeSheetAndReplace(els.menuSheet, { rm: 'trash' }); openTrash({ push: false }); });
  els.biometricMenuBtn.addEventListener('click', async () => {
    if (hasBiometricConfig()) { disableBiometrics(); }
    else { closeSheet(els.menuSheet); await enableBiometrics(); maybeShowBioCard(); }
  });
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

  [els.topicSheet, els.actionSheet, els.menuSheet, els.nameSheet, els.confirmSheet].forEach(dlg => {
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

  window.addEventListener('popstate', onPopState);
  document.addEventListener('visibilitychange', () => { if (document.hidden) onHidden(); else onVisible(); });
  window.addEventListener('pagehide', onHidden);
  window.addEventListener('focus', () => { if (suppressLock) setTimeout(() => { suppressLock = false; }, 800); });
}

async function boot() {
  placeStars();
  applySky();
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
  if (hasVaultConfig() && await tryResumeSession()) return;
  autoBiometric();
}

boot().catch(() => {
  els.lockHint.textContent = 'Reci mi konnte nicht starten. Lade die Seite bitte neu.';
});
