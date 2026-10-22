ALTER TYPE job_state ADD VALUE IF NOT EXISTS 'REJECTED';
ALTER TYPE job_state ADD VALUE IF NOT EXISTS 'QUEUED';
ALTER TYPE job_state ADD VALUE IF NOT EXISTS 'DECLINED';
ALTER TYPE job_state ADD VALUE IF NOT EXISTS 'STAGING';
ALTER TYPE job_state ADD VALUE IF NOT EXISTS 'TIMED_OUT';

ALTER TABLE job_events
  ADD COLUMN attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt > 0);

CREATE TABLE agent_commands (
  id UUID PRIMARY KEY,
  node_id UUID NOT NULL REFERENCES provider_nodes(id),
  job_id UUID NOT NULL REFERENCES jobs(id),
  command_type TEXT NOT NULL CHECK (command_type = 'CANCEL'),
  reason TEXT NOT NULL CHECK (reason IN ('REQUESTER_CANCEL', 'ADMIN_STOP')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (node_id, job_id, command_type)
);

CREATE FUNCTION notify_job_event() RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('powermesh_job_events', NEW.job_id::TEXT);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER job_events_notify
AFTER INSERT ON job_events
FOR EACH ROW EXECUTE FUNCTION notify_job_event();
