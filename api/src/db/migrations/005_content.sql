-- Phase 1, Task 3 of the brief — page/content schema.
--
-- Same three obligations as every company-owned table: a VPD policy in this
-- file, a grant to sf_platform_role, and an entry in PLATFORM_TABLES in
-- scripts/setup-platform-user.js.
--
-- Composite (company_id, id) parent keys again, for the reason set out in
-- 003_catalog.sql: FK checks run outside VPD, so a single-column FK would
-- accept another company's row.

CREATE TABLE pages (
  id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id    NUMBER NOT NULL,
  title         VARCHAR2(300) NOT NULL,
  slug          VARCHAR2(300) NOT NULL,
  type          VARCHAR2(10) DEFAULT 'page' NOT NULL,
  content       CLOB,
  is_active     NUMBER(1) DEFAULT 1 NOT NULL,
  meta_title    VARCHAR2(255),
  meta_desc     VARCHAR2(500),
  og_image_id   NUMBER,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  updated_at    TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT pages_company_id_uq UNIQUE (company_id, id),
  CONSTRAINT pages_company_slug_uq UNIQUE (company_id, slug),
  CONSTRAINT pages_type_ck CHECK (type IN ('home','page')),
  CONSTRAINT pages_is_active_ck CHECK (is_active IN (0,1)),
  CONSTRAINT pages_company_fk FOREIGN KEY (company_id) REFERENCES companies(id),
  CONSTRAINT pages_og_image_fk FOREIGN KEY (company_id, og_image_id) REFERENCES media(company_id, id)
)
/

-- One home page per company: the storefront's "/" has to resolve to exactly one
-- row. Non-home pages index as all-NULL and are therefore not constrained.
CREATE UNIQUE INDEX pages_one_home_uq ON pages (
  CASE WHEN type = 'home' THEN company_id END
)
/

CREATE TABLE sections (
  id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id  NUMBER NOT NULL,
  page_id     NUMBER NOT NULL,
  type        VARCHAR2(30) NOT NULL,
  position    NUMBER DEFAULT 0 NOT NULL,
  is_active   NUMBER(1) DEFAULT 1 NOT NULL,
  settings    CLOB,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  updated_at  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT sections_is_active_ck CHECK (is_active IN (0,1)),
  CONSTRAINT sections_settings_json_ck CHECK (settings IS JSON),
  CONSTRAINT sections_company_fk FOREIGN KEY (company_id) REFERENCES companies(id),
  CONSTRAINT sections_page_fk FOREIGN KEY (company_id, page_id) REFERENCES pages(company_id, id)
)
/

-- No CHECK on sections.type: the registry in shared/sections/registry.js is the
-- single authority on which types exist, and adding one there must not require
-- a migration. The API validates against it on write.

CREATE TABLE banners (
  id               NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id       NUMBER NOT NULL,
  name             VARCHAR2(200) NOT NULL,
  media_id         NUMBER,
  media_mobile_id  NUMBER,
  link             VARCHAR2(500),
  alt              VARCHAR2(255),
  position         NUMBER DEFAULT 0 NOT NULL,
  is_active        NUMBER(1) DEFAULT 1 NOT NULL,
  starts_at        TIMESTAMP WITH TIME ZONE,
  ends_at          TIMESTAMP WITH TIME ZONE,
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  updated_at       TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT banners_company_id_uq UNIQUE (company_id, id),
  CONSTRAINT banners_is_active_ck CHECK (is_active IN (0,1)),
  CONSTRAINT banners_window_ck CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT banners_company_fk FOREIGN KEY (company_id) REFERENCES companies(id),
  CONSTRAINT banners_media_fk FOREIGN KEY (company_id, media_id) REFERENCES media(company_id, id),
  CONSTRAINT banners_media_mobile_fk FOREIGN KEY (company_id, media_mobile_id) REFERENCES media(company_id, id)
)
/

CREATE TABLE menus (
  id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id  NUMBER NOT NULL,
  code        VARCHAR2(20) NOT NULL,
  name        VARCHAR2(120) NOT NULL,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  updated_at  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT menus_company_id_uq UNIQUE (company_id, id),
  CONSTRAINT menus_company_code_uq UNIQUE (company_id, code),
  CONSTRAINT menus_code_ck CHECK (code IN ('header','footer')),
  CONSTRAINT menus_company_fk FOREIGN KEY (company_id) REFERENCES companies(id)
)
/

