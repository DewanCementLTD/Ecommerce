CREATE TABLE migrations (
  id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  filename    VARCHAR2(255) NOT NULL,
  applied_at  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT migrations_filename_uq UNIQUE (filename)
)
/

CREATE TABLE companies (
  id             NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name           VARCHAR2(200) NOT NULL,
  biz_name       VARCHAR2(200),
  email          VARCHAR2(320),
  phone          VARCHAR2(50),
  logo_media_id  NUMBER,
  theme_id       NUMBER,
  currency       VARCHAR2(10),
  timezone       VARCHAR2(60),
  status         VARCHAR2(20) DEFAULT 'active' NOT NULL,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  updated_at     TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT companies_status_ck CHECK (status IN ('active','suspended'))
)
/

CREATE TABLE themes (
  id         NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code       VARCHAR2(50) NOT NULL,
  name       VARCHAR2(120) NOT NULL,
  tokens     CLOB,
  is_active  NUMBER(1) DEFAULT 1 NOT NULL,
  CONSTRAINT themes_code_uq UNIQUE (code),
  CONSTRAINT themes_is_active_ck CHECK (is_active IN (0,1)),
  CONSTRAINT themes_tokens_json_ck CHECK (tokens IS JSON)
)
/

ALTER TABLE companies ADD CONSTRAINT companies_theme_fk FOREIGN KEY (theme_id) REFERENCES themes(id)
/

CREATE TABLE domains (
  id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id  NUMBER NOT NULL,
  host        VARCHAR2(255) NOT NULL,
  is_primary  NUMBER(1) DEFAULT 0 NOT NULL,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT domains_host_uq UNIQUE (host),
  CONSTRAINT domains_is_primary_ck CHECK (is_primary IN (0,1)),
  CONSTRAINT domains_company_fk FOREIGN KEY (company_id) REFERENCES companies(id)
)
/

CREATE TABLE admins (
  id             NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id     NUMBER,
  email          VARCHAR2(320) NOT NULL,
  pass_hash      VARCHAR2(255) NOT NULL,
  name           VARCHAR2(200) NOT NULL,
  role           VARCHAR2(50) NOT NULL,
  is_active      NUMBER(1) DEFAULT 1 NOT NULL,
  last_login_at  TIMESTAMP WITH TIME ZONE,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  updated_at     TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT admins_email_uq UNIQUE (email),
  CONSTRAINT admins_is_active_ck CHECK (is_active IN (0,1)),
  CONSTRAINT admins_company_fk FOREIGN KEY (company_id) REFERENCES companies(id)
)
/

CREATE TABLE roles (
  id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id  NUMBER NOT NULL,
  code        VARCHAR2(50) NOT NULL,
  name        VARCHAR2(120) NOT NULL,
  perms       CLOB,
  CONSTRAINT roles_company_code_uq UNIQUE (company_id, code),
  CONSTRAINT roles_perms_json_ck CHECK (perms IS JSON),
  CONSTRAINT roles_company_fk FOREIGN KEY (company_id) REFERENCES companies(id)
)
/

CREATE TABLE settings (
  id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id  NUMBER NOT NULL,
  key         VARCHAR2(100) NOT NULL,
  value       CLOB,
  CONSTRAINT settings_company_key_uq UNIQUE (company_id, key),
  CONSTRAINT settings_company_fk FOREIGN KEY (company_id) REFERENCES companies(id)
)
/

CREATE TABLE langs (
  id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id  NUMBER NOT NULL,
  code        VARCHAR2(10) NOT NULL,
  name        VARCHAR2(100) NOT NULL,
  is_default  NUMBER(1) DEFAULT 0 NOT NULL,
  is_active   NUMBER(1) DEFAULT 1 NOT NULL,
  CONSTRAINT langs_company_code_uq UNIQUE (company_id, code),
  CONSTRAINT langs_is_default_ck CHECK (is_default IN (0,1)),
  CONSTRAINT langs_is_active_ck CHECK (is_active IN (0,1)),
  CONSTRAINT langs_company_fk FOREIGN KEY (company_id) REFERENCES companies(id)
)
/

CREATE TABLE logs (
  id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id  NUMBER,
  admin_id    NUMBER,
  action      VARCHAR2(100) NOT NULL,
  entity      VARCHAR2(60),
  entity_id   NUMBER,
  meta        CLOB,
  ip          VARCHAR2(45),
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT logs_meta_json_ck CHECK (meta IS JSON),
  CONSTRAINT logs_company_fk FOREIGN KEY (company_id) REFERENCES companies(id),
  CONSTRAINT logs_admin_fk FOREIGN KEY (admin_id) REFERENCES admins(id)
)
/

