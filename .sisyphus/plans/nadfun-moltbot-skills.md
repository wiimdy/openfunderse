# NadFun MoltBot Skills & Infrastructure Implementation

## TL;DR

> **Quick Summary**: Implement ClaimBook contract, extend SDK with NadFun intent fields, add SSE subscription endpoints to Relayer, and create MoltBot Skills documentation for the Moltiverse hackathon.
> 
> **Deliverables**:
> - ClaimBook.sol (with embedded ISnapshotBook interface)
> - SDK NadFunIntentMeta type extension
> - Relayer SSE endpoints for claim/intent events
> - MoltBot SKILL.md files (strategy, participant)
> 
> **Estimated Effort**: Large (2 weeks hackathon timeline)
> **Parallel Execution**: YES - 3 waves
> **Critical Path**: ClaimBook → SDK conformance → SSE → Skills

---

## Context

### Original Request
Implement MoltBot and Skills definition, Intent format extension, Relayer API improvements, and Contracts for the OpenClaw/NadFun Moltiverse hackathon.

### Interview Summary
**Key Discussions**:
- **Workflow**: Branch per task → PR → merge to main
- **Skills format**: TypeScript code modules following AgentSkills spec
- **Intent format**: NadFun-specific fields (offchain-only, not in hash)
- **Relayer**: SSE for real-time subscriptions
- **Test strategy**: TDD (tests first)
- **Contract priority**: ClaimBook → SnapshotBook (embedded) → Vault (deferred)

**Research Findings**:
- MoltBot Skills: SKILL.md with YAML frontmatter + instructions
- Existing: IntentBook.sol complete, SDK TradeIntent defined, Relayer scaffolded
- Prompt templates already detailed in docs/prompts/kr/
- Moltiverse hackathon URL: https://moltiverse.dev/

### Metis Review
**Identified Gaps** (addressed):
- ClaimBook.sol missing - **CRITICAL BLOCKER** (Relayer references it)
- SnapshotBook missing - Embed `isSnapshotFinalized` in ClaimBook
- NadFun fields not in SDK - Add as separate `NadFunIntentMeta` type
- SSE endpoints missing - Add event streaming routes
- SKILL.md files are TODO stubs - Fill with real content from prompt templates

---

## Work Objectives

### Core Objective
Enable the end-to-end flow: Claim submission → Attestation → Snapshot finalization → Intent proposal → Intent attestation for the Moltiverse hackathon demo.

### Concrete Deliverables
- `packages/contracts/src/ClaimBook.sol` - Full implementation
- `packages/contracts/test/ClaimBook.t.sol` - Foundry tests
- `packages/sdk/src/nadfun-types.ts` - NadFun intent extension
- `packages/relayer/app/api/v1/funds/[fundId]/events/claims/route.ts` - SSE endpoint
- `packages/relayer/app/api/v1/funds/[fundId]/events/intents/route.ts` - SSE endpoint
- `packages/agents/skills/participant/SKILL.md` - Complete spec
- `packages/agents/skills/strategy/SKILL.md` - Complete spec
- `packages/agents/skills/participant/index.ts` - Skill runtime
- `packages/agents/skills/strategy/index.ts` - Skill runtime

### Definition of Done
- [ ] `forge test` passes for ClaimBook
- [ ] `npm test -w @claw/protocol-sdk` passes (no regression)
- [ ] SSE endpoint returns text/event-stream and emits events
- [ ] SKILL.md files have Input/Output/Rules sections
- [ ] `./scripts/demo-local.sh` exit code 0 (E2E happy path)

### Must Have
- ClaimBook with weighted attestation (matching IntentBook pattern)
- `isSnapshotFinalized(bytes32)` function for IntentBook dependency
- NadFun metadata type (tokenSymbol, curveState, etc.)
- SSE events: `claim:attested`, `snapshot:finalized`, `intent:attested`
- TDD: Tests written before implementation

