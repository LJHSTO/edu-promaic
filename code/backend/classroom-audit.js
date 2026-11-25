import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  decodeProtectionToken, isRecord, isSecurityIdentifier, protectionKey, readBoundedFile, replacePrivateFile
} from './classroom-protection.js';

const version = 1;
const segmentVersion = 2;
const tagBytes = 32;
export const maximumAuditBytes = 2 * 1024 * 1024;
export const classroomAuditDomain = 'edu-access';
const outcomes = new Set(['allowed', 'success', 'denied', 'error']);
const metadataKeys = new Set(['action', 'outcome', 'requestId', 'classId', 'actor']);

function validateMetadata({ action, outcome, requestId, classId, actor }) {
  if (!isSecurityIdentifier(action) || !outcomes.has(outcome) || !isSecurityIdentifier(requestId)) {
    throw new TypeError('审计动作、结果或请求标识不合法。');
  }
  if ((classId !== null && !isSecurityIdentifier(classId)) || (actor !== null && !isSecurityIdentifier(actor))) {
    throw new TypeError('审计班级或主体标识不合法。');
  }
}

function parseMetadata(event) {
  if (!isRecord(event) || Object.keys(event).some(key => !metadataKeys.has(key))) {
    throw new TypeError('审计事件只允许已定义的元数据字段。');
  }
  const { action, outcome, requestId, classId = null, actor = null } = event;
  const metadata = { action, outcome, requestId, classId, actor };
  validateMetadata(metadata);
  return metadata;
}

function sameTag(left, right) {
  return timingSafeEqual(decodeProtectionToken(left, tagBytes), decodeProtectionToken(right, tagBytes));
}

function makeSigner(secret, domain) {
  const prefix = JSON.stringify(['edu-promaic/classroom-audit', version, domain]);
  function digest(values) {
    return createHmac('sha256', secret).update(prefix).update(JSON.stringify(values)).digest('base64url');
  }
  return {
    genesis: digest(['start']),
    sign({ sequence, at, previous, action, outcome, requestId, classId, actor }) {
      return digest([sequence, at, previous, action, outcome, requestId, classId, actor]);
    },
    signCheckpoint({ sequence, head }) {
      return digest(['checkpoint', sequence, head]);
    },
    signSegmentStart({ sequence, head }) {
      return digest(['segment-start', sequence, head]);
    }
  };
}

function verifyRecord(record, sequence, previous, signer) {
  if (!isRecord(record) || Object.keys(record).length !== 9 || record.sequence !== sequence) {
    throw new Error('审计记录结构不合法。');
  }
  if (typeof record.at !== 'string' || new Date(record.at).toISOString() !== record.at) {
    throw new Error('审计时间格式不合法。');
  }
  validateMetadata(record);
  if (!sameTag(record.previous, previous) || !sameTag(record.tag, signer.sign(record))) {
    throw new Error('审计链校验失败。');
  }
  return record.tag;
}

function segmentStart(state, signer) {
  if (state.version === version && Object.keys(state).length === 3) return { sequence: 0, head: signer.genesis };
  if (state.version !== segmentVersion || Object.keys(state).length !== 4) {
    throw new Error('审计文件结构或版本不合法。');
  }
  const { start } = state;
  if (!isRecord(start) || Object.keys(start).length !== 3 || !Number.isSafeInteger(start.sequence) || start.sequence < 1) {
    throw new Error('审计分段起点结构不合法。');
  }
  decodeProtectionToken(start.head, tagBytes);
  if (!sameTag(start.tag, signer.signSegmentStart(start))) throw new Error('审计分段起点签名校验失败。');
  return start;
}

function decodeAuditState(text, signer) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > maximumAuditBytes) {
    throw new Error('审计文件大小不合法。');
  }
  const state = JSON.parse(text);
  if (!isRecord(state) || !Array.isArray(state.records)) {
    throw new Error('审计文件结构或版本不合法。');
  }
  if (text.trim() !== JSON.stringify(state)) throw new Error('审计文件编码不符合归档格式。');
  const { sequence, head: startHead } = segmentStart(state, signer);
  if (!Number.isSafeInteger(sequence + state.records.length)) throw new Error('审计序号超出有效范围。');
  const head = state.records.reduce((previous, record, index) =>
    verifyRecord(record, sequence + index + 1, previous, signer), startHead);
  if (!sameTag(state.head, head)) throw new Error('审计链终点校验失败。');
  return state;
}

function loadAudit(filePath, signer) {
  try {
    return decodeAuditState(readBoundedFile(filePath, maximumAuditBytes), signer);
  } catch (error) {
    if (error.code === 'ENOENT') return { version, head: signer.genesis, records: [] };
    throw new Error('无法验证课堂审计文件。', { cause: error });
  }
}

