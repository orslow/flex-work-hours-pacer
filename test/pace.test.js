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

function augCells({ holidayStylingApplied = true } = {}) {
  return AUG_2026_WEEKDAYS.map((weekday, index) => {
    const day = index + 1;
    const marked = holidayStylingApplied && AUG_2026_HOLIDAYS.has(day);
    return { text: `${day}${weekday}`, className: marked ? HOLIDAY_CELL_CLASS : PLAIN_CELL_CLASS };
  });
}

test('parseDayCell reads the day number, weekday and holiday marker from a real cell', () => {
  assert.deepEqual(lib.parseDayCell({ text: '17월', className: HOLIDAY_CELL_CLASS }), {
    day: 17,
    weekday: '월',
    markedHoliday: true,
    label: '',
    labelKind: 'none',
    isHoliday: true,
    reason: 'holiday',
  });
});

test('parseDayCell treats 토/일 as holidays even without the marker class', () => {
  assert.equal(lib.parseDayCell({ text: '15 토', className: PLAIN_CELL_CLASS }).isHoliday, true);
  assert.equal(lib.parseDayCell({ text: '16 일', className: PLAIN_CELL_CLASS }).isHoliday, true);
});

test('parseDayCell does not treat a plain weekday as a holiday', () => {
  assert.equal(lib.parseDayCell({ text: '18화', className: PLAIN_CELL_CLASS }).isHoliday, false);
});

test('parseDayCell returns null for non day cells', () => {
  assert.equal(lib.parseDayCell({ text: '7:57', className: PLAIN_CELL_CLASS }), null);
  assert.equal(lib.parseDayCell({ text: '', className: '' }), null);
});

test('analyzeDayCells marks 8/17 (substitute holiday for 광복절) as a holiday', () => {
  const { days, holidayStylingReady } = lib.analyzeDayCells(augCells());
  assert.equal(holidayStylingReady, true);
  assert.equal(days.length, 31);
  assert.equal(days.find((d) => d.day === 17).isHoliday, true);
  assert.equal(days.find((d) => d.day === 18).isHoliday, false);
  assert.equal(days.filter((d) => d.isHoliday).length, 11);
});

test('analyzeDayCells reports holiday styling as not ready when Sundays lack the marker', () => {
  const { days, holidayStylingReady } = lib.analyzeDayCells(
    augCells({ holidayStylingApplied: false })
  );
  assert.equal(holidayStylingReady, false);
  // 마커가 없어도 주말은 요일 문자로 휴일 처리되고, 공휴일만 판정이 불가능하다
  assert.equal(days.find((d) => d.day === 16).isHoliday, true);
  assert.equal(days.find((d) => d.day === 17).isHoliday, false);
});

test('classifyDayRowLabel returns none for a plain row', () => {
  assert.deepEqual(lib.classifyDayRowLabel('20목0:00'), { label: '', kind: 'none' });
  assert.deepEqual(lib.classifyDayRowLabel('5수7:57'), { label: '', kind: 'none' });
});

test('classifyDayRowLabel flags full-day leave rows', () => {
  assert.deepEqual(lib.classifyDayRowLabel('20목0:00연차'), { label: '연차', kind: 'leave' });
  assert.equal(lib.classifyDayRowLabel('21금 0:00 여름휴가').kind, 'leave');
  assert.equal(lib.classifyDayRowLabel('24월0:00특별휴무').kind, 'leave');
  assert.equal(lib.classifyDayRowLabel('25화0:00공가').kind, 'leave');
});

test('classifyDayRowLabel keeps partial leave and work-away rows as work days', () => {
  assert.deepEqual(lib.classifyDayRowLabel('20목4:00반차'), { label: '반차', kind: 'work' });
  assert.equal(lib.classifyDayRowLabel('20목4:00오전 반차').kind, 'work');
  assert.equal(lib.classifyDayRowLabel('20목8:00재택근무').kind, 'work');
  assert.equal(lib.classifyDayRowLabel('20목8:00출장').kind, 'work');
});

