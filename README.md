# flex-work-hours-pacer

[flex.team](https://flex.team) 근무 페이지(`내 근무` > `my-work-record`)에서, 이번 정산기간에 하루 평균 얼마나 더 일해야 하는지를 계산해서 화면에 바로 보여주는 Firefox/Chrome 브라우저 확장 프로그램입니다.

`133:03` 실근무시간 위젯 바로 아래에 `Need Xh Ym/day (Nd)` 형태로 작게 표시됩니다. 괄호 안은 남은 근무일수로, 계산이 조용히 틀렸을 때 눈으로 바로 확인하기 위한 값입니다.

## 어떻게 계산하나요

DOM을 읽지 않고 flex.team이 페이지를 그릴 때 쓰는 내부 API를 같은 오리진으로 호출합니다. 로그인 쿠키가 그대로 붙으므로 별도 인증 처리는 없습니다.

- **신원**: 쿠키 `V2_CUSTOMER_INFO`의 `userIdHash`
- **정산기간**: `work-rule/.../working-periods/by-timestamp-range` -> `startDate` / `endDateInclusive`
- **잔여 필수 근무시간**: `time-tracking/.../work-schedules/summary/by-working-period`의 `resultForFullFlexible.requiredWorkingMinutes`. 그 필드가 없는 근무제에서는 `requiredAgreedWorkingMinutes - totalRecognizedWorkingMinutes`로 같은 값을 만듭니다.
- **남은 근무일수**: 오늘(포함)부터 정산기간 종료일까지, 아래에 해당하지 않는 날을 셉니다.
  - `work-schedules/date-attributes`의 `dayOffs[].type` -> `REST_DAY`(토) / `WEEKLY_HOLIDAY`(일) / `CUSTOM_HOLIDAY`(공휴일, 대체공휴일)
  - `work-schedules`의 `timeBlocks[].type`이 `*TIME_OFF` -> 연차 등. 미래에 등록한 연차도 여기서 잡힙니다.
  - 같은 `timeBlocks`에서 계산한 인정근무(`WORK` 합계 - `REST` 합계)가 0보다 큰 날 -> 그 시간은 이미 잔여 필수에서 빠져 있으므로 분모에서도 제외
  - 예외: 끝 타임스탬프가 없는 `WORK` 블록이 있으면 근무 중으로 보고 포함합니다.
- **하루 평균 필요시간** = 잔여 필수 근무시간 / 남은 근무일수 (올림)

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

`src/flex-api.js`와 `src/content.js`는 실제 flex.team 세션(쿠키, 내부 API, 지표를 끼워넣을 DOM 위치)에 의존하는 부분이라 자동화 테스트 없이, 브라우저에 로드해서 콘솔의 `[flex-pacer]` 로그로 확인합니다.

계산 로직 검증은 실제 API 응답을 브라우저 콘솔에서 파일로 저장해 로컬에서 돌려보는 방식으로 했습니다. 응답에는 개인 근무기록이 들어있어 저장소에 커밋하지 않고, `test/fixtures`에는 같은 모양의 합성 데이터만 둡니다.

## 파일 구조

```
manifest.json     확장 프로그램 매니페스트 (Manifest V3)
src/
  pace.js         API 응답 -> 날짜별 근무일 판정 + 하루 평균 계산 (테스트됨)
  flex-api.js     flex.team 내부 API 호출 (쿠키에서 신원 읽기 포함)
  content.js      API 호출 결과를 화면에 표시
  banner.css      표시 스타일
test/
  pace.test.js       계산/포맷 테스트
  api-days.test.js   API 응답 -> 근무일 판정 테스트
  fixtures/          실제 응답과 같은 모양의 합성 픽스처
```

## 알려진 제한사항

- **내부 API에 의존합니다.** 공개 API가 아니라 페이지가 쓰는 엔드포인트를 그대로 호출하므로, flex.team이 스키마나 경로를 바꾸면 동작하지 않습니다. 그 경우 값을 표시하지 않고 콘솔에 경고만 남깁니다.
- `resultForFullFlexible`은 완전선택근로 응답 필드입니다. 다른 근무제에서는 폴백 계산식을 쓰는데, 실제 응답으로 검증하지는 못했습니다.
- 근무 중인 하루는 `timeBlocks`가 빈 배열로 옵니다(2026-08-20 근무 중 실측). 퇴근을 찍어야 블록이 생기므로, 진행 중인 오늘은 인정근무 0으로 잡혀 자연히 남은 근무일에 포함되고 퇴근 시점에 제외됩니다. 끝 타임스탬프가 없는 `WORK` 블록을 근무 중으로 보는 처리도 남겨뒀지만, 실제로 그런 응답은 관측되지 않았습니다(방어용).
- **반차처럼 하루의 일부만 인정되는 항목은 그 날을 통째로 제외합니다.** 실제로는 절반을 더 일할 수 있어서 하루 필요시간이 다소 크게(안전한 방향으로) 나옵니다.
- 진행 중인 오늘 근무는 flex의 인정근무/잔여 필수에 반영되지 않습니다(퇴근 후 반영). 그래서 근무 중에는 표시값이 실제보다 약간 큽니다.
- 정산기간이 두 달에 걸쳐도 API가 `startDate`/`endDateInclusive`를 주므로 문제되지 않습니다. (DOM 방식에 있던 한 달 제약이 없어졌습니다.)
