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

test('extractRequiredRemainingMinutes reads the second value and negates it when still owed', () => {
  const text = '133:03\n-36:03\n-99:09';
  assert.equal(lib.extractRequiredRemainingMinutes(text), 36 * 60 + 3);
});

test('extractRequiredRemainingMinutes returns 0 when the goal is exactly met', () => {
  const text = '133:03\n0:00\n-99:09';
  assert.equal(lib.extractRequiredRemainingMinutes(text), 0);
});

test('extractRequiredRemainingMinutes returns a negative value when the goal is exceeded', () => {
  const text = '133:03\n5:00\n-99:09';
  assert.equal(lib.extractRequiredRemainingMinutes(text), -300);
});

test('extractRequiredRemainingMinutes returns null when fewer than 3 values are present (not fully rendered yet)', () => {
  assert.equal(lib.extractRequiredRemainingMinutes('133:03\n-99:09'), null);
});

test('extractRequiredRemainingMinutes returns null when no time-like values are present', () => {
  assert.equal(lib.extractRequiredRemainingMinutes('no data'), null);
});

// 2026-08 실제 flex.team DOM에서 그대로 옮긴 날짜 셀 클래스 값
const PLAIN_CELL_CLASS = 'c-bElvsc PJLV fx_5f52664e_1e9jm180 fx_5f52664e_1e9jm182';
const HOLIDAY_CELL_CLASS =
  'c-bElvsc c-bElvsc-fmLUio-colorType-holiday PJLV fx_5f52664e_1e9jm180 fx_5f52664e_1e9jm182';
// 2026-08-01(토)부터 31일까지의 요일
const AUG_2026_WEEKDAYS = '토일월화수목금토일월화수목금토일월화수목금토일월화수목금토일월'.split('');
// 주말 + 8/17 광복절 대체공휴일
const AUG_2026_HOLIDAYS = new Set([1, 2, 8, 9, 15, 16, 17, 22, 23, 29, 30]);

function augCells({ holidayStylingApplied = true, workMinutesByDay = {}, workingNowDay = null } = {}) {
  return AUG_2026_WEEKDAYS.map((weekday, index) => {
    const day = index + 1;
    const marked = holidayStylingApplied && AUG_2026_HOLIDAYS.has(day);
    return {
      text: `${day}${weekday}`,
      className: marked ? HOLIDAY_CELL_CLASS : PLAIN_CELL_CLASS,
      workMinutes: day in workMinutesByDay ? workMinutesByDay[day] : 0,
      isWorkingNow: day === workingNowDay,
    };
  });
}

function toDayDates(days) {
  return days.map((d) => ({ date: new Date(2026, 7, d.day), isWorkDay: d.isWorkDay }));
}

test('parseDayCell reads the day number, weekday and holiday marker from a real cell', () => {
  assert.deepEqual(lib.parseDayCell({ text: '17월', className: HOLIDAY_CELL_CLASS }), {
    day: 17,
    weekday: '월',
    markedHoliday: true,
    workMinutes: null,
    isWorkingNow: false,
    isHoliday: true,
    isPrescheduled: false,
    isWorkDay: false,
    reason: 'holiday',
  });
});

test('parseDayCell treats 토/일 as holidays even without the marker class', () => {
  assert.equal(lib.parseDayCell({ text: '15 토', className: PLAIN_CELL_CLASS }).isWorkDay, false);
  assert.equal(lib.parseDayCell({ text: '16 일', className: PLAIN_CELL_CLASS }).isWorkDay, false);
});

test('parseDayCell counts a plain weekday with an empty chip as a remaining work day', () => {
  const cell = { text: '18화', className: PLAIN_CELL_CLASS, workMinutes: 0 };
  assert.equal(lib.parseDayCell(cell).isWorkDay, true);
  assert.equal(lib.parseDayCell(cell).reason, null);
});

