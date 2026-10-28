// Service worker: raccoglie i dati da Google Calendar e University Planner,
// costruisce la coda di lezioni e la passa al riempitore della pagina InTime.

import { buildRows, normalizeGcal, normalizeUp } from './lib/matcher.js';
import { listCalendars, listEvents } from './lib/gcal.js';
import { fetchUpImpegni, requestSignature } from './lib/up.js';
import { fetchIcsEvents } from './lib/ics.js';
import { loadSettings, saveSettings } from './lib/settings.js';

async function buildQueue({ from, to }) {
  const settings = await loadSettings();
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T23:59:59`);
  const errors = [];

  const ups = [];
  for (const src of settings.upSources) {
    try {
      (await fetchUpImpegni(src, start, end)).forEach((raw) => ups.push(normalizeUp(raw)));
    } catch (e) {
      errors.push(`${src.label}: ${e.message}`);
    }
  }
  // fetchUpImpegni risolve e memorizza nella sorgente il clienteId al primo uso
  if (settings.upSources.some((s) => s.kind === 'link')) await saveSettings(settings);

  const gcs = [];
  for (const ics of settings.icsUrls) {
    try {
      (await fetchIcsEvents(ics.url, start, end)).forEach((it) => gcs.push(normalizeGcal(it, ics.label)));
    } catch (e) {
      errors.push(`${ics.label}: ${e.message}`);
    }
  }
  for (const calId of settings.calendars) {
    try {
      (await listEvents(calId, start, end)).forEach((it) => gcs.push(normalizeGcal(it, calId)));
    } catch (e) {
      errors.push(`Google Calendar: ${e.message}`);
    }
  }

  const { queue: old = [] } = await chrome.storage.local.get('queue');
  const doneKeys = new Set(old.filter((r) => r.done).map((r) => r.key));
  const rows = buildRows(ups, gcs, settings.match).map((r) => ({ ...r, done: doneKeys.has(r.key) }));
  await chrome.storage.local.set({ queue: rows, period: { from, to } });
  return { rows, errors, counts: { up: ups.length, gcal: gcs.filter(Boolean).length } };
}

// Le chiamate arrivano a raffica (una per settimana visualizzata): si serializzano
// per non leggere e riscrivere le impostazioni in parallelo.
let captureChain = Promise.resolve();

function addCapturedSource(call) {
  const run = captureChain.then(() => storeCapturedSource(call));
  captureChain = run.catch(() => {});
  return run;
}

async function storeCapturedSource({ url, method, body, responsePath, pageUrl, title }) {
  const settings = await loadSettings();
  // La stessa chiamata con date diverse (cambio settimana) aggiorna la sorgente esistente.
  const signature = requestSignature({ url, method, body });
  const label = title && !/^university planner$/i.test(title.trim()) ? `${title} (${pageUrl})` : pageUrl;
  const existing = settings.upSources.find((s) => s.kind === 'captured' && (s.signature === signature || s.pageUrl === pageUrl));
  const data = { url, method, body, responsePath, pageUrl, label, signature };
  if (existing) Object.assign(existing, data);
  else settings.upSources.push({ id: crypto.randomUUID(), kind: 'captured', ...data });
  await saveSettings(settings);
  return { isNew: !existing };
}

async function rememberSeen(call) {
  const { upSeen = [] } = await chrome.storage.local.get('upSeen');
  upSeen.unshift(call);
  await chrome.storage.local.set({ upSeen: upSeen.slice(0, 30) });
}

async function markRow(key, patch) {
  const { queue = [] } = await chrome.storage.local.get('queue');
  const row = queue.find((r) => r.key === key);
  if (row) Object.assign(row, patch);
  await chrome.storage.local.set({ queue });
}

const handlers = {
  'gcal:calendars': () => listCalendars(),
  'queue:build': (msg) => buildQueue(msg),
  'queue:mark': (msg) => markRow(msg.key, msg.patch),
  'up:captured': (msg) => addCapturedSource(msg),
  'up:seen': (msg) => rememberSeen(msg.call),
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = handlers[msg?.type];
  if (!handler) return false;
  Promise.resolve(handler(msg))
    .then((data) => sendResponse({ ok: true, data }))
    .catch((e) => sendResponse({ ok: false, error: e.message }));
  return true; // risposta asincrona
});
