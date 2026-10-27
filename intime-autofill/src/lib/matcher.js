// Incrocio tra gli impegni di University Planner (UP) e gli eventi di Google Calendar.
// Modulo puro (nessuna API del browser): è usato dal service worker e dai test Node.

export const TIME_ZONE = 'Europe/Rome';

// Codici di stato degli impegni UP (ricavati dal client Angular di UP, non documentati da Cineca).
const UP_STATUS = { P: 'ok', C: 'ok', B: 'ok', E: 'ok', R: 'ok', A: 'cancelled', S: 'suspended' };

export const DEFAULT_OPTIONS = {
  minOverlapRatio: 0.5,     // sovrapposizione minima, in frazione dell'evento più corto
  timeToleranceMin: 5,      // differenza di orario oltre la quale si segnala un'incongruenza
  timeSource: 'up',         // 'up' | 'gcal': quale orario usare quando entrambi esistono
  topicFrom: 'auto',        // 'auto' | 'description' | 'title'
  includeUpOnly: true,      // lezioni presenti solo in UP: proposte e già selezionate
  includeGcalOnly: true,    // eventi presenti solo in Google: proposti ma non selezionati
  gcalKeyword: '',          // se valorizzato, gli eventi solo-Google devono contenerlo nel titolo
  typeMap: {},              // { 'Lezione': 'Lezione frontale', ... } tipo UP -> tipo InTime
  defaultType: 'Lezione',
};

export function normalizeUp(raw) {
  const tipo = raw.tipoAttivita?.descrizione || '';
  return {
    id: `up:${raw.id ?? raw.eventoId ?? raw.dataInizio}`,
    start: new Date(raw.dataInizio).toISOString(),
    end: new Date(raw.dataFine).toISOString(),
    title: (raw.nome || '').trim(),
    code: raw.codiceAttivita || '',
    type: tipo,
    rooms: (raw.aule || []).map((a) => a?.descrizione).filter(Boolean),
    teachers: (raw.docenti || []).map((d) => [d?.nome, d?.cognome].filter(Boolean).join(' ')).filter(Boolean),
    status: UP_STATUS[raw.stato] || 'ok',
    online: Boolean(raw.teledidattica || raw.evento?.online),
    notes: raw.notePubbliche || '',
  };
}

export function normalizeGcal(item, calendarId = '') {
  // Gli eventi "tutto il giorno" hanno start.date invece di start.dateTime: non sono lezioni.
  if (!item?.start?.dateTime || !item?.end?.dateTime || item.status === 'cancelled') return null;
  return {
    id: `gcal:${calendarId}:${item.id}`,
    start: new Date(item.start.dateTime).toISOString(),
    end: new Date(item.end.dateTime).toISOString(),
    title: (item.summary || '').trim(),
    description: item.description || '',
    location: item.location || '',
    calendarId,
  };
}

export function overlapMinutes(a, b) {
  const s = Math.max(Date.parse(a.start), Date.parse(b.start));
  const e = Math.min(Date.parse(a.end), Date.parse(b.end));
  return Math.max(0, (e - s) / 60000);
}

const durationMin = (ev) => (Date.parse(ev.end) - Date.parse(ev.start)) / 60000;

