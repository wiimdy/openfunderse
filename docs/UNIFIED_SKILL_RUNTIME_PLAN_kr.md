# ClawBot 통합 리팩토링 계획 (KR)

마지막 업데이트: 2026-02-14  
목표: 전략 봇 중심 E2E(approved claim/snapshot -> intent -> onchain attest/execute)를 안정적으로 동작시키면서, 사용자 입장에서는 하나의 skill/runtime처럼 보이게 통합한다.

## 1. 결론
- 규격(`SKILL.md` 기반)상 strategy/participant 행위를 하나의 skill로 통합 가능.
- 그러나 코드 레이어(`agents`)와 패키징 레이어(`openfunderse`)는 물리적으로 분리 유지가 바람직.
- 권장 구조:
  - `packages/sdk`: 프로토콜 규격/유틸 단일 소스
  - `packages/agents`: 실행 런타임(실제 동작 코드)
  - `packages/openfunderse`: 설치/배포 진입점(스킬/프롬프트/매니페스트)

## 2. 설계 원칙
1. 단일 진입점: 사용자는 `npx @wiimdy/openfunderse@latest install openfunderse`만 인지
2. 단일 규격: intent/claim/attestation 해시/서명/threshold는 `sdk`만 신뢰
3. fail-closed: relayer/onchain 조건 불충족 시 hold/retry
4. 호환성 유지: 기존 `participant:*`, `strategy:*` 명령은 점진 폐기

## 3. 목표 기능 범위 (현재 단계)
### 3.1 우선 구현(P0)
- 전략 봇이 relayer API에서 attested claim/snapshot을 조회
- 전략 봇이 intent 생성 및 relayer propose
- threshold 도달 후 onchain attestation 제출
- `ClawCore.executeIntent` 실행 시도 및 결과 ack

### 3.2 형식 구현(P1)
- claim 생성/검증은 형식적 경로 유지(고도화는 후속)
- participant는 단일 actor(crawler/verifier 통합 주소) 지원

### 3.3 후속(P2)
- claim 품질/재현성 고도화
- SourceSpec/evidence 정책 고도화
- 운영 알림/자동복구 고도화

## 4. 통합 아키텍처 (코드/배포 분리)
```text
packages/
  sdk/               # canonical schema/hash/signature/weighted-threshold
  agents/            # runtime implementation (strategy/participant/cli/lib)
  openfunderse/      # distribution (skills/prompts/install manifest)
```

핵심 아이디어:
- `openfunderse`는 "스킬 명세 + 설치 UX"
- `agents`는 "실행 엔진"
- 스킬 문서는 `agents` 런타임 명령/액션을 호출하는 계약서 역할

## 5. Skill 단일화 제안
## 5.1 스킬 키
- 단일 스킬: `clawbot-core`
- 내부 role 분기:
  - `role: strategy`
  - `role: participant`

## 5.2 액션 계약 (공통)
- `create_fund_onchain` (strategy)
- `register_fund_bots` (strategy)
- `fetch_attested_claims` (strategy)
- `build_snapshot` (strategy)
- `propose_intent` (strategy)
- `attest_intent_onchain` (strategy)
- `execute_intent_onchain` (strategy)
- `mine_claim` (participant)
- `verify_claim_or_intent_validity` (participant)
- `submit_mined_claim` (participant)

## 5.3 frontmatter 표준화
- `name`, `description`, `version`
- `metadata.openclaw.requires.env`
- `metadata.openclaw.requires.bins`
- `metadata.openclaw.primaryEnv`

## 6. 파일 단위 리팩토링 계획
## 6.1 유지
- `packages/agents/src/skills/participant/index.ts`
- `packages/agents/src/skills/strategy/index.ts`
- `packages/agents/src/lib/relayer-client.ts`
- `packages/agents/src/lib/signer.ts`
- `packages/agents/src/lib/aa-client.ts`

## 6.2 추가
- `packages/agents/src/clawbot-cli.ts`
  - role/action 라우팅 허브 (`clawbot-run`)
- `packages/openfunderse/packs/openfunderse/skills/clawbot-core/SKILL.md`
  - 단일 스킬 계약서
- `packages/openfunderse/packs/openfunderse/prompts/core/system.md`
  - role-aware system prompt

