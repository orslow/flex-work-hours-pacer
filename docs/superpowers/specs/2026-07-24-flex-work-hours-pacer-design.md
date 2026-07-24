# flex.team 근무시간 페이스메이커 확장 프로그램 - 설계

## 목적

`flex.team/time-tracking/my-work-record` 페이지에 접속했을 때, 이번 정산기간의 잔여 필수 근무시간을 남은 근무일수로 나눠 "하루 평균 몇 시간 더 일해야 하는지"를 페이지에 배너로 보여주는 브라우저 확장 프로그램. Firefox를 우선 타깃으로 하되 Chrome도 동일하게 동작해야 한다.

개인용 도구이며 Jira 티켓 없이 진행한다.

## 아키텍처

콘텐츠 스크립트 전용 구조. 백그라운드 스크립트, popup, storage 권한 모두 사용하지 않는다 — 페이지에 배너 하나만 삽입하면 되므로 이것이 최소 구성이다.

Manifest V3 하나로 Firefox와 Chrome을 모두 지원한다. Firefox도 MV3의 `content_scripts`는 문제없이 지원하므로, `manifest.json`에 `browser_specific_settings.gecko`(Firefox용 extension ID)만 추가하면 별도 빌드 없이 동일한 manifest로 양쪽 다 로드 가능하다.

```
manifest.json
  manifest_version: 3
  content_scripts:
    - matches: ["https://flex.team/time-tracking/my-work-record*"]
      js: ["content.js"]
      css: ["banner.css"]
      run_at: "document_idle"
  browser_specific_settings:
    gecko:
      id: "flex-work-hours-pacer@<user>"
```

## 데이터 추출 로직

모두 순수 DOM 파싱이며 API 호출은 하지 않는다. flex.team은 CSS-in-JS(해시 클래스명)를 쓰기 때문에 클래스명은 배포마다 바뀔 수 있다. 따라서 가능한 한 `data-scope`/`data-part` 커스텀 속성과 텍스트 패턴을 우선 사용하고, 해시 클래스명에는 의존하지 않는다.

1. **정산기간 종료일**: 헤더의 기간 선택 버튼(예: `"2026. 7. 1 – 7. 31"`)에서 정규식으로 종료일을 파싱한다.
2. **잔여 필수 근무시간**: `[data-scope="hover-visible"][data-part="trigger"]` 위젯 내부에서 `-?\d{1,3}:\d{2}` 패턴에 매치되는 텍스트를 DOM 순서대로 수집하고, **첫 번째 음수 값**(예: `-36:03`)을 사용한다. (두 번째 음수 값은 "이번 달 최대 근무 가능 시간"이라 사용하지 않는다.)
3. **남은 근무일수**: 캘린더 좌측 날짜 셀 목록에서 클래스명에 `colorType-holiday`가 포함된 날을 휴일로 간주해 제외한다. **오늘(포함)부터 정산기간 종료일까지** 날짜 중 휴일이 아닌 날의 개수를 센다.

## 계산

```
하루 평균 필요시간 = 잔여 필수 근무시간(분) / 남은 근무일수
```

- 남은 근무일수가 0이면: "이번 정산기간 근무 가능일이 모두 지났습니다" 표시
- 잔여 필수 근무시간이 0 이하이면: 축하 메시지로 대체 (예: "이번 정산기간 필수 근무시간을 이미 채우셨습니다 🎉")

## UI

페이지 헤더(기간 선택 영역) 바로 아래에 얇은 배너를 삽입한다.

예: `"잔여 36시간 3분 · 남은 근무일 6일 → 하루 평균 6시간 1분씩 더 일하면 됩니다"`

flex.team은 SPA라 페이지 전체 리로드 없이 콘텐츠가 갱신된다. `MutationObserver`로 헤더/위젯 영역을 계속 감시하다가 텍스트가 바뀌면(예: 실시간 근무 위젯 업데이트, 이전/다음 달 이동) 배너를 재계산한다.

## 에러 처리

위 셀렉터로 필요한 요소를 찾지 못하면(flex.team이 마크업을 변경한 경우) 배너를 표시하지 않고 콘솔에 경고 로그만 남긴다. 잘못된 숫자를 사용자에게 보여주는 것보다 안전한 선택이다.

## 테스트 방법

- Firefox: `about:debugging` → 임시 부가 기능으로 로드
- Chrome: `chrome://extensions` → 압축해제된 확장 프로그램으로 로드
- 실제 flex.team 계정으로 페이지에 접속해, 배너에 표시된 숫자가 화면에 실제로 보이는 값(예: `133:03`, `-36:03`)과 일치하는지 수동으로 대조 확인

## 프로젝트 위치

`~/Documents/git/flex-work-hours-pacer/` (git 레포)
