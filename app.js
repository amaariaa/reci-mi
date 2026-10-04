'use strict';

const APP_VERSION = '1.3.0';
const DB_NAME = 'reci-mi-db';
const STORE_NAME = 'secure-store';
const VAULT_KEY = 'vault';
const CONFIG_SALT = 'gr_salt_v1';
const CONFIG_VERIFIER = 'gr_verifier_v1';
const BIOMETRIC_CONFIG = 'rm_biometric_v1';
const BIOMETRIC_KEY = 'biometric-key';
const BACKGROUND_LOCK_DELAY_MS = 60000;
const LONG_PRESS_MS = 650;
const EXIT_BACK_WINDOW_MS = 1800;
const APP_HISTORY_URL = `${location.pathname}${location.search}${location.hash}`;

let db;
let cryptoKey = null;
let state = null;
let currentTopicId = null;
let currentFilter = 'Alle';
let saveTimer = null;
let backgroundLockTimer = null;
let resumeScreen = 'home';
let resumeTopicId = null;
let biometricBusy = false;
let suppressBackgroundLock = false;
let recognition = null;
let isListening = false;
let deferredInstallPrompt = null;
let confirmResolver = null;
let dialogMode = 'create';
let topicActionId = null;
let backGuardReady = false;
let lastExitBackAt = 0;
let exitingByBack = false;

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
  pinForm: $('pinForm'), pinInput: $('pinInput'), pinConfirm: $('pinConfirm'), pinSubmit: $('pinSubmit'), pinLabel: $('pinLabel'), lockSubtitle: $('lockSubtitle'), lockHint: $('lockHint'), bioUnlockBtn: $('bioUnlockBtn'), bioDivider: $('bioDivider'),
  menuBtn: $('menuBtn'), closeMenuBtn: $('closeMenuBtn'), sideMenu: $('sideMenu'), searchBtn: $('searchBtn'), searchWrap: $('searchWrap'), searchInput: $('searchInput'), filterRow: $('filterRow'),
  topicList: $('topicList'), emptyState: $('emptyState'), newTopicBtn: $('newTopicBtn'), quickAddBtn: $('quickAddBtn'), emptyAddBtn: $('emptyAddBtn'),
  backBtn: $('backBtn'), editorMenuBtn: $('editorMenuBtn'), editorTitle: $('editorTitle'), editorBadge: $('editorBadge'), dateLine: $('dateLine'), topicText: $('topicText'), saveState: $('saveState'), micBtn: $('micBtn'),
  editBtn: $('editBtn'), copyBtn: $('copyBtn'), readBtn: $('readBtn'), deleteBtn: $('deleteBtn'),
  trashBackBtn: $('trashBackBtn'), trashList: $('trashList'), openTrashBtn: $('openTrashBtn'),
  exportBtn: $('exportBtn'), importInput: $('importInput'), installBtn: $('installBtn'), biometricMenuBtn: $('biometricMenuBtn'), lockBtn: $('lockBtn'),
  topicDialog: $('topicDialog'), topicForm: $('topicForm'), topicDialogTitle: $('topicDialogTitle'), topicName: $('topicName'), topicCategory: $('topicCategory'), cancelTopicBtn: $('cancelTopicBtn'),
  confirmDialog: $('confirmDialog'), confirmTitle: $('confirmTitle'), confirmText: $('confirmText'), confirmCancelBtn: $('confirmCancelBtn'), confirmOkBtn: $('confirmOkBtn'),
  topicActionDialog: $('topicActionDialog'), topicActionTitle: $('topicActionTitle'), topicActionDeleteBtn: $('topicActionDeleteBtn'), topicActionCancelBtn: $('topicActionCancelBtn'),
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

function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function sameBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function concatBytes(...parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function derEcdsaToRaw(signature, size = 32) {
  const bytes = signature instanceof Uint8Array ? signature : new Uint8Array(signature);
  let offset = 0;
  if (bytes[offset++] !== 0x30) throw new Error('Ungültige Signatur');
  let seqLen = bytes[offset++];
  if (seqLen & 0x80) {
    const count = seqLen & 0x7f;
    seqLen = 0;
    for (let i = 0; i < count; i++) seqLen = (seqLen << 8) | bytes[offset++];
  }
  if (bytes[offset++] !== 0x02) throw new Error('Ungültige Signatur');
  let rLen = bytes[offset++];
  let r = bytes.slice(offset, offset + rLen);
  offset += rLen;
  if (bytes[offset++] !== 0x02) throw new Error('Ungültige Signatur');
  let sLen = bytes[offset++];
  let sigS = bytes.slice(offset, offset + sLen);
  while (r.length > size && r[0] === 0) r = r.slice(1);
  while (sigS.length > size && sigS[0] === 0) sigS = sigS.slice(1);
  const out = new Uint8Array(size * 2);
  out.set(r, size - r.length);
  out.set(sigS, size * 2 - sigS.length);
  return out;
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
    settings: { lockMode: 'when-backgrounded-with-grace' },
    topics: []
  };
}

