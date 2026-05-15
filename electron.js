const { app, BrowserWindow } = require('electron');
const { execFile } = require('child_process');
const path = require('path');

let mainWindow;
let serverProcess;
const NODE = path.join(process.env.HOME, '.nvm/versions/node/v22.22.0/bin/node');
const SERVER = path.join(__dirname, 'server.js');

function startServer() {
  return new Promise((resolve) => {
    // Use the system Node (not Electron's) so better-sqlite3 works
    serverProcess = execFile(NODE, [SERVER], {
      cwd: __dirname,
      env: Object.assign({}, process.env, {
        PATH: path.dirname(NODE) + ':/opt/homebrew/bin:/usr/local/bin:' + (process.env.PATH || '')
      })
    });

    serverProcess.stdout.on('data', (d) => {
      if (d.toString().includes('running at')) resolve();
    });
    serverProcess.stderr.on('data', (d) => process.stderr.write(d));

    setTimeout(resolve, 3000);
  });
}

app.whenReady().then(async () => {
  await startServer();

  mainWindow = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0a0e14',
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });

  mainWindow.loadURL('http://127.0.0.1:3333');
  mainWindow.setTitle('Visionary Mission Control');
  mainWindow.on('closed', () => { mainWindow = null; });
});

app.on('window-all-closed', () => {
  if (serverProcess) serverProcess.kill();
  app.quit();
});
app.on('before-quit', () => {
  if (serverProcess) serverProcess.kill();
});
