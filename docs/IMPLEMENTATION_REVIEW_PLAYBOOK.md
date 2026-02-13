# Implementation Review Playbook

This document operationalizes the 15-step implementation workflow into a repeatable process.
Use this playbook for all non-trivial changes.

## 1) Complexity Calibration

Select one class before planning:

| Class | Typical Change Scope | Required Evidence |
| --- | --- | --- |
| S (small) | Docs, config, or isolated fix in one file | Plan note, test note, side-effect note |
| M (medium) | One component or one package behavior change | Plan, risk review, test results, rollback note |
| L (large) | Cross-package changes, schema/protocol/security-sensitive work | Full plan, design review, security review, migration/rollback plan, full regression notes |

Rule:
- If uncertain, choose the higher class.
- If the change grows, reclassify and update plan artifacts.

## 2) Detailed 15-Step Workflow

| Step | Goal | Required Output | Gate Question |
| --- | --- | --- | --- |
| 1 | Build implementation plan | Scope, assumptions, acceptance criteria, non-goals | Is the objective measurable? |
| 2 | Review plan | Review notes and identified gaps | Did another reviewer challenge key assumptions? |
| 3 | Validate review correctness | Re-check revised plan against requirements | Did the review address real requirements, not preference? |
| 4 | Prevent over-engineering | Simpler alternative comparison | Is there a cheaper solution with same outcome? |
| 5 | Implement | Code changes mapped to plan steps | Does each code change map to a requirement? |
| 6 | Validate objective fit | Functional verification results | Does behavior now match acceptance criteria? |
| 7 | Scan for bugs and security issues | Bug-risk/security checklist | Any critical bug path or trust boundary break? |
| 8 | Validate improvement safety | Regression notes from improvements | Did refactor/cleanup introduce issues? |
| 9 | Control file/function size | Split or justify large units | Are large units still readable and testable? |
| 10 | Reuse/integration review | List of reused modules or reasons not reused | Did we avoid duplicate logic? |
| 11 | Side-effect analysis | Impacted APIs, data, workflows list | Any unintended consumer behavior change? |
| 12 | Full delta re-review | End-to-end review summary | Is the final diff coherent as one story? |
| 13 | Remove obsolete code | Deleted dead code list | Is there leftover code path no longer needed? |
| 14 | Confirm quality bar | Lint/test/build and maintainability check | Is this merge-ready without caveats? |
| 15 | Validate user flow | User journey test notes | Can users complete key flow without friction? |

## 3) What Makes a Plan "Good"

Use this quick rubric before implementation:

| Criterion | Pass Condition |
| --- | --- |
| Problem clarity | Problem statement identifies current vs target behavior |
| Scope clarity | Explicit in-scope and out-of-scope items exist |
| Reuse first | Existing modules reviewed before adding new abstractions |
| Verifiability | Acceptance criteria are testable and binary |
| Risk coverage | Failure modes and mitigations are documented |
| Operational safety | Rollback and migration impact are documented when relevant |

Minimum pass:
- S class: pass at least 4 criteria.
- M class: pass at least 5 criteria.
- L class: pass all criteria.

## 4) Over-Engineering Guardrails

- Prefer adaptation of existing modules over new frameworks.
- Add abstractions only when at least two concrete callers need them.
- Avoid speculative extensibility without a current requirement.
- Keep data model changes minimal and reversible.
- Do not introduce new infrastructure unless needed for current acceptance criteria.

## 5) Review Order (Recommended)

Run reviews in this order for signal quality:

1. Functional correctness and acceptance criteria.
2. Security and trust boundaries.
3. Side effects and compatibility.
4. Maintainability and code size.
5. User flow quality and operational readiness.

## 6) Compliance Reminder

Submission artifacts must remain open source under an OSI-approved license.
Accepted examples include MIT, Apache-2.0, GPL, BSD, or equivalent.
