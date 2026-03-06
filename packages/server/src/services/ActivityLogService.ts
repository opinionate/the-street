import type { LogEntry, LogEntryType } from "@the-street/shared";
import { getPool } from "../database/pool.js";

// --- Write Path (append-only) ---

export async function appendLogEntry(entry: LogEntry): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO daemon_activity_log
      (id, daemon_id, type, timestamp, actors, tokens_in, tokens_out,
       model_used, inference_latency_ms, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      entry.entryId,
      entry.daemonId,
      entry.type,
      new Date(entry.timestamp),
      JSON.stringify(entry.actors),
      entry.tokensIn ?? null,
      entry.tokensOut ?? null,
      entry.modelUsed ?? null,
      entry.inferenceLatencyMs ?? null,
      JSON.stringify(entry.payload),
    ],
  );
}

// --- Paginated Read ---

export interface ActivityLogQuery {
  daemonId: string;
  types?: LogEntryType[];
  visitorId?: string;
  after?: number; // epoch ms
  before?: number; // epoch ms
  sessionId?: string;
  limit?: number;
  cursor?: string; // ISO timestamp of last entry
}

export interface ActivityLogPage {
  entries: LogEntry[];
  nextCursor: string | null;
  hasMore: boolean;
}

export async function queryActivityLog(query: ActivityLogQuery): Promise<ActivityLogPage> {
  const pool = getPool();
  const limit = Math.min(query.limit ?? 50, 200);

  const conditions: string[] = ["daemon_id = $1"];
  const params: unknown[] = [query.daemonId];
  let paramIdx = 2;

  if (query.types && query.types.length > 0) {
    conditions.push(`type = ANY($${paramIdx})`);
    params.push(query.types);
    paramIdx++;
  }

  if (query.visitorId) {
    conditions.push(`actors @> $${paramIdx}::jsonb`);
    params.push(JSON.stringify([{ actorId: query.visitorId }]));
    paramIdx++;
  }

  if (query.after) {
    conditions.push(`timestamp >= $${paramIdx}`);
    params.push(new Date(query.after));
    paramIdx++;
  }

  if (query.before) {
    conditions.push(`timestamp <= $${paramIdx}`);
    params.push(new Date(query.before));
    paramIdx++;
  }

  if (query.sessionId) {
    conditions.push(`payload->>'sessionId' = $${paramIdx}`);
    params.push(query.sessionId);
    paramIdx++;
  }

  if (query.cursor) {
    conditions.push(`timestamp < $${paramIdx}`);
    params.push(new Date(query.cursor));
    paramIdx++;
  }

  // Fetch limit+1 to detect hasMore
  params.push(limit + 1);

  const sql = `
    SELECT id, daemon_id, type, timestamp, actors, tokens_in, tokens_out,
           model_used, inference_latency_ms, payload
    FROM daemon_activity_log
    WHERE ${conditions.join(" AND ")}
    ORDER BY timestamp DESC
    LIMIT $${paramIdx}
  `;

  const { rows } = await pool.query(sql, params);

  const hasMore = rows.length > limit;
  const resultRows = hasMore ? rows.slice(0, limit) : rows;

  const entries: LogEntry[] = resultRows.map(rowToLogEntry);

  const nextCursor = hasMore && resultRows.length > 0
    ? resultRows[resultRows.length - 1].timestamp.toISOString()
    : null;

  return { entries, nextCursor, hasMore };
}

// --- Token Summary ---

export interface TokenSummaryResult {
  window: string;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCalls: number;
  breakdown: Array<{
    type: LogEntryType;
    tokensIn: number;
    tokensOut: number;
    callCount: number;
  }>;
}

export async function getTokenSummary(
  daemonId: string,
  window: "30d" | "90d" | "all",
): Promise<TokenSummaryResult> {
  const pool = getPool();

  const conditions: string[] = ["daemon_id = $1"];
  const params: unknown[] = [daemonId];

  if (window !== "all") {
    const days = window === "30d" ? 30 : 90;
    conditions.push(`timestamp >= NOW() - INTERVAL '${days} days'`);
  }

  const sql = `
    SELECT
      type,
      COALESCE(SUM(tokens_in), 0)::int AS tokens_in,
      COALESCE(SUM(tokens_out), 0)::int AS tokens_out,
      COUNT(*)::int AS call_count
    FROM daemon_activity_log
    WHERE ${conditions.join(" AND ")}
    GROUP BY type
    ORDER BY type
  `;

  const { rows } = await pool.query(sql, params);

  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let totalCalls = 0;

  const breakdown = rows.map((r: Record<string, unknown>) => {
    const tokensIn = Number(r.tokens_in);
    const tokensOut = Number(r.tokens_out);
    const callCount = Number(r.call_count);
    totalTokensIn += tokensIn;
    totalTokensOut += tokensOut;
    totalCalls += callCount;
    return {
      type: r.type as LogEntryType,
      tokensIn,
      tokensOut,
      callCount,
    };
  });

  return { window, totalTokensIn, totalTokensOut, totalCalls, breakdown };
}

// --- Log Retention (180-day archive) ---

/**
 * Archive log entries older than 180 days to daemon_activity_log_archive.
 * Call periodically (e.g., daily cron or on server startup).
 */
export async function archiveOldLogEntries(): Promise<number> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Move old entries to archive
    const { rowCount } = await client.query(
      `WITH archived AS (
         DELETE FROM daemon_activity_log
         WHERE timestamp < NOW() - INTERVAL '180 days'
         RETURNING *
       )
       INSERT INTO daemon_activity_log_archive
       SELECT * FROM archived`,
    );

    await client.query("COMMIT");
    const count = rowCount ?? 0;
    if (count > 0) {
      console.log(`[ActivityLog] Archived ${count} log entries older than 180 days`);
    }
    return count;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// --- Row mapping ---

function rowToLogEntry(row: Record<string, unknown>): LogEntry {
  return {
    entryId: row.id as string,
    daemonId: row.daemon_id as string,
    type: row.type as LogEntryType,
    timestamp: new Date(row.timestamp as string).getTime(),
    actors: row.actors as LogEntry["actors"],
    tokensIn: row.tokens_in as number | undefined,
    tokensOut: row.tokens_out as number | undefined,
    modelUsed: row.model_used as string | undefined,
    inferenceLatencyMs: row.inference_latency_ms as number | undefined,
    payload: row.payload as LogEntry["payload"],
  };
}
