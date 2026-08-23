import { spawn } from 'child_process';
import * as path from 'path';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';

async function main(): Promise<void> {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, '../..');
    const extensionTestsPath = path.resolve(__dirname, './suite/index.js');
    const vscodeExecutablePath = await downloadAndUnzipVSCode({ version: '1.105.0' });
    const cliPath = path.resolve(path.dirname(vscodeExecutablePath), 'bin', 'code');
    const cachePath = path.resolve(extensionDevelopmentPath, '.vscode-test');

    const args = [
      '--no-sandbox',
      '--disable-gpu-sandbox',
      '--disable-updates',
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-workspace-trust',
      `--extensionTestsPath=${extensionTestsPath}`,
      `--extensionDevelopmentPath=${extensionDevelopmentPath}`,
      `--extensions-dir=${path.join(cachePath, 'extensions')}`,
      `--user-data-dir=${path.join(cachePath, 'user-data')}`
    ];

    const env = { ...process.env };
    delete env.VSCODE_IPC_HOOK_CLI;

    const exitCode = await new Promise<number>((resolve, reject) => {
      const child = spawn(cliPath, args, {
        env,
        stdio: 'inherit'
      });
      child.on('error', reject);
      child.on('close', (code) => resolve(code ?? 1));
    });

    if (exitCode !== 0) {
      process.exit(exitCode);
    }
  } catch (error) {
    console.error('Integration tests failed:', error);
    process.exit(1);
  }
}

void main();
