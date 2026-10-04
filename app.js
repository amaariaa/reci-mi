'use strict';

const APP_VERSION = '1.0.0';
const DB_NAME = 'reci-mi-db';
const STORE_NAME = 'secure-store';
const VAULT_KEY = 'vault';
const CONFIG_SALT = 'gr_salt_v1';
const CONFIG_VERIFIER = 'gr_verifier_v1';
const AUTO_LOCK_MS = 5 * 60 * 1000;

let db;
let cryptoKey = null;
let state = null;
let currentTopicId = null;
let currentFilter = 'Alle';
let saveTimer = null;
let lockTimer = null;
let recognition = null;
let isListening = false;
let deferredInstallPrompt = null;
let confirmResolver = null;
let dialogMode = 'create';

const paletteCycle = ['rose', 'sage', 'lavender', 'sand', 'mint'];
const categoryIcons = {
  'Bücher': '▤',
  'Apps': '◇',
  'Privat': '♡',
  'Sonstiges': '✦'
};

const $ = id => document.getElementById(id);
const els = {
  lockScreen: $('lockScreen'), homeScreen: $('homeScreen'), editorScreen: $('editorScreen'), trashScreen: $('trashScreen'),
  pinForm: $('pinForm'), pinInput: $('pinInput'), pinConfirm: $('pinConfirm'), pinSubmit: $('pinSubmit'), pinLabel: $('pinLabel'), lockSubtitle: $('lockSubtitle'), lockHint: $('lockHint'),
  menuBtn: $('menuBtn'), closeMenuBtn: $('closeMenuBtn'), sideMenu: $('sideMenu'), searchBtn: $('searchBtn'), searchWrap: $('searchWrap'), searchInput: $('searchInput'), filterRow: $('filterRow'),
  topicList: $('topicList'), emptyState: $('emptyState'), newTopicBtn: $('newTopicBtn'), quickAddBtn: $('quickAddBtn'), emptyAddBtn: $('emptyAddBtn'),
  backBtn: $('backBtn'), editorMenuBtn: $('editorMenuBtn'), editorTitle: $('editorTitle'), editorBadge: $('editorBadge'), dateLine: $('dateLine'), topicText: $('topicText'), saveState: $('saveState'), micBtn: $('micBtn'),
  editBtn: $('editBtn'), copyBtn: $('copyBtn'), readBtn: $('readBtn'), deleteBtn: $('deleteBtn'),
  trashBackBtn: $('trashBackBtn'), trashList: $('trashList'), openTrashBtn: $('openTrashBtn'),
  exportBtn: $('exportBtn'), importInput: $('importInput'), installBtn: $('installBtn'), lockBtn: $('lockBtn'),
  topicDialog: $('topicDialog'), topicForm: $('topicForm'), topicDialogTitle: $('topicDialogTitle'), topicName: $('topicName'), topicCategory: $('topicCategory'), cancelTopicBtn: $('cancelTopicBtn'),
  confirmDialog: $('confirmDialog'), confirmTitle: $('confirmTitle'), confirmText: $('confirmText'), confirmCancelBtn: $('confirmCancelBtn'), confirmOkBtn: $('confirmOkBtn'),
  toast: $('toast')
};

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
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
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

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(str) {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(pin, saltBytes) {
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: 250000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptValue(value, key = cryptoKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
  return { iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(cipher)) };
}

async function decryptValue(payload, key = cryptoKey) {
  const iv = base64ToBytes(payload.iv);
  const data = base64ToBytes(payload.data);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return JSON.parse(new TextDecoder().decode(plain));
}

function initialState() {
  return {
    version: APP_VERSION,
    createdAt: new Date().toISOString(),
    settings: { autoLockMinutes: 5 },
    topics: []
  };
}

function hasVaultConfig() {
  return Boolean(localStorage.getItem(CONFIG_SALT) && localStorage.getItem(CONFIG_VERIFIER));
}

function configureLockScreen() {
  const firstRun = !hasVaultConfig();
  els.pinInput.value = '';
  els.pinConfirm.value = '';
  els.pinConfirm.classList.toggle('hidden', !firstRun);
  els.pinConfirm.required = firstRun;
  els.pinLabel.textContent = firstRun ? 'Neue PIN festlegen' : 'PIN';
  els.pinSubmit.textContent = firstRun ? 'Reci mi einrichten' : 'Entsperren';
  els.lockSubtitle.textContent = firstRun ? 'Richte deine private App einmalig ein.' : 'Deine Gedanken bleiben bei dir.';
  els.lockHint.textContent = firstRun
    ? 'Wichtig: Wenn du deine PIN vergisst, können die verschlüsselten Notizen nicht wiederhergestellt werden.'
    : 'Die PIN wird nicht als Klartext gespeichert.';
  setTimeout(() => els.pinInput.focus(), 80);
}

async function setupVault(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(pin, salt);
  const verifier = await encryptValue({ ok: true, marker: 'reci-mi' }, key);
  const fresh = initialState();
  const encryptedVault = await encryptValue(fresh, key);
  localStorage.setItem(CONFIG_SALT, bytesToBase64(salt));
  localStorage.setItem(CONFIG_VERIFIER, JSON.stringify(verifier));
  await idbSet(VAULT_KEY, encryptedVault);
  cryptoKey = key;
  state = fresh;
}

async function unlockVault(pin) {
  const salt = base64ToBytes(localStorage.getItem(CONFIG_SALT));
  const key = await deriveKey(pin, salt);
  const verifier = JSON.parse(localStorage.getItem(CONFIG_VERIFIER));
  const check = await decryptValue(verifier, key);
  if (!check || check.marker !== 'reci-mi') throw new Error('Falsche PIN');
  const encryptedVault = await idbGet(VAULT_KEY);
  if (!encryptedVault) throw new Error('Keine verschlüsselten Daten gefunden');
  const decrypted = await decryptValue(encryptedVault, key);
  cryptoKey = key;
  state = decrypted;
  if (!Array.isArray(state.topics)) state.topics = [];
}

async function persistState(immediate = false) {
  if (!cryptoKey || !state) return;
  if (!immediate) {
    clearTimeout(saveTimer);
    els.saveState.textContent = 'Speichert …';
    saveTimer = setTimeout(() => persistState(true), 550);
    return;
  }
  const payload = await encryptValue(state);
  await idbSet(VAULT_KEY, payload);
  els.saveState.textContent = 'Gespeichert';
}

function showScreen(screen) {
  [els.lockScreen, els.homeScreen, els.editorScreen, els.trashScreen].forEach(el => el.classList.remove('active'));
  screen.classList.add('active');
  resetLockTimer();
}

function resetLockTimer() {
  clearTimeout(lockTimer);
  if (!cryptoKey) return;
  lockTimer = setTimeout(() => lockApp('Automatisch gesperrt.'), AUTO_LOCK_MS);
}

function lockApp(message = '') {
  stopRecognition();
  stopReading();
  clearTimeout(saveTimer);
  if (cryptoKey && state) persistState(true).catch(() => {});
  cryptoKey = null;
  state = null;
  currentTopicId = null;
  els.sideMenu.classList.remove('open');
  showScreen(els.lockScreen);
  configureLockScreen();
  if (message) els.lockHint.textContent = message;
}

function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function activeTopics() {
  return state.topics.filter(t => !t.deletedAt);
}

function deletedTopics() {
  return state.topics.filter(t => Boolean(t.deletedAt));
}

function formatDate(iso, includeTime = false) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return includeTime ? `Heute, ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}` : 'Heute';
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function excerpt(text) {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  return clean || 'Noch keine Gedanken eingetragen';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
}

function renderTopics() {
  if (!state) return;
  const q = els.searchInput.value.trim().toLowerCase();
  let topics = activeTopics();
  if (currentFilter !== 'Alle') topics = topics.filter(t => t.category === currentFilter);
  if (q) topics = topics.filter(t => `${t.title} ${t.content}`.toLowerCase().includes(q));
  topics.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  els.topicList.innerHTML = topics.map(t => `
    <article class="topic-card" data-id="${escapeHtml(t.id)}" data-palette="${escapeHtml(t.palette || 'rose')}" tabindex="0">
      <div class="topic-icon">${escapeHtml(t.icon || categoryIcons[t.category] || '✦')}</div>
      <div class="topic-info">
        <h2>${escapeHtml(t.title)}</h2>
        <p>${escapeHtml(excerpt(t.content))}</p>
      </div>
      <div class="topic-meta">
        <span class="topic-date">${escapeHtml(formatDate(t.updatedAt, true))}</span>
        <span class="topic-arrow">›</span>
      </div>
    </article>`).join('');

  els.emptyState.classList.toggle('hidden', topics.length !== 0 || Boolean(q) || currentFilter !== 'Alle');

  els.topicList.querySelectorAll('.topic-card').forEach(card => {
    const open = () => openTopic(card.dataset.id);
    card.addEventListener('click', open);
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') open(); });
  });
}

function openTopic(id) {
  const topic = state.topics.find(t => t.id === id && !t.deletedAt);
  if (!topic) return;
  currentTopicId = id;
  els.editorTitle.textContent = topic.title;
  els.editorBadge.textContent = topic.icon || categoryIcons[topic.category] || '✦';
  els.topicText.value = topic.content || '';
  els.topicText.readOnly = true;
  els.editBtn.classList.remove('active');
  els.dateLine.textContent = `Zuletzt bearbeitet: ${formatDate(topic.updatedAt, true)}`;
  els.saveState.textContent = 'Gespeichert';
  showScreen(els.editorScreen);
}

function currentTopic() {
  return state?.topics.find(t => t.id === currentTopicId) || null;
}

function toggleEdit(forceOn = false) {
  const topic = currentTopic();
  if (!topic) return;
  const editing = forceOn || els.topicText.readOnly;
  els.topicText.readOnly = !editing;
  els.editBtn.classList.toggle('active', editing);
  if (editing) {
    els.topicText.focus();
    const len = els.topicText.value.length;
    els.topicText.setSelectionRange(len, len);
  }
}

function openTopicDialog(mode = 'create') {
  dialogMode = mode;
  if (mode === 'edit') {
    const topic = currentTopic();
    if (!topic) return;
    els.topicDialogTitle.textContent = 'Thema umbenennen';
    els.topicName.value = topic.title;
    els.topicCategory.value = topic.category || 'Sonstiges';
  } else {
    els.topicDialogTitle.textContent = 'Neues Thema';
    els.topicName.value = '';
    els.topicCategory.value = 'Bücher';
  }
  els.topicDialog.showModal();
  setTimeout(() => els.topicName.focus(), 60);
}

async function saveTopicDialog() {
  const title = els.topicName.value.trim();
  const category = els.topicCategory.value;
  if (!title) return;
  if (dialogMode === 'edit') {
    const topic = currentTopic();
    if (!topic) return;
    topic.title = title;
    topic.category = category;
    topic.icon = categoryIcons[category] || '✦';
    topic.updatedAt = new Date().toISOString();
    els.editorTitle.textContent = topic.title;
    els.editorBadge.textContent = topic.icon;
  } else {
    const now = new Date().toISOString();
    const topic = {
      id: uid(), title, category, icon: categoryIcons[category] || '✦',
      palette: paletteCycle[activeTopics().length % paletteCycle.length],
      content: '', createdAt: now, updatedAt: now, deletedAt: null
    };
    state.topics.push(topic);
    currentTopicId = topic.id;
  }
  els.topicDialog.close();
  await persistState(true);
  renderTopics();
  if (dialogMode === 'create') openTopic(currentTopicId);
  showToast('Gespeichert');
}

function askConfirm(title, text, okLabel = 'Löschen') {
  els.confirmTitle.textContent = title;
  els.confirmText.textContent = text;
  els.confirmOkBtn.textContent = okLabel;
  els.confirmDialog.showModal();
  return new Promise(resolve => { confirmResolver = resolve; });
}

async function moveCurrentToTrash() {
  const topic = currentTopic();
  if (!topic) return;
  const yes = await askConfirm('Thema löschen?', `„${topic.title}“ wird in den Papierkorb verschoben.`, 'In Papierkorb');
  if (!yes) return;
  topic.deletedAt = new Date().toISOString();
  topic.updatedAt = new Date().toISOString();
  await persistState(true);
  currentTopicId = null;
  renderTopics();
  showScreen(els.homeScreen);
  showToast('In den Papierkorb verschoben');
}

function renderTrash() {
  const topics = deletedTopics().sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
  if (!topics.length) {
    els.trashList.innerHTML = '<div class="empty-state"><div class="empty-icon">✦</div><h2>Papierkorb ist leer</h2><p>Hier erscheinen gelöschte Themen.</p></div>';
    return;
  }
  els.trashList.innerHTML = topics.map(t => `
    <article class="topic-card" data-palette="${escapeHtml(t.palette || 'sand')}">
      <div class="topic-icon">${escapeHtml(t.icon || '✦')}</div>
      <div class="topic-info"><h2>${escapeHtml(t.title)}</h2><p>Gelöscht: ${escapeHtml(formatDate(t.deletedAt, true))}</p></div>
      <div class="trash-actions">
        <button class="small-btn restore-btn" data-id="${escapeHtml(t.id)}">Wiederherstellen</button>
        <button class="small-btn danger purge-btn" data-id="${escapeHtml(t.id)}">Endgültig</button>
      </div>
    </article>`).join('');

  els.trashList.querySelectorAll('.restore-btn').forEach(btn => btn.addEventListener('click', async e => {
    e.stopPropagation();
    const t = state.topics.find(x => x.id === btn.dataset.id);
    if (!t) return;
    t.deletedAt = null;
    t.updatedAt = new Date().toISOString();
    await persistState(true);
    renderTrash();
    showToast('Thema wiederhergestellt');
  }));
  els.trashList.querySelectorAll('.purge-btn').forEach(btn => btn.addEventListener('click', async e => {
    e.stopPropagation();
    const t = state.topics.find(x => x.id === btn.dataset.id);
    if (!t) return;
    const yes = await askConfirm('Endgültig löschen?', `„${t.title}“ kann danach nicht wiederhergestellt werden.`, 'Endgültig löschen');
    if (!yes) return;
    state.topics = state.topics.filter(x => x.id !== t.id);
    await persistState(true);
    renderTrash();
    showToast('Endgültig gelöscht');
  }));
}

function openMenu() { els.sideMenu.classList.add('open'); els.sideMenu.setAttribute('aria-hidden', 'false'); }
function closeMenu() { els.sideMenu.classList.remove('open'); els.sideMenu.setAttribute('aria-hidden', 'true'); }

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove('show'), 1800);
}

