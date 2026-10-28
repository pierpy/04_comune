import { loadSettings } from '../lib/settings.js';

const $ = (id) => document.getElementById(id);
const status = (text, kind = '') => { $('status').textContent = text; $('status').className = `status ${kind}`; };
const send = (msg) => new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));

let queue = [];

function isoDay(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function init() {
  const { queue: q = [], period } = await chrome.storage.local.get(['queue', 'period']);
  const now = new Date();
  $('from').value = period?.from || isoDay(new Date(now.getFullYear(), now.getMonth(), 1));
  $('to').value = period?.to || isoDay(now);
  queue = q;
  render();
  const s = await loadSettings();
  if (!s.upSources.length && !s.calendars.length && !s.icsUrls.length) status('Configura prima le sorgenti in Impostazioni.', 'warn');
}

function render() {
  const tbody = $('rows').querySelector('tbody');
  tbody.replaceChildren();
  for (const row of queue) {
    const tr = document.createElement('tr');
    tr.className = row.done ? 'done' : row.warnings.length ? 'warn' : '';
    tr.title = row.warnings.join('\n');

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = row.selected;
    cb.disabled = row.done;
    cb.addEventListener('change', () => { row.selected = cb.checked; persist(); });

    const topic = document.createElement('textarea');
    topic.value = row.topic;
    topic.rows = 2;
    topic.placeholder = 'Argomento della lezione';
    topic.addEventListener('change', () => { row.topic = topic.value; persist(); });

    const cells = [
      cb,
      `${row.date}`,
      `${row.start}–${row.end}`,
      `${row.course}\n${row.type}${row.done ? ' · registrata' : ''}${row.warnings.length ? ` · ⚠ ${row.warnings.join('; ')}` : ''}`,
      topic,
    ];
    for (const c of cells) {
      const td = document.createElement('td');
      if (typeof c === 'string') td.textContent = c; else td.append(c);
      tr.append(td);
    }
    tbody.append(tr);
  }
  $('rows').hidden = !queue.length;
  const pending = queue.filter((r) => r.selected && !r.done).length;
  $('fill').disabled = !pending;
  $('fill').textContent = pending ? `Compila la prossima in InTime (${pending} da fare)` : 'Nessuna lezione da compilare';
}

function persist() {
  chrome.storage.local.set({ queue });
  render();
}

$('load').addEventListener('click', async () => {
  status('Lettura di Google Calendar e University Planner…');
  $('load').disabled = true;
  const res = await send({ type: 'queue:build', from: $('from').value, to: $('to').value });
  $('load').disabled = false;
  if (!res?.ok) return status(res?.error || 'Errore', 'err');
  queue = res.data.rows;
  render();
  const { up, gcal } = res.data.counts;
  const msg = `${queue.length} lezioni proposte (${up} impegni UP, ${gcal} eventi Google).`;
  status(res.data.errors.length ? `${msg} Problemi: ${res.data.errors.join(' — ')}` : msg, res.data.errors.length ? 'warn' : 'ok');
});

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function inject(tab) {
  await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['src/content/intime-fill.js'] });
}

// Esegue func in tutti i frame della scheda (o in quelli indicati) e restituisce [{ frameId, result }].
function runInFrames(tab, func, args = [], frameIds) {
  const target = frameIds ? { tabId: tab.id, frameIds } : { tabId: tab.id, allFrames: true };
  return chrome.scripting.executeScript({ target, func, args });
}

async function bestFrame(tab, fillSettings) {
  const probes = await runInFrames(tab, (s) => window.__intimeAutofill?.probe(s), [fillSettings]);
  return probes.filter((p) => p.result).sort((a, b) => b.result.matched - a.result.matched)[0];
}

$('fill').addEventListener('click', async () => {
  const row = queue.find((r) => r.selected && !r.done);
  if (!row) return;
  const tab = await activeTab();
  try {
    await inject(tab);
    const settings = await loadSettings();
    const fillSettings = { fields: settings.fields, addButton: settings.addButton, saveButton: settings.saveButton };
    let best = await bestFrame(tab, fillSettings);
    if (!best?.result.matched) {
      // Modulo non aperto: si prova il pulsante "Aggiungi" nel frame che lo contiene.
      const probes = await runInFrames(tab, (s) => window.__intimeAutofill?.probe(s), [fillSettings]);
      const withAdd = probes.find((p) => p.result?.hasAdd);
      if (withAdd) {
        await runInFrames(tab, (s) => window.__intimeAutofill.openForm(s), [fillSettings], [withAdd.frameId]);
        best = await bestFrame(tab, fillSettings);
      }
    }
    const [{ result }] = await runInFrames(tab, (r, s) => window.__intimeAutofill.fill(r, s), [row, fillSettings], [best?.frameId ?? 0]);
    if (result.nothingFound) {
      return status('Nessun campo riconosciuto: apri il modulo di inserimento della lezione in InTime e riprova, oppure usa "Analizza modulo".', 'warn');
    }
    const missing = Object.entries(result.report).filter(([, v]) => v !== 'ok' && v !== 'vuoto');
    status(
      missing.length
        ? `Compilata con problemi (${missing.map(([k]) => k).join(', ')}): controlla nella pagina e premi Salva.`
        : `Compilata ${row.date} ${row.start}. Controlla e premi Salva nella pagina.`,
      missing.length ? 'warn' : 'ok',
    );
    if (!result.saveFound) status('Modulo compilato, ma il pulsante Salva non è stato riconosciuto: dopo aver salvato segna la riga a mano.', 'warn');
  } catch (e) {
    status(`Impossibile compilare questa pagina: ${e.message}. Apri il registro in InTime nella scheda attiva.`, 'err');
  }
});

$('analyze').addEventListener('click', async () => {
  const tab = await activeTab();
  try {
    await inject(tab);
    const frames = (await runInFrames(tab, () => window.__intimeAutofill?.analyze())).map((f) => f.result).filter(Boolean);
    await navigator.clipboard.writeText(JSON.stringify(frames, null, 2));
    const n = frames.reduce((acc, f) => acc + f.fields.length, 0);
    status(`Struttura copiata negli appunti: ${n} campi in ${frames.length} frame.`, n ? 'ok' : 'warn');
  } catch (e) {
    status(`Analisi non riuscita: ${e.message}`, 'err');
  }
});

$('openOptions').addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });

init();
