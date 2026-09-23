// flex.team API 응답에서 하루 단위 사실을 뽑는다. 판정 근거는 모두 명시적 필드다.
// - date-attributes[].dayOffs: REST_DAY(토) / WEEKLY_HOLIDAY(일) / CUSTOM_HOLIDAY(공휴일, 대체공휴일)
// - work-schedules[].timeBlocks: WORK / REST(휴게) / *TIME_OFF(연차, 반차, 시차 등)
function parseIsoDate(text) {
  var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(text == null ? '' : text).trim());
  if (!m) return null;
  return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
}

function blockMinutes(value) {
  var start = value && value.startTimestamp && value.startTimestamp.timestamp;
  var end = value && value.endTimestampExclusive && value.endTimestampExclusive.timestamp;
  if (typeof start !== 'number' || typeof end !== 'number') return null;
  return Math.round((end - start) / 60000);
}

function summarizeSchedule(schedule) {
  var blocks = (schedule && schedule.timeBlocks) || [];
  var workMinutes = 0;
  var timeOffMinutes = 0;
  var hasOpenWorkBlock = false;
  var hasClosedWorkBlock = false;
  var hasUnmeasuredAllDayTimeOff = false;
  for (var i = 0; i < blocks.length; i++) {
    var type = String(blocks[i].type || '');
    var value = blocks[i].value || {};
    if (type === 'WORK' || type === 'REST') {
      var minutes = blockMinutes(value);
      // 끝 타임스탬프가 없는 근무 블록 = 아직 진행 중 (퇴근 전)
      if (minutes === null) {
        if (type === 'WORK') hasOpenWorkBlock = true;
        continue;
      }
      if (type === 'WORK') hasClosedWorkBlock = true;
      workMinutes += type === 'WORK' ? minutes : -minutes;
    } else if (type.indexOf('TIME_OFF') !== -1) {
      if (typeof value.usedMinutes === 'number' && value.usedMinutes > 0) {
        timeOffMinutes += value.usedMinutes;
      } else if (value.allDay === true) {
        // 쓴 시간을 못 읽었는데 종일로 표시된 블록. 합계에는 못 넣으니 따로 기억해둔다
        hasUnmeasuredAllDayTimeOff = true;
      }
    }
  }
  return {
    workMinutes: workMinutes,
    timeOffMinutes: timeOffMinutes,
    hasOpenWorkBlock: hasOpenWorkBlock,
    hasClosedWorkBlock: hasClosedWorkBlock,
    hasUnmeasuredAllDayTimeOff: hasUnmeasuredAllDayTimeOff,
  };
}

// 종일 휴가(연차)인지 판정. 쓴 시간이 그 날 소정근로시간을 다 덮으면 종일로 본다.
// 시차/반차처럼 일부만 쓴 날은 남은 시간만큼 아직 일해야 하므로 종일이 아니다.
//
// 판정은 쓴 시간으로 한다. allDay는 시차 블록에도 true로 올 수 있다고 보고(그 블록들은
// 시작/끝 타임스탬프 없이 내려오므로 "시간대 없음"이라는 뜻일 수 있다) 판정 근거로 쓰지
// 않는다. 이 둘의 우선순위가 뒤집히면 시차가 다시 종일로 잡혀도 테스트는 다 통과한다.
// 예외는 쓴 시간을 아예 못 읽은 종일 블록뿐이다. 그건 합계에 안 들어가므로 따로 본다.
function isFullDayTimeOff(summary, usualWorkingMinutes) {
  if (summary.hasUnmeasuredAllDayTimeOff) return true;
  return (
    summary.timeOffMinutes > 0 &&
    usualWorkingMinutes > 0 &&
    summary.timeOffMinutes >= usualWorkingMinutes
  );
}

