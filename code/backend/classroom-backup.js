import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { isSavedClassroom } from './classroom.js';
import { maximumAuditBytes, verifyAuditSnapshot } from './classroom-audit.js';
import {
  createStoreProtection, decodeProtectionToken, isRecord, maximumSealedBytes, protectionKey,
  readBoundedFile, replacePrivateFile
} from './classroom-protection.js';

const manifestName = 'manifest.json';
const auditName = 'access-audit.json';
const classSnapshot = /^([a-zA-Z0-9][a-zA-Z0-9_-]{0,63})\.sealed\.json$/;
const maximumManifestBytes = 256 * 1024;
const version = 1;
const backupDomain = 'edu-promaic/classroom-backup';

function readSnapshot(directory, name) {
  return readBoundedFile(join(directory, name), name === auditName ? maximumAuditBytes : maximumSealedBytes);
}

function validateSnapshot(name, text, { storeKey, auditKey }) {
  if (name === auditName) {
    verifyAuditSnapshot({ text, key: auditKey });
    return;
  }
  const classId = classSnapshot.exec(name)[1];
  const state = createStoreProtection({ key: storeKey, domain: `class:${classId}` }).open(text);
  if (!isSavedClassroom(state)) throw new Error(`班级记录结构无效：${classId}。`);
}

function snapshotNames(directory, bundle) {
  const names = readdirSync(directory, { withFileTypes: true }).map(entry => {
    const { name } = entry;
    const allowed = name === auditName || (bundle && name === manifestName) || classSnapshot.test(name);
    if (!entry.isFile() || !allowed) throw new Error('目录包含未识别的文件或链接。');
    return name;
  }).sort();
  if (!names.includes(auditName) || !names.some(name => classSnapshot.test(name))) {
    throw new Error('目录需要审计快照和至少一份班级密文。');
  }
  return names.filter(name => name !== manifestName);
}

function digest(text) {
  return createHash('sha256').update(text).digest('hex');
}

function collectFiles(directory, names, keys) {
  return names.map(name => {
    const text = readSnapshot(directory, name);
    validateSnapshot(name, text, keys);
    return { name, sha256: digest(text) };
  });
}

function manifestTag(files, key) {
  return createHmac('sha256', protectionKey(key, 'classroom-backup'))
    .update(JSON.stringify([backupDomain, version, files])).digest();
}

function encodeManifest(files, key) {
  const manifest = JSON.stringify({ version, files, tag: manifestTag(files, key).toString('base64url') });
  if (Buffer.byteLength(manifest) > maximumManifestBytes) throw new Error('备份清单超过容量上限。');
  return manifest;
}

function verifyManifest(directory, files, key) {
  const manifest = JSON.parse(readBoundedFile(join(directory, manifestName), maximumManifestBytes));
  if (!isRecord(manifest) || manifest.version !== version || Object.keys(manifest).length !== 3) {
    throw new Error('备份清单结构无效。');
  }
  if (JSON.stringify(manifest.files) !== JSON.stringify(files) ||
      !timingSafeEqual(decodeProtectionToken(manifest.tag, 32), manifestTag(files, key))) {
    throw new Error('备份文件或清单校验失败。');
  }
}

function ensureNamesUnchanged(directory, bundle, files) {
  const current = snapshotNames(directory, bundle);
  if (JSON.stringify(current) !== JSON.stringify(files.map(file => file.name))) {
    throw new Error('操作期间源目录发生变化。');
  }
}

function copyFiles(source, destination, files, { bundle, manifest }) {
  mkdirSync(destination, { mode: 0o700 });
  try {
    for (const { name, sha256 } of files) {
      const text = readSnapshot(source, name);
      if (digest(text) !== sha256) throw new Error('操作期间源记录发生变化。');
      replacePrivateFile(join(destination, name), text);
    }
    ensureNamesUnchanged(source, bundle, files);
    if (manifest) replacePrivateFile(join(destination, manifestName), manifest);
  } catch (error) {
    try {
      rmSync(destination, { recursive: true, force: true });
    } catch {
      // 保留原始文件错误，便于定位失败原因。
    }
    throw error;
  }
}

function verifiedFiles(directory, keys) {
  const files = collectFiles(directory, snapshotNames(directory, true), keys);
  verifyManifest(directory, files, keys.auditKey);
  return files;
}

function summary(files) {
  return { classrooms: files.length - 1, files: files.length };
}

export function backupClassrooms(source, destination, keys) {
  const files = collectFiles(source, snapshotNames(source, false), keys);
  copyFiles(source, destination, files, { bundle: false, manifest: encodeManifest(files, keys.auditKey) });
  return summary(files);
}

export function verifyClassroomBackup(directory, keys) {
  return summary(verifiedFiles(directory, keys));
}

export function restoreClassrooms(source, destination, keys) {
  const files = verifiedFiles(source, keys);
  copyFiles(source, destination, files, { bundle: true });
  return summary(files);
}
