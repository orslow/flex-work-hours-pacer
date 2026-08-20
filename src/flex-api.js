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

  // 잔여 필수 근무시간(분). 완전선택근로 응답의 requiredWorkingMinutes를 쓰고, 그 필드가 없는
  // 근무제에서는 소정근로 총량에서 인정근무를 빼서 같은 값을 만든다.
  // 같은 응답의 remainingDaysByEndDateOfWorkingPeriod / recommendDailyWorkingMinutes는 쓰지 않는다.
  // flex.team은 근무가 끝난 오늘도 남은 근무일에 포함해서(퇴근 후에도 분모에 남음) 하루 필요시간을
  // 낙관적으로 계산하기 때문이다.
  function fetchRequiredRemainingMinutes(userIdHash, nowMs) {
    var url =
      userPath(userIdHash, '/work-schedules/summary/by-working-period') +
      '?timestamp=' + nowMs + '&timezone=' + encodeURIComponent(TIMEZONE);
    return getJson(url).then(function (json) {
      var flexible = json && json.resultForFullFlexible;
      if (flexible && typeof flexible.requiredWorkingMinutes === 'number') {
        return flexible.requiredWorkingMinutes;
      }
      var result = (json && json.result) || {};
      if (
        typeof result.requiredAgreedWorkingMinutes === 'number' &&
        typeof result.totalRecognizedWorkingMinutes === 'number'
      ) {
        return result.requiredAgreedWorkingMinutes - result.totalRecognizedWorkingMinutes;
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
        fetchRequiredRemainingMinutes(identity.userIdHash, nowMs),
        fetchDayAttributes(identity.userIdHash, period.startDate, period.endDateInclusive),
        fetchDailySchedules(identity.userIdHash, period.startDate, period.endDateInclusive),
      ]).then(function (values) {
        return {
          period: period,
          requiredRemainingMinutes: values[0],
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
