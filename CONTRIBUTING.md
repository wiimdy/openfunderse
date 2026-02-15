# Contributing

## Workflow
- Use GitHub Issues as the source of truth for tasks.
- Prefer small PRs that are easy to review.
- Link PRs to Issues using `Fixes #<id>` or `Refs #<id>`.

## Issue Quality Bar
Every task issue should have:
- Goal
- Acceptance Criteria
- Owner
- Links/References (if relevant)

## Implementation + Review Protocol
Use this flow for all non-trivial changes:
1. Plan the implementation.
2. Review the plan.
3. Re-validate the reviewed plan.
4. Ensure the plan is not over-engineered.
5. Implement.
6. Verify implementation matches the goal.
7. Review for bugs, critical issues, and security risks.
8. Review whether improvements caused new issues.
9. Split oversized functions/files when appropriate.
10. Review integration/reuse with existing code.
11. Check for side effects/regressions.
12. Re-review the full change set.
13. Remove code made unnecessary by the implementation.
14. Confirm code quality is high enough to merge.
15. Validate end-user flow is intact.

Open-source requirement for submissions:
- Use an OSI-approved license (MIT, Apache-2.0, GPL, BSD, or equivalent permissive license).

## Branches
- Use short, descriptive branch names.
- Example: `feat/claimbook-eip712` or `fix/intenthash-ordering`
