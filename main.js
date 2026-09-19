const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const midi = require('@julusian/midi');

let mainWindow;
let bridgeInput;
let bridgeOutput;
let virtualInput;
let virtualOutput;
const VIRTUAL_PORT_NAME = 'Mixxx LRC Bridge';
const bridgeLogPath = path.join(app.getPath('userData'), 'mixxx-lrc-bridge.log');

function bridgeLog(message, details = '') {
  const line = `[${new Date().toISOString()}] ${message}${details ? ` ${details}` : ''}\n`;
  try {
    fs.mkdirSync(path.dirname(bridgeLogPath), { recursive: true });
    fs.appendFileSync(bridgeLogPath, line);
  } catch {
    // Diagnostics must never prevent the bridge from running.
  }
  console.log(`[mixxx-lrc] ${message}`, details);
}

function decodeBridgeMessage(message) {
  if (!Array.isArray(message) || message[0] !== 0xf0 || message[message.length - 1] !== 0xf7) {
    bridgeLog('ignored non-SysEx MIDI message', JSON.stringify(message));
    return null;
  }

  const chars = [];
  for (let index = 1; index < message.length - 1; index += 3) {
    chars.push(String.fromCharCode(message[index] | (message[index + 1] << 7) | (message[index + 2] << 14)));
  }

  try {
    const payload = JSON.parse(chars.join(''));
    bridgeLog('received bridge packet', JSON.stringify({ bytes: message.length, payload }));
    return payload;
  } catch {
    bridgeLog('failed to decode bridge packet', JSON.stringify({ bytes: message.length }));
    return null;
  }
}

function encodeBridgeMessage(payload) {
  const bytes = [0xf0];
  for (const character of JSON.stringify(payload)) {
    const code = character.charCodeAt(0);
    bytes.push(code & 0x7f, (code >> 7) & 0x7f, (code >> 14) & 0x7f);
  }
  bytes.push(0xf7);
  return bytes;
}

function midiPorts() {
  const input = new midi.Input();
  const output = new midi.Output();
  const ports = new Set();
  for (let index = 0; index < input.getPortCount(); index += 1) ports.add(input.getPortName(index));
  for (let index = 0; index < output.getPortCount(); index += 1) ports.add(output.getPortName(index));
  input.closePort();
  output.closePort();
  const result = [...ports];
  bridgeLog('enumerated MIDI ports', JSON.stringify(result));
  return result;
}

function closeMidiBridge() {
  if (bridgeInput && bridgeInput !== virtualInput) {
    bridgeInput.closePort();
  }
  if (bridgeOutput && bridgeOutput !== virtualOutput) {
    bridgeOutput.closePort();
  }
  bridgeInput = null;
  bridgeOutput = null;
}

function createVirtualMidiPorts() {
  if (virtualInput || virtualOutput) {
    return;
  }

  const input = new midi.Input();
  const output = new midi.Output();
  input.ignoreTypes(false, false, false);
  input.openVirtualPort(VIRTUAL_PORT_NAME);
  output.openVirtualPort(VIRTUAL_PORT_NAME);
  bridgeLog('created bidirectional virtual MIDI port', JSON.stringify({ port: VIRTUAL_PORT_NAME }));
  input.on('message', (_delta, message) => {
    const payload = decodeBridgeMessage(message);
    if (payload && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('mixxx-bridge-message', payload);
    }
  });
  virtualInput = input;
  virtualOutput = output;
}

function connectMidiBridge(inputName, outputName) {
  bridgeLog('bridge connection requested', JSON.stringify({ inputName, outputName }));
  createVirtualMidiPorts();
  closeMidiBridge();
  if (!inputName || !outputName || inputName?.includes(VIRTUAL_PORT_NAME) || outputName?.includes(VIRTUAL_PORT_NAME)) {
    bridgeInput = virtualInput;
    bridgeOutput = virtualOutput;
    bridgeLog('connected to virtual bridge ports');
    return true;
  }
  const input = new midi.Input();
  const output = new midi.Output();
  input.ignoreTypes(false, false, false);
  const inputIndex = Array.from({ length: input.getPortCount() }, (_, index) => index)
    .find((index) => input.getPortName(index) === inputName);
  const outputIndex = Array.from({ length: output.getPortCount() }, (_, index) => index)
    .find((index) => output.getPortName(index) === outputName);
  if (inputIndex === undefined || outputIndex === undefined) {
    input.closePort();
    output.closePort();
    bridgeInput = virtualInput;
    bridgeOutput = virtualOutput;
    if (bridgeInput && bridgeOutput) {
      bridgeLog('selected ports unavailable; fell back to virtual bridge ports');
      return true;
    }
    throw new Error('Selected MIDI bridge ports are unavailable.');
  }

  input.on('message', (_delta, message) => {
    const payload = decodeBridgeMessage(message);
    if (payload && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('mixxx-bridge-message', payload);
    }
  });
  input.openPort(inputIndex);
  output.openPort(outputIndex);
  bridgeInput = input;
  bridgeOutput = output;
  return true;
}

