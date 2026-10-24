const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile, spawn } = require('child_process');

if (require('electron-squirrel-startup')) app.quit();

// ========== 跨平台辅助函数 ==========

/** 查找 micro:bit USB 驱动器 (Windows A-Z:, Linux /media/mnt, macOS /Volumes) */
function _findMicrobitDrives() {
  const drives = [];
  if (process.platform === 'win32') {
    for (let c = 65; c <= 90; c++) {
      const d = String.fromCharCode(c) + ':\\';
      try {
        const stats = fs.statSync(d);
        if (stats.isDirectory()) {
          try {
            const volLabel = fs.readFileSync(d + 'DETAILS.TXT', 'utf-8');
            if (volLabel && /micro/i.test(volLabel)) drives.push(d);
          } catch(e) {}
        }
      } catch(e) {}
    }
  } else {
    // Linux / macOS: 扫描常见挂载点
    const home = os.homedir();
    const candidates = [];
    if (process.platform === 'darwin') {
      candidates.push('/Volumes');
    } else {
      // Linux
      candidates.push('/media', '/mnt', '/run/media');
      // /run/media/<username>
      try {
        const mediaUser = path.join('/run/media', os.userInfo().username);
        if (fs.existsSync(mediaUser)) candidates.push(mediaUser);
      } catch {}
      // ~/media
      try {
        const userMedia = path.join(home, 'media');
        if (fs.existsSync(userMedia)) candidates.push(userMedia);
      } catch {}
    }
    for (const base of candidates) {
      try {
        const entries = fs.readdirSync(base, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const drivePath = path.join(base, entry.name);
          try {
            const detailsFile = path.join(drivePath, 'DETAILS.TXT');
            if (fs.existsSync(detailsFile)) {
              const volLabel = fs.readFileSync(detailsFile, 'utf-8');
              if (volLabel && /micro/i.test(volLabel)) drives.push(drivePath + path.sep);
            }
          } catch(e) {}
        }
      } catch(e) {}
    }
  }
  return drives;
}

const APP_ICON = path.join(__dirname, '..', 'Objector2.png');

let mainWindow;
let editorWindow;
let _pendingEditorInit = null;

// 独立面板窗口（舞台+输出合并）
let _panelStageWin = null;
let _panelEditorSender = null;  // 记录编辑器 webContents

// ========== 命令行参数解析（右键菜单 / 文件关联） ==========
let _startupProjectPath = null;

function parseProjectFromArgs(argv) {
  // 跳过 electron 和脚本路径，取第一个非标志参数
  const args = argv.slice(app.isPackaged ? 1 : 2);
  for (const arg of args) {
    if (arg.startsWith('--')) continue;
    const resolved = path.resolve(arg);
    try {
      const stat = fs.statSync(resolved);
      if (stat.isDirectory()) {
        // 检查是否是 Objector 项目（含 project.json）
        if (fs.existsSync(path.join(resolved, 'project.json'))) {
          return resolved;
        }
        // 普通文件夹：检查是否可作为项目打开
        return resolved;
      }
      if (stat.isFile() && resolved.toLowerCase().endsWith('.zip')) {
        return resolved; // zip 文件，需要解压
      }
    } catch {}
  }
  return null;
}

_startupProjectPath = parseProjectFromArgs(process.argv);

// ========== 单实例锁（防止多开，支持右键菜单传递参数） ==========
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    // 第二个实例启动时，将参数传递给第一个实例
    const projectPath = parseProjectFromArgs(commandLine);
    if (projectPath && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('open-project-from-args', projectPath);
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Objector',
    icon: APP_ICON,
    backgroundColor: '#1e1e2e',
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    autoHideMenuBar: true,
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

function createEditorWindow(projectPath, mode, renderMode) {
  // 始终关闭旧窗口并重建，确保 renderMode 正确应用
  if (editorWindow && !editorWindow.isDestroyed()) {
    editorWindow.destroy();
    editorWindow = null;
  }

  editorWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'Objector 编辑器',
    icon: APP_ICON,
    backgroundColor: '#1e1e2e',
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    autoHideMenuBar: true,
  });

  // Fix: 先存数据，再加载页面，渲染器就绪后主动拉取
  _pendingEditorInit = {
    path: projectPath,
    mode: mode || 'normal',
    render: renderMode || '2d',
  };

  const url = `file://${path.join(__dirname, 'editor.html')}`;
  editorWindow.loadURL(url);

  // 隐藏主页窗口
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }

  editorWindow.on('closed', () => {
    editorWindow = null;
    // 编辑器关闭时同时关闭所有面板窗口
    _closeAllPanels();
    // 编辑器关闭后恢复主页窗口
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(() => {
  createWindow();

  // 启动时如果有命令行传入的项目路径，发送给渲染器
  if (_startupProjectPath) {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow.webContents.send('open-project-from-args', _startupProjectPath);
      _startupProjectPath = null;
    });
  }
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });

// ========== 面板窗口管理 ==========
function _createPanelWin(width, height) {
  const win = new BrowserWindow({
    width, height,
    minWidth: 400, minHeight: 300,
    resizable: false,
    title: 'Objector - 舞台',
    icon: APP_ICON,
    backgroundColor: '#1e1e1e',
    frame: false,
    parent: null,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    autoHideMenuBar: true,
  });
  const url = `file://${path.join(__dirname, 'panel.html')}`;
  win.loadURL(url);
  win.on('closed', () => {
    _panelStageWin = null;
  });
  return win;
}

function _closeAllPanels() {
  if (_panelStageWin && !_panelStageWin.isDestroyed()) _panelStageWin.close();
  _panelStageWin = null;
}

// IPC: 打开面板窗口（舞台+输出合并）
ipcMain.handle('open-panels', async (e) => {
  _panelEditorSender = e.sender;
  if (!_panelStageWin || _panelStageWin.isDestroyed()) {
    _panelStageWin = _createPanelWin(520, 520);
  }
  return true;
});

// IPC: 关闭面板窗口
ipcMain.handle('close-panels', async () => {
  _closeAllPanels();
  return true;
});

// IPC: 显示/聚焦面板窗口
ipcMain.handle('show-panel', async (e, type) => {
  _panelEditorSender = e.sender;
  if (type === 'stage' || type === 'output') {
    if (_panelStageWin && !_panelStageWin.isDestroyed()) {
      if (_panelStageWin.isMinimized()) _panelStageWin.restore();
      _panelStageWin.show();
      _panelStageWin.focus();
    } else {
      _panelStageWin = _createPanelWin(520, 520);
    }
  }
  return true;
});

// IPC: 编辑器 -> 面板（转发更新数据，只有1个窗口）
ipcMain.on('panel-update', (_e, data) => {
  if (_panelStageWin && !_panelStageWin.isDestroyed()) {
    _panelStageWin.webContents.send('panel-update', data);
  }
});

// IPC: 面板 -> 编辑器（转发用户操作）
ipcMain.on('panel-action', (_e, action, data) => {
  if (_panelEditorSender && !_panelEditorSender.isDestroyed()) {
    _panelEditorSender.send('panel-action', action, data);
  }
});

// ========== 面板窗口控制 IPC ==========
function _getPanelWinFromSender(sender) {
  if (_panelStageWin && !_panelStageWin.isDestroyed() && _panelStageWin.webContents === sender) return _panelStageWin;
  return null;
}

ipcMain.on('panel-set-always-on-top', (e, flag) => {
  const win = _getPanelWinFromSender(e.sender);
  if (win) win.setAlwaysOnTop(flag);
});

ipcMain.on('panel-minimize', (e) => {
  const win = _getPanelWinFromSender(e.sender);
  if (win) win.minimize();
});

ipcMain.on('panel-maximize', (e) => {
  const win = _getPanelWinFromSender(e.sender);
  if (win) {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  }
});

ipcMain.on('panel-close', (e) => {
  const win = _getPanelWinFromSender(e.sender);
  if (win) win.close();
});

// 面板输入转发：舞台窗口 → 编辑器
ipcMain.on('panel-input', (_e, type, data) => {
  if (_panelEditorSender && !_panelEditorSender.isDestroyed()) {
    _panelEditorSender.send('panel-input', type, data);
  }
});

// IPC: 打开编辑器窗口
ipcMain.handle('open-editor', async (_e, projectPath, mode, renderMode) => {
  createEditorWindow(projectPath, mode, renderMode);
  return true;
});

