ALTER TABLE provider_nodes
ADD COLUMN agent_token_hash TEXT;

CREATE UNIQUE INDEX provider_nodes_agent_token_hash_idx
ON provider_nodes (agent_token_hash)
WHERE agent_token_hash IS NOT NULL;

ALTER TABLE assignments
ADD COLUMN manifest JSONB NOT NULL DEFAULT '{}'::JSONB,
ADD COLUMN signature_algorithm TEXT NOT NULL DEFAULT 'Ed25519',
ADD COLUMN key_id TEXT NOT NULL DEFAULT 'unconfigured',
ADD COLUMN approved_at TIMESTAMPTZ,
ADD COLUMN claimed_at TIMESTAMPTZ,
ADD COLUMN nonce_consumed_at TIMESTAMPTZ;

CREATE INDEX assignments_node_expiry_idx ON assignments (node_id, expires_at);
