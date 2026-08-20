const test = require('node:test');
const assert = require('node:assert/strict');
const lib = require('../src/pace.js');
const fx = require('./fixtures/schedules.js');

// 2026-09: 1일이 화요일. 주말 + 9/16 공휴일 + 9/21~22 연차(미래) + 9/1~9 근무 + 9/10 근무 중
const SEP_2026 = (() => {
  const attributes = [];
  const schedules = [];
  const worked = new Set([1, 2, 3, 4, 7, 8, 9]);
  const leave = new Set([21, 22]);
  const holidays = { 16: 'CUSTOM_HOLIDAY' };
  for (let day = 1; day <= 30; day += 1) {
    const iso = `2026-09-${String(day).padStart(2, '0')}`;
    const weekday = new Date(2026, 8, day).getDay();
    const dayOffType =
      holidays[day] || (weekday === 6 ? 'REST_DAY' : weekday === 0 ? 'WEEKLY_HOLIDAY' : null);
    attributes.push(fx.attribute(iso, { dayOffType }));
    let blocks = [];
    if (!dayOffType && worked.has(day)) blocks = [fx.workBlock(iso, 10, 20), fx.restBlock(iso, 13, 60)];
    else if (!dayOffType && leave.has(day)) blocks = [fx.timeOffBlock()];
    else if (day === 10) blocks = [fx.openWorkBlock(iso, 9)];
    schedules.push(fx.schedule(iso, blocks));
  }
  return { workingDayAttributes: attributes, dailySchedules: schedules };
})();

const END_OF_PERIOD = new Date(2026, 8, 30);

function dayFor(days, isoDate) {
  return days.find((d) => d.isoDate === isoDate);
}

test('parseIsoDate builds a local date without timezone drift', () => {
  const d = lib.parseIsoDate('2026-09-07');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 8);
  assert.equal(d.getDate(), 7);
});

test('parseIsoDate returns null for unusable input', () => {
  assert.equal(lib.parseIsoDate('2026/09/07'), null);
  assert.equal(lib.parseIsoDate(null), null);
});

test('summarizeSchedule subtracts REST blocks from WORK blocks', () => {
  const s = lib.summarizeSchedule(
    fx.schedule('2026-09-01', [fx.workBlock('2026-09-01', 10, 20), fx.restBlock('2026-09-01', 13, 60)])
  );
  assert.deepEqual(s, { workMinutes: 540, timeOffMinutes: 0, hasOpenWorkBlock: false });
});

test('summarizeSchedule flags a work block without an end timestamp as in progress', () => {
  const s = lib.summarizeSchedule(fx.schedule('2026-09-10', [fx.openWorkBlock('2026-09-10', 9)]));
  assert.equal(s.hasOpenWorkBlock, true);
  assert.equal(s.workMinutes, 0);
});

test('summarizeSchedule reads used minutes from a time-off block', () => {
  const s = lib.summarizeSchedule(fx.schedule('2026-09-21', [fx.timeOffBlock()]));
  assert.deepEqual(s, { workMinutes: 0, timeOffMinutes: 480, hasOpenWorkBlock: false });
});

test('buildDaysFromApi excludes weekends and public holidays by dayOff type', () => {
  const days = lib.buildDaysFromApi(SEP_2026);
  assert.equal(days.length, 30);
  assert.equal(dayFor(days, '2026-09-05').reason, 'REST_DAY');
  assert.equal(dayFor(days, '2026-09-06').reason, 'WEEKLY_HOLIDAY');
  assert.equal(dayFor(days, '2026-09-16').reason, 'CUSTOM_HOLIDAY');
  assert.equal(dayFor(days, '2026-09-16').isWorkDay, false);
});

test('buildDaysFromApi excludes future 연차 days', () => {
  const days = lib.buildDaysFromApi(SEP_2026);
  assert.equal(dayFor(days, '2026-09-21').reason, 'TIME_OFF');
  assert.equal(dayFor(days, '2026-09-21').recognizedMinutes, 480);
  assert.equal(dayFor(days, '2026-09-22').isWorkDay, false);
});

test('buildDaysFromApi excludes days whose work is already recognized', () => {
  const days = lib.buildDaysFromApi(SEP_2026);
  assert.equal(dayFor(days, '2026-09-09').reason, 'WORKED');
  assert.equal(dayFor(days, '2026-09-09').recognizedMinutes, 540);
});

test('buildDaysFromApi keeps a day with work still in progress', () => {
  const days = lib.buildDaysFromApi(SEP_2026);
  const today = dayFor(days, '2026-09-10');
  assert.equal(today.inProgress, true);
  assert.equal(today.isWorkDay, true);
  assert.equal(today.reason, null);
});

test('buildDaysFromApi excludes a weekday with no usual working minutes', () => {
  const days = lib.buildDaysFromApi({
    workingDayAttributes: [{ date: '2026-09-14', dayOffs: [], usualWorkingMinutes: 0 }],
    dailySchedules: [],
  });
  assert.equal(days[0].reason, 'NO_USUAL_MINUTES');
});

test('remaining work days while working on 9/10: today counts, 12 days left', () => {
  const days = lib.buildDaysFromApi(SEP_2026);
  const remaining = lib.countRemainingWorkDays(days, new Date(2026, 8, 10, 10, 0), END_OF_PERIOD);
  // 10(진행 중), 11, 14, 15, 17, 18, 23, 24, 25, 28, 29, 30 - 16(공휴일)과 21,22(연차) 제외
  assert.equal(remaining, 12);
  assert.equal(lib.buildCompactMessage(5000, remaining), 'Need 6h 57m/day (12d)');
});

test('after clocking out on 9/10 the day drops out of the count', () => {
  const input = {
    workingDayAttributes: SEP_2026.workingDayAttributes,
    dailySchedules: SEP_2026.dailySchedules.map((s) =>
      s.date === '2026-09-10' ? fx.schedule(s.date, [fx.workBlock(s.date, 9, 18)]) : s
    ),
  };
  const days = lib.buildDaysFromApi(input);
  assert.equal(dayFor(days, '2026-09-10').reason, 'WORKED');
  assert.equal(lib.countRemainingWorkDays(days, new Date(2026, 8, 10, 19, 0), END_OF_PERIOD), 11);
});

test('half-day 연차 is excluded too, keeping the pace on the safe side', () => {
  const input = {
    workingDayAttributes: SEP_2026.workingDayAttributes,
    dailySchedules: SEP_2026.dailySchedules.map((s) =>
      s.date === '2026-09-11' ? fx.schedule(s.date, [fx.timeOffBlock(240, false)]) : s
    ),
  };
  const days = lib.buildDaysFromApi(input);
  assert.equal(dayFor(days, '2026-09-11').reason, 'TIME_OFF');
  assert.equal(lib.countRemainingWorkDays(days, new Date(2026, 8, 10, 10, 0), END_OF_PERIOD), 11);
});
