-- Phase 1, Task 1 — catalog schema.
--
-- Column-name notes (Oracle-forced, see docs/DECISIONS.md):
--   `desc`   -> `descr`  and  `values` -> `vals`  because DESC and VALUES are on
--   Oracle's reserved-word list (verified against v$reserved_words on this
--   instance), the same class of failure as Phase 0's `size` -> `size_bytes`.
--
-- Every child table references its parent by the composite key
-- (company_id, id) rather than by id alone. Integrity constraints are checked
-- by the kernel and are not subject to VPD, so a plain `product_id` FK would
-- happily accept another company's product id; the composite form makes a
-- cross-company parent reference impossible at the database level.
--
-- media predates this migration and had no (company_id, id) key, so it gains one
-- first — the image FKs on cats, colls and prod_imgs below all reference it.

ALTER TABLE media ADD CONSTRAINT media_company_id_uq UNIQUE (company_id, id)
/

CREATE TABLE cats (
  id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id  NUMBER NOT NULL,
  parent_id   NUMBER,
  name        VARCHAR2(200) NOT NULL,
  slug        VARCHAR2(200) NOT NULL,
  descr       CLOB,
  image_id    NUMBER,
  position    NUMBER DEFAULT 0 NOT NULL,
  is_active   NUMBER(1) DEFAULT 1 NOT NULL,
  meta_title  VARCHAR2(255),
  meta_desc   VARCHAR2(500),
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  updated_at  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT cats_company_id_uq UNIQUE (company_id, id),
  CONSTRAINT cats_company_slug_uq UNIQUE (company_id, slug),
  CONSTRAINT cats_is_active_ck CHECK (is_active IN (0,1)),
  CONSTRAINT cats_company_fk FOREIGN KEY (company_id) REFERENCES companies(id)
)
/

CREATE TABLE products (
  id           NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id   NUMBER NOT NULL,
  name         VARCHAR2(300) NOT NULL,
  slug         VARCHAR2(300) NOT NULL,
  descr        CLOB,
  short_desc   VARCHAR2(1000),
  brand        VARCHAR2(200),
  is_active    NUMBER(1) DEFAULT 1 NOT NULL,
  is_featured  NUMBER(1) DEFAULT 0 NOT NULL,
  tags         CLOB,
  meta_title   VARCHAR2(255),
  meta_desc    VARCHAR2(500),
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  updated_at   TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  deleted_at   TIMESTAMP WITH TIME ZONE,
  CONSTRAINT products_company_id_uq UNIQUE (company_id, id),
  CONSTRAINT products_company_slug_uq UNIQUE (company_id, slug),
  CONSTRAINT products_is_active_ck CHECK (is_active IN (0,1)),
  CONSTRAINT products_is_featured_ck CHECK (is_featured IN (0,1)),
  CONSTRAINT products_tags_json_ck CHECK (tags IS JSON),
  CONSTRAINT products_company_fk FOREIGN KEY (company_id) REFERENCES companies(id)
)
/

CREATE TABLE variants (
  id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id  NUMBER NOT NULL,
  product_id  NUMBER NOT NULL,
  sku         VARCHAR2(100),
  barcode     VARCHAR2(100),
  name        VARCHAR2(200),
  opts        CLOB,
  price       NUMBER(12,2) DEFAULT 0 NOT NULL,
  sale_price  NUMBER(12,2),
  cost        NUMBER(12,2),
  stock       NUMBER DEFAULT 0 NOT NULL,
  weight      NUMBER(10,3),
  is_default  NUMBER(1) DEFAULT 0 NOT NULL,
  position    NUMBER DEFAULT 0 NOT NULL,
  is_active   NUMBER(1) DEFAULT 1 NOT NULL,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  updated_at  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT variants_company_sku_uq UNIQUE (company_id, sku),
  CONSTRAINT variants_is_default_ck CHECK (is_default IN (0,1)),
  CONSTRAINT variants_is_active_ck CHECK (is_active IN (0,1)),
  CONSTRAINT variants_price_ck CHECK (price >= 0),
  CONSTRAINT variants_sale_price_ck CHECK (sale_price IS NULL OR sale_price >= 0),
  CONSTRAINT variants_opts_json_ck CHECK (opts IS JSON),
  CONSTRAINT variants_company_fk FOREIGN KEY (company_id) REFERENCES companies(id),
  CONSTRAINT variants_product_fk FOREIGN KEY (company_id, product_id) REFERENCES products(company_id, id)
)
/

