ALTER TABLE users
ADD COLUMN credential_token_hash TEXT;

CREATE UNIQUE INDEX users_credential_token_hash_idx
ON users (credential_token_hash)
WHERE credential_token_hash IS NOT NULL;
