import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  decodeProtectionToken, isRecord, isSecurityIdentifier, protectionKey, readBoundedFile, replacePrivateFile
} from './classroom-protection.js';

const version = 1;
const tagBytes = 32;
const maximumAuditBytes = 2 * 1024 * 1024;
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

function loadAudit(filePath, signer) {
  try {
    const state = JSON.parse(readBoundedFile(filePath, maximumAuditBytes));
    if (!isRecord(state) || Object.keys(state).length !== 3 || state.version !== version || !Array.isArray(state.records)) {
      throw new Error('审计文件结构或版本不合法。');
    }
    const head = state.records.reduce((previous, record, index) =>
      verifyRecord(record, index + 1, previous, signer), signer.genesis);
    if (!sameTag(state.head, head)) throw new Error('审计链终点校验失败。');
    return state;
  } catch (error) {
    if (error.code === 'ENOENT') return { version, head: signer.genesis, records: [] };
    throw new Error('无法验证课堂审计文件。', { cause: error });
  }
}

function projectAudit({ at, action, outcome, requestId, classId, actor }) {
  return { at, action, outcome, requestId, classId, actor };
}

export function createAuditLog({ filePath, key, domain } = {}) {
  if (typeof filePath !== 'string' || filePath.trim() === '') throw new TypeError('请配置课堂审计文件。');
  const signer = makeSigner(protectionKey(key, domain), domain);
  let state = loadAudit(filePath, signer);
  return {
    append(event) {
      const metadata = parseMetadata(event);
      const record = {
        sequence: state.records.length + 1, at: new Date().toISOString(), previous: state.head, ...metadata
      };
      const tag = signer.sign(record);
      const next = { version, head: tag, records: [...state.records, { ...record, tag }] };
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
