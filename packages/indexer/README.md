# indexer (Deferred)

This package is intentionally **last priority** for MVP.

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
