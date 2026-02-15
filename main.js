const { app, BrowserWindow } = require('electron');
const path = require('path');
const { server, PORT, HOST } = require('./lan-server.js');

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  // Load the local server URL
  win.loadURL(`http://localhost:${PORT}`);

  // win.webContents.openDevTools();
}

app.whenReady().then(() => {
  // Start the server
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Electron-hosted server running on http://localhost:${PORT}`);
    createWindow();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
