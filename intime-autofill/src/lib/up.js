// Lettura degli impegni da University Planner (Cineca).
// L'API non è documentata pubblicamente: due modi per ottenerla.
//  1. "Richiesta catturata": l'utente apre una volta la propria pagina calendarioPubblico
//     (anche nella forma .../calendarioPubblico/matricola=XXXXXX) e il content script
//     up-capture.js registra la chiamata che restituisce gli impegni. Qui la ripetiamo
//     cambiando solo l'intervallo di date: funziona senza conoscere endpoint e parametri.
//  2. "linkCalendarioId": si costruisce la richiesta da zero, come fanno i progetti open
//     source che hanno ricostruito il contratto (vedi README).

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T|$)/;
const PREFERRED = [['dataInizio', 'dataFine'], ['start', 'end'], ['from', 'to'], ['dal', 'al']];

// Le due chiavi che portano l'intervallo di date: prima i nomi noti, poi i primi due valori che sono date ISO.
function dateKeys(entries) {
  const keys = entries.map(([k]) => k);
  for (const pair of PREFERRED) if (pair.every((k) => keys.includes(k))) return pair;
  const dated = entries.filter(([, v]) => typeof v === 'string' && ISO_DATE.test(v)).map(([k]) => k);
  return dated.length >= 2 ? dated.slice(0, 2) : null;
}

// Una stessa chiamata con date diverse ha la stessa firma.
export function requestSignature({ url, method = 'POST', body }) {
  const u = new URL(url);
  const qk = dateKeys([...u.searchParams.entries()]);
  qk?.forEach((k) => u.searchParams.delete(k));
  const b = body && typeof body === 'object' ? { ...body } : null;
  if (b) dateKeys(Object.entries(b))?.forEach((k) => delete b[k]);
  return `${method.toUpperCase()} ${u.href} ${JSON.stringify(b)}`;
}

export function withDates({ url, method = 'POST', body }, from, to) {
  const u = new URL(url);
  const qk = dateKeys([...u.searchParams.entries()]);
  if (qk) { u.searchParams.set(qk[0], from); u.searchParams.set(qk[1], to); }
  let b = body && typeof body === 'object' ? { ...body } : null;
  if (b) {
    const bk = dateKeys(Object.entries(b)) || (qk ? null : ['dataInizio', 'dataFine']);
    if (bk) { b[bk[0]] = from; b[bk[1]] = to; }
  }
  if (method.toUpperCase() === 'GET') b = null;
  return { url: u.href, method: method.toUpperCase(), body: b };
}

async function callJson({ url, method, body }) {
  const res = await fetch(url, {
    method,
    headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json;charset=UTF-8' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`University Planner ha risposto ${res.status} (${url})`);
  return res.json();
}

export async function resolveClienteId(host) {
  const res = await fetch(`https://${host}/api/Clienti/cercaPerDominio?dominio=${encodeURIComponent(host)}`);
  if (!res.ok) throw new Error(`Impossibile identificare l'ateneo su ${host} (${res.status})`);
  return (await res.json()).id;
}

function sourceRequest(source) {
  if (source.kind === 'captured') return { url: source.url, method: source.method || 'POST', body: source.body };
  return {
    url: `https://${source.host}/api/Impegni/getImpegniCalendarioPubblico`,
    method: 'POST',
    body: {
      linkCalendarioId: source.linkCalendarioId,
      clienteId: source.clienteId,
      mostraImpegniAnnullati: true,
      mostraIndisponibilitaTotali: false,
      pianificazioneTemplate: false,
      dataInizio: '',
      dataFine: '',
    },
  };
}

function unwrap(data, path) {
  if (path) return Array.isArray(data?.[path]) ? data[path] : [];
  if (Array.isArray(data)) return data;
  for (const k of ['payload', 'items', 'data', 'impegni']) if (Array.isArray(data?.[k])) return data[k];
  return [];
}

/** Scarica gli impegni grezzi di una sorgente in [from, to), a blocchi settimanali. */
export async function fetchUpImpegni(source, from, to) {
  if (source.kind !== 'captured' && !source.clienteId) source.clienteId = await resolveClienteId(source.host);
  const base = sourceRequest(source);
  const out = [];
  const seen = new Set();
  for (let t = from.getTime(); t < to.getTime(); t += WEEK_MS) {
    const req = withDates(base, new Date(t).toISOString(), new Date(Math.min(t + WEEK_MS, to.getTime())).toISOString());
    for (const it of unwrap(await callJson(req), source.responsePath)) {
      const k = it.id ?? `${it.eventoId}:${it.dataInizio}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(it);
    }
  }
  return out;
}
