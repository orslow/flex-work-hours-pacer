// flex.team 내부 API에서 계산에 필요한 사실만 읽어온다. 페이지와 같은 오리진으로 호출하므로
// 로그인 쿠키가 그대로 붙고, 별도 토큰 처리가 필요없다.
(function () {
  var TIMEZONE = 'Asia/Seoul';
  // 현재 정산기간을 찾기 위한 조회 폭. 정산기간이 한 달이라도 경계에 걸치면 놓치지 않도록 넉넉히 잡음
  var PERIOD_LOOKUP_DAYS = 45;
  var DAY_MS = 24 * 60 * 60 * 1000;

  function readIdentity() {
    // 쿠키 V2_CUSTOMER_INFO에 {"customerIdHash":"...","userIdHash":"..."}가 URL 인코딩되어 들어있음
    var match = /(?:^|;\s*)V2_CUSTOMER_INFO=([^;]+)/.exec(document.cookie || '');
    if (!match) return null;
    try {
      var parsed = JSON.parse(decodeURIComponent(match[1]));
      if (!parsed || !parsed.userIdHash) return null;
      return { userIdHash: parsed.userIdHash, customerIdHash: parsed.customerIdHash || null };
    } catch (error) {
      return null;
    }
  }

  function getJson(url) {
    return fetch(url, {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    }).then(function (response) {
      if (!response.ok) throw new Error('GET ' + url + ' -> ' + response.status);
      return response.json();
    });
  }

  function userPath(userIdHash, suffix) {
    return '/api/v3/time-tracking/users/' + encodeURIComponent(userIdHash) + suffix;
  }

  function fetchWorkingPeriod(userIdHash, nowMs) {
    var from = nowMs - PERIOD_LOOKUP_DAYS * DAY_MS;
    var to = nowMs + PERIOD_LOOKUP_DAYS * DAY_MS;
    var url =
      '/api/v2/work-rule/users/' + encodeURIComponent(userIdHash) +
      '/working-periods/by-timestamp-range/' + from + '..' + to;
    return getJson(url).then(function (json) {
      var periods = (json && json.periods) || [];
      var today = window.FlexPacerLib.stripTime(new Date(nowMs)).getTime();
      for (var i = 0; i < periods.length; i++) {
        var start = window.FlexPacerLib.parseIsoDate(periods[i].startDate);
        var end = window.FlexPacerLib.parseIsoDate(periods[i].endDateInclusive);
        if (!start || !end) continue;
        if (today >= start.getTime() && today <= end.getTime()) {
          return { startDate: periods[i].startDate, endDateInclusive: periods[i].endDateInclusive };
        }
      }
      throw new Error('no working period contains today (' + periods.length + ' returned)');
    });
  }

  // 휴가 중 인정근무로 쳐주지 않는 분. 정상값은 0이다(2026-09 실측: 연차 120분, 명절휴가 480분
  // 모두 totalMinutesNotRecognizedAsWork = 0). 0이 아닌 값은 그런 휴가가 잔여 필수에서 안 빠졌다는
  // 신호라, pace.js의 되돌려더하기가 그만큼 과대계상된다.
  // 다만 이 값은 정산기간 전체 합계라 어느 날의 휴가인지는 알 수 없다. 자동 보정은 못 하고
  // 콘솔 경고용으로만 읽는다. 되돌려더하기의 실제 근거는 pace.js의 항등식 주석을 볼 것.
  function readLeaveNotRecognizedMinutes(result) {
    var policies = (result && result.timeOffUseResultsByTimeOffPolicies) || [];
    var minutes = 0;
    for (var i = 0; i < policies.length; i++) {
      if (typeof policies[i].totalMinutesNotRecognizedAsWork === 'number') {
        minutes += policies[i].totalMinutesNotRecognizedAsWork;
      }
    }
    return minutes;
  }

  // 잔여 필수 근무시간(분). 완전선택근로 응답의 requiredWorkingMinutes를 쓰고, 그 필드가 없는
  // 근무제에서는 소정근로 총량에서 인정근무를 빼서 같은 값을 만든다.
  // 같은 응답의 remainingDaysByEndDateOfWorkingPeriod / recommendDailyWorkingMinutes는 쓰지 않는다.
  // flex.team은 근무가 끝난 오늘도 남은 근무일에 포함해서(퇴근 후에도 분모에 남음) 하루 필요시간을
  // 낙관적으로 계산하기 때문이다.
  function fetchSummary(userIdHash, nowMs) {
    var url =
      userPath(userIdHash, '/work-schedules/summary/by-working-period') +
      '?timestamp=' + nowMs + '&timezone=' + encodeURIComponent(TIMEZONE);
    return getJson(url).then(function (json) {
      var result = (json && json.result) || {};
      var leaveNotRecognizedMinutes = readLeaveNotRecognizedMinutes(result);
      var flexible = (json && json.resultForFullFlexible) || {};
      // flex 자신의 계산값. 우리 값과 나란히 찍어두면 한쪽이 조용히 틀렸을 때 바로 드러난다.
      // 계산에는 쓰지 않는다 (flex는 퇴근한 오늘도 남은 근무일에 포함해 낙관적으로 나옴)
      var flexOwn = {
        remainingDays: flexible.remainingDaysByEndDateOfWorkingPeriod,
        dailyMinutes: flexible.recommendDailyWorkingMinutes,
      };
      if (typeof flexible.requiredWorkingMinutes === 'number') {
        return {
          requiredRemainingMinutes: flexible.requiredWorkingMinutes,
          leaveNotRecognizedMinutes: leaveNotRecognizedMinutes,
          flexOwn: flexOwn,
        };
      }
      if (
        typeof result.requiredAgreedWorkingMinutes === 'number' &&
        typeof result.totalRecognizedWorkingMinutes === 'number'
      ) {
        return {
          requiredRemainingMinutes:
            result.requiredAgreedWorkingMinutes - result.totalRecognizedWorkingMinutes,
          leaveNotRecognizedMinutes: leaveNotRecognizedMinutes,
          flexOwn: flexOwn,
        };
      }
      throw new Error('summary response has no required working minutes');
    });
  }

  function fetchDayAttributes(userIdHash, from, to) {
    var url =
      userPath(userIdHash, '/work-schedules/date-attributes') +
      '?from=' + from + '&to=' + to + '&timezone=' + encodeURIComponent(TIMEZONE);
    return getJson(url).then(function (json) {
      return (json && json.workingDayAttributes) || [];
    });
  }

  function fetchDailySchedules(userIdHash, from, to) {
    var url =
      userPath(userIdHash, '/work-schedules') +
      '?from=' + from + '&to=' + to + '&timezone=' + encodeURIComponent(TIMEZONE);
    return getJson(url).then(function (json) {
      return (json && json.dailySchedules) || [];
    });
  }

  // 지표 계산에 필요한 입력 일체를 모아서 반환
  function loadPaceInputs(now) {
    var identity = readIdentity();
    if (!identity) return Promise.reject(new Error('V2_CUSTOMER_INFO cookie not found'));
    var nowMs = (now || new Date()).getTime();
    return fetchWorkingPeriod(identity.userIdHash, nowMs).then(function (period) {
      return Promise.all([
        fetchSummary(identity.userIdHash, nowMs),
        fetchDayAttributes(identity.userIdHash, period.startDate, period.endDateInclusive),
        fetchDailySchedules(identity.userIdHash, period.startDate, period.endDateInclusive),
      ]).then(function (values) {
        return {
          period: period,
          requiredRemainingMinutes: values[0].requiredRemainingMinutes,
          leaveNotRecognizedMinutes: values[0].leaveNotRecognizedMinutes,
          flexOwn: values[0].flexOwn,
          days: window.FlexPacerLib.buildDaysFromApi({
            workingDayAttributes: values[1],
            dailySchedules: values[2],
          }),
        };
      });
    });
  }

  window.FlexPacerApi = {
    readIdentity: readIdentity,
    loadPaceInputs: loadPaceInputs,
  };
})();
