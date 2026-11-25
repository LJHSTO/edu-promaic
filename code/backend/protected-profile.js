import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createProtectedAccess } from './access.js';
import { createClassroom } from './classroom.js';
import { createStoreProtection, isSecurityIdentifier } from './classroom-protection.js';
import { createAuditLog } from './classroom-audit.js';

function parseKey(value, variable) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    throw new Error(`${variable} 须为 32 字节密钥的 Base64 表示。`);
  }
  const key = Buffer.from(value, 'base64');
  if (key.toString('base64') !== value) throw new Error(`${variable} 使用非规范 Base64。`);
  return key;
}

function configPath(directory, value) {
  if (typeof value !== 'string' || value.length === 0) throw new Error('受保护课堂缺少必要的文件或目录路径。');
  return resolve(directory, value);
}

export function createProtectedProfile({ access, classrooms, defaultClass, audit, auditKey, tls }) {
  if (!classrooms.has(defaultClass)) throw new Error('默认班级须在班级成员表中。');
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
    record({ action, outcome, requestId, classId, actor }) {
      audit.append({
        action, outcome, requestId,
        classId: classrooms.has(classId) ? classId : undefined,
        actor: actor ? createHmac('sha256', auditKey).update(actor.subject).digest('hex') : undefined
      });
    }
  };
}

export function loadProtectedProfile(configFile, { engine, agent, storeKeyText, auditKeyText }) {
  if (!configFile) throw new Error('请设置 CLASSROOM_SECURITY_CONFIG。');
  const filename = resolve(configFile);
  const directory = dirname(filename);
  const config = JSON.parse(readFileSync(filename, 'utf8'));
  const read = field => readFileSync(configPath(directory, config[field]));
  const access = createProtectedAccess({ ...config, now: Date.now, publicKey: read('publicKeyFile').toString('utf8') });
  const storeKey = parseKey(storeKeyText, 'CLASSROOM_STORE_KEY');
  const auditKey = parseKey(auditKeyText, 'CLASSROOM_AUDIT_KEY');
  if (timingSafeEqual(storeKey, auditKey)) throw new Error('数据密钥与审计密钥须分别配置。');
  const dataDirectory = configPath(directory, config.dataDirectory);
  const classIds = new Set(config.memberships.map(member => member.classId));
  if ([...classIds].some(classId => !isSecurityIdentifier(classId))) throw new Error('班级编号须以字母或数字开头。');
  const classrooms = new Map([...classIds].map(classId => [classId, createClassroom({
    filePath: resolve(dataDirectory, `${classId}.sealed.json`),
    protection: createStoreProtection({ key: storeKey, domain: `class:${classId}` }),
    engine, agent
  })]));
  const audit = createAuditLog({ filePath: resolve(dataDirectory, 'access-audit.json'), key: auditKey, domain: 'edu-access' });
  const tls = { key: read('tlsKeyFile'), cert: read('tlsCertFile'), minVersion: 'TLSv1.2' };
  return createProtectedProfile({ access, classrooms, defaultClass: config.defaultClass, audit, auditKey, tls });
}