### Must NOT Have (Guardrails)
- **MUST NOT** modify `IntentBook.sol` (it's complete and tested)
- **MUST NOT** implement ClawVault (deferred to post-hackathon)
- **MUST NOT** add NadFun fields to `intentHash` (offchain-only metadata)
- **MUST NOT** replace REST endpoints with SSE (SSE is additive)
- **MUST NOT** introduce WebSocket, Redis, or Kafka
- **MUST NOT** build `clawhub` installer or SKILL.md runtime parser
- **MUST NOT** implement Mode C (Intent Judgment Vote)
- **MUST NOT** build Telegram/Discord ChatOps integration
- **MUST NOT** implement Points/Rewards or AgentRegistry contracts

---

## Verification Strategy (MANDATORY)

> **UNIVERSAL RULE: ZERO HUMAN INTERVENTION**
>
> ALL tasks in this plan MUST be verifiable WITHOUT any human action.
> The executing agent verifies using tools (Playwright, Bash, curl).

### Test Decision
- **Infrastructure exists**: YES (packages/sdk has test setup, contracts have Foundry)
- **Automated tests**: TDD (Tests First)
- **Framework**: Foundry for contracts, bun test for SDK, curl for Relayer

### TDD Flow per Task

**Task Structure:**
1. **RED**: Write failing test first
2. **GREEN**: Implement minimum code to pass
3. **REFACTOR**: Clean up while keeping green

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately):
├── Task 1: ClaimBook.sol tests + implementation
└── Task 4: SKILL.md documentation (no code dependencies)

Wave 2 (After ClaimBook complete):
├── Task 2: SDK NadFunIntentMeta extension
├── Task 3: SDK ClaimBook hash conformance
└── Task 5: Relayer SSE infrastructure

Wave 3 (After SDK + Relayer):
├── Task 6: Skills TypeScript runtime modules
└── Task 7: Integration test (demo-local.sh)

