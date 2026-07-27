# flex-work-hours-pacer

[flex.team](https://flex.team) 근무 페이지(`내 근무` > `my-work-record`)에서, 이번 정산기간에 하루 평균 얼마나 더 일해야 하는지를 계산해서 화면에 바로 보여주는 Firefox/Chrome 브라우저 확장 프로그램입니다.

`133:03` 실근무시간 위젯 바로 아래에 `Need Xh Ym/day` 형태로 작게 표시됩니다.

## 어떻게 계산하나요

- **잔여 필수 근무시간**: 근무 위젯에 표시되는 값(예: `-36:03`)을 그대로 사용합니다.
- **남은 근무일수**: 캘린더에서 오늘(포함)부터 정산기간 종료일까지, 휴일이 아닌 날짜 수를 셉니다.
- **하루 평균 필요시간** = 잔여 필수 근무시간 / 남은 근무일수

페이지 마크업이 바뀌어 필요한 값을 못 찾으면 아무것도 표시하지 않고 콘솔에 경고만 남깁니다(잘못된 숫자를 보여주지 않기 위함).

자세한 설계는 [`docs/superpowers/specs`](docs/superpowers/specs), 구현 계획은 [`docs/superpowers/plans`](docs/superpowers/plans)를 참고하세요.

## 설치 (개발자 모드로 로컬 로드)

이 저장소는 스토어에 배포하지 않고, 로컬에서 직접 로드해서 사용하는 걸 전제로 합니다.

### Firefox

1. `about:debugging#/runtime/this-firefox` 접속
2. **"임시 부가 기능 로드..."** 클릭
3. 이 저장소의 `manifest.json` 파일 선택

### Chrome

1. `chrome://extensions` 접속
2. 우측 상단 **"개발자 모드"** 켜기
3. **"압축해제된 확장 프로그램을 로드합니다"** 클릭 → 이 저장소 폴더 선택

두 브라우저 모두 임시/개발자 모드 로드이므로, 브라우저를 재시작하면 다시 로드해야 합니다.

## 개발

순수 계산 로직(`src/pace.js`)은 Node.js 내장 테스트 러너로 테스트합니다. 외부 의존성은 없습니다.

```bash
npm test
```

`src/content.js`는 실제 flex.team 페이지 DOM에 의존하는 부분이라 자동화 테스트 없이, 브라우저에 로드해서 수동으로 확인합니다.

## 파일 구조

```
manifest.json     확장 프로그램 매니페스트 (Manifest V3)
src/
  pace.js         잔여 시간/남은 근무일/하루 평균 계산 (테스트됨)
  content.js      페이지 DOM에서 값 추출 + 화면에 표시
  banner.css      표시 스타일
test/
  pace.test.js    pace.js 테스트
```

## 알려진 제한사항

- 정산기간이 한 달(달력 뷰 한 화면)을 벗어나는 경우는 지원하지 않습니다.
- flex.team의 CSS 클래스명은 해시 기반이라 배포마다 바뀔 수 있어, 가능한 한 `data-scope`/`data-part` 속성과 텍스트 패턴에 의존하도록 만들었지만 페이지 구조가 크게 바뀌면 동작하지 않을 수 있습니다.
