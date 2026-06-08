const { app, BrowserWindow, nativeTheme } = require('electron');
const { execFile } = require('child_process');
const path = require('path');

let mainWindow;
let serverProcess;
// Resolve node binary: explicit override > NODE env > whatever's on PATH.
// Falls back to "node" so the host's launcher (PATH, nvm, brew) decides.
const NODE = process.env.VISIONARY_NODE || process.execPath || 'node';
const SERVER = path.join(__dirname, 'server.js');
const APP_URL = 'http://127.0.0.1:3333';

function startServer() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    serverProcess = execFile(NODE, [SERVER], {
      cwd: __dirname,
      env: Object.assign({}, process.env, {
        PATH: path.dirname(NODE) + ':/opt/homebrew/bin:/usr/local/bin:' + (process.env.PATH || '')
      })
    });

    serverProcess.stdout.on('data', (d) => {
      const text = d.toString();
      process.stdout.write(text);
      if (text.includes('running at')) finish();
    });
    serverProcess.stderr.on('data', (d) => process.stderr.write(d));
    serverProcess.on('error', finish);
    serverProcess.on('exit', finish);

    setTimeout(finish, 3000);
  });
}

function createWindow() {
  nativeTheme.themeSource = 'dark';

  mainWindow = new BrowserWindow({
    width: 1560,
    height: 980,
    minWidth: 1100,
    minHeight: 700,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0a0e14',
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.loadURL(APP_URL);
  mainWindow.setTitle('Visionary');
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  await startServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (serverProcess) serverProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => {
  if (serverProcess) serverProcess.kill();
});
