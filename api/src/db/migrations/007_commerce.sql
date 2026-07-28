-- Phase 2, Task 1 — commerce schema: customers, addresses, carts, orders.
--
-- Numbered 007, not 006 as docs/03-PHASE-2-orders.md literally says — 006 is
-- already 006_i18n.sql (see docs/DECISIONS.md for the earlier renumbering this
-- one follows the same logic as).
--
-- Two additions beyond the brief, both written up in docs/DECISIONS.md:
--   - `order_seq`: a per-company counter row for human-friendly order numbers
--     ("#1001"), incremented inside the checkout transaction. The row lock an
--     UPDATE takes naturally serializes concurrent checkouts for one company.
--   - Every composite FK follows 003_catalog.sql's pattern (integrity checks
--     run outside VPD, so a single-column FK would accept a cross-company
--     parent id) — including a new `variants_company_id_uq` that 003 never
--     needed, since nothing referenced variants by id before now.

ALTER TABLE variants ADD CONSTRAINT variants_company_id_uq UNIQUE (company_id, id)
/

CREATE TABLE customers (
  id                NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id        NUMBER NOT NULL,
  email             VARCHAR2(320),
  phone             VARCHAR2(40) NOT NULL,
  name              VARCHAR2(200) NOT NULL,
  pass_hash         VARCHAR2(255),
  is_active         NUMBER(1) DEFAULT 1 NOT NULL,
  accepts_marketing NUMBER(1) DEFAULT 0 NOT NULL,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  updated_at        TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT customers_company_id_uq UNIQUE (company_id, id),
  CONSTRAINT customers_is_active_ck CHECK (is_active IN (0,1)),
  CONSTRAINT customers_accepts_marketing_ck CHECK (accepts_marketing IN (0,1)),
  CONSTRAINT customers_company_fk FOREIGN KEY (company_id) REFERENCES companies(id)
)
/

CREATE TABLE addrs (
  id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id  NUMBER NOT NULL,
  customer_id NUMBER NOT NULL,
  label       VARCHAR2(100),
  name        VARCHAR2(200) NOT NULL,
  phone       VARCHAR2(40) NOT NULL,
  line1       VARCHAR2(300) NOT NULL,
  line2       VARCHAR2(300),
  city        VARCHAR2(150) NOT NULL,
  area        VARCHAR2(150),
  notes       VARCHAR2(500),
  is_default  NUMBER(1) DEFAULT 0 NOT NULL,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  updated_at  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT addrs_is_default_ck CHECK (is_default IN (0,1)),
  CONSTRAINT addrs_company_fk FOREIGN KEY (company_id) REFERENCES companies(id),
  CONSTRAINT addrs_customer_fk FOREIGN KEY (company_id, customer_id) REFERENCES customers(company_id, id)
)
/

CREATE TABLE carts (
  id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id  NUMBER NOT NULL,
  token       VARCHAR2(36) NOT NULL,
  customer_id NUMBER,
  currency    VARCHAR2(10),
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  updated_at  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  expires_at  TIMESTAMP WITH TIME ZONE NOT NULL,
  CONSTRAINT carts_company_id_uq UNIQUE (company_id, id),
  CONSTRAINT carts_company_token_uq UNIQUE (company_id, token),
  CONSTRAINT carts_company_fk FOREIGN KEY (company_id) REFERENCES companies(id),
  CONSTRAINT carts_customer_fk FOREIGN KEY (company_id, customer_id) REFERENCES customers(company_id, id)
)
/

CREATE TABLE cart_items (
  id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id  NUMBER NOT NULL,
  cart_id     NUMBER NOT NULL,
  variant_id  NUMBER NOT NULL,
  qty         NUMBER NOT NULL,
  price_snap  NUMBER(12,2) NOT NULL,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT cart_items_qty_ck CHECK (qty > 0),
  CONSTRAINT cart_items_company_fk FOREIGN KEY (company_id) REFERENCES companies(id),
  -- A cart is worthless once the item it points to is gone, so this cascades
  -- rather than orphaning — unlike order_items, nothing needs the line to
  -- survive the variant.
  CONSTRAINT cart_items_cart_fk FOREIGN KEY (company_id, cart_id) REFERENCES carts(company_id, id) ON DELETE CASCADE,
  CONSTRAINT cart_items_variant_fk FOREIGN KEY (company_id, variant_id) REFERENCES variants(company_id, id) ON DELETE CASCADE
)
/

