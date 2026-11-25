import { backupClassrooms, restoreClassrooms, verifyClassroomBackup } from '../code/backend/classroom-backup.js';
import { parseClassroomKeys, readOperationalKeyText } from '../code/backend/classroom-protection.js';

function run([command, source, destination, ...extra]) {
  const copies = command === 'backup' || command === 'restore';
  if (!source || extra.length || (copies ? !destination : command !== 'verify' || destination !== undefined)) {
    throw new Error('用法：node scripts/classroom-backup.js backup 源目录 新备份目录 | verify 备份目录 | restore 备份目录 新恢复目录');
  }
  const keys = parseClassroomKeys(
    readOperationalKeyText(process.env, 'CLASSROOM_STORE_KEY'),
    readOperationalKeyText(process.env, 'CLASSROOM_AUDIT_KEY')
  );
  if (command === 'backup') return backupClassrooms(source, destination, keys);
  if (command === 'restore') return restoreClassrooms(source, destination, keys);
  return verifyClassroomBackup(source, keys);
}

try {
  console.log(JSON.stringify(run(process.argv.slice(2))));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
