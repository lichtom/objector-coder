/**
 * 扩展管理弹窗 - 安装/卸载扩展
 * 点击积木分类栏的 "+" 按钮触发
 * 显示所有可用扩展（内置 + 文件加载），已安装的和未安装的都展示
 */
const ExtensionDialog = (function () {
  let _overlay = null;
  let _listEl = null;

  let _styleInjected = false;

  /** 注入弹窗样式（确保样式一定生效，不依赖外部 CSS 文件） */
  function _injectStyles() {
    if (_styleInjected) return;
    _styleInjected = true;
    const style = document.createElement('style');
    style.id = 'ext-dialog-styles';
    style.textContent = `
      .ext-dialog-box { max-width:520px; width:92%; text-align:left; }
      .ext-dialog-box h2 { text-align:center; font-size:17px; margin-bottom:4px; }
      .ext-dialog-box > p { text-align:center; font-size:12px; margin-bottom:16px; }
      .ext-dialog-body { max-height:55vh; overflow-y:auto; }
      #ext-dialog-list { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:14px; }
      .ext-dialog-empty { text-align:center; padding:32px 12px; color:#6c7086; font-size:13px; grid-column:1/-1; }
      .ext-card { position:relative; display:flex; flex-direction:column; padding:0; border-radius:10px; border:2px solid #45475a; background:#1e1e2e; overflow:hidden; transition:all 0.2s ease; }
      .ext-card:hover { border-color:var(--card-accent,#89b4fa); box-shadow:0 4px 16px rgba(0,0,0,0.35); transform:translateY(-2px); }
      .ext-card-installed { border-color:var(--card-accent,#50fa7b); background:rgba(80,250,123,0.06); }
      .ext-card-bar { height:4px; background:var(--card-accent,#888); flex-shrink:0; }
      .ext-card-body { display:flex; flex-direction:column; gap:6px; padding:14px 14px 10px; flex:1; }
      .ext-card-header { display:flex; align-items:center; gap:10px; }
      .ext-card-icon { width:32px; height:32px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:15px; font-weight:700; color:#fff; flex-shrink:0; background:var(--card-accent,#888); }
      .ext-card-name { font-size:14px; font-weight:700; color:#cdd6f4; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .ext-card-meta { font-size:11px; color:#6c7086; padding-left:42px; }
      .ext-card-footer { padding:0 14px 14px; display:flex; align-items:center; }
      .ext-card-btn { width:100%; padding:8px 0; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer; border:none; transition:all 0.15s ease; text-align:center; }
      .ext-card-btn-install { background:var(--card-accent,#89b4fa); color:#1e1e2e; }
      .ext-card-btn-install:hover { filter:brightness(1.15); }
      .ext-card-btn-uninstall { background:transparent; border:1px solid #f38ba8; color:#f38ba8; }
      .ext-card-btn-uninstall:hover { background:#f38ba8; color:#1e1e2e; }
      .ext-dialog-actions { display:flex; gap:8px; justify-content:center; margin-top:10px; }
      .ext-dialog-btn { padding:8px 16px; border-radius:6px; font-size:13px; cursor:pointer; border:1px solid #45475a; background:#313244; color:#cdd6f4; transition:all 0.15s; }
      .ext-dialog-btn:hover { border-color:#89b4fa; background:#45475a; }
      .ext-add-btn { font-size:14px !important; font-weight:bold; opacity:0.5; min-width:24px; cursor:pointer; }
      .ext-add-btn:hover { opacity:1; }
    `;
    document.head.appendChild(style);
  }

  /** 显示弹窗 */
  function show() {
    _injectStyles();
    if (_overlay) _overlay.remove();

    _overlay = document.createElement('div');
    _overlay.className = 'dialog-overlay';
    _overlay.innerHTML = `
      <div class="dialog-box ext-dialog-box">
        <h2>${_t('ext.manageTitle', '管理扩展')}</h2>
        <p>${_t('ext.manageDesc', '选择要安装的扩展，或卸载已安装的扩展')}</p>
        <div class="ext-dialog-body">
          <div id="ext-dialog-list"></div>
          <div class="ext-dialog-actions">
            <button class="ext-dialog-btn" id="ext-dialog-install-btn">
              📂 ${_t('ext.installFromFile', '从文件安装')}
            </button>
          </div>
        </div>
        <div class="dialog-actions" style="margin-top:12px;">
          <button class="dialog-btn dialog-btn-cancel" id="ext-dialog-close">${_t('dialog.close', '关闭')}</button>
        </div>
      </div>
    `;

    document.body.appendChild(_overlay);
    _listEl = document.getElementById('ext-dialog-list');

    _refreshList();

    // 绑定事件
    document.getElementById('ext-dialog-install-btn').addEventListener('click', _installFromFile);
    document.getElementById('ext-dialog-close').addEventListener('click', close);
    _overlay.addEventListener('click', (e) => {
      if (e.target === _overlay) close();
    });
  }

  /** 刷新扩展列表（显示所有可用扩展） */
  function _refreshList() {
    if (!_listEl) return;
    _listEl.innerHTML = '';

    const available = ExtensionManager.getAvailableExtensions();

    if (available.length === 0) {
      _listEl.innerHTML = `<div class="ext-dialog-empty">${_t('ext.noExtensions', '暂无可用扩展，点击下方按钮从文件安装')}</div>`;
      return;
    }

    available.forEach(ext => {
      const installed = ExtensionManager.isInstalled(ext.id);
      const blockCount = ext.blocks ? ext.blocks.length : 0;
      const color = ext.color || '#888';
      const initial = (ext.name || ext.id).charAt(0).toUpperCase();

      const card = document.createElement('div');
      card.className = 'ext-card' + (installed ? ' ext-card-installed' : '');
      card.style.setProperty('--card-accent', color);

      // 顶部彩色条
      const bar = document.createElement('div');
      bar.className = 'ext-card-bar';
      card.appendChild(bar);

      // 卡片主体
      const body = document.createElement('div');
      body.className = 'ext-card-body';
      body.innerHTML = `
        <div class="ext-card-header">
          <div class="ext-card-icon">${initial}</div>
          <span class="ext-card-name">${ext.name || ext.id}</span>
        </div>
        <div class="ext-card-meta">${blockCount} ${_t('ext.blocks', '积木')}${installed ? ' · ✅ ' + _t('ext.installed', '已安装') : ''}</div>
      `;
      card.appendChild(body);

      // 底部操作按钮
      const footer = document.createElement('div');
      footer.className = 'ext-card-footer';
      const actionBtn = document.createElement('button');
      if (installed) {
        actionBtn.className = 'ext-card-btn ext-card-btn-uninstall';
        actionBtn.textContent = _t('ext.uninstall', '卸载');
        actionBtn.addEventListener('click', () => _uninstall(ext.id, ext.name || ext.id));
      } else {
        actionBtn.className = 'ext-card-btn ext-card-btn-install';
        actionBtn.textContent = _t('ext.install', '安装');
        actionBtn.addEventListener('click', () => _install(ext.id));
      }
      footer.appendChild(actionBtn);
      card.appendChild(footer);

      _listEl.appendChild(card);
    });
  }

  /** 安装扩展 */
  function _install(extId) {
    const ok = ExtensionManager.installExtension(extId);
    if (ok) {
      // 刷新积木面板和弹窗列表
      if (typeof Palette !== 'undefined') Palette.init();
      _refreshList();
      _setStatus(_t('status.extLoaded', '扩展已加载'));
      console.log(`[扩展] 已安装: ${extId}`);
    } else {
      alert(_t('status.extFailed', '扩展安装失败'));
    }
  }

  /** 从文件安装扩展 */
  async function _installFromFile() {
    if (!window.api || !window.api.selectExtensionFile) {
      alert(_t('status.notSupported', '当前环境不支持此操作'));
      return;
    }

    const filePath = await window.api.selectExtensionFile();
    if (!filePath) return;

    const result = await ExtensionManager.loadFromFile(filePath);
    if (result.ok) {
      // 保存到项目 extensions 目录
      if (typeof EditorState !== 'undefined' && EditorState.projectPath && result.id) {
        try {
          const extDir = EditorState.projectPath + '/extensions';
          await window.api.ensureDir(extDir);
          const ext = filePath.endsWith('.js') ? '.js' : '.json';
          const content = await window.api.readFile(filePath);
          if (content) {
            await window.api.writeFile(extDir + '/' + result.id + ext, content);
          }
        } catch (e) {
          console.warn('[扩展安装] 保存文件失败:', e);
        }
      }

      // 刷新积木面板和弹窗列表
      if (typeof Palette !== 'undefined') Palette.init();
      _refreshList();
      _setStatus(_t('status.extLoaded', '扩展已加载'));
    } else {
      alert(_t('status.extFailed', '扩展加载失败'));
    }
  }

  /** 卸载扩展 */
  function _uninstall(extId, extName) {
    if (!confirm(_t('ext.confirmUninstall', '确定卸载扩展 "{name}" 吗？').replace('{name}', extName))) {
      return;
    }

    const ok = ExtensionManager.uninstallExtension(extId);
    if (ok) {
      // 从项目 extensions 目录删除文件
      if (typeof EditorState !== 'undefined' && EditorState.projectPath) {
        const extDir = EditorState.projectPath + '/extensions';
        ['.json', '.js'].forEach(ext => {
          const filePath = extDir + '/' + extId + ext;
          if (window.api && window.api.deleteFile) {
            window.api.deleteFile(filePath).catch(() => {});
          }
        });
      }

      // 刷新积木面板和弹窗列表
      if (typeof Palette !== 'undefined') Palette.init();
      _refreshList();
      console.log(`[扩展] 已卸载: ${extName}`);
    } else {
      console.warn(`[扩展] 卸载失败: ${extId}`);
    }
  }

  /** 设置状态栏临时信息 */
  function _setStatus(text) {
    const statusText = document.getElementById('status-text');
    if (statusText) {
      statusText.textContent = text;
      setTimeout(() => { statusText.textContent = _t('status.ready', '就绪'); }, 2000);
    }
  }

  /** 关闭弹窗 */
  function close() {
    if (_overlay) {
      _overlay.remove();
      _overlay = null;
      _listEl = null;
    }
  }

  /** i18n 辅助函数 */
  function _t(key, fallback) {
    if (typeof i18n !== 'undefined' && i18n.t) {
      const result = i18n.t(key);
      if (result && result !== key) return result;
    }
    return fallback;
  }

  return { show, close };
})();
