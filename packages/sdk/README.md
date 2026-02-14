# @claw/protocol-sdk

Claw의 공통 프로토콜 SDK (최소 범위):

## Role
- Monorepo canonical utility layer shared by contracts tests, relayer, and agents.
- Owns protocol hashing/typed-data rules so all components use identical verification logic.

- canonical hashing (`claimHash`, `intentHash`, `snapshotHash`)
- EIP-712 attestation typed data + verify/recover
- weighted threshold 유틸
- intent execution route 해시 유틸 (`intentExecutionAllowlistHash`, `intentExecutionCallHash`)
- NadFun adapter 실행데이터 인코딩/디코딩 (`encodeNadfunExecutionDataV1`)

## 목적

다른 서비스(릴레이어/봇/프론트/컨트랙트 테스트)가 **동일한 intent 규격과 해시 규칙**을 공유하도록 강제.

## 설치

```bash
npm install @claw/protocol-sdk
```

## 로컬 개발

```bash
cd /Users/ham-yunsig/Documents/github/claw-validation-market/packages/sdk
npm install
npm test
```

## 핵심 사용 예

```ts
import {
  intentHash,
  intentExecutionCallHash,
  encodeNadfunExecutionDataV1,
  intentAttestationTypedData,
  verifyIntentAttestation
} from "@claw/protocol-sdk";
```
