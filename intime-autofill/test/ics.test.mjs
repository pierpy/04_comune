import test from 'node:test';
import assert from 'node:assert/strict';
import { expandIcs } from '../src/lib/ics.js';

const cal = (...events) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events.flat(), 'END:VCALENDAR'].join('\r\n');
const range = (a, b) => [new Date(a), new Date(b)];

test('serie settimanale con fuso orario, ora legale ed EXDATE', () => {
  const text = cal([
    'BEGIN:VEVENT', 'UID:analisi', 'SUMMARY:Analisi I',
    'DTSTART;TZID=Europe/Rome:20261020T093000', 'DTEND;TZID=Europe/Rome:20261020T113000',
    'RRULE:FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20261105T235959Z',
    'EXDATE;TZID=Europe/Rome:20261022T093000',
    'DESCRIPTION:Limiti\\, successioni\\nesercizi', 'END:VEVENT',
  ]);
  const ev = expandIcs(text, ...range('2026-10-01T00:00:00Z', '2026-12-01T00:00:00Z'));
  assert.deepEqual(ev.map((e) => e.start.dateTime), [
    '2026-10-20T07:30:00.000Z',          // ora legale: UTC+2
    '2026-10-27T08:30:00.000Z',          // dopo il 25/10: UTC+1, sempre le 9:30 a Roma
    '2026-10-29T08:30:00.000Z',
    '2026-11-03T08:30:00.000Z',
    '2026-11-05T08:30:00.000Z',
  ]);
  assert.equal(ev[0].description, 'Limiti, successioni\nesercizi');
  assert.equal(ev[1].end.dateTime, '2026-10-27T10:30:00.000Z');
});

test('occorrenza spostata (RECURRENCE-ID) e COUNT', () => {
  const text = cal(
    ['BEGIN:VEVENT', 'UID:geo', 'SUMMARY:Geometria', 'DTSTART:20261019T080000Z', 'DTEND:20261019T100000Z', 'RRULE:FREQ=WEEKLY;COUNT=3', 'END:VEVENT'],
    ['BEGIN:VEVENT', 'UID:geo', 'SUMMARY:Geometria (recupero)', 'RECURRENCE-ID:20261026T080000Z', 'DTSTART:20261027T140000Z', 'DTEND:20261027T160000Z', 'END:VEVENT'],
  );
  const ev = expandIcs(text, ...range('2026-10-01T00:00:00Z', '2027-01-01T00:00:00Z'));
  assert.deepEqual(ev.map((e) => [e.start.dateTime, e.summary]), [
    ['2026-10-19T08:00:00.000Z', 'Geometria'],
    ['2026-10-27T14:00:00.000Z', 'Geometria (recupero)'],
    ['2026-11-02T08:00:00.000Z', 'Geometria'],
  ]);
});

test('righe piegate, eventi tutto il giorno ignorati e filtro per periodo', () => {
  const text = cal(
    ['BEGIN:VEVENT', 'UID:a', 'SUMMARY:Lezione con titolo molto', '  lungo', 'DTSTART;TZID=Europe/Rome:20261110T140000', 'DURATION:PT1H30M', 'END:VEVENT'],
    ['BEGIN:VEVENT', 'UID:b', 'SUMMARY:Festa', 'DTSTART;VALUE=DATE:20261110', 'END:VEVENT'],
    ['BEGIN:VEVENT', 'UID:c', 'SUMMARY:Fuori periodo', 'DTSTART:20250101T100000Z', 'DTEND:20250101T110000Z', 'END:VEVENT'],
  );
  const ev = expandIcs(text, ...range('2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z'));
  assert.equal(ev.length, 1);
  assert.equal(ev[0].summary, 'Lezione con titolo molto lungo');
  assert.equal(ev[0].start.dateTime, '2026-11-10T13:00:00.000Z');
  assert.equal(ev[0].end.dateTime, '2026-11-10T14:30:00.000Z');
});
