import { createCipheriv, createDecipheriv, createSecretKey, randomBytes, randomUUID } from 'node:crypto';
import { closeSync, fstatSync, fsyncSync, mkdirSync, openSync, readSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const version = 1;
const algorithm = 'aes-256-gcm';
const nonceBytes = 12;
const tagBytes = 16;
const maximumPlaintextBytes = 2 * 1024 * 1024;
export const maximumSealedBytes = Math.ceil(maximumPlaintextBytes * 4 / 3) + 256;

export function isSecurityIdentifier(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/.test(value);
}

export function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function protectionKey(key, domain) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new TypeError('保护密钥必须为 32 字节。');
  if (!isSecurityIdentifier(domain)) throw new TypeError('需要有效的保护域。');
  return createSecretKey(key);
}

export function decodeProtectionToken(value, size) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new Error('编码格式无效。');
  }
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value || (size !== undefined && decoded.length !== size)) {
    throw new Error('编码长度或格式无效。');
  }
  return decoded;
}

function serializeRecord(value) {
  if (!isRecord(value)) throw new TypeError('只支持保存 JSON 对象。');
  const serialized = JSON.stringify(value);
  if (typeof serialized !== 'string') {
    throw new TypeError('只支持保存 JSON 对象。');
  }
  if (Buffer.byteLength(serialized) > maximumPlaintextBytes) throw new Error('课堂存储已达到容量上限。');
  if (!isRecord(JSON.parse(serialized))) throw new TypeError('只支持保存 JSON 对象。');
  return serialized;
}

function readEnvelope(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > maximumSealedBytes) throw new Error('密文大小无效。');
  const value = JSON.parse(text);
  if (!isRecord(value) || Object.keys(value).length !== 4 || value.version !== version) {
    throw new Error('密文版本或结构无效。');
  }
  const iv = decodeProtectionToken(value.iv, nonceBytes);
  const tag = decodeProtectionToken(value.tag, tagBytes);
  const ciphertext = decodeProtectionToken(value.ciphertext);
  if (ciphertext.length > maximumPlaintextBytes) throw new Error('密文大小无效。');
  return { iv, tag, ciphertext };
}

export function createStoreProtection({ key, domain } = {}) {
  const secret = protectionKey(key, domain);
  const context = Buffer.from(JSON.stringify(['edu-promaic/classroom-store', version, domain]));
  return {
    seal(value) {
      const serialized = serializeRecord(value);
      const iv = randomBytes(nonceBytes);
      const cipher = createCipheriv(algorithm, secret, iv, { authTagLength: tagBytes });
      cipher.setAAD(context);
      const ciphertext = Buffer.concat([cipher.update(serialized, 'utf8'), cipher.final()]);
      return JSON.stringify({
        version, iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'),
        ciphertext: ciphertext.toString('base64url')
      });
    },
    open(text) {
      try {
        const { iv, tag, ciphertext } = readEnvelope(text);
        const decipher = createDecipheriv(algorithm, secret, iv, { authTagLength: tagBytes });
        decipher.setAAD(context);
        decipher.setAuthTag(tag);
        const cleartext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        const value = JSON.parse(cleartext.toString('utf8'));
        if (!isRecord(value)) throw new Error('课堂存储结构无效。');
        return value;
      } catch {
        throw new Error('课堂存储校验失败。');
      }
    }
  };
}

export function readBoundedFile(filePath, maximumBytes) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) throw new TypeError('请指定有效的文件容量上限。');
  const file = openSync(filePath, 'r');
  try {
    const stat = fstatSync(file);
    if (!stat.isFile() || stat.size > maximumBytes) throw new Error('文件类型或大小超出保护范围。');
    const buffer = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const read = readSync(file, buffer, offset, buffer.length - offset, null);
      if (read === 0) break;
      offset += read;
    }
    if (offset !== stat.size) throw new Error('文件在读取过程中发生变化。');
    return buffer.subarray(0, offset).toString('utf8');
  } finally {
    closeSync(file);
  }
}

export function replacePrivateFile(filePath, text) {
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  const stagingPath = `${filePath}.${randomUUID()}.tmp`;
  const stagingFile = openSync(stagingPath, 'wx', 0o600);
  try {
    try {
      writeFileSync(stagingFile, text, 'utf8');
      fsyncSync(stagingFile);
    } finally {
      closeSync(stagingFile);
    }
    renameSync(stagingPath, filePath);
  } catch (error) {
    try {
      rmSync(stagingPath, { force: true });
    } catch {
      // 保留原始写入错误。
    }
    throw error;
  }
}