Critical Path: Task 1 → Task 3 → Task 5 → Task 7
```

### Dependency Matrix

| Task | Depends On | Blocks | Can Parallelize With |
|------|------------|--------|---------------------|
| 1 (ClaimBook) | None | 2, 3, 5, 7 | 4 |
| 2 (NadFun types) | None | 6, 7 | 3, 4, 5 |
| 3 (SDK hash conform) | 1 | 7 | 2, 4, 5 |
| 4 (SKILL.md docs) | None | 6 | 1, 2, 3, 5 |
| 5 (SSE endpoints) | 1 | 7 | 2, 3, 4 |
| 6 (Skills runtime) | 2, 4 | 7 | None |
| 7 (Integration) | All | None | None |

### Agent Dispatch Summary

| Wave | Tasks | Recommended Category |
|------|-------|---------------------|
| 1 | 1, 4 | quick for docs; ultrabrain for contracts |
| 2 | 2, 3, 5 | quick for SDK; visual-engineering for SSE |
| 3 | 6, 7 | quick for skills; deep for integration |

---

## TODOs

---

- [x] 1. ClaimBook.sol Contract Implementation

  **What to do**:
  - Write Foundry tests first (TDD RED phase)
  - Implement ClaimBook.sol following IntentBook.sol patterns
  - Include `ISnapshotBook` interface implementation
  - Verify EIP-712 signature scheme matches SDK
  
  **Branch**: `feature/claimbook-contract`

  **Must NOT do**:
  - Do NOT create separate SnapshotBook.sol (embed in ClaimBook)
  - Do NOT modify IntentBook.sol
  - Do NOT implement slashing or dispute logic

  **Recommended Agent Profile**:
  - **Category**: `ultrabrain`
    - Reason: Contract development requires careful security consideration and EIP-712 compliance
  - **Skills**: [`web3-wargame-skill`]
    - `web3-wargame-skill`: Solidity expertise, security patterns, EIP-712 knowledge

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 4)
  - **Blocks**: Tasks 2, 3, 5, 7
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `packages/contracts/src/IntentBook.sol:10-33` - Struct definitions (Intent, Constraints, IntentAttestation)
  - `packages/contracts/src/IntentBook.sol:38-42` - EIP-712 typehash patterns
  - `packages/contracts/src/IntentBook.sol:162-205` - `attestIntent` batch signature verification loop
  - `packages/contracts/src/IntentBook.sol:215-238` - EIP-712 digest construction
  - `packages/contracts/src/IntentBook.sol:240-261` - `_recoverSigner` ECDSA pattern

  **API/Type References**:
  - `packages/sdk/src/types.ts:5-18` - ClaimPayload struct fields to match
  - `packages/sdk/src/types.ts:49-62` - AttestationMeta and ClaimAttestationDraft types
  - `packages/contracts/src/IntentBook.sol:4-6` - ISnapshotBook interface to implement

  **Test References**:
  - `packages/contracts/test/IntentBook.t.sol` - Test structure and patterns to follow
  - `packages/sdk/test/vectors.json` - Test vectors for hash conformance (if exists)

  **Documentation References**:
  - `docs/ARCHITECTURE.md` - ClaimBook spec in section 4.2
  - `docs/protocol/hashing-eip712-v1.md` - EIP-712 spec details

  **Acceptance Criteria**:

  **TDD (Tests First):**
  - [ ] Test file created: `packages/contracts/test/ClaimBook.t.sol`
  - [ ] Tests cover: submitClaim, attestClaim batch, finalizeClaim, finalizeSnapshot, isSnapshotFinalized
  - [ ] `cd packages/contracts && forge test --match-contract ClaimBookTest -vvv` → PASS

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: ClaimBook compiles successfully
    Tool: Bash
    Preconditions: Foundry installed, contracts directory exists
    Steps:
      1. cd packages/contracts && forge build
      2. Assert: exit code 0
      3. Assert: out/ClaimBook.sol/ClaimBook.json exists
    Expected Result: Compilation succeeds
    Evidence: Build output captured

  Scenario: Submit claim and verify event emission
    Tool: Bash (forge test)
    Preconditions: ClaimBook.t.sol exists with testSubmitClaim
    Steps:
      1. forge test --match-test testSubmitClaim -vvv
      2. Assert: exit code 0
      3. Assert: output contains "ClaimSubmitted"
    Expected Result: Claim submitted, event emitted
    Evidence: Test output captured

  Scenario: Batch attestation updates weight correctly
    Tool: Bash (forge test)
    Preconditions: Test includes multiple verifier signatures
    Steps:
      1. forge test --match-test testAttestClaimBatch -vvv
      2. Assert: exit code 0
      3. Assert: attestedWeight equals sum of verifier weights
    Expected Result: Weighted attestation works
    Evidence: Test output captured

  Scenario: Snapshot finalization enables IntentBook
    Tool: Bash (forge test)
    Preconditions: ClaimBook deployed as ISnapshotBook
    Steps:
      1. forge test --match-test testIsSnapshotFinalized -vvv
      2. Assert: isSnapshotFinalized returns true after finalization
      3. Assert: IntentBook.proposeIntent succeeds with finalized snapshot
    Expected Result: ISnapshotBook interface works
    Evidence: Test output captured
  ```

  **Commit**: YES
  - Message: `feat(contracts): implement ClaimBook with ISnapshotBook interface`
  - Files: `packages/contracts/src/ClaimBook.sol`, `packages/contracts/test/ClaimBook.t.sol`
  - Pre-commit: `cd packages/contracts && forge test`

---