test('parseDayCell excludes a day whose chip already carries time (연차, or a finished day)', () => {
  // flex.team은 예정 연차를 실근무에 미리 얹기 때문에, 아직 오지 않은 연차 날도 칩이 8:00이다
  const leave = { text: '13목', className: PLAIN_CELL_CLASS, workMinutes: 480 };
  assert.equal(lib.parseDayCell(leave).isWorkDay, false);
  assert.equal(lib.parseDayCell(leave).isPrescheduled, true);
  assert.equal(lib.parseDayCell(leave).reason, 'prescheduled');

  const finished = { text: '5수', className: PLAIN_CELL_CLASS, workMinutes: 7 * 60 + 57 };
  assert.equal(lib.parseDayCell(finished).isWorkDay, false);
});

test('parseDayCell keeps today as a work day while work is in progress', () => {
  const inProgress = { text: '6목', className: PLAIN_CELL_CLASS, workMinutes: 0, isWorkingNow: true };
  assert.equal(lib.parseDayCell(inProgress).isWorkDay, true);
  // 칩이 실시간으로 채워지더라도 근무 중이면 아직 미확정이므로 제외하지 않는다
  const live = { text: '6목', className: PLAIN_CELL_CLASS, workMinutes: 134, isWorkingNow: true };
  assert.equal(lib.parseDayCell(live).isWorkDay, true);
});

test('parseDayCell returns null for non day cells', () => {
  assert.equal(lib.parseDayCell({ text: '7:57', className: PLAIN_CELL_CLASS }), null);
  assert.equal(lib.parseDayCell({ text: '', className: '' }), null);
});

test('analyzeDayCells marks 8/17 (substitute holiday for 광복절) as a non work day', () => {
  const { days, holidayStylingReady } = lib.analyzeDayCells(augCells());
  assert.equal(holidayStylingReady, true);
  assert.equal(days.length, 31);
  assert.equal(days.find((d) => d.day === 17).isWorkDay, false);
  assert.equal(days.find((d) => d.day === 18).isWorkDay, true);
  assert.equal(days.filter((d) => d.isHoliday).length, 11);
});

test('analyzeDayCells reports holiday styling as not ready when Sundays lack the marker', () => {
  const { days, holidayStylingReady } = lib.analyzeDayCells(
    augCells({ holidayStylingApplied: false })
  );
  assert.equal(holidayStylingReady, false);
  // 마커가 없어도 주말은 요일 문자로 휴일 처리되고, 공휴일만 판정이 불가능하다
  assert.equal(days.find((d) => d.day === 16).isWorkDay, false);
  assert.equal(days.find((d) => d.day === 17).isWorkDay, true);
});

test('analyzeDayCells merges duplicate cells for the same day, preferring the non work verdict', () => {
  const cells = [
    { text: '17월', className: PLAIN_CELL_CLASS, workMinutes: 0 },
    { text: '17월', className: HOLIDAY_CELL_CLASS, workMinutes: 0 },
    { text: '18화', className: PLAIN_CELL_CLASS, workMinutes: 0 },
  ];
  const { days } = lib.analyzeDayCells(cells);
  assert.equal(days.length, 2);
  assert.equal(days.find((d) => d.day === 17).isWorkDay, false);
  assert.equal(days.find((d) => d.day === 17).reason, 'holiday');
});

test('2026-08 regression: 8/5 finished (7:57) -> 17 work days left, Need 7h 59m/day', () => {
  const { days } = lib.analyzeDayCells(augCells({ workMinutesByDay: { 3: 488, 4: 494, 5: 477 } }));
  const remainingDays = lib.countRemainingWorkDays(
    toDayDates(days),
    new Date(2026, 7, 5, 20, 38),
    new Date(2026, 7, 31)
  );
  assert.equal(remainingDays, 17);
  assert.equal(lib.buildCompactMessage(135 * 60 + 41, remainingDays), 'Need 7h 59m/day (17d)');
});