function hasVaultConfig() {
  return Boolean(localStorage.getItem(CONFIG_SALT) && localStorage.getItem(CONFIG_VERIFIER));
}

function getBiometricConfig() {
  try {
    return JSON.parse(localStorage.getItem(BIOMETRIC_CONFIG) || 'null');
  } catch {
    return null;
  }
}

function hasBiometricConfig() {
  const cfg = getBiometricConfig();
  return Boolean(cfg?.credentialId && cfg?.publicKey && cfg?.alg);
}

async function platformBiometricsAvailable() {
  if (!window.PublicKeyCredential || !navigator.credentials) return false;
  if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== 'function') return true;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

function updateBiometricUi() {
  const enabled = hasBiometricConfig();
  els.bioUnlockBtn.classList.toggle('hidden', !enabled);
  els.bioDivider.classList.toggle('hidden', !enabled);
  els.biometricMenuBtn.textContent = enabled ? 'Fingerabdruck deaktivieren' : 'Fingerabdruck aktivieren';
}

function configureLockScreen() {
  const firstRun = !hasVaultConfig();
  els.pinInput.value = '';
  els.pinConfirm.value = '';
  els.pinConfirm.classList.toggle('hidden', !firstRun);
  els.pinConfirm.required = firstRun;
  els.pinLabel.textContent = firstRun ? 'Neue PIN festlegen' : 'PIN';
  els.pinSubmit.textContent = firstRun ? 'Reci mi einrichten' : 'Mit PIN entsperren';
  updateBiometricUi();
  const biometric = !firstRun && hasBiometricConfig();
  els.lockSubtitle.textContent = firstRun
    ? 'Richte deine private App einmalig ein.'
    : (biometric ? 'Entsperre Reci mi mit deinem Fingerabdruck.' : 'Deine Gedanken bleiben bei dir.');
  els.lockHint.textContent = firstRun
    ? 'Wichtig: Die PIN bleibt dein Notfallzugang. Wenn du sie vergisst, können die verschlüsselten Notizen nicht wiederhergestellt werden.'
    : (biometric ? 'Die PIN bleibt als Notfallzugang verfügbar.' : 'Die PIN wird nicht als Klartext gespeichert.');
  if (!biometric) setTimeout(() => els.pinInput.focus(), 80);
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
  state.settings = { ...(state.settings || {}), lockMode: 'when-backgrounded-with-grace' };
  delete state.settings.autoLockMinutes;
}

async function unlockVault(pin) {
  const salt = base64ToBytes(localStorage.getItem(CONFIG_SALT));
  const key = await deriveKey(pin, salt);
  try {
    await loadVaultWithKey(key);
  } catch {
    throw new Error('Falsche PIN');
  }
}

async function importBiometricPublicKey(cfg) {
  const spki = base64ToBytes(cfg.publicKey);
  if (cfg.alg === -7) {
    return crypto.subtle.importKey(
      'spki',
      spki,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
  }
  if (cfg.alg === -257) {
    return crypto.subtle.importKey(
      'spki',
      spki,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
  }
  throw new Error('Dieses Fingerabdruck-Verfahren wird nicht unterstützt');
}

async function verifyBiometricAssertion(assertion, cfg, challenge) {
  const expectedId = base64ToBytes(cfg.credentialId);
  const actualId = new Uint8Array(assertion.rawId);
  if (!sameBytes(expectedId, actualId)) throw new Error('Fingerabdruck konnte nicht bestätigt werden');

  const clientDataBytes = new Uint8Array(assertion.response.clientDataJSON);
  const clientData = JSON.parse(new TextDecoder().decode(clientDataBytes));
  if (clientData.type !== 'webauthn.get') throw new Error('Fingerabdruck konnte nicht bestätigt werden');
  if (clientData.challenge !== bytesToBase64Url(challenge)) throw new Error('Fingerabdruck konnte nicht bestätigt werden');
  if (clientData.origin !== location.origin) throw new Error('Fingerabdruck konnte nicht bestätigt werden');

  const clientHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataBytes));
  const authData = new Uint8Array(assertion.response.authenticatorData);
  const signedData = concatBytes(authData, clientHash);
  const publicKey = await importBiometricPublicKey(cfg);

  let signature = new Uint8Array(assertion.response.signature);
  let valid = false;
  if (cfg.alg === -7) {
    try {
      valid = await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        publicKey,
        derEcdsaToRaw(signature, 32),
        signedData
      );
    } catch {
      valid = false;
    }
    if (!valid) {
      try {
        valid = await crypto.subtle.verify(
          { name: 'ECDSA', hash: 'SHA-256' },
          publicKey,
          signature,
          signedData
        );
      } catch {
        valid = false;
      }
    }
  } else {
    valid = await crypto.subtle.verify(
      { name: 'RSASSA-PKCS1-v1_5' },
      publicKey,
      signature,
      signedData
    );
  }
  if (!valid) throw new Error('Fingerabdruck konnte nicht bestätigt werden');
}

