(function () {
  var lib = window.FlexPacerLib;
  var BANNER_ID = 'flex-pacer-banner';
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

  function insertOrUpdateBanner(message) {
    var banner = document.getElementById(BANNER_ID);
    if (banner) {
      if (banner.textContent !== message) {
        banner.textContent = message;
      }
      return;
    }
    var main = document.querySelector('main[data-scope="page"][data-part="main"]');
    if (!main) return;
    banner = document.createElement('div');
    banner.id = BANNER_ID;
    banner.className = 'flex-pacer-banner';
    banner.textContent = message;
    main.insertBefore(banner, main.firstChild);
  }

  function insertOrUpdateCompactIndicator(widgetElement, message) {
    var compact = document.getElementById(COMPACT_ID);
    if (compact) {
      if (compact.textContent !== message) {
        compact.textContent = message;
      }
      return;
    }
    var wrapper = widgetElement.parentElement;
    if (!wrapper) return;
    var computedPosition = window.getComputedStyle(wrapper).position;
    if (computedPosition === 'static' || !computedPosition) {
      wrapper.style.position = 'relative';
    }
    compact = document.createElement('div');
    compact.id = COMPACT_ID;
    compact.className = 'flex-pacer-compact';
    compact.textContent = message;
    wrapper.appendChild(compact);
  }

  function render() {
    var periodText = findPeriodRangeText();
    var widgetElement = findWidgetElement();
    var dayInfos = findDayInfos();

    if (!periodText || !widgetElement || dayInfos.length === 0) {
      console.warn('[flex-pacer] required page elements not found, skipping banner');
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

    insertOrUpdateBanner(lib.buildBannerMessage(remainingMinutes, remainingDays));
    insertOrUpdateCompactIndicator(widgetElement, lib.buildCompactMessage(remainingMinutes, remainingDays));
  }

  function scheduleRender() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(render, DEBOUNCE_MS);
  }

  var observer = new MutationObserver(scheduleRender);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  scheduleRender();
})();
