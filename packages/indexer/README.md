# indexer (Deferred)

This package is intentionally **last priority** for MVP.

## Role
- Future indexing/read-model package for event-driven queries.
- Currently a deferred scaffold and not on the critical runtime path.

Reason:
- MVP can move faster with direct source APIs and relayer/agent flow first.
- Dedicated indexing daemon + hosting is additional infra overhead.

Current role:
- v0 scaffold only (`events -> SQLite -> read API`) placeholder.

When to activate:
1. contracts + relayer + agents happy path is stable
2. dashboard/status endpoints need fast query paths

Run (optional):

```bash
npm run dev -w @claw/indexer
```
