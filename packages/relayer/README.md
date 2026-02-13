# @claw/relayer

Next.js 기반의 Claw relayer 서버입니다.
Supabase(Postgres) 저장소 기준으로 동작합니다.

## Purpose
- Claim/Intent 검증 서명 수집 API 게이트웨이
- `@claw/protocol-sdk` 기반 canonical hash/EIP-712 검증 진입점
- 컨트랙트(`ClaimBook`/`IntentBook`/`ClawVault`) 제출 오케스트레이션

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
- `POST /api/v1/funds/{fundId}/bots/register` (strategy bot only)
  - 유저 봇(crawler/verifier) 등록
- `GET /api/v1/funds/{fundId}/bots/register` (strategy bot only)
  - 등록된 봇 목록 조회
- `POST /api/v1/funds/{fundId}/claims`
  - claim payload 검증/정규화 -> canonical hash 계산 -> 저장/온체인 제출 큐
- `GET /api/v1/funds/{fundId}/claims`
  - claim 목록/상태 조회 (status, token, epoch, pagination)
- `POST /api/v1/funds/{fundId}/attestations`
  - claim attestation 수집(중복 제거, EIP-712 검증, weighted threshold 충족 시 onchain 제출)
- `GET /api/v1/funds/{fundId}/snapshots/latest`
  - 최신 finalized snapshot 조회
- `POST /api/v1/funds/{fundId}/intents/propose`
  - strategy intent 접수/검증(snapshotHash 연계)
  - `executionRoute` 필수 입력으로 `allowlistHash`를 서버에서 계산/고정
- `POST /api/v1/funds/{fundId}/intents/attestations/batch`
  - intent attestation batch 제출(중복 제거, EIP-712 검증, weighted threshold 충족 시 onchain `attestIntent`)
- `GET /api/v1/funds/{fundId}/status`
  - SQLite 기반 pending/approved 요약 + in-memory metrics 카운터 조회
- `GET /api/v1/metrics`
  - 요청/검증/중복/온체인 제출 성공/실패 카운터 조회
- `POST /api/v1/cron/execute-intents`
  - Vercel cron/worker가 승인된 intent 실행 잡 처리
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
  - `BOT_SCOPES`로 API scope 검증 (`claims.submit`, `claims.attest`, `intents.propose`, `intents.attest`, `bots.register`)

## UI routes (scaffold)
- `/`: 일반 유저용 참여/초기 셋업 안내 메인 페이지
- `/join`: 일반 유저용 펀드 참여/초기 셋업 튜토리얼 페이지

## Implementation TODOs
- 요청 schema 정의(zod or valibot)
- DB 스키마(Drizzle + Postgres) 설계
- onchain submitter job/queue 분리(현재는 요청 경로 내 동기 처리)
- 인증/권한(운영자, verifier allowlist, strategy-only bot registration)
- strategy bot -> Telegram room/role mapping 동기화

## Notes
- indexer는 MVP 최후순위이므로, 초기에는 relayer가 필요한 read model 일부를 직접 제공할 수 있습니다.
- Next 템플릿 UI/auth 페이지는 필요에 따라 자유롭게 치환하면 됩니다.
- `/register`는 비활성화(단일 관리자 계정 모델).
- 집계 기준은 온체인 snapshot 기반 weighted threshold 단일 모델입니다.
- weighted 계산 유틸은 `@claw/protocol-sdk`에 구현되어 있으며, relayer 온체인 snapshot 로더/연동 고도화가 남아 있습니다.
- `intents/propose`는 `allowlistHash` 직접 입력을 허용하지 않으며, relayer가 계산한 해시만 onchain constraints에 반영합니다.

## Database
- Required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`
- Apply `/Users/ham-yunsig/Documents/github/claw-validation-market/packages/relayer/supabase/schema.sql` in Supabase SQL Editor before running relayer.

## Required Env (weighted mode)
- `CLAIM_THRESHOLD_WEIGHT`, `INTENT_THRESHOLD_WEIGHT`
- `VERIFIER_WEIGHT_SNAPSHOT` (`address:weight,address:weight,...`)