async function enableBiometrics() {
  if (!cryptoKey || !state) {
    showToast('Bitte zuerst mit deiner PIN entsperren');
    return;
  }
  if (!(await platformBiometricsAvailable())) {
    showToast('Fingerabdruck wird von diesem Browser nicht unterstützt', 4200);
    return;
  }

  biometricBusy = true;
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const userId = crypto.getRandomValues(new Uint8Array(16));
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: 'Reci mi', id: location.hostname },
        user: {
          id: userId,
          name: 'reci-mi-local',
          displayName: 'Reci mi'
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 }
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          residentKey: 'discouraged',
          userVerification: 'required'
        },
        timeout: 60000,
        attestation: 'none'
      }
    });

    const publicKey = credential.response.getPublicKey?.();
    const alg = credential.response.getPublicKeyAlgorithm?.();
    if (!publicKey || ![-7, -257].includes(alg)) {
      throw new Error('Dieser Browser kann den Fingerabdruck nicht sicher speichern');
    }

    await idbSet(BIOMETRIC_KEY, cryptoKey);
    localStorage.setItem(BIOMETRIC_CONFIG, JSON.stringify({
      credentialId: bytesToBase64(new Uint8Array(credential.rawId)),
      publicKey: bytesToBase64(new Uint8Array(publicKey)),
      alg,
      createdAt: new Date().toISOString()
    }));
    updateBiometricUi();
    closeMenu();
    showToast('Fingerabdruck ist aktiviert');
  } catch (err) {
    if (err?.name !== 'NotAllowedError') {
      showToast(err?.message || 'Fingerabdruck konnte nicht eingerichtet werden', 4500);
    }
  } finally {
    biometricBusy = false;
  }
}

async function disableBiometrics() {
  const yes = await askConfirm(
    'Fingerabdruck deaktivieren?',
    'Danach entsperrst du Reci mi wieder mit deiner PIN.',
    'Deaktivieren'
  );
  if (!yes) return;
  localStorage.removeItem(BIOMETRIC_CONFIG);
  await idbDelete(BIOMETRIC_KEY).catch(() => {});
  updateBiometricUi();
  closeMenu();
  showToast('Fingerabdruck deaktiviert');
}

async function unlockWithBiometrics() {
  const cfg = getBiometricConfig();
  if (!cfg) return;
  if (!(await platformBiometricsAvailable())) {
    showToast('Fingerabdruck ist in diesem Browser nicht verfügbar', 4200);
    return;
  }

  biometricBusy = true;
  els.bioUnlockBtn.disabled = true;
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        rpId: location.hostname,
        allowCredentials: [{
          type: 'public-key',
          id: base64ToBytes(cfg.credentialId),
          transports: ['internal']
        }],
        userVerification: 'required',
        timeout: 60000
      }
    });

    await verifyBiometricAssertion(assertion, cfg, challenge);
    const storedKey = await idbGet(BIOMETRIC_KEY);
    if (!storedKey) throw new Error('Fingerabdruck-Zugang muss neu eingerichtet werden');
    await loadVaultWithKey(storedKey);
    await restoreAfterUnlock();
  } catch (err) {
    if (err?.name !== 'NotAllowedError') {
      els.lockHint.textContent = err?.message || 'Fingerabdruck konnte nicht verwendet werden. Nutze deine PIN.';
    }
  } finally {
    els.bioUnlockBtn.disabled = false;
    biometricBusy = false;
  }
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
}

function captureResumeContext() {
  if (els.editorScreen.classList.contains('active')) {
    resumeScreen = 'editor';
    resumeTopicId = currentTopicId;
  } else if (els.trashScreen.classList.contains('active')) {
    resumeScreen = 'trash';
    resumeTopicId = null;
  } else {
    resumeScreen = 'home';
    resumeTopicId = null;
  }
}

