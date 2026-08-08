const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const { spawn } = require('node:child_process')

let companion
function createWindow() {
  const win = new BrowserWindow({ width: 1280, height: 840, minWidth: 900, minHeight: 650, backgroundColor: '#f2efe5', title: "Bigfoot's Day", autoHideMenuBar: true, webPreferences: { contextIsolation: true, sandbox: true } })
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
}

app.whenReady().then(() => {
  companion = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.mjs')], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', BIGFOOT_DATA_DIR: app.getPath('userData') }, stdio: 'ignore' })
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('before-quit', () => companion?.kill())
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