CREATE TABLE order_seq (
  company_id  NUMBER PRIMARY KEY,
  next_no     NUMBER DEFAULT 1000 NOT NULL,
  CONSTRAINT order_seq_company_fk FOREIGN KEY (company_id) REFERENCES companies(id)
)
/

CREATE TABLE orders (
  id           NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id   NUMBER NOT NULL,
  order_no     NUMBER NOT NULL,
  customer_id  NUMBER NOT NULL,
  status       VARCHAR2(20) DEFAULT 'new' NOT NULL,
  name         VARCHAR2(200) NOT NULL,
  email        VARCHAR2(320),
  phone        VARCHAR2(40) NOT NULL,
  address      CLOB NOT NULL,
  note         VARCHAR2(1000),
  subtotal     NUMBER(12,2) NOT NULL,
  discount     NUMBER(12,2) DEFAULT 0 NOT NULL,
  total        NUMBER(12,2) NOT NULL,
  currency     VARCHAR2(10),
  lang         VARCHAR2(10),
  placed_at    TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  updated_at   TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT orders_company_id_uq UNIQUE (company_id, id),
  CONSTRAINT orders_company_order_no_uq UNIQUE (company_id, order_no),
  CONSTRAINT orders_status_ck CHECK (status IN ('new','confirmed','delivered','cancelled')),
  CONSTRAINT orders_address_json_ck CHECK (address IS JSON),
  CONSTRAINT orders_subtotal_ck CHECK (subtotal >= 0),
  CONSTRAINT orders_discount_ck CHECK (discount >= 0),
  CONSTRAINT orders_total_ck CHECK (total >= 0),
  CONSTRAINT orders_company_fk FOREIGN KEY (company_id) REFERENCES companies(id),
  CONSTRAINT orders_customer_fk FOREIGN KEY (company_id, customer_id) REFERENCES customers(company_id, id)
)
/

CREATE TABLE order_items (
  id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id  NUMBER NOT NULL,
  order_id    NUMBER NOT NULL,
  variant_id  NUMBER,
  sku         VARCHAR2(100),
  name_snap   VARCHAR2(300) NOT NULL,
  opts_snap   CLOB,
  price_snap  NUMBER(12,2) NOT NULL,
  qty         NUMBER NOT NULL,
  line_total  NUMBER(12,2) NOT NULL,
  CONSTRAINT order_items_qty_ck CHECK (qty > 0),
  CONSTRAINT order_items_opts_json_ck CHECK (opts_snap IS JSON),
  CONSTRAINT order_items_company_fk FOREIGN KEY (company_id) REFERENCES companies(id),
  CONSTRAINT order_items_order_fk FOREIGN KEY (company_id, order_id) REFERENCES orders(company_id, id),
  -- Nullable and SET NULL on delete: the snapshot columns are the source of
  -- truth for a placed order, so a later hard-deleted variant (products.repo's
  -- deleteVariantById is a real DELETE, not a soft one) must not block or
  -- corrupt order history — it just loses a now-meaningless back-reference.
  CONSTRAINT order_items_variant_fk FOREIGN KEY (company_id, variant_id) REFERENCES variants(company_id, id) ON DELETE SET NULL
)
/

CREATE TABLE order_log (
  id           NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id   NUMBER NOT NULL,
  order_id     NUMBER NOT NULL,
  from_status  VARCHAR2(20),
  to_status    VARCHAR2(20) NOT NULL,
  admin_id     NUMBER,
  note         VARCHAR2(1000),
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT order_log_company_fk FOREIGN KEY (company_id) REFERENCES companies(id),
  CONSTRAINT order_log_order_fk FOREIGN KEY (company_id, order_id) REFERENCES orders(company_id, id)
)
/

-- Email is optional (guest checkout may supply only a phone), but when present
-- must be unique per company. Same "unique when present" technique as
-- 004_variant_sku_uq.sql: a plain UNIQUE(company_id, email) would only skip an
-- index entry when *every* key column is NULL, and company_id never is, so two
-- email-less guests would collide on (company_id, NULL).
CREATE UNIQUE INDEX customers_company_email_uq ON customers (
  CASE WHEN email IS NULL THEN NULL ELSE company_id END,
  email
)
/

