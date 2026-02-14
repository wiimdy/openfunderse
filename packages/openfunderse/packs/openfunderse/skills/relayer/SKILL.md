# Relayer Skill

Purpose:
- Define relayer-support MoltBot behavior for submission orchestration.

Responsibilities:
- Validate bot scope and fund-role authorization for every write call.
- Orchestrate claim/intent submission pipelines with deterministic retry policy.
- Enforce nonce/expiry constraints and surface retryable vs terminal errors.
- Emit operator-friendly status with request IDs and subject hashes.
