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

  function describeExcludedDays(days, fromDate, endDate) {
    var from = lib.stripTime(fromDate).getTime();
    var to = lib.stripTime(endDate).getTime();
    var parts = [];
    for (var i = 0; i < days.length; i++) {
      var day = days[i];
      var time = day.date.getTime();
      if (day.isWorkDay || time < from || time > to) continue;
      parts.push(day.isoDate.slice(5) + ':' + day.reason);
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
        var remainingDays = lib.countRemainingWorkDays(inputs.days, now, endDate);
        var message = lib.buildCompactMessage(inputs.requiredRemainingMinutes, remainingDays);
        console.debug(
          '[flex-pacer] period=' + inputs.period.startDate + '..' + inputs.period.endDateInclusive +
            ', remaining=' + inputs.requiredRemainingMinutes + 'm' +
            ', workDays=' + remainingDays +
            ', excluded=' + describeExcludedDays(inputs.days, now, endDate)
        );
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
