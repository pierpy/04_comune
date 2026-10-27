// Impostazioni salvate in chrome.storage.local: restano sul computer dell'utente.

import { DEFAULT_OPTIONS } from './matcher.js';

// Etichette (regex, senza distinzione maiuscole) con cui il riempitore cerca i campi del modulo InTime.
// Se l'ateneo usa etichette diverse si cambiano dalla pagina Opzioni, oppure si indica un selettore CSS.
export const DEFAULT_FIELDS = {
  date: { label: '^data( (della )?lezione| attivit.)?\\b|^giorno', selector: '' },
  start: { label: 'ora (di )?inizio|^inizio|\\bdalle\\b', selector: '' },
  end: { label: 'ora (di )?fine|^fine|\\balle\\b', selector: '' },
  type: { label: 'tipo( di)?( attivit.)?|tipologia', selector: '' },
  course: { label: 'titolo|insegnamento', selector: '' },
  topic: { label: 'argoment|contenut|descrizione|programma svolto', selector: '' },
};

export const DEFAULT_SETTINGS = {
  icsUrls: [],            // { label, url } indirizzi segreti iCal (nessuna configurazione Google necessaria)
  calendars: [],          // id dei calendari Google letti via API (richiede un client OAuth)
  upSources: [],          // { id, kind: 'captured'|'link', label, url, body, host, linkCalendarioId, clienteId }
  match: { ...DEFAULT_OPTIONS },
  fields: DEFAULT_FIELDS,
  addButton: 'aggiungi|nuova lezione|nuova attivit|inserisci',  // pulsante che apre il modulo (facoltativo)
  saveButton: '^\\s*(salva|conferma)',                          // riconosciuto solo per segnare la riga come fatta
};

export async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    match: { ...DEFAULT_SETTINGS.match, ...(settings?.match || {}) },
    fields: { ...DEFAULT_FIELDS, ...(settings?.fields || {}) },
  };
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ settings });
}
