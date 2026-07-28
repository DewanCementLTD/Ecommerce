-- Phase 3, Task 2 — indexes the plans asked for.
--
-- Found by `node scripts/explain-hot-queries.js <companyId>` against a store
-- seeded to 10k products and 2k orders (`scripts/seed-loadtest.js`), which is
-- the volume 00-SYSTEM-DESIGN.md §9 sets targets for. Against the ten-product
-- demo store every plan looked fine, which is exactly why the load-test store
-- exists: a plan on an empty table proves nothing.
--
-- Two of the fifteen hot statements full-scanned `orders`, both for the same
-- reason: the only index that led with `company_id` was
-- `orders_company_status_placed_ix (company_id, status, placed_at)`, and
-- neither query filters on `status`:
--
--   1. The admin order list — `WHERE company_id = :1 ORDER BY placed_at DESC`
--      with no status filter (the default view). With `status` in the middle
--      of the index, Oracle cannot walk it in `placed_at` order, so it read
--      every row of the table and sorted them to show twenty.
--   2. The dashboard's period figures — `WHERE company_id = :1 AND
--      placed_at >= :2 AND status != 'cancelled'`. A `!=` predicate is not a
--      range an index can be probed on, so `placed_at` was the only usable
--      access path and it was not the leading edge of any index.
--
-- One index fixes both. The existing status-leading index stays: the status
-- tabs in the admin ("new", "confirmed") do filter on it, and those queries
-- use it well.

CREATE INDEX orders_company_placed_ix ON orders(company_id, placed_at)
/

-- Deliberately NOT added: (company_id, customer_id, placed_at) for the
-- "my orders" screen. `placed_at` is TIMESTAMP WITH TIME ZONE, which Oracle
-- cannot index directly — it silently creates a function-based index over a
-- hidden `SYS_NC…$` column holding SYS_EXTRACT_UTC(placed_at). The optimizer
-- does not treat that expression as equivalent to `ORDER BY placed_at` for
-- ordering purposes, so such an index cannot eliminate the sort; it was built,
-- measured, found unused (the plan kept picking the existing two-column
-- `orders_company_customer_ix`), and dropped again rather than shipped as
-- decoration. The same limitation is why the admin order list still shows a
-- WINDOW SORT: it is an index range scan, not a full scan, and the sort is
-- unavoidable on this column type.

-- Low-stock and out-of-stock alerts on the dashboard scan variants for
-- `stock <= :threshold` across the whole company. Small today; this keeps it
-- an index range scan once a store has tens of thousands of variants.
CREATE INDEX variants_company_stock_ix ON variants(company_id, stock)
/
