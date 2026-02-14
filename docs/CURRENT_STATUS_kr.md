# 현재 구현 상태 및 전환 TODO (KR)

마지막 업데이트: 2026-02-14

## 1. 현재 코드 상태 (사실 기준)
- 현재 런타임은 `claim 제출 -> epoch aggregate 생성 -> intent` 파이프라인이다.
- claim은 `crawl/evidence` payload 기반이며, README의 새 수식 모델(`target weight claim`)과 불일치한다.
- relayer, sdk, agents, openfunderse 문서/코드 대부분이 레거시 claim 의미를 전제로 동작한다.

## 2. 이제 기준으로 삼을 문서
- 단일 전환 기준: `docs/CLAIM_REDESIGN_V1_kr.md`
- 레거시 호환 유지 정책: 없음(no-legacy)

## 3. 즉시 실행할 전환 작업
### 3.1 P0 (연쇄의 시작점)
- SDK claim 타입/해시를 `AllocationClaimV1`으로 교체
- relayer DB 스키마를 allocation/epoch/settlement 중심으로 교체
- relayer API에서 `/attestations`, `/snapshots/latest` 제거 (`/claims`는 AllocationClaimV1 제출 경로로 유지)

### 3.2 P1
- agents participant/strategy 플로우를 새 API로 교체
- openfunderse skill/prompt를 새 claim semantics로 동기화
- postman/smoke 스크립트 전면 교체

### 3.3 P2
- contracts `snapshotHash` 의존 제거 및 새 epoch state hash 체계 반영
- vault reward mint 정산 엔트리포인트 추가
- E2E/운영 runbook 전면 교체

## 4. 블로커/주의사항
- no-legacy 전환으로 기존 클라이언트/스크립트가 즉시 깨진다.
- relayer schema 변경은 마이그레이션 SQL + 데이터 초기화 전략을 같이 가져가야 한다.
- contracts 인터페이스 변경 시 factory/배포 스크립트/relayer ABI를 동시 갱신해야 한다.

## 5. 완료 판단 기준
- 레거시 claim 필드(`sourceRef/extracted/evidenceURI`) 코드/DB/API 제거 완료
- 새 claim 제출/집계/정산/민팅 흐름 E2E 통과
- README 수식과 런타임 데이터 모델 간 1:1 대응 확인