function buildDaysFromApi(input) {
  var attributes = (input && input.workingDayAttributes) || [];
  var schedules = (input && input.dailySchedules) || [];
  var byDate = {};
  for (var i = 0; i < schedules.length; i++) byDate[schedules[i].date] = schedules[i];

  var days = [];
  for (var j = 0; j < attributes.length; j++) {
    var attribute = attributes[j];
    var date = parseIsoDate(attribute.date);
    if (!date) continue;
    var dayOffs = attribute.dayOffs || [];
    var usualWorkingMinutes = attribute.usualWorkingMinutes || 0;
    var summary = summarizeSchedule(byDate[attribute.date]);
    var recognizedMinutes = summary.workMinutes + summary.timeOffMinutes;
    var reason = null;
    if (dayOffs.length) {
      reason = String(dayOffs[0].type || 'DAY_OFF');
    } else if (!usualWorkingMinutes) {
      reason = 'NO_USUAL_MINUTES';
    } else if (isFullDayTimeOff(summary, usualWorkingMinutes)) {
      // 진행 중 블록 판정보다 먼저 본다. 뒤로 미루면 종일 휴가에 출근을 찍은 날이 분모에 남는데,
      // 쓴 시간을 못 읽은 종일 블록(hasUnmeasuredAllDayTimeOff)이 그렇게 걸리면 휴가 시간을
      // 하나도 안 더한 채 온전한 하루로 세어 페이스가 조용히 낙관적이 된다.
      // 이 순서가 있어야 하루당 되돌려더하는 양이 소정근로시간 미만으로 묶인다
      reason = 'TIME_OFF';
    } else if (summary.hasOpenWorkBlock) {
      // 방어용 경로. 근무 중인 하루는 timeBlocks가 빈 배열로 오는 것으로 확인됐고(퇴근 시점에
      // 블록이 생김) 그 경우는 인정근무 0으로 자연히 포함된다. 진행 중 블록이 내려오는 형태로
      // 바뀌더라도 오늘이 분모에서 빠지지 않게 남겨둠
      reason = null;
    } else if (summary.hasClosedWorkBlock) {
      // 끝난 근무 블록이 하나라도 있으면 그 날은 마감된 것으로 본다. 시차를 쓰고 일찍
      // 퇴근한 날도 여기에 걸리므로 분모에 남아 페이스를 낮게 만들지 않는다.
      // 합계 분(workMinutes)이 아니라 블록 존재로 보는 이유: 휴게가 근무만큼 길면
      // 합계가 0이 되는데(13~14시 근무 + 60분 휴게) 그 날도 이미 끝난 날이다.
      reason = 'WORKED';
    }
    // 시차/반차만 등록돼 있고 근무 기록이 없는 날은 reason이 null로 남아 근무일로 센다.
    // 그 휴가 시간은 잔여 필수 근무시간에서 이미 빠져 있는데 하루는 온전히 분모에 남으므로,
    // resolveRemaining에서 도로 더해 하루 필요량을 모든 날에 같게 맞춘다.
    days.push({
      date: date,
      isoDate: attribute.date,
      usualWorkingMinutes: usualWorkingMinutes,
      recognizedMinutes: recognizedMinutes,
      timeOffMinutes: summary.timeOffMinutes,
      inProgress: summary.hasOpenWorkBlock,
      isWorkDay: reason === null,
      reason: reason,
    });
  }
  return days;
}

