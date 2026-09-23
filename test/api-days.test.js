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

// flex는 휴가를 인정근무로 치므로 requiredWorkingMinutes(분자)에서 그 시간을 이미 빼서 내려준다.
// 그런데 시차/반차 날은 온전한 하루로 분모에 남으므로, 분모에 남은 날의 휴가만 분자에 도로 더해야
// 하루 필요량이 모든 날에 같은 "인정근무 기준" 값으로 나온다.
function withSchedules(byDate) {
  return {
    workingDayAttributes: SEP_2026.workingDayAttributes,
    dailySchedules: SEP_2026.dailySchedules.map((s) =>
      byDate[s.date] ? fx.schedule(s.date, byDate[s.date]) : s
    ),
  };
}

test('sumRemainingLeaveMinutes adds back a 시차 on a day that stays in the count', () => {
  const days = lib.buildDaysFromApi(withSchedule('2026-09-11', [fx.timeOffBlock(180, false)]));
  const from = new Date(2026, 8, 10, 10, 0);
  assert.equal(dayFor(days, '2026-09-11').isWorkDay, true);
  assert.equal(lib.sumRemainingLeaveMinutes(days, from, END_OF_PERIOD), 180);
});

test('sumRemainingLeaveMinutes adds back a 반차 on a day that stays in the count', () => {
  const days = lib.buildDaysFromApi(withSchedule('2026-09-11', [fx.timeOffBlock(240, false)]));
  assert.equal(
    lib.sumRemainingLeaveMinutes(days, new Date(2026, 8, 10, 10, 0), END_OF_PERIOD),
    240
  );
});

test('sumRemainingLeaveMinutes sums every remaining partial-leave day', () => {
  // 한 건만 찾고 멈추는 구현이면 여기서 걸림
  const days = lib.buildDaysFromApi(
    withSchedules({
      '2026-09-11': [fx.timeOffBlock(180, false)],
      '2026-09-17': [fx.timeOffBlock(240, false)],
    })
  );
  assert.equal(
    lib.sumRemainingLeaveMinutes(days, new Date(2026, 8, 10, 10, 0), END_OF_PERIOD),
    420
  );
});

test('sumRemainingLeaveMinutes skips a full-day 연차 because it left the count', () => {
  // SEP_2026의 9/21~22는 종일 연차(480분). 분모에서 빠졌으니 분자에도 더하면 안 됨
  const days = lib.buildDaysFromApi(SEP_2026);
  assert.equal(dayFor(days, '2026-09-21').reason, 'TIME_OFF');
  assert.equal(dayFor(days, '2026-09-21').timeOffMinutes, 480);
  assert.equal(lib.sumRemainingLeaveMinutes(days, new Date(2026, 8, 10, 10, 0), END_OF_PERIOD), 0);
});

test('sumRemainingLeaveMinutes skips a partial-leave day that is already clocked out', () => {
  // 시차 3시간 + 실근무 4시간 후 퇴근. 그 날 휴가는 이미 정산돼 분모에서 빠졌으므로 도로 더하면 이중 계산
  const days = lib.buildDaysFromApi(
    withSchedule('2026-09-11', [fx.timeOffBlock(180, false), fx.workBlock('2026-09-11', 10, 14)])
  );
  assert.equal(dayFor(days, '2026-09-11').reason, 'WORKED');
  assert.equal(dayFor(days, '2026-09-11').timeOffMinutes, 180);
  assert.equal(lib.sumRemainingLeaveMinutes(days, new Date(2026, 8, 10, 10, 0), END_OF_PERIOD), 0);
});

test('sumRemainingLeaveMinutes adds back a 시차 on a day that is still in progress', () => {
  // 오전 시차 뒤 출근해 아직 근무 중. 하루가 분모에 남으므로 휴가도 도로 더해짐
  const days = lib.buildDaysFromApi(
    withSchedule('2026-09-10', [fx.timeOffBlock(120, false), fx.openWorkBlock('2026-09-10', 11)])
  );
  const day = dayFor(days, '2026-09-10');
  assert.equal(day.inProgress, true);
  assert.equal(day.isWorkDay, true);
  assert.equal(lib.sumRemainingLeaveMinutes(days, new Date(2026, 8, 10, 12, 0), END_OF_PERIOD), 120);
});

