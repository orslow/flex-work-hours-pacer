# Flex 근무시간 페이스메이커 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** flex.team의 `my-work-record` 페이지에 잔여 필수 근무시간과 남은 근무일 기준 하루 평균 필요 근무시간을 보여주는 배너를 삽입하는 Firefox/Chrome 브라우저 확장 프로그램을 만든다.

**Architecture:** Manifest V3 content-script 전용 확장 프로그램. 순수 계산 로직(`src/pace.js`)과 DOM 추출/렌더링 로직(`src/content.js`)을 분리해서, 계산 로직만 Node 내장 테스트 러너로 TDD한다. 백그라운드 스크립트/popup/storage 권한 없음.

**Tech Stack:** Vanilla JavaScript (ES5 스타일 함수, `var` 사용 — 브라우저 content script와 Node 양쪽에서 트랜스파일 없이 그대로 동작), Node.js 내장 `node:test` + `node:assert/strict` (외부 의존성 없음).

## Global Constraints

- 외부 npm 의존성 추가 금지. 테스트는 Node 내장 `node --test`만 사용한다.
- 빌드 단계 없음. `manifest.json`의 `content_scripts`가 참조하는 파일을 그대로 브라우저가 로드한다.
- Manifest V3 하나로 Firefox와 Chrome 모두에서 수정 없이 동작해야 한다.
- 배너에 표시되는 사용자 대면 텍스트는 한국어로 작성하되, 화살표/가운뎃점 등 ASCII로 표현 가능한 기호는 ASCII 등가물을 쓴다 (`→` 대신 `->`, `·` 대신 `-`).
- background script, popup, 추가 권한(permissions/host_permissions) 없이 `content_scripts.matches`만으로 동작해야 한다.

---

## File Structure

```
flex-work-hours-pacer/
  manifest.json
  package.json
  .gitignore
  src/
    pace.js       (순수 계산 로직, Node에서 테스트됨)
    content.js    (DOM 추출 + MutationObserver + 배너 삽입, 수동 테스트)
    banner.css
  test/
    pace.test.js
```

---

### Task 1: 프로젝트 스캐폴딩 (package.json, manifest.json, .gitignore)

**Files:**
- Create: `package.json`
- Create: `manifest.json`
- Create: `.gitignore`

**Interfaces:**
- Consumes: 없음
- Produces: `content_scripts`가 `src/pace.js`, `src/content.js`, `src/banner.css`를 순서대로 로드하도록 정의된 `manifest.json`. 이후 모든 태스크가 이 파일 경로를 그대로 사용한다.

- [ ] **Step 1: package.json 작성**

```json
{
  "name": "flex-work-hours-pacer",
  "version": "0.1.0",
  "private": true,
  "description": "flex.team 근무 페이지에서 잔여 필수 근무시간 기준 하루 평균 근무시간을 계산해 배너로 보여주는 브라우저 확장 프로그램",
  "scripts": {
    "test": "node --test test/"
  }
}
```

- [ ] **Step 2: manifest.json 작성**

```json
{
  "manifest_version": 3,
  "name": "Flex 근무시간 페이스메이커",
  "version": "0.1.0",
  "description": "flex.team 내 근무 페이지에서 잔여 필수 근무시간과 남은 근무일 기준 하루 평균 근무시간을 배너로 보여줍니다.",
  "content_scripts": [
    {
      "matches": ["https://flex.team/time-tracking/my-work-record*"],
      "js": ["src/pace.js", "src/content.js"],
      "css": ["src/banner.css"],
      "run_at": "document_idle"
    }
  ],
  "browser_specific_settings": {
    "gecko": {
      "id": "flex-work-hours-pacer@jueon.park"
    }
  }
}
```

- [ ] **Step 3: .gitignore 작성**

```
node_modules/
*.log
```

- [ ] **Step 4: manifest.json이 유효한 JSON인지 확인**

Run: `node -e "JSON.parse(require('fs').readFileSync('manifest.json', 'utf8')); console.log('valid json')"`
Expected: `valid json`

- [ ] **Step 5: Commit**

