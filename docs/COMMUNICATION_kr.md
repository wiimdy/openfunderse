# 커뮤니케이션/협업 운영 (Telegram + GitHub)

텔레그램은 빠른 대화에 강하지만, "할 일/결정/진척"을 누적 관리하기엔 구조가 약합니다.
그래서 **Source of Truth를 GitHub로 두고**, 텔레그램은 실시간 조율에만 쓰는 운영을 권장합니다.

## 원칙 (핵심 5줄)
- 할 일은 **무조건 Issue**로 남긴다(대화로 끝내지 않기).
- 1개 이슈 = 1명 오너(명확한 책임).
- 완료 조건은 **Acceptance Criteria**로 정의한다.
- 합의/설계 변경은 **ADR(결정 기록)** 로 남긴다.
- Blocker는 바로 `status/blocked` 라벨 + 이슈에 적는다.

## 텔레그램 운영 룰
권장 채널/토픽(가능하면 Topics/포럼 모드):
- announcements: 공지/링크 모음(핀)
- dev: 일반 개발 대화
- contracts: 온체인/컨트랙트
- agents: crawler/verifier/strategy
- blockers: 막힌 것, 의존성
- demo: 데모 스크립트/영상/발표

텔레그램에서 새로운 작업이 나오면:
- "이거 해야함"이 나오면 즉시 Issue를 만들고 링크를 공유합니다.
- 이후 논의는 **Issue 링크 기준**으로 이어갑니다.

## 매일 스탠드업(1인 1메시지 템플릿)
```
Yesterday:
Today:
Blockers:
```

## 이슈 작성 템플릿(사람이 직접)
- Title: `[Task] ...` / `[Bug] ...` / `[Protocol] ...`
- Goal: 결과 중심 1~3문장
- Acceptance Criteria: 체크리스트 2~5개
- Owner: 1명
- Links: 관련 문서/텔레그램 메시지/자료

## PR 운영 룰
- PR은 가능하면 작게 쪼갭니다.
- PR 본문에 `Fixes #123`를 넣어 자동 연결/자동 close를 유도합니다.
- 데모/심사 관점에서 "작동"이 바뀌면 docs 업데이트를 같이 합니다.

