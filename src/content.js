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
      // 행 전체 텍스트에는 연차/휴가 같은 근태 항목 라벨이 함께 들어온다
      var context = findRowContext(triggers[i]);
      cell.rowText = context ? context.row.textContent || '' : '';
      cell.workMinutes = context ? context.workMinutes : null;
      cell.isToday = !!triggers[i].querySelector('[class*="boxType-today"]');
      cells.push(cell);
    }
    return cells;
  }

  // 오늘 셀은 하위 요소에 boxType-today variant 클래스가 붙는다. 못 찾으면 null을 반환해
  // 오늘을 남은 근무일에 포함하는 기존 동작으로 떨어짐.
  function findTodayWorkedMinutes(cells) {
    for (var i = 0; i < cells.length; i++) {
      if (cells[i].isToday) return cells[i].workMinutes;
    }
    return null;
  }

  // 콘솔 확인용: 카운트 구간에서 제외된 날과 그 이유
  function describeExcludedDays(days, fromDate, endDate) {
    var from = lib.stripTime(fromDate).getDate();
    var to = lib.stripTime(endDate).getDate();
    var parts = [];
    for (var i = 0; i < days.length; i++) {
      var d = days[i];
      if (!d.isHoliday || d.day < from || d.day > to) continue;
      parts.push(d.day + ':' + d.reason + (d.label ? '(' + d.label + ')' : ''));
    }
    return parts.join(' ');
  }

  function buildDayDates(days, referenceDate) {
    var year = referenceDate.getFullYear();
    var month = referenceDate.getMonth();
    return days.map(function (info) {
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

    var todayWorkedMinutes = findTodayWorkedMinutes(dayCells);
    var fromDate = lib.resolveCountStartDate(new Date(), todayWorkedMinutes);
    var dayDates = buildDayDates(analysis.days, range.startDate);
    var remainingDays = lib.countRemainingWorkDays(dayDates, fromDate, range.endDate);

    if (analysis.unknownLabels.length) {
      // 분류 못 한 근태 라벨은 근무일로 세므로, 실제로 쉬는 항목이면 값이 낙관적으로 나온다
      console.warn(
        '[flex-pacer] unrecognized day labels, counted as work days: ' +
          analysis.unknownLabels.join(', ')
      );
    }
    console.debug(
      '[flex-pacer] remaining=' + remainingMinutes + 'm, todayWorked=' + todayWorkedMinutes +
        'm, countingFrom=' + fromDate.toDateString() + ', workDays=' + remainingDays +
        ', excluded=' + describeExcludedDays(analysis.days, fromDate, range.endDate)
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
