// flex.team API 응답에서 하루 단위 사실을 뽑는다. 판정 근거는 모두 명시적 필드다.
// - date-attributes[].dayOffs: REST_DAY(토) / WEEKLY_HOLIDAY(일) / CUSTOM_HOLIDAY(공휴일, 대체공휴일)
// - work-schedules[].timeBlocks: WORK / REST(휴게) / *TIME_OFF(연차 등)
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
      workMinutes += type === 'WORK' ? minutes : -minutes;
    } else if (type.indexOf('TIME_OFF') !== -1) {
      timeOffMinutes += typeof value.usedMinutes === 'number' ? value.usedMinutes : 0;
    }
  }
  return {
    workMinutes: workMinutes,
    timeOffMinutes: timeOffMinutes,
    hasOpenWorkBlock: hasOpenWorkBlock,
  };
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
    var summary = summarizeSchedule(byDate[attribute.date]);
    var recognizedMinutes = summary.workMinutes + summary.timeOffMinutes;
    var reason = null;
    if (dayOffs.length) {
      reason = String(dayOffs[0].type || 'DAY_OFF');
    } else if (!attribute.usualWorkingMinutes) {
      reason = 'NO_USUAL_MINUTES';
    } else if (summary.hasOpenWorkBlock) {
      // 근무 중이면 아직 인정근무에 반영되지 않았으므로 남은 근무일로 센다
      reason = null;
    } else if (summary.timeOffMinutes > 0) {
      reason = 'TIME_OFF';
    } else if (recognizedMinutes > 0) {
      reason = 'WORKED';
    }
    days.push({
      date: date,
      isoDate: attribute.date,
      usualWorkingMinutes: attribute.usualWorkingMinutes || 0,
      recognizedMinutes: recognizedMinutes,
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
