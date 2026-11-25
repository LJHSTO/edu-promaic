import { parseArgs } from 'node:util';
import { backupClassrooms, restoreClassrooms, verifyClassroomBackup } from '../code/backend/classroom-backup.js';
import { parseClassroomKeys, readBoundedFile, readOperationalKeyText } from '../code/backend/classroom-protection.js';

function readAuditOptions({ 'audit-from': auditFile, checkpoint: checkpointFile }, command) {
  if (auditFile === undefined && checkpointFile === undefined) return undefined;
  if (command !== 'restore' || !auditFile || !checkpointFile) {
    throw new Error('仅 restore 可同时使用 --audit-from 和 --checkpoint 保留当前审计。');
  }
  return { auditFile, checkpoint: JSON.parse(readBoundedFile(checkpointFile, 4096)) };
}

function parseCommand(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { 'audit-from': { type: 'string' }, checkpoint: { type: 'string' } }
  });
  const [command, source, destination] = positionals;
  const arity = { backup: 3, restore: 3, verify: 2 };
  if (arity[command] !== positionals.length || positionals.some(value => value === '')) {
    throw new Error('用法：node scripts/classroom-backup.js backup 源目录 新备份目录 | verify 备份目录 | restore 备份目录 新恢复目录');
  }
  return { command, source, destination, audit: readAuditOptions(values, command) };
}

function run(args) {
  const { command, source, destination, audit } = parseCommand(args);
  const keys = parseClassroomKeys(
    readOperationalKeyText(process.env, 'CLASSROOM_STORE_KEY'),
    readOperationalKeyText(process.env, 'CLASSROOM_AUDIT_KEY')
  );
  if (command === 'backup') return backupClassrooms(source, destination, keys);
  if (command === 'restore') return restoreClassrooms(source, destination, keys, audit);
  return verifyClassroomBackup(source, keys);
}

try {
  console.log(JSON.stringify(run(process.argv.slice(2))));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
