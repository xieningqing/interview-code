import { app, BrowserWindow, ipcMain, globalShortcut } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import openaiService from './services/openai';

const execFileAsync = promisify(execFile);

interface Screenshot {
  id: number;
  preview: string;
  path: string;
}

let mainWindow: BrowserWindow | null = null;
let screenshotQueue: Screenshot[] = [];
let isProcessing = false;
let processingRunId = 0;
let hasCompletedResult = false;
const MAX_SCREENSHOTS = 4;
const SCREENSHOT_DIR = path.join(app.getPath('temp'), 'screenshots');

async function ensureScreenshotDir() {
  try {
    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  } catch (error) {
    console.error('Error creating screenshot directory:', error);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 1000,
    frame: false,           
    transparent: true,     
    backgroundColor: "#00000000",  
    hasShadow: false,    
    alwaysOnTop: true,
    focusable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  
  mainWindow.setSkipTaskbar(true);
  mainWindow.setIgnoreMouseEvents(true, { forward: true });


  // Open DevTools by default in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // Register DevTools shortcut
  globalShortcut.register('CommandOrControl+Shift+I', () => {
    if (mainWindow) {
      mainWindow.webContents.toggleDevTools();
    }
  });

  // Enable content protection to prevent screen capture
  mainWindow.setContentProtection(true);
  mainWindow.setAlwaysOnTop(true, 'screen-saver');

  // Platform specific enhancements for macOS
  if (process.platform === 'darwin') {
    mainWindow.setHiddenInMissionControl(true);
    mainWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true
    });
    mainWindow.setAlwaysOnTop(true, "floating");
  }

  
  // Load the index.html file from the dist directory
  mainWindow.loadFile(path.join(__dirname, '../dist/renderer/index.html'));

  // Register global shortcuts
  registerShortcuts();
}

function registerShortcuts() {
  const register = (accelerator: string, callback: () => void) => {
    try {
      const registered = globalShortcut.register(accelerator, callback);
      if (!registered) {
        console.warn(`Failed to register shortcut: ${accelerator}`);
      }
    } catch (error) {
      console.warn(`Failed to register shortcut: ${accelerator}`, error);
    }
  };

  // Screenshot & Processing shortcuts
  register('CommandOrControl+H', handleTakeScreenshot);
  register('CommandOrControl+Enter', handleProcessScreenshots);
  register('CommandOrControl+R', handleResetQueue);
  register('CommandOrControl+Q', () => app.quit());
  
  // Window visibility
  register('CommandOrControl+B', handleToggleVisibility);
  
  // Window movement before results, page navigation after results.
  register('CommandOrControl+Left', () => handleHorizontalShortcut('left'));
  register('CommandOrControl+Right', () => handleHorizontalShortcut('right'));
  register('CommandOrControl+,', () => handleHorizontalShortcut('left'));
  register('CommandOrControl+.', () => handleHorizontalShortcut('right'));
  register('CommandOrControl+Shift+,', () => handleHorizontalShortcut('left'));
  register('CommandOrControl+Shift+.', () => handleHorizontalShortcut('right'));
  register('CommandOrControl+Up', () => moveWindow('up'));
  register('CommandOrControl+Down', () => moveWindow('down'));

}