const STOPWORDS = new Set(['di', 'del', 'della', 'dei', 'delle', 'e', 'ed', 'a', 'al', 'alla', 'in', 'per', 'con', 'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'una', 'lezione', 'corso']);

export function tokens(text) {
  return new Set(
    (text || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1 && !STOPWORDS.has(t) && !/^\d+$/.test(t)),
  );
}

export function titleSimilarity(a, b) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

export function stripHtml(text) {
  return (text || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
}

export function topicFor(gcal, up, mode = 'auto') {
  if (!gcal) return '';
  const desc = stripHtml(gcal.description);
  if (mode === 'description') return desc;
  if (mode === 'title') return gcal.title;
  if (desc) return desc;
  // Se il titolo Google è solo il nome del corso non è un argomento.
  return up && titleSimilarity(gcal.title, up.title) >= 0.5 ? '' : gcal.title;
}

export function localParts(iso, timeZone = TIME_ZONE) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('it-IT', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(iso)).map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.day}/${parts.month}/${parts.year}`,
    isoDate: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

function makeRow({ up, gcal, opts, warnings, selected }) {
  const timing = opts.timeSource === 'gcal' && gcal ? gcal : (up || gcal);
  const s = localParts(timing.start);
  const e = localParts(timing.end);
  const upType = up?.type || '';
  return {
    key: [up?.id, gcal?.id].filter(Boolean).join('|'),
    source: up && gcal ? 'both' : up ? 'up' : 'gcal',
    selected,
    done: false,
    date: s.date,
    isoDate: s.isoDate,
    start: s.time,
    end: e.time,
    hours: Math.round((durationMin(timing) / 60) * 100) / 100,
    course: up?.title || gcal?.title || '',
    type: opts.typeMap[upType] || upType || opts.defaultType,
    topic: topicFor(gcal, up, opts.topicFrom),
    rooms: up?.rooms?.join(', ') || gcal?.location || '',
    online: Boolean(up?.online),
    warnings,
    startIso: timing.start,
  };
}

/**
 * Accoppia uno-a-uno gli impegni UP con gli eventi Google che si sovrappongono nel tempo
 * e restituisce le righe da proporre per il registro, ordinate per data.
 */
export function buildRows(upEvents, gcalEvents, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options, typeMap: { ...DEFAULT_OPTIONS.typeMap, ...(options.typeMap || {}) } };
  const ups = upEvents.filter(Boolean);
  const gcs = gcalEvents.filter(Boolean);

  const pairs = [];
  ups.forEach((up, i) => {
    gcs.forEach((gc, j) => {
      const ov = overlapMinutes(up, gc);
      const ratio = ov / Math.max(1, Math.min(durationMin(up), durationMin(gc)));
      if (ratio >= opts.minOverlapRatio) pairs.push({ i, j, score: ratio + 0.5 * titleSimilarity(up.title, gc.title) });
    });
  });
  pairs.sort((a, b) => b.score - a.score);

  const upMatch = new Map();
  const usedG = new Set();
  for (const p of pairs) {
    if (upMatch.has(p.i) || usedG.has(p.j)) continue;
    upMatch.set(p.i, p.j);
    usedG.add(p.j);
  }

  const rows = [];
  ups.forEach((up, i) => {
    const gcal = upMatch.has(i) ? gcs[upMatch.get(i)] : null;
    const warnings = [];
    if (up.status !== 'ok') {
      // Lezione annullata/sospesa in UP: non va a registro, ma se Google la riporta lo segnaliamo.
      if (gcal) rows.push(makeRow({ up, gcal, opts, warnings: [`Lezione ${up.status === 'cancelled' ? 'annullata' : 'sospesa'} in UP ma presente in Google Calendar`], selected: false }));
      return;
    }
    if (gcal) {
      const diff = Math.max(Math.abs(Date.parse(up.start) - Date.parse(gcal.start)), Math.abs(Date.parse(up.end) - Date.parse(gcal.end))) / 60000;
      if (diff > opts.timeToleranceMin) warnings.push(`Orario diverso tra UP e Google (${Math.round(diff)} min)`);
    } else {
      warnings.push('Non presente in Google Calendar');
    }
    rows.push(makeRow({ up, gcal, opts, warnings, selected: gcal ? true : opts.includeUpOnly }));
  });

  if (opts.includeGcalOnly) {
    const kw = opts.gcalKeyword.trim().toLowerCase();
    gcs.forEach((gcal, j) => {
      if (usedG.has(j)) return;
      if (kw && !gcal.title.toLowerCase().includes(kw)) return;
      rows.push(makeRow({ up: null, gcal, opts, warnings: ['Non presente in University Planner'], selected: false }));
    });
  }

  rows.sort((a, b) => a.startIso.localeCompare(b.startIso));
  return rows;
}
