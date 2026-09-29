-- 114_department_groups.sql
--
-- Department Groups for the Leads screen. A GROUP has a name and MANY departments;
-- each department belongs to AT MOST ONE group (enforced by UNIQUE(receiver)).
--
-- Departments live in MySQL (departments.connection = the receiver number); here we only
-- store the mapping (receiver + a cached name) in Postgres. Additive + idempotent.

CREATE TABLE IF NOT EXISTS department_groups (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS department_group_members (
  group_id         BIGINT NOT NULL REFERENCES department_groups(id) ON DELETE CASCADE,
  receiver         TEXT   NOT NULL,          -- department connection number
  department_name  TEXT,                     -- cached name for display
  PRIMARY KEY (group_id, receiver),
  UNIQUE (receiver)                          -- a department can be in ONLY ONE group
);

CREATE INDEX IF NOT EXISTS idx_dgm_group ON department_group_members(group_id);
