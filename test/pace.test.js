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
