-- Phase 1, Task 5 — translations.
--
-- One universal table instead of a *_translations table per entity
-- (00-SYSTEM-DESIGN.md §4). Adding a translatable field then costs nothing: no
-- migration, no new table, just rows with a different `field` value.
--
-- `langs` already exists from 001_init.sql; this only adds `trans`.

CREATE TABLE trans (
  id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id  NUMBER NOT NULL,
  entity      VARCHAR2(20) NOT NULL,
  entity_id   NUMBER NOT NULL,
  lang        VARCHAR2(10) NOT NULL,
  field       VARCHAR2(40) NOT NULL,
  value       CLOB,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  updated_at  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT trans_uq UNIQUE (company_id, entity, entity_id, lang, field),
  CONSTRAINT trans_entity_ck CHECK (entity IN ('product','cat','coll','page','section','menu_item','banner')),
  CONSTRAINT trans_company_fk FOREIGN KEY (company_id) REFERENCES companies(id)
)
/

-- The read path is always "these ids, this entity, this language" — the batched
-- helper never fetches one row at a time.
CREATE INDEX trans_lookup_ix ON trans(company_id, entity, lang, entity_id)
/

BEGIN
  DBMS_RLS.ADD_POLICY(
    object_name     => 'trans',
    policy_name     => 'trans_co_pol',
    policy_function => 'sf_sec.company_predicate',
    statement_types => 'SELECT,INSERT,UPDATE,DELETE',
    update_check    => TRUE);
END;
/

GRANT SELECT, INSERT, UPDATE, DELETE ON trans TO sf_platform_role
/
