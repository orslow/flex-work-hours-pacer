function parseTimeToMinutes(token) {
  var m = /^(-)?(\d{1,3}):(\d{2})$/.exec(String(token).trim());
  if (!m) return null;
  var sign = m[1] ? -1 : 1;
  var hours = parseInt(m[2], 10);
  var mins = parseInt(m[3], 10);
  return sign * (hours * 60 + mins);
}

function extractRequiredRemainingMinutes(widgetText) {
  // 위젯은 순서대로 실근무시간, 남은 필수 근무시간, 최대 근무 가능 시간 세 값을 보여준다.
  // 남은 필수 근무시간은 부족하면 음수, 목표를 채웠거나 초과하면 0 또는 양수로 표시되므로
  // 부호로 구분하지 않고 두 번째 값을 위치로 읽어 부호만 반전한다 (양수 = 아직 필요한 시간).
  var matches = String(widgetText).match(/-?\d{1,3}:\d{2}/g);
  if (!matches || matches.length < 3) return null;
  var requiredValue = parseTimeToMinutes(matches[1]);
  if (requiredValue === null) return null;
  return requiredValue === 0 ? 0 : -requiredValue;
}

// flex.team은 Stitches variant 클래스로 날짜 색을 입힌다. 해시 접두어(c-bElvsc-fmLUio-)는
// 배포마다 바뀌므로 variant 이름 부분만 확인함.
var HOLIDAY_MARKER_PATTERN = /colorType-holiday(?![\w-])/;
var DAY_CELL_PATTERN = /^(\d{1,2})([월화수목금토일])$/;
// 종일 쉬는 항목 -> 근무일에서 제외
var LEAVE_LABEL_PATTERN = /(연차|휴가|휴무|공가|병가|경조|안식)/;
// 일해야 하는(또는 일부만 쉬는) 항목 -> 근무일로 유지. 휴가 패턴보다 먼저 확인함
var WORKING_LABEL_PATTERN = /(반차|반일|시간연차|시간휴가|조퇴|외출|지각|재택|출장|외근|교육|당직|근무)/;

function classifyDayRowLabel(rowText) {
  // 날짜 라벨(예: 20목)과 시간 값(예: 0:00)을 걷어낸 나머지 텍스트가 휴가 항목 라벨임
  var rest = String(rowText == null ? '' : rowText)
    .replace(/\d{1,2}\s*[월화수목금토일]/, ' ')
    .replace(/-?\d{1,3}:\d{2}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!rest) return { label: '', kind: 'none' };
  if (WORKING_LABEL_PATTERN.test(rest)) return { label: rest, kind: 'work' };
  if (LEAVE_LABEL_PATTERN.test(rest)) return { label: rest, kind: 'leave' };
  return { label: rest, kind: 'unknown' };
}

function parseDayCell(cell) {
  var text = String(cell && cell.text != null ? cell.text : '').replace(/\s+/g, '');
  var m = DAY_CELL_PATTERN.exec(text);
  if (!m) return null;
  var weekday = m[2];
  var markedHoliday = HOLIDAY_MARKER_PATTERN.test(String((cell && cell.className) || ''));
  var isWeekend = weekday === '토' || weekday === '일';
  var labelInfo = classifyDayRowLabel(cell && cell.rowText);
  var isLeave = labelInfo.kind === 'leave';
  return {
    day: parseInt(m[1], 10),
    weekday: weekday,
    markedHoliday: markedHoliday,
    label: labelInfo.label,
    labelKind: labelInfo.kind,
    // 주말은 요일 문자로 확정하므로 휴일 스타일이 아직 적용되지 않아도 근무일로 세지 않음
    isHoliday: isWeekend || markedHoliday || isLeave,
    reason: isWeekend ? 'weekend' : markedHoliday ? 'holiday' : isLeave ? 'leave' : null,
  };
}