CREATE TABLE options (
  id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id  NUMBER NOT NULL,
  product_id  NUMBER NOT NULL,
  name        VARCHAR2(100) NOT NULL,
  vals        CLOB,
  position    NUMBER DEFAULT 0 NOT NULL,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  updated_at  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT options_product_name_uq UNIQUE (company_id, product_id, name),
  CONSTRAINT options_vals_json_ck CHECK (vals IS JSON),
  CONSTRAINT options_company_fk FOREIGN KEY (company_id) REFERENCES companies(id),
  CONSTRAINT options_product_fk FOREIGN KEY (company_id, product_id) REFERENCES products(company_id, id)
)
/

CREATE TABLE prod_imgs (
  id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id  NUMBER NOT NULL,
  product_id  NUMBER NOT NULL,
  media_id    NUMBER NOT NULL,
  alt         VARCHAR2(255),
  position    NUMBER DEFAULT 0 NOT NULL,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT prod_imgs_uq UNIQUE (company_id, product_id, media_id),
  CONSTRAINT prod_imgs_company_fk FOREIGN KEY (company_id) REFERENCES companies(id),
  CONSTRAINT prod_imgs_product_fk FOREIGN KEY (company_id, product_id) REFERENCES products(company_id, id),
  CONSTRAINT prod_imgs_media_fk FOREIGN KEY (company_id, media_id) REFERENCES media(company_id, id)
)
/

CREATE TABLE prod_cats (
  company_id  NUMBER NOT NULL,
  product_id  NUMBER NOT NULL,
  cat_id      NUMBER NOT NULL,
  CONSTRAINT prod_cats_pk PRIMARY KEY (company_id, product_id, cat_id),
  CONSTRAINT prod_cats_company_fk FOREIGN KEY (company_id) REFERENCES companies(id),
  CONSTRAINT prod_cats_product_fk FOREIGN KEY (company_id, product_id) REFERENCES products(company_id, id),
  CONSTRAINT prod_cats_cat_fk FOREIGN KEY (company_id, cat_id) REFERENCES cats(company_id, id)
)
/

CREATE TABLE colls (
  id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id  NUMBER NOT NULL,
  name        VARCHAR2(200) NOT NULL,
  slug        VARCHAR2(200) NOT NULL,
  descr       CLOB,
  image_id    NUMBER,
  type        VARCHAR2(10) DEFAULT 'manual' NOT NULL,
  rules       CLOB,
  is_active   NUMBER(1) DEFAULT 1 NOT NULL,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  updated_at  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT colls_company_id_uq UNIQUE (company_id, id),
  CONSTRAINT colls_company_slug_uq UNIQUE (company_id, slug),
  CONSTRAINT colls_type_ck CHECK (type IN ('manual','auto')),
  CONSTRAINT colls_is_active_ck CHECK (is_active IN (0,1)),
  CONSTRAINT colls_rules_json_ck CHECK (rules IS JSON),
  CONSTRAINT colls_company_fk FOREIGN KEY (company_id) REFERENCES companies(id),
  CONSTRAINT colls_image_fk FOREIGN KEY (company_id, image_id) REFERENCES media(company_id, id)
)
/

CREATE TABLE coll_prods (
  company_id  NUMBER NOT NULL,
  coll_id     NUMBER NOT NULL,
  product_id  NUMBER NOT NULL,
  position    NUMBER DEFAULT 0 NOT NULL,
  CONSTRAINT coll_prods_pk PRIMARY KEY (company_id, coll_id, product_id),
  CONSTRAINT coll_prods_company_fk FOREIGN KEY (company_id) REFERENCES companies(id),
  CONSTRAINT coll_prods_coll_fk FOREIGN KEY (company_id, coll_id) REFERENCES colls(company_id, id),
  CONSTRAINT coll_prods_product_fk FOREIGN KEY (company_id, product_id) REFERENCES products(company_id, id)
)
/

-- cats' self-reference and image FK, added now that both targets exist.
ALTER TABLE cats ADD CONSTRAINT cats_parent_fk FOREIGN KEY (company_id, parent_id) REFERENCES cats(company_id, id)
/

ALTER TABLE cats ADD CONSTRAINT cats_image_fk FOREIGN KEY (company_id, image_id) REFERENCES media(company_id, id)
/

