import test from 'node:test';
import assert from 'node:assert/strict';
import { requestSignature, withDates } from '../src/lib/up.js';

const F = '2026-10-26T00:00:00.000Z';
const T = '2026-11-02T00:00:00.000Z';

test('POST: sostituisce dataInizio/dataFine nel corpo', () => {
  const r = withDates({ url: 'https://unich.prod.up.cineca.it/api/Impegni/getImpegniCalendarioPubblico', method: 'POST', body: { matricola: '006301', dataInizio: '2026-01-01T00:00:00Z', dataFine: '2026-01-08T00:00:00Z' } }, F, T);
  assert.deepEqual(r.body, { matricola: '006301', dataInizio: F, dataFine: T });
});

test('POST: corpo salvato senza date (versione precedente) riceve dataInizio/dataFine', () => {
  const r = withDates({ url: 'https://x.up.cineca.it/api/Impegni/a', method: 'POST', body: { linkCalendarioId: 'abc' } }, F, T);
  assert.deepEqual(r.body, { linkCalendarioId: 'abc', dataInizio: F, dataFine: T });
});

test('GET: sostituisce le date nella query', () => {
  const r = withDates({ url: 'https://x.up.cineca.it/api/Impegni/docente?matricola=006301&inizio=2026-01-01&fine=2026-01-08', method: 'GET' }, F, T);
  const u = new URL(r.url);
  assert.equal(u.searchParams.get('inizio'), F);
  assert.equal(u.searchParams.get('fine'), T);
  assert.equal(r.body, null);
});

test('stessa chiamata con settimane diverse ha la stessa firma', () => {
  const a = requestSignature({ url: 'https://x/api/I', method: 'POST', body: { m: 1, dataInizio: '2026-01-01', dataFine: '2026-01-08' } });
  const b = requestSignature({ url: 'https://x/api/I', method: 'POST', body: { m: 1, dataInizio: '2026-02-01', dataFine: '2026-02-08' } });
  assert.equal(a, b);
});