function sendMidiBridge(payload) {
  if (!bridgeOutput) {
    bridgeLog('cannot send bridge packet: no MIDI output is connected', JSON.stringify(payload));
    return false;
  }
  const message = encodeBridgeMessage(payload);
  bridgeOutput.sendMessage(message);
  bridgeLog('sent bridge packet', JSON.stringify({ bytes: message.length, payload }));
  return true;
}

function requestJson(rawUrl) {
  const url = new URL(rawUrl);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only HTTP and HTTPS URLs are supported.');
  }

  const client = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const request = client.get(url, {
      headers: { 'User-Agent': 'mixxx-lrc/1.0' },
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Request failed (${response.statusCode})`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error('The response was not valid JSON.'));
        }
      });
    });
    request.setTimeout(5000, () => request.destroy(new Error('Request timed out.')));
    request.on('error', reject);
  });
}

async function seekMixxx(rawBaseUrl, seconds) {
  if (!rawBaseUrl) {
    return false;
  }

  const baseUrl = rawBaseUrl.endsWith('/') ? rawBaseUrl.slice(0, -1) : rawBaseUrl;
  const endpoints = [
    `${baseUrl}/api/seek`,
    `${baseUrl}/api/v1/seek`,
    `${baseUrl}/api/v1/players/1/seek`,
    `${baseUrl}/seek`,
    `${baseUrl}/control/seek`,
  ];

  const payloads = [
    { seconds },
    { position: seconds },
    { value: seconds },
    { seek: seconds },
  ];

  for (const endpoint of endpoints) {
    for (const payload of payloads) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (response.ok) {
          return true;
        }
      } catch {
        // Try the next candidate endpoint.
      }
    }

    try {
      const response = await fetch(`${endpoint}?seconds=${seconds}`);
      if (response.ok) {
        return true;
      }
    } catch {
      // Continue trying other URLs.
    }
  }

  return false;
}

function createWindow() {
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 820,
    minHeight: 580,
    backgroundColor: '#101419',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile('index.html');
}

ipcMain.handle('fetch-json', (_event, url) => requestJson(url));
ipcMain.handle('seek-mixxx', (_event, rawBaseUrl, seconds) => seekMixxx(rawBaseUrl, seconds));
ipcMain.handle('cover-art', async (_event, filePath) => {
  if (!filePath) return '';
  try {
    const { parseFile } = await import('music-metadata');
    const metadata = await parseFile(filePath, { skipCovers: false });
    const picture = metadata.common.picture?.[0];
    if (!picture) return '';
    return `data:${picture.format};base64,${Buffer.from(picture.data).toString('base64')}`;
  } catch (error) {
    bridgeLog('cover art metadata failed', error.message);
    return '';
  }
});
ipcMain.handle('midi-ports', () => midiPorts());
ipcMain.handle('midi-connect', (_event, inputName, outputName) => connectMidiBridge(inputName, outputName));
ipcMain.handle('midi-disconnect', () => closeMidiBridge());
ipcMain.handle('midi-send', (_event, payload) => sendMidiBridge(payload));

async function pickDirectory() {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
    title: 'Select your music library folder',
  });

  if (result.canceled || !result.filePaths.length) {
    return null;
  }

  return result.filePaths[0];
}

function collectFiles(dirPath) {
  const items = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];

  for (const item of items) {
    const fullPath = path.join(dirPath, item.name);
    if (item.isDirectory()) {
      files.push(...collectFiles(fullPath));
    } else if (item.isFile()) {
      files.push({
        name: item.name,
        path: fullPath,
      });
    }
  }

  return files;
}

ipcMain.handle('pick-directory', () => pickDirectory());
ipcMain.handle('scan-directory', (_event, dirPath) => {
  if (!dirPath || !fs.existsSync(dirPath)) {
    return [];
  }

  return collectFiles(dirPath);
});
ipcMain.handle('read-file', (_event, filePath) => {
  if (!filePath || !fs.existsSync(filePath)) {
    return '';
  }

  return fs.readFileSync(filePath, 'utf8');
});

app.whenReady().then(() => {
  bridgeLog('Electron bridge process started', JSON.stringify({ platform: process.platform, logPath: bridgeLogPath }));
  createVirtualMidiPorts();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  closeMidiBridge();
  if (virtualInput) virtualInput.closePort();
  if (virtualOutput) virtualOutput.closePort();
  if (process.platform !== 'darwin') app.quit();
});