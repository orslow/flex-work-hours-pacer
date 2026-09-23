(function () {
  var lib = window.FlexPacerLib;
  var api = window.FlexPacerApi;
  var COMPACT_ID = 'flex-pacer-compact';
  // API 값은 퇴근/휴가 등록 같은 이벤트에만 바뀌므로 자주 부를 필요가 없다
  var REFRESH_MS = 5 * 60 * 1000;
  var LOCATION_POLL_MS = 1000;
  var RETRY_MS = 5000;
  var lastPathname = null;
  var inFlight = false;
  var refreshTimer = null;

  function isOnTargetPage() {
    return /^\/time-tracking\/my-work-record/.test(location.pathname);
  }

  function removeCompactIndicator() {
    var compact = document.getElementById(COMPACT_ID);
    if (compact) compact.remove();
  }

  function insertOrUpdateCompactIndicator(message) {
    var compact = document.getElementById(COMPACT_ID);
    if (compact) {
      if (compact.textContent !== message) compact.textContent = message;
      return true;
    }
    var header = document.querySelector('header[data-scope="page"][data-part="header"]');
    if (!header || !header.parentNode) return false;
    compact = document.createElement('div');
    compact.id = COMPACT_ID;
    compact.className = 'flex-pacer-compact';
    compact.textContent = message;
    header.parentNode.insertBefore(compact, header.nextSibling);
    return true;
  }

  function inRange(day, fromDate, endDate) {
    var time = day.date.getTime();
    return time >= lib.stripTime(fromDate).getTime() && time <= lib.stripTime(endDate).getTime();
  }

  // 분모에서 빠진 날과 그 이유. isRemainingWorkDay의 여집합으로 적어야 기간 판정이 한 군데로
  // 모인다. isWorkDay를 따로 보면 기간 해석이 바뀔 때 두 로그에서 동시에 날이 사라진다
  function describeExcludedDays(days, fromDate, endDate) {
    var fromMs = lib.stripTime(fromDate).getTime();
    var endMs = lib.stripTime(endDate).getTime();
    var parts = [];
    for (var i = 0; i < days.length; i++) {
      var day = days[i];
      if (!inRange(day, fromDate, endDate) || lib.isRemainingWorkDay(day, fromMs, endMs)) continue;
      parts.push(day.isoDate.slice(5) + ':' + day.reason);
    }
    return parts.join(' ');
  }

  // 분모에 온전한 하루로 남아 있으면서 휴가가 일부 걸린 날.
  // 보통은 여기 찍히는 분의 합이 곧 addBack이지만, 휴가만으로 하루 필요량이 이미 채워진 날은
  // 아래 covered로 빠지면서 addBack에서도 빠진다. 그래서 둘을 같이 찍는다.
  // 판정은 계산과 같은 lib.isRemainingWorkDay를 쓴다. 따로 베끼면 로그와 계산이 조용히 갈라진다
  function describePartialLeaveDays(days, fromDate, endDate) {
    var fromMs = lib.stripTime(fromDate).getTime();
    var endMs = lib.stripTime(endDate).getTime();
    var parts = [];
    for (var i = 0; i < days.length; i++) {
      var day = days[i];
      if (!day.timeOffMinutes || !lib.isRemainingWorkDay(day, fromMs, endMs)) continue;
      parts.push(day.isoDate.slice(5) + ':' + day.timeOffMinutes + 'm/' + day.usualWorkingMinutes + 'm');
    }
    return parts.join(' ');
  }

  // 휴가만으로 하루 필요량이 채워져 분자/분모 양쪽에서 빠진 날
  function describeCoveredDays(coveredDays) {
    var parts = [];
    for (var i = 0; i < coveredDays.length; i++) {
      parts.push(coveredDays[i].isoDate.slice(5) + ':' + coveredDays[i].timeOffMinutes + 'm');
    }
    return parts.join(' ');
  }

  function render() {
    if (!isOnTargetPage()) {
      removeCompactIndicator();
      return;
    }
    if (inFlight) return;
    inFlight = true;

    var now = new Date();
    api
      .loadPaceInputs(now)
      .then(function (inputs) {
        var endDate = lib.parseIsoDate(inputs.period.endDateInclusive);
        var remaining = lib.resolveRemaining(
          inputs.requiredRemainingMinutes,
          inputs.days,
          now,
          endDate
        );
        var message = lib.buildCompactMessage(remaining.remainingMinutes, remaining.remainingDays);
        console.debug(
          '[flex-pacer] period=' + inputs.period.startDate + '..' + inputs.period.endDateInclusive +
            ', required=' + inputs.requiredRemainingMinutes + 'm' +
            ', addBack=' + remaining.leaveAddBackMinutes + 'm' +
            ', remaining=' + remaining.remainingMinutes + 'm' +
            ', workDays=' + remaining.remainingDays +
            '/' + remaining.remainingWorkDays +
            ', excluded=' + describeExcludedDays(inputs.days, now, endDate) +
            ', partialLeave=' + describePartialLeaveDays(inputs.days, now, endDate) +
            ', covered=' + describeCoveredDays(remaining.coveredDays) +
            ', flexOwn=' + inputs.flexOwn.dailyMinutes + 'm/' + inputs.flexOwn.remainingDays + 'd'
        );
        // 휴가를 인정근무로 안 쳐주는 정책이 섞여 있으면 그 시간은 잔여 필수에서 안 빠져 있는데
        // 되돌려더하기는 더해버린다. 값 자체가 정산기간 전체 합계라 어느 날 것인지 알 수 없으므로,
        // 이번 계산이 실제로 휴가에 기대고 있을 때만 경고한다.
        // coveredDays도 같이 보는 이유: 유일한 부분휴가일이 covered로 빠지면 addBack이 0이 되는데,
        // 그 날은 "안 빠져 있을 수도 있는" 휴가를 근거로 분모에서 제외된 것이라 더 위험하다
        if (
          inputs.leaveNotRecognizedMinutes &&
          (remaining.leaveAddBackMinutes || remaining.coveredDays.length)
        ) {
          console.warn(
            '[flex-pacer] 인정근무로 계산되지 않는 휴가 ' + inputs.leaveNotRecognizedMinutes +
              'm(정산기간 전체). 이번 계산이 휴가에 기대고 있어 하루 평균값이 틀릴 수 있음'
          );
        }
        if (!insertOrUpdateCompactIndicator(message)) {
          // 헤더가 아직 안 그려진 상태. 잠시 뒤 다시 시도
          setTimeout(render, RETRY_MS);
        }
      })
      .catch(function (error) {
        // 값을 못 구했으면 아무것도 보여주지 않는다 (잘못된 숫자를 보여주지 않기 위함)
        removeCompactIndicator();
        console.warn('[flex-pacer] failed to load pace inputs:', error);
      })
      .then(function () {
        inFlight = false;
      });
  }

  function scheduleRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(render, REFRESH_MS);
  }

  // SPA라 페이지 전환 시 로드 이벤트가 없다. pathname만 가볍게 확인해 이동을 감지함
  setInterval(function () {
    if (location.pathname === lastPathname) return;
    lastPathname = location.pathname;
    render();
  }, LOCATION_POLL_MS);

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) render();
  });
  window.addEventListener('focus', render);

  lastPathname = location.pathname;
  render();
  scheduleRefresh();
})();
