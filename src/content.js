(function () {
  var lib = window.FlexPacerLib;
  var COMPACT_ID = 'flex-pacer-compact';
  var DEBOUNCE_MS = 250;
  var debounceTimer = null;

  function findPeriodRangeText() {
    var bodyText = document.body.innerText;
    var m = /\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\s*[–-]\s*\d{1,2}\.\s*\d{1,2}/.exec(bodyText);
    return m ? m[0] : null;
  }

  function findWidgetElement() {
    var triggers = document.querySelectorAll('[data-scope="hover-visible"][data-part="trigger"]');
    for (var i = 0; i < triggers.length; i++) {
      var text = triggers[i].textContent || '';
      var matches = text.match(/-?\d{1,3}:\d{2}/g);
      if (matches && matches.length >= 2) {
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
    var periodText = findPeriodRangeText();
    var widgetElement = findWidgetElement();
    var dayInfos = findDayInfos();

    if (!periodText || !widgetElement || dayInfos.length === 0) {
      console.warn('[flex-pacer] required page elements not found, skipping indicator');
      return;
    }

    var range = lib.parsePeriodRange(periodText);
    if (!range) {
      console.warn('[flex-pacer] failed to parse period range text:', periodText);
      return;
    }

    var remainingMinutes = lib.extractRequiredRemainingMinutes(widgetElement.textContent || '');
    if (remainingMinutes === null) {
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