```bash
git add package.json manifest.json .gitignore
git commit -m "chore: scaffold extension project (manifest, package.json)"
```

---

### Task 2: pace.js — 시간 문자열 파싱 (parseTimeToMinutes, extractRequiredRemainingMinutes)

**Files:**
- Create: `src/pace.js`
- Test: `test/pace.test.js`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `FlexPacerLib.parseTimeToMinutes(token: string): number | null` — `"36:03"` -> `2163`, `"-36:03"` -> `-2163`, 파싱 불가시 `null`
  - `FlexPacerLib.extractRequiredRemainingMinutes(widgetText: string): number | null` — 텍스트 안에서 처음 나오는 음수 `HH:MM` 값의 절대값(분)을 반환, 없으면 `null`

- [ ] **Step 1: 실패하는 테스트 작성**

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const lib = require('../src/pace.js');

test('parseTimeToMinutes parses positive HH:MM', () => {
  assert.equal(lib.parseTimeToMinutes('36:03'), 36 * 60 + 3);
});

test('parseTimeToMinutes parses negative HH:MM', () => {
  assert.equal(lib.parseTimeToMinutes('-36:03'), -(36 * 60 + 3));
});

test('parseTimeToMinutes returns null for invalid input', () => {
  assert.equal(lib.parseTimeToMinutes('not-a-time'), null);
});

test('extractRequiredRemainingMinutes picks the first negative value', () => {
  const text = '133:03\n-36:03\n-99:09';
  assert.equal(lib.extractRequiredRemainingMinutes(text), 36 * 60 + 3);
});

