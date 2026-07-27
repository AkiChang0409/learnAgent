import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createUpdateManager } = require('../electron-dist/updater.cjs');

class FakeUpdater extends EventEmitter {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  allowPrerelease = true;
  checkForUpdates = vi.fn(async () => undefined);
  downloadUpdate = vi.fn(async () => []);
  quitAndInstall = vi.fn();
}

describe('desktop updater', () => {
  let autoUpdater: FakeUpdater;
  let sent: Array<{ channel: string; state: Record<string, unknown> }>;

  beforeEach(() => {
    autoUpdater = new FakeUpdater();
    sent = [];
  });

  function createManager(isEnabled = true) {
    return createUpdateManager({
      app: { isPackaged: true, getVersion: () => '1.0.5' },
      isEnabled,
      autoUpdater,
      getMainWindow: () => ({
        isDestroyed: () => false,
        webContents: {
          send: (channel: string, state: Record<string, unknown>) => sent.push({ channel, state })
        }
      })
    });
  }

  it('tracks update download progress and allows installation when ready', async () => {
    const manager = createManager();
    manager.initialize();

    autoUpdater.emit('update-available', { version: '1.1.0' });
    expect(manager.getState()).toMatchObject({ status: 'available', version: '1.1.0' });
    expect(autoUpdater.autoDownload).toBe(false);

    autoUpdater.downloadUpdate.mockImplementation(async () => {
      autoUpdater.emit('download-progress', { percent: 42.4 });
      autoUpdater.emit('update-downloaded', { version: '1.1.0' });
      return [];
    });
    await expect(manager.downloadUpdate()).resolves.toMatchObject({ ok: true });

    expect(manager.getState()).toMatchObject({
      status: 'downloaded',
      version: '1.1.0',
      percent: 100
    });
    expect(autoUpdater.downloadUpdate).toHaveBeenCalledOnce();
    expect(sent.at(-1)?.channel).toBe('app:update-status');
    expect(manager.installUpdate()).toEqual({ ok: true });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it('does not contact the update service in development builds', async () => {
    const manager = createManager(false);

    await expect(manager.checkForUpdates()).resolves.toMatchObject({ status: 'disabled' });
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
    await expect(manager.downloadUpdate()).resolves.toMatchObject({ ok: false });
    expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled();
    expect(manager.installUpdate()).toMatchObject({ ok: false });
  });
});