test('sumRemainingLeaveMinutes skips a partial-leave day before today', () => {
  // 9/8에 시차만 등록된 상태(근무 기록 없음). 근무일 판정은 통과하지만 fromDate 이전이라 제외됨
  const days = lib.buildDaysFromApi(withSchedule('2026-09-08', [fx.timeOffBlock(180, false)]));
  assert.equal(dayFor(days, '2026-09-08').isWorkDay, true);
  assert.equal(lib.sumRemainingLeaveMinutes(days, new Date(2026, 8, 10, 10, 0), END_OF_PERIOD), 0);
});

test('sumRemainingLeaveMinutes skips a partial-leave day past the period end', () => {
  const days = lib.buildDaysFromApi(withSchedule('2026-09-23', [fx.timeOffBlock(120, false)]));
  const from = new Date(2026, 8, 10, 10, 0);
  // 정산기간이 9/18에 끝나면 9/23 시차는 다음 기간 몫임
  assert.equal(lib.sumRemainingLeaveMinutes(days, from, new Date(2026, 8, 18)), 0);
  assert.equal(lib.sumRemainingLeaveMinutes(days, from, END_OF_PERIOD), 120);
});

test('sumRemainingLeaveMinutes skips leave registered on a weekend or public holiday', () => {
  // 주말/공휴일은 소정근로가 0이라 분모에 없음. 그 날 붙은 휴가 블록도 분자 보정 대상이 아님
  const days = lib.buildDaysFromApi(
    withSchedules({
      '2026-09-12': [fx.timeOffBlock(180, false)],
      '2026-09-16': [fx.timeOffBlock(240, false)],
    })
  );
  assert.equal(dayFor(days, '2026-09-12').reason, 'REST_DAY');
  assert.equal(dayFor(days, '2026-09-16').reason, 'CUSTOM_HOLIDAY');
  assert.equal(lib.sumRemainingLeaveMinutes(days, new Date(2026, 8, 10, 10, 0), END_OF_PERIOD), 0);
});

test('resolveRemaining returns the numerator and denominator from the same predicate', () => {
  const days = lib.buildDaysFromApi(withSchedule('2026-09-11', [fx.timeOffBlock(180, false)]));
  const from = new Date(2026, 8, 10, 10, 0);
  const resolved = lib.resolveRemaining(5000, days, from, END_OF_PERIOD);
  assert.deepEqual(shapeOf(resolved), {
    requiredRemainingMinutes: 5000,
    remainingWorkDays: 12,
    leaveAddBackMinutes: 180,
    coveredDates: [],
    remainingMinutes: 5180,
    remainingDays: 12,
  });
  assert.equal(resolved.remainingWorkDays, lib.countRemainingWorkDays(days, from, END_OF_PERIOD));
  // 빠진 날이 없을 때만 되돌려더한 양이 남은 근무일 휴가 합과 같음
  assert.equal(resolved.leaveAddBackMinutes, lib.sumRemainingLeaveMinutes(days, from, END_OF_PERIOD));
});

test('resolveRemaining leaves the numerator alone when nothing is added back', () => {
  const days = lib.buildDaysFromApi(SEP_2026);
  const resolved = lib.resolveRemaining(5000, days, new Date(2026, 8, 10, 10, 0), END_OF_PERIOD);
  assert.equal(resolved.leaveAddBackMinutes, 0);
  assert.equal(resolved.remainingMinutes, 5000);
});

test('resolveRemaining reproduces the 2026-09-23 case: 1291m + 120m 시차 over 3 days', () => {
  // 실제 응답 기준: requiredWorkingMinutes 1291분, 9/23에 2시간 시차, 남은 근무일 3일.
  // 시차 120분을 도로 더해야 하루 필요량이 모든 날에 같은 471분(7h 51m)으로 맞음
  const days = lib.buildDaysFromApi(withSchedule('2026-09-23', [fx.timeOffBlock(120, false)]));
  const from = new Date(2026, 8, 23, 10, 0);
  const resolved = lib.resolveRemaining(1291, days, from, new Date(2026, 8, 25));
  assert.deepEqual(shapeOf(resolved), {
    requiredRemainingMinutes: 1291,
    remainingWorkDays: 3,
    leaveAddBackMinutes: 120,
    coveredDates: [],
    remainingMinutes: 1411,
    remainingDays: 3,
  });
  assert.equal(
    lib.buildCompactMessage(resolved.remainingMinutes, resolved.remainingDays),
    'Need 7h 51m/day (3d)'
  );
});

