# Vercel 통합 런북 (Relayer + MoltBot)

이 문서는 현재 모노레포 상태에서 다음을 빠르게 연결하기 위한 실행 가이드입니다.
- Relayer(Next) Vercel 배포
- 환경변수 세팅(Postgres/Auth/Bot 인증)
- API 동작 테스트
- MoltBot 스킬 설치/호출 연동

## 0) 현재 상태 (중요)
현재 `packages/relayer/app/api/v1/*` 라우트는 스캐폴드 단계이며 대부분 `501 TODO` 응답입니다.

즉, 지금 가능한 것:
- 인증/권한 게이트 동작 확인
- 엔드포인트 wiring 검증
- MoltBot -> Relayer 요청 경로 검증

아직 불가능한 것:
- 실제 DB 영속화 기반 fund/bot/claim/intent 처리
- 실제 온체인 제출 자동화

## 1) Vercel 프로젝트 생성

### 1.1 Root Directory
Vercel 프로젝트 생성 시 Root Directory를 아래로 지정:
- `packages/relayer`

### 1.2 Build / Install
- Install Command: `npm install`
- Build Command: `npm run build`
- Output: Next 기본값 사용

## 2) Vercel 환경변수

`packages/relayer/.env.example` 기준으로 설정합니다.

필수:
- `AUTH_SECRET`
- `POSTGRES_URL`
- `ADMIN_EMAILS`
- `BOT_API_KEYS`
- `BOT_SCOPES`

권장:
- `RPC_URL`
- `CHAIN_ID`
- `CLAIM_FINALIZATION_MODE` (`OFFCHAIN` or `ONCHAIN`)
- `CLAIM_ATTESTATION_VERIFIER_ADDRESS`
- `CLAIM_BOOK_ADDRESS` (`CLAIM_FINALIZATION_MODE=ONCHAIN`일 때만)
- `INTENT_BOOK_ADDRESS`
- `CLAW_VAULT_ADDRESS`
- `RELAYER_SIGNER_PRIVATE_KEY`

예시:
```env
AUTH_SECRET=long-random-secret
POSTGRES_URL=postgres://user:pass@host:5432/db
ADMIN_EMAILS=ops1@yourdomain.com,ops2@yourdomain.com
BOT_API_KEYS=bot-strategy-1:key1,bot-participant-1:key2
BOT_SCOPES=bot-strategy-1:intents.propose,bot-participant-1:claims.submit|intents.attest
```

## 3) 운영자/유저 동선

- 메인 안내 페이지: `/`
- 운영자 로그인: `/login`
- 운영자 회원가입: `/register`
- 보호 페이지(로그인 테스트): `/protected`

권한 모델:
- 관리자 API:
  - `POST /api/v1/funds`
  - `POST /api/v1/funds/{fundId}/bots/register`
  - NextAuth 세션 + `ADMIN_EMAILS` 체크
- 봇 API:
  - claims/attestations/intents 라우트
  - `x-bot-id`, `x-bot-api-key`, scope 체크

## 4) 배포 후 API 테스트

`RELAYER_BASE_URL`을 배포 URL로 바꿔서 테스트:

```bash
export RELAYER_BASE_URL="https://<your-vercel-app>.vercel.app"
```

### 4.1 봇 인증 체크 (의도적으로 401 확인)
```bash
curl -i -X POST "$RELAYER_BASE_URL/api/v1/funds/fund-demo/claims"
```
기대: `401 UNAUTHORIZED`

### 4.2 봇 인증 + scope 체크 (현재 501이면 정상)
```bash
curl -i -X POST "$RELAYER_BASE_URL/api/v1/funds/fund-demo/claims" \
  -H "content-type: application/json" \
  -H "x-bot-id: bot-participant-1" \
  -H "x-bot-api-key: key2" \
  -d '{"claim":"demo"}'
```
기대: `501 TODO` (현재 로직 미구현 상태에서는 정상)

### 4.3 관리자 API 체크
1) `/login`으로 로그인
2) 브라우저 세션 유지 상태에서 호출
```bash
curl -i -X POST "$RELAYER_BASE_URL/api/v1/funds" \
  -H "content-type: application/json" \
  -d '{"fundName":"Demo Fund"}'
```
기대:
- 관리자 세션 없음: `403`
- 관리자 세션 있음: `501 TODO`

## 5) MoltBot 연동 방식 (현재/다음 단계)

## 5.1 현재 가능한 최소 연동
MoltBot 런타임에서 Relayer 호출 시 아래 헤더를 항상 포함:
- `x-bot-id`
- `x-bot-api-key`

역할별 scope 예시:
- participant: `claims.submit`, `intents.attest`
- strategy: `intents.propose`

## 5.2 설치 UX 목표
메인 카피 기준 install command:
```bash
npx clawhub@latest install claw-validation-market
```

관련 프레임은 아래에 준비됨:
- `packages/openfunderse/packs/openfunderse/config/setup-manifest.json`
- `packages/openfunderse/packs/openfunderse/skills/*`
- `packages/openfunderse/packs/openfunderse/prompts/*`

현재는 스캐폴드이므로, 실제 `clawhub` 배포/설치 스펙에 맞춰 매니페스트 필드와 패키징 파이프라인을 확정해야 합니다.

## 6) 다음 구현 우선순위 (실운영 전)

1. Relayer API 실제 로직 구현
- `POST /api/v1/funds` DB 저장
- `POST /api/v1/funds/{fundId}/bots/register` DB 저장 + key 발급
- claims/intents 라우트에 schema 검증 + `@claw/protocol-sdk` 연동

2. DB 스키마 확정 (Drizzle)
- funds, bots, bot_keys, claims, attestations, intents, snapshots

3. Bot 인증 고도화
- 현재 API key + scope -> 추후 EIP-712 nonce/timestamp replay 방지 강화

4. MoltBot 설치 자동화
- `clawhub install` 실구현
- 설치 후 샘플 쿼리 smoke test 자동 실행

## 7) 로컬 검증 명령

```bash
cd /Users/ham-yunsig/Documents/github/claw-validation-market
nvm use
npm install
npm run build -w @claw/relayer
npm run dev -w @claw/relayer
```
