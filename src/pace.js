function parseTimeToMinutes(token) {
  var m = /^(-)?(\d{1,3}):(\d{2})$/.exec(String(token).trim());
  if (!m) return null;
  var sign = m[1] ? -1 : 1;
  var hours = parseInt(m[2], 10);
  var mins = parseInt(m[3], 10);
  return sign * (hours * 60 + mins);
}

function extractRequiredRemainingMinutes(widgetText) {
  var matches = String(widgetText).match(/-?\d{1,3}:\d{2}/g);
  if (!matches) return null;
  for (var i = 0; i < matches.length; i++) {
    var value = parseTimeToMinutes(matches[i]);
    if (value !== null && value < 0) {
      return Math.abs(value);
    }
  }
  return null;
}

function parsePeriodRange(periodText) {
  var m = /(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\s*[–-]\s*(\d{1,2})\.\s*(\d{1,2})/.exec(String(periodText));
  if (!m) return null;
  var startYear = parseInt(m[1], 10);
  var startMonth = parseInt(m[2], 10);
  var startDay = parseInt(m[3], 10);
  var endMonth = parseInt(m[4], 10);
  var endDay = parseInt(m[5], 10);
  var endYear = endMonth < startMonth ? startYear + 1 : startYear;
  return {
    startDate: new Date(startYear, startMonth - 1, startDay),
    endDate: new Date(endYear, endMonth - 1, endDay),
  };
}

function stripTime(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function countRemainingWorkDays(dayInfos, today, endDate) {
  var todayStripped = stripTime(today);
  var endStripped = stripTime(endDate);
  var count = 0;
  for (var i = 0; i < dayInfos.length; i++) {
    var d = stripTime(dayInfos[i].date);
    if (
      d.getTime() >= todayStripped.getTime() &&
      d.getTime() <= endStripped.getTime() &&
      !dayInfos[i].isHoliday
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

var FlexPacerLib = {
  parseTimeToMinutes: parseTimeToMinutes,
  extractRequiredRemainingMinutes: extractRequiredRemainingMinutes,
  parsePeriodRange: parsePeriodRange,
  stripTime: stripTime,
  countRemainingWorkDays: countRemainingWorkDays,
  computePace: computePace,
  formatMinutesAsHM: formatMinutesAsHM,
  buildBannerMessage: buildBannerMessage,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FlexPacerLib;
} else {
  (typeof window !== 'undefined' ? window : globalThis).FlexPacerLib = FlexPacerLib;
}
