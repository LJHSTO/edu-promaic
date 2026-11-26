import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createProtectedAccess } from './access.js';
import { createClassroom } from './classroom.js';
import { createStoreProtection, isSecurityIdentifier, parseClassroomKeys, readBoundedFile } from './classroom-protection.js';
import { classroomAuditDomain, createAuditLog } from './classroom-audit.js';

function configPath(directory, value) {
  if (typeof value !== 'string' || value.length === 0) throw new Error('受保护课堂缺少必要的文件或目录路径。');
  return resolve(directory, value);
}

export function createProtectedProfile({ access, classrooms, defaultClass, audit, auditKey, tls }) {
  if (!classrooms.has(defaultClass)) throw new Error('默认班级须在班级成员表中。');
  function auditMetadata({ action, requestId, classId, actor }) {
    return {
      action, requestId,
      classId: classrooms.has(classId) ? classId : undefined,
      actor: actor ? createHmac('sha256', auditKey).update(actor.subject).digest('hex') : undefined
    };
  }
  return {
    tls,
    resolveClass(classId) {
      return classId ?? defaultClass;
    },
    authenticate(req) {
      return access.authenticate(req);
    },
    select(actor, classId, roles) {
      access.authorize(actor, classId, roles);
      return classrooms.get(classId);
    },
    auditTrail(classId) {
      return audit.tail({ classId });
    },
    beginAudit(context) {
      return audit.begin(auditMetadata(context));
    },
    recordDenied(context) {
      audit.append({ ...auditMetadata(context), outcome: 'denied' });
    }
  };
}

function commitWithRetentionAudit(audit, classId, persist) {
  const complete = audit.begin({ action: 'retention.prune', requestId: randomUUID(), classId });
  try {
    persist();
  } catch (error) {
    try {
      complete('error');
    } catch (auditError) {
      throw new AggregateError([error, auditError], '课堂清理及审计写入失败。');
    }
    throw error;
  }
  complete('success');
}

function reportAuditCapacity({ level, usedBytes, limitBytes }) {
  console.warn(JSON.stringify({ code: 'CLASSROOM_AUDIT_CAPACITY', level, usedBytes, limitBytes }));
}

function sweepClassrooms(classrooms) {
  let removed = 0;
  const errors = [];
  for (const room of classrooms.values()) {
    try {
      removed += room.sweepExpiredSessions();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, '部分课堂未能完成会话清理。');
  return removed;
}

export function loadProtectedProfile(configFile, { engine, agent, storeKeyText, auditKeyText }) {
  if (!configFile) throw new Error('请设置 CLASSROOM_SECURITY_CONFIG。');
  const filename = resolve(configFile);
  const directory = dirname(filename);
  const config = JSON.parse(readFileSync(filename, 'utf8'));
  const read = field => readFileSync(configPath(directory, config[field]));
  const access = createProtectedAccess({ ...config, now: Date.now, publicKey: read('publicKeyFile').toString('utf8') });
  const { storeKey, auditKey } = parseClassroomKeys(storeKeyText, auditKeyText);
  const dataDirectory = configPath(directory, config.dataDirectory);
  const classIds = new Set(config.memberships.map(member => member.classId));
  if ([...classIds].some(classId => !isSecurityIdentifier(classId))) throw new Error('班级编号须以字母或数字开头。');
  const checkpoint = config.auditCheckpointFile === undefined ? undefined
    : JSON.parse(readBoundedFile(configPath(directory, config.auditCheckpointFile), 4096));
  const audit = createAuditLog({
    filePath: resolve(dataDirectory, 'access-audit.json'), key: auditKey, domain: classroomAuditDomain, checkpoint,
    onCapacityWarning: reportAuditCapacity
  });
  const classrooms = new Map([...classIds].map(classId => [classId, createClassroom({
    filePath: resolve(dataDirectory, `${classId}.sealed.json`),
    protection: createStoreProtection({ key: storeKey, domain: `class:${classId}` }),
    engine, agent, sessionRetentionDays: config.sessionRetentionDays,
    commitPruning: persist => commitWithRetentionAudit(audit, classId, persist)
  })]));
  const tls = { key: read('tlsKeyFile'), cert: read('tlsCertFile'), minVersion: 'TLSv1.2' };
  const profile = createProtectedProfile({ access, classrooms, defaultClass: config.defaultClass, audit, auditKey, tls });
  if (config.sessionRetentionDays !== undefined) profile.sweepExpiredSessions = () => sweepClassrooms(classrooms);
  return profile;
}