async function captureScreenshot(): Promise<Buffer> {
  if (process.platform === 'darwin') {
    const tmpPath = path.join(SCREENSHOT_DIR, `${Date.now()}.png`);
    await execFileAsync('screencapture', ['-x', tmpPath]);
    const buffer = await fs.readFile(tmpPath);
    await fs.unlink(tmpPath);
    return buffer;
  } else {
    // Windows implementation
    const tmpPath = path.join(SCREENSHOT_DIR, `${Date.now()}.png`);
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      Add-Type -AssemblyName System.Drawing
      $screen = [System.Windows.Forms.Screen]::PrimaryScreen
      $bitmap = New-Object System.Drawing.Bitmap $screen.Bounds.Width, $screen.Bounds.Height
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      $graphics.CopyFromScreen($screen.Bounds.X, $screen.Bounds.Y, 0, 0, $bitmap.Size)
      $bitmap.Save('${tmpPath.replace(/\\/g, "\\\\")}')
      $graphics.Dispose()
      $bitmap.Dispose()
    `;
    await execFileAsync('powershell', ['-command', script]);
    const buffer = await fs.readFile(tmpPath);
    await fs.unlink(tmpPath);
    return buffer;
  }
}

async function handleTakeScreenshot() {
  if (screenshotQueue.length >= MAX_SCREENSHOTS) return;

  try {
    // Hide window before taking screenshot
    mainWindow?.hide();
    await new Promise(resolve => setTimeout(resolve, 100));

    const buffer = await captureScreenshot();
    const id = Date.now();
    const screenshotPath = path.join(SCREENSHOT_DIR, `${id}.png`);
    
    await fs.writeFile(screenshotPath, buffer);
    const preview = `data:image/png;base64,${buffer.toString('base64')}`;
    
    const screenshot = { id, preview, path: screenshotPath };
    screenshotQueue.push(screenshot);
	

    mainWindow?.show();
    mainWindow?.webContents.send('screenshot-taken', screenshot);
  } catch (error) {
    console.error('Error taking screenshot:', error);
    mainWindow?.show();
  }
}

async function handleProcessScreenshots() {
  if (isProcessing || screenshotQueue.length === 0) return;
  
  isProcessing = true;
  hasCompletedResult = false;
  const runId = ++processingRunId;
  mainWindow?.webContents.send('processing-started');

  try {
    const result = await openaiService.processScreenshots(screenshotQueue, {
      onTextDelta: (delta) => {
        if (!isProcessing || runId !== processingRunId) return;
        mainWindow?.webContents.send('processing-stream', delta);
      }
    });
    // Check if processing was cancelled
    if (!isProcessing || runId !== processingRunId) return;
    hasCompletedResult = true;
    mainWindow?.webContents.send('processing-complete', JSON.stringify(result));
  } catch (error: any) {
    console.error('Error processing screenshots:', error);
    // Check if processing was cancelled
    if (!isProcessing || runId !== processingRunId) return;
    
    // Extract the most relevant error message
    let errorMessage = 'Error processing screenshots';
    if (error?.error?.message) {
      errorMessage = error.error.message;
    } else if (error?.message) {
      errorMessage = error.message;
    }
    
    hasCompletedResult = true;
    mainWindow?.webContents.send('processing-complete', JSON.stringify({
      questionType: 'unknown',
      answer: '',
      explanation: '',
      error: errorMessage,
      approach: 'Error occurred while processing',
      code: 'Error: ' + errorMessage,
      timeComplexity: 'N/A',
      spaceComplexity: 'N/A'
    }));
  } finally {
    if (runId === processingRunId) {
      isProcessing = false;
    }
  }
}

async function handleResetQueue() {
  // Cancel any ongoing processing
  if (isProcessing) {
    isProcessing = false;
    processingRunId += 1;
    hasCompletedResult = false;
    mainWindow?.webContents.send('processing-complete', JSON.stringify({
      questionType: 'unknown',
      answer: '',
      explanation: 'Processing cancelled',
      approach: 'Processing cancelled',
      code: '',
      timeComplexity: '',
      spaceComplexity: ''
    }));
  }

  // Delete all screenshot files
  for (const screenshot of screenshotQueue) {
    try {
      await fs.unlink(screenshot.path);
    } catch (error) {
      console.error('Error deleting screenshot:', error);
    }
  }
  
  screenshotQueue = [];
  hasCompletedResult = false;
  mainWindow?.webContents.send('queue-reset');
}

function handleToggleVisibility() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
  }
}

function moveWindow(direction: 'left' | 'right' | 'up' | 'down') {
  if (!mainWindow) return;
  
  const [x, y] = mainWindow.getPosition();
  const moveAmount = 50;
  
  switch (direction) {
    case 'left':
      mainWindow.setPosition(x - moveAmount, y);
      break;
    case 'right':
      mainWindow.setPosition(x + moveAmount, y);
      break;
    case 'up':
      mainWindow.setPosition(x, y - moveAmount);
      break;
    case 'down':
      mainWindow.setPosition(x, y + moveAmount);
      break;
  }
}

function handleHorizontalShortcut(direction: 'left' | 'right') {
  if (!mainWindow) return;

  if (hasCompletedResult) {
    mainWindow.webContents.send('result-page-command', direction === 'left' ? 'previous' : 'next');
    return;
  }

  moveWindow(direction);
}

// This method will be called when Electron has finished initialization
app.whenReady().then(async () => {
  await ensureScreenshotDir();
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  handleResetQueue();
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// IPC Handlers
ipcMain.handle('take-screenshot', handleTakeScreenshot);
ipcMain.handle('process-screenshots', handleProcessScreenshots);
ipcMain.handle('reset-queue', handleResetQueue);

// Window control events
ipcMain.on('minimize-window', () => {
  mainWindow?.minimize();
});

ipcMain.on('maximize-window', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow?.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.on('close-window', () => {
  mainWindow?.close();
});

ipcMain.on('quit-app', () => {
  app.quit();
});

ipcMain.on('toggle-visibility', handleToggleVisibility);
