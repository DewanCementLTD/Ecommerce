-- Fixes a bug in 003_catalog.sql found by the first products test run.
--
-- `variants_company_sku_uq UNIQUE (company_id, sku)` was meant to read "a SKU is
-- unique within a company, and optional". It does not: sku is nullable, and
-- Oracle only leaves an index entry out when *every* key column is NULL. With
-- company_id always populated, two SKU-less variants in the same company both
-- index as (42, NULL) and the second one raises ORA-00001 — so a store could
-- only ever have one product without a SKU.
--
-- The function-based form nulls out the whole key when sku is absent, so those
-- rows are not indexed at all, while SKUs that do exist stay unique per company.
-- Same technique as variants_one_default_uq in 003.

ALTER TABLE variants DROP CONSTRAINT variants_company_sku_uq
/

CREATE UNIQUE INDEX variants_company_sku_uq ON variants (
  CASE WHEN sku IS NULL THEN NULL ELSE company_id END,
  sku
)
/