// IPC: 渲染器请求获取编辑器初始化数据（解决中文路径编码问题）
ipcMain.handle('get-editor-init', async () => {
  const data = _pendingEditorInit;
  _pendingEditorInit = null;  // 取出后清空，防止重复获取
  return data;
});

// IPC: 打开文件夹选择对话框
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

// IPC: 打开扩展文件选择对话框
ipcMain.handle('select-extension-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: '扩展文件', extensions: ['json', 'js'] },
      { name: 'JSON 扩展', extensions: ['json'] },
      { name: 'JavaScript 扩展', extensions: ['js'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

// IPC: 打开扩展文档（跳转网页）
ipcMain.handle('open-extension-docs', async () => {
  shell.openExternal('https://lichtom.github.io/objector-coder/extension-api');
  return true;
});

// IPC: 读取文件
ipcMain.handle('read-file', async (_e, filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return content;
  } catch (err) {
    console.error('[read-file] 失败:', filePath, err.message);
    return null;
  }
});

// IPC: 写入文件
ipcMain.handle('write-file', async (_e, filePath, content) => {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
    return true;
  } catch (err) {
    console.error('[write-file] 写入失败:', filePath, err.message);
    return { error: err.message };
  }
});

// IPC: 写入二进制文件（base64 编码）
ipcMain.handle('write-file-binary', async (_e, filePath, base64Content) => {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // 支持 data URL 格式 (data:image/png;base64,...)
    const base64 = base64Content.includes(',') ? base64Content.split(',')[1] : base64Content;
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
    return true;
  } catch (err) {
    console.error('[write-file-binary] 写入失败:', filePath, err.message);
    return { error: err.message };
  }
});

// IPC: 确保目录存在
ipcMain.handle('ensure-dir', async (_e, dirPath) => {
  try {
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
    return true;
  } catch (err) {
    console.error('[ensure-dir]', dirPath, err.message);
    return { error: err.message };
  }
});

// IPC: 列出目录文件
ipcMain.handle('list-dir', async (_e, dirPath) => {
  try { return fs.readdirSync(dirPath); } catch { return []; }
});

// IPC: 判断路径是否为目录
ipcMain.handle('is-dir', async (_e, itemPath) => {
  try { return fs.statSync(itemPath).isDirectory(); } catch { return false; }
});

// IPC: 路径拼接
ipcMain.handle('path-join', (_e, ...args) => path.join(...args));

// IPC: 删除文件
ipcMain.handle('delete-file', async (_e, filePath) => {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return true;
  } catch { return false; }
});

// IPC: 重命名文件夹
ipcMain.handle('rename-folder', async (_e, oldPath, newPath) => {
  try {
    if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
      fs.renameSync(oldPath, newPath);
      return { success: true, newPath };
    }
    if (fs.existsSync(newPath)) return { error: '目标路径已存在' };
    return { error: '原路径不存在' };
  } catch (err) {
    console.error('[rename-folder]', err.message);
    return { error: err.message };
  }
});

// IPC: 删除文件夹（递归删除）
ipcMain.handle('delete-folder', async (_e, folderPath) => {
  try {
    if (fs.existsSync(folderPath)) {
      fs.rmSync(folderPath, { recursive: true, force: true });
    }
    return { success: true };
  } catch (err) {
    console.error('[delete-folder]', err.message);
    return { error: err.message };
  }
});

