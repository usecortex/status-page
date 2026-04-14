/**
 * incident.io API client for creating and resolving incidents.
 *
 * Uses the v2 API for creating incidents and v1 for updating status.
 * Requires INCIDENT_IO_API_KEY env var with "Create incidents" and
 * "Close incidents" permissions.
 */

const API_BASE = "https://api.incident.io";

interface CreateIncidentParams {
  name: string;
  summary?: string;
  severityId: string;
  idempotencyKey: string;
}

interface IncidentResponse {
  incident: {
    id: string;
    name: string;
    status: string;
    reference: string;
  };
}

interface SeverityResponse {
  severities: Array<{
    id: string;
    name: string;
    rank: number;
  }>;
}

function getApiKey(): string | null {
  return process.env.INCIDENT_IO_API_KEY || null;
}

function headers(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

/**
 * Fetch available severities from incident.io.
 * Returns null on failure.
 */
export async function getSeverities(): Promise<SeverityResponse["severities"] | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  try {
    const res = await fetch(`${API_BASE}/v1/severities`, {
      headers: headers(apiKey),
    });
    if (!res.ok) {
      console.error(`[incident-io-api] Failed to fetch severities: ${res.status}`);
      return null;
    }
    const data: SeverityResponse = await res.json();
    return data.severities;
  } catch (err) {
    console.error("[incident-io-api] Error fetching severities:", err);
    return null;
  }
}

/**
 * Find the severity ID for a given name (case-insensitive).
 * Falls back to the lowest-rank (least severe) severity if not found.
 */
export async function findSeverityId(name: string): Promise<string | null> {
  const severities = await getSeverities();
  if (!severities || severities.length === 0) return null;

  const match = severities.find(
    (s) => s.name.toLowerCase() === name.toLowerCase(),
  );
  if (match) return match.id;

  // Fall back to lowest rank (least severe — rank 0 = Minor)
  const sorted = [...severities].sort((a, b) => a.rank - b.rank);
  return sorted[0]?.id ?? null;
}

/**
 * Create an incident in incident.io.
 * Uses idempotency key to prevent duplicates.
 */
export async function createIncident(
  params: CreateIncidentParams,
): Promise<IncidentResponse["incident"] | null> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.error("[incident-io-api] INCIDENT_IO_API_KEY not configured");
    return null;
  }

  try {
    const res = await fetch(`${API_BASE}/v2/incidents`, {
      method: "POST",
      headers: headers(apiKey),
      body: JSON.stringify({
        idempotency_key: params.idempotencyKey,
        visibility: "public",
        incident_type_id: undefined,
        name: params.name,
        summary: params.summary,
        severity_id: params.severityId,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`[incident-io-api] Failed to create incident: ${res.status} ${body}`);
      return null;
    }

    const data: IncidentResponse = await res.json();
    return data.incident;
  } catch (err) {
    console.error("[incident-io-api] Error creating incident:", err);
    return null;
  }
}

/**
 * Fetch available incident statuses from incident.io.
 * Returns null on failure.
 */
async function getIncidentStatuses(): Promise<Array<{ id: string; name: string; category: string }> | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  try {
    const res = await fetch(`${API_BASE}/v1/incident_statuses`, {
      headers: headers(apiKey),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.incident_statuses ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve an incident by setting its status to "Closed" via the v2 edit endpoint.
 * Looks up the Closed status ID dynamically.
 */
export async function resolveIncident(incidentId: string): Promise<boolean> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.error("[incident-io-api] INCIDENT_IO_API_KEY not configured");
    return false;
  }

  try {
    // Find the "Closed" status ID
    const statuses = await getIncidentStatuses();
    const closedStatus = statuses?.find((s) => s.category === "closed");
    if (!closedStatus) {
      console.error("[incident-io-api] Could not find a 'closed' category status");
      return false;
    }

    const res = await fetch(
      `${API_BASE}/v2/incidents/${incidentId}/actions/edit`,
      {
        method: "POST",
        headers: headers(apiKey),
        body: JSON.stringify({
          incident: {
            incident_status_id: closedStatus.id,
          },
          notify_incident_channel: true,
        }),
      },
    );

    if (!res.ok) {
      const body = await res.text();
      console.error(`[incident-io-api] Failed to resolve incident: ${res.status} ${body}`);
      return false;
    }

    return true;
  } catch (err) {
    console.error("[incident-io-api] Error resolving incident:", err);
    return false;
  }
}
