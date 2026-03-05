import { swarmEvents, getLeadSessionId } from './swarm-registry.js';
import { injectMessage } from './pty-writer.js';
import { fireWebhook } from './webhooks.js';

export interface CostRecord {
  sessionId: string;
  agentName: string;
  officeId: string;
  totalCost: number;           // dollars, cumulative
  lastReportedCost: number;
  costUpdates: number;
  firstCostAt: string | null;
  lastCostAt: string | null;
  budgetCents: number | null;
  budgetWarned80: boolean;
  budgetWarned95: boolean;
  budgetExceeded: boolean;
}

export interface OfficeCostSummary {
  officeId: string;
  totalCost: number;
  agentCosts: Array<{
    agentName: string;
    sessionId: string;
    totalCost: number;
    budgetCents: number | null;
    budgetPercent: number | null;
  }>;
  generatedAt: string;
}

// In-memory cost records, keyed by sessionId
const costRecords = new Map<string, CostRecord>();

// Per-session line buffer to handle PTY chunk boundaries
const lineBuffers = new Map<string, string>();

const TOTAL_COST_RE = /Total cost:\s*\$([0-9]+(?:\.[0-9]+)?)/;
const TURN_COST_RE = /(?:Cost|Session cost):\s*\$([0-9]+(?:\.[0-9]+)?)/;

export function initCostTracking(
  sessionId: string,
  agentName: string,
  officeId: string,
  budgetCents?: number | null,
): void {
  costRecords.set(sessionId, {
    sessionId,
    agentName,
    officeId,
    totalCost: 0,
    lastReportedCost: 0,
    costUpdates: 0,
    firstCostAt: null,
    lastCostAt: null,
    budgetCents: budgetCents ?? null,
    budgetWarned80: false,
    budgetWarned95: false,
    budgetExceeded: false,
  });
  lineBuffers.set(sessionId, '');
}

export function removeCostTracking(sessionId: string): CostRecord | null {
  const record = costRecords.get(sessionId) ?? null;
  costRecords.delete(sessionId);
  lineBuffers.delete(sessionId);
  return record;
}

export function getCostRecord(sessionId: string): CostRecord | null {
  return costRecords.get(sessionId) ?? null;
}

export function setSessionBudget(sessionId: string, budgetCents: number | null): void {
  const record = costRecords.get(sessionId);
  if (record) {
    record.budgetCents = budgetCents;
    // Reset warning flags when budget changes
    record.budgetWarned80 = false;
    record.budgetWarned95 = false;
    record.budgetExceeded = false;
  }
}

export function getOfficeCostSummary(officeId: string): OfficeCostSummary {
  const agentCosts: OfficeCostSummary['agentCosts'] = [];
  let totalCost = 0;

  for (const record of costRecords.values()) {
    if (record.officeId !== officeId) continue;
    totalCost += record.totalCost;
    agentCosts.push({
      agentName: record.agentName,
      sessionId: record.sessionId,
      totalCost: record.totalCost,
      budgetCents: record.budgetCents,
      budgetPercent: record.budgetCents
        ? Math.round((record.totalCost * 100) / (record.budgetCents / 100) * 100) / 100
        : null,
    });
  }

  return {
    officeId,
    totalCost,
    agentCosts,
    generatedAt: new Date().toISOString(),
  };
}

export function getGlobalCostSummary(): { totalCost: number; records: CostRecord[] } {
  let totalCost = 0;
  const records: CostRecord[] = [];
  for (const record of costRecords.values()) {
    totalCost += record.totalCost;
    records.push({ ...record });
  }
  return { totalCost, records };
}

function emitCostUpdate(record: CostRecord): void {
  swarmEvents.emit('cost:update', {
    sessionId: record.sessionId,
    agentName: record.agentName,
    officeId: record.officeId,
    totalCost: record.totalCost,
    budgetCents: record.budgetCents,
    budgetPercent: record.budgetCents
      ? Math.round((record.totalCost * 100) / (record.budgetCents / 100) * 100) / 100
      : null,
  });
}