async function restoreAfterUnlock() {
  renderTopics();
  if (resumeScreen === 'editor' && resumeTopicId) {
    const exists = state?.topics?.some(t => t.id === resumeTopicId && !t.deletedAt);
    if (exists) {
      openTopic(resumeTopicId);
    } else {
      showScreen(els.homeScreen);
    }
  } else if (resumeScreen === 'trash') {
    renderTrash();
    showScreen(els.trashScreen);
  } else {
    showScreen(els.homeScreen);
  }
  resumeScreen = 'home';
  resumeTopicId = null;
  lastExitBackAt = 0;
  ensureBackGuard();
}

function lockApp(message = '', preserveResume = true) {
  stopRecognition();
  stopReading();
  clearTimeout(saveTimer);
  if (preserveResume) captureResumeContext();
  else { resumeScreen = 'home'; resumeTopicId = null; }
  if (cryptoKey && state) persistState(true).catch(() => {});
  cryptoKey = null;
  state = null;
  currentTopicId = null;
  els.sideMenu.classList.remove('open');
  showScreen(els.lockScreen);
  configureLockScreen();
  if (message) els.lockHint.textContent = message;
}

function scheduleBackgroundLock() {
  clearTimeout(backgroundLockTimer);
  if (suppressBackgroundLock || biometricBusy || !cryptoKey) return;
  backgroundLockTimer = setTimeout(() => {
    if (document.hidden && !suppressBackgroundLock && !biometricBusy && cryptoKey) {
      lockApp('Reci mi wurde beim Verlassen gesperrt.');
    }
  }, BACKGROUND_LOCK_DELAY_MS);
}

function cancelBackgroundLock() {
  clearTimeout(backgroundLockTimer);
  backgroundLockTimer = null;
}

function ensureBackGuard() {
  if (!cryptoKey || backGuardReady || exitingByBack) return;
  try {
    history.pushState({ reciMiGuard: true }, '', APP_HISTORY_URL);
    backGuardReady = true;
  } catch {}
}