test('2026-08 regression: 8/5 not worked yet -> 18 work days left, Need 7h 33m/day', () => {
  const { days } = lib.analyzeDayCells(augCells({ workMinutesByDay: { 3: 488, 4: 494 } }));
  const remainingDays = lib.countRemainingWorkDays(
    toDayDates(days),
    new Date(2026, 7, 5, 9, 0),
    new Date(2026, 7, 31)
  );
  assert.equal(remainingDays, 18);
  assert.equal(lib.buildCompactMessage(135 * 60 + 41, remainingDays), 'Need 7h 33m/day (18d)');
});

test('2026-08 regression: 8/6 in progress -> today still counts, 17 work days left', () => {
  const { days } = lib.analyzeDayCells(
    augCells({ workMinutesByDay: { 3: 488, 4: 494, 5: 477 }, workingNowDay: 6 })
  );
  const remainingDays = lib.countRemainingWorkDays(
    toDayDates(days),
    new Date(2026, 7, 6, 10, 20),
    new Date(2026, 7, 31)
  );
  assert.equal(remainingDays, 17);
  assert.equal(lib.buildCompactMessage(135 * 60 + 41, remainingDays), 'Need 7h 59m/day (17d)');
});

test('2026-08 regression: 8/10-8/14 연차 (chips at 8:00) -> 12 work days, pace unchanged', () => {
  // 실제 페이지 값: 연차 5일 등록으로 실근무 24:19 -> 64:19, 잔여 필수 -135:41 -> -95:41
  const { days } = lib.analyzeDayCells(
    augCells({
      workMinutesByDay: { 3: 488, 4: 494, 5: 477, 10: 480, 11: 480, 12: 480, 13: 480, 14: 480 },
      workingNowDay: 6,
    })
  );
  assert.equal(days.find((d) => d.day === 13).reason, 'prescheduled');
  const remainingDays = lib.countRemainingWorkDays(
    toDayDates(days),
    new Date(2026, 7, 6, 10, 20),
    new Date(2026, 7, 31)
  );
  assert.equal(remainingDays, 12);
  // 연차를 넣어도 페이스는 유지되어야 한다 (잔여와 분모가 함께 줄어들기 때문)
  assert.equal(lib.buildCompactMessage(95 * 60 + 41, remainingDays), 'Need 7h 59m/day (12d)');
});

test('2026-08 regression: counting the 연차 days would understate the pace', () => {
  // 분모에서 연차를 빼지 않으면 이렇게 낙관적인 값이 나온다 (실제로 화면에 나왔던 값)
  assert.equal(lib.buildCompactMessage(95 * 60 + 41, 17), 'Need 5h 38m/day (17d)');
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
  const endDate = new Date(2026, 6, 31);
  assert.equal(lib.countRemainingWorkDays(dayInfos, today, endDate), 6);
});

test('countRemainingWorkDays ignores days before today', () => {
  const dayInfos = [
    { date: new Date(2026, 6, 20), isWorkDay: true },
    { date: new Date(2026, 6, 24), isWorkDay: true },
  ];
  const today = new Date(2026, 6, 24);
  const endDate = new Date(2026, 6, 31);
  assert.equal(lib.countRemainingWorkDays(dayInfos, today, endDate), 1);
});

test('countRemainingWorkDays returns 0 when no matching days exist', () => {
  const dayInfos = [{ date: new Date(2026, 6, 25), isWorkDay: false }];
  const today = new Date(2026, 6, 24);
  const endDate = new Date(2026, 6, 31);
  assert.equal(lib.countRemainingWorkDays(dayInfos, today, endDate), 0);
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
  assert.equal(
    lib.buildBannerMessage(0, 3),
    '이번 정산기간 필수 근무시간을 이미 채우셨습니다 🎉'
  );
});

test('buildBannerMessage builds the noDaysLeft message', () => {
  assert.equal(
    lib.buildBannerMessage(60, 0),
    '이번 정산기간 근무 가능일이 모두 지났습니다.'
  );
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
