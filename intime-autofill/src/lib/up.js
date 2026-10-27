// Lettura degli impegni da University Planner (Cineca).
// L'API non è documentata pubblicamente: due modi per ottenerla.
//  1. "Richiesta catturata": l'utente apre una volta la propria pagina calendarioPubblico
//     (anche nella forma .../calendarioPubblico/matricola=XXXXXX) e il content script
//     up-capture.js registra la chiamata getImpegniCalendarioPubblico fatta dalla pagina.
//     Qui la ripetiamo cambiando solo l'intervallo di date: funziona per qualunque
//     tipo di link senza dover conoscere i parametri.
//  2. "linkCalendarioId": si costruisce la richiesta da zero, come fanno i progetti open
//     source che hanno ricostruito il contratto (vedi README).

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json;charset=UTF-8', Accept: 'application/json' },
    body: JSON.stringify(body),
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
  if (source.kind === 'captured') return { url: source.url, body: source.body };
  return {
    url: `https://${source.host}/api/Impegni/getImpegniCalendarioPubblico`,
    body: {
      linkCalendarioId: source.linkCalendarioId,
      clienteId: source.clienteId,
      mostraImpegniAnnullati: true,
      mostraIndisponibilitaTotali: false,
      pianificazioneTemplate: false,
    },
  };
}

/** Scarica gli impegni grezzi di una sorgente in [from, to), a blocchi settimanali. */
export async function fetchUpImpegni(source, from, to) {
  if (source.kind !== 'captured' && !source.clienteId) source.clienteId = await resolveClienteId(source.host);
  const { url, body } = sourceRequest(source);
  const out = [];
  const seen = new Set();
  for (let t = from.getTime(); t < to.getTime(); t += WEEK_MS) {
    const dataInizio = new Date(t).toISOString();
    const dataFine = new Date(Math.min(t + WEEK_MS, to.getTime())).toISOString();
    const items = await postJson(url, { ...body, dataInizio, dataFine });
    for (const it of Array.isArray(items) ? items : []) {
      const k = it.id ?? `${it.eventoId}:${it.dataInizio}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(it);
    }
  }
  return out;
}
