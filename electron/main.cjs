const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');

// このアプリはアニメーションの少ない単純なフォームUIで、GPU描画を必要としない。
// GPUプロセスを起動しないことでメモリ使用量を抑える(WindowsではGPUの
// シェーダーキャッシュ書き込みに失敗する環境もあり、その回避にもなる)。
app.disableHardwareAcceleration();

let mainWindow;
let orchestrator;
let quitting = false;

function setupPackagedPaths() {
  if (!app.isPackaged) return;
  const userData = app.getPath('userData');
  process.env.TEIKI_PROFILE_DIR = path.join(userData, 'profile');
  process.env.TEIKI_OUT_DIR = path.join(userData, 'out');
  process.env.TEIKI_LOGS_DIR = path.join(userData, 'logs');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    title: '定期おトク便かんたん解約',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  if (!app.isPackaged) {
    mainWindow.webContents.on('console-message', (_event, _level, message) => {
      console.log('[renderer]', message);
    });
    mainWindow.webContents.on('render-process-gone', (_event, details) => {
      console.error('[renderer crashed]', details);
    });
  }

  mainWindow.on('close', (e) => {
    // 実行中の解約がある場合に備え、確定前は誤って閉じられないよう
    // レンダラー側に確認を委ねる（レンダラーが確認UIを出し、続行してよければ
    // teiki:force-quit を呼ぶ。それが __forceClose を立ててから再度 close() する）。
    if (mainWindow.__busy && !mainWindow.__forceClose) {
      e.preventDefault();
      mainWindow.webContents.send('teiki:close-requested');
    }
  });
}

function registerIpcHandlers() {
  ipcMain.handle('teiki:get-list', async (_event, opts) => {
    try {
      const r = await orchestrator.getList({ headless: !!opts?.headless });
      return r;
    } catch (err) {
      return {
        ok: false,
        reason: 'launch-failed',
        kind: err.classified?.kind ?? 'chrome-missing',
        message: err.message,
      };
    }
  });

  ipcMain.handle('teiki:start-login', async () => {
    try {
      return await orchestrator.startLogin((status) => {
        mainWindow.webContents.send('teiki:login-status', status);
      });
    } catch (err) {
      return {
        ok: false,
        reason: 'launch-failed',
        kind: err.classified?.kind ?? 'chrome-missing',
        message: err.message,
      };
    }
  });

  ipcMain.handle('teiki:run-plan', async (_event, { entries, dryRun, headless }) => {
    mainWindow.__busy = true;
    try {
      const r = await orchestrator.runPlan(entries, { dryRun, headless: !!headless }, (progress) => {
        mainWindow.webContents.send('teiki:run-progress', progress);
      });
      if (!r.ok) {
        return { ok: false, reason: r.reason, currentUrl: r.currentUrl };
      }
      const logFile = orchestrator.writeLog('manage', dryRun, r.results);
      return { ok: true, results: r.results, logFile };
    } catch (err) {
      return { ok: false, message: err.message };
    } finally {
      mainWindow.__busy = false;
    }
  });

  ipcMain.handle('teiki:reset-browser', async () => {
    await orchestrator.closeSession();
    return { ok: true };
  });

  ipcMain.handle('teiki:open-chrome-download', () => {
    shell.openExternal('https://www.google.com/chrome/');
  });

  ipcMain.handle('teiki:open-logs-folder', () => {
    shell.openPath(orchestrator.LOGS_DIR);
  });

  ipcMain.handle('teiki:open-out-folder', () => {
    shell.openPath(orchestrator.OUT_DIR);
  });

  ipcMain.handle('teiki:force-quit', () => {
    mainWindow.__busy = false;
    mainWindow.__forceClose = true;
    mainWindow.close();
  });
}

app.whenReady().then(async () => {
  setupPackagedPaths();
  orchestrator = await import('./orchestrator.js');
  createWindow();
  registerIpcHandlers();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async (e) => {
  if (quitting) return;
  quitting = true;
  if (orchestrator) {
    e.preventDefault();
    await orchestrator.closeSession();
    app.quit();
  }
});