test('the 시차 day already has the add-back banked, so the pace is uniform across days', () => {
  // 보정 없이 1291/3이면 431분/일. 시차 날은 120분이 이미 인정돼 311분만 더 하면 되므로
  // 나머지 두 날이 431분씩 다 채워도 합이 1173분에 그쳐 잔여 1291분에 모자람.
  // 보정 후 471분 기준이면 시차 날 351분 + 나머지 두 날 471분씩 = 1293분으로 잔여를 덮는다
  const days = lib.buildDaysFromApi(withSchedule('2026-09-23', [fx.timeOffBlock(120, false)]));
  const resolved = lib.resolveRemaining(1291, days, new Date(2026, 8, 23, 10, 0), new Date(2026, 8, 25));
  const daily = lib.computePace(resolved.remainingMinutes, resolved.remainingDays).dailyMinutes;
  assert.equal(daily, 471);
  // 한쪽 부등호만 보면 daily가 부풀어도 통과하므로 위아래를 다 막는다.
  // 위쪽 여유는 computePace의 ceil 때문이고 살아남은 날마다 1분 미만임
  const implied = daily - 120 + daily * 2;
  assert.equal(implied, 1293);
  assert.ok(implied >= 1291, `implied ${implied} < required 1291`);
  assert.ok(
    implied <= 1291 + resolved.remainingDays,
    `implied ${implied} > required 1291 + ${resolved.remainingDays}`
  );
});

// 되돌려더한 분자를 그냥 날수로 나누면 휴가가 하루 필요량을 넘는 날에서 음수 근무를 가정하게 된다.
// 실제로 그 날 더 일할 시간은 max(0, N - 그 날 휴가)이므로, 그 합이 잔여 필수와 같아지는 N이 맞다.
// 아래 두 헬퍼는 구현 내부 목록을 안 쓰고 dayInfo에서 직접 뽑아 이 항등식을 독립적으로 검증함.
const SEP_10 = new Date(2026, 8, 10, 10, 0);
const SEP_11 = new Date(2026, 8, 11);

function remainingLeaves(days, fromDate, endDate) {
  const from = lib.stripTime(fromDate).getTime();
  const end = lib.stripTime(endDate).getTime();
  return days
    .filter((d) => {
      const t = lib.stripTime(d.date).getTime();
      return d.isWorkDay && t >= from && t <= end;
    })
    .map((d) => d.timeOffMinutes || 0);
}

// 남은 근무일 전체에 대해 sum(max(0, N - 휴가)) == 잔여 필수. 잔여가 양수일 때만 성립하는 성질임
// coveredDays에는 dayInfo가 통째로 들어오므로 값 비교용으로 날짜만 뽑음
function shapeOf(resolved) {
  return {
    requiredRemainingMinutes: resolved.requiredRemainingMinutes,
    remainingWorkDays: resolved.remainingWorkDays,
    leaveAddBackMinutes: resolved.leaveAddBackMinutes,
    coveredDates: resolved.coveredDays.map((d) => d.isoDate),
    remainingMinutes: resolved.remainingMinutes,
    remainingDays: resolved.remainingDays,
  };
}

function impliedWork(days, fromDate, endDate, resolved) {
  const daily = resolved.remainingMinutes / resolved.remainingDays;
  return remainingLeaves(days, fromDate, endDate).reduce(
    (sum, leave) => sum + Math.max(0, daily - leave),
    0
  );
}

test('resolveRemaining drops a day whose leave exceeds the daily target', () => {
  // 잔여 2시간, 남은 이틀 중 하루가 반차 4시간. 2h20m/day가 아니라 반차 날은 빼고 2h/day가 맞다
  const days = lib.buildDaysFromApi(withSchedule('2026-09-11', [fx.timeOffBlock(240, false)]));
  const resolved = lib.resolveRemaining(120, days, SEP_10, SEP_11);
  assert.deepEqual(shapeOf(resolved), {
    requiredRemainingMinutes: 120,
    remainingWorkDays: 2,
    // 반차 날이 풀에서 빠지면서 그 240분은 분자에 더해지지 않음
    leaveAddBackMinutes: 0,
    coveredDates: ['2026-09-11'],
    remainingMinutes: 120,
    remainingDays: 1,
  });
  assert.equal(lib.buildCompactMessage(resolved.remainingMinutes, resolved.remainingDays), 'Need 2h/day (1d)');
});

