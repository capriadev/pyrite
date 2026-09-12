-- 0005_notes_and_unified_groups.sql
-- spec 010: unified groups (domain) + notes table. Manual migration
-- (drizzle-kit cannot resolve the api_groups -> groups rename without a TTY).

-- 1) New enums
CREATE TYPE notes_private_flag AS ENUM ('true','false');
CREATE TYPE notes_pinned_flag AS ENUM ('true','false');

-- 2) Unified groups table
CREATE TABLE groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain text NOT NULL,
  name text NOT NULL,
  status movement_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT groups_domain_name_key UNIQUE (domain, name)
);

-- 3) Migrate api_groups rows -> groups (domain='apis')
INSERT INTO groups (id, domain, name, status, created_at)
  SELECT id, 'apis', name, status, created_at FROM api_groups;

-- 4) Re-point api_keys FK to groups (group ids preserved)
ALTER TABLE api_keys DROP CONSTRAINT api_keys_group_id_api_groups_id_fk;
ALTER TABLE api_keys
  ADD CONSTRAINT api_keys_group_id_fkey
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE SET NULL;

-- 5) Drop old table (already migrated)
DROP TABLE api_groups;

-- 6) Notes table
CREATE TABLE notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  ciphertext text NOT NULL,
  iv text NOT NULL,
  auth_tag text NOT NULL,
  salt text NOT NULL,
  is_private notes_private_flag NOT NULL DEFAULT 'false',
  pinned notes_pinned_flag NOT NULL DEFAULT 'false',
  group_id uuid REFERENCES groups(id) ON DELETE SET NULL,
  status movement_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_accessed_at timestamptz NOT NULL DEFAULT now()
);