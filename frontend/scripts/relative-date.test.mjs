import test from 'node:test';
import assert from 'node:assert/strict';
import { relativeDate } from '../src/utils/relative-date.js';

const now = new Date(2026, 8, 27, 12).getTime();

test('parses Russian DD.MM.YYYY dates and formats Russian day plurals', () => {
  assert.equal(relativeDate('26.09.2026', undefined, now), '1 день назад');
  assert.equal(relativeDate('25.09.2026', undefined, now), '2 дня назад');
  assert.equal(relativeDate('22.09.2026', undefined, now), '5 дней назад');
  assert.equal(relativeDate('16.09.2026', undefined, now), '11 дней назад');
});

test('uses the first-seen date when the publication date is invalid', () => {
  assert.equal(relativeDate('not-a-date', '20.09.2026', now), '7 дней назад');
});

test('does not expose NaN for invalid dates and clamps future dates', () => {
  assert.equal(relativeDate('not-a-date', '', now), 'дата неизвестна');
  assert.equal(relativeDate('28.09.2026', undefined, now), 'только что');
});
