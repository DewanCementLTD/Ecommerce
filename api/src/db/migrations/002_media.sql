CREATE TABLE media (
  id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id  NUMBER NOT NULL,
  filename    VARCHAR2(255) NOT NULL,
  alt         VARCHAR2(255),
  mime        VARCHAR2(100) NOT NULL,
  size_bytes  NUMBER NOT NULL,
  width       NUMBER,
  height      NUMBER,
  folder      VARCHAR2(100),
  storage_key VARCHAR2(300) NOT NULL,
  deleted_at  TIMESTAMP WITH TIME ZONE,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT media_storage_key_uq UNIQUE (storage_key),
  CONSTRAINT media_company_fk FOREIGN KEY (company_id) REFERENCES companies(id)
)
/

ALTER TABLE companies ADD CONSTRAINT companies_logo_media_fk FOREIGN KEY (logo_media_id) REFERENCES media(id)
/

CREATE INDEX media_company_created_ix ON media(company_id, created_at)
/

CREATE INDEX media_company_folder_ix ON media(company_id, folder)
/

BEGIN
  DBMS_RLS.ADD_POLICY(
    object_name     => 'media',
    policy_name     => 'media_co_pol',
    policy_function => 'sf_sec.company_predicate',
    statement_types => 'SELECT,INSERT,UPDATE,DELETE',
    update_check    => TRUE);
END;
/

GRANT SELECT, INSERT, UPDATE, DELETE ON media TO sf_platform_role
/
