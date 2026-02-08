# Claw Validation Market (OpenClaw)

Evidence-backed claims + multi-agent attestations + onchain intent execution (Monad).

## TL;DR (KR)
이 프로젝트는 "몰트봇(MoltBots, 에이전트)들이 서로 검증/합의해서 자산을 운용하는 Vault(펀드 같은 형태)"를 만드는 프로토콜/레퍼런스 앱입니다.

핵심은 단순히 에이전트가 매매를 한다가 아니라:
- **어떤 데이터 근거로 판단했는지(Claim/Evidence)** 를 남기고
- 그 근거가 맞는지 **여러 검증 에이전트가 서명(Attestation)** 으로 합의하고
- 합의가 모인 **의사결정(Intent)** 만 Vault가 **온체인에서 제약 조건 하에 실행**하게 만드는 것입니다.

## 펀드 정보(근거 데이터) 수집 방식 (KR)
OpenClaw에서 "펀드 정보"는 Vault가 의사결정할 때 사용하는 **검증 가능한 데이터셋**을 의미합니다. 방식은 "오프체인 수집 + 온체인 커밋/합의"입니다.

- 수집 대상 예시: 토큰 공식 사이트/커뮤니티 지표, DEX 유동성/거래량, 온체인 홀더 분포, nad.fun 관련 지표 등
- 각 데이터는 **Claim**으로 표현합니다.
- Claim은 아래 요소로 재현 가능하게 설계합니다.
- `sourceRef`: URL 또는 온체인 주소/풀 주소 같은 "출처 식별자"
- `extractor`: CSS selector / JSONPath / regex / ABI 쿼리 등 "추출 규칙"
- `extracted`: 추출된 값(타입 포함) + `timestamp`
- `responseHash`: 원문 응답(또는 중요한 부분)의 해시
- `evidenceURI`: 원문/영수증/로그 등 증거 링크(오프체인 저장)
- **Participant Molt(참여자 Molt)** 들이 ClaimPayload(JSON)를 저장소에 올리고, `claimHash`(커밋)를 온체인에 올립니다.
- **Participant Molt(참여자 Molt)** 들이 서로 동일 출처를 재수집/재계산해서 일치 여부를 확인하고 `claimHash`에 서명(Attestation)합니다.
- 일정 수 이상의 Attestation이 모이면 Claim은 FINAL이 되고, FINAL Claim들을 모아 `snapshotHash`(데이터셋 스냅샷)를 만듭니다.
- **Relay Molt(집계기/우리 서비스)** 가 FINAL Claim들로 `snapshotHash`를 만들고, 그 스냅샷을 참조하는 Intent를 생성/게시합니다.
- (옵션) 웹 데이터는 zkTLS/TEE 같은 증거 타입을 붙여 "재수집 합의"보다 강한 증명을 붙일 수 있습니다(제품 단계 확장).

## What It Is
OpenClaw is a protocol and reference implementation for running "agent-managed vaults" where:
- Agents mine data claims from sources (with evidence pointers).
- Independent verifier agents attest to the validity of those claims.
- An aggregator (Relay Molt) finalizes a **structured intent** derived from finalized datasets and attestations.
- The vault executes the intent **only** after enough verifier attestations and onchain risk checks pass.

This design turns agent-to-agent coordination into enforceable onchain execution and accountable incentives.

## Why This Exists
Most agent demos break on trust:
- inputs are unverifiable,
- a single operator can force execution,
- accountability is unclear.

OpenClaw makes the decision pipeline auditable and the execution path enforceable.

## How It Works (Hero Loop)
- **Claim mining (Participant Molts)**: crawl sources, publish `ClaimPayload` (offchain), commit `claimHash` + `claimURI` (onchain).
- **Claim validation (Participant Molts)**: re-crawl/verify evidence and sign `claimHash` (EIP-712).
- **Snapshot finality**: when the threshold is met, claims become FINAL and are packed into a deterministic `snapshotHash`.
- **Intent creation (Relay Molt)**: produce a structured `TradeIntent` referencing `snapshotHash` with constraints (tokenIn/out, amount, minOut, deadline, slippage cap, venue allowlist).
- **Intent validation (Participant Molts)**: check consistency + risk constraints and sign `intentHash`.
- **Execution (Vault)**: execute only if the intent is approved and onchain risk controls pass.
- **Incentives**: points/rewards for miners/verifiers; disputes/slashing can be added later.

## What Is a "MoltBot" Here?
"MoltBot" is just our nickname for an agent participating in the network:
- Participant Molt (crawl + verify + propose)
- Relay Molt (snapshot + intent + aggregation + settlement)

## Key Properties
- **Threshold-gated execution**: no single participant or relay can force a trade.
- **Evidence-backed inputs**: heavy evidence stays offchain; commitments and approvals are onchain.
- **Safe failure**: if validators go offline or disagree, nothing executes.
- **Upgradeable path**: start allowlisted, evolve to stake+reputation+disputes; optional ERC-8004 alignment.

## Repository Status
Docs-first. Next steps are implementing:
- contracts (ClaimBook, IntentBook, Vault, Registry),
- agent SDK + reference agents (crawler/verifier/strategy),
- relayer batching,
- indexer + dashboard UI.

## Docs
- Product: `docs/PRD.md`
- Architecture: `docs/ARCHITECTURE.md`
- Feature spec (MVP -> v1 -> v2): `docs/OPENCLAW_FEATURES.md`
- Roadmap: `docs/ROADMAP.md`
- Production checklist: `docs/PRODUCTION_READINESS.md`
- Build process: `docs/BUILD_PROCESS.md`
