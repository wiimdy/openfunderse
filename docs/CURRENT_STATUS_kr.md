# 현재 구현 상태 및 전환 TODO (KR)

마지막 업데이트: 2026-02-14

## 1. 현재 코드 상태 (사실 기준)
- 현재 MVP 런타임은 `targetWeights claim 제출 -> epoch aggregate -> intent propose -> intent attestation -> ready-execution` 파이프라인이다.
- 데모 목적은 공동투자/공동의사결정(intent 생성/검증)이며, reward/mint 정산은 수식 TODO로 남겨둔다.
- `/api/v1/cron/execute-intents` 는 keyless 모드에서 비활성화(410), 전략 AA가 onchain execute를 수행한다.

## 2. 이제 기준으로 삼을 문서
- 단일 전환 기준: `docs/CLAIM_REDESIGN_V1_kr.md`
- 레거시 호환 유지 정책: 없음(no-legacy)

## 3. MVP 데모 체크리스트
- [ ] `POST /api/v1/funds/{fundId}/claims` 로 participant 1+ (가능하면 2명) claim 제출
- [ ] `POST /api/v1/funds/{fundId}/epochs/{epochId}/aggregate` 성공 및 `epochStateHash` 생성
- [ ] `POST /api/v1/funds/{fundId}/intents/propose` 성공
- [ ] `POST /api/v1/funds/{fundId}/intents/attestations/batch` 후 threshold 도달
- [ ] `GET /api/v1/funds/{fundId}/intents/ready-execution` 에 실행 payload 노출
- [ ] reward/mint settlement는 TODO(미구현)로 데모 설명에 명시

## 4. 블로커/주의사항
- no-legacy 전환으로 기존 클라이언트/스크립트가 즉시 깨진다.
- relayer schema 변경은 마이그레이션 SQL + 데이터 초기화 전략을 같이 가져가야 한다.
- contracts 인터페이스 변경 시 factory/배포 스크립트/relayer ABI를 동시 갱신해야 한다.

## 5. 완료 판단 기준 (MVP)
- 공동 claim 제출 -> 집계 -> intent 생성/검증 흐름이 API 기준으로 재현 가능
- `status` 응답에서 reward model 미구현(`TODO`)가 명시됨
- README 수식 중 reward/mint는 문서 TODO, 런타임은 intent 데모 범위로 일치
