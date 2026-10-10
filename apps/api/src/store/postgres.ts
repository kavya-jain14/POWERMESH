import { randomUUID } from "node:crypto";
import {
  assertJobTransition,
  offerManifestSchema,
  type SignedJobOffer,
} from "@powermesh/contracts";
import type { Pool, PoolClient } from "pg";
import {
  type CoordinatorStore,
  type JobRecord,
  type ProviderNodeRecord,
  providerCanRunJob,
  type RequesterRecord,
  type StoreResult,
} from "./types";

interface JobRow {
  id: string;
  requester_id: string;
  workload_id: string;
  workload_name: string;
  workload_version: string;
  image_digest: string;
  image_reference: string;
  params: JobRecord["params"];
  input_digests: string[];
  requested_cpu: number;
  requested_memory_mb: number;
  timeout_seconds: number;
  max_output_bytes: number;
  network_mode: JobRecord["resources"]["networkMode"];
  allowed_hosts: string[];
  risk_tier: JobRecord["riskTier"];
  state: JobRecord["state"];
  created_at: Date;
  updated_at: Date;
}

interface NodeRow {
  id: string;
  owner_id: string;
  node_name: string;
  os: string;
  architecture: string;
  agent_version: string;
  cpu_cores: number;
  memory_mb: number;
  network_modes: ProviderNodeRecord["networkModes"];
  isolation_levels: ProviderNodeRecord["isolationLevels"];
  available_cpu: number;
  available_memory_mb: number;
  active_jobs: number;
  status: ProviderNodeRecord["status"];
  last_heartbeat_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface EffectiveNodeRow extends NodeRow {
  effective_available_cpu: number;
  effective_available_memory_mb: number;
  effective_active_jobs: number;
}

interface OfferRow {
  id: string;
  job_id: string;
  node_id: string;
  nonce: string;
  manifest_signature: string;
  expires_at: Date;
  lease_until: Date | null;
  manifest: unknown;
  signature_algorithm: "Ed25519";
  key_id: string;
  approved_at: Date | null;
  claimed_at: Date | null;
  nonce_consumed_at: Date | null;
}

interface LockedOfferRow extends OfferRow {
  job_state: JobRecord["state"];
}

interface RequesterRow {
  id: string;
  community_id: string | null;
  status: "ACTIVE" | "SUSPENDED";
  created_at: Date;
  updated_at: Date;
}

const jobSelect = `
  SELECT jobs.*, workload_definitions.name AS workload_name,
    workload_definitions.version AS workload_version,
    workload_definitions.image_digest,
    workload_definitions.image_reference
  FROM jobs
  JOIN workload_definitions ON workload_definitions.id = jobs.workload_id
`;

function mapJob(row: JobRow): JobRecord {
  return {
    id: row.id,
    requesterId: row.requester_id,
    workload: {
      id: row.workload_id,
      name: row.workload_name,
      version: row.workload_version,
      imageDigest: row.image_digest,
      imageReference: row.image_reference,
    },
    resources: {
      cpu: row.requested_cpu,
      memoryMb: row.requested_memory_mb,
      timeoutSeconds: row.timeout_seconds,
      maxOutputBytes: row.max_output_bytes,
      networkMode: row.network_mode,
      allowedHosts: row.allowed_hosts,
      needsHostMount: false,
      privileged: false,
      dockerSocket: false,
      deviceAccess: false,
      arbitraryImage: false,
    },
    params: row.params,
    inputDigests: row.input_digests,
    riskTier: row.risk_tier,
    state: row.state,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapNode(row: NodeRow): ProviderNodeRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    nodeName: row.node_name,
    os: row.os,
    architecture: row.architecture,
    agentVersion: row.agent_version,
    cpuCores: row.cpu_cores,
    memoryMb: row.memory_mb,
    networkModes: row.network_modes,
    isolationLevels: row.isolation_levels,
    availableCpu: row.available_cpu,
    availableMemoryMb: row.available_memory_mb,
    activeJobs: row.active_jobs,
    status: row.status,
    lastHeartbeatAt: row.last_heartbeat_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapOffer(row: OfferRow): SignedJobOffer {
  return {
    id: row.id,
    manifest: offerManifestSchema.parse(row.manifest),
    signature: row.manifest_signature,
    signatureAlgorithm: row.signature_algorithm,
    keyId: row.key_id,
    approvedAt: row.approved_at?.toISOString() ?? null,
    claimedAt: row.claimed_at?.toISOString() ?? null,
    leaseUntil: row.lease_until?.toISOString() ?? null,
  };
}

function mapRequester(row: RequesterRow): RequesterRecord {
  return {
    id: row.id,
    communityId: row.community_id,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {}
}

async function recordTransition(
  client: PoolClient,
  jobId: string,
  currentState: JobRecord["state"],
  nextState: JobRecord["state"],
  actor: string,
  eventType: string,
  safePayload: Record<string, unknown> = {},
): Promise<void> {
  assertJobTransition(currentState, nextState);
  await client.query("UPDATE jobs SET state = $2, updated_at = NOW() WHERE id = $1", [
    jobId,
    nextState,
  ]);
  await client.query(
    `INSERT INTO job_events
      (id, job_id, actor, event_type, from_state, to_state, correlation_id, safe_payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      randomUUID(),
      jobId,
      actor,
      eventType,
      currentState,
      nextState,
      randomUUID(),
      JSON.stringify(safePayload),
    ],
  );
}

export class PostgresCoordinatorStore implements CoordinatorStore {
  readonly kind = "postgres" as const;

  constructor(private readonly pool: Pool) {}

  async close(): Promise<void> {
    await this.pool.end();
  }

  async registerRequester(
    input: Parameters<CoordinatorStore["registerRequester"]>[0],
    tokenHash: string,
  ): Promise<RequesterRecord> {
    const result = await this.pool.query<RequesterRow>(
      `INSERT INTO users (id, role, community_id, credential_token_hash)
       VALUES ($1, 'REQUESTER', $2, $3)
       RETURNING *`,
      [randomUUID(), input.communityId ?? null, tokenHash],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Requester registration returned no row");
    return mapRequester(row);
  }

  async authenticateRequester(tokenHash: string): Promise<RequesterRecord | null> {
    const result = await this.pool.query<RequesterRow>(
      `SELECT * FROM users
       WHERE credential_token_hash = $1 AND role = 'REQUESTER' AND status = 'ACTIVE'`,
      [tokenHash],
    );
    return result.rows[0] ? mapRequester(result.rows[0]) : null;
  }

  async createPolicyCheckedJob(
    input: Parameters<CoordinatorStore["createPolicyCheckedJob"]>[0],
    risk: Parameters<CoordinatorStore["createPolicyCheckedJob"]>[1],
  ): Promise<JobRecord> {
    const client = await this.pool.connect();
    const workloadId = input.workload.id;
    const jobId = randomUUID();
    const correlationId = randomUUID();

    try {
      await client.query("BEGIN");
      const workload = await client.query<{ id: string }>(
        `INSERT INTO workload_definitions (id, name, version, image_digest, image_reference)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (image_digest) DO UPDATE SET
           name = EXCLUDED.name,
           version = EXCLUDED.version,
           image_reference = EXCLUDED.image_reference
         RETURNING id`,
        [
          workloadId,
          input.workload.name,
          input.workload.version,
          input.workload.imageDigest,
          input.workload.imageReference,
        ],
      );
      const resolvedWorkloadId = workload.rows[0]?.id;
      if (!resolvedWorkloadId) throw new Error("Workload upsert returned no id");

      await client.query(
        `INSERT INTO jobs (
          id, requester_id, workload_id, params, input_digests, requested_cpu,
          requested_memory_mb, timeout_seconds, max_output_bytes, network_mode, allowed_hosts,
          risk_tier, state
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'POLICY_CHECKED')`,
        [
          jobId,
          input.requesterId,
          resolvedWorkloadId,
          JSON.stringify(input.params),
          JSON.stringify(input.inputDigests),
          input.resources.cpu,
          input.resources.memoryMb,
          input.resources.timeoutSeconds,
          input.resources.maxOutputBytes,
          input.resources.networkMode,
          JSON.stringify(input.resources.allowedHosts),
          risk.tier,
        ],
      );

      await client.query(
        `INSERT INTO job_events
          (id, job_id, actor, event_type, from_state, to_state, correlation_id, safe_payload)
         VALUES
          ($1, $3, 'REQUESTER', 'JOB_SUBMITTED', NULL, 'SUBMITTED', $5, '{}'::JSONB),
          ($2, $3, 'POLICY_ENGINE', 'POLICY_ACCEPTED', 'SUBMITTED', 'POLICY_CHECKED', $5, $4)`,
        [
          randomUUID(),
          randomUUID(),
          jobId,
          JSON.stringify({ riskTier: risk.tier, reasons: risk.reasons }),
          correlationId,
        ],
      );
      await client.query("COMMIT");
      const created = await this.findJob(jobId);
      if (!created) throw new Error("Created job could not be read");
      return created;
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async findJob(id: string): Promise<JobRecord | null> {
    const result = await this.pool.query<JobRow>(`${jobSelect} WHERE jobs.id = $1`, [id]);
    return result.rows[0] ? mapJob(result.rows[0]) : null;
  }

  async listPolicyCheckedJobs(limit: number): Promise<JobRecord[]> {
    const result = await this.pool.query<JobRow>(
      `${jobSelect}
       WHERE jobs.state = 'POLICY_CHECKED'
       ORDER BY jobs.created_at
       LIMIT $1`,
      [limit],
    );
    return result.rows.map(mapJob);
  }

  async transitionJob(
    id: string,
    nextState: Parameters<CoordinatorStore["transitionJob"]>[1],
    actor: string,
    correlationId: string,
    safePayload: Record<string, unknown> = {},
  ): Promise<JobRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<{ state: JobRecord["state"] }>(
        "SELECT state FROM jobs WHERE id = $1 FOR UPDATE",
        [id],
      );
      const currentState = current.rows[0]?.state;
      if (!currentState) {
        await client.query("ROLLBACK");
        return null;
      }

      assertJobTransition(currentState, nextState);
      await client.query("UPDATE jobs SET state = $2, updated_at = NOW() WHERE id = $1", [
        id,
        nextState,
      ]);
      await client.query(
        `INSERT INTO job_events
          (id, job_id, actor, event_type, from_state, to_state, correlation_id, safe_payload)
         VALUES ($1, $2, $3, 'STATE_TRANSITION', $4, $5, $6, $7)`,
        [
          randomUUID(),
          id,
          actor,
          currentState,
          nextState,
          correlationId,
          JSON.stringify(safePayload),
        ],
      );
      await client.query("COMMIT");
      return await this.findJob(id);
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async registerProvider(
    input: Parameters<CoordinatorStore["registerProvider"]>[0],
    newTokenHash: string,
    currentTokenHash?: string,
  ): Promise<ProviderNodeRecord | null> {
    if (currentTokenHash) {
      const existing = await this.pool.query(
        `SELECT 1 FROM provider_nodes
         WHERE owner_id = $1 AND node_name = $2 AND agent_token_hash = $3`,
        [input.ownerId, input.nodeName, currentTokenHash],
      );
      if (existing.rowCount !== 1) return null;
    } else {
      await this.pool.query(
        `INSERT INTO users (id, role)
         VALUES ($1, 'PROVIDER')
         ON CONFLICT (id) DO NOTHING`,
        [input.ownerId],
      );
      const owner = await this.pool.query(
        "SELECT 1 FROM users WHERE id = $1 AND role = 'PROVIDER'",
        [input.ownerId],
      );
      if (owner.rowCount !== 1) return null;
    }

    const result = await this.pool.query<NodeRow>(
      `INSERT INTO provider_nodes (
        id, owner_id, node_name, os, architecture, agent_version, cpu_cores,
        memory_mb, network_modes, isolation_levels, agent_token_hash
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (owner_id, node_name) DO UPDATE SET
        os = EXCLUDED.os,
        architecture = EXCLUDED.architecture,
        agent_version = EXCLUDED.agent_version,
        cpu_cores = EXCLUDED.cpu_cores,
        memory_mb = EXCLUDED.memory_mb,
        network_modes = EXCLUDED.network_modes,
        isolation_levels = EXCLUDED.isolation_levels,
        agent_token_hash = EXCLUDED.agent_token_hash,
        updated_at = NOW()
      WHERE provider_nodes.agent_token_hash IS NULL
        OR provider_nodes.agent_token_hash = $12
      RETURNING *`,
      [
        randomUUID(),
        input.ownerId,
        input.nodeName,
        input.os,
        input.architecture,
        input.agentVersion,
        input.cpuCores,
        input.memoryMb,
        JSON.stringify(input.networkModes),
        JSON.stringify(input.isolationLevels),
        newTokenHash,
        currentTokenHash ?? null,
      ],
    );
    const row = result.rows[0];
    return row ? mapNode(row) : null;
  }

  async authenticateProvider(id: string, tokenHash: string): Promise<boolean> {
    const result = await this.pool.query(
      "SELECT 1 FROM provider_nodes WHERE id = $1 AND agent_token_hash = $2",
      [id, tokenHash],
    );
    return result.rowCount === 1;
  }

  async findProvider(id: string): Promise<ProviderNodeRecord | null> {
    const result = await this.pool.query<NodeRow>("SELECT * FROM provider_nodes WHERE id = $1", [
      id,
    ]);
    return result.rows[0] ? mapNode(result.rows[0]) : null;
  }

  async listAvailableProviders(): Promise<ProviderNodeRecord[]> {
    const result = await this.pool.query<EffectiveNodeRow>(
      `SELECT provider_nodes.*,
         GREATEST(
           0,
           provider_nodes.available_cpu - COALESCE(reservations.cpu, 0)
         ) AS effective_available_cpu,
         GREATEST(
           0,
           provider_nodes.available_memory_mb - COALESCE(reservations.memory_mb, 0)
         ) AS effective_available_memory_mb,
         GREATEST(
           provider_nodes.active_jobs,
           COALESCE(reservations.jobs, 0)
         ) AS effective_active_jobs
       FROM provider_nodes
       LEFT JOIN (
         SELECT assignments.node_id,
           SUM(jobs.requested_cpu)::INTEGER AS cpu,
           SUM(jobs.requested_memory_mb)::INTEGER AS memory_mb,
           COUNT(*)::INTEGER AS jobs
         FROM assignments
         JOIN jobs ON jobs.id = assignments.job_id
         WHERE jobs.state IN ('OFFERED', 'APPROVED', 'CLAIMED', 'RUNNING', 'VALIDATING')
         GROUP BY assignments.node_id
       ) AS reservations ON reservations.node_id = provider_nodes.id
       WHERE provider_nodes.status = 'ONLINE'
       ORDER BY effective_active_jobs, provider_nodes.id`,
    );
    return result.rows.map((row) =>
      mapNode({
        ...row,
        available_cpu: row.effective_available_cpu,
        available_memory_mb: row.effective_available_memory_mb,
        active_jobs: row.effective_active_jobs,
      }),
    );
  }

  async heartbeatProvider(
    id: string,
    heartbeat: Parameters<CoordinatorStore["heartbeatProvider"]>[1],
  ): Promise<ProviderNodeRecord | null> {
    const result = await this.pool.query<NodeRow>(
      `UPDATE provider_nodes SET
        available_cpu = $2,
        available_memory_mb = $3,
        active_jobs = $4,
        status = $5,
        last_heartbeat_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
      [
        id,
        heartbeat.availableCpu,
        heartbeat.availableMemoryMb,
        heartbeat.activeJobs,
        heartbeat.status,
      ],
    );
    return result.rows[0] ? mapNode(result.rows[0]) : null;
  }

  async createOffer(offer: SignedJobOffer): Promise<StoreResult<SignedJobOffer>> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const jobResult = await client.query<JobRow>(
        `${jobSelect} WHERE jobs.id = $1 FOR UPDATE OF jobs`,
        [offer.manifest.jobId],
      );
      const jobRow = jobResult.rows[0];
      if (!jobRow) {
        await client.query("ROLLBACK");
        return { ok: false, reason: "JOB_NOT_FOUND" };
      }
      const nodeResult = await client.query<NodeRow>(
        "SELECT * FROM provider_nodes WHERE id = $1 FOR UPDATE",
        [offer.manifest.nodeId],
      );
      const nodeRow = nodeResult.rows[0];
      if (!nodeRow) {
        await client.query("ROLLBACK");
        return { ok: false, reason: "NODE_NOT_FOUND" };
      }

      const reservationResult = await client.query<{
        cpu: number;
        memory_mb: number;
        jobs: number;
      }>(
        `SELECT COALESCE(SUM(jobs.requested_cpu), 0)::INTEGER AS cpu,
           COALESCE(SUM(jobs.requested_memory_mb), 0)::INTEGER AS memory_mb,
           COUNT(*)::INTEGER AS jobs
         FROM assignments
         JOIN jobs ON jobs.id = assignments.job_id
         WHERE assignments.node_id = $1
           AND jobs.state IN ('OFFERED', 'APPROVED', 'CLAIMED', 'RUNNING', 'VALIDATING')`,
        [offer.manifest.nodeId],
      );
      const reservation = reservationResult.rows[0] ?? { cpu: 0, memory_mb: 0, jobs: 0 };
      const node = mapNode(nodeRow);
      const effectiveNode: ProviderNodeRecord = {
        ...node,
        availableCpu: Math.max(0, node.availableCpu - reservation.cpu),
        availableMemoryMb: Math.max(0, node.availableMemoryMb - reservation.memory_mb),
        activeJobs: Math.max(node.activeJobs, reservation.jobs),
      };

      const job = mapJob(jobRow);
      if (job.state !== "POLICY_CHECKED") {
        await client.query("ROLLBACK");
        return { ok: false, reason: "INVALID_STATE" };
      }
      const eligibilityFailure = providerCanRunJob(effectiveNode, job);
      if (eligibilityFailure) {
        await client.query("ROLLBACK");
        return { ok: false, reason: eligibilityFailure };
      }

      await client.query(
        `INSERT INTO assignments (
          id, job_id, node_id, nonce, manifest_signature, expires_at, manifest,
          signature_algorithm, key_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          offer.id,
          offer.manifest.jobId,
          offer.manifest.nodeId,
          offer.manifest.nonce,
          offer.signature,
          offer.manifest.expiresAt,
          JSON.stringify(offer.manifest),
          offer.signatureAlgorithm,
          offer.keyId,
        ],
      );
      await recordTransition(client, job.id, job.state, "OFFERED", "COORDINATOR", "OFFER_CREATED", {
        offerId: offer.id,
        nodeId: offer.manifest.nodeId,
        expiresAt: offer.manifest.expiresAt,
        keyId: offer.keyId,
      });
      await client.query("COMMIT");
      return { ok: true, value: offer };
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async listPendingOffers(nodeId: string, now: string): Promise<SignedJobOffer[]> {
    const result = await this.pool.query<OfferRow>(
      `SELECT assignments.*
       FROM assignments
       JOIN jobs ON jobs.id = assignments.job_id
       WHERE assignments.node_id = $1
         AND assignments.expires_at > $2
         AND jobs.state IN ('OFFERED', 'APPROVED')
       ORDER BY assignments.expires_at`,
      [nodeId, now],
    );
    return result.rows.map(mapOffer);
  }

  async approveOffer(
    offerId: string,
    nodeId: string,
    now: string,
  ): Promise<StoreResult<SignedJobOffer>> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<LockedOfferRow>(
        `SELECT assignments.*, jobs.state AS job_state
         FROM assignments
         JOIN jobs ON jobs.id = assignments.job_id
         WHERE assignments.id = $1
         FOR UPDATE OF assignments, jobs`,
        [offerId],
      );
      const row = result.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return { ok: false, reason: "OFFER_NOT_FOUND" };
      }
      if (row.node_id !== nodeId) {
        await client.query("ROLLBACK");
        return { ok: false, reason: "NODE_MISMATCH" };
      }
      if (row.expires_at.getTime() <= Date.parse(now)) {
        if (row.job_state === "OFFERED") {
          await recordTransition(
            client,
            row.job_id,
            row.job_state,
            "EXPIRED",
            "COORDINATOR",
            "OFFER_EXPIRED",
            { offerId },
          );
        }
        await client.query("COMMIT");
        return { ok: false, reason: "OFFER_EXPIRED" };
      }
      if (row.job_state !== "OFFERED") {
        await client.query("ROLLBACK");
        return { ok: false, reason: "INVALID_STATE" };
      }

      await client.query("UPDATE assignments SET approved_at = $2 WHERE id = $1", [offerId, now]);
      await recordTransition(
        client,
        row.job_id,
        row.job_state,
        "APPROVED",
        "PROVIDER",
        "OFFER_APPROVED",
        { offerId, nodeId },
      );
      await client.query("COMMIT");
      return { ok: true, value: mapOffer({ ...row, approved_at: new Date(now) }) };
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async claimOffer(
    offerId: string,
    nodeId: string,
    nonce: string,
    now: string,
    leaseUntil: string,
  ): Promise<StoreResult<SignedJobOffer>> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<LockedOfferRow>(
        `SELECT assignments.*, jobs.state AS job_state
         FROM assignments
         JOIN jobs ON jobs.id = assignments.job_id
         WHERE assignments.id = $1
         FOR UPDATE OF assignments, jobs`,
        [offerId],
      );
      const row = result.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return { ok: false, reason: "OFFER_NOT_FOUND" };
      }
      if (row.node_id !== nodeId) {
        await client.query("ROLLBACK");
        return { ok: false, reason: "NODE_MISMATCH" };
      }
      if (row.nonce_consumed_at) {
        await client.query("ROLLBACK");
        return { ok: false, reason: "NONCE_ALREADY_USED" };
      }
      if (row.nonce !== nonce) {
        await client.query("ROLLBACK");
        return { ok: false, reason: "NONCE_MISMATCH" };
      }
      if (row.expires_at.getTime() <= Date.parse(now)) {
        if (row.job_state === "APPROVED") {
          await recordTransition(
            client,
            row.job_id,
            row.job_state,
            "EXPIRED",
            "COORDINATOR",
            "OFFER_EXPIRED",
            { offerId },
          );
        }
        await client.query("COMMIT");
        return { ok: false, reason: "OFFER_EXPIRED" };
      }
      if (row.job_state !== "APPROVED") {
        await client.query("ROLLBACK");
        return { ok: false, reason: "INVALID_STATE" };
      }

      await client.query(
        `UPDATE assignments
         SET claimed_at = $2, nonce_consumed_at = $2, lease_until = $3
         WHERE id = $1 AND nonce_consumed_at IS NULL`,
        [offerId, now, leaseUntil],
      );
      await recordTransition(
        client,
        row.job_id,
        row.job_state,
        "CLAIMED",
        "PROVIDER_AGENT",
        "OFFER_CLAIMED",
        { offerId, nodeId, leaseUntil },
      );
      await client.query("COMMIT");
      return {
        ok: true,
        value: mapOffer({
          ...row,
          claimed_at: new Date(now),
          nonce_consumed_at: new Date(now),
          lease_until: new Date(leaseUntil),
        }),
      };
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async transitionAssignedJob(
    jobId: string,
    nodeId: string,
    nextState: Parameters<CoordinatorStore["transitionAssignedJob"]>[2],
    actor: string,
    correlationId: string,
    safePayload: Record<string, unknown> = {},
  ): Promise<StoreResult<JobRecord>> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const jobResult = await client.query<{ state: JobRecord["state"] }>(
        "SELECT state FROM jobs WHERE id = $1 FOR UPDATE",
        [jobId],
      );
      const jobRow = jobResult.rows[0];
      if (!jobRow) {
        await client.query("ROLLBACK");
        return { ok: false, reason: "JOB_NOT_FOUND" };
      }
      const assignmentResult = await client.query<{
        node_id: string;
        claimed_at: Date | null;
        lease_until: Date | null;
      }>("SELECT node_id, claimed_at, lease_until FROM assignments WHERE job_id = $1 FOR UPDATE", [
        jobId,
      ]);
      const assignmentRow = assignmentResult.rows[0];
      if (!assignmentRow?.claimed_at) {
        await client.query("ROLLBACK");
        return { ok: false, reason: "JOB_NOT_CLAIMED" };
      }
      if (assignmentRow.node_id !== nodeId) {
        await client.query("ROLLBACK");
        return { ok: false, reason: "NODE_MISMATCH" };
      }
      if (
        nextState === "RUNNING" &&
        (!assignmentRow.lease_until || assignmentRow.lease_until.getTime() <= Date.now())
      ) {
        await client.query("ROLLBACK");
        return { ok: false, reason: "LEASE_EXPIRED" };
      }
      try {
        assertJobTransition(jobRow.state, nextState);
      } catch {
        await client.query("ROLLBACK");
        return { ok: false, reason: "INVALID_STATE" };
      }

      await client.query("UPDATE jobs SET state = $2, updated_at = NOW() WHERE id = $1", [
        jobId,
        nextState,
      ]);
      await client.query(
        `INSERT INTO job_events
          (id, job_id, actor, event_type, from_state, to_state, correlation_id, safe_payload)
         VALUES ($1, $2, $3, 'AGENT_STATE_TRANSITION', $4, $5, $6, $7)`,
        [
          randomUUID(),
          jobId,
          actor,
          jobRow.state,
          nextState,
          correlationId,
          JSON.stringify(safePayload),
        ],
      );
      await client.query("COMMIT");
      const updated = await this.findJob(jobId);
      if (!updated) throw new Error("Transitioned job could not be read");
      return { ok: true, value: updated };
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }
}
