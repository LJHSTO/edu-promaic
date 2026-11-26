import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const directories = ['code', 'tests', 'docs/software/prototype', 'docs/software/walkthrough', 'scripts'];
for (const directory of directories) {
  const files = readdirSync(directory, { recursive: true, withFileTypes: true });
  for (const file of files) {
    if (!file.isFile() || !/\.(?:c|m)?js$/.test(file.name)) continue;
    const result = spawnSync(process.execPath, ['--check', join(file.parentPath, file.name)], { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exitCode = 1;
  }
}