CREATE TABLE menu_items (
  id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id  NUMBER NOT NULL,
  menu_id     NUMBER NOT NULL,
  parent_id   NUMBER,
  label       VARCHAR2(200) NOT NULL,
  url         VARCHAR2(500),
  link_type   VARCHAR2(20) DEFAULT 'url' NOT NULL,
  link_id     NUMBER,
  position    NUMBER DEFAULT 0 NOT NULL,
  is_active   NUMBER(1) DEFAULT 1 NOT NULL,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  updated_at  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT menu_items_company_id_uq UNIQUE (company_id, id),
  CONSTRAINT menu_items_is_active_ck CHECK (is_active IN (0,1)),
  CONSTRAINT menu_items_link_type_ck CHECK (link_type IN ('url','cat','coll','page','product')),
  -- A pointer link needs something to point at; a plain url link needs a url.
  CONSTRAINT menu_items_target_ck CHECK (
    (link_type = 'url' AND url IS NOT NULL) OR (link_type <> 'url' AND link_id IS NOT NULL)
  ),
  CONSTRAINT menu_items_company_fk FOREIGN KEY (company_id) REFERENCES companies(id),
  CONSTRAINT menu_items_menu_fk FOREIGN KEY (company_id, menu_id) REFERENCES menus(company_id, id),
  CONSTRAINT menu_items_parent_fk FOREIGN KEY (company_id, parent_id) REFERENCES menu_items(company_id, id)
)
/

-- No separate (company_id, slug) index on pages: pages_company_slug_uq already
-- indexes exactly those columns, and Oracle rejects the duplicate (ORA-01408).

CREATE INDEX sections_company_page_pos_ix ON sections(company_id, page_id, position)
/

CREATE INDEX banners_company_active_pos_ix ON banners(company_id, is_active, position)
/

CREATE INDEX menu_items_company_menu_ix ON menu_items(company_id, menu_id, parent_id, position)
/

BEGIN
  DBMS_RLS.ADD_POLICY(
    object_name     => 'pages',
    policy_name     => 'pages_co_pol',
    policy_function => 'sf_sec.company_predicate',
    statement_types => 'SELECT,INSERT,UPDATE,DELETE',
    update_check    => TRUE);
END;
/

BEGIN
  DBMS_RLS.ADD_POLICY(
    object_name     => 'sections',
    policy_name     => 'sections_co_pol',
    policy_function => 'sf_sec.company_predicate',
    statement_types => 'SELECT,INSERT,UPDATE,DELETE',
    update_check    => TRUE);
END;
/

BEGIN
  DBMS_RLS.ADD_POLICY(
    object_name     => 'banners',
    policy_name     => 'banners_co_pol',
    policy_function => 'sf_sec.company_predicate',
    statement_types => 'SELECT,INSERT,UPDATE,DELETE',
    update_check    => TRUE);
END;
/

BEGIN
  DBMS_RLS.ADD_POLICY(
    object_name     => 'menus',
    policy_name     => 'menus_co_pol',
    policy_function => 'sf_sec.company_predicate',
    statement_types => 'SELECT,INSERT,UPDATE,DELETE',
    update_check    => TRUE);
END;
/

BEGIN
  DBMS_RLS.ADD_POLICY(
    object_name     => 'menu_items',
    policy_name     => 'menu_items_co_pol',
    policy_function => 'sf_sec.company_predicate',
    statement_types => 'SELECT,INSERT,UPDATE,DELETE',
    update_check    => TRUE);
END;
/

GRANT SELECT, INSERT, UPDATE, DELETE ON pages TO sf_platform_role
/

GRANT SELECT, INSERT, UPDATE, DELETE ON sections TO sf_platform_role
/

GRANT SELECT, INSERT, UPDATE, DELETE ON banners TO sf_platform_role
/

GRANT SELECT, INSERT, UPDATE, DELETE ON menus TO sf_platform_role
/

GRANT SELECT, INSERT, UPDATE, DELETE ON menu_items TO sf_platform_role
/
