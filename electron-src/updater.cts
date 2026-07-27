function createUpdateManager({
  app,
  getMainWindow,
  autoUpdater: providedAutoUpdater,
  isEnabled = app.isPackaged && process.env.LEARNAGENT_SMOKE !== '1'
}) {
  const autoUpdater = providedAutoUpdater || require('electron-updater').autoUpdater;
  let initialized = false;
  let checking = null;
  let downloading = null;
  let state = isEnabled
    ? { status: 'idle', message: '将在后台自动检查更新' }
    : { status: 'disabled', message: '自动更新仅在正式安装版中启用' };

  function publish(patch) {
    state = { ...state, ...patch };
    const window = getMainWindow();
    if (window && !window.isDestroyed()) {
      window.webContents.send('app:update-status', state);
    }
    return state;
  }

  function initialize() {
    if (initialized || !isEnabled) return;
    initialized = true;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;

    autoUpdater.on('checking-for-update', () => {
      publish({ status: 'checking', message: '正在检查新版本', percent: undefined });
    });
    autoUpdater.on('update-available', (info) => {
      publish({
        status: 'available',
        version: String(info?.version || ''),
        message: `发现新版本 v${info?.version || ''}，点击更新后将在后台下载`,
        percent: undefined
      });
    });
    autoUpdater.on('update-not-available', () => {
      publish({
        status: 'up-to-date',
        version: app.getVersion(),
        message: '当前已是最新版本',
        percent: undefined
      });
    });
    autoUpdater.on('download-progress', (progress) => {
      const percent = Math.max(0, Math.min(100, Number(progress?.percent) || 0));
      publish({
        status: 'downloading',
        message: `正在下载更新 ${Math.round(percent)}%`,
        percent
      });
    });
    autoUpdater.on('update-downloaded', (info) => {
      publish({
        status: 'downloaded',
        version: String(info?.version || ''),
        message: `v${info?.version || ''} 已准备好，重启后即可完成更新`,
        percent: 100
      });
    });
    autoUpdater.on('error', (error) => {
      const detail = error instanceof Error ? error.message : String(error || '未知错误');
      publish({
        status: 'error',
        message: `检查更新失败：${detail.slice(0, 240)}`,
        percent: undefined
      });
    });
  }

  async function checkForUpdates() {
    if (!isEnabled) return state;
    initialize();
    if (checking) return checking;
    checking = autoUpdater.checkForUpdates()
      .then(() => state)
      .catch((error) => {
        const detail = error instanceof Error ? error.message : String(error || '未知错误');
        return publish({
          status: 'error',
          message: `检查更新失败：${detail.slice(0, 240)}`,
          percent: undefined
        });
      })
      .finally(() => {
        checking = null;
      });
    return checking;
  }

  async function downloadUpdate() {
    if (!isEnabled) return { ok: false, state };
    if (state.status === 'downloaded') return { ok: true, state };
    if (state.status !== 'available' && state.status !== 'downloading') {
      return { ok: false, state, message: '当前没有可下载的新版本' };
    }
    if (downloading) return downloading;
    publish({ status: 'downloading', message: '正在后台下载更新 0%', percent: 0 });
    downloading = autoUpdater.downloadUpdate()
      .then(() => ({ ok: true, state }))
      .catch((error) => {
        const detail = error instanceof Error ? error.message : String(error || '未知错误');
        const nextState = publish({
          status: 'error',
          message: `下载更新失败：${detail.slice(0, 240)}`,
          percent: undefined
        });
        return { ok: false, state: nextState, message: nextState.message };
      })
      .finally(() => {
        downloading = null;
      });
    return downloading;
  }

  function installUpdate() {
    if (state.status !== 'downloaded') {
      return { ok: false, message: '更新尚未下载完成' };
    }
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return { ok: true };
  }

  function scheduleAutomaticCheck(delayMs = 3000) {
    if (!isEnabled) return;
    const timer = setTimeout(() => void checkForUpdates(), delayMs);
    timer.unref?.();
  }

  return {
    initialize,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
    scheduleAutomaticCheck,
    getState: () => state
  };
}

module.exports = { createUpdateManager };