test('resolveRemaining keeps remainingWorkDays at the full count when a day drops out', () => {
  // 콘솔 로그가 workDays=1/2로 둘 다 찍으므로 조용히 같은 값으로 수렴하면 안 됨
  const days = lib.buildDaysFromApi(withSchedule('2026-09-11', [fx.timeOffBlock(240, false)]));
  const resolved = lib.resolveRemaining(120, days, SEP_10, SEP_11);
  assert.equal(resolved.remainingWorkDays, 2);
  assert.equal(resolved.remainingDays, 1);
  assert.equal(resolved.remainingWorkDays, lib.countRemainingWorkDays(days, SEP_10, SEP_11));
  // 되돌려더한 양은 후보 휴가 합의 상한 안에 있다. 빠진 날이 있으면 그보다 작음
  assert.equal(lib.sumRemainingLeaveMinutes(days, SEP_10, SEP_11), 240);
  assert.equal(resolved.leaveAddBackMinutes, 0);
  assert.equal(resolved.coveredDays.length, resolved.remainingWorkDays - resolved.remainingDays);
});

test('resolveRemaining reports done from the raw required minutes, not the adjusted one', () => {
  // 이미 목표를 넘긴 사람이 반차를 앞으로 등록해두면, 되돌려더한 값으로 판정할 때
  // -60 + 240 = 180분이 남은 것처럼 보여 "Goal met"이 "더 일해야 함"으로 뒤집혔다
  const days = lib.buildDaysFromApi(withSchedule('2026-09-11', [fx.timeOffBlock(240, false)]));
  const resolved = lib.resolveRemaining(-60, days, SEP_10, SEP_11);
  assert.equal(resolved.remainingMinutes, -60);
  assert.equal(resolved.remainingDays, 2);
  // 잔여가 양수가 아니면 물채우기 자체를 안 하므로 보정도 없음
  assert.equal(resolved.leaveAddBackMinutes, 0);
  assert.deepEqual(resolved.coveredDays, []);
  assert.equal(lib.buildCompactMessage(resolved.remainingMinutes, resolved.remainingDays), 'Goal met 🎉');
});

test('resolveRemaining reports done at exactly the goal even with leave booked ahead', () => {
  const days = lib.buildDaysFromApi(withSchedule('2026-09-11', [fx.timeOffBlock(240, false)]));
  const resolved = lib.resolveRemaining(0, days, SEP_10, SEP_11);
  assert.equal(resolved.remainingMinutes, 0);
  assert.equal(lib.buildCompactMessage(resolved.remainingMinutes, resolved.remainingDays), 'Goal met 🎉');
});

test('resolveRemaining keeps every day when all of them are partly on leave', () => {
  // 이틀 다 반차 4시간, 잔여 1시간 -> 하루 4시간 30분씩이면 각 날 30분씩 더 일해 합이 1시간
  const days = lib.buildDaysFromApi(
    withSchedules({
      '2026-09-10': [fx.timeOffBlock(240, false)],
      '2026-09-11': [fx.timeOffBlock(240, false)],
    })
  );
  const resolved = lib.resolveRemaining(60, days, SEP_10, SEP_11);
  assert.deepEqual(shapeOf(resolved), {
    requiredRemainingMinutes: 60,
    remainingWorkDays: 2,
    leaveAddBackMinutes: 480,
    coveredDates: [],
    remainingMinutes: 540,
    remainingDays: 2,
  });
  assert.equal(lib.buildCompactMessage(resolved.remainingMinutes, resolved.remainingDays), 'Need 4h 30m/day (2d)');
});

// 물채우기 결과를 검증할 사례 묶음. 두 항등식 테스트가 같은 목록을 씀
const FILL_CASES = [
    {
      label: 'real 2026-09-23: 1291m with a 120m 시차',
      days: lib.buildDaysFromApi(withSchedule('2026-09-23', [fx.timeOffBlock(120, false)])),
      from: new Date(2026, 8, 23, 10, 0),
      end: new Date(2026, 8, 25),
      required: 1291,
    },
    {
      label: 'leave exceeds the daily target',
      days: lib.buildDaysFromApi(withSchedule('2026-09-11', [fx.timeOffBlock(240, false)])),
      from: SEP_10,
      end: SEP_11,
      required: 120,
    },
    {
      label: 'every remaining day partly on leave',
      days: lib.buildDaysFromApi(
        withSchedules({
          '2026-09-10': [fx.timeOffBlock(240, false)],
          '2026-09-11': [fx.timeOffBlock(240, false)],
        })
      ),
      from: SEP_10,
      end: SEP_11,
      required: 60,
    },
    {
      label: 'no leave anywhere',
      days: lib.buildDaysFromApi(SEP_2026),
      from: SEP_10,
      end: END_OF_PERIOD,
      required: 5000,
    },
    {
      label: 'chained drop over two rounds',
      days: lib.buildDaysFromApi(
        withSchedules({
          '2026-09-10': [fx.timeOffBlock(240, false)],
          '2026-09-11': [fx.timeOffBlock(120, false)],
        })
      ),
      from: SEP_10,
      end: new Date(2026, 8, 14),
      required: 60,
    },
    {
      label: 'leave exactly equal to the daily target',
      days: lib.buildDaysFromApi(withSchedule('2026-09-11', [fx.timeOffBlock(240, false)])),
      from: SEP_10,
      end: SEP_11,
      required: 240,
    },
  ];

