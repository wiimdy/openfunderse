# @claw/relayer

Next.js 기반의 Claw relayer 서버입니다.
Supabase(Postgres) 저장소 기준으로 동작합니다.

## Role
- Monorepo offchain control-plane/API gateway.
- Owns fund/bot/claim/intent API, epoch aggregation, and execution orchestration.

## Purpose
- Claim/Intent API 게이트웨이
- `@claw/protocol-sdk` 기반 canonical hash/EIP-712 검증 진입점
- 컨트랙트(`IntentBook`/`ClawVault`) 제출 오케스트레이션

## Run
```bash
# repo root
nvm use
npm install
npm run dev -w @claw/relayer
```

## Baseline API (v1)
일부 엔드포인트는 실제 동작하며, 일부는 스캐폴드(`501`) 상태입니다.

- `POST /api/v1/funds` (admin only)
  - 펀드 생성/업데이트 (threshold weight, policy, metadata, single strategy bot binding)
- `GET /api/v1/funds`
  - 공개 노출용 verified fund 목록 조회 (`is_verified=true`, `visibility=PUBLIC`)
- `POST /api/v1/funds/sync-by-strategy` (strategy bot only)
  - strategy AA가 이미 실행한 `ClawFundFactory.createFund` txHash를 검증하고 relayer DB projection 동기화
  - relayer는 tx를 보내지 않고 receipt/event 검증 + metadata 저장만 수행
- `POST /api/v1/funds/{fundId}/verify` (admin only)
  - fund 노출 상태(`is_verified`, `visibility`) 갱신
- `POST /api/v1/funds/bootstrap` (admin only)
  - `DEPRECATED`: 기존 admin-triggered onchain deploy 경로
- `POST /api/v1/funds/{fundId}/bots/register` (strategy bot only)
  - participant 봇 등록
- `GET /api/v1/funds/{fundId}/bots/register` (strategy bot only)
  - 등록된 봇 목록 조회
- `POST /api/v1/funds/{fundId}/claims`
  - claim payload 검증/정규화 -> canonical hash 계산 -> 저장/온체인 제출 큐
- `GET /api/v1/funds/{fundId}/claims`
  - claim 목록/상태 조회 (status, token, epoch, pagination)
- `POST /api/v1/funds/{fundId}/epochs/{epochId}/aggregate`
  - 해당 epoch의 claim 집계/정규화로 epoch state hash를 생성/저장
- `GET /api/v1/funds/{fundId}/epochs/latest`
  - 최신 finalized epoch state 조회
- `POST /api/v1/funds/{fundId}/intents/propose`
  - strategy intent 접수/검증(snapshotHash 연계)
  - `executionRoute` 필수 입력으로 `allowlistHash`를 서버에서 계산/고정
- `POST /api/v1/funds/{fundId}/intents/attestations/batch`
  - intent attestation batch 제출(중복 제거, EIP-712 검증, weighted threshold 충족 시 `READY_FOR_ONCHAIN` 큐잉)
- `GET /api/v1/funds/{fundId}/intents/{intentHash}/onchain-bundle`
  - strategy bot가 `IntentBook.attestIntent`에 필요한 verifiers/attestations bundle 조회
- `POST /api/v1/funds/{fundId}/intents/{intentHash}/onchain-attested`
  - strategy AA가 onchain attestation 완료 후 relayer 상태를 `APPROVED`(+execution `READY`)로 ack
- `GET /api/v1/funds/{fundId}/intents/ready-execution`
  - strategy AA가 `ClawCore.executeIntent`에 필요한 intent/executionRoute payload 조회
- `POST /api/v1/funds/{fundId}/intents/{intentHash}/onchain-executed`
  - strategy AA 실행 성공 tx를 execution job(`EXECUTED`)로 ack
- `POST /api/v1/funds/{fundId}/intents/{intentHash}/onchain-failed`
  - strategy AA 실행 실패를 retryable 상태로 기록
- `GET /api/v1/funds/{fundId}/status`
  - DB 기반 요약 + in-memory metrics 카운터 조회
- `GET /api/v1/metrics`
  - 요청/검증/중복/온체인 제출 성공/실패 카운터 조회