## 6.3 점진 폐기(Deprecated)
- `packages/openfunderse/packs/openfunderse/skills/participant/SKILL.md`
- `packages/openfunderse/packs/openfunderse/skills/strategy/SKILL.md`
- 기존 2스킬 구조는 1~2 릴리즈 동안 alias만 유지

## 7. 명령 체계 통합
현재:
- `participant:*`
- `strategy:*`

목표:
- `clawbot:run --role strategy --action propose_intent ...`
- `clawbot:run --role strategy --action attest_intent_onchain ...`
- `clawbot:run --role strategy --action execute_intent_onchain ...`
- `clawbot:run --role participant --action mine_claim ...`

내부적으로는 기존 `participant-cli`, `strategy-cli`를 호출해 호환성 유지.

## 8. relayer API 연동 기준
전략 봇 필수 경로:
1. `GET /api/v1/funds/{fundId}/claims` (attested/finalized 조회)
2. `POST /api/v1/funds/{fundId}/epochs/{epochId}/aggregate`
3. `GET /api/v1/funds/{fundId}/epochs/latest`
4. `POST /api/v1/funds/{fundId}/intents/propose`
5. `POST /api/v1/funds/{fundId}/intents/attestations/batch` (검증자 제출)
6. `GET /api/v1/funds/{fundId}/intents/{intentHash}/onchain-bundle`
7. `POST /api/v1/funds/{fundId}/intents/{intentHash}/onchain-attested`
8. `GET /api/v1/funds/{fundId}/intents/ready-execution`
9. `POST /api/v1/funds/{fundId}/intents/{intentHash}/onchain-executed|onchain-failed`

참여자 봇 필수 경로:
1. `POST /api/v1/funds/{fundId}/claims`

## 9. 온체인 연동 기준
전략 봇의 온체인 행위:
1. `ClawFundFactory.createFund` (선택: 서버 bootstrap 우회)
2. `IntentBook.proposeIntent` (필요 시)
3. `IntentBook.attestIntent`
4. `ClawCore.executeIntent`

주의:
- relayer intent propose와 onchain propose 경로를 둘 다 쓸 경우 상태 정합성 규칙 필요
- snapshot finalized 여부는 `snapshotBook` 기준으로 맞춰야 함

## 10. 단계별 실행 플랜
### Phase 1 (이번 스프린트)
- 단일 skill 문서(`clawbot-core`) 추가
- 기존 strategy/participant 스킬을 core 스킬에서 참조
- 명령 라우터(`clawbot-run`) 추가
- relayer 전략 경로 smoke 통합 스크립트 추가

## 13. 현재 기준 실행 검증 커맨드
```bash
# 1) 통합 CLI 도움말
npm run clawbot:run -w @claw/agents -- --help

# 2) participant 액션 라우팅 (로컬 파일 검증)
npm run clawbot:run -w @claw/agents -- \
  --role participant \
  --action verify_claim \
  --claim-file /tmp/sample-claim.json

# 3) strategy intent propose (relayer 연동)
npm run clawbot:run -w @claw/agents -- \
  --role strategy \
  --action propose_intent \
  --fund-id demo-fund \
  --intent-file /tmp/intent.json \
  --execution-route-file /tmp/route.json
```

### Phase 2
- `create_fund_onchain` 액션 정식화
- onchain propose/attest/execute state sync 안정화
- 기존 분리 스킬 deprecate 공지

### Phase 3
- participant claim quality 고도화
- SourceSpec/evidence 정책 강화
- 운영 자동화/알림 연동

## 11. 완료 기준 (DoD)
1. 사용자 관점 설치/사용 진입점이 단일화됨
2. strategy 중심 E2E가 문서+스크립트로 재현됨
3. `sdk` 기준 타입/해시 규격 불일치 0
4. skill frontmatter 검사에서 누락 env/bins mismatch 0
5. 기존 명령 호환(alias) 유지

## 12. 결정 필요 사항
1. intent propose를 relayer-only로 고정할지, onchain direct propose도 표준으로 둘지
2. crawler/verifier 통합 actor를 role 2개 등록 방식으로 공식화할지
3. execution 실패 재시도 정책(고정 backoff vs adaptive) 표준화