test('resolveRemaining reconciles: implied work across every remaining day equals the required minutes', () => {
  // 설계 전체가 기대는 항등식. 구버전(잔여 + 휴가합) / 날수는 반차가 N을 넘는 순간 여기서 깨진다
  for (const c of FILL_CASES) {
    const resolved = lib.resolveRemaining(c.required, c.days, c.from, c.end);
    const implied = impliedWork(c.days, c.from, c.end, resolved);
    assert.ok(
      Math.abs(implied - c.required) < 1e-9,
      `${c.label}: implied ${implied} != required ${c.required}`
    );
  }
});

test('resolveRemaining reconciles within ceil slack at the rate the badge actually shows', () => {
  // 배지는 N이 아니라 ceil(N)을 보여주므로 그 값으로 일하면 잔여보다 조금 더 채우게 된다.
  // 초과분은 살아남은 날마다 1분 미만이라 남은 근무일수를 넘지 않음.
  // 빠진 날은 휴가 >= N이고 분 단위가 정수라 휴가 >= ceil(N)이므로 여기 기여가 0임
  for (const c of FILL_CASES) {
    const resolved = lib.resolveRemaining(c.required, c.days, c.from, c.end);
    const daily = lib.computePace(resolved.remainingMinutes, resolved.remainingDays).dailyMinutes;
    const implied = remainingLeaves(c.days, c.from, c.end).reduce(
      (sum, leave) => sum + Math.max(0, daily - leave),
      0
    );
    assert.ok(implied >= c.required, `${c.label}: implied ${implied} < required ${c.required}`);
    assert.ok(
      implied <= c.required + resolved.remainingDays,
      `${c.label}: implied ${implied} > required ${c.required} + ${resolved.remainingDays}`
    );
  }
});

test('resolveRemaining never implies negative work on a day that drops out', () => {
  const days = lib.buildDaysFromApi(withSchedule('2026-09-11', [fx.timeOffBlock(240, false)]));
  const resolved = lib.resolveRemaining(120, days, SEP_10, SEP_11);
  const daily = resolved.remainingMinutes / resolved.remainingDays;
  // 빠진 날의 휴가 240분이 하루 필요량 120분보다 크다 = 그 날은 더 일할 게 없음
  assert.equal(daily, 120);
  assert.ok(remainingLeaves(days, SEP_10, SEP_11).some((leave) => leave > daily));
});

test('resolveRemaining returns exactly the documented field set', () => {
  // 필드가 늘거나 이름이 바뀌면 shapeOf가 조용히 무시하므로 여기서 한 번 고정함
  const days = lib.buildDaysFromApi(SEP_2026);
  const resolved = lib.resolveRemaining(5000, days, SEP_10, END_OF_PERIOD);
  assert.deepEqual(Object.keys(resolved).sort(), [
    'coveredDays',
    'leaveAddBackMinutes',
    'remainingDays',
    'remainingMinutes',
    'remainingWorkDays',
    'requiredRemainingMinutes',
  ]);
});

test('resolveRemaining names the days it dropped in coveredDays', () => {
  // 배지 숫자만 보면 왜 날수가 줄었는지 알 수 없으므로 빠진 날을 그대로 실어 보냄
  const days = lib.buildDaysFromApi(withSchedule('2026-09-11', [fx.timeOffBlock(240, false)]));
  const resolved = lib.resolveRemaining(120, days, SEP_10, SEP_11);
  assert.deepEqual(resolved.coveredDays.map((d) => d.isoDate), ['2026-09-11']);
  assert.equal(resolved.coveredDays[0].timeOffMinutes, 240);
});

