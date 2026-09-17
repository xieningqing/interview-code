import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electron', {
  minimize: () => ipcRenderer.send('minimize-window'),
  maximize: () => ipcRenderer.send('maximize-window'),
  close: () => ipcRenderer.send('close-window'),
  quit: () => ipcRenderer.send('quit-app'),
  
  takeScreenshot: () => ipcRenderer.invoke('take-screenshot'),
  processScreenshots: () => ipcRenderer.invoke('process-screenshots'),
  resetQueue: () => ipcRenderer.invoke('reset-queue'),
  
  toggleVisibility: () => ipcRenderer.send('toggle-visibility'),
  
  onProcessingComplete: (callback: (result: string) => void) => {
    ipcRenderer.on('processing-complete', (_, result) => callback(result));
  },
  onProcessingStream: (callback: (delta: string) => void) => {
    ipcRenderer.on('processing-stream', (_, delta) => callback(delta));
  },
  onProcessingReasoning: (callback: (delta: string) => void) => {
    ipcRenderer.on('processing-reasoning', (_, delta) => callback(delta));
  },
  onProcessingRestart: (callback: () => void) => {
    ipcRenderer.on('processing-restart', () => callback());
  },
  onResultPageCommand: (callback: (direction: 'previous' | 'next') => void) => {
    ipcRenderer.on('result-page-command', (_, direction) => callback(direction));
  },
  onScreenshotTaken: (callback: (data: any) => void) => {
    ipcRenderer.on('screenshot-taken', (_, data) => callback(data));
  },
  onProcessingStarted: (callback: () => void) => {
    ipcRenderer.on('processing-started', () => callback());
  },
  onQueueReset: (callback: () => void) => {
    ipcRenderer.on('queue-reset', () => callback());
  },

  // Keyboard protection methods
  keyboardProtection: {
    enable: () => ipcRenderer.invoke('keyboard-protection-enable'),
    disable: () => ipcRenderer.invoke('keyboard-protection-disable'),
    getStatus: () => ipcRenderer.invoke('keyboard-protection-status'),
    getShortcuts: () => ipcRenderer.invoke('keyboard-protection-get-shortcuts'),
    updateShortcuts: (shortcuts: any) => ipcRenderer.invoke('keyboard-protection-update-shortcuts', shortcuts),
  }
});
