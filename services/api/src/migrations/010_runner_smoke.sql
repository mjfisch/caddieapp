-- 010: runner smoke test (mission 2.6). Harmless and idempotent — its only job
-- is to prove the DEPLOYED app applies migrations end-to-end via the embedded
-- manifest. Verify: SELECT * FROM _migrations WHERE filename LIKE '010%';
COMMENT ON TABLE _migrations IS 'migration ledger — 010 runner smoke test applied';
