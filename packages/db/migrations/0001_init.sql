-- Initial schema (ADR-0009 layers, ADR-0010 Postgres + RLS, ADR-0011 multi-tenant).
--
-- The API never queries as the owner: every request runs in a transaction that sets
-- `svdt.tenant_id` and switches to the `svdt_app` role, which row-level security confines
-- to that tenant. Tenant ids lead every key so tables can later be partitioned by tenant.
--
-- Everything lives in its own `svdt` schema, not `public`. Hosted Postgres products expose
-- `public` through auto-generated web APIs (e.g. Supabase's Data API) and may grant their
-- own roles on it by default; the end of this file removes any such access to `svdt`.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svdt_app') THEN
    CREATE ROLE svdt_app NOLOGIN;
  END IF;
END
$$;
GRANT svdt_app TO CURRENT_USER;

CREATE SCHEMA IF NOT EXISTS svdt;
SET LOCAL search_path TO svdt;

CREATE FUNCTION current_tenant() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('svdt.tenant_id', true), '')::uuid $$;

CREATE TABLE tenants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       text NOT NULL UNIQUE,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Built-in tenant for consumer (B2C) users (ADR-0011).
INSERT INTO tenants (slug, name) VALUES ('direct', 'Direct');

-- Partner/app API keys. Only a SHA-256 hash is stored. No role but the owner can read it
-- (RLS on with no policy); authentication goes through svdt.authenticate().
CREATE TABLE api_keys (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name       text NOT NULL,
  key_hash   text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE TABLE users (
  tenant_id    uuid NOT NULL REFERENCES tenants (id),
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  -- The partner's own id for this user, if any.
  external_ref text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, external_ref)
);

-- A wallet or exchange account. `name` is the ledger's AccountId.
CREATE TABLE accounts (
  tenant_id  uuid NOT NULL,
  user_id    uuid NOT NULL,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, name),
  FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id)
);

-- Raw layer: immutable, content-addressed file contents (ADR-0009). Kept in Postgres
-- for now behind the BlobStore boundary; moves to object storage later (ADR-0010).
CREATE TABLE raw_blobs (
  tenant_id  uuid NOT NULL REFERENCES tenants (id),
  sha256     text NOT NULL,
  content    bytea NOT NULL,
  size_bytes integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, sha256)
);

CREATE TABLE imports (
  tenant_id    uuid NOT NULL,
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL,
  account_name text NOT NULL,
  sha256       text NOT NULL,
  filename     text,
  encoding     text NOT NULL,
  -- Versioned importer id, e.g. `coinbase.transactions.csv.v2`.
  importer_id  text NOT NULL,
  stats        jsonb NOT NULL,
  warnings     jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, user_id, account_name) REFERENCES accounts (tenant_id, user_id, name),
  FOREIGN KEY (tenant_id, sha256) REFERENCES raw_blobs (tenant_id, sha256)
);

-- Normalized layer: canonical LedgerEvents. Regenerable from raw; re-importing upserts by
-- the importer's stable event id. Amounts stay decimal strings inside the payload
-- (ADR-0008), so they are exact without per-kind NUMERIC columns.
CREATE TABLE events (
  tenant_id    uuid NOT NULL,
  user_id      uuid NOT NULL,
  id           text NOT NULL,
  account_name text NOT NULL,
  kind         text NOT NULL,
  occurred_at  timestamptz NOT NULL,
  payload      jsonb NOT NULL,
  import_id    uuid NOT NULL,
  importer_id  text NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id),
  FOREIGN KEY (tenant_id, import_id) REFERENCES imports (tenant_id, id)
);
CREATE INDEX events_by_time ON events (tenant_id, user_id, occurred_at, id);

-- Override layer: append-only user/accountant decisions (ADR-0009). No foreign key to
-- events on purpose: an override whose event disappears must survive to be reported.
CREATE TABLE overrides (
  tenant_id  uuid NOT NULL,
  user_id    uuid NOT NULL,
  id         uuid NOT NULL DEFAULT gen_random_uuid(),
  event_id   text NOT NULL,
  author     text NOT NULL,
  note       text,
  action     jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- Insertion order. Timestamps can tie (clock resolution, batch writes); this can't, so
  -- "latest override wins" is decided by it.
  seq        bigint GENERATED ALWAYS AS IDENTITY,
  PRIMARY KEY (tenant_id, user_id, id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id)
);
CREATE INDEX overrides_in_order ON overrides (tenant_id, user_id, seq);

-- Row-level security: svdt_app sees only the current tenant's rows.
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenants USING (id = current_tenant());

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users', 'accounts', 'raw_blobs', 'imports', 'events', 'overrides']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant()) '
      'WITH CHECK (tenant_id = current_tenant())', t);
  END LOOP;
END
$$;

-- Least privilege. Raw and override layers are append-only for the app; events are
-- updatable because re-normalization rewrites them. Deletion goes through purge_user().
GRANT USAGE ON SCHEMA svdt TO svdt_app;
GRANT SELECT ON tenants TO svdt_app;
GRANT SELECT, INSERT, UPDATE ON users, accounts, events TO svdt_app;
GRANT SELECT, INSERT ON raw_blobs, imports, overrides TO svdt_app;

-- API key lookup happens before a tenant is known, so it runs with the owner's rights and
-- returns only what authentication needs.
CREATE FUNCTION authenticate(p_key_hash text)
  RETURNS TABLE (key_id uuid, tenant_id uuid, key_name text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = svdt
  AS $$
    SELECT k.id, k.tenant_id, k.name FROM api_keys k
    WHERE k.key_hash = p_key_hash AND k.revoked_at IS NULL
  $$;

-- Deleting a user purges every layer (security spec). Scoped to the caller's tenant.
CREATE FUNCTION purge_user(p_user uuid) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = svdt
  AS $$
  DECLARE
    t uuid := current_tenant();
  BEGIN
    IF t IS NULL THEN
      RAISE EXCEPTION 'purge_user: no tenant context';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM users WHERE tenant_id = t AND id = p_user) THEN
      RETURN false;
    END IF;
    DELETE FROM overrides WHERE tenant_id = t AND user_id = p_user;
    DELETE FROM events WHERE tenant_id = t AND user_id = p_user;
    DELETE FROM imports WHERE tenant_id = t AND user_id = p_user;
    DELETE FROM accounts WHERE tenant_id = t AND user_id = p_user;
    DELETE FROM users WHERE tenant_id = t AND id = p_user;
    DELETE FROM raw_blobs b
      WHERE b.tenant_id = t
        AND NOT EXISTS (SELECT 1 FROM imports i WHERE i.tenant_id = t AND i.sha256 = b.sha256);
    RETURN true;
  END
  $$;

-- Postgres lets PUBLIC execute every new function; only svdt_app may call ours.
REVOKE ALL ON SCHEMA svdt FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA svdt FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA svdt REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authenticate(text), purge_user(uuid), current_tenant() TO svdt_app;

-- Hosted platforms' own roles (Supabase: anon, authenticated, service_role) get nothing here,
-- even if the platform's default privileges granted them access as objects were created.
-- Later migrations that add objects must end with the same block; test/db.test.ts checks.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA svdt FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA svdt FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA svdt FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA svdt FROM %I', r);
    END IF;
  END LOOP;
END
$$;