CREATE INDEX customers_company_phone_ix ON customers(company_id, phone)
/

CREATE INDEX addrs_company_customer_ix ON addrs(company_id, customer_id)
/

CREATE INDEX cart_items_company_cart_ix ON cart_items(company_id, cart_id)
/

CREATE INDEX cart_items_company_variant_ix ON cart_items(company_id, variant_id)
/

-- Cross-tenant maintenance only (the 30-day cart cleanup script runs via
-- withPlatform across every company at once), so this is the one index in
-- the phase that does not lead with company_id.
CREATE INDEX carts_expires_at_ix ON carts(expires_at)
/

CREATE INDEX orders_company_status_placed_ix ON orders(company_id, status, placed_at)
/

CREATE INDEX orders_company_customer_ix ON orders(company_id, customer_id)
/

CREATE INDEX order_items_company_order_ix ON order_items(company_id, order_id)
/

CREATE INDEX order_log_company_order_ix ON order_log(company_id, order_id)
/

BEGIN
  DBMS_RLS.ADD_POLICY(
    object_name     => 'customers',
    policy_name     => 'customers_co_pol',
    policy_function => 'sf_sec.company_predicate',
    statement_types => 'SELECT,INSERT,UPDATE,DELETE',
    update_check    => TRUE);
END;
/

BEGIN
  DBMS_RLS.ADD_POLICY(
    object_name     => 'addrs',
    policy_name     => 'addrs_co_pol',
    policy_function => 'sf_sec.company_predicate',
    statement_types => 'SELECT,INSERT,UPDATE,DELETE',
    update_check    => TRUE);
END;
/

BEGIN
  DBMS_RLS.ADD_POLICY(
    object_name     => 'carts',
    policy_name     => 'carts_co_pol',
    policy_function => 'sf_sec.company_predicate',
    statement_types => 'SELECT,INSERT,UPDATE,DELETE',
    update_check    => TRUE);
END;
/

BEGIN
  DBMS_RLS.ADD_POLICY(
    object_name     => 'cart_items',
    policy_name     => 'cart_items_co_pol',
    policy_function => 'sf_sec.company_predicate',
    statement_types => 'SELECT,INSERT,UPDATE,DELETE',
    update_check    => TRUE);
END;
/

BEGIN
  DBMS_RLS.ADD_POLICY(
    object_name     => 'order_seq',
    policy_name     => 'order_seq_co_pol',
    policy_function => 'sf_sec.company_predicate',
    statement_types => 'SELECT,INSERT,UPDATE,DELETE',
    update_check    => TRUE);
END;
/

BEGIN
  DBMS_RLS.ADD_POLICY(
    object_name     => 'orders',
    policy_name     => 'orders_co_pol',
    policy_function => 'sf_sec.company_predicate',
    statement_types => 'SELECT,INSERT,UPDATE,DELETE',
    update_check    => TRUE);
END;
/

BEGIN
  DBMS_RLS.ADD_POLICY(
    object_name     => 'order_items',
    policy_name     => 'order_items_co_pol',
    policy_function => 'sf_sec.company_predicate',
    statement_types => 'SELECT,INSERT,UPDATE,DELETE',
    update_check    => TRUE);
END;
/

BEGIN
  DBMS_RLS.ADD_POLICY(
    object_name     => 'order_log',
    policy_name     => 'order_log_co_pol',
    policy_function => 'sf_sec.company_predicate',
    statement_types => 'SELECT,INSERT,UPDATE,DELETE',
    update_check    => TRUE);
END;
/

GRANT SELECT, INSERT, UPDATE, DELETE ON customers TO sf_platform_role
/

GRANT SELECT, INSERT, UPDATE, DELETE ON addrs TO sf_platform_role
/

GRANT SELECT, INSERT, UPDATE, DELETE ON carts TO sf_platform_role
/

GRANT SELECT, INSERT, UPDATE, DELETE ON cart_items TO sf_platform_role
/

GRANT SELECT, INSERT, UPDATE, DELETE ON order_seq TO sf_platform_role
/

GRANT SELECT, INSERT, UPDATE, DELETE ON orders TO sf_platform_role
/

GRANT SELECT, INSERT, UPDATE, DELETE ON order_items TO sf_platform_role
/

GRANT SELECT, INSERT, UPDATE, DELETE ON order_log TO sf_platform_role
/
