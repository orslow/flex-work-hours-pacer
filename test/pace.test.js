const test = require('node:test');
const assert = require('node:assert/strict');
const lib = require('../src/pace.js');

test('stripTime zeroes out the time-of-day', () => {
  const d = lib.stripTime(new Date(2026, 6, 24, 15, 30, 0));
  assert.equal(d.getHours(), 0);
  assert.equal(d.getMinutes(), 0);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 6);
  assert.equal(d.getDate(), 24);
});

test('countRemainingWorkDays counts work days from today through endDate inclusive', () => {
  const dayInfos = [
    { date: new Date(2026, 6, 24), isWorkDay: true },
    { date: new Date(2026, 6, 25), isWorkDay: false },
    { date: new Date(2026, 6, 26), isWorkDay: false },
    { date: new Date(2026, 6, 27), isWorkDay: true },
    { date: new Date(2026, 6, 28), isWorkDay: true },
    { date: new Date(2026, 6, 29), isWorkDay: true },
    { date: new Date(2026, 6, 30), isWorkDay: true },
    { date: new Date(2026, 6, 31), isWorkDay: true },
  ];
  const today = new Date(2026, 6, 24, 9, 0, 0);
  assert.equal(lib.countRemainingWorkDays(dayInfos, today, new Date(2026, 6, 31)), 6);
});

test('countRemainingWorkDays ignores days before today', () => {
  const dayInfos = [
    { date: new Date(2026, 6, 20), isWorkDay: true },
    { date: new Date(2026, 6, 24), isWorkDay: true },
  ];
  assert.equal(
    lib.countRemainingWorkDays(dayInfos, new Date(2026, 6, 24), new Date(2026, 6, 31)),
    1
  );
});

test('countRemainingWorkDays ignores days after the period end', () => {
  const dayInfos = [
    { date: new Date(2026, 6, 31), isWorkDay: true },
    { date: new Date(2026, 7, 3), isWorkDay: true },
  ];
  assert.equal(
    lib.countRemainingWorkDays(dayInfos, new Date(2026, 6, 24), new Date(2026, 6, 31)),
    1
  );
});

test('computePace returns done when remainingMinutes is zero or negative', () => {
  assert.deepEqual(lib.computePace(0, 5), { status: 'done' });
  assert.deepEqual(lib.computePace(-10, 5), { status: 'done' });
});

test('computePace returns noDaysLeft when remainingDays is zero or negative and time is still owed', () => {
  assert.deepEqual(lib.computePace(120, 0), { status: 'noDaysLeft' });
});

test('computePace returns ok with ceil-rounded dailyMinutes', () => {
  assert.deepEqual(lib.computePace(100, 3), { status: 'ok', dailyMinutes: 34 });
});

test('formatMinutesAsHM formats hours and minutes', () => {
  assert.equal(lib.formatMinutesAsHM(2163), '36시간 3분');
});

test('formatMinutesAsHM formats whole hours without a minutes part', () => {
  assert.equal(lib.formatMinutesAsHM(120), '2시간');
});

test('formatMinutesAsHM formats minutes only when under an hour', () => {
  assert.equal(lib.formatMinutesAsHM(45), '45분');
});

test('buildBannerMessage builds the ok message', () => {
  assert.equal(
    lib.buildBannerMessage(2163, 6),
    '잔여 36시간 3분 - 남은 근무일 6일 -> 하루 평균 6시간 1분씩 더 일하면 됩니다'
  );
});

test('buildBannerMessage builds the done message', () => {
  assert.equal(lib.buildBannerMessage(0, 3), '이번 정산기간 필수 근무시간을 이미 채우셨습니다 🎉');
});

test('buildBannerMessage builds the noDaysLeft message', () => {
  assert.equal(lib.buildBannerMessage(60, 0), '이번 정산기간 근무 가능일이 모두 지났습니다.');
});

test('formatCompactRemaining formats hours and minutes compactly', () => {
  assert.equal(lib.formatCompactRemaining(433), '7h 13m');
});

test('formatCompactRemaining formats whole hours without a minutes part', () => {
  assert.equal(lib.formatCompactRemaining(120), '2h');
});

test('formatCompactRemaining formats minutes only when under an hour', () => {
  assert.equal(lib.formatCompactRemaining(45), '45m');
});

test('buildCompactMessage builds the ok message', () => {
  assert.equal(lib.buildCompactMessage(2163, 5), 'Need 7h 13m/day (5d)');
});

test('buildCompactMessage builds the done message', () => {
  assert.equal(lib.buildCompactMessage(0, 3), 'Goal met 🎉');
});

test('buildCompactMessage builds the noDaysLeft message', () => {
  assert.equal(lib.buildCompactMessage(60, 0), 'No days left');
});
