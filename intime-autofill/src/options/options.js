import { loadSettings, saveSettings } from '../lib/settings.js';

const $ = (id) => document.getElementById(id);
const FIELD_NAMES = { date: 'Data', start: 'Ora inizio', end: 'Ora fine', type: 'Tipo attività', course: 'Titolo / insegnamento', topic: 'Argomento' };
let settings;

function renderCalendars(list) {
  const ul = $('calendars');
  ul.replaceChildren();
  for (const cal of list) {
    const li = document.createElement('li');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = cal.id;
    cb.checked = settings.calendars.includes(cal.id);
    const label = document.createElement('label');
    label.append(cb, ` ${cal.name}${cal.primary ? ' (principale)' : ''}`);
    li.append(label);
    ul.append(li);
  }
}

function renderUpSources() {
  const ul = $('upSources');
  ul.replaceChildren();
  if (!settings.upSources.length) ul.innerHTML = '<li class="hint">Nessun calendario collegato.</li>';
  settings.upSources.forEach((src, i) => {
    const li = document.createElement('li');
    const del = document.createElement('button');
    del.textContent = 'Rimuovi';
    del.addEventListener('click', () => { settings.upSources.splice(i, 1); renderUpSources(); });
    li.append(`${src.label} `, del);
    ul.append(li);
  });
}

function renderFields() {
  const box = $('fields');
  box.replaceChildren();
  for (const [key, name] of Object.entries(FIELD_NAMES)) {
    const spec = settings.fields[key];
    const label = document.createElement('label');
    label.textContent = name;
    const re = Object.assign(document.createElement('input'), { value: spec.label, placeholder: 'regex etichetta' });
    const sel = Object.assign(document.createElement('input'), { value: spec.selector, placeholder: 'selettore CSS (facoltativo)' });
    re.dataset.field = key; re.dataset.prop = 'label';
    sel.dataset.field = key; sel.dataset.prop = 'selector';
    box.append(label, re, sel);
  }
}

async function init() {
  settings = await loadSettings();
  if (settings.calendars.length) renderCalendars(settings.calendars.map((id) => ({ id, name: id })));
  renderUpSources();
  renderFields();
  $('timeSource').value = settings.match.timeSource;
  $('topicFrom').value = settings.match.topicFrom;
  $('gcalKeyword').value = settings.match.gcalKeyword;
  $('typeMap').value = Object.entries(settings.match.typeMap).map(([k, v]) => `${k} = ${v}`).join('\n');
  $('addButton').value = settings.addButton;
  $('saveButton').value = settings.saveButton;
}

$('loadCalendars').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'gcal:calendars' }, (res) => {
    if (!res?.ok) { $('status').textContent = res?.error || 'Errore'; $('status').className = 'status err'; return; }
    renderCalendars(res.data);
  });
});

$('save').addEventListener('click', async () => {
  settings.calendars = [...$('calendars').querySelectorAll('input:checked')].map((cb) => cb.value);
  settings.match.timeSource = $('timeSource').value;
  settings.match.topicFrom = $('topicFrom').value;
  settings.match.gcalKeyword = $('gcalKeyword').value.trim();
  settings.match.typeMap = Object.fromEntries(
    $('typeMap').value.split('\n').map((l) => l.split('=').map((s) => s.trim())).filter(([k, v]) => k && v),
  );
  for (const input of $('fields').querySelectorAll('input')) {
    settings.fields[input.dataset.field] = { ...settings.fields[input.dataset.field], [input.dataset.prop]: input.value.trim() };
  }
  settings.addButton = $('addButton').value.trim();
  settings.saveButton = $('saveButton').value.trim();
  await saveSettings(settings);
  $('status').textContent = 'Impostazioni salvate.';
  $('status').className = 'status ok';
});

// Un calendario UP catturato mentre questa pagina è aperta compare subito.
chrome.storage.onChanged.addListener(async (changes) => {
  if (!changes.settings) return;
  const fresh = await loadSettings();
  settings.upSources = fresh.upSources;
  renderUpSources();
});

init();
