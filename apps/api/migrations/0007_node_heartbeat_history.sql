-- Provider heartbeat history for capacity and health trends.
-- On Tiger Cloud (TimescaleDB) this becomes a hypertable with compression and retention.
-- On plain PostgreSQL (local docker-compose) it stays an ordinary table, so the migration is safe everywhere.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb') THEN
    CREATE EXTENSION IF NOT EXISTS timescaledb;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS node_heartbeats (
  time TIMESTAMPTZ NOT NULL,
  -- sha256 of the node id: trends per node without storing raw node identity.
  node_ref TEXT NOT NULL,
  available_cpu NUMERIC(8, 2) NOT NULL,
  available_memory_mb INTEGER NOT NULL,
  active_jobs INTEGER NOT NULL,
  status TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS node_heartbeats_node_time_idx ON node_heartbeats (node_ref, time DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    PERFORM create_hypertable('node_heartbeats', 'time', chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE);
    EXECUTE 'ALTER TABLE node_heartbeats SET (timescaledb.compress, timescaledb.compress_segmentby = ''node_ref'')';
    PERFORM add_compression_policy('node_heartbeats', INTERVAL '1 day', if_not_exists => TRUE);
    PERFORM add_retention_policy('node_heartbeats', INTERVAL '30 days', if_not_exists => TRUE);
  END IF;
END
$$;