function validateCheckpoint(checkpoint, domain, signer) {
  if (!isRecord(checkpoint) || Object.keys(checkpoint).length !== 5 || checkpoint.version !== version
      || checkpoint.domain !== domain || !Number.isSafeInteger(checkpoint.sequence) || checkpoint.sequence < 0) {
    throw new Error('审计检查点结构或保护域不合法。');
  }
  try {
    decodeProtectionToken(checkpoint.head, tagBytes);
    if (!sameTag(checkpoint.tag, signer.signCheckpoint(checkpoint))) throw new Error('签名不匹配。');
  } catch (error) {
    throw new Error('审计检查点签名校验失败。', { cause: error });
  }
}

function verifyCheckpoint(checkpoint, state, domain, signer) {
  validateCheckpoint(checkpoint, domain, signer);
  const start = state.start ?? { sequence: 0, head: signer.genesis };
  const offset = checkpoint.sequence - start.sequence;
  if (offset > state.records.length) throw new Error('审计快照早于已保存的检查点。');
  if (offset < 0) throw new Error('检查点早于当前审计分段，请先核对上一份归档。');
  const prefixHead = offset === 0 ? start.head : state.records[offset - 1].tag;
  if (!sameTag(checkpoint.head, prefixHead)) throw new Error('审计历史与已保存的检查点不一致。');
}

function currentSequence(state) {
  return (state.start?.sequence ?? 0) + state.records.length;
}

export function verifyAuditSnapshot({ text, key, domain = classroomAuditDomain, checkpoint } = {}) {
  const signer = makeSigner(protectionKey(key, domain), domain);
  const state = decodeAuditState(text, signer);
  if (checkpoint !== undefined) verifyCheckpoint(checkpoint, state, domain, signer);
  const next = { version, domain, sequence: currentSequence(state), head: state.head };
  return { state, checkpoint: { ...next, tag: signer.signCheckpoint(next) } };
}

export function prepareAuditRollover({ text, archiveText, key, domain = classroomAuditDomain, checkpoint } = {}) {
  const signer = makeSigner(protectionKey(key, domain), domain);
  validateCheckpoint(checkpoint, domain, signer);
  const current = decodeAuditState(text, signer);
  if (!current.records.length) throw new Error('当前审计分段尚无记录。');
  const sequence = currentSequence(current);
  if (checkpoint.sequence !== sequence || !sameTag(checkpoint.head, current.head)) {
    throw new Error('已保存检查点须匹配当前审计分段末尾。');
  }
  if (typeof archiveText !== 'string' || archiveText.trim() !== text.trim()) {
    throw new Error('归档须与当前审计分段完全一致。');
  }
  const start = { sequence, head: current.head };
  const state = { version: segmentVersion, start: { ...start, tag: signer.signSegmentStart(start) }, head: start.head, records: [] };
  return { state, checkpoint };
}

export function readAuditSnapshot({ filePath, ...options } = {}) {
  if (typeof filePath !== 'string' || filePath.trim() === '') throw new TypeError('请配置课堂审计文件。');
  const text = readBoundedFile(filePath, maximumAuditBytes);
  return verifyAuditSnapshot({ ...options, text });
}

function projectAudit({ at, action, outcome, requestId, classId, actor }) {
  return { at, action, outcome, requestId, classId, actor };
}

export function createAuditLog({ filePath, key, domain, checkpoint } = {}) {
  if (typeof filePath !== 'string' || filePath.trim() === '') throw new TypeError('请配置课堂审计文件。');
  const signer = makeSigner(protectionKey(key, domain), domain);
  let state = loadAudit(filePath, signer);
  if (checkpoint !== undefined) verifyCheckpoint(checkpoint, state, domain, signer);
  return {
    append(event) {
      const metadata = parseMetadata(event);
      const sequence = currentSequence(state) + 1;
      if (!Number.isSafeInteger(sequence)) throw new Error('审计序号超出有效范围。');
      const record = {
        sequence, at: new Date().toISOString(), previous: state.head, ...metadata
      };
      const tag = signer.sign(record);
      const next = { ...state, head: tag, records: [...state.records, { ...record, tag }] };
      const serialized = JSON.stringify(next);
      if (Buffer.byteLength(serialized) > maximumAuditBytes) throw new Error('审计文件已达到容量上限。');
      replacePrivateFile(filePath, serialized);
      state = next;
    },
    tail({ classId, limit = 50 } = {}) {
      if (!isSecurityIdentifier(classId) || !Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new TypeError('审计查询需要班级标识和有效条数。');
      }
      return state.records.filter(event => event.classId === classId).slice(-limit).map(projectAudit);
    }
  };
}
