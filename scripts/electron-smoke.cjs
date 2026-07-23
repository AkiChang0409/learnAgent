const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const electronPath = require('electron');
const userDataPath = mkdtempSync(path.join(os.tmpdir(), 'learnagent-electron-smoke-'));

const child = spawn(electronPath, ['.'], {
  cwd: process.cwd(),
  env: { ...process.env, LEARNAGENT_SMOKE: '1', LEARNAGENT_SMOKE_USER_DATA: userDataPath },
  stdio: 'inherit',
  windowsHide: true
});

const timer = setTimeout(() => {
  console.error('Electron smoke timed out after 30 seconds');
  child.kill();
  process.exitCode = 1;
}, 30_000);

child.on('error', (error) => {
  clearTimeout(timer);
  rmSync(userDataPath, { recursive: true, force: true });
  console.error(error);
  process.exitCode = 1;
});

child.on('exit', (code) => {
  clearTimeout(timer);
  rmSync(userDataPath, { recursive: true, force: true });
  process.exitCode = code ?? 1;
});