CREATE INDEX admins_company_email_ix ON admins(company_id, email)
/

CREATE INDEX logs_company_created_ix ON logs(company_id, created_at)
/

CREATE OR REPLACE PACKAGE sf_sec AS
  PROCEDURE set_company(p_company_id IN NUMBER);
  PROCEDURE clear_company;
  FUNCTION company_predicate(p_schema IN VARCHAR2, p_table IN VARCHAR2) RETURN VARCHAR2;
  FUNCTION is_platform RETURN BOOLEAN;
END sf_sec;
/

CREATE OR REPLACE PACKAGE BODY sf_sec AS
  PROCEDURE set_company(p_company_id IN NUMBER) IS
  BEGIN
    DBMS_SESSION.SET_CONTEXT('sf_ctx', 'company_id', TO_CHAR(p_company_id));
  END set_company;

  PROCEDURE clear_company IS
  BEGIN
    DBMS_SESSION.CLEAR_CONTEXT('sf_ctx', 'company_id');
  END clear_company;

  FUNCTION company_predicate(p_schema IN VARCHAR2, p_table IN VARCHAR2) RETURN VARCHAR2 IS
  BEGIN
    RETURN 'company_id = SYS_CONTEXT(''sf_ctx'',''company_id'')';
  END company_predicate;

  FUNCTION is_platform RETURN BOOLEAN IS
  BEGIN
    RETURN SYS_CONTEXT('sf_ctx', 'company_id') IS NULL;
  END is_platform;
END sf_sec;
/

CREATE OR REPLACE CONTEXT sf_ctx USING sf_sec
/

BEGIN
  DBMS_RLS.ADD_POLICY(
    object_name     => 'domains',
    policy_name     => 'domains_co_pol',
    policy_function => 'sf_sec.company_predicate',
    statement_types => 'SELECT,INSERT,UPDATE,DELETE',
    update_check    => TRUE);
END;
/

BEGIN
  DBMS_RLS.ADD_POLICY(
    object_name     => 'admins',
    policy_name     => 'admins_co_pol',
    policy_function => 'sf_sec.company_predicate',
    statement_types => 'SELECT,INSERT,UPDATE,DELETE',
    update_check    => TRUE);
END;
/

BEGIN
  DBMS_RLS.ADD_POLICY(
    object_name     => 'roles',
    policy_name     => 'roles_co_pol',
    policy_function => 'sf_sec.company_predicate',
    statement_types => 'SELECT,INSERT,UPDATE,DELETE',
    update_check    => TRUE);
END;
/

BEGIN
  DBMS_RLS.ADD_POLICY(
    object_name     => 'settings',
    policy_name     => 'settings_co_pol',
    policy_function => 'sf_sec.company_predicate',
    statement_types => 'SELECT,INSERT,UPDATE,DELETE',
    update_check    => TRUE);
END;
/

BEGIN
  DBMS_RLS.ADD_POLICY(
    object_name     => 'langs',
    policy_name     => 'langs_co_pol',
    policy_function => 'sf_sec.company_predicate',
    statement_types => 'SELECT,INSERT,UPDATE,DELETE',
    update_check    => TRUE);
END;
/

BEGIN
  DBMS_RLS.ADD_POLICY(
    object_name     => 'logs',
    policy_name     => 'logs_co_pol',
    policy_function => 'sf_sec.company_predicate',
    statement_types => 'SELECT,INSERT,UPDATE,DELETE',
    update_check    => TRUE);
END;
/

CREATE ROLE sf_platform_role
/

GRANT SELECT, INSERT, UPDATE, DELETE ON companies TO sf_platform_role
/

GRANT SELECT, INSERT, UPDATE, DELETE ON domains TO sf_platform_role
/

GRANT SELECT, INSERT, UPDATE, DELETE ON themes TO sf_platform_role
/

GRANT SELECT, INSERT, UPDATE, DELETE ON admins TO sf_platform_role
/

GRANT SELECT, INSERT, UPDATE, DELETE ON roles TO sf_platform_role
/

GRANT SELECT, INSERT, UPDATE, DELETE ON settings TO sf_platform_role
/

GRANT SELECT, INSERT, UPDATE, DELETE ON langs TO sf_platform_role
/

GRANT SELECT, INSERT, UPDATE, DELETE ON logs TO sf_platform_role
/
