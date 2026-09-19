const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mixxxLrc', {
  fetchJson: (url) => ipcRenderer.invoke('fetch-json', url),
  coverArt: (filePath) => ipcRenderer.invoke('cover-art', filePath),
  seekMixxx: (baseUrl, seconds) => ipcRenderer.invoke('seek-mixxx', baseUrl, seconds),
  pickDirectory: () => ipcRenderer.invoke('pick-directory'),
  scanDirectory: (dirPath) => ipcRenderer.invoke('scan-directory', dirPath),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  midiPorts: () => ipcRenderer.invoke('midi-ports'),
  connectMidi: (inputName, outputName) => ipcRenderer.invoke('midi-connect', inputName, outputName),
  disconnectMidi: () => ipcRenderer.invoke('midi-disconnect'),
  sendMidi: (payload) => ipcRenderer.invoke('midi-send', payload),
  onMixxxBridgeMessage: (callback) => ipcRenderer.on('mixxx-bridge-message', (_event, payload) => callback(payload)),
});