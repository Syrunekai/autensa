import { v4 as uuidv4 } from 'uuid';
import { run, queryAll } from '@/lib/db';
import { broadcast } from '@/lib/events';

/**
 * Maps cycle_id to its 1-based ordinal within a product's cycles of the given
 * type, ordered by started_at. Research and ideation cycles are numbered
 * independently. Ordinals are computed at read time, not stored.
 */
export function getCycleNumberMap(
  productId: string,
  cycleType: 'research' | 'ideation'
): Map<string, number> {
  const table = cycleType === 'research' ? 'research_cycles' : 'ideation_cycles';
  const rows = queryAll<{ id: string; n: number }>(
    `SELECT id, ROW_NUMBER() OVER (ORDER BY started_at ASC, id ASC) AS n
     FROM ${table} WHERE product_id = ?`,
    [productId]
  );
  return new Map(rows.map(r => [r.id, r.n]));
}

/**
 * Emit an autopilot activity event — persists to DB and broadcasts via SSE.
 */
export function emitAutopilotActivity(input: {
  productId: string;
  cycleId: string;
  cycleType: 'research' | 'ideation';
  eventType: string;
  message: string;
  detail?: string;
  costUsd?: number;
  tokensUsed?: number;
}): void {
  const id = uuidv4();
  const now = new Date().toISOString();

  run(
    `INSERT INTO autopilot_activity_log (id, product_id, cycle_id, cycle_type, event_type, message, detail, cost_usd, tokens_used, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, input.productId, input.cycleId, input.cycleType,
      input.eventType, input.message, input.detail || null,
      input.costUsd || null, input.tokensUsed || null, now
    ]
  );

  // cycle_number matches the ordinal returned by the activity API.
  const cycleNumber = getCycleNumberMap(input.productId, input.cycleType).get(input.cycleId);

  broadcast({
    type: 'autopilot_activity',
    payload: {
      id,
      product_id: input.productId,
      cycle_id: input.cycleId,
      cycle_type: input.cycleType,
      cycle_number: cycleNumber,
      event_type: input.eventType,
      message: input.message,
      detail: input.detail,
      cost_usd: input.costUsd,
      tokens_used: input.tokensUsed,
      created_at: now,
    }
  });
}
