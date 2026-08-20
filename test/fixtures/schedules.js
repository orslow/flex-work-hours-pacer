// flex.team 응답과 같은 모양의 합성 픽스처를 만드는 헬퍼.
// 실제 응답에서 확인한 구조만 옮겼고 값은 전부 합성이다 (개인 근무기록을 저장소에 넣지 않기 위함).
const TIMEZONE = 'Asia/Seoul';
const MINUTE = 60 * 1000;

function at(isoDate, hour, minute = 0) {
  // 합성 데이터라 KST 고정 오프셋으로 계산해도 충분함
  return Date.parse(`${isoDate}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+09:00`);
}

function stamp(timestamp) {
  return { zoneId: TIMEZONE, timestamp };
}

function workBlock(isoDate, startHour, endHour) {
  return {
    type: 'WORK',
    value: {
      startTimestamp: stamp(at(isoDate, startHour)),
      endTimestampExclusive: stamp(at(isoDate, endHour)),
      workFormId: '40604',
      eventStatus: 'RECORD',
      eventSource: 'WORK_CLOCK',
      allDay: false,
    },
  };
}

// 퇴근 전 근무 블록: 끝 타임스탬프가 없다
function openWorkBlock(isoDate, startHour) {
  return {
    type: 'WORK',
    value: {
      startTimestamp: stamp(at(isoDate, startHour)),
      endTimestampExclusive: null,
      workFormId: '40604',
      eventStatus: 'RECORD',
      eventSource: 'WORK_CLOCK',
      allDay: false,
    },
  };
}

function restBlock(isoDate, startHour, minutes) {
  return {
    type: 'REST',
    value: {
      startTimestamp: stamp(at(isoDate, startHour)),
      endTimestampExclusive: stamp(at(isoDate, startHour) + minutes * MINUTE),
      workFormId: '40610',
      eventStatus: 'RECORD',
      eventSource: 'WORK_CLOCK',
      allDay: false,
    },
  };
}

function timeOffBlock(usedMinutes = 480, allDay = true) {
  return {
    type: 'CUSTOM_TIME_OFF',
    value: {
      allDay,
      timezoneAtRegistration: TIMEZONE,
      timeOffPolicyId: '100000',
      status: 'APPROVAL_COMPLETED',
      timeOffRegisterUnit: allDay ? 'DAY' : 'HALF_DAY',
      restMinutes: 0,
      usedMinutes,
      usedPaidMinutes: usedMinutes,
    },
  };
}

function attribute(isoDate, { dayOffType = null, usualWorkingMinutes = 480 } = {}) {
  return {
    date: isoDate,
    timezone: TIMEZONE,
    dateType: 'IN_EMPLOY',
    dayOffs: dayOffType ? [{ type: dayOffType }] : [],
    customerWorkRuleId: '20555',
    usualWorkingMinutes: dayOffType ? 0 : usualWorkingMinutes,
    locks: [],
  };
}

function schedule(isoDate, timeBlocks = []) {
  return { date: isoDate, timezone: TIMEZONE, dayOffs: [], timeBlocks, legalTimeBlocks: [], approvals: [] };
}

module.exports = {
  TIMEZONE,
  at,
  workBlock,
  openWorkBlock,
  restBlock,
  timeOffBlock,
  attribute,
  schedule,
};
