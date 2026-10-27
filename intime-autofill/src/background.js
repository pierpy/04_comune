// Service worker: raccoglie i dati da Google Calendar e University Planner,
// costruisce la coda di lezioni e la passa al riempitore della pagina InTime.

import { buildRows, normalizeGcal, normalizeUp } from './lib/matcher.js';
import { listCalendars, listEvents } from './lib/gcal.js';
import { fetchUpImpegni } from './lib/up.js';
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

async function addCapturedSource({ url, body, pageUrl, title }) {
  const settings = await loadSettings();
  // Una stessa pagina catturata più volte (cambio settimana) aggiorna la sorgente esistente.
  const { dataInizio, dataFine, ...template } = body || {};
  const label = title || pageUrl;
  const existing = settings.upSources.find((s) => s.kind === 'captured' && s.pageUrl === pageUrl);
  if (existing) Object.assign(existing, { url, body: template, label });
  else settings.upSources.push({ id: crypto.randomUUID(), kind: 'captured', url, body: template, pageUrl, label });
  await saveSettings(settings);
  return { isNew: !existing };
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
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = handlers[msg?.type];
  if (!handler) return false;
  Promise.resolve(handler(msg))
    .then((data) => sendResponse({ ok: true, data }))
    .catch((e) => sendResponse({ ok: false, error: e.message }));
  return true; // risposta asincrona
});