async function copyAll() {
  const text = els.topicText.value;
  if (!text.trim()) return showToast('Der Text ist noch leer');
  try {
    await navigator.clipboard.writeText(text);
    showToast('Gesamter Text kopiert');
  } catch {
    els.topicText.focus();
    els.topicText.select();
    document.execCommand('copy');
    showToast('Gesamter Text kopiert');
  }
}

function stopReading() {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  els.readBtn.classList.remove('active');
}

function readText() {
  if (!('speechSynthesis' in window)) return showToast('Vorlesen wird auf diesem Gerät nicht unterstützt');
  if (speechSynthesis.speaking || speechSynthesis.pending) {
    stopReading();
    showToast('Vorlesen gestoppt');
    return;
  }
  const text = els.topicText.value.trim();
  if (!text) return showToast('Der Text ist noch leer');
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'de-DE';
  utterance.rate = 0.95;
  utterance.onend = () => els.readBtn.classList.remove('active');
  utterance.onerror = () => els.readBtn.classList.remove('active');
  els.readBtn.classList.add('active');
  speechSynthesis.speak(utterance);
}

function speechRecognitionCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function stopRecognition() {
  if (recognition && isListening) {
    try { recognition.stop(); } catch {}
  }
  isListening = false;
  els.micBtn.classList.remove('listening');
}

