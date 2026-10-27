import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRows, normalizeGcal, normalizeUp, localParts, titleSimilarity } from '../src/lib/matcher.js';

const up = (id, start, end, extra = {}) => normalizeUp({
  id, dataInizio: start, dataFine: end, nome: 'Analisi Matematica I', stato: 'P', tipoAttivita: { descrizione: 'Lezione' }, ...extra,
});
const gc = (id, start, end, summary, description = '') => normalizeGcal({ id, summary, description, start: { dateTime: start }, end: { dateTime: end } }, 'cal');

test('ora locale di Roma, anche con ora legale', () => {
  assert.deepEqual(localParts('2026-10-20T07:30:00Z'), { date: '20/10/2026', isoDate: '2026-10-20', time: '09:30' });
  assert.equal(localParts('2026-11-10T08:30:00Z').time, '09:30');
});

test('abbina UP e Google e prende l\'argomento dalla descrizione', () => {
  const rows = buildRows(
    [up(1, '2026-10-20T07:30:00Z', '2026-10-20T09:30:00Z')],
    [gc('a', '2026-10-20T07:30:00Z', '2026-10-20T09:30:00Z', 'Analisi I', '<p>Limiti di successioni</p>')],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, 'both');
  assert.equal(rows[0].topic, 'Limiti di successioni');
  assert.equal(rows[0].start, '09:30');
  assert.equal(rows[0].hours, 2);
  assert.deepEqual(rows[0].warnings, []);
  assert.equal(rows[0].selected, true);
});

test('titolo Google uguale al corso non diventa argomento', () => {
  const rows = buildRows(
    [up(1, '2026-10-20T07:30:00Z', '2026-10-20T09:30:00Z')],
    [gc('a', '2026-10-20T07:30:00Z', '2026-10-20T09:30:00Z', 'Analisi Matematica I')],
  );
  assert.equal(rows[0].topic, '');
});

test('segnala orari diversi, lezioni solo-UP e solo-Google', () => {
  const rows = buildRows(
    [up(1, '2026-10-20T07:30:00Z', '2026-10-20T09:30:00Z'), up(2, '2026-10-21T07:30:00Z', '2026-10-21T09:30:00Z')],
    [gc('a', '2026-10-20T07:45:00Z', '2026-10-20T09:30:00Z', 'Integrali'), gc('b', '2026-10-22T14:00:00Z', '2026-10-22T16:00:00Z', 'Ricevimento')],
  );
  assert.equal(rows.length, 3);
  assert.match(rows[0].warnings[0], /Orario diverso/);
  assert.equal(rows[1].source, 'up');
  assert.equal(rows[2].source, 'gcal');
  assert.equal(rows[2].selected, false);
});

test('lezione annullata in UP esclusa, segnalata se presente in Google', () => {
  const rows = buildRows(
    [up(1, '2026-10-20T07:30:00Z', '2026-10-20T09:30:00Z', { stato: 'A' }), up(2, '2026-10-21T07:30:00Z', '2026-10-21T09:30:00Z', { stato: 'A' })],
    [gc('a', '2026-10-20T07:30:00Z', '2026-10-20T09:30:00Z', 'Integrali')],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].selected, false);
  assert.match(rows[0].warnings[0], /annullata/);
});

test('due lezioni contigue non si scambiano gli eventi', () => {
  const rows = buildRows(
    [up(1, '2026-10-20T07:00:00Z', '2026-10-20T09:00:00Z'), up(2, '2026-10-20T09:00:00Z', '2026-10-20T11:00:00Z', { nome: 'Geometria' })],
    [gc('g', '2026-10-20T09:00:00Z', '2026-10-20T11:00:00Z', 'Geometria', 'Rette'), gc('a', '2026-10-20T07:00:00Z', '2026-10-20T09:00:00Z', 'Analisi', 'Limiti')],
  );
  assert.deepEqual(rows.map((r) => r.topic), ['Limiti', 'Rette']);
});

test('mappa dei tipi e eventi tutto il giorno ignorati', () => {
  assert.equal(normalizeGcal({ id: 'x', start: { date: '2026-10-20' }, end: { date: '2026-10-21' } }), null);
  const rows = buildRows([up(1, '2026-10-20T07:30:00Z', '2026-10-20T09:30:00Z')], [], { typeMap: { Lezione: 'Lezione frontale' } });
  assert.equal(rows[0].type, 'Lezione frontale');
  assert.ok(titleSimilarity('Analisi Matematica I', 'analisi matematica') > 0.5);
});
