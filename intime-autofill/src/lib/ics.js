// Lettura di un calendario in formato iCalendar (RFC 5545), ad esempio l'"indirizzo segreto
// in formato iCal" di Google Calendar: nessun accesso OAuth, basta incollare il link.
// Il feed contiene le serie ricorrenti non espanse: qui si espandono RRULE, EXDATE e le
// singole occorrenze modificate (RECURRENCE-ID). Gli eventi escono nella stessa forma
// dell'API di Google Calendar, così normalizeGcal li tratta allo stesso modo.

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const MAX_OCCURRENCES = 5000;

function unfold(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function unescapeText(v) {
  return v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}

function parseLine(line) {
  // Primo ":" fuori dalle virgolette dei parametri (il valore può contenere altri ":").
  let colon = -1;
  for (let i = 0, quoted = false; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === ':' && !quoted) { colon = i; break; }
  }
  if (colon < 0) return null;
  const [name, ...params] = line.slice(0, colon).split(';');
  const p = {};
  for (const kv of params) {
    const i = kv.indexOf('=');
    if (i > 0) p[kv.slice(0, i).toUpperCase()] = kv.slice(i + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params: p, value: line.slice(colon + 1) };
}

// Scarto (ms) tra ora locale del fuso e UTC in un dato istante.
function tzOffset(utcMs, tz) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]),
  );
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - utcMs;
}

function validTz(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

// "Ora da parete" (codificata come se fosse UTC) -> istante reale UTC nel fuso tz.
function wallToUtc(wall, tz) {
  if (tz === 'UTC') return wall;
  const guess = wall - tzOffset(wall, tz);
  return wall - tzOffset(guess, tz);
}

// Una data-ora iCal diventa { wall, tz, allDay }: le ricorrenze si calcolano sull'ora da parete,
// così le lezioni delle 9:30 restano alle 9:30 anche dopo il cambio dell'ora legale.
function parseDate(value, params, defaultTz) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  if (!m[4]) return { wall, tz: defaultTz, allDay: true };
  const tz = m[7] ? 'UTC' : params.TZID && validTz(params.TZID) ? params.TZID : defaultTz;
  return { wall, tz, allDay: false };
}

function parseDuration(v) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return 0;
  const ms = (((+(m[2] || 0) * 7 + +(m[3] || 0)) * 24 + +(m[4] || 0)) * 60 + +(m[5] || 0)) * 60000 + +(m[6] || 0) * 1000;
  return m[1] === '-' ? -ms : ms;
}

export function parseIcs(text, defaultTz = 'Europe/Rome') {
  const events = [];
  let cur = null;
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') { cur = { exdates: [] }; continue; }
    if (line === 'END:VEVENT') { if (cur?.start) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const prop = parseLine(line);
    if (!prop) continue;
    const { name, params, value } = prop;
    if (name === 'UID') cur.uid = value;
    else if (name === 'SUMMARY') cur.summary = unescapeText(value);
    else if (name === 'DESCRIPTION') cur.description = unescapeText(value);
    else if (name === 'LOCATION') cur.location = unescapeText(value);
    else if (name === 'STATUS') cur.status = value.toUpperCase();
    else if (name === 'DTSTART') cur.start = parseDate(value, params, defaultTz);
    else if (name === 'DTEND') cur.end = parseDate(value, params, defaultTz);
    else if (name === 'DURATION') cur.duration = parseDuration(value);
    else if (name === 'RRULE') cur.rrule = Object.fromEntries(value.split(';').map((kv) => kv.split('=')).map(([k, v]) => [k.toUpperCase(), v]));
    else if (name === 'EXDATE') value.split(',').forEach((v) => { const d = parseDate(v, params, defaultTz); if (d) cur.exdates.push(wallToUtc(d.wall, d.tz)); });
    else if (name === 'RECURRENCE-ID') { const d = parseDate(value, params, defaultTz); if (d) cur.recurrenceId = wallToUtc(d.wall, d.tz); }
  }
  return events;
}

