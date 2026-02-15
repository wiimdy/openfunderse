# Vercel 통합 런북 (Relayer + MoltBot)

이 문서는 현재 모노레포 상태에서 다음을 빠르게 연결하기 위한 실행 가이드입니다.
- Relayer(Next) Vercel 배포
- 환경변수 세팅(Postgres/Auth/Bot 인증)
- API 동작 테스트
- MoltBot 스킬 설치/호출 연동

## 0) 현재 상태 (중요)
현재 relayer는 핵심 v1 라우트(`claims`, `epochs`, `intents`)가 구현되어 있습니다.

즉, 지금 가능한 것:
- 인증/권한 게이트 동작 확인
- 엔드포인트 wiring 검증
- MoltBot -> Relayer 요청 경로 검증

아직 보강이 필요한 것:
- 운영 모니터링/알림 자동화
- 전략/참여자 자동화 고도화

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
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

권장:
- `RPC_URL`
- `CHAIN_ID`
- `INTENT_BOOK_ADDRESS`
- `CLAW_VAULT_ADDRESS`
- `RELAYER_SIGNER_PRIVATE_KEY`

예시:
```env
AUTH_SECRET=long-random-secret
POSTGRES_URL=postgres://user:pass@host:5432/db
ADMIN_EMAILS=ops1@yourdomain.com,ops2@yourdomain.com
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=sb_publishable_xxx
```

## 2.1) Bot 인증: Signature (EIP-191)

### 개요
Relayer write API는 아래 헤더를 요구합니다:
- `x-bot-id`
- `x-bot-signature`
- `x-bot-timestamp`
- `x-bot-nonce`

서명 메시지(EIP-191):
- `openfunderse:auth:<botId>:<timestamp>:<nonce>`

Relayer는 Supabase `fund_bots.bot_address`에 저장된 주소로 서명을 검증합니다.

### 등록 흐름
1. Strategy bot이 onchain에서 `createFund` tx를 실행한 뒤, `POST /api/v1/funds/sync-by-strategy`로 배포 메타를 sync합니다.
   - 최초 호출(아직 bot이 등록되지 않은 상태)에서는 body의 `auth`(bootstrap signature)를 포함합니다.
   - 성공하면 relayer가 strategy bot을 `fund_bots`에 등록합니다.
2. Strategy bot이 `POST /api/v1/funds/{fundId}/bots/register`로 participant bot을 등록합니다.
   - `botId` + `botAddress`를 저장하여 participant가 서명 인증할 수 있게 합니다.
3. Participant bot은 등록된 주소의 private key로 서명 헤더를 만들어 `POST /claims`, `POST /intents/attestations/batch` 등을 호출합니다.

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
  - claims/epochs/intents 라우트
  - `x-bot-id` + signature headers(`x-bot-signature`, `x-bot-timestamp`, `x-bot-nonce`) + role/membership 체크

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
### 4.2 봇 인증 + scope 체크
```bash
curl -i -X POST "$RELAYER_BASE_URL/api/v1/funds/fund-demo/claims" \
  -H "content-type: application/json" \
  -H "x-bot-id: bot-participant-1" \
  -H "x-bot-signature: <0x...>" \
  -H "x-bot-timestamp: <unix seconds>" \
  -H "x-bot-nonce: <uuid/random>" \
  -d '{"claim":"demo"}'
```
기대: `501 TODO` (현재 로직 미구현 상태에서는 정상)
기대: 인증 성공 시 2xx/4xx 정책 응답

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
- 관리자 세션 있음: 정책/유효성에 따른 2xx/4xx

## 5) MoltBot 연동 방식 (현재/다음 단계)

## 5.1 현재 가능한 최소 연동
MoltBot 런타임에서 Relayer 호출 시 아래 헤더를 항상 포함:
- `x-bot-id`
- `x-bot-signature`, `x-bot-timestamp`, `x-bot-nonce`

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
- funds, bots, bot_keys, allocation_claims, epoch_states, intents

3. Bot 인증 고도화
- 현재 EIP-191 signature + timestamp window 기반. nonce 저장/재사용 방지 등 replay 방지 강화 필요.

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
