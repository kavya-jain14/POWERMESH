import type {
  JobState,
  JobSubmission,
  ProviderHeartbeat,
  ProviderRegistration,
  RiskDecision,
  RiskTier,
} from "@powermesh/contracts";

export interface JobRecord {
  id: string;
  requesterId: string;
  workload: JobSubmission["workload"];
  resources: JobSubmission["resources"];
  params: JobSubmission["params"];
  inputDigests: string[];
  riskTier: RiskTier;
  state: JobState;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderNodeRecord extends ProviderRegistration {
  id: string;
  availableCpu: number;
  availableMemoryMb: number;
  activeJobs: number;
  status: "OFFLINE" | "ONLINE" | "BUSY" | "DRAINING";
  lastHeartbeatAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CoordinatorStore {
  readonly kind: "memory" | "postgres";
  close(): Promise<void>;
  createPolicyCheckedJob(input: JobSubmission, risk: RiskDecision): Promise<JobRecord>;
  findJob(id: string): Promise<JobRecord | null>;
  transitionJob(
    id: string,
    nextState: JobState,
    actor: string,
    correlationId: string,
    safePayload?: Record<string, unknown>,
  ): Promise<JobRecord | null>;
  registerProvider(input: ProviderRegistration): Promise<ProviderNodeRecord>;
  heartbeatProvider(id: string, heartbeat: ProviderHeartbeat): Promise<ProviderNodeRecord | null>;
}