// Inizi (ora da parete) di una serie, secondo le parti di RRULE usate dai calendari delle lezioni:
// FREQ DAILY/WEEKLY/MONTHLY/YEARLY, INTERVAL, COUNT, UNTIL e BYDAY (solo settimanale).
function* recurrenceStarts(ev) {
  const r = ev.rrule;
  const interval = Math.max(1, +(r.INTERVAL || 1));
  const count = r.COUNT ? +r.COUNT : Infinity;
  let until = Infinity;
  if (r.UNTIL) {
    const u = parseDate(r.UNTIL, {}, ev.start.tz);
    until = u.allDay ? wallToUtc(u.wall + DAY_MS - 1, ev.start.tz) : wallToUtc(u.wall, u.tz);
  }
  const start = ev.start.wall;
  const timeOfDay = start % DAY_MS;
  let n = 0;
  const emit = (wall) => {
    if (wallToUtc(wall, ev.start.tz) > until) return false;
    n++;
    return true;
  };

  if (r.FREQ === 'WEEKLY') {
    const days = (r.BYDAY ? r.BYDAY.split(',').map((d) => WEEKDAYS.indexOf(d.slice(-2))) : [new Date(start).getUTCDay()]).filter((d) => d >= 0);
    // Settimane che iniziano di lunedì (WKST predefinito).
    const startDay = start - timeOfDay;
    const monday = startDay - ((new Date(startDay).getUTCDay() + 6) % 7) * DAY_MS;
    const offsets = days.map((d) => ((d + 6) % 7) * DAY_MS).sort((a, b) => a - b);
    for (let w = 0; n < count && n < MAX_OCCURRENCES; w += interval) {
      for (const off of offsets) {
        const wall = monday + w * 7 * DAY_MS + off + timeOfDay;
        if (wall < start) continue;
        if (n >= count || !emit(wall)) return;
        yield wall;
      }
    }
    return;
  }

  const d0 = new Date(start);
  for (let i = 0; n < count && n < MAX_OCCURRENCES; i += interval) {
    let wall;
    if (r.FREQ === 'DAILY') wall = start + i * DAY_MS;
    else if (r.FREQ === 'MONTHLY' || r.FREQ === 'YEARLY') {
      const months = r.FREQ === 'MONTHLY' ? i : i * 12;
      const y = d0.getUTCFullYear() + Math.floor((d0.getUTCMonth() + months) / 12);
      const mo = (d0.getUTCMonth() + months) % 12;
      wall = Date.UTC(y, mo, d0.getUTCDate()) + timeOfDay;
      if (new Date(wall).getUTCDate() !== d0.getUTCDate()) continue; // es. 31 in un mese di 30 giorni
    } else {
      yield start;
      return;
    }
    if (!emit(wall)) return;
    yield wall;
  }
}

/** Eventi con orario compresi in [from, to), ricorrenze espanse, nella forma dell'API Google. */
export function expandIcs(text, from, to, defaultTz = 'Europe/Rome') {
  const all = parseIcs(text, defaultTz).filter((e) => !e.start.allDay);
  const overrides = all.filter((e) => e.recurrenceId !== undefined);
  const replaced = new Set(overrides.map((e) => `${e.uid}@${e.recurrenceId}`));
  const out = [];

  const push = (ev, startWall, key) => {
    const startUtc = wallToUtc(startWall, ev.start.tz);
    const dur = ev.end ? ev.end.wall - ev.start.wall : ev.duration || 0;
    const endUtc = wallToUtc(startWall + dur, ev.start.tz);
    if (endUtc <= from.getTime() || startUtc >= to.getTime()) return;
    out.push({
      id: key,
      summary: ev.summary || '',
      description: ev.description || '',
      location: ev.location || '',
      status: ev.status === 'CANCELLED' ? 'cancelled' : 'confirmed',
      start: { dateTime: new Date(startUtc).toISOString() },
      end: { dateTime: new Date(endUtc).toISOString() },
    });
  };

  for (const ev of all) {
    if (ev.recurrenceId !== undefined) { push(ev, ev.start.wall, `${ev.uid}_${ev.recurrenceId}`); continue; }
    if (!ev.rrule) { push(ev, ev.start.wall, ev.uid); continue; }
    const ex = new Set(ev.exdates);
    for (const wall of recurrenceStarts(ev)) {
      const utc = wallToUtc(wall, ev.start.tz);
      if (utc >= to.getTime()) break;
      if (ex.has(utc) || replaced.has(`${ev.uid}@${utc}`)) continue;
      push(ev, wall, `${ev.uid}_${utc}`);
    }
  }
  return out.sort((a, b) => a.start.dateTime.localeCompare(b.start.dateTime));
}

export async function fetchIcsEvents(url, from, to) {
  const res = await fetch(url.replace(/^webcal:/i, 'https:'), { cache: 'no-store' });
  if (!res.ok) throw new Error(`il calendario iCal ha risposto ${res.status}`);
  return expandIcs(await res.text(), from, to);
}
