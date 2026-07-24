const test = require('node:test');
const assert = require('node:assert/strict');
const lib = require('../src/pace.js');

test('parseTimeToMinutes parses positive HH:MM', () => {
  assert.equal(lib.parseTimeToMinutes('36:03'), 36 * 60 + 3);
});

test('parseTimeToMinutes parses negative HH:MM', () => {
  assert.equal(lib.parseTimeToMinutes('-36:03'), -(36 * 60 + 3));
});

test('parseTimeToMinutes returns null for invalid input', () => {
  assert.equal(lib.parseTimeToMinutes('not-a-time'), null);
});

test('extractRequiredRemainingMinutes picks the first negative value', () => {
  const text = '133:03\n-36:03\n-99:09';
  assert.equal(lib.extractRequiredRemainingMinutes(text), 36 * 60 + 3);
});

test('extractRequiredRemainingMinutes returns null when no negative value is present', () => {
  assert.equal(lib.extractRequiredRemainingMinutes('133:03'), null);
});

test('parsePeriodRange parses a same-year range', () => {
  const range = lib.parsePeriodRange('2026. 7. 1 – 7. 31');
  assert.equal(range.startDate.getFullYear(), 2026);
  assert.equal(range.startDate.getMonth(), 6);
  assert.equal(range.startDate.getDate(), 1);
  assert.equal(range.endDate.getFullYear(), 2026);
  assert.equal(range.endDate.getMonth(), 6);
  assert.equal(range.endDate.getDate(), 31);
});

test('parsePeriodRange rolls the end year over when the end month is earlier', () => {
  const range = lib.parsePeriodRange('2026. 12. 21 – 1. 20');
  assert.equal(range.endDate.getFullYear(), 2027);
  assert.equal(range.endDate.getMonth(), 0);
  assert.equal(range.endDate.getDate(), 20);
});

test('parsePeriodRange returns null for unrecognized text', () => {
  assert.equal(lib.parsePeriodRange('아무 텍스트'), null);
});

test('stripTime zeroes out the time-of-day', () => {
  const d = lib.stripTime(new Date(2026, 6, 24, 15, 30, 0));
  assert.equal(d.getHours(), 0);
  assert.equal(d.getMinutes(), 0);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 6);
  assert.equal(d.getDate(), 24);
});