test('classifyDayRowLabel reports unclassified labels instead of silently guessing', () => {
  assert.deepEqual(lib.classifyDayRowLabel('20목0:00무슨항목'), {
    label: '무슨항목',
    kind: 'unknown',
  });
});

test('parseDayCell excludes a weekday with a full-day leave label', () => {
  const cell = { text: '20목', className: PLAIN_CELL_CLASS, rowText: '20목0:00연차' };
  assert.deepEqual(lib.parseDayCell(cell), {
    day: 20,
    weekday: '목',
    markedHoliday: false,
    label: '연차',
    labelKind: 'leave',
    isHoliday: true,
    reason: 'leave',
  });
});

test('parseDayCell keeps a weekday with a 반차 label as a work day', () => {
  const cell = { text: '20목', className: PLAIN_CELL_CLASS, rowText: '20목4:00반차' };
  assert.equal(lib.parseDayCell(cell).isHoliday, false);
});

test('2026-08 regression: 8/6 in progress -> today still counts, 17 work days left', () => {
  const { days } = lib.analyzeDayCells(augCells());
  const dayDates = days.map((d) => ({ date: new Date(2026, 7, d.day), isHoliday: d.isHoliday }));
  const from = lib.resolveCountStartDate(new Date(2026, 7, 6, 10, 20), 0, true);
  const remainingDays = lib.countRemainingWorkDays(dayDates, from, new Date(2026, 7, 31));
  assert.equal(remainingDays, 17);
  assert.equal(lib.buildCompactMessage(135 * 60 + 41, remainingDays), 'Need 7h 59m/day (17d)');
});

test('2026-08 regression: 8/20 연차 -> one fewer work day, Need 8h 29m/day', () => {
  const cells = augCells().map((cell, index) =>
    index + 1 === 20 ? Object.assign({}, cell, { rowText: '20목0:00연차' }) : cell
  );
  const { days, unknownLabels } = lib.analyzeDayCells(cells);
  assert.deepEqual(unknownLabels, []);
  assert.equal(days.find((d) => d.day === 20).reason, 'leave');
  const dayDates = days.map((d) => ({ date: new Date(2026, 7, d.day), isHoliday: d.isHoliday }));
  const from = lib.resolveCountStartDate(new Date(2026, 7, 5, 20, 38), 7 * 60 + 57);
  const remainingDays = lib.countRemainingWorkDays(dayDates, from, new Date(2026, 7, 31));
  assert.equal(remainingDays, 16);
  assert.equal(lib.buildCompactMessage(135 * 60 + 41, remainingDays), 'Need 8h 29m/day (16d)');
});

test('analyzeDayCells collects unknown labels for the console warning', () => {
  const cells = augCells().map((cell, index) =>
    index + 1 === 20 ? Object.assign({}, cell, { rowText: '20목0:00알수없는항목' }) : cell
  );
  const { days, unknownLabels } = lib.analyzeDayCells(cells);
  assert.deepEqual(unknownLabels, ['20(알수없는항목)']);
  // 분류 못 한 라벨은 근무일로 유지
  assert.equal(days.find((d) => d.day === 20).isHoliday, false);
});

test('analyzeDayCells merges duplicate cells for the same day, preferring the holiday verdict', () => {
  const cells = [
    { text: '17월', className: PLAIN_CELL_CLASS },
    { text: '17월', className: HOLIDAY_CELL_CLASS },
    { text: '18화', className: PLAIN_CELL_CLASS },
  ];
  const { days } = lib.analyzeDayCells(cells);
  assert.equal(days.length, 2);
  assert.equal(days.find((d) => d.day === 17).isHoliday, true);
});

test('resolveCountStartDate skips today when today already has recorded work time', () => {
  const from = lib.resolveCountStartDate(new Date(2026, 7, 5, 20, 38), 7 * 60 + 57);
  assert.equal(from.getDate(), 6);
  assert.equal(from.getMonth(), 7);
});

test('resolveCountStartDate keeps today when no work time is recorded yet', () => {
  assert.equal(lib.resolveCountStartDate(new Date(2026, 7, 5, 9, 0), 0).getDate(), 5);
  assert.equal(lib.resolveCountStartDate(new Date(2026, 7, 5, 9, 0), null).getDate(), 5);
});

