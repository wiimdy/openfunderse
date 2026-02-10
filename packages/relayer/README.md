# @claw/relayer

Next.js 기반의 Claw relayer 서버 스캐폴드입니다.  
현재는 `nextjs-postgres-auth-starter` 템플릿 위에, Claw MVP에 필요한 relayer API 골격(TODO 501)을 추가한 상태입니다.

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
일부 엔드포인트는 v0 집계 로직이 연결되어 있고, 나머지는 스캐폴드 상태입니다.

- `POST /api/v1/funds` (admin only)
  - 펀드 생성 초기화 (threshold, policy, metadata)
- `POST /api/v1/funds/{fundId}/bots/register` (admin only)
  - strategy/crawler/verifier 봇 등록 및 권한 매핑
- `POST /api/v1/funds/{fundId}/claims`
  - claim payload 검증/정규화 -> canonical hash 계산 -> 저장/온체인 제출 큐
- `GET /api/v1/funds/{fundId}/claims`
  - claim 목록/상태 조회 (status, token, epoch, pagination)
- `POST /api/v1/funds/{fundId}/attestations`
  - claim attestation 수집(중복 제거, EIP-712 검증, threshold 충족 시 onchain 제출)
- `GET /api/v1/funds/{fundId}/snapshots/latest`
  - 최신 finalized snapshot 조회
- `POST /api/v1/funds/{fundId}/intents/propose`
  - strategy intent 접수/검증(snapshotHash 연계)
- `POST /api/v1/funds/{fundId}/intents/attestations/batch`
  - intent attestation batch 제출(중복 제거, EIP-712 검증, threshold 충족 시 onchain `attestIntent`)
- `GET /api/v1/funds/{fundId}/status`
  - SQLite 기반 pending/approved 요약 + in-memory metrics 카운터 조회
- `GET /api/v1/metrics`
  - 요청/검증/중복/온체인 제출 성공/실패 카운터 조회

## Access model (scaffold)
- `admin`:
  - NextAuth session + `ADMIN_EMAILS` 기반 권한 체크
  - 펀드 생성/봇 등록 API 접근
- `user`:
  - 튜토리얼 페이지 접근 (`/join`)
- `bot`:
  - write API 호출 시 `x-bot-id`, `x-bot-api-key` 필수
  - `BOT_SCOPES`로 API scope 검증 (`claims.submit`, `claims.attest`, `intents.propose`, `intents.attest`)

## UI routes (scaffold)
- `/`: 일반 유저용 참여/초기 셋업 안내 메인 페이지
- `/join`: 일반 유저용 펀드 참여/초기 셋업 튜토리얼 페이지

## Implementation TODOs
- 요청 schema 정의(zod or valibot)
- DB 스키마(Drizzle + Postgres) 설계
- onchain submitter job/queue 분리(현재는 요청 경로 내 동기 처리)
- 인증/권한(운영자, verifier allowlist)

## Notes
- indexer는 MVP 최후순위이므로, 초기에는 relayer가 필요한 read model 일부를 직접 제공할 수 있습니다.
- Next 템플릿 UI/auth 페이지는 필요에 따라 자유롭게 치환하면 됩니다.
- 집계 기준은 온체인 snapshot 기반 weighted threshold 단일 모델입니다.
- weighted 계산 유틸은 `@claw/protocol-sdk`에 구현되어 있으며, relayer 온체인 snapshot 로더/연동 고도화가 남아 있습니다.