test('extractRequiredRemainingMinutes returns null when no negative value is present', () => {
  assert.equal(lib.extractRequiredRemainingMinutes('133:03'), null);
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `node --test test/pace.test.js`
Expected: FAIL — `Cannot find module '../src/pace.js'`

- [ ] **Step 3: 최소 구현 작성**

```javascript
function parseTimeToMinutes(token) {
  var m = /^(-)?(\d{1,3}):(\d{2})$/.exec(String(token).trim());
  if (!m) return null;
  var sign = m[1] ? -1 : 1;
  var hours = parseInt(m[2], 10);
  var mins = parseInt(m[3], 10);
  return sign * (hours * 60 + mins);
}

function extractRequiredRemainingMinutes(widgetText) {
  var matches = String(widgetText).match(/-?\d{1,3}:\d{2}/g);
  if (!matches) return null;
  for (var i = 0; i < matches.length; i++) {
    var value = parseTimeToMinutes(matches[i]);
    if (value !== null && value < 0) {
      return Math.abs(value);
    }
  }
  return null;
}

var FlexPacerLib = {
  parseTimeToMinutes: parseTimeToMinutes,
  extractRequiredRemainingMinutes: extractRequiredRemainingMinutes,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FlexPacerLib;
} else {
  (typeof window !== 'undefined' ? window : globalThis).FlexPacerLib = FlexPacerLib;
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `node --test test/pace.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/pace.js test/pace.test.js
git commit -m "feat: parse required-remaining minutes from widget text"
```

---

### Task 3: pace.js — 정산기간 파싱 (parsePeriodRange, stripTime)

**Files:**
- Modify: `src/pace.js`
- Modify: `test/pace.test.js`

**Interfaces:**
- Consumes: 없음 (독립 함수)
- Produces:
  - `FlexPacerLib.parsePeriodRange(periodText: string): {startDate: Date, endDate: Date} | null`
  - `FlexPacerLib.stripTime(d: Date): Date` — 시/분/초를 0으로 만든 같은 날짜의 Date

- [ ] **Step 1: 실패하는 테스트 추가**

`test/pace.test.js`에 아래 테스트를 파일 끝에 추가:

```javascript
test('parsePeriodRange parses a same-year range', () => {
  const range = lib.parsePeriodRange('2026. 7. 1 – 7. 31');
  assert.equal(range.startDate.getFullYear(), 2026);
  assert.equal(range.startDate.getMonth(), 6);
  assert.equal(range.startDate.getDate(), 1);
  assert.equal(range.endDate.getFullYear(), 2026);
  assert.equal(range.endDate.getMonth(), 6);
  assert.equal(range.endDate.getDate(), 31);
});

test('parsePeriodRange rolls the end year over when the end month is earlier', () => {
  const range = lib.parsePeriodRange('2026. 12. 21 – 1. 20');
  assert.equal(range.endDate.getFullYear(), 2027);
  assert.equal(range.endDate.getMonth(), 0);
  assert.equal(range.endDate.getDate(), 20);
});

test('parsePeriodRange returns null for unrecognized text', () => {
  assert.equal(lib.parsePeriodRange('아무 텍스트'), null);
});

test('stripTime zeroes out the time-of-day', () => {
  const d = lib.stripTime(new Date(2026, 6, 24, 15, 30, 0));
  assert.equal(d.getHours(), 0);
  assert.equal(d.getMinutes(), 0);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 6);
  assert.equal(d.getDate(), 24);
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `node --test test/pace.test.js`
Expected: FAIL — `lib.parsePeriodRange is not a function`

- [ ] **Step 3: 구현 추가**

`src/pace.js`에서 `module.exports`/`window` 블록 바로 위에 아래 함수를 추가하고, `FlexPacerLib` 객체에 두 키를 추가한다:

```javascript
function parsePeriodRange(periodText) {
  var m = /(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\s*[–-]\s*(\d{1,2})\.\s*(\d{1,2})/.exec(String(periodText));
  if (!m) return null;
  var startYear = parseInt(m[1], 10);
  var startMonth = parseInt(m[2], 10);
  var startDay = parseInt(m[3], 10);
  var endMonth = parseInt(m[4], 10);
  var endDay = parseInt(m[5], 10);
  var endYear = endMonth < startMonth ? startYear + 1 : startYear;
  return {
    startDate: new Date(startYear, startMonth - 1, startDay),
    endDate: new Date(endYear, endMonth - 1, endDay),
  };
}

function stripTime(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
```

`FlexPacerLib` 객체 리터럴을 아래와 같이 갱신:

```javascript
var FlexPacerLib = {
  parseTimeToMinutes: parseTimeToMinutes,
  extractRequiredRemainingMinutes: extractRequiredRemainingMinutes,
  parsePeriodRange: parsePeriodRange,
  stripTime: stripTime,
};
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `node --test test/pace.test.js`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/pace.js test/pace.test.js
git commit -m "feat: parse settlement period start/end date"
```

---

### Task 4: pace.js — 남은 근무일 계산 (countRemainingWorkDays)

**Files:**
- Modify: `src/pace.js`
- Modify: `test/pace.test.js`

**Interfaces:**
- Consumes: `stripTime` (Task 3에서 정의)
- Produces: `FlexPacerLib.countRemainingWorkDays(dayInfos: Array<{date: Date, isHoliday: boolean}>, today: Date, endDate: Date): number` — 오늘 포함, `endDate` 포함, `isHoliday`가 아닌 날짜 개수

- [ ] **Step 1: 실패하는 테스트 추가**

`test/pace.test.js` 끝에 추가:

```javascript
test('countRemainingWorkDays counts non-holiday days from today through endDate inclusive', () => {
  const dayInfos = [
    { date: new Date(2026, 6, 24), isHoliday: false },
    { date: new Date(2026, 6, 25), isHoliday: true },
    { date: new Date(2026, 6, 26), isHoliday: true },
    { date: new Date(2026, 6, 27), isHoliday: false },
    { date: new Date(2026, 6, 28), isHoliday: false },
    { date: new Date(2026, 6, 29), isHoliday: false },
    { date: new Date(2026, 6, 30), isHoliday: false },
    { date: new Date(2026, 6, 31), isHoliday: false },
  ];
  const today = new Date(2026, 6, 24, 9, 0, 0);
  const endDate = new Date(2026, 6, 31);
  assert.equal(lib.countRemainingWorkDays(dayInfos, today, endDate), 6);
});

test('countRemainingWorkDays ignores days before today', () => {
  const dayInfos = [
    { date: new Date(2026, 6, 20), isHoliday: false },
    { date: new Date(2026, 6, 24), isHoliday: false },
  ];
  const today = new Date(2026, 6, 24);
  const endDate = new Date(2026, 6, 31);
  assert.equal(lib.countRemainingWorkDays(dayInfos, today, endDate), 1);
});

test('countRemainingWorkDays returns 0 when no matching days exist', () => {
  const dayInfos = [{ date: new Date(2026, 6, 25), isHoliday: true }];
  const today = new Date(2026, 6, 24);
  const endDate = new Date(2026, 6, 31);
  assert.equal(lib.countRemainingWorkDays(dayInfos, today, endDate), 0);
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `node --test test/pace.test.js`
Expected: FAIL — `lib.countRemainingWorkDays is not a function`

- [ ] **Step 3: 구현 추가**

`src/pace.js`에서 `stripTime` 함수 뒤, export 블록 앞에 추가:

```javascript
function countRemainingWorkDays(dayInfos, today, endDate) {
  var todayStripped = stripTime(today);
  var endStripped = stripTime(endDate);
  var count = 0;
  for (var i = 0; i < dayInfos.length; i++) {
    var d = stripTime(dayInfos[i].date);
    if (
      d.getTime() >= todayStripped.getTime() &&
      d.getTime() <= endStripped.getTime() &&
      !dayInfos[i].isHoliday
    ) {
      count++;
    }
  }
  return count;
}
```

`FlexPacerLib` 객체에 `countRemainingWorkDays: countRemainingWorkDays,` 추가.

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `node --test test/pace.test.js`
Expected: PASS (12 tests)

- [ ] **Step 5: Commit**

```bash
git add src/pace.js test/pace.test.js
git commit -m "feat: count remaining non-holiday work days"
```

---

### Task 5: pace.js — 페이스 계산 및 배너 문구 생성 (computePace, formatMinutesAsHM, buildBannerMessage)

**Files:**
- Modify: `src/pace.js`
- Modify: `test/pace.test.js`

**Interfaces:**
- Consumes: 없음 (독립 함수)
- Produces:
  - `FlexPacerLib.computePace(remainingMinutes: number, remainingDays: number): {status: 'done'} | {status: 'noDaysLeft'} | {status: 'ok', dailyMinutes: number}`
  - `FlexPacerLib.formatMinutesAsHM(minutes: number): string`
  - `FlexPacerLib.buildBannerMessage(remainingMinutes: number, remainingDays: number): string` — Task 6(content.js)이 배너 텍스트를 얻기 위해 호출하는 최종 진입점

- [ ] **Step 1: 실패하는 테스트 추가**

`test/pace.test.js` 끝에 추가:

```javascript
test('computePace returns done when remainingMinutes is zero or negative', () => {
  assert.deepEqual(lib.computePace(0, 5), { status: 'done' });
  assert.deepEqual(lib.computePace(-10, 5), { status: 'done' });
});

test('computePace returns noDaysLeft when remainingDays is zero or negative and time is still owed', () => {
  assert.deepEqual(lib.computePace(120, 0), { status: 'noDaysLeft' });
});

test('computePace returns ok with ceil-rounded dailyMinutes', () => {
  assert.deepEqual(lib.computePace(100, 3), { status: 'ok', dailyMinutes: 34 });
});

test('formatMinutesAsHM formats hours and minutes', () => {
  assert.equal(lib.formatMinutesAsHM(2163), '36시간 3분');
});

test('formatMinutesAsHM formats whole hours without a minutes part', () => {
  assert.equal(lib.formatMinutesAsHM(120), '2시간');
});

test('formatMinutesAsHM formats minutes only when under an hour', () => {
  assert.equal(lib.formatMinutesAsHM(45), '45분');
});

test('buildBannerMessage builds the ok message', () => {
  assert.equal(
    lib.buildBannerMessage(2163, 6),
    '잔여 36시간 3분 - 남은 근무일 6일 -> 하루 평균 6시간 1분씩 더 일하면 됩니다'
  );
});

test('buildBannerMessage builds the done message', () => {
  assert.equal(
    lib.buildBannerMessage(0, 3),
    '이번 정산기간 필수 근무시간을 이미 채우셨습니다 🎉'
  );
});

test('buildBannerMessage builds the noDaysLeft message', () => {
  assert.equal(
    lib.buildBannerMessage(60, 0),
    '이번 정산기간 근무 가능일이 모두 지났습니다.'
  );
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `node --test test/pace.test.js`
Expected: FAIL — `lib.computePace is not a function`

- [ ] **Step 3: 구현 추가**

`src/pace.js`에서 `countRemainingWorkDays` 함수 뒤, export 블록 앞에 추가:

```javascript
function computePace(remainingMinutes, remainingDays) {
  if (remainingMinutes <= 0) return { status: 'done' };
  if (remainingDays <= 0) return { status: 'noDaysLeft' };
  return { status: 'ok', dailyMinutes: Math.ceil(remainingMinutes / remainingDays) };
}

function formatMinutesAsHM(minutes) {
  var hours = Math.floor(minutes / 60);
  var mins = minutes % 60;
  if (hours === 0) return mins + '분';
  if (mins === 0) return hours + '시간';
  return hours + '시간 ' + mins + '분';
}

function buildBannerMessage(remainingMinutes, remainingDays) {
  var pace = computePace(remainingMinutes, remainingDays);
  if (pace.status === 'done') {
    return '이번 정산기간 필수 근무시간을 이미 채우셨습니다 🎉';
  }
  if (pace.status === 'noDaysLeft') {
    return '이번 정산기간 근무 가능일이 모두 지났습니다.';
  }
  return (
    '잔여 ' + formatMinutesAsHM(remainingMinutes) +
    ' - 남은 근무일 ' + remainingDays + '일' +
    ' -> 하루 평균 ' + formatMinutesAsHM(pace.dailyMinutes) + '씩 더 일하면 됩니다'
  );
}
```

`FlexPacerLib` 객체에 세 키 추가:

```javascript
var FlexPacerLib = {
  parseTimeToMinutes: parseTimeToMinutes,
  extractRequiredRemainingMinutes: extractRequiredRemainingMinutes,
  parsePeriodRange: parsePeriodRange,
  stripTime: stripTime,
  countRemainingWorkDays: countRemainingWorkDays,
  computePace: computePace,
  formatMinutesAsHM: formatMinutesAsHM,
  buildBannerMessage: buildBannerMessage,
};
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `node --test test/pace.test.js`
Expected: PASS (20 tests)

- [ ] **Step 5: Commit**

```bash
git add src/pace.js test/pace.test.js
git commit -m "feat: compute daily pace and build banner message"
```

---

### Task 6: content.js — DOM 추출/배너 렌더링 + banner.css

**Files:**
- Create: `src/content.js`
- Create: `src/banner.css`

**Interfaces:**
- Consumes: `window.FlexPacerLib`의 `parsePeriodRange`, `extractRequiredRemainingMinutes`, `countRemainingWorkDays`, `buildBannerMessage` (Task 2~5)
- Produces: 페이지에 `id="flex-pacer-banner"`인 배너 엘리먼트. 자동화 테스트 없음 — 브라우저 수동 테스트로 검증한다.

- [ ] **Step 1: banner.css 작성**

```css
.flex-pacer-banner {
  background: #eef6ff;
  color: #1a3a5c;
  border: 1px solid #b8d9f7;
  border-radius: 8px;
  padding: 10px 14px;
  margin: 12px 0;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
}
```

- [ ] **Step 2: content.js 작성**

```javascript
(function () {
  var lib = window.FlexPacerLib;
  var BANNER_ID = 'flex-pacer-banner';
  var DEBOUNCE_MS = 250;
  var debounceTimer = null;

  function findPeriodRangeText() {
    var bodyText = document.body.innerText;
    var m = /\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\s*[–-]\s*\d{1,2}\.\s*\d{1,2}/.exec(bodyText);
    return m ? m[0] : null;
  }

  function findWidgetText() {
    var triggers = document.querySelectorAll('[data-scope="hover-visible"][data-part="trigger"]');
    for (var i = 0; i < triggers.length; i++) {
      var text = triggers[i].textContent || '';
      var matches = text.match(/-?\d{1,3}:\d{2}/g);
      if (matches && matches.length >= 2) {
        return text;
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

  function render() {
    var periodText = findPeriodRangeText();
    var widgetText = findWidgetText();
    var dayInfos = findDayInfos();

    if (!periodText || !widgetText || dayInfos.length === 0) {
      console.warn('[flex-pacer] required page elements not found, skipping banner');
      return;
    }

    var range = lib.parsePeriodRange(periodText);
    if (!range) {
      console.warn('[flex-pacer] failed to parse period range text:', periodText);
      return;
    }

    var remainingMinutes = lib.extractRequiredRemainingMinutes(widgetText);
    if (remainingMinutes === null) {
      console.warn('[flex-pacer] failed to parse remaining required minutes');
      return;
    }

    var dayDates = buildDayDates(dayInfos, range.startDate);
    var remainingDays = lib.countRemainingWorkDays(dayDates, new Date(), range.endDate);
    var message = lib.buildBannerMessage(remainingMinutes, remainingDays);
    insertOrUpdateBanner(message);
  }

  function scheduleRender() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(render, DEBOUNCE_MS);
  }

  var observer = new MutationObserver(scheduleRender);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  scheduleRender();
})();
```

- [ ] **Step 3: Firefox에 임시로 로드**

1. Firefox 주소창에 `about:debugging#/runtime/this-firefox` 입력
2. "임시 부가 기능 로드..." 클릭
3. `~/Documents/git/flex-work-hours-pacer/manifest.json` 선택

Expected: 에러 없이 로드됨 (확장 프로그램 목록에 "Flex 근무시간 페이스메이커" 표시)

- [ ] **Step 4: 실제 페이지에서 배너 확인**

1. `https://flex.team/time-tracking/my-work-record` 접속 (로그인 필요)
2. 페이지 헤더(기간 선택 영역) 바로 아래에 파란 배경 배너가 보이는지 확인
3. F12로 개발자 도구 콘솔을 열어 `[flex-pacer]` 경고가 없는지 확인
4. 배너에 표시된 시간/일수가 화면에 실제로 보이는 위젯 값(`133:03` 근처의 첫 번째 음수 값)과 일치하는지 수동으로 계산해 대조

Expected: 배너가 보이고, 숫자가 실제 페이지 값과 일치함. 콘솔에 경고 없음.

- [ ] **Step 5: Commit**

```bash
git add src/content.js src/banner.css
git commit -m "feat: render pace banner on the flex.team work-record page"
```

---

### Task 7: Chrome 교차 검증 및 마무리

**Files:**
- 없음 (검증 전용 태스크)

**Interfaces:**
- Consumes: Task 6까지 완성된 확장 프로그램 전체
- Produces: Firefox/Chrome 양쪽에서 검증된, 배포 가능한 상태의 저장소

- [ ] **Step 1: Chrome에 압축해제된 확장 프로그램으로 로드**

1. Chrome 주소창에 `chrome://extensions` 입력
2. 우측 상단 "개발자 모드" 켜기
3. "압축해제된 확장 프로그램을 로드합니다" 클릭 → `~/Documents/git/flex-work-hours-pacer` 폴더 선택

Expected: 에러 없이 로드됨

- [ ] **Step 2: Chrome에서 동일하게 배너 확인**

Task 6 Step 4와 동일한 절차를 Chrome에서 반복 수행.

Expected: Firefox와 동일한 배너/숫자가 표시됨

- [ ] **Step 3: 전체 테스트 스위트 최종 실행**

Run: `npm test`
Expected: PASS (20 tests)

- [ ] **Step 4: Commit (변경 사항이 있는 경우에만)**

```bash
git status
```

변경된 파일이 있다면:

```bash
git add -A
git commit -m "chore: final verification pass"
```
