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
  assert.deepEqual(s, {
    workMinutes: 540,
    timeOffMinutes: 0,
    hasOpenWorkBlock: false,
    hasClosedWorkBlock: true,
    hasUnmeasuredAllDayTimeOff: false,
  });
});

test('summarizeSchedule flags a work block without an end timestamp as in progress', () => {
  const s = lib.summarizeSchedule(fx.schedule('2026-09-10', [fx.openWorkBlock('2026-09-10', 9)]));
  assert.equal(s.hasOpenWorkBlock, true);
  assert.equal(s.workMinutes, 0);
});

test('summarizeSchedule reads used minutes from a time-off block', () => {
  const s = lib.summarizeSchedule(fx.schedule('2026-09-21', [fx.timeOffBlock()]));
  assert.deepEqual(s, {
    workMinutes: 0,
    timeOffMinutes: 480,
    hasOpenWorkBlock: false,
    hasClosedWorkBlock: false,
    hasUnmeasuredAllDayTimeOff: false,
  });
});

test('summarizeSchedule marks a partial time-off block as not all day', () => {
  const s = lib.summarizeSchedule(fx.schedule('2026-09-21', [fx.timeOffBlock(180, false)]));
  assert.deepEqual(s, {
    workMinutes: 0,
    timeOffMinutes: 180,
    hasOpenWorkBlock: false,
    hasClosedWorkBlock: false,
    hasUnmeasuredAllDayTimeOff: false,
  });
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

// 하루 일부만 쓴 휴가(반차/시차)를 하루 통째로 쉬는 것처럼 빼면 분모가 과하게 줄어
// 하루 필요시간이 실제보다 크게 나온다. 그 날도 남은 시간만큼은 일해야 하므로 근무일로 센다.
function withSchedule(isoDate, timeBlocks) {
  return {
    workingDayAttributes: SEP_2026.workingDayAttributes,
    dailySchedules: SEP_2026.dailySchedules.map((s) =>
      s.date === isoDate ? fx.schedule(isoDate, timeBlocks) : s
    ),
  };
}

test('a future 시차 keeps the day in the count', () => {
  // 오후 3시부터 3시간 시차를 미리 등록해둔 날. 남은 5시간은 여전히 일해야 한다
  const days = lib.buildDaysFromApi(withSchedule('2026-09-11', [fx.timeOffBlock(180, false)]));
  const day = dayFor(days, '2026-09-11');
  assert.equal(day.isWorkDay, true);
  assert.equal(day.reason, null);
  assert.equal(day.recognizedMinutes, 180);
  assert.equal(lib.countRemainingWorkDays(days, new Date(2026, 8, 10, 10, 0), END_OF_PERIOD), 12);
});

test('a future 반차 keeps the day in the count', () => {
  const days = lib.buildDaysFromApi(withSchedule('2026-09-11', [fx.timeOffBlock(240, false)]));
  assert.equal(dayFor(days, '2026-09-11').isWorkDay, true);
  assert.equal(lib.countRemainingWorkDays(days, new Date(2026, 8, 10, 10, 0), END_OF_PERIOD), 12);
});

test('a 시차 day drops out once work is clocked on it', () => {
  // 시차 3시간 + 실근무 4시간 = 7시간으로 소정근로에는 못 미치지만, 퇴근했으므로 그 날은 끝났다
  const days = lib.buildDaysFromApi(
    withSchedule('2026-09-11', [fx.timeOffBlock(180, false), fx.workBlock('2026-09-11', 10, 14)])
  );
  const day = dayFor(days, '2026-09-11');
  assert.equal(day.reason, 'WORKED');
  assert.equal(day.recognizedMinutes, 420);
  assert.equal(lib.countRemainingWorkDays(days, new Date(2026, 8, 10, 10, 0), END_OF_PERIOD), 11);
});

test('time off that covers the whole usual working time is excluded even without the allDay flag', () => {
  const days = lib.buildDaysFromApi(withSchedule('2026-09-11', [fx.timeOffBlock(480, false)]));
  assert.equal(dayFor(days, '2026-09-11').reason, 'TIME_OFF');
  assert.equal(lib.countRemainingWorkDays(days, new Date(2026, 8, 10, 10, 0), END_OF_PERIOD), 11);
});

test('isFullDayTimeOff compares used minutes against that day usual working minutes', () => {
  const partial = { timeOffMinutes: 240, hasAllDayTimeOff: false };
  assert.equal(lib.isFullDayTimeOff(partial, 480), false);
  // 단축근무처럼 소정근로가 4시간인 날에는 같은 4시간이 종일 휴가다
  assert.equal(lib.isFullDayTimeOff(partial, 240), true);
});

test('isFullDayTimeOff judges by used minutes, not by the allDay flag', () => {
  // flex가 시차 블록에도 allDay를 붙여 보내더라도 3시간은 종일이 아니다.
  // 이 둘의 우선순위가 뒤집히면 시차가 다시 하루 통째로 빠지면서도 다른 테스트는 다 통과한다
  assert.equal(lib.isFullDayTimeOff({ timeOffMinutes: 180 }, 480), false);
  assert.equal(lib.isFullDayTimeOff({ timeOffMinutes: 480 }, 480), true);
  assert.equal(lib.isFullDayTimeOff({ timeOffMinutes: 0 }, 480), false);
});

test('isFullDayTimeOff excludes an all-day block whose used minutes could not be read', () => {
  // 3시간 시차 + usedMinutes가 빠진 종일 블록. 합계 180분만 보면 근무일로 세어버린다
  const summary = { timeOffMinutes: 180, hasUnmeasuredAllDayTimeOff: true };
  assert.equal(lib.isFullDayTimeOff(summary, 480), true);
});

test('summarizeSchedule keeps an unreadable all-day time-off block out of the minute total', () => {
  const block = fx.timeOffBlock(180, false);
  const broken = { type: 'CUSTOM_TIME_OFF', value: { allDay: true } };
  const s = lib.summarizeSchedule(fx.schedule('2026-09-11', [block, broken]));
  assert.equal(s.timeOffMinutes, 180);
  assert.equal(s.hasUnmeasuredAllDayTimeOff, true);
});

test('a 시차 day stays in the count even if flex marks the block allDay', () => {
  const block = fx.timeOffBlock(180, true);
  const days = lib.buildDaysFromApi(withSchedule('2026-09-11', [block]));
  assert.equal(dayFor(days, '2026-09-11').isWorkDay, true);
  assert.equal(lib.countRemainingWorkDays(days, new Date(2026, 8, 10, 10, 0), END_OF_PERIOD), 12);
});

test('a 시차 day drops out even when rest cancels out the work minutes', () => {
  // 오전 시차 뒤 13~14시 근무 + 60분 휴게 -> 합계 0분이지만 이미 퇴근한 날이다
  const days = lib.buildDaysFromApi(
    withSchedule('2026-09-11', [
      fx.timeOffBlock(180, false),
      fx.workBlock('2026-09-11', 13, 14),
      fx.restBlock('2026-09-11', 13, 60),
    ])
  );
  const day = dayFor(days, '2026-09-11');
  assert.equal(day.reason, 'WORKED');
  assert.equal(day.recognizedMinutes, 180);
  assert.equal(lib.countRemainingWorkDays(days, new Date(2026, 8, 10, 10, 0), END_OF_PERIOD), 11);
});