test('resolveCountStartDate keeps today while work is in progress, even with recorded time', () => {
  assert.equal(lib.resolveCountStartDate(new Date(2026, 7, 6, 10, 20), 0, true).getDate(), 6);
  assert.equal(lib.resolveCountStartDate(new Date(2026, 7, 6, 15, 0), 300, true).getDate(), 6);
});

test('resolveTodayDayNumber returns the day number when the calendar shows this month', () => {
  assert.equal(lib.resolveTodayDayNumber(new Date(2026, 7, 1), new Date(2026, 7, 6, 9, 55)), 6);
});

test('resolveTodayDayNumber returns null when the calendar shows another month', () => {
  assert.equal(lib.resolveTodayDayNumber(new Date(2026, 6, 1), new Date(2026, 7, 6)), null);
  assert.equal(lib.resolveTodayDayNumber(new Date(2025, 7, 1), new Date(2026, 7, 6)), null);
});

test('resolveCountStartDate rolls into the next month on the last day', () => {
  const from = lib.resolveCountStartDate(new Date(2026, 7, 31, 20, 0), 480);
  assert.equal(from.getMonth(), 8);
  assert.equal(from.getDate(), 1);
});

test('2026-08 regression: today already worked -> 17 work days left, Need 7h 59m/day', () => {
  const { days } = lib.analyzeDayCells(augCells());
  const dayDates = days.map((d) => ({ date: new Date(2026, 7, d.day), isHoliday: d.isHoliday }));
  const from = lib.resolveCountStartDate(new Date(2026, 7, 5, 20, 38), 7 * 60 + 57);
  const remainingDays = lib.countRemainingWorkDays(dayDates, from, new Date(2026, 7, 31));
  assert.equal(remainingDays, 17);
  assert.equal(lib.buildCompactMessage(135 * 60 + 41, remainingDays), 'Need 7h 59m/day (17d)');
});

test('2026-08 regression: today not worked yet -> 18 work days left, Need 7h 33m/day', () => {
  const { days } = lib.analyzeDayCells(augCells());
  const dayDates = days.map((d) => ({ date: new Date(2026, 7, d.day), isHoliday: d.isHoliday }));
  const from = lib.resolveCountStartDate(new Date(2026, 7, 5, 9, 0), 0);
  const remainingDays = lib.countRemainingWorkDays(dayDates, from, new Date(2026, 7, 31));
  assert.equal(remainingDays, 18);
  assert.equal(lib.buildCompactMessage(135 * 60 + 41, remainingDays), 'Need 7h 33m/day (18d)');
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

test('countRemainingWorkDays counts non-holiday days from today through endDate inclusive', () => {
  const dayInfos = [
    { date: new Date(2026, 6, 24), isHoliday: false },
    { date: new Date(2026, 6, 25), isHoliday: true },
    { date: new Date(2026, 6, 26), isHoliday: true },
    { date: new Date(2026, 6, 27), isHoliday: false },
    { date: new Date(2026, 6, 28), isHoliday: false },
    { date: new Date(2026, 6, 29), isHoliday: false },
    { date: new Date(2026, 6, 30), isHoliday: false },
    { date: new Date(2026, 6, 31), isHoliday: false },
  ];
  const today = new Date(2026, 6, 24, 9, 0, 0);
  const endDate = new Date(2026, 6, 31);
  assert.equal(lib.countRemainingWorkDays(dayInfos, today, endDate), 6);
});

test('countRemainingWorkDays ignores days before today', () => {
  const dayInfos = [
    { date: new Date(2026, 6, 20), isHoliday: false },
    { date: new Date(2026, 6, 24), isHoliday: false },
  ];
  const today = new Date(2026, 6, 24);
  const endDate = new Date(2026, 6, 31);
  assert.equal(lib.countRemainingWorkDays(dayInfos, today, endDate), 1);
});

test('countRemainingWorkDays returns 0 when no matching days exist', () => {
  const dayInfos = [{ date: new Date(2026, 6, 25), isHoliday: true }];
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