// IPC: 选择图片文件（用于精灵贴图）
ipcMain.handle('select-image-file', async () => {
  const win = editorWindow && !editorWindow.isDestroyed() ? editorWindow : mainWindow;
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [
      { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

// IPC: 复制文件到目标路径（用于上传图片到项目 assets 目录）
ipcMain.handle('copy-file', async (_e, srcPath, destPath) => {
  try {
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(srcPath, destPath);
    return true;
  } catch (err) {
    console.error('[copy-file] 复制失败:', err.message);
    return { error: err.message };
  }
});

// IPC: 读取二进制文件并返回 base64（用于图片预览）
ipcMain.handle('read-file-binary', async (_e, filePath) => {
  try {
    const buf = fs.readFileSync(filePath);
    return buf.toString('base64');
  } catch (err) {
    console.error('[read-file-binary]', filePath, err.message);
    return null;
  }
});

// IPC: 选择音频文件（用于声音模块）
ipcMain.handle('select-audio-file', async () => {
  const win = editorWindow && !editorWindow.isDestroyed() ? editorWindow : mainWindow;
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [
      { name: '音频文件', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

// IPC: 保存文件对话框
ipcMain.handle('save-file-dialog', async (_e, defaultName, filters) => {
  const win = editorWindow && !editorWindow.isDestroyed() ? editorWindow : mainWindow;
  const result = await dialog.showSaveDialog(win, {
    defaultPath: defaultName || 'output',
    filters: filters || [{ name: '所有文件', extensions: ['*'] }],
  });
  if (result.canceled) return null;
  return result.filePath;
});

// IPC: 递归读取目录下所有文件（返回 {path, content} 数组）
ipcMain.handle('read-dir-recursive', async (_e, dirPath) => {
  const results = [];
  function walk(dir, prefix) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      entries.forEach(e => {
        const full = path.join(dir, e.name);
        const rel = prefix ? prefix + '/' + e.name : e.name;
        if (e.isDirectory()) {
          walk(full, rel);
        } else if (e.isFile()) {
          try {
            const content = fs.readFileSync(full, 'utf-8');
            results.push({ path: rel, content });
          } catch {}
        }
      });
    } catch {}
  }
  walk(dirPath, '');
  return results;
});

// IPC: 窗口控制
ipcMain.handle('window-minimize', () => {
  const win = BrowserWindow.getFocusedWindow();
  if (win) win.minimize();
});

ipcMain.handle('window-maximize', () => {
  const win = BrowserWindow.getFocusedWindow();
  if (win) {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  }
});

ipcMain.handle('window-close', () => {
  const win = BrowserWindow.getFocusedWindow();
  if (win) win.close();
});

// IPC: 打开社区登录窗口
ipcMain.handle('open-community-login', async () => {
  const loginWin = new BrowserWindow({
    width: 480,
    height: 640,
    title: '社区登录',
    icon: APP_ICON,
    backgroundColor: '#0f0f1a',
    parent: editorWindow || mainWindow,
    modal: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // 加载社区登录页
  const loginUrl = 'https://lichtom.github.io/objector-coder/community/login.html';
  try {
    await loginWin.loadURL(loginUrl);
  } catch (e) {
    console.error('[社区登录] 加载失败:', e);
  }

  // 当窗口关闭时，编辑器可以尝试恢复 session
  return new Promise((resolve) => {
    loginWin.on('closed', () => {
      resolve(true);
    });
  });
});

// IPC: 打开添加节点子窗口（高级模式）
let _addNodeRequestId = 0;
ipcMain.handle('open-add-node-dialog', async (_e, types) => {
  const requestId = ++_addNodeRequestId;
  const parentWin = BrowserWindow.fromWebContents(_e.sender);

  const dialogWin = new BrowserWindow({
    width: 440,
    height: 560,
    title: '添加节点',
    icon: APP_ICON,
    backgroundColor: '#1e1e2e',
    frame: false,
    parent: parentWin || editorWindow || mainWindow,
    modal: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  dialogWin.loadFile(path.join(__dirname, 'add-node-dialog.html'));

  return new Promise((resolve) => {
    let resolved = false;

    function cleanup() {
      ipcMain.removeListener('add-node-select', handler);
      ipcMain.removeListener('add-node-cancel', cancelHandler);
    }

    // 子窗口发回选中类型
    function handler(_evt, type) {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve({ requestId, type });
    }

    // 子窗口取消
    function cancelHandler() {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve({ requestId, type: null });
    }

    ipcMain.on('add-node-select', handler);
    ipcMain.on('add-node-cancel', cancelHandler);

    // 窗口关闭（未选择）
    dialogWin.on('closed', () => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve({ requestId, type: null });
    });

    // 窗口加载完成后发送节点类型数据
    dialogWin.webContents.on('did-finish-load', () => {
      dialogWin.webContents.send('add-node-types', types);
    });
  });
});

// IPC: 在系统浏览器中打开 URL
ipcMain.handle('open-external', async (_e, url) => {
  try {
    shell.openExternal(url);
    return true;
  } catch (err) {
    console.error('[open-external]', err.message);
    return { error: err.message };
  }
});

// IPC: 解压 ZIP 文件到临时目录并返回项目路径
ipcMain.handle('extract-zip-project', async (_e, zipPath) => {
  try {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();

    // 在用户临时目录下创建解压目标
    const tmpBase = path.join(app.getPath('temp'), 'ObjectorProjects');
    if (!fs.existsSync(tmpBase)) fs.mkdirSync(tmpBase, { recursive: true });

    // 用 ZIP 文件名作为子目录名
    const baseName = path.basename(zipPath, '.zip');
    const destDir = path.join(tmpBase, baseName);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

    zip.extractAllTo(destDir, true);

    // 检查解压后是否有 project.json，如果没有则创建一个
    if (!fs.existsSync(path.join(destDir, 'project.json'))) {
      // 检查是否在子目录中
      const subDirs = fs.readdirSync(destDir, { withFileTypes: true })
        .filter(e => e.isDirectory());
      if (subDirs.length === 1 && fs.existsSync(path.join(destDir, subDirs[0].name, 'project.json'))) {
        return path.join(destDir, subDirs[0].name);
      }
      // 创建默认的 project.json
      const config = {
        name: baseName,
        version: '1.0',
        mode: 'normal',
        renderMode: '2d',
        created: new Date().toISOString(),
        stageWidth: 480,
        stageHeight: 360,
      };
      fs.writeFileSync(path.join(destDir, 'project.json'), JSON.stringify(config, null, 2));
      if (!fs.existsSync(path.join(destDir, 'scripts'))) fs.mkdirSync(path.join(destDir, 'scripts'));
      fs.writeFileSync(path.join(destDir, 'scripts', 'main.json'), '{}');
    }

    return destDir;
  } catch (err) {
    console.error('[extract-zip-project]', err.message);
    // 回退：使用系统命令解压
    try {
      const { execSync } = require('child_process');
      const tmpBase = path.join(app.getPath('temp'), 'ObjectorProjects');
      if (!fs.existsSync(tmpBase)) fs.mkdirSync(tmpBase, { recursive: true });
      const baseName = path.basename(zipPath, '.zip');
      const destDir = path.join(tmpBase, baseName);
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      
      if (process.platform === 'win32') {
        execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`);
      } else {
        // Linux / macOS: 使用 unzip 命令
        execSync(`unzip -o "${zipPath}" -d "${destDir}"`);
      }
      
      // 检查子目录
      const subDirs = fs.readdirSync(destDir, { withFileTypes: true }).filter(e => e.isDirectory());
      if (subDirs.length === 1 && fs.existsSync(path.join(destDir, subDirs[0].name, 'project.json'))) {
        return path.join(destDir, subDirs[0].name);
      }
      if (!fs.existsSync(path.join(destDir, 'project.json'))) {
        const config = {
          name: baseName,
          version: '1.0',
          mode: 'normal',
          renderMode: '2d',
          created: new Date().toISOString(),
          stageWidth: 480,
          stageHeight: 360,
        };
        fs.writeFileSync(path.join(destDir, 'project.json'), JSON.stringify(config, null, 2));
        if (!fs.existsSync(path.join(destDir, 'scripts'))) fs.mkdirSync(path.join(destDir, 'scripts'));
        fs.writeFileSync(path.join(destDir, 'scripts', 'main.json'), '{}');
      }
      return destDir;
    } catch (err2) {
      return { error: err2.message };
    }
  }
});

// IPC: 运行代码（流式输出 + stdin 支持）
let _runningCodeProcess = null;
let _codeSender = null; // 记录发起运行的 webContents，用于推送流式输出

ipcMain.handle('run-code', async (_e, lang, code, projectPath) => {
  // 先杀掉上一个进程
  if (_runningCodeProcess) {
    try { _runningCodeProcess.kill(); } catch {}
    _runningCodeProcess = null;
  }
  _codeSender = _e.sender;

  const tmpDir = path.join(app.getPath('temp'), 'ObjectorCodeRun');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  // 通用：用 spawn 启动进程，流式推送 stdout/stderr
  function runWithSpawn(cmd, args, label) {
    return new Promise((resolve) => {
      try {
        const child = spawn(cmd, args, {
          cwd: projectPath || tmpDir,
          env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1' },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        _runningCodeProcess = child;

        child.stdout.on('data', (data) => {
          const text = data.toString('utf-8');
          if (_codeSender && !_codeSender.isDestroyed()) {
            _codeSender.send('code-output', text);
          }
        });
        child.stderr.on('data', (data) => {
          const text = data.toString('utf-8');
          if (_codeSender && !_codeSender.isDestroyed()) {
            _codeSender.send('code-output', text, 'stderr');
          }
        });
        child.on('close', (exitCode) => {
          _runningCodeProcess = null;
          if (_codeSender && !_codeSender.isDestroyed()) {
            _codeSender.send('code-done', exitCode);
          }
          resolve({ ok: true, exitCode });
        });
        child.on('error', (err) => {
          _runningCodeProcess = null;
          if (_codeSender && !_codeSender.isDestroyed()) {
            _codeSender.send('code-output', '❌ ' + err.message, 'stderr');
            _codeSender.send('code-done', 1);
          }
          resolve({ error: true, message: err.message });
        });
      } catch (err) {
        resolve({ error: true, message: err.message });
      }
    });
  }

  // === JavaScript ===
  if (lang === 'javascript') {
    const nodePath = process.execPath;
    const codeFile = path.join(tmpDir, 'main.js');
    const wrappedCode = `
process.stdout.write = (function(orig) {
  return function(chunk) { return orig.call(process.stdout, chunk); };
})(process.stdout.write.bind(process.stdout));
try {
${code}
} catch(e) {
  process.stderr.write('❌ ' + e.message + '\\n');
}
`;
    fs.writeFileSync(codeFile, wrappedCode, 'utf-8');
    return runWithSpawn(nodePath, [codeFile], 'node');
  }

  // === Python ===
  if (lang === 'python') {
    const pythonPaths = [
      'python', 'python3', 'py',
    ];
    if (process.platform === 'win32') {
      pythonPaths.push(
        'C:\\Python39\\python.exe', 'C:\\Python310\\python.exe', 'C:\\Python311\\python.exe',
        'C:\\Python312\\python.exe', 'C:\\Python313\\python.exe',
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python39', 'python.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python310', 'python.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python311', 'python.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312', 'python.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python313', 'python.exe'),
      );
    } else {
      // Linux / macOS
      pythonPaths.push(
        '/usr/bin/python3', '/usr/local/bin/python3',
        '/usr/bin/python', '/usr/local/bin/python',
      );
    }
    let pythonExe = null;
    for (const p of pythonPaths) {
      try {
        if (p === 'python' || p === 'python3' || p === 'py') {
          const r = require('child_process').execFileSync(p, ['--version'], { timeout: 3000, encoding: 'utf-8' });
          if (r && r.includes('Python')) { pythonExe = p; break; }
        } else if (fs.existsSync(p)) {
          pythonExe = p; break;
        }
      } catch {}
    }
    if (!pythonExe) {
      if (_codeSender && !_codeSender.isDestroyed()) {
        _codeSender.send('code-output', '❌ 未找到 Python 解释器。\n\n请安装 Python: https://www.python.org/downloads/\n或确认 Python 已添加到 PATH 环境变量。', 'stderr');
        _codeSender.send('code-done', 1);
      }
      return { error: true, message: 'Python not found' };
    }
    const codeFile = path.join(tmpDir, 'main.py');
    // 用 -u 参数强制无缓冲输出
    fs.writeFileSync(codeFile, code, 'utf-8');
    // 发送解释器信息
    if (_codeSender && !_codeSender.isDestroyed()) {
      _codeSender.send('code-output', '[' + pythonExe + ']\n');
    }
    return runWithSpawn(pythonExe, ['-u', codeFile], 'python');
  }

  // === C++ ===
  if (lang === 'cpp') {
    const gppPaths = [
      'g++',
    ];
    if (process.platform === 'win32') {
      gppPaths.push(
        'C:\\msys64\\ucrt64\\bin\\g++.exe',
        'C:\\msys64\\mingw64\\bin\\g++.exe',
        'C:\\mingw64\\bin\\g++.exe',
        'C:\\MinGW\\bin\\g++.exe',
        'C:\\TDM-GCC-64\\bin\\g++.exe',
      );
    } else {
      // Linux / macOS
      gppPaths.push(
        '/usr/bin/g++', '/usr/local/bin/g++',
        '/usr/bin/c++', '/usr/local/bin/c++',
      );
    }
    let gppExe = null;
    for (const p of gppPaths) {
      try {
        if (p === 'g++') {
          const r = require('child_process').execFileSync(p, ['--version'], { timeout: 3000, encoding: 'utf-8' });
          if (r) { gppExe = p; break; }
        } else if (fs.existsSync(p)) {
          gppExe = p; break;
        }
      } catch {}
    }
    if (!gppExe) {
      if (_codeSender && !_codeSender.isDestroyed()) {
        const installHint = process.platform === 'win32'
          ? '请安装 MinGW-w64: https://www.mingw-w64.org/'
          : '请运行: sudo apt install g++ (Debian/Ubuntu) 或 sudo dnf install gcc-c++ (Fedora)';
        _codeSender.send('code-output', '❌ 未找到 C++ 编译器 (g++)。\n\n' + installHint + '\n或确认 g++ 已添加到 PATH 环境变量。', 'stderr');
        _codeSender.send('code-done', 1);
      }
      return { error: true, message: 'g++ not found' };
    }
    const srcFile = path.join(tmpDir, 'main.cpp');
    const exeFile = path.join(tmpDir, process.platform === 'win32' ? 'main.exe' : 'main');
    fs.writeFileSync(srcFile, code, 'utf-8');

    // 先编译（阻塞）
    if (_codeSender && !_codeSender.isDestroyed()) {
      _codeSender.send('code-output', '⏳ 编译中...\n');
    }
    return new Promise((resolve) => {
      execFile(gppExe, ['-o', exeFile, srcFile, '-std=c++17'], { timeout: 30000 }, (compileErr, compileOut, compileErr2) => {
        if (compileErr || (compileErr2 && compileErr2.trim())) {
          if (_codeSender && !_codeSender.isDestroyed()) {
            _codeSender.send('code-output', '❌ 编译失败:\n' + (compileErr2 || compileErr.message), 'stderr');
            _codeSender.send('code-done', 1);
          }
          resolve({ error: true, message: 'compile failed' });
          return;
        }
        if (_codeSender && !_codeSender.isDestroyed()) {
          _codeSender.send('code-output', '[' + gppExe + '] 编译成功\n');
        }
        runWithSpawn(exeFile, [], 'cpp').then(resolve);
      });
    });
  }

  return { output: '❌ 不支持的语言: ' + lang, error: true };
});

// IPC: 向正在运行的进程发送 stdin（用于 input()）
ipcMain.handle('code-stdin', async (_e, text) => {
  if (_runningCodeProcess && _runningCodeProcess.stdin && !_runningCodeProcess.stdin.destroyed) {
    _runningCodeProcess.stdin.write(text + '\n');
    return { ok: true };
  }
  return { ok: false, error: '没有正在运行的进程' };
});

// IPC: 停止正在运行的代码
ipcMain.handle('stop-code', async () => {
  if (_runningCodeProcess) {
    try { _runningCodeProcess.kill('SIGTERM'); } catch {}
    _runningCodeProcess = null;
    return { stopped: true };
  }
  return { stopped: false };
});

// ========== micro:bit 串口通信 ==========
const { SerialPort } = (() => { try { return require('serialport'); } catch(e) { return { SerialPort: null }; } })();
let _mbPort = null;
let _mbDataBuf = '';

ipcMain.handle('microbit-list-ports', async () => {
  if (!SerialPort) return [];
  try { return await SerialPort.list(); } catch(e) { return []; }
});

ipcMain.handle('microbit-connect', async (_e, portPath) => {
  if (!SerialPort) return { ok: false, error: 'serialport module not available' };
  return new Promise((resolve) => {
    if (_mbPort) { try { _mbPort.close(); } catch(e) {} _mbPort = null; }
    try {
      _mbPort = new SerialPort({ path: portPath, baudRate: 115200 }, (err) => {
        if (err) { _mbPort = null; return resolve({ ok: false, error: err.message }); }
        _mbDataBuf = '';
        _mbPort.on('data', (data) => { _mbDataBuf += data.toString(); });
        _mbPort.on('error', () => { _mbPort = null; });
        _mbPort.on('close', () => { _mbPort = null; });
        resolve({ ok: true });
      });
    } catch(e) { _mbPort = null; resolve({ ok: false, error: e.message }); }
  });
});

ipcMain.handle('microbit-send', async (_e, cmd) => {
  if (!_mbPort || !_mbPort.isOpen) return { ok: false, error: 'Port not open' };
  return new Promise((resolve) => {
    _mbDataBuf = '';
    _mbPort.write(cmd + '\n', (err) => {
      if (err) return resolve({ ok: false, error: err.message });
      // 等待响应（最多 2 秒）
      let elapsed = 0;
      const timer = setInterval(() => {
        elapsed += 50;
        if (_mbDataBuf.includes('\n')) {
          clearInterval(timer);
          const lines = _mbDataBuf.split('\n').filter(l => l.trim());
          resolve({ ok: true, response: lines[lines.length - 1] || '' });
        } else if (elapsed >= 2000) {
          clearInterval(timer);
          resolve({ ok: true, response: _mbDataBuf.trim() || 'TIMEOUT' });
        }
      }, 50);
    });
  });
});

ipcMain.handle('microbit-disconnect', async () => {
  if (_mbPort) { try { _mbPort.close(); } catch(e) {} _mbPort = null; }
  return { ok: true };
});

ipcMain.handle('microbit-flash', async (_e, hexPath) => {
  // 拖拽烧录：复制 combined hex 到 micro:bit USB 驱动器
  try {
    const drives = _findMicrobitDrives();
    if (drives.length === 0) {
      return { ok: false, error: 'micro:bit USB 驱动器未找到。请通过 USB 连接 micro:bit。' };
    }
    const dest = path.join(drives[0], 'firmware.hex');
    fs.copyFileSync(hexPath, dest);
    return { ok: true, path: dest };
  } catch(e) {
    return { ok: false, error: e.message };
  }
});

// IPC: 烧录实时模式固件 main.hex 到 micro:bit
ipcMain.handle('microbit-flash-main', async () => {
  try {
    const fwDir = path.join(__dirname, '..', 'microbit-firmware');
    const mainHex = path.join(fwDir, 'main.hex');
    
    if (!fs.existsSync(mainHex)) {
      return { ok: false, error: '实时模式固件不存在: ' + mainHex };
    }
    
    // 查找 micro:bit USB 驱动器 (跨平台)
    const drives = _findMicrobitDrives();
    
    if (drives.length === 0) {
      return { ok: false, error: 'micro:bit USB 驱动器未找到。请通过 USB 连接 micro:bit。' };
    }
    
    const dest = path.join(drives[0], 'firmware.hex');
    fs.copyFileSync(mainHex, dest);
    return { ok: true, path: dest };
  } catch(e) {
    return { ok: false, error: e.message };
  }
});

// IPC: microbit 编译并合并 hex (预编译固件 + makecombinedhex.py)
ipcMain.handle('microbit-compile-flash', async (_e, pyCode) => {
  try {
    const { execSync } = require('child_process');
    
    // 固件和脚本路径
    const fwDir = path.join(__dirname, '..', 'microbit-firmware');
    const fwHex = path.join(fwDir, 'micropython-microbit-v2.1.1.hex');
    const combineScript = path.join(fwDir, 'makecombinedhex.py');
    
    // 临时文件
    const tmpDir = path.join(os.tmpdir(), 'objector-microbit');
    try { fs.mkdirSync(tmpDir, { recursive: true }); } catch(e) {}
    const tmpPy = path.join(tmpDir, 'main.py');
    const tmpHex = path.join(tmpDir, 'combined.hex');
    
    // 写入 Python 代码
    fs.writeFileSync(tmpPy, pyCode, 'utf-8');
    
    // 检查固件文件
    if (!fs.existsSync(fwHex)) {
      return { ok: false, error: '预编译固件文件不存在: ' + fwHex };
    }
    
    // 跨平台: python vs python3
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    
    // 运行 makecombinedhex.py
    const cmd = `${pythonCmd} "${combineScript}" "${fwHex}" "${tmpPy}" "${tmpHex}"`;
    execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
    
    // 检查输出
    if (!fs.existsSync(tmpHex)) {
      return { ok: false, error: '合并 hex 生成失败' };
    }
    
    // 查找 micro:bit USB 驱动器 (跨平台)
    const drives = _findMicrobitDrives();
    
    if (drives.length > 0) {
      const dest = path.join(drives[0], 'firmware.hex');
      fs.copyFileSync(tmpHex, dest);
      return { ok: true, path: dest, combinedHex: tmpHex };
    }
    
    // 未找到驱动器，返回 hex 路径让用户手动拖拽
    return { ok: true, path: null, combinedHex: tmpHex, message: '已生成合并 hex，但未找到 micro:bit USB 驱动器。请手动复制文件到 micro:bit。' };
  } catch(e) {
    return { ok: false, error: '编译烧录失败: ' + e.message };
  }
});

// IPC: 打开 JS 代码编辑器窗口（非模态，独立窗口）
let _jsEditorWin = null;
let _jsEditorData = null;  // 暂存待发送的数据
let _jsEditorSender = null;  // 记录发起请求的 webContents

ipcMain.handle('open-js-editor', async (_e, data) => {
  // 关闭已有窗口
  if (_jsEditorWin && !_jsEditorWin.isDestroyed()) {
    _jsEditorWin.close();
  }

  _jsEditorData = data;  // { spriteIdx, name, code }
  _jsEditorSender = _e.sender;

  const parentWin = BrowserWindow.fromWebContents(_e.sender);
  _jsEditorWin = new BrowserWindow({
    width: 700,
    height: 550,
    title: 'JS 代码编辑器',
    icon: APP_ICON,
    backgroundColor: '#1e1e2e',
    frame: false,  // 自定义标题栏（非 modal，不会卡死）
    parent: null,  // 非模态，可移动到其他屏幕
    resizable: true,
    minimizable: true,
    maximizable: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  _jsEditorWin.loadFile(path.join(__dirname, 'js-editor-window.html'));

  _jsEditorWin.on('closed', () => {
    _jsEditorWin = null;
    _jsEditorData = null;
  });

  return { ok: true };
});

// JS 编辑器窗口就绪，发送数据
ipcMain.on('js-editor-ready', (_e) => {
  if (_jsEditorWin && _jsEditorData && _jsEditorWin.webContents === _e.sender) {
    _jsEditorWin.webContents.send('js-editor-init', _jsEditorData);
  }
});

// JS 编辑器保存，转发代码到主编辑器窗口
ipcMain.on('js-editor-save', (_e, spriteIdx, code) => {
  if (_jsEditorSender && !_jsEditorSender.isDestroyed()) {
    _jsEditorSender.send('js-editor-code-updated', spriteIdx, code);
  }
});

// JS 编辑器窗口控制 - 使用 sender 直接获取窗口引用
ipcMain.on('js-editor-close-window', (_e) => {
  const win = BrowserWindow.fromWebContents(_e.sender);
  if (win && !win.isDestroyed()) win.close();
});
ipcMain.on('js-editor-confirm-close', async (_e, spriteIdx) => {
  const win = BrowserWindow.fromWebContents(_e.sender);
  if (!win || win.isDestroyed()) return;
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['取消', '不保存并关闭'],
    defaultId: 0,
    cancelId: 0,
    title: '未保存的更改',
    message: '有未保存的更改，确定关闭吗？',
  });
  if (response === 1 && !win.isDestroyed()) {
    win.close();
  }
});
ipcMain.on('js-editor-toggle-fullscreen', (_e) => {
  const win = BrowserWindow.fromWebContents(_e.sender);
  if (win && !win.isDestroyed()) {
    win.setFullScreen(!win.isFullScreen());
  }
});
ipcMain.on('js-editor-toggle-maximize', (_e) => {
  const win = BrowserWindow.fromWebContents(_e.sender);
  if (win && !win.isDestroyed()) {
    if (win.isMaximized()) {
      win.restore();
    } else {
      win.maximize();
    }
  }
});
ipcMain.on('js-editor-minimize', (_e) => {
  const win = BrowserWindow.fromWebContents(_e.sender);
  if (win && !win.isDestroyed()) {
    win.minimize();
  }
});

// ========== AI 助手窗口 ==========
let aiWindow = null;
let _aiAbortController = null;

// IPC: 打开 AI 窗口
ipcMain.handle('open-ai-window', async (_e, initData) => {
  if (aiWindow && !aiWindow.isDestroyed()) {
    aiWindow.focus();
    // 发送最新数据
    aiWindow.webContents.send('ai-block-catalog', initData?.blockCatalog || '');
    aiWindow.webContents.send('ai-current-blocks', initData?.currentBlocks || '');
    return true;
  }

  aiWindow = new BrowserWindow({
    width: 520,
    height: 700,
    minWidth: 400,
    minHeight: 500,
    title: 'Objector AI 助手',
    icon: APP_ICON,
    backgroundColor: '#1e1e2e',
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  aiWindow.loadFile(path.join(__dirname, 'ai-window.html'));

  aiWindow.webContents.on('did-finish-load', () => {
    if (initData) {
      aiWindow.webContents.send('ai-block-catalog', initData.blockCatalog || '');
      aiWindow.webContents.send('ai-current-blocks', initData.currentBlocks || '');
    }
  });

  aiWindow.on('closed', () => { aiWindow = null; });
  return true;
});

let cmdWindow = null;

// IPC: 打开命令行窗口
ipcMain.handle('open-cmd-window', async (_e) => {
  if (cmdWindow && !cmdWindow.isDestroyed()) {
    cmdWindow.focus();
    return true;
  }

  cmdWindow = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 600,
    minHeight: 400,
    title: 'Objector 命令行',
    icon: APP_ICON,
    backgroundColor: '#1e1e2e',
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  cmdWindow.loadFile(path.join(__dirname, 'cmd-window.html'));
  cmdWindow.on('closed', () => { cmdWindow = null; });
  return true;
});

// ========== 素材管理窗口 ==========
let assetManagerWin = null;

ipcMain.handle('open-asset-manager', async (_e, options) => {
  if (assetManagerWin && !assetManagerWin.isDestroyed()) {
    assetManagerWin.focus();
    return true;
  }
  const parentWin = BrowserWindow.fromWebContents(_e.sender);
  assetManagerWin = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 700,
    minHeight: 500,
    title: '素材管理',
    icon: APP_ICON,
    backgroundColor: '#1e1e2e',
    frame: false,
    parent: parentWin || editorWindow || mainWindow,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  assetManagerWin.loadFile(path.join(__dirname, 'asset-manager.html'));
  assetManagerWin.on('closed', () => { assetManagerWin = null; });
  return true;
});

// IPC: AI 流式聊天
ipcMain.handle('ai-stream-chat', async (_e, messages, modelId) => {
  const allConfig = _getAIConfig();
  const registry = allConfig.registry || [];
  const currentId = modelId || allConfig.currentModelId;

  // Find model from registry
  let config = null;
  if (currentId && registry.length > 0) {
    config = registry.find(m => m.id === currentId);
  }
  // Fallback to old single config format
  if (!config && allConfig.baseUrl) {
    config = {
      provider: allConfig.provider || 'openai',
      baseUrl: allConfig.baseUrl,
      apiKey: allConfig.apiKey || '',
      model: allConfig.model || 'gpt-4o-mini',
    };
  }

  if (!config) {
    return { error: '请先在 ⚙️ 设置中注册模型服务' };
  }
  if (!config.apiKey && config.provider !== 'ollama') {
    return { error: '请先配置 API Key' };
  }

  console.log('[AI] Chat request, provider:', config.provider, 'model:', config.model);

  const tools = [
    {
      type: 'function',
      function: {
        name: 'generate_blocks',
        description: '生成积木并添加到编辑区。支持连接到已有积木的flowOut链、C型槽、参数输入槽。每个积木可指定connectTo(已有积木ID)和connectType(flowOut|flowIn|sub|param)。',
        parameters: {
          type: 'object',
          properties: {
            blocks: {
              type: 'array', description: '积木数组，按顺序自动连成链',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string', description: '积木类型 ID' },
                  params: { type: 'object', description: '积木参数 key-value' },
                  x: { type: 'number', description: 'X坐标(无connectTo时使用)' },
                  y: { type: 'number', description: 'Y坐标(无connectTo时使用)' },
                  connectTo: { type: 'string', description: '连接到已有积木的ID(可选)' },
                  connectType: { type: 'string', enum: ['flowOut','flowIn','sub','param'], description: 'flowOut=接在后面, flowIn=插在前面, sub=放入C型槽, param=连到参数输入槽' },
                  subSlot: { type: 'string', description: 'connectType=sub时指定C型槽名称如body/then/else' },
                  connectParam: { type: 'string', description: 'connectType=param时指定参数槽名称' },
                },
                required: ['type'],
              },
            },
          },
          required: ['blocks'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'modify_blocks',
        description: '修改/删除/移动/连接已有积木。action: delete(删除并修复连接), move(移动位置), update(更新参数), connect(连接两个已有积木), disconnect(断开连接)',
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['delete','move','update','connect','disconnect'] },
            blockIds: { type: 'array', items: { type: 'string' }, description: '目标积木ID列表' },
            params: { type: 'object', description: 'update时的新参数' },
            x: { type: 'number' }, y: { type: 'number' },
            targetId: { type: 'string', description: 'connect时连接到哪个积木' },
            connectType: { type: 'string', enum: ['flowOut','flowIn','sub','param'], description: 'connect的连接类型' },
            subSlot: { type: 'string' },
            connectParam: { type: 'string' },
          },
          required: ['action','blockIds'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'manage_sprites',
        description: '管理角色和造型。action: add_sprite(添加角色), delete_sprite(删除角色), switch_sprite(切换角色), list_sprites(列出所有角色), add_costume(添加造型), delete_costume(删除造型), switch_costume(切换造型)',
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['add_sprite','delete_sprite','switch_sprite','list_sprites','add_costume','delete_costume','switch_costume'] },
            name: { type: 'string', description: 'add_sprite时的角色名' },
            spriteIndex: { type: 'number', description: '角色索引(从0开始)' },
            costumeIndex: { type: 'number', description: '造型索引(从0开始)' },
          },
          required: ['action'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'run_project',
        description: '运行当前项目，查看执行效果',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'save_project',
        description: '保存当前项目',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'screenshot',
        description: '截取当前积木编辑区的截图，返回 base64 图片',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'fetch_url',
        description: '获取网页内容用于回答用户问题',
        parameters: {
          type: 'object',
          properties: { url: { type: 'string', description: '网页 URL' } },
          required: ['url'],
        },
      },
    },
  ];

  const sender = _e.sender;
  _aiAbortController = new AbortController();

  try {
    const url = config.baseUrl + '/chat/completions';
    console.log('[AI] Requesting (non-stream):', url);
    const headers = { 'Content-Type': 'application/json' };
    if (config.apiKey) headers['Authorization'] = 'Bearer ' + config.apiKey;

    const body = {
      model: config.model,
      messages,
      tools,
      stream: false,
      max_tokens: config.maxTokens || 2048,
      temperature: config.temperature || 0.7,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: _aiAbortController.signal,
    });

    console.log('[AI] Response status:', response.status);

    if (!response.ok) {
      const errText = await response.text();
      console.error('[AI] API error:', errText.slice(0, 500));
      if (!sender.isDestroyed()) sender.send('ai-stream-error', `API ${response.status}: ${errText.slice(0, 200)}`);
      return { error: `API ${response.status}: ${errText.slice(0, 200)}` };
    }

    const data = await response.json();
    console.log('[AI] Got response, choices:', data.choices?.length);

    const choice = data.choices?.[0];
    if (!choice) {
      if (!sender.isDestroyed()) sender.send('ai-stream-error', 'API 返回空结果');
      return { error: 'API 返回空结果' };
    }

    const message = choice.message || {};
    const content = message.content || '';
    const toolCallsRaw = message.tool_calls || [];

    console.log('[AI] Content length:', content.length, 'Tool calls:', toolCallsRaw.length);

    // 模拟流式发送文本（每 20ms 发送一个字符，实现打字效果）
    if (content && !sender.isDestroyed()) {
      const chunkSize = 3; // 每次发送 3 个字符
      for (let i = 0; i < content.length; i += chunkSize) {
        if (sender.isDestroyed()) break;
        if (_aiAbortController?.signal?.aborted) break;
        const chunk = content.slice(i, i + chunkSize);
        sender.send('ai-stream-token', chunk);
        // 每 15ms 发送一批（足够快，看起来像流式）
        await new Promise(r => setTimeout(r, 15));
      }
    }

    // 发送完成
    if (!sender.isDestroyed()) {
      sender.send('ai-stream-done', content);
    }

    // 处理工具调用
    for (const tc of toolCallsRaw) {
      if (tc.function?.name && tc.id) {
        try {
          const args = JSON.parse(tc.function.arguments);
          console.log('[AI] Tool call:', tc.function.name);
          if (!sender.isDestroyed()) {
            sender.send('ai-tool-call', { name: tc.function.name, args, id: tc.id });
          }
        } catch (parseErr) {
          console.error('[AI] Tool parse error:', parseErr.message);
        }
      }
    }

    return { ok: true };
  } catch (e) {
    console.error('[AI] Error:', e.name, e.message);
    if (e.name === 'AbortError') {
      if (!sender.isDestroyed()) sender.send('ai-stream-done', '');
      return { ok: true };
    }
    if (!sender.isDestroyed()) sender.send('ai-stream-error', e.message);
    return { error: e.message };
  }
});

// IPC: 停止流式生成
ipcMain.handle('ai-stop-stream', () => {
  if (_aiAbortController) {
    _aiAbortController.abort();
    _aiAbortController = null;
  }
  return true;
});

// IPC: 执行工具（从 AI 窗口调用）
ipcMain.handle('ai-execute-tool', async (_e, name, args) => {
  const targetWin = editorWindow && !editorWindow.isDestroyed() ? editorWindow : mainWindow;
  if (!targetWin) return '编辑器窗口未打开';

  if (name === 'screenshot') {
    // 截取编辑器画布
    try {
      const image = await targetWin.webContents.capturePage();
      const buffer = image.toPNG();
      return 'data:image/png;base64,' + buffer.toString('base64');
    } catch (e) {
      return '截图失败: ' + e.message;
    }
  }

  if (name === 'generate_blocks' || name === 'modify_blocks' || name === 'manage_sprites' || name === 'run_project' || name === 'save_project') {
    // 转发给编辑器执行
    return new Promise((resolve) => {
      targetWin.webContents.send('ai-execute-tool', name, args);
      ipcMain.once('ai-tool-exec-result', (_evt, result) => {
        resolve(result);
      });
    });
  }

  if (name === 'fetch_url') {
    try {
      const resp = await fetch(args.url, {
        headers: { 'User-Agent': 'Objector AI Assistant' },
        signal: AbortSignal.timeout(15000),
      });
      const text = await resp.text();
      // 简单提取正文
      const cleaned = text.replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 3000);
      return cleaned || '无法获取网页内容';
    } catch (e) {
      return '获取失败: ' + e.message;
    }
  }

  return '未知工具: ' + name;
});

// IPC: 工具执行结果回传给 AI 窗口
ipcMain.handle('ai-tool-result', async (_e, toolId, result) => {
  // This is handled in the AI window's JS
  return true;
});

// IPC: 获取当前积木数据（AI 窗口调用）
ipcMain.handle('ai-get-current-blocks', async () => {
  const targetWin = editorWindow && !editorWindow.isDestroyed() ? editorWindow : mainWindow;
  if (!targetWin) return '';
  return new Promise((resolve) => {
    targetWin.webContents.send('ai-request-blocks');
    ipcMain.once('ai-blocks-response', (_evt, blocks) => {
      resolve(blocks);
    });
  });
});

// IPC: AI 执行代码（在编辑器窗口中执行任意 JS 代码）
ipcMain.handle('ai-execute-code', async (_e, code) => {
  const targetWin = editorWindow && !editorWindow.isDestroyed() ? editorWindow : mainWindow;
  if (!targetWin) return { error: '编辑器窗口未打开' };

  try {
    const result = await targetWin.webContents.executeJavaScript(code, true);
    return { result: result };
  } catch (e) {
    console.error('[AI] Code execution error:', e.message);
    return { error: e.message };
  }
});

// IPC: AI 指令执行（>>> 命令转发到编辑器执行）
ipcMain.handle('ai-exec-cmd', async (_e, cmd) => {
  const targetWin = editorWindow && !editorWindow.isDestroyed() ? editorWindow : mainWindow;
  if (!targetWin) return 'ERROR:编辑器窗口未打开';
  return new Promise((resolve) => {
    targetWin.webContents.send('ai-exec-cmd', cmd);
    ipcMain.once('ai-cmd-result', (_evt, result) => {
      resolve(result);
    });
  });
});

// IPC: AI 配置管理
function _getAIConfig() {
  try {
    const cfgPath = path.join(app.getPath('userData'), 'ai-config.json');
    if (fs.existsSync(cfgPath)) {
      return JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    }
  } catch {}
  return { provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: '', maxTokens: 2048, temperature: 0.7 };
}

ipcMain.handle('get-ai-config', () => {
  return _getAIConfig();
});

ipcMain.handle('save-ai-config', (_e, cfg) => {
  try {
    const cfgPath = path.join(app.getPath('userData'), 'ai-config.json');
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf-8');
    return true;
  } catch (e) {
    return false;
  }
});

// ============ 导出依赖检测与自动下载 ============

function _getElectronCacheDir() {
  if (process.env.ELECTRON_CACHE_DIR) return process.env.ELECTRON_CACHE_DIR;
  var home = require('os').homedir();
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'electron', 'Cache');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Caches', 'electron');
  return path.join(home, '.cache', 'electron');
}

// 获取本地 Electron dist 路径（用于 electron-packager 跳过下载）
function _getLocalElectronDist() {
  try { return path.dirname(require('electron')); } catch (e) {}
  return path.join(__dirname, 'node_modules', 'electron', 'dist');
}

ipcMain.handle('check-export-deps', (_e, opts) => {
  var targetPlatform = (opts && opts.targetPlatform) || 'win32';
  var packageType = (opts && opts.packageType) || 'zip';
  var missing = [];
  var cachedElectron = false;
  var cachedNsis = false;
  var useLocalDist = false;

  try { require.resolve('electron-packager'); } catch (e) { missing.push('electron-packager'); }
  if (packageType === 'installer') {
    try { require.resolve('electron-builder'); } catch (e) { missing.push('electron-builder'); }
  }

  // 同平台打包使用本地 Electron dist，无需下载
  if (targetPlatform === process.platform || (targetPlatform === 'win32' && process.platform === 'win32')) {
    var localDist = _getLocalElectronDist();
    if (fs.existsSync(localDist)) {
      useLocalDist = true;
      cachedElectron = true;
    }
  }

  // 跨平台打包才需要检测缓存中的 Electron zip
  if (!useLocalDist) {
    try {
      var electronVersion = require('electron/package.json').version;
      var cacheDir = _getElectronCacheDir();
      var platformMap = { win32: 'win32-x64', darwin: 'darwin-x64', linux: 'linux-x64' };
      var zipName = 'electron-v' + electronVersion + '-' + (platformMap[targetPlatform] || 'win32-x64') + '.zip';
      cachedElectron = fs.existsSync(path.join(cacheDir, zipName));
      if (!cachedElectron) missing.push('electron-' + targetPlatform);
    } catch (e) { missing.push('electron-version'); }
  }

  if (packageType === 'installer' && targetPlatform === 'win32') {
    var cacheDir2 = _getElectronCacheDir();
    var nsisDir = path.join(cacheDir2, 'nsis-3.0.4.1');
    cachedNsis = fs.existsSync(nsisDir);
    if (!cachedNsis) missing.push('nsis');
  }

  return { available: missing.length === 0, missing: missing, cachedElectron: cachedElectron, cachedNsis: cachedNsis, useLocalDist: useLocalDist };
});

ipcMain.handle('download-export-deps', async (event, opts) => {
  var targetPlatform = (opts && opts.targetPlatform) || 'win32';
  var packageType = (opts && opts.packageType) || 'zip';
  var sender = event.sender;
  try {
    var electronVersion = require('electron/package.json').version;
    var cacheDir = _getElectronCacheDir();
    try { fs.mkdirSync(cacheDir, { recursive: true }); } catch (e) {}
    var archMap = { win32: 'x64', darwin: 'x64', linux: 'x64' };
    var arch = archMap[targetPlatform] || 'x64';
    var platformMap = { win32: 'win32-x64', darwin: 'darwin-x64', linux: 'linux-x64' };
    var zipName = 'electron-v' + electronVersion + '-' + (platformMap[targetPlatform] || 'win32-x64') + '.zip';
    if (!fs.existsSync(path.join(cacheDir, zipName))) {
      sender.send('export-deps-progress', { stage: 'downloading-electron', message: '正在下载 Electron (' + targetPlatform + ')...', percent: 0 });
      try {
        var electronGet = require('@electron/get');
        await electronGet.download(electronVersion, {
          arch: arch, platform: targetPlatform, cacheRoot: cacheDir,
          mirrorOptions: { mirror: process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/' },
          downloadOptions: { getProgressCallback: function(progress) {
            sender.send('export-deps-progress', { stage: 'downloading-electron', percent: Math.round((progress.percent || 0) * 100), message: '下载 Electron (' + targetPlatform + ') ' + Math.round((progress.percent || 0) * 100) + '%', transferred: progress.transferredBytes, total: progress.totalBytes });
          }}
        });
      } catch (getErr) {
        var mirrorUrl = (process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/');
        if (!mirrorUrl.endsWith('/')) mirrorUrl += '/';
        var dlUrl = mirrorUrl + 'v' + electronVersion + '/' + zipName;
        sender.send('export-deps-progress', { stage: 'downloading-electron', message: 'HTTP 下载 ' + zipName + '...', percent: 5 });
        var http = require('https'); if (dlUrl.startsWith('http://')) http = require('http');
        var tmpZipPath = path.join(cacheDir, zipName + '.tmp');
        var finalZipPath = path.join(cacheDir, zipName);
        await new Promise(function(resolve, reject) {
          var _doDownload = function(url, redirects) {
            if (redirects > 5) return reject(new Error('Too many redirects'));
            http.get(url, function(res) {
              if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return _doDownload(res.headers.location, redirects + 1); }
              if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
              var totalSize = parseInt(res.headers['content-length'] || '0', 10);
              var downloaded = 0;
              var ws = fs.createWriteStream(tmpZipPath);
              res.on('data', function(chunk) { downloaded += chunk.length; if (totalSize > 0) { sender.send('export-deps-progress', { stage: 'downloading-electron', percent: Math.round(downloaded / totalSize * 95) + 5, message: '下载 ' + zipName + ' ' + Math.round(downloaded / totalSize * 100) + '%', transferred: downloaded, total: totalSize }); } });
              res.pipe(ws); ws.on('finish', function() { ws.close(); resolve(); }); ws.on('error', reject);
            }).on('error', reject);
          };
          _doDownload(dlUrl, 0);
        });
        fs.renameSync(tmpZipPath, finalZipPath);
      }
      sender.send('export-deps-progress', { stage: 'downloading-electron', message: 'Electron 下载完成', percent: 100 });
    }
    sender.send('export-deps-progress', { stage: 'complete', message: '环境就绪', percent: 100 });
    return { success: true };
  } catch (err) {
    console.error('[download-export-deps] 失败:', err.message);
    return { success: false, error: err.message };
  }
});

// IPC: 写入内容到临时文件并返回路径（避免大内容通过 IPC 传输）
ipcMain.handle('write-file-temp', (_e, filename, content) => {
  try {
    const tmpDir = path.join(app.getPath('temp'), 'objector-export-tmp');
    fs.mkdirSync(tmpDir, { recursive: true });
    const tmpPath = path.join(tmpDir, filename);
    fs.writeFileSync(tmpPath, content, 'utf-8');
    return tmpPath;
  } catch (e) {
    console.error('[write-file-temp] 失败:', e.message);
    return null;
  }
});

// IPC: 获取导出文件信息（扩展名、过滤名）
ipcMain.handle('get-export-file-info', (_e, options) => {
  const { targetPlatform = 'win32', packageType = 'zip', projectName = 'game' } = options || {};
  const safeName = (projectName || 'game').replace(/[^a-zA-Z0-9\u4e00-\u9fff_\-]/g, '_');
  if (packageType === 'installer') {
    if (targetPlatform === 'win32') return { fileExt: 'exe', filterName: 'Windows 安装程序', safeFileName: safeName + '.exe' };
    if (targetPlatform === 'darwin') return { fileExt: 'dmg', filterName: 'macOS 磁盘映像', safeFileName: safeName + '.dmg' };
    return { fileExt: 'AppImage', filterName: 'Linux AppImage', safeFileName: safeName + '.AppImage' };
  }
  return { fileExt: 'zip', filterName: 'ZIP 压缩包', safeFileName: safeName + '.zip' };
});

// IPC: 打包导出游戏为可执行文件 (electron-packager + electron-builder)
// 使用 ipcMain.on 而非 handle，避免长时间打包导致 IPC 超时
ipcMain.on('build-exe', async (event, options) => {
  const sender = event.sender;
  const _reply = (result) => {
    if (sender && !sender.isDestroyed()) sender.send('build-exe-result', result);
  };
  console.log('[build-exe] ===== 开始 =====');
  const { html, htmlPath, projectName, iconPath, outPath, targetPlatform = 'win32', packageType = 'zip', installPathType = 'user-select' } = options;
  console.log('[build-exe] htmlPath:', htmlPath, 'html len:', (html||'').length, 'outPath:', outPath);
  const safeName = (projectName || 'game').replace(/[^a-zA-Z0-9\u4e00-\u9fff_\-]/g, '_');
  const tmpBase = path.join(app.getPath('temp'), 'objector-exe-build-' + Date.now());
  const srcDir = path.join(tmpBase, 'src');
  const outDir = path.join(tmpBase, 'out');

  try {
    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(outDir, { recursive: true });

    // 获取 Electron 版本（electronDist 模式下必须显式传递）
    const electronVersion = require('electron/package.json').version;

    // 写入最小 Electron 项目
    const pkgJson = {
      name: safeName.toLowerCase().replace(/[^a-z0-9-_]/g, ''),
      productName: projectName || 'Objector Game',
      version: '1.0.0',
      main: 'main.js',
      description: projectName || 'Objector Game',
      author: 'Objector User'
    };
    fs.writeFileSync(path.join(srcDir, 'package.json'), JSON.stringify(pkgJson, null, 2), 'utf-8');

    const mainJs = `const { app, BrowserWindow } = require('electron');
const path = require('path');
app.disableHardwareAcceleration();
app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1024, height: 768,
    title: ${JSON.stringify(projectName || 'Objector Game')},
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });
  win.loadFile('index.html');
  win.on('closed', () => app.quit());
});
app.on('window-all-closed', () => app.quit());
`;
    fs.writeFileSync(path.join(srcDir, 'main.js'), mainJs, 'utf-8');
    // 支持 htmlPath（文件路径）和 html（字符串内容）两种方式
    if (htmlPath && fs.existsSync(htmlPath)) {
      fs.copyFileSync(htmlPath, path.join(srcDir, 'index.html'));
      try { fs.unlinkSync(htmlPath); } catch {} // 清理临时文件
    } else if (html) {
      fs.writeFileSync(path.join(srcDir, 'index.html'), html, 'utf-8');
    } else {
      return _reply({ error: '缺少 html 或 htmlPath 参数' });
    }
    if (iconPath && fs.existsSync(iconPath)) {
      fs.copyFileSync(iconPath, path.join(srcDir, 'icon.png'));
    }

    // electron-packager 打包
    let packager;
    try { packager = require('electron-packager'); } catch (e) {
      return _reply({ error: 'electron-packager 未安装，无法打包' });
    }
    console.log('[build-exe] electron-packager 已加载');
    const platformMap = { win32: 'win32', darwin: 'darwin', linux: 'linux' };
    const packagerOpts = {
      dir: srcDir, out: outDir,
      name: projectName || 'ObjectorGame',
      platform: platformMap[targetPlatform] || 'win32',
      arch: 'x64', overwrite: true, asar: true,
      electronVersion: electronVersion,
    };
    // 注意：不传 electronDist，避免复制正在运行的 electron.exe（文件被锁定会导致卡死）
    // electron-packager 会自动使用缓存中的 zip（~/.cache/electron/electron-vXX-win32-x64.zip）
    console.log('[build-exe] electronVersion:', electronVersion, '（使用缓存 zip）');
    if (iconPath && fs.existsSync(iconPath)) packagerOpts.icon = path.join(srcDir, 'icon.png');

    console.log('[build-exe] 平台:', targetPlatform, '打包方式:', packageType);
    console.log('[build-exe] 开始 packager...');
    if (sender && !sender.isDestroyed()) sender.send('export-deps-progress', { stage: 'packaging', message: '正在打包，请稍候...', percent: 0 });
    const appPaths = await packager(packagerOpts);
    console.log('[build-exe] packager 完成:', appPaths);
    if (!appPaths || appPaths.length === 0) return _reply({ error: 'electron-packager 打包失败' });
    const packagedDir = appPaths[0];

    let fileBuffer, fileExt, filterName;

    if (packageType === 'zip') {
      // ZIP 压缩包
      if (sender && !sender.isDestroyed()) sender.send('export-deps-progress', { stage: 'compressing', message: '正在压缩 ZIP...', percent: 50 });
      const { ZipArchive } = require('archiver');
      const zipPath = path.join(tmpBase, safeName + '.zip');
      await new Promise((resolve, reject) => {
        const output = fs.createWriteStream(zipPath);
        const archive = new ZipArchive({ zlib: { level: 6 } });
        output.on('close', resolve);
        archive.on('error', reject);
        archive.pipe(output);
        archive.directory(packagedDir, false);
        archive.finalize();
      });
      fileBuffer = fs.readFileSync(zipPath);
      fileExt = 'zip';
      filterName = 'ZIP 压缩包';
    } else {
      // 安装程序（使用 electron-builder）
      if (sender) sender.send('export-deps-progress', { stage: 'installer', message: '正在生成安装程序...', percent: 50 });
      let builder;
      try { builder = require('electron-builder'); } catch (e) {
        return _reply({ error: 'electron-builder 未安装，无法创建安装程序' });
      }
      const installerOutDir = path.join(tmpBase, 'installer-out');
      fs.mkdirSync(installerOutDir, { recursive: true });

      const allowToChangeInstallationDirectory = (installPathType === 'user-select');
      let targets;
      let extraConfig = {};

      if (targetPlatform === 'win32') {
        targets = builder.Platform.WINDOWS.createTarget(['nsis']);
        extraConfig.nsis = {
          oneClick: false,
          allowToChangeInstallationDirectory,
          installerIcon: iconPath && fs.existsSync(iconPath) ? path.join(srcDir, 'icon.png') : undefined,
          uninstallerIcon: iconPath && fs.existsSync(iconPath) ? path.join(srcDir, 'icon.png') : undefined,
        };
      } else if (targetPlatform === 'darwin') {
        targets = builder.Platform.MAC.createTarget(['dmg']);
      } else {
        targets = builder.Platform.LINUX.createTarget(['AppImage']);
      }

      console.log('[build-exe] 创建安装程序...');
      await builder.build({
        targets,
        config: {
          appId: 'com.objector.' + safeName,
          productName: projectName || 'ObjectorGame',
          directories: { app: packagedDir, output: installerOutDir, buildResources: srcDir },
          electronVersion: electronVersion,
          ...extraConfig,
        },
      });

      // 查找生成的文件
      const findFile = (dir) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          if (e.isFile() && (e.name.endsWith('.exe') || e.name.endsWith('.dmg') || e.name.endsWith('.AppImage') || e.name.endsWith('.deb'))) {
            return path.join(dir, e.name);
          }
        }
        return null;
      };
      const installerFile = findFile(installerOutDir);
      if (!installerFile) return _reply({ error: '安装程序生成失败，未找到输出文件' });

      fileBuffer = fs.readFileSync(installerFile);
      if (installerFile.endsWith('.exe')) { fileExt = 'exe'; filterName = 'Windows 安装程序'; }
      else if (installerFile.endsWith('.dmg')) { fileExt = 'dmg'; filterName = 'macOS 磁盘映像'; }
      else if (installerFile.endsWith('.AppImage')) { fileExt = 'AppImage'; filterName = 'Linux AppImage'; }
      else { fileExt = path.extname(installerFile).slice(1); filterName = '安装文件'; }
    }

    console.log('[build-exe] 文件大小:', (fileBuffer.length / 1024 / 1024).toFixed(1), 'MB');

    // 直接写入目标路径（避免 base64 超大 IPC 消息）
    if (outPath) {
      fs.writeFileSync(outPath, fileBuffer);
      console.log('[build-exe] 已写入:', outPath);
      try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch {}
      console.log('[build-exe] ===== 完成 =====');
      return _reply({ success: true, savedPath: outPath });
    }
    // 兼容旧流程：无 outPath 时返回 base64
    try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch {}
    return _reply({ fileBase64: fileBuffer.toString('base64'), fileExt, filterName });
  } catch (err) {
    console.error('[build-exe] 失败:', err.message);
    try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch {}
    return _reply({ error: err.message });
  }
});