- `POST /api/v1/cron/execute-intents`
  - keyless 모드에서 비활성화(410). 온체인 실행은 strategy AA가 수행.
- `GET /api/v1/executions`
  - 실행 잡 상태 조회

## Access model (scaffold)
- `admin`:
  - NextAuth credentials session + `ADMIN_LOGIN_ID` / `ADMIN_LOGIN_PASSWORD(_HASH)` 로그인
  - `ADMIN_IDS` 기반 권한 체크
  - 펀드 생성 API 접근
- `user`:
  - 튜토리얼 페이지 접근 (`/join`)
- `bot`:
  - write API 호출 시 `x-bot-id`, `x-bot-api-key` 필수
  - `BOT_SCOPES`로 API scope 검증 (`claims.submit`, `intents.propose`, `intents.attest`, `bots.register`, `funds.bootstrap`)

## UI routes (scaffold)
- `/`: 일반 유저용 참여/초기 셋업 안내 메인 페이지
- `/join`: 일반 유저용 펀드 참여/초기 셋업 튜토리얼 페이지

## Implementation TODOs
- 요청 schema 정의(zod or valibot)
- DB 스키마(Drizzle + Postgres) 설계
- onchain submitter는 strategy AA 책임. relayer는 bundle/payload 제공 + 상태 저장 역할.
- 인증/권한(운영자, verifier allowlist, strategy-only bot registration)
- strategy bot -> Telegram room/role mapping 동기화

## Notes
- indexer는 MVP 최후순위이므로, 초기에는 relayer가 필요한 read model 일부를 직접 제공할 수 있습니다.
- Next 템플릿 UI/auth 페이지는 필요에 따라 자유롭게 치환하면 됩니다.
- `/register`는 비활성화(단일 관리자 계정 모델).
- claims 집계 기준은 epoch aggregate 기반 모델입니다.
- intent approval은 weighted attestation + threshold 모델입니다.
- `intents/propose`는 `allowlistHash` 직접 입력을 허용하지 않으며, relayer가 계산한 해시만 onchain constraints에 반영합니다.

## Database
- Required: `SUPABASE_URL`, `SUPABASE_ANON_KEY`
- Apply `/Users/ham-yunsig/Documents/github/claw-validation-market/packages/relayer/supabase/schema.sql` in Supabase SQL Editor before running relayer.

## Required Env (weighted mode)
- `CLAIM_THRESHOLD_WEIGHT`, `INTENT_THRESHOLD_WEIGHT`
- `VERIFIER_WEIGHT_SNAPSHOT` (`address:weight,address:weight,...`)
- `CLAW_FUND_FACTORY_ADDRESS` (for `POST /api/v1/funds/sync-by-strategy`)
- `FACTORY_SIGNER_PRIVATE_KEY` (needed only for legacy `POST /api/v1/funds/bootstrap` or `factory:create-fund`)
- relayer keyless 운영에서는 `RELAYER_SIGNER_PRIVATE_KEY`가 필요하지 않음

## Web2 viem example (factory struct payload)
```bash
# repo root
npm run -w @claw/relayer factory:create-fund
```

Script path:
- `scripts/factory-create-fund.mjs`

Bootstrap API payload example:
```json
{
  "fundId": "fund-monad-001",
  "fundName": "Monad Meme Momentum",
  "strategyBotId": "bot-strategy-1",
  "strategyBotAddress": "0x1111111111111111111111111111111111111111",
  "verifierThresholdWeight": "3",
  "intentThresholdWeight": "5",
  "deployConfig": {
    "fundOwner": "0x2222222222222222222222222222222222222222",
    "strategyAgent": "0x3333333333333333333333333333333333333333",
    "snapshotBook": "0x4444444444444444444444444444444444444444",
    "asset": "0x5555555555555555555555555555555555555555",
    "vaultName": "Fund Vault Share",
    "vaultSymbol": "FVS",
    "intentThresholdWeight": "5",
    "nadfunLens": "0x0000000000000000000000000000000000000000",
    "initialVerifiers": [
      "0x6666666666666666666666666666666666666666"
    ],
    "initialVerifierWeights": ["5"],
    "initialAllowedTokens": [
      "0x5555555555555555555555555555555555555555"
    ],
    "initialAllowedAdapters": []
  }
}
```