- [ ] 2. SDK NadFunIntentMeta Type Extension

  **What to do**:
  - Write tests first for new types
  - Add `NadFunIntentMeta` interface with NadFun-specific fields
  - Add `NadFunTradeIntent` type that combines TradeIntent + NadFunIntentMeta
  - Keep `intentHash` computation unchanged (metadata is offchain-only)

  **Branch**: `feature/sdk-nadfun-types`

  **Must NOT do**:
  - Do NOT modify `TradeIntent` interface
  - Do NOT change `intentHash` computation
  - Do NOT add metadata fields to canonical encoding

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Type definitions are straightforward, well-scoped
  - **Skills**: [`ts-react`]
    - `ts-react`: TypeScript patterns and type-safe coding

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 3, 4, 5)
  - **Blocks**: Tasks 6, 7
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `packages/sdk/src/types.ts:20-32` - TradeIntent interface structure
  - `packages/sdk/src/types.ts:41-45` - ProtocolScope pattern for extending types

  **API/Type References**:
  - `docs/prompts/kr/strategy_moltbot.md:26-35` - NadFun marketState fields to include

  **Documentation References**:
  - `docs/PROMPTING_CHATOPS_NADFUN_kr.md:42-45` - NadFun context fields

  **Acceptance Criteria**:

  **TDD (Tests First):**
  - [ ] Test file: `packages/sdk/test/nadfun-types.test.mjs`
  - [ ] Tests cover: NadFunIntentMeta fields, NadFunTradeIntent composition
  - [ ] `npm test -w @claw/protocol-sdk` → PASS (existing + new tests)

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: NadFunIntentMeta type is valid TypeScript
    Tool: Bash
    Preconditions: SDK package exists
    Steps:
      1. cd packages/sdk && npm run build
      2. Assert: exit code 0
      3. Assert: dist/nadfun-types.d.ts exists
    Expected Result: Types compile
    Evidence: Build output captured

  Scenario: Existing tests still pass (no regression)
    Tool: Bash
    Preconditions: SDK tests exist
    Steps:
      1. cd packages/sdk && npm test
      2. Assert: exit code 0
      3. Assert: all previous tests pass
    Expected Result: No regression
    Evidence: Test output captured

  Scenario: intentHash unchanged for base TradeIntent
    Tool: Bash
    Preconditions: Test with existing vector
    Steps:
      1. Run test that computes intentHash for known TradeIntent
      2. Assert: hash matches expected value from vectors.json
    Expected Result: Hash unchanged
    Evidence: Test output captured
  ```

  **Commit**: YES
  - Message: `feat(sdk): add NadFunIntentMeta type for offchain metadata`
  - Files: `packages/sdk/src/nadfun-types.ts`, `packages/sdk/src/index.ts`
  - Pre-commit: `cd packages/sdk && npm test`

---

- [ ] 3. SDK ClaimBook Hash Conformance

  **What to do**:
  - Add test vectors for ClaimBook hashes
  - Ensure SDK `claimHash` matches Solidity implementation
  - Add `snapshotHash` conformance test

  **Branch**: `feature/sdk-claimbook-conformance`

  **Must NOT do**:
  - Do NOT change hash algorithm if already working
  - Do NOT modify Solidity to match SDK (SDK adapts to contract)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Test vector addition is well-scoped
  - **Skills**: [`ts-react`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 7
  - **Blocked By**: Task 1 (needs ClaimBook to exist)

  **References**:

  **Pattern References**:
  - `packages/sdk/src/hash.ts` - Existing hash functions
  - `packages/sdk/src/canonical.ts` - Canonical encoding patterns

  **Test References**:
  - `packages/contracts/test/IntentBook.t.sol` - How Solidity tests verify hashes

  **Acceptance Criteria**:

  **TDD:**
  - [ ] Test: `packages/sdk/test/hash.test.mjs` extended with ClaimBook vectors
  - [ ] `npm test -w @claw/protocol-sdk` → PASS

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: SDK claimHash matches Solidity
    Tool: Bash
    Preconditions: Same test vector used in both SDK and Foundry tests
    Steps:
      1. cd packages/sdk && npm test
      2. Assert: exit code 0
      3. Assert: output contains "claimHash" test passing
    Expected Result: Hashes match
    Evidence: Test output with hash values
  ```

  **Commit**: YES
  - Message: `test(sdk): add ClaimBook hash conformance vectors`
  - Files: `packages/sdk/test/hash.test.mjs`, `packages/sdk/test/vectors.json`
  - Pre-commit: `npm test -w @claw/protocol-sdk`

---