function appendTranscript(transcript) {
  toggleEdit(true);
  const current = els.topicText.value;
  const start = els.topicText.selectionStart ?? current.length;
  const end = els.topicText.selectionEnd ?? current.length;
  const before = current.slice(0, start);
  const after = current.slice(end);
  const needsSpace = before.length && !/[\s\n]$/.test(before);
  const inserted = `${needsSpace ? ' ' : ''}${transcript.trim()}`;
  els.topicText.value = before + inserted + after;
  const caret = before.length + inserted.length;
  els.topicText.setSelectionRange(caret, caret);
  els.topicText.dispatchEvent(new Event('input', { bubbles: true }));
}

function toggleRecognition() {
  const Ctor = speechRecognitionCtor();
  if (!Ctor) {
    showToast('Direkte Spracheingabe wird hier nicht unterstützt. Nutze das Mikrofon deiner Samsung-Tastatur.');
    toggleEdit(true);
    return;
  }
  if (isListening) return stopRecognition();
  recognition = new Ctor();
  recognition.lang = 'de-DE';
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.onstart = () => {
    isListening = true;
    els.micBtn.classList.add('listening');
    showToast('Ich höre zu …');
  };
  recognition.onresult = event => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) appendTranscript(event.results[i][0].transcript);
    }
  };
  recognition.onerror = event => {
    if (event.error === 'not-allowed') showToast('Mikrofonzugriff wurde nicht erlaubt');
    else if (event.error !== 'aborted') showToast('Spracheingabe wurde beendet');
  };
  recognition.onend = () => {
    isListening = false;
    els.micBtn.classList.remove('listening');
  };
  try { recognition.start(); } catch { showToast('Spracheingabe konnte nicht gestartet werden'); }
}