function checkBudgetThresholds(sessionId: string, record: CostRecord): void {
  if (!record.budgetCents) return;
  const costCents = Math.round(record.totalCost * 100);
  const percent = costCents / record.budgetCents;

  if (percent >= 1.0 && !record.budgetExceeded) {
    record.budgetExceeded = true;
    record.budgetWarned95 = true;
    record.budgetWarned80 = true;

    injectMessage(sessionId,
      `[SWARM SYSTEM]: BUDGET EXCEEDED. You have spent $${record.totalCost.toFixed(2)} ` +
      `(budget: $${(record.budgetCents / 100).toFixed(2)}). Wrap up your current task immediately and avoid starting new work.`
    );

    // Notify lead
    const leadId = getLeadSessionId();
    if (leadId && leadId !== sessionId) {
      injectMessage(leadId,
        `[SWARM SYSTEM]: ${record.agentName} has EXCEEDED their budget. ` +
        `Spent: $${record.totalCost.toFixed(2)} / Budget: $${(record.budgetCents / 100).toFixed(2)}. ` +
        `Consider reassigning their tasks.`
      );
    }

    fireWebhook('cost:exceeded', {
      agentName: record.agentName,
      sessionId: record.sessionId,
      totalCost: record.totalCost,
      budgetCents: record.budgetCents,
    });
  } else if (percent >= 0.95 && !record.budgetWarned95) {
    record.budgetWarned95 = true;
    record.budgetWarned80 = true;

    injectMessage(sessionId,
      `[SWARM SYSTEM]: BUDGET WARNING (95%). You have spent $${record.totalCost.toFixed(2)} ` +
      `of your $${(record.budgetCents / 100).toFixed(2)} budget. Finish your current task and prepare to stop.`
    );

    const leadId = getLeadSessionId();
    if (leadId && leadId !== sessionId) {
      injectMessage(leadId,
        `[SWARM SYSTEM]: ${record.agentName} is at 95% of their budget ` +
        `($${record.totalCost.toFixed(2)} / $${(record.budgetCents / 100).toFixed(2)}).`
      );
    }

    fireWebhook('cost:warning', {
      agentName: record.agentName,
      sessionId: record.sessionId,
      totalCost: record.totalCost,
      budgetCents: record.budgetCents,
      percent: Math.round(percent * 100),
    });
  } else if (percent >= 0.80 && !record.budgetWarned80) {
    record.budgetWarned80 = true;

    injectMessage(sessionId,
      `[SWARM SYSTEM]: Budget notice (80%). You have spent $${record.totalCost.toFixed(2)} ` +
      `of your $${(record.budgetCents / 100).toFixed(2)} budget. Be mindful of cost.`
    );

    const leadId = getLeadSessionId();
    if (leadId && leadId !== sessionId) {
      injectMessage(leadId,
        `[SWARM SYSTEM]: ${record.agentName} has used 80% of their budget ` +
        `($${record.totalCost.toFixed(2)} / $${(record.budgetCents / 100).toFixed(2)}).`
      );
    }

    fireWebhook('cost:warning', {
      agentName: record.agentName,
      sessionId: record.sessionId,
      totalCost: record.totalCost,
      budgetCents: record.budgetCents,
      percent: Math.round(percent * 100),
    });
  }
}

export function parseCostFromOutput(sessionId: string, data: string): void {
  const record = costRecords.get(sessionId);
  if (!record) return;

  // Strip ANSI escape codes before matching
  const cleaned = data.replace(/\u001B\[[0-9;]*[A-Za-z]/g, '');
  const buffer = (lineBuffers.get(sessionId) || '') + cleaned;
  const lines = buffer.split('\n');
  // Keep incomplete tail in the buffer (last element after split)
  lineBuffers.set(sessionId, lines.pop() || '');

  for (const line of lines) {
    const match = line.match(TOTAL_COST_RE) || line.match(TURN_COST_RE);
    if (match) {
      const cost = parseFloat(match[1]);
      // Claude's "Total cost" is cumulative — only update if >= current
      if (!isNaN(cost) && cost >= record.totalCost) {
        record.totalCost = cost;
        record.lastReportedCost = cost;
        record.costUpdates++;
        record.lastCostAt = new Date().toISOString();
        if (!record.firstCostAt) record.firstCostAt = record.lastCostAt;
        checkBudgetThresholds(sessionId, record);
        emitCostUpdate(record);
      }
    }
  }
}
