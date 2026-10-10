CREATE TYPE user_role AS ENUM ('REQUESTER', 'PROVIDER', 'ADMIN');
CREATE TYPE user_status AS ENUM ('ACTIVE', 'SUSPENDED');
CREATE TYPE node_status AS ENUM ('OFFLINE', 'ONLINE', 'BUSY', 'DRAINING');
CREATE TYPE risk_tier AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'BLOCKED');
CREATE TYPE network_mode AS ENUM ('OFFLINE', 'RESTRICTED', 'OPEN_WEB');
CREATE TYPE job_state AS ENUM (
  'SUBMITTED',
  'POLICY_CHECKED',
  'OFFERED',
  'APPROVED',
  'CLAIMED',
  'RUNNING',
  'VALIDATING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'EXPIRED'
);

CREATE TABLE users (
  id UUID PRIMARY KEY,
  role user_role NOT NULL,
  community_id TEXT,
  status user_status NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE provider_nodes (
  id UUID PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES users(id),
  node_name TEXT NOT NULL,
  os TEXT NOT NULL,
  architecture TEXT NOT NULL,
  agent_version TEXT NOT NULL,
  cpu_cores INTEGER NOT NULL CHECK (cpu_cores > 0),
  memory_mb INTEGER NOT NULL CHECK (memory_mb > 0),
  network_modes JSONB NOT NULL,
  isolation_levels JSONB NOT NULL,
  available_cpu INTEGER NOT NULL DEFAULT 0 CHECK (available_cpu >= 0),
  available_memory_mb INTEGER NOT NULL DEFAULT 0 CHECK (available_memory_mb >= 0),
  active_jobs INTEGER NOT NULL DEFAULT 0 CHECK (active_jobs >= 0),
  status node_status NOT NULL DEFAULT 'OFFLINE',
  last_heartbeat_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_id, node_name)
);

CREATE TABLE workload_definitions (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  image_digest TEXT NOT NULL UNIQUE CHECK (image_digest ~ '^sha256:[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (name, version)
);

CREATE TABLE jobs (
  id UUID PRIMARY KEY,
  requester_id UUID NOT NULL REFERENCES users(id),
  workload_id UUID NOT NULL REFERENCES workload_definitions(id),
  params JSONB NOT NULL DEFAULT '{}'::JSONB,
  input_digests JSONB NOT NULL DEFAULT '[]'::JSONB,
  requested_cpu INTEGER NOT NULL CHECK (requested_cpu > 0),
  requested_memory_mb INTEGER NOT NULL CHECK (requested_memory_mb > 0),
  timeout_seconds INTEGER NOT NULL CHECK (timeout_seconds > 0),
  network_mode network_mode NOT NULL,
  allowed_hosts JSONB NOT NULL DEFAULT '[]'::JSONB,
  risk_tier risk_tier NOT NULL,
  state job_state NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE assignments (
  id UUID PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES jobs(id),
  node_id UUID NOT NULL REFERENCES provider_nodes(id),
  nonce TEXT NOT NULL UNIQUE,
  manifest_signature TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  lease_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id)
);

CREATE TABLE job_events (
  sequence BIGSERIAL PRIMARY KEY,
  id UUID NOT NULL UNIQUE,
  job_id UUID NOT NULL REFERENCES jobs(id),
  actor TEXT NOT NULL,
  event_type TEXT NOT NULL,
  from_state job_state,
  to_state job_state NOT NULL,
  correlation_id UUID NOT NULL,
  safe_payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX jobs_requester_created_idx ON jobs (requester_id, created_at DESC);
CREATE INDEX jobs_state_created_idx ON jobs (state, created_at);
CREATE INDEX provider_nodes_status_heartbeat_idx ON provider_nodes (status, last_heartbeat_at);
CREATE INDEX job_events_job_sequence_idx ON job_events (job_id, sequence);

CREATE FUNCTION prevent_job_event_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'job_events is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER job_events_no_update
BEFORE UPDATE OR DELETE ON job_events
FOR EACH ROW EXECUTE FUNCTION prevent_job_event_mutation();
