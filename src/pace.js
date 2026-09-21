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
    } else if (summary.hasOpenWorkBlock) {
      // 방어용 경로. 근무 중인 하루는 timeBlocks가 빈 배열로 오는 것으로 확인됐고(퇴근 시점에
      // 블록이 생김) 그 경우는 인정근무 0으로 자연히 포함된다. 진행 중 블록이 내려오는 형태로
      // 바뀌더라도 오늘이 분모에서 빠지지 않게 남겨둠
      reason = null;
    } else if (isFullDayTimeOff(summary, usualWorkingMinutes)) {
      reason = 'TIME_OFF';
    } else if (summary.hasClosedWorkBlock) {
      // 끝난 근무 블록이 하나라도 있으면 그 날은 마감된 것으로 본다. 시차를 쓰고 일찍
      // 퇴근한 날도 여기에 걸리므로 분모에 남아 페이스를 낮게 만들지 않는다.
      // 합계 분(workMinutes)이 아니라 블록 존재로 보는 이유: 휴게가 근무만큼 길면
      // 합계가 0이 되는데(13~14시 근무 + 60분 휴게) 그 날도 이미 끝난 날이다.
      reason = 'WORKED';
    }
    // 시차/반차만 등록돼 있고 근무 기록이 없는 날은 reason이 null로 남아 근무일로 센다.
    // 잔여 필수 근무시간에서는 그 휴가 시간만큼 이미 빠져 있으므로 중복 차감이 아니다.
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

// 오늘(포함)부터 정산기간 종료일까지, 아직 근무가 필요한 날의 수.
// 오늘도 특별 취급 없이 같은 규칙으로 판정한다: 퇴근해서 칩에 시간이 들어오면 그 순간 제외되고,
// 근무 중(칩 0:00)이거나 미출근이면 포함된다.
function countRemainingWorkDays(dayInfos, fromDate, endDate) {
  var fromStripped = stripTime(fromDate);
  var endStripped = stripTime(endDate);
  var count = 0;
  for (var i = 0; i < dayInfos.length; i++) {
    var d = stripTime(dayInfos[i].date);
    if (
      d.getTime() >= fromStripped.getTime() &&
      d.getTime() <= endStripped.getTime() &&
      dayInfos[i].isWorkDay
    ) {
      count++;
    }
  }
  return count;
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
  countRemainingWorkDays: countRemainingWorkDays,
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
