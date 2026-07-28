(function () {
  var lib = window.FlexPacerLib;
  var COMPACT_ID = 'flex-pacer-compact';
  var DEBOUNCE_MS = 250;
  var debounceTimer = null;

  function isOnTargetPage() {
    return /^\/time-tracking\/my-work-record/.test(location.pathname);
  }

  function removeCompactIndicator() {
    var compact = document.getElementById(COMPACT_ID);
    if (compact) compact.remove();
  }

  function findPeriodRangeText() {
    var bodyText = document.body.innerText;
    var m = /\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\s*[–-]\s*\d{1,2}\.\s*\d{1,2}/.exec(bodyText);
    return m ? m[0] : null;
  }

  function findWidgetElement() {
    // 위젯에는 순서대로 실근무시간(양수), 남은 필수 근무시간(음수), 최대 근무 가능 시간(음수) 세 값이
    // 표시된다. flex.team이 이 셋을 동시에 렌더링하지 않아서, 남은 필수 근무시간이 뜨기 전
    // (실근무시간 + 최대 근무 가능 시간 두 개만 있는 상태)에는 값이 아직 준비되지 않은 것으로 보고
    // 3개가 모두 나타날 때까지 기다린다. 그렇지 않으면 최대 근무 가능 시간을 남은 필수 근무시간으로
    // 잘못 읽는다.
    var triggers = document.querySelectorAll('[data-scope="hover-visible"][data-part="trigger"]');
    for (var i = 0; i < triggers.length; i++) {
      var text = triggers[i].textContent || '';
      var matches = text.match(/-?\d{1,3}:\d{2}/g);
      if (matches && matches.length >= 3) {
        return triggers[i];
      }
    }
    return null;
  }

  function findDayInfos() {
    var triggers = document.querySelectorAll('[data-scope="tooltip"][data-part="trigger"]');
    var dayPattern = /^(\d{1,2})[월화수목금토일]$/;
    var results = [];
    for (var i = 0; i < triggers.length; i++) {
      var text = (triggers[i].textContent || '').replace(/\s+/g, '');
      var m = dayPattern.exec(text);
      if (m) {
        results.push({
          day: parseInt(m[1], 10),
          isHoliday: triggers[i].className.indexOf('colorType-holiday') !== -1,
        });
      }
    }
    return results;
  }

  function buildDayDates(dayInfos, referenceDate) {
    var year = referenceDate.getFullYear();
    var month = referenceDate.getMonth();
    return dayInfos.map(function (info) {
      return { date: new Date(year, month, info.day), isHoliday: info.isHoliday };
    });
  }

  function insertOrUpdateCompactIndicator(message) {
    var compact = document.getElementById(COMPACT_ID);
    if (compact) {
      if (compact.textContent !== message) {
        compact.textContent = message;
      }
      return;
    }
    var header = document.querySelector('header[data-scope="page"][data-part="header"]');
    if (!header || !header.parentNode) return;
    compact = document.createElement('div');
    compact.id = COMPACT_ID;
    compact.className = 'flex-pacer-compact';
    compact.textContent = message;
    header.parentNode.insertBefore(compact, header.nextSibling);
  }

  function render() {
    if (!isOnTargetPage()) {
      removeCompactIndicator();
      return;
    }

    var periodText = findPeriodRangeText();
    var widgetElement = findWidgetElement();
    var dayInfos = findDayInfos();

    if (!periodText || !widgetElement || dayInfos.length === 0) {
      removeCompactIndicator();
      console.warn('[flex-pacer] required page elements not found (yet), skipping indicator');
      return;
    }

    var range = lib.parsePeriodRange(periodText);
    if (!range) {
      removeCompactIndicator();
      console.warn('[flex-pacer] failed to parse period range text:', periodText);
      return;
    }

    var remainingMinutes = lib.extractRequiredRemainingMinutes(widgetElement.textContent || '');
    if (remainingMinutes === null) {
      removeCompactIndicator();
      console.warn('[flex-pacer] failed to parse remaining required minutes');
      return;
    }

    var dayDates = buildDayDates(dayInfos, range.startDate);
    var remainingDays = lib.countRemainingWorkDays(dayDates, new Date(), range.endDate);

    insertOrUpdateCompactIndicator(lib.buildCompactMessage(remainingMinutes, remainingDays));
  }

  function scheduleRender() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(render, DEBOUNCE_MS);
  }

  var observer = new MutationObserver(scheduleRender);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  scheduleRender();
})();