test('resolveRemaining drops a day whose leave exactly equals the daily target', () => {
  // 잔여 2시간, 남은 이틀 중 하루가 정확히 2시간 시차. 그 날은 더 일할 게 0분이라 풀에서 빠진다.
  // 실수 나눗셈으로 비교하면 흔들리는 경계라 구현이 정수식으로 비교함
  const days = lib.buildDaysFromApi(withSchedule('2026-09-11', [fx.timeOffBlock(120, false)]));
  const resolved = lib.resolveRemaining(120, days, SEP_10, SEP_11);
  assert.deepEqual(shapeOf(resolved), {
    requiredRemainingMinutes: 120,
    remainingWorkDays: 2,
    leaveAddBackMinutes: 0,
    coveredDates: ['2026-09-11'],
    remainingMinutes: 120,
    remainingDays: 1,
  });
  // 어느 쪽으로 갈라져도 하루 필요량 자체는 120분으로 같다. 달라지는 건 괄호 안 날수뿐
  assert.equal(lib.buildCompactMessage(resolved.remainingMinutes, resolved.remainingDays), 'Need 2h/day (1d)');
  assert.equal(impliedWork(days, SEP_10, SEP_11, resolved), 120);
});

test('resolveRemaining drops days one round at a time until the pool is stable', () => {
  // 한 번 빼면 N이 내려가 남은 날이 또 걸릴 수 있다. 240/120 두 날이 연쇄로 빠져야 함.
  // 1회차 N=(60+360)/3=140 -> 240만 탈락, 2회차 N=(60+120)/2=90 -> 120도 탈락, 3회차 N=60
  const days = lib.buildDaysFromApi(
    withSchedules({
      '2026-09-10': [fx.timeOffBlock(240, false)],
      '2026-09-11': [fx.timeOffBlock(120, false)],
    })
  );
  const end = new Date(2026, 8, 14);
  const resolved = lib.resolveRemaining(60, days, SEP_10, end);
  assert.deepEqual(shapeOf(resolved), {
    requiredRemainingMinutes: 60,
    remainingWorkDays: 3,
    leaveAddBackMinutes: 0,
    coveredDates: ['2026-09-10', '2026-09-11'],
    remainingMinutes: 60,
    remainingDays: 1,
  });
  assert.equal(lib.buildCompactMessage(resolved.remainingMinutes, resolved.remainingDays), 'Need 1h/day (1d)');
  assert.equal(impliedWork(days, SEP_10, end, resolved), 60);
});

test('a day whose leave equals the daily target on the first pass is dropped', () => {
  // 잔여 4시간, 남은 이틀 중 하루가 반차 4시간 -> 첫 회차 N이 정확히 240분.
  // 비교가 `<`라 그 날은 빠지고, 남은 하루에 4시간이 그대로 몰린다
  const days = lib.buildDaysFromApi(withSchedule('2026-09-11', [fx.timeOffBlock(240, false)]));
  const resolved = lib.resolveRemaining(240, days, SEP_10, SEP_11);
  assert.deepEqual(shapeOf(resolved), {
    requiredRemainingMinutes: 240,
    remainingWorkDays: 2,
    leaveAddBackMinutes: 0,
    coveredDates: ['2026-09-11'],
    remainingMinutes: 240,
    remainingDays: 1,
  });
  assert.equal(lib.buildCompactMessage(resolved.remainingMinutes, resolved.remainingDays), 'Need 4h/day (1d)');
  assert.equal(impliedWork(days, SEP_10, SEP_11, resolved), 240);
});

test('leaveAddBackMinutes and sumRemainingLeaveMinutes deliberately differ once a day is dropped', () => {
  // sumRemainingLeaveMinutes는 남은 근무일 전체의 휴가 합(되돌려더할 후보)이고,
  // leaveAddBackMinutes는 실제로 더해진 양이다. 빠진 날의 휴가만큼 벌어짐
  const days = lib.buildDaysFromApi(withSchedule('2026-09-11', [fx.timeOffBlock(240, false)]));
  const resolved = lib.resolveRemaining(120, days, SEP_10, SEP_11);
  assert.equal(lib.sumRemainingLeaveMinutes(days, SEP_10, SEP_11), 240);
  assert.equal(resolved.leaveAddBackMinutes, 0);
  const coveredLeave = resolved.coveredDays.reduce((sum, d) => sum + d.timeOffMinutes, 0);
  assert.equal(
    lib.sumRemainingLeaveMinutes(days, SEP_10, SEP_11) - resolved.leaveAddBackMinutes,
    coveredLeave
  );
});