- [x] 4. MoltBot SKILL.md Documentation

  **What to do**:
  - Fill `packages/agents/skills/strategy/SKILL.md` with full spec
  - Fill `packages/agents/skills/participant/SKILL.md` with full spec
  - Include YAML frontmatter, Input/Output JSON schemas, Rules
  - Base content on existing `docs/prompts/kr/*.md` templates

  **Branch**: `feature/skills-documentation`

  **Must NOT do**:
  - Do NOT build runtime SKILL.md parser
  - Do NOT implement clawhub installer
  - Do NOT include Mode C (Intent Judgment Vote) in participant skills

  **Recommended Agent Profile**:
  - **Category**: `writing`
    - Reason: Documentation task, structured technical writing
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 1)
  - **Blocks**: Task 6
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `docs/prompts/kr/strategy_moltbot.md` - Strategy prompt template (source content)
  - `docs/prompts/kr/participant_moltbot.md` - Participant prompt template (source content)

  **Documentation References**:
  - `https://docs.molt.bot/tools/skills` - MoltBot Skills spec (SKILL.md format)
  - `packages/agents/skills/README.md` - Local skills structure

  **Acceptance Criteria**:

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: SKILL.md has required sections
    Tool: Bash (grep)
    Preconditions: SKILL.md files exist
    Steps:
      1. grep -q "^---" packages/agents/skills/strategy/SKILL.md
      2. grep -q "## Input" packages/agents/skills/strategy/SKILL.md
      3. grep -q "## Output" packages/agents/skills/strategy/SKILL.md
      4. grep -q "## Rules" packages/agents/skills/strategy/SKILL.md
      5. Repeat for participant skill
    Expected Result: All sections present
    Evidence: grep exit codes

  Scenario: YAML frontmatter is valid
    Tool: Bash
    Preconditions: SKILL.md files have frontmatter
    Steps:
      1. Extract frontmatter from SKILL.md
      2. Validate YAML syntax
    Expected Result: Valid YAML
    Evidence: Validation output
  ```

  **Commit**: YES
  - Message: `docs(skills): complete SKILL.md specs for strategy and participant`
  - Files: `packages/agents/skills/strategy/SKILL.md`, `packages/agents/skills/participant/SKILL.md`
  - Pre-commit: `grep "## Input" packages/agents/skills/*/SKILL.md`

---

- [ ] 5. Relayer SSE Endpoints

  **What to do**:
  - Write tests first for SSE behavior
  - Implement SSE route: `GET /api/v1/funds/[fundId]/events/claims`
  - Implement SSE route: `GET /api/v1/funds/[fundId]/events/intents`
  - Use in-process EventEmitter (no Redis/Kafka)
  - Emit events from existing aggregator after DB mutations
  - Support `Last-Event-ID` for reconnection

  **Branch**: `feature/relayer-sse`

  **Must NOT do**:
  - Do NOT replace existing REST endpoints
  - Do NOT use WebSocket
  - Do NOT introduce external message queue

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Next.js App Router SSE requires understanding of streaming responses
  - **Skills**: [`ts-react`]
    - `ts-react`: Next.js App Router patterns

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 7
  - **Blocked By**: Task 1 (needs ClaimBook for aggregator integration)

  **References**:

  **Pattern References**:
  - `packages/relayer/lib/aggregator.ts` - Where to emit events after mutations
  - `packages/relayer/app/api/v1/funds/[fundId]/attestations/route.ts` - Existing route pattern

  **API/Type References**:
  - `packages/relayer/lib/sqlite.ts` - DB access patterns for event state

  **External References**:
  - MDN SSE docs for `text/event-stream` format
  - Next.js streaming responses documentation

  **Acceptance Criteria**:

  **TDD:**
  - [ ] Test: SSE connection test script
  - [ ] Test: Event emission after attestation

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: SSE endpoint returns correct content-type
    Tool: Bash (curl)
    Preconditions: Relayer running on localhost:3000
    Steps:
      1. curl -s -I -H "Accept: text/event-stream" \
           http://localhost:3000/api/v1/funds/fund-001/events/claims
      2. Assert: Content-Type header contains "text/event-stream"
    Expected Result: Correct SSE headers
    Evidence: curl output

  Scenario: SSE emits event after claim attestation
    Tool: Bash (curl + background process)
    Preconditions: Relayer running, bot auth configured
    Steps:
      1. Start SSE listener: curl -N http://localhost:3000/api/v1/funds/fund-001/events/claims > /tmp/sse.txt &
      2. Submit attestation via POST /attestations
      3. Wait 2 seconds
      4. Kill SSE listener
      5. grep "event: claim:attested" /tmp/sse.txt
    Expected Result: Event received
    Evidence: /tmp/sse.txt content

  Scenario: Last-Event-ID reconnection works
    Tool: Bash (curl)
    Preconditions: Previous events exist
    Steps:
      1. curl -H "Last-Event-ID: evt-123" http://localhost:3000/api/v1/funds/fund-001/events/claims
      2. Assert: Events after ID are returned
    Expected Result: Reconnection replays missed events
    Evidence: Event stream content
  ```

  **Commit**: YES
  - Message: `feat(relayer): add SSE endpoints for claim/intent events`
  - Files: `packages/relayer/app/api/v1/funds/[fundId]/events/claims/route.ts`, `packages/relayer/lib/event-emitter.ts`
  - Pre-commit: `curl -s -I http://localhost:3000/api/v1/funds/fund-001/events/claims | grep text/event-stream`

---

- [ ] 6. MoltBot Skills TypeScript Runtime

  **What to do**:
  - Implement `packages/agents/skills/participant/index.ts`
  - Implement `packages/agents/skills/strategy/index.ts`
  - Functions: registerBot, mineClaim, verifyClaim, proposeIntent
  - Use SDK for hashing and type definitions
  - Export as proper modules

  **Branch**: `feature/skills-runtime`

  **Must NOT do**:
  - Do NOT implement Mode C (vote_intent_judgment)
  - Do NOT parse SKILL.md at runtime
  - Do NOT handle private key signing (separate signer module)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Straightforward function implementations using SDK
  - **Skills**: [`ts-react`]

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 7
  - **Blocked By**: Tasks 2, 4

  **References**:

  **Pattern References**:
  - `packages/sdk/src/index.ts` - SDK exports to use
  - `packages/relayer/lib/aggregator.ts:25-50` - How to call Relayer APIs

  **API/Type References**:
  - `packages/sdk/src/types.ts` - ClaimPayload, TradeIntent types
  - `packages/sdk/src/nadfun-types.ts` - NadFunIntentMeta (after Task 2)

  **Documentation References**:
  - `docs/prompts/kr/participant_moltbot.md:14-55` - Mode A (Mining) I/O contract
  - `docs/prompts/kr/participant_moltbot.md:57-96` - Mode B (Verification) I/O contract
  - `docs/prompts/kr/strategy_moltbot.md:12-78` - Intent proposal I/O contract

  **Acceptance Criteria**:

  **Build Verification:**
  - [ ] `npm run build -w @claw/agents` → PASS (TypeScript compiles)
  - [ ] Skills export required functions (verified via node import)
  - [ ] Full runtime test via Task 7 E2E integration

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: Agents package builds successfully
    Tool: Bash
    Preconditions: skills/participant/index.ts and skills/strategy/index.ts exist
    Steps:
      1. cd packages/agents && npm run build
      2. Assert: exit code 0
      3. Assert: dist/ directory contains compiled files
    Expected Result: Build succeeds
    Evidence: Build output captured

  Scenario: Participant skill exports required functions
    Tool: Bash
    Preconditions: Build completed
    Steps:
      1. node --input-type=module -e "import * as p from './packages/agents/dist/skills/participant/index.js'; console.log(typeof p.mineClaim)"
      2. Assert: output is "function"
    Expected Result: Functions exported
    Evidence: console output

  Scenario: Strategy skill exports proposeIntent function
    Tool: Bash
    Preconditions: Build completed
    Steps:
      1. node --input-type=module -e "import * as s from './packages/agents/dist/skills/strategy/index.js'; console.log(typeof s.proposeIntent)"
      2. Assert: output is "function"
    Expected Result: Function exported
    Evidence: console output
  ```

  **Commit**: YES
  - Message: `feat(agents): implement participant and strategy skill runtimes`
  - Files: `packages/agents/skills/participant/index.ts`, `packages/agents/skills/strategy/index.ts`
  - Pre-commit: `npm run build -w @claw/agents`

---

- [ ] 7. Integration Test (E2E Happy Path)

  **What to do**:
  - Update `scripts/demo-local.sh` to run full flow
  - Flow: Deploy contracts → Start relayer → Submit claim → Attest → Finalize snapshot → Propose intent → Attest intent → Verify approved
  - Verify final state via Relayer API

  **Branch**: `feature/integration-test`

  **Must NOT do**:
  - Do NOT include actual Vault execution (mocked)
  - Do NOT require external RPC (use local Foundry)

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Integration testing requires understanding all components
  - **Skills**: [`git-master`]

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (final)
  - **Blocks**: None
  - **Blocked By**: All other tasks

  **References**:

  **Pattern References**:
  - `scripts/demo-local.sh` (if exists) - Current scaffold
  - `packages/indexer/scripts/local-smoke.mjs` - Similar script pattern

  **Acceptance Criteria**:

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: E2E demo script completes successfully
    Tool: Bash
    Preconditions: All tasks complete, dependencies installed
    Steps:
      1. ./scripts/demo-local.sh
      2. Assert: exit code 0
      3. Assert: output contains "Intent APPROVED" or similar success message
    Expected Result: Full flow works
    Evidence: Script output captured

  Scenario: Demo script handles failures gracefully
    Tool: Bash
    Preconditions: Intentionally misconfigure one step
    Steps:
      1. Run demo with missing env var
      2. Assert: Error message is clear
      3. Assert: Partial cleanup occurs
    Expected Result: Graceful failure
    Evidence: Error output
  ```

  **Commit**: YES
  - Message: `feat(scripts): complete E2E demo-local.sh happy path`
  - Files: `scripts/demo-local.sh`
  - Pre-commit: `./scripts/demo-local.sh`

---

## Commit Strategy

| After Task | Branch | Message | Files | Verification |
|------------|--------|---------|-------|--------------|
| 1 | feature/claimbook-contract | `feat(contracts): implement ClaimBook with ISnapshotBook interface` | ClaimBook.sol, ClaimBook.t.sol | forge test |
| 2 | feature/sdk-nadfun-types | `feat(sdk): add NadFunIntentMeta type for offchain metadata` | nadfun-types.ts, test/nadfun-types.test.mjs | npm test |
| 3 | feature/sdk-claimbook-conformance | `test(sdk): add ClaimBook hash conformance vectors` | test/hash.test.mjs, test/vectors.json | npm test |
| 4 | feature/skills-documentation | `docs(skills): complete SKILL.md specs for strategy and participant` | SKILL.md files | grep validation |
| 5 | feature/relayer-sse | `feat(relayer): add SSE endpoints for claim/intent events` | route.ts, event-emitter.ts | curl SSE test |
| 6 | feature/skills-runtime | `feat(agents): implement participant and strategy skill runtimes` | index.ts files | npm run build |
| 7 | feature/integration-test | `feat(scripts): complete E2E demo-local.sh happy path` | demo-local.sh | ./scripts/demo-local.sh |

---

## Success Criteria

### Verification Commands
```bash
# ClaimBook contract tests
cd packages/contracts && forge test --match-contract ClaimBookTest -vvv
# Expected: All tests pass

# SDK tests (no regression + new tests)
npm test -w @claw/protocol-sdk
# Expected: All tests pass

# SSE endpoint verification
curl -s -I -H "Accept: text/event-stream" http://localhost:3000/api/v1/funds/fund-001/events/claims | grep "text/event-stream"
# Expected: Content-Type header present

# SKILL.md validation
grep -l "## Input" packages/agents/skills/*/SKILL.md | wc -l
# Expected: 2 (strategy and participant)

# E2E happy path
./scripts/demo-local.sh
# Expected: exit code 0
```

### Final Checklist
- [ ] ClaimBook.sol compiles and all tests pass (`forge test`)
- [ ] SDK builds with NadFunIntentMeta, all tests pass (`npm test -w @claw/protocol-sdk`)
- [ ] Agents package builds successfully (`npm run build -w @claw/agents`)
- [ ] SSE endpoints return text/event-stream and emit events
- [ ] SKILL.md files have Input/Output/Rules sections
- [ ] All branches merged via PR
- [ ] demo-local.sh exit code 0