function analyzeDayCells(cells) {
  var days = [];
  var seen = {};
  for (var i = 0; i < cells.length; i++) {
    var info = parseDayCell(cells[i]);
    if (!info) continue;
    // 같은 날짜 셀이 두 번 잡히면(고정 열 등) 근무일이 부풀어 하루 필요시간이 과소평가되므로
    // 날짜 기준으로 합치고, 판정이 엇갈리면 휴일 쪽을 택함
    if (seen[info.day]) {
      var kept = seen[info.day];
      if (info.isHoliday && !kept.isHoliday) {
        kept.isHoliday = true;
        kept.reason = info.reason;
      }
      kept.markedHoliday = kept.markedHoliday || info.markedHoliday;
      continue;
    }
    seen[info.day] = info;
    days.push(info);
  }
  var sundays = 0;
  var markedSundays = 0;
  for (var j = 0; j < days.length; j++) {
    if (days[j].weekday !== '일') continue;
    sundays++;
    if (days[j].markedHoliday) markedSundays++;
  }
  // 일요일 셀에 휴일 마커가 하나라도 빠져 있으면 휴일 정보가 아직 안 붙은(또는 마커 이름이 바뀐)
  // 상태로 본다. 그 상태로 계산하면 공휴일이 근무일로 잡혀 하루 필요시간이 과소평가됨.
  return {
    days: days,
    holidayStylingReady: sundays > 0 && markedSundays === sundays,
    // 휴가/근무 어느 쪽으로도 분류하지 못한 라벨. 근무일로 세되 콘솔에 남겨 분류를 보완함
    unknownLabels: days
      .filter(function (d) {
        return d.labelKind === 'unknown';
      })
      .map(function (d) {
        return d.day + '(' + d.label + ')';
      }),
  };
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

function nextDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
}

// 오늘을 남은 근무일에 넣을지 판단함.
// - 근무 중(boxType-realtimeWorkActive)이면 오늘 근무는 미확정이므로 포함
// - 근무 기록이 이미 찍혀 있으면(퇴근 후 칩에 값이 들어옴) 오늘 몫은 위젯의 잔여 필수 시간에
//   이미 반영된 것으로 보고 제외
// - 기록이 없으면(0:00) 아직 일할 수 있는 날이므로 포함
function resolveCountStartDate(today, todayWorkedMinutes, todayInProgress) {
  var base = stripTime(today);
  if (todayInProgress) return base;
  return typeof todayWorkedMinutes === 'number' && todayWorkedMinutes > 0 ? nextDay(base) : base;
}

// 캘린더가 오늘이 속한 달을 보여줄 때만 오늘의 날짜 숫자를 반환. boxType-today 마커를 못 찾았을 때
// 날짜 숫자로 오늘 행을 찾는 폴백에 사용함.
function resolveTodayDayNumber(referenceDate, today) {
  if (
    referenceDate.getFullYear() !== today.getFullYear() ||
    referenceDate.getMonth() !== today.getMonth()
  ) {
    return null;
  }
  return today.getDate();
}

function countRemainingWorkDays(dayInfos, fromDate, endDate) {
  var fromStripped = stripTime(fromDate);
  var endStripped = stripTime(endDate);
  var count = 0;
  for (var i = 0; i < dayInfos.length; i++) {
    var d = stripTime(dayInfos[i].date);
    if (
      d.getTime() >= fromStripped.getTime() &&
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
  parseTimeToMinutes: parseTimeToMinutes,
  extractRequiredRemainingMinutes: extractRequiredRemainingMinutes,
  classifyDayRowLabel: classifyDayRowLabel,
  parseDayCell: parseDayCell,
  analyzeDayCells: analyzeDayCells,
  parsePeriodRange: parsePeriodRange,
  stripTime: stripTime,
  nextDay: nextDay,
  resolveTodayDayNumber: resolveTodayDayNumber,
  resolveCountStartDate: resolveCountStartDate,
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
