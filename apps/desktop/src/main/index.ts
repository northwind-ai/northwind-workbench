import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import {
  createMockRun,
  createRunner,
  type PackageHealthReport,
  type RunnerEvent,
  type WorkbenchRun,
} from '@package-workbench/core';
import { Channels } from '../shared/ipc';

/**
 * Main process = the privileged engine host. It owns all filesystem access and
 * the runner, and forwards runner events to the renderer. The renderer is fully
 * sandboxed (see createWindow webPreferences).
 *
 * For heavy scans the runner currently executes in this process; the documented
 * next step is to move it into a utilityProcess so the UI never blocks.
 */

// Currently loaded workspace. `null` => serve mock data.
let currentCwd: string | null = null;
let cache: WorkbenchRun = createMockRun();

function broadcast(event: RunnerEvent): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(Channels.progress, event);
}

async function scan(cwd: string): Promise<WorkbenchRun> {
  const runner = createRunner({ cwd });
  const off = runner.on(broadcast);
  try {
    cache = await runner.run();
    currentCwd = cwd;
    return cache;
  } finally {
    off();
  }
}

function registerIpc(): void {
  ipcMain.handle(Channels.getInitialRun, async () => cache);

  ipcMain.handle(Channels.openWorkspace, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open workspace',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return scan(result.filePaths[0]!);
  });

  ipcMain.handle(Channels.scan, async (_e: IpcMainInvokeEvent, path: string) => scan(path));

  ipcMain.handle(Channels.runAll, async () => (currentCwd ? scan(currentCwd) : (cache = createMockRun())));

  ipcMain.handle(Channels.runPackage, async (_e: IpcMainInvokeEvent, packageId: string): Promise<PackageHealthReport | null> => {
    if (!currentCwd) return cache.reports.find((r) => r.package.id === packageId) ?? null;

    const runner = createRunner({ cwd: currentCwd });
    const off = runner.on(broadcast);
    try {
      const { workspace, packages } = await runner.inspect();
      const pkg = packages.find((p) => p.id === packageId);
      if (!pkg) return null;
      const report = await runner.checkPackage(pkg, workspace);
      cache = { ...cache, reports: cache.reports.map((r) => (r.package.id === packageId ? report : r)) };
      return report;
    } finally {
      off();
    }
  });
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    title: 'Package Workbench',
    backgroundColor: '#f7f8fa',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    void win.loadURL(devUrl);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