async function exportBackup() {
  await persistState(true);
  const vault = await idbGet(VAULT_KEY);
  const payload = {
    format: 'ReciMi-Backup', version: 1, appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    salt: localStorage.getItem(CONFIG_SALT),
    verifier: JSON.parse(localStorage.getItem(CONFIG_VERIFIER)),
    vault
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Reci mi-Sicherung-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast('Verschlüsselte Sicherung erstellt');
}

async function importBackup(file) {
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
    if (parsed.format !== 'ReciMi-Backup' || !parsed.salt || !parsed.verifier || !parsed.vault) throw new Error('Ungültig');
  } catch {
    showToast('Diese Sicherungsdatei ist ungültig');
    return;
  }
  const yes = await askConfirm('Sicherung importieren?', 'Die aktuellen Daten auf diesem Gerät werden durch die Sicherung ersetzt. Du benötigst danach die PIN der Sicherung.', 'Importieren');
  if (!yes) return;
  localStorage.setItem(CONFIG_SALT, parsed.salt);
  localStorage.setItem(CONFIG_VERIFIER, JSON.stringify(parsed.verifier));
  await idbSet(VAULT_KEY, parsed.vault);
  closeMenu();
  lockApp('Sicherung importiert. Bitte mit der PIN dieser Sicherung entsperren.');
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }
}

