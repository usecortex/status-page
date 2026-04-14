/**
 * Persistent health check state stored in S3.
 *
 * Tracks consecutive failure counts and active incident IDs per component
 * so the health check cron can decide when to create/resolve incidents.
 */

import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getS3Client, getBucketName } from "./s3";

const STATE_KEY = "health-state.json";

export interface ComponentHealthState {
  /** Number of consecutive failed checks */
  consecutiveFailures: number;
  /** incident.io incident ID if an incident is currently open */
  activeIncidentId: string | null;
  /** ISO timestamp of when the incident was created */
  incidentCreatedAt: string | null;
  /** Last check timestamp */
  lastCheckedAt: string;
  /** Last check result */
  lastHealthy: boolean;
}

export interface HealthState {
  /** Per-component state keyed by component ID */
  components: Record<string, ComponentHealthState>;
  /** Last updated timestamp */
  updatedAt: string;
}

export async function readHealthState(): Promise<HealthState | null> {
  try {
    const client = getS3Client();
    const command = new GetObjectCommand({
      Bucket: getBucketName(),
      Key: STATE_KEY,
    });
    const response = await client.send(command);
    const body = await response.Body?.transformToString();
    if (!body) return null;
    return JSON.parse(body) as HealthState;
  } catch (err: unknown) {
    // NoSuchKey means first run
    if (err && typeof err === "object" && "name" in err && err.name === "NoSuchKey") {
      return null;
    }
    console.error("[health-state] Error reading state:", err);
    return null;
  }
}

export async function writeHealthState(state: HealthState): Promise<void> {
  const client = getS3Client();
  const command = new PutObjectCommand({
    Bucket: getBucketName(),
    Key: STATE_KEY,
    Body: JSON.stringify(state, null, 2),
    ContentType: "application/json",
  });
  await client.send(command);
}

export function getComponentState(
  state: HealthState | null,
  componentId: string,
): ComponentHealthState {
  return (
    state?.components[componentId] ?? {
      consecutiveFailures: 0,
      activeIncidentId: null,
      incidentCreatedAt: null,
      lastCheckedAt: new Date().toISOString(),
      lastHealthy: true,
    }
  );
}
