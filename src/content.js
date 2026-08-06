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

  // 날짜 셀이 속한 행과 그 행의 근무시간 칩(예: 7:57)을 찾음. 조상을 올라가며 찾으므로 해시
  // 클래스명에 의존하지 않음. 날짜 셀이 둘 이상 보이는 조상까지 올라가면 행 밖으로 나간 것이므로
  // 중단함 (다른 날의 값을 이 날의 값으로 읽으면 근무일 판정이 어긋난다).
  function findRowContext(dayCellElement) {
    var node = dayCellElement;
    for (var depth = 0; depth < 4; depth++) {
      node = node.parentElement;
      if (!node) return null;
      var candidates = node.querySelectorAll('[data-scope="tooltip"][data-part="trigger"]');
      var dayCellCount = 0;
      var workMinutes = null;
      for (var i = 0; i < candidates.length; i++) {
        var text = (candidates[i].textContent || '').trim();
        if (lib.parseDayCell({ text: text, className: '' })) dayCellCount++;
        if (workMinutes === null && /^\d{1,3}:\d{2}$/.test(text)) {
          workMinutes = lib.parseTimeToMinutes(text);
        }
      }
      if (dayCellCount > 1) return null;
      if (workMinutes !== null) return { row: node, workMinutes: workMinutes };
    }
    return null;
  }

  function findDayCells() {
    var triggers = document.querySelectorAll('[data-scope="tooltip"][data-part="trigger"]');
    var cells = [];
    for (var i = 0; i < triggers.length; i++) {
      var cell = {
        text: triggers[i].textContent || '',
        className: triggers[i].className || '',
        element: triggers[i],
      };
      if (!lib.parseDayCell(cell)) continue;
      var context = findRowContext(triggers[i]);
      cell.workMinutes = context ? context.workMinutes : null;
      // 근무 중인 오늘 셀에는 boxType-realtimeWorkActive가 붙는다 (그 외에는 boxType-today).
      // 근무 중에는 칩이 0:00이지만, 실시간으로 채워지더라도 오늘을 빼지 않기 위한 신호로 씀.
      cell.isWorkingNow = !!triggers[i].querySelector('[class*="boxType-realtimeWorkActive"]');
      cells.push(cell);
    }
    return cells;
  }

  // 콘솔 확인용: 카운트 구간에서 제외된 날과 그 이유
  function describeExcludedDays(dayDates) {
    var parts = [];
    for (var i = 0; i < dayDates.length; i++) {
      var d = dayDates[i];
      if (d.isWorkDay || !d.inRange) continue;
      var detail = d.reason === 'prescheduled' ? '(' + d.workMinutes + 'm)' : '';
      parts.push(d.date.getDate() + ':' + d.reason + detail);
    }
    return parts.join(' ');
  }

  function buildDayDates(days, referenceDate, fromDate, endDate) {
    var year = referenceDate.getFullYear();
    var month = referenceDate.getMonth();
    var from = lib.stripTime(fromDate).getTime();
    var to = lib.stripTime(endDate).getTime();
    return days.map(function (info) {
      var date = new Date(year, month, info.day);
      return {
        date: date,
        isWorkDay: info.isWorkDay,
        reason: info.reason,
        workMinutes: info.workMinutes,
        inRange: date.getTime() >= from && date.getTime() <= to,
      };
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
    var dayCells = findDayCells();

    if (!periodText || !widgetElement || dayCells.length === 0) {
      removeCompactIndicator();
      console.warn('[flex-pacer] required page elements not found (yet), skipping indicator');
      return;
    }

    var analysis = lib.analyzeDayCells(dayCells);
    if (!analysis.holidayStylingReady) {
      removeCompactIndicator();
      console.warn(
        '[flex-pacer] holiday styling not applied to every Sunday cell yet (or the marker class changed); ' +
          'skipping indicator instead of counting public holidays as work days'
      );
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

    var fromDate = new Date();
    var dayDates = buildDayDates(analysis.days, range.startDate, fromDate, range.endDate);
    var remainingDays = lib.countRemainingWorkDays(dayDates, fromDate, range.endDate);

    console.debug(
      '[flex-pacer] remaining=' + remainingMinutes + 'm, countingFrom=' +
        lib.stripTime(fromDate).toDateString() + ', workDays=' + remainingDays +
        ', excluded=' + describeExcludedDays(dayDates)
    );
    insertOrUpdateCompactIndicator(lib.buildCompactMessage(remainingMinutes, remainingDays));
  }

  function scheduleRender() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(render, DEBOUNCE_MS);
  }

  // flex.team은 휴일 정보가 늦게 도착하면 노드를 교체하지 않고 class만 갱신한다. attributes를
  // 관찰하지 않으면 휴일 색이 입혀져도 재계산이 안 돼 공휴일이 근무일로 남은 값이 화면에 고정됨.
  var observer = new MutationObserver(scheduleRender);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['class'],
  });

  scheduleRender();
})();
