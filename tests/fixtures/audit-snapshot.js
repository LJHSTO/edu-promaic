import { createHmac } from 'node:crypto';
import { maximumAuditBytes } from '../../code/backend/classroom-audit.js';

export function historicalAuditSnapshot({ key, domain, limit = maximumAuditBytes }) {
  // Build a signed, pre-rollover segment without rewriting the fixture for each record.
  const prefix = JSON.stringify(['edu-promaic/classroom-audit', 1, domain]);
  const digest = data => createHmac('sha256', key).update(prefix).update(JSON.stringify(data)).digest('base64url');
  const state = { version: 1, head: digest(['start']), records: [] };
  let bytes = Buffer.byteLength(JSON.stringify(state));
  while (bytes < limit) {
    const sequence = state.records.length + 1;
    const at = '2026-11-25T00:00:00.000Z';
    const previous = state.head;
    const metadata = { action: 'data.read', requestId: `sample-${sequence}`, outcome: 'success', classId: 'alpha', actor: null };
    const { action, outcome, requestId, classId, actor } = metadata;
    const tag = digest([sequence, at, previous, action, outcome, requestId, classId, actor]);
    const record = { sequence, at, previous, ...metadata, tag };
    const length = Buffer.byteLength(JSON.stringify(record)) + Number(sequence > 1);
    if (bytes + length > limit) break;
    state.records.push(record);
    state.head = tag;
    bytes += length;
  }
  return JSON.stringify(state);
}