async function handleAppBackNavigation() {
  backGuardReady = false;
  if (!cryptoKey || exitingByBack) return;

  if (els.sideMenu.classList.contains('open')) {
    closeMenu();
    ensureBackGuard();
    return;
  }
  if (els.topicActionDialog?.open) {
    els.topicActionDialog.close();
    topicActionId = null;
    ensureBackGuard();
    return;
  }
  if (els.topicDialog?.open) {
    els.topicDialog.close();
    ensureBackGuard();
    return;
  }
  if (els.confirmDialog?.open) {
    els.confirmDialog.close();
    if (confirmResolver) confirmResolver(false);
    confirmResolver = null;
    ensureBackGuard();
    return;
  }

  if (els.editorScreen.classList.contains('active')) {
    stopRecognition();
    stopReading();
    await persistState(true).catch(() => {});
    currentTopicId = null;
    renderTopics();
    showScreen(els.homeScreen);
    lastExitBackAt = 0;
    ensureBackGuard();
    return;
  }

  if (els.trashScreen.classList.contains('active')) {
    renderTopics();
    showScreen(els.homeScreen);
    lastExitBackAt = 0;
    ensureBackGuard();
    return;
  }

  const now = Date.now();
  if (now - lastExitBackAt < EXIT_BACK_WINDOW_MS) {
    exitingByBack = true;
    await persistState(true).catch(() => {});
    lockApp('', false);
    history.back();
    setTimeout(() => { exitingByBack = false; }, 1200);
    return;
  }

  lastExitBackAt = now;
  ensureBackGuard();
  showToast('Noch einmal Zurück, um Reci mi zu verlassen', 1800);
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
    let pressTimer = null;
    let startX = 0;
    let startY = 0;
    let suppressClick = false;

    const cancelPress = () => {
      clearTimeout(pressTimer);
      pressTimer = null;
      card.classList.remove('pressing');
    };

    card.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      startX = e.clientX;
      startY = e.clientY;
      card.classList.add('pressing');
      pressTimer = setTimeout(() => {
        suppressClick = true;
        card.classList.remove('pressing');
        if (navigator.vibrate) navigator.vibrate(25);
        openTopicAction(card.dataset.id);
      }, LONG_PRESS_MS);
    });
    card.addEventListener('pointermove', e => {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > 12) cancelPress();
    });
    card.addEventListener('pointerup', cancelPress);
    card.addEventListener('pointercancel', cancelPress);
    card.addEventListener('pointerleave', cancelPress);
    card.addEventListener('contextmenu', e => e.preventDefault());
    card.addEventListener('click', e => {
      if (suppressClick) {
        suppressClick = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      open();
    });
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

function openTopicAction(id) {
  const topic = state?.topics?.find(t => t.id === id && !t.deletedAt);
  if (!topic) return;
  topicActionId = id;
  els.topicActionTitle.textContent = topic.title;
  els.topicActionDialog.showModal();
}

async function moveTopicToTrash(id) {
  const topic = state?.topics?.find(t => t.id === id && !t.deletedAt);
  if (!topic) return;
  topic.deletedAt = new Date().toISOString();
  topic.updatedAt = new Date().toISOString();
  await persistState(true);
  if (currentTopicId === id) currentTopicId = null;
  renderTopics();
  showScreen(els.homeScreen);
  showToast('In den Papierkorb verschoben');
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
  await moveTopicToTrash(topic.id);
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

function showToast(message, duration = 1800) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove('show'), duration);
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

function openKeyboardDictationFallback() {
  toggleEdit(true);
  const end = els.topicText.value.length;
  els.topicText.focus({ preventScroll: false });
  try { els.topicText.setSelectionRange(end, end); } catch {}
  showToast('Direkte Spracheingabe wird in diesem Browser nicht unterstützt. Die Tastatur ist geöffnet: Tippe dort auf das Mikrofon.', 5200);
}

function toggleRecognition() {
  const Ctor = speechRecognitionCtor();
  if (!Ctor) {
    openKeyboardDictationFallback();
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
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      showToast('Mikrofonzugriff wurde nicht erlaubt. Prüfe die Browser-Berechtigung.', 4200);
    } else if (event.error === 'network' || event.error === 'language-not-supported') {
      openKeyboardDictationFallback();
    } else if (event.error !== 'aborted' && event.error !== 'no-speech') {
      showToast('Direkte Spracheingabe ist hier nicht verfügbar. Nutze das Mikrofon der Tastatur.', 4200);
    }
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
  localStorage.removeItem(BIOMETRIC_CONFIG);
  await idbDelete(BIOMETRIC_KEY).catch(() => {});
  await idbSet(VAULT_KEY, parsed.vault);
  updateBiometricUi();
  closeMenu();
  lockApp('Sicherung importiert. Bitte einmal mit der PIN dieser Sicherung entsperren.', false);
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
      await restoreAfterUnlock();
    } catch (err) {
      els.lockHint.textContent = err.message === 'Falsche PIN' ? 'Die PIN ist nicht richtig.' : (err.message || 'Entsperren nicht möglich.');
      cryptoKey = null;
      state = null;
    } finally {
      els.pinSubmit.disabled = false;
    }
  });

  els.bioUnlockBtn.addEventListener('click', unlockWithBiometrics);

  [els.newTopicBtn, els.quickAddBtn, els.emptyAddBtn].forEach(btn => btn.addEventListener('click', () => openTopicDialog('create')));
  els.cancelTopicBtn.addEventListener('click', () => els.topicDialog.close());
  els.topicForm.addEventListener('submit', e => { e.preventDefault(); saveTopicDialog(); });
  els.topicActionCancelBtn.addEventListener('click', () => {
    topicActionId = null;
    els.topicActionDialog.close();
  });
  els.topicActionDeleteBtn.addEventListener('click', async () => {
    const id = topicActionId;
    topicActionId = null;
    els.topicActionDialog.close();
    if (id) await moveTopicToTrash(id);
  });
  els.topicActionDialog.addEventListener('cancel', () => { topicActionId = null; });

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
  els.importInput.addEventListener('click', () => {
    suppressBackgroundLock = true;
    setTimeout(() => { suppressBackgroundLock = false; }, 120000);
  });
  els.importInput.addEventListener('change', e => {
    suppressBackgroundLock = false;
    const file = e.target.files?.[0];
    if (file) importBackup(file);
    e.target.value = '';
  });
  els.biometricMenuBtn.addEventListener('click', () => {
    if (hasBiometricConfig()) disableBiometrics();
    else enableBiometrics();
  });
  els.lockBtn.addEventListener('click', () => lockApp('Reci mi ist gesperrt.'));

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

  window.addEventListener('popstate', handleAppBackNavigation);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopReading();
      persistState(true).catch(() => {});
      scheduleBackgroundLock();
    } else {
      cancelBackgroundLock();
    }
  });
  window.addEventListener('focus', () => {
    if (suppressBackgroundLock) {
      setTimeout(() => { suppressBackgroundLock = false; }, 500);
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
  updateBiometricUi();
  configureLockScreen();
  wireEvents();
  registerServiceWorker();
}

boot().catch(() => {
  els.lockHint.textContent = 'Reci mi konnte nicht gestartet werden.';
});