function stripTime(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// 오늘(포함)부터 정산기간 종료일까지, 아직 근무가 필요한 날인지.
// 분모도, 분자에 되돌려더할 휴가도, 콘솔 로그의 partialLeave도 전부 이 판정 하나를 쓴다.
// 어느 하나가 따로 판정하면 계산과 로그가 조용히 갈라진다.
function isRemainingWorkDay(dayInfo, fromMs, endMs) {
  var t = stripTime(dayInfo.date).getTime();
  return t >= fromMs && t <= endMs && dayInfo.isWorkDay;
}

// 분모에 남는 날들. 개수가 곧 남은 근무일수이고, 휴가 시간의 합이 되돌려더할 후보다.
// 둘이 같은 목록에서 나와야 한쪽에만 잡히는 날이 안 생긴다.
function collectRemainingWorkDays(dayInfos, fromDate, endDate) {
  var fromMs = stripTime(fromDate).getTime();
  var endMs = stripTime(endDate).getTime();
  var remaining = [];
  for (var i = 0; i < dayInfos.length; i++) {
    if (isRemainingWorkDay(dayInfos[i], fromMs, endMs)) remaining.push(dayInfos[i]);
  }
  return remaining;
}

function leaveMinutesOf(dayInfo) {
  return dayInfo.timeOffMinutes || 0;
}

// 오늘(포함)부터 정산기간 종료일까지, 아직 근무가 필요한 날의 수.
// 오늘도 특별 취급 없이 같은 규칙으로 판정한다: 퇴근해서 칩에 시간이 들어오면 그 순간 제외되고,
// 근무 중(칩 0:00)이거나 미출근이면 포함된다.
function countRemainingWorkDays(dayInfos, fromDate, endDate) {
  return collectRemainingWorkDays(dayInfos, fromDate, endDate).length;
}

// 분모에 남아 있는 날에 걸린 휴가 시간의 합.
// flex는 휴가를 인정근무로 치기 때문에 잔여 필수 근무시간에서 그만큼 이미 빼놓는다. 실측 근거는
// summary 응답의 항등식이다(2026-09-23): normalWorkMinutes 7346 + nightWorkMinutes 87 +
// totalTimeOffMinutes 600 = totalRecognizedWorkingMinutes 8033. overWork/holidayWork가 모두 0이라
// 저 600분은 실근무로 설명되지 않는다. 게다가 그 600분에는 닷새 뒤인 09-28 명절휴가 480분이
// 들어있어, 미래에 등록해둔 휴가도 즉시 반영된다는 것까지 확인된다.
//
// 그런데 시차/반차가 걸린 날은 온전한 하루로 분모에 남으므로, 빼둔 만큼을 도로 더해야
// 하루 필요시간이 "인정근무 기준 하루 필요량"으로 모든 날에 같게 나온다.
// 시차 쓴 날은 그 필요량 중 휴가 시간만큼이 이미 채워져 있는 셈이다.
//
// 분모에서 빠진 날은 여기서도 빠진다. 종일 연차(TIME_OFF)와 이미 퇴근한 날(WORKED)이 그렇고,
// 그 날들의 휴가는 도로 더하면 안 되는 것들이라 목록 공유가 곧 안전장치다.
// 결과적으로 여기 잡히는 건 하루 일부만 쓴 휴가뿐이다.
function sumRemainingLeaveMinutes(dayInfos, fromDate, endDate) {
  var remaining = collectRemainingWorkDays(dayInfos, fromDate, endDate);
  var total = 0;
  for (var i = 0; i < remaining.length; i++) total += leaveMinutesOf(remaining[i]);
  return total;
}

// 하루 필요량 N을 구한다. 어느 날 실제로 더 일할 시간은 max(0, N - 그 날 휴가)이므로,
// 그 합이 잔여 필수와 같아지는 N이 답이다. 단순히 (잔여 + 휴가합) / 날수로 하면
// 휴가가 N을 넘는 날에서 음수 근무를 가정하게 돼 전체가 과대계상된다.
// (예: 잔여 2시간, 남은 이틀 중 하루가 반차 4시간 -> 3시간/일로 나오지만 실제로는 총 2시간이면 된다)
//
// 그래서 휴가가 N 이상인 날은 "그 날은 더 일할 게 없다"로 보고 양쪽 합계에서 빼고 다시 구한다.
// 한 번 빼면 N이 내려가므로(빠진 날의 휴가가 평균을 끌어올리고 있었으니) 남은 날도 다시 걸릴 수
// 있다. 그래서 더 빠지는 날이 없을 때까지 반복한다. 빠진 날의 휴가는 마지막 N보다도 크거나 같아
// max(0, N - 휴가)가 0이고, 남은 날만으로 합이 정확히 잔여 필수가 된다.
//
// 잔여 > 0이면 k*N = 잔여 + 휴가합 > 휴가합 >= k*min(휴가)라 최소 휴가일은 항상 N 미만이므로
// 목록이 비지 않는다. 마지막 return은 그 성질이 깨질 때를 위한 방어용이다.
//
// 비교는 정수로만 한다. N = total / pool.length를 실수로 만들어 비교하면 휴가가 N과 정확히
// 같은 경계(예: N 240.0, 휴가 240)에서 결과가 흔들릴 수 있다.
//
// 반환값은 배지에 그대로 쓸 분자/분모다. remainingMinutes / remainingDays가 정확히 N이라
// 괄호 안 날수로 눈검증하는 성질이 유지된다.
function fillRemaining(requiredRemainingMinutes, remainingWorkDays) {
  var pool = remainingWorkDays;
  var coveredDays = [];
  while (pool.length) {
    var total = requiredRemainingMinutes;
    for (var i = 0; i < pool.length; i++) total += leaveMinutesOf(pool[i]);
    var kept = [];
    var dropped = [];
    for (var j = 0; j < pool.length; j++) {
      // 휴가 < N 을 양변에 pool.length를 곱한 정수식으로 비교
      if (leaveMinutesOf(pool[j]) * pool.length < total) kept.push(pool[j]);
      else dropped.push(pool[j]);
    }
    if (!dropped.length) {
      return { remainingMinutes: total, remainingDays: pool.length, coveredDays: coveredDays };
    }
    coveredDays = coveredDays.concat(dropped);
    pool = kept;
  }
  return {
    remainingMinutes: requiredRemainingMinutes,
    remainingDays: 0,
    coveredDays: coveredDays,
  };
}

// 분자와 분모를 한 번에 확정한다. 둘을 따로 구하면 술어가 어긋나도 티가 안 나므로 묶어둔다.
function resolveRemaining(requiredRemainingMinutes, dayInfos, fromDate, endDate) {
  var remaining = collectRemainingWorkDays(dayInfos, fromDate, endDate);
  // 다 채웠는지는 반드시 원본 잔여로 판정한다. 되돌려더한 값으로 보면, 이미 목표를 넘겼는데
  // 휴가를 앞으로 등록해둔 것만으로 "Goal met"이 "더 일해야 함"으로 뒤집힌다.
  // fillRemaining의 목록이 비지 않는다는 성질도 잔여 > 0을 전제로 하므로 순서가 중요하다
  var filled =
    requiredRemainingMinutes > 0
      ? fillRemaining(requiredRemainingMinutes, remaining)
      : { remainingMinutes: requiredRemainingMinutes, remainingDays: remaining.length, coveredDays: [] };
  return {
    requiredRemainingMinutes: requiredRemainingMinutes,
    remainingWorkDays: remaining.length,
    // 실제로 도로 더해진 양. 하루 필요량이 휴가만으로 이미 채워진 날은 분자에서도 빠지므로
    // 남은 근무일 전체의 휴가 합(sumRemainingLeaveMinutes)보다 작을 수 있다
    leaveAddBackMinutes: filled.remainingMinutes - requiredRemainingMinutes,
    coveredDays: filled.coveredDays,
    remainingMinutes: filled.remainingMinutes,
    remainingDays: filled.remainingDays,
  };
}

function computePace(remainingMinutes, remainingDays) {
  if (remainingMinutes <= 0) return { status: 'done' };
  if (remainingDays <= 0) return { status: 'noDaysLeft' };
  return { status: 'ok', dailyMinutes: Math.ceil(remainingMinutes / remainingDays) };
}

function formatMinutesAsHM(minutes) {
  var hours = Math.floor(minutes / 60);
  var mins = minutes % 60;
  if (hours === 0) return mins + '분';
  if (mins === 0) return hours + '시간';
  return hours + '시간 ' + mins + '분';
}

function buildBannerMessage(remainingMinutes, remainingDays) {
  var pace = computePace(remainingMinutes, remainingDays);
  if (pace.status === 'done') {
    return '이번 정산기간 필수 근무시간을 이미 채우셨습니다 🎉';
  }
  if (pace.status === 'noDaysLeft') {
    return '이번 정산기간 근무 가능일이 모두 지났습니다.';
  }
  return (
    '잔여 ' + formatMinutesAsHM(remainingMinutes) +
    ' - 남은 근무일 ' + remainingDays + '일' +
    ' -> 하루 평균 ' + formatMinutesAsHM(pace.dailyMinutes) + '씩 더 일하면 됩니다'
  );
}

function formatCompactRemaining(minutes) {
  var hours = Math.floor(minutes / 60);
  var mins = minutes % 60;
  if (hours === 0) return mins + 'm';
  if (mins === 0) return hours + 'h';
  return hours + 'h ' + mins + 'm';
}

function buildCompactMessage(remainingMinutes, remainingDays) {
  var pace = computePace(remainingMinutes, remainingDays);
  if (pace.status === 'done') return 'Goal met 🎉';
  if (pace.status === 'noDaysLeft') return 'No days left';
  // 남은 근무일수를 같이 노출해 숫자가 조용히 틀렸을 때 눈으로 검증할 수 있게 함
  return 'Need ' + formatCompactRemaining(pace.dailyMinutes) + '/day (' + remainingDays + 'd)';
}

var FlexPacerLib = {
  parseIsoDate: parseIsoDate,
  summarizeSchedule: summarizeSchedule,
  isFullDayTimeOff: isFullDayTimeOff,
  buildDaysFromApi: buildDaysFromApi,
  stripTime: stripTime,
  isRemainingWorkDay: isRemainingWorkDay,
  countRemainingWorkDays: countRemainingWorkDays,
  sumRemainingLeaveMinutes: sumRemainingLeaveMinutes,
  resolveRemaining: resolveRemaining,
  computePace: computePace,
  formatMinutesAsHM: formatMinutesAsHM,
  buildBannerMessage: buildBannerMessage,
  formatCompactRemaining: formatCompactRemaining,
  buildCompactMessage: buildCompactMessage,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FlexPacerLib;
} else {
  (typeof window !== 'undefined' ? window : globalThis).FlexPacerLib = FlexPacerLib;
}
