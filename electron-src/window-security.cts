const path = require('node:path');
const { BrowserWindow, shell } = require('electron');

function prepareRuntime(app, isSmokeTest) {
  if (!isSmokeTest) return;
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-software-rasterizer');
  app.commandLine.appendSwitch('no-sandbox');
  if (process.env.LEARNAGENT_SMOKE_USER_DATA) {
    app.setPath('userData', process.env.LEARNAGENT_SMOKE_USER_DATA);
    app.setPath('cache', path.join(process.env.LEARNAGENT_SMOKE_USER_DATA, 'cache'));
  }
}

function createSecureWindow({ app, baseDir, isDev, isSmokeTest }) {
  const win = new BrowserWindow({
    show: !isSmokeTest,
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    title: 'LearnAgent',
    backgroundColor: '#f4f1ea',
    webPreferences: {
      preload: path.join(baseDir, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  if (isSmokeTest) {
    win.webContents.on('console-message', (_event, details) => {
      console.error(`Renderer console: ${details?.message || JSON.stringify(details)}`);
    });
    win.webContents.on('render-process-gone', (_event, details) => {
      console.error(`Renderer process gone: ${JSON.stringify(details)}`);
    });
  }

  if (isDev && !isSmokeTest) void win.loadURL('http://127.0.0.1:5173');
  else void win.loadFile(path.join(baseDir, '../dist/index.html'));

  win.webContents.setWindowOpenHandler(({ url }) => {
    const external = safeExternalUrl(url);
    if (external) void shell.openExternal(external);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, targetUrl) => {
    try {
      if (new URL(targetUrl).origin === new URL(win.webContents.getURL()).origin) return;
    } catch {
      // Invalid navigation stays blocked.
    }
    event.preventDefault();
  });
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));

  if (isSmokeTest) attachSmokeAssertions(app, win);
  return win;
}

function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'mailto:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function attachSmokeAssertions(app, win) {
  const fail = (message) => {
    console.error(`Electron smoke failed: ${message}`);
    app.exit(1);
  };
  win.webContents.once('did-fail-load', (_event, code, description) => fail(`${code} ${description}`));
  win.webContents.once('did-finish-load', async () => {
    try {
      const result = await win.webContents.executeJavaScript(`new Promise((resolve) => {
        const started = Date.now();
        const inspect = () => {
          const state = {
            hasRoot: Boolean(document.querySelector('#root')?.childElementCount),
            hasBridge: typeof window.learnAgent?.loadSnapshot === 'function',
            title: document.title
          };
          if (state.hasRoot || Date.now() - started > 5000) resolve(state);
          else setTimeout(inspect, 50);
        };
        inspect();
      })`);
      if (!result.hasRoot || !result.hasBridge || result.title !== 'LearnAgent') fail(JSON.stringify(result));
      else app.exit(0);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
  });
}

module.exports = { createSecureWindow, prepareRuntime, safeExternalUrl };