-- Exactly one default variant per product: for non-default rows both expressions
-- are NULL, and Oracle leaves entirely-NULL entries out of a unique index.
CREATE UNIQUE INDEX variants_one_default_uq ON variants (
  CASE WHEN is_default = 1 THEN company_id END,
  CASE WHEN is_default = 1 THEN product_id END
)
/

CREATE INDEX cats_company_parent_pos_ix ON cats(company_id, parent_id, position)
/

CREATE INDEX products_company_active_ix ON products(company_id, is_active, created_at)
/

CREATE INDEX products_company_name_ix ON products(company_id, name)
/

CREATE INDEX variants_company_product_ix ON variants(company_id, product_id)
/

CREATE INDEX options_company_product_ix ON options(company_id, product_id)
/

CREATE INDEX prod_imgs_company_product_ix ON prod_imgs(company_id, product_id, position)
/

CREATE INDEX prod_cats_company_cat_ix ON prod_cats(company_id, cat_id, product_id)
/

CREATE INDEX coll_prods_company_product_ix ON coll_prods(company_id, product_id)
/

CREATE INDEX coll_prods_company_coll_pos_ix ON coll_prods(company_id, coll_id, position)
/

BEGIN
  DBMS_RLS.ADD_POLICY(
    object_name     => 'cats',
    policy_name     => 'cats_co_pol',
    policy_function => 'sf_sec.company_predicate',
    statement_types => 'SELECT,INSERT,UPDATE,DELETE',
    update_check    => TRUE);
END;
/

BEGIN
  DBMS_RLS.ADD_POLICY(
    object_name     => 'products',
    policy_name     => 'products_co_pol',
    policy_function => 'sf_sec.company_predicate',
    statement_types => 'SELECT,INSERT,UPDATE,DELETE',
    update_check    => TRUE);
END;
/

BEGIN
  DBMS_RLS.ADD_POLICY(
    object_name     => 'variants',
    policy_name     => 'variants_co_pol',
    policy_function => 'sf_sec.company_predicate',
    statement_types => 'SELECT,INSERT,UPDATE,DELETE',
    update_check    => TRUE);
END;
/

BEGIN
  DBMS_RLS.ADD_POLICY(
    object_name     => 'options',
    policy_name     => 'options_co_pol',
    policy_function => 'sf_sec.company_predicate',
    statement_types => 'SELECT,INSERT,UPDATE,DELETE',
    update_check    => TRUE);
END;
/

BEGIN
  DBMS_RLS.ADD_POLICY(
    object_name     => 'prod_imgs',
    policy_name     => 'prod_imgs_co_pol',
    policy_function => 'sf_sec.company_predicate',
    statement_types => 'SELECT,INSERT,UPDATE,DELETE',
    update_check    => TRUE);
END;
/

BEGIN
  DBMS_RLS.ADD_POLICY(
    object_name     => 'prod_cats',
    policy_name     => 'prod_cats_co_pol',
    policy_function => 'sf_sec.company_predicate',
    statement_types => 'SELECT,INSERT,UPDATE,DELETE',
    update_check    => TRUE);
END;
/

BEGIN
  DBMS_RLS.ADD_POLICY(
    object_name     => 'colls',
    policy_name     => 'colls_co_pol',
    policy_function => 'sf_sec.company_predicate',
    statement_types => 'SELECT,INSERT,UPDATE,DELETE',
    update_check    => TRUE);
END;
/

BEGIN
  DBMS_RLS.ADD_POLICY(
    object_name     => 'coll_prods',
    policy_name     => 'coll_prods_co_pol',
    policy_function => 'sf_sec.company_predicate',
    statement_types => 'SELECT,INSERT,UPDATE,DELETE',
    update_check    => TRUE);
END;
/

GRANT SELECT, INSERT, UPDATE, DELETE ON cats TO sf_platform_role
/

GRANT SELECT, INSERT, UPDATE, DELETE ON products TO sf_platform_role
/

GRANT SELECT, INSERT, UPDATE, DELETE ON variants TO sf_platform_role
/

GRANT SELECT, INSERT, UPDATE, DELETE ON options TO sf_platform_role
/

GRANT SELECT, INSERT, UPDATE, DELETE ON prod_imgs TO sf_platform_role
/

GRANT SELECT, INSERT, UPDATE, DELETE ON prod_cats TO sf_platform_role
/

GRANT SELECT, INSERT, UPDATE, DELETE ON colls TO sf_platform_role
/

GRANT SELECT, INSERT, UPDATE, DELETE ON coll_prods TO sf_platform_role
/
