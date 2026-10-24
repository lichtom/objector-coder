const { contextBridge, ipcRenderer } = require('electron');

// 尝试加载 Node.js 内置模块（sandbox: false 时可用，沙箱环境降级为 null）
var __fs = null, __path = null, __os = null;
try { __fs = require('fs'); __path = require('path'); __os = require('os'); console.log('[preload] Node.js fs 可用 (sandbox:false)'); } catch (e) { console.log('[preload] Node.js fs 不可用 (sandbox), 将降级走 IPC'); }

contextBridge.exposeInMainWorld('api', {
  // 获取编辑器初始化数据（解决中文路径编码问题）
  getEditorInit: () => ipcRenderer.invoke('get-editor-init'),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  selectExtensionFile: () => ipcRenderer.invoke('select-extension-file'),
  selectImageFile: () => ipcRenderer.invoke('select-image-file'),
  selectAudioFile: () => ipcRenderer.invoke('select-audio-file'),
  copyFile: (src, dest) => ipcRenderer.invoke('copy-file', src, dest),
  readFileBinary: (p) => ipcRenderer.invoke('read-file-binary', p),
  openExtensionDocs: () => ipcRenderer.invoke('open-extension-docs'),
  openEditor: (projectPath, mode, renderMode) => ipcRenderer.invoke('open-editor', projectPath, mode, renderMode),
  readFile: (p) => ipcRenderer.invoke('read-file', p),
  writeFile: (p, c) => ipcRenderer.invoke('write-file', p, c),
  writeFileBinary: (p, c) => ipcRenderer.invoke('write-file-binary', p, c),
  ensureDir: (d) => ipcRenderer.invoke('ensure-dir', d),
  listDir: (d) => ipcRenderer.invoke('list-dir', d),
  isDir: (p) => ipcRenderer.invoke('is-dir', p),
  pathJoin: (...args) => ipcRenderer.invoke('path-join', ...args),
  deleteFile: (p) => ipcRenderer.invoke('delete-file', p),
  renameFolder: (oldPath, newPath) => ipcRenderer.invoke('rename-folder', oldPath, newPath),
  deleteFolder: (folderPath) => ipcRenderer.invoke('delete-folder', folderPath),
  saveFileDialog: (defaultName, filters) => ipcRenderer.invoke('save-file-dialog', defaultName, filters),
  readDirRecursive: (d) => ipcRenderer.invoke('read-dir-recursive', d),
  // 监听加载项目事件（编辑器窗口使用）
  onLoadProject: (callback) => ipcRenderer.on('load-project', (_e, path, mode, renderMode) => callback(path, mode, renderMode)),
  // 窗口控制
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  // 社区
  openCommunityLogin: () => ipcRenderer.invoke('open-community-login'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  // 添加节点子窗口（高级模式）
  openAddNodeDialog: (types) => ipcRenderer.invoke('open-add-node-dialog', types),
  // JS 代码编辑器窗口
  openJsEditor: (data) => ipcRenderer.invoke('open-js-editor', data),
  onJsEditorCodeUpdated: (callback) => ipcRenderer.on('js-editor-code-updated', (_e, spriteIdx, code) => callback(spriteIdx, code)),
  // 素材管理窗口
  openAssetManager: (options) => ipcRenderer.invoke('open-asset-manager', options),
  // 右键菜单 / 命令行打开项目
  onOpenProjectFromArgs: (callback) => ipcRenderer.on('open-project-from-args', (_e, folderPath) => callback(folderPath)),
  // 解压 ZIP 项目
  extractZipProject: (zipPath) => ipcRenderer.invoke('extract-zip-project', zipPath),
  // 运行代码（查找解释器/编译器）
  runCode: (lang, code, projectPath) => ipcRenderer.invoke('run-code', lang, code, projectPath),
  stopCode: () => ipcRenderer.invoke('stop-code'),
  sendCodeStdin: (text) => ipcRenderer.invoke('code-stdin', text),
  onCodeOutput: (callback) => ipcRenderer.on('code-output', (_e, text, type) => callback(text, type)),
  onCodeDone: (callback) => ipcRenderer.on('code-done', (_e, exitCode) => callback(exitCode)),

  // ========== AI 助手 ==========
  // 编辑器窗口调用：打开 AI 窗口
  openAIWindow: (initData) => ipcRenderer.invoke('open-ai-window', initData),
  openCmdWindow: () => ipcRenderer.invoke('open-cmd-window'),
  // AI 窗口调用：流式聊天
  aiStreamChat: (messages, modelId) => ipcRenderer.invoke('ai-stream-chat', messages, modelId),
  aiStopStream: () => ipcRenderer.invoke('ai-stop-stream'),
  // AI 窗口调用：执行工具
  aiExecuteTool: (name, args) => ipcRenderer.invoke('ai-execute-tool', name, args),
  aiToolResult: (toolId, result) => ipcRenderer.invoke('ai-tool-result', toolId, result),
  // AI 窗口调用：获取当前积木
  aiGetCurrentBlocks: () => ipcRenderer.invoke('ai-get-current-blocks'),
  // AI 窗口调用：配置
  getAIConfig: () => ipcRenderer.invoke('get-ai-config'),
  saveAIConfig: (cfg) => ipcRenderer.invoke('save-ai-config', cfg),
  // AI 窗口调用：在编辑器中执行代码
  aiExecuteCode: (code) => ipcRenderer.invoke('ai-execute-code', code),
  // AI 窗口调用：执行指令（>>> 命令）
  aiExecCmd: (cmd) => ipcRenderer.invoke('ai-exec-cmd', cmd),
  // 流式事件监听
  onAIStreamToken: (callback) => ipcRenderer.on('ai-stream-token', (_e, token) => callback(token)),
  onAIStreamDone: (callback) => ipcRenderer.on('ai-stream-done', (_e, fullText) => callback(fullText)),
  onAIStreamError: (callback) => ipcRenderer.on('ai-stream-error', (_e, error) => callback(error)),
  onAIToolCall: (callback) => ipcRenderer.on('ai-tool-call', (_e, tool) => callback(tool)),
  // AI 窗口接收数据
  onAIBlockCatalog: (callback) => ipcRenderer.on('ai-block-catalog', (_e, catalog) => callback(catalog)),
  onAICurrentBlocks: (callback) => ipcRenderer.on('ai-current-blocks', (_e, blocks) => callback(blocks)),
  // 编辑器窗口接收工具执行请求
  onAIExecuteTool: (callback) => ipcRenderer.on('ai-execute-tool', (_e, name, args) => callback(name, args)),
  aiToolExecResult: (result) => ipcRenderer.send('ai-tool-exec-result', result),
  // 编辑器窗口接收指令执行请求（>>> 命令）
  onAIExecCmd: (callback) => ipcRenderer.on('ai-exec-cmd', (_e, cmd) => callback(cmd)),
  aiCmdResult: (result) => ipcRenderer.send('ai-cmd-result', result),
  // 编辑器窗口接收积木请求
  onAIRequestBlocks: (callback) => ipcRenderer.on('ai-request-blocks', () => callback()),
  aiBlocksResponse: (blocks) => ipcRenderer.send('ai-blocks-response', blocks),

  // ========== micro:bit 串口 ==========
  microbitListPorts: () => ipcRenderer.invoke('microbit-list-ports'),
  microbitConnect: (port) => ipcRenderer.invoke('microbit-connect', port),
  microbitSend: (cmd) => ipcRenderer.invoke('microbit-send', cmd),
  microbitDisconnect: () => ipcRenderer.invoke('microbit-disconnect'),
  microbitFlash: (hexPath) => ipcRenderer.invoke('microbit-flash', hexPath),
  microbitFlashMain: () => ipcRenderer.invoke('microbit-flash-main'),
  microbitCompileFlash: (pyCode) => ipcRenderer.invoke('microbit-compile-flash', pyCode),

  // ========== 独立面板窗口 ==========
  openPanels: () => ipcRenderer.invoke('open-panels'),
  closePanels: () => ipcRenderer.invoke('close-panels'),
  showPanel: (type) => ipcRenderer.invoke('show-panel', type),
  sendPanelUpdate: (data) => ipcRenderer.send('panel-update', data),
  onPanelUpdate: (callback) => ipcRenderer.on('panel-update', (_e, data) => callback(data)),
  panelAction: (action, data) => ipcRenderer.send('panel-action', action, data),
  onPanelAction: (callback) => ipcRenderer.on('panel-action', (_e, action, data) => callback(action, data)),
  // 面板窗口控制
  panelSetAlwaysOnTop: (flag) => ipcRenderer.send('panel-set-always-on-top', flag),
  panelMinimize: () => ipcRenderer.send('panel-minimize'),
  panelMaximize: () => ipcRenderer.send('panel-maximize'),
  panelClose: () => ipcRenderer.send('panel-close'),
  // 面板输入：舞台窗口 → 编辑器
  panelInput: (type, data) => ipcRenderer.send('panel-input', type, data),
  onPanelInput: (callback) => ipcRenderer.on('panel-input', (_e, type, data) => callback(type, data)),
  // 打包游戏为 EXE
  getExportFileInfo: (opts) => ipcRenderer.invoke('get-export-file-info', opts),
  buildExe: (options) => new Promise((resolve, reject) => {
      var _timer = setTimeout(function() {
        resolve({ error: '打包超时（10分钟），请检查终端日志' });
      }, 600000);
      ipcRenderer.once('build-exe-result', function(_e, result) {
        clearTimeout(_timer);
        resolve(result);
      });
      ipcRenderer.send('build-exe', options);
    }),
  writeFileTemp: (filename, content) => ipcRenderer.invoke('write-file-temp', filename, content),
  // 直接写本地临时文件（sandbox:false 时用 Node.js fs 直写，否则降级走 IPC）
  writeFileTempLocal: (filename, content) => {
    if (__fs && __path && __os) {
      try {
        var tmpDir = __path.join(__os.tmpdir(), 'objector-export-tmp');
        __fs.mkdirSync(tmpDir, { recursive: true });
        var tmpPath = __path.join(tmpDir, filename);
        __fs.writeFileSync(tmpPath, content, 'utf-8');
        return Promise.resolve(tmpPath);
      } catch (e) {
        console.error('[writeFileTempLocal:fs]', e.message);
        return ipcRenderer.invoke('write-file-temp', filename, content);
      }
    }
    return ipcRenderer.invoke('write-file-temp', filename, content);
  },
  // 导出依赖检测与下载
  checkExportDeps: (opts) => ipcRenderer.invoke('check-export-deps', opts),
  downloadExportDeps: (opts) => ipcRenderer.invoke('download-export-deps', opts),
  onExportDepsProgress: (cb) => ipcRenderer.on('export-deps-progress', (_e, data) => cb(data)),
});