function wireEvents() {
  els.pinForm.addEventListener('submit', async e => {
    e.preventDefault();
    const pin = els.pinInput.value.trim();
    if (!/^\d{4,6}$/.test(pin)) {
      els.lockHint.textContent = 'Bitte 4 bis 6 Ziffern verwenden.';
      return;
    }
    els.pinSubmit.disabled = true;
    try {
      if (!hasVaultConfig()) {
        if (pin !== els.pinConfirm.value.trim()) throw new Error('Die PINs stimmen nicht überein.');
        await setupVault(pin);
      } else {
        await unlockVault(pin);
      }
      els.pinInput.value = '';
      els.pinConfirm.value = '';
      renderTopics();
      showScreen(els.homeScreen);
    } catch (err) {
      els.lockHint.textContent = err.message === 'Falsche PIN' ? 'Die PIN ist nicht richtig.' : (err.message || 'Entsperren nicht möglich.');
      cryptoKey = null;
      state = null;
    } finally {
      els.pinSubmit.disabled = false;
    }
  });

  [els.newTopicBtn, els.quickAddBtn, els.emptyAddBtn].forEach(btn => btn.addEventListener('click', () => openTopicDialog('create')));
  els.cancelTopicBtn.addEventListener('click', () => els.topicDialog.close());
  els.topicForm.addEventListener('submit', e => { e.preventDefault(); saveTopicDialog(); });

  els.filterRow.addEventListener('click', e => {
    const chip = e.target.closest('.filter-chip');
    if (!chip) return;
    currentFilter = chip.dataset.filter;
    els.filterRow.querySelectorAll('.filter-chip').forEach(c => c.classList.toggle('active', c === chip));
    renderTopics();
  });
  els.searchBtn.addEventListener('click', () => {
    els.searchWrap.classList.toggle('hidden');
    if (!els.searchWrap.classList.contains('hidden')) els.searchInput.focus();
  });
  els.searchInput.addEventListener('input', renderTopics);

  els.backBtn.addEventListener('click', async () => {
    stopRecognition(); stopReading();
    await persistState(true);
    renderTopics();
    showScreen(els.homeScreen);
  });
  els.editBtn.addEventListener('click', () => toggleEdit());
  els.copyBtn.addEventListener('click', copyAll);
  els.readBtn.addEventListener('click', readText);
  els.deleteBtn.addEventListener('click', moveCurrentToTrash);
  els.micBtn.addEventListener('click', toggleRecognition);
  els.editorMenuBtn.addEventListener('click', () => openTopicDialog('edit'));

  els.topicText.addEventListener('input', () => {
    const topic = currentTopic();
    if (!topic) return;
    topic.content = els.topicText.value;
    topic.updatedAt = new Date().toISOString();
    els.dateLine.textContent = `Zuletzt bearbeitet: ${formatDate(topic.updatedAt, true)}`;
    persistState();
  });

  els.menuBtn.addEventListener('click', openMenu);
  els.closeMenuBtn.addEventListener('click', closeMenu);
  els.sideMenu.addEventListener('click', e => { if (e.target === els.sideMenu) closeMenu(); });
  els.openTrashBtn.addEventListener('click', () => { closeMenu(); renderTrash(); showScreen(els.trashScreen); });
  els.trashBackBtn.addEventListener('click', () => { renderTopics(); showScreen(els.homeScreen); });
  els.exportBtn.addEventListener('click', exportBackup);
  els.importInput.addEventListener('change', e => { const file = e.target.files?.[0]; if (file) importBackup(file); e.target.value = ''; });
  els.lockBtn.addEventListener('click', () => lockApp());

  els.confirmCancelBtn.addEventListener('click', () => {
    els.confirmDialog.close();
    if (confirmResolver) confirmResolver(false);
    confirmResolver = null;
  });
  els.confirmOkBtn.addEventListener('click', () => {
    els.confirmDialog.close();
    if (confirmResolver) confirmResolver(true);
    confirmResolver = null;
  });
  els.confirmDialog.addEventListener('cancel', e => {
    e.preventDefault();
    els.confirmDialog.close();
    if (confirmResolver) confirmResolver(false);
    confirmResolver = null;
  });

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredInstallPrompt = e;
    els.installBtn.classList.remove('hidden');
  });
  els.installBtn.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    els.installBtn.classList.add('hidden');
  });

  ['pointerdown', 'keydown', 'touchstart'].forEach(evt => document.addEventListener(evt, resetLockTimer, { passive: true }));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopReading();
      persistState(true).catch(() => {});
    }
  });
  window.addEventListener('pagehide', () => { persistState(true).catch(() => {}); });
}

async function boot() {
  if (!window.crypto?.subtle || !window.indexedDB) {
    els.lockHint.textContent = 'Dieser Browser unterstützt die benötigte sichere lokale Speicherung nicht.';
    els.pinSubmit.disabled = true;
    return;
  }
  await initDb();
  configureLockScreen();
  wireEvents();
  registerServiceWorker();
}

boot().catch(() => {
  els.lockHint.textContent = 'Reci mi konnte nicht gestartet werden.';
});
