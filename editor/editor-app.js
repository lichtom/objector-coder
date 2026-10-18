/**
 * 编辑器窗口入口 - 初始化编辑器模块，绑定 UI 事件
 */
window.EditorApp = (function () {
  /**
   * Mobile detection and landscape orientation handling
   */
  function initMobileDetection() {
    var isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
      || ('ontouchstart' in window && navigator.maxTouchPoints > 1);

    if (!isMobile) return;

    document.body.classList.add('is-mobile');

    function checkOrientation() {
      var isPortrait = window.innerHeight > window.innerWidth;
      document.body.classList.toggle('is-mobile-portrait', isPortrait);
    }

    checkOrientation();
    window.addEventListener('resize', checkOrientation);
    window.addEventListener('orientationchange', function() {
      setTimeout(checkOrientation, 100);
    });

    // Try to lock orientation via Screen Orientation API
    try {
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(function() {});
      }
    } catch(e) {}

    // Inject mobile landscape CSS
    if (!document.getElementById('mobile-landscape-css')) {
      var style = document.createElement('style');
      style.id = 'mobile-landscape-css';
      style.textContent = [
        '@media screen and (orientation:portrait) and (max-width:900px) {',
        '  html body.is-mobile { transform:rotate(90deg); transform-origin:0 0; width:100vh; height:100vw; position:absolute; top:0; left:100%; overflow:hidden; }',
        '}',
      ].join('\n');
      document.head.appendChild(style);
    }
  }

  // Run mobile detection immediately
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMobileDetection);
  } else {
    initMobileDetection();
  }

  /**
   * 自定义 Prompt 对话框（替代 Electron 中禁用的 window.prompt）
   * @param {string} message - 提示文本
   * @param {string} defaultValue - 默认值
   * @returns {Promise<string|null>} 用户输入或 null（取消）
   */
  window.showCustomPrompt = function(message, defaultValue) {
    return new Promise((resolve) => {
      const overlay = document.getElementById('custom-prompt');
      const title = document.getElementById('custom-prompt-title');
      const input = document.getElementById('custom-prompt-input');
      const okBtn = document.getElementById('custom-prompt-ok');
      const cancelBtn = document.getElementById('custom-prompt-cancel');
      if (!overlay || !title || !input || !okBtn || !cancelBtn) {
        resolve(null);
        return;
      }
      title.textContent = message || i18n.t('dialog.prompt');
      input.value = defaultValue || '';
      overlay.classList.remove('hidden');
      setTimeout(() => { input.focus(); input.select(); }, 50);

      function cleanup() {
        overlay.classList.add('hidden');
        okBtn.onclick = null;
        cancelBtn.onclick = null;
        input.onkeydown = null;
        overlay.onclick = null;
      }
      okBtn.onclick = () => { cleanup(); resolve(input.value); };
      cancelBtn.onclick = () => { cleanup(); resolve(null); };
      input.onkeydown = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); cleanup(); resolve(input.value); }
        else if (e.key === 'Escape') { e.preventDefault(); cleanup(); resolve(null); }
      };
      overlay.onclick = (e) => { if (e.target === overlay) { cleanup(); resolve(null); } };
    });
  };

  // switchTab kept as no-op for backward compatibility
  function switchTab(tab) {
    if (tab === 'debug') DevMode.refreshWatchPanel();
  }
  window.switchTab = switchTab;

  /** 加载扩展文件（通过文件对话框）并保存到项目 extensions 目录 */
  async function loadExtensionDialog() {
    const filePath = await window.api.selectExtensionFile();
    if (!filePath) return;

    const result = await ExtensionManager.loadFromFile(filePath);
    if (result.ok) {
      // 保存到项目 extensions 目录
      if (EditorState.projectPath && result.id) {
        const extDir = EditorState.projectPath + '/extensions';
        await window.api.ensureDir(extDir);
        const ext = filePath.endsWith('.js') ? '.js' : '.json';
        const content = await window.api.readFile(filePath);
        if (content) {
          await window.api.writeFile(extDir + '/' + result.id + ext, content);
          console.log(`扩展已保存到 extensions/${result.id}${ext}`);
        }
      }
      Palette.init();
      document.getElementById('status-text').textContent = i18n.t('status.extLoaded');
      setTimeout(() => {
        document.getElementById('status-text').textContent = i18n.t('status.ready');
      }, 2000);
    } else {
      alert(i18n.t('status.extFailed'));
    }
  }

  /** 加载项目目录下的扩展 */
  async function loadProjectExtensions() {
    if (!EditorState.projectPath) return;
    const count = await ExtensionManager.loadFromProject(EditorState.projectPath);
    if (count > 0) {
      Palette.init();
      console.log(`已加载 ${count} 个扩展`);
    }
  }

  /** 加载项目目录下的声音 */
  async function loadProjectSounds() {
    if (!EditorState.projectPath) return;
    const count = await SoundManager.loadFromProject(EditorState.projectPath);
    if (count > 0) {
      console.log(`已加载 ${count} 个声音`);
      document.getElementById('status-text').textContent = i18n.t('status.soundsLoaded', null).replace('{n}', count);
      setTimeout(() => {
        document.getElementById('status-text').textContent = i18n.t('status.ready');
      }, 2000);
    }
  }

  /** 上传图片到项目造型库 */
  async function uploadCostumeDialog() {
    const filePath = await window.api.selectImageFile();
    if (!filePath) return;

    const name = await CostumeManager.uploadCostume(filePath);
    if (name) {
      document.getElementById('status-text').textContent = i18n.t('status.costumeUploaded', null).replace('{name}', name);
      refreshCostumeLibrary();
      setTimeout(() => {
        document.getElementById('status-text').textContent = i18n.t('status.ready');
      }, 2000);
    } else {
      alert(i18n.t('status.uploadFailed'));
    }
  }

  /** 更换当前精灵的贴图（从造型库选择） */
  async function setCostumeDialog() {
    const names = CostumeManager.getAllNames();
    if (names.length === 0) {
      alert(i18n.t('dialog.emptyCostumeLib'));
      return;
    }

    // 显示造型选择对话框
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = `
      <div class="dialog-box" style="max-width:500px;width:90%;text-align:left;">
        <h2 style="text-align:center;">${i18n.t('dialog.selectCostume')}</h2>
        <div id="costume-picker" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:8px;max-height:400px;overflow:auto;padding:8px;">
          ${names.map(n => `
            <div class="costume-item" data-name="${n}" style="cursor:pointer;text-align:center;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--bg-tertiary);">
              <img src="file://${CostumeManager.getFilePath(n)}" style="width:48px;height:48px;object-fit:contain;display:block;margin:0 auto;">
              <span style="font-size:10px;color:var(--text-muted);display:block;margin-top:4px;word-break:break-all;">${n}</span>
            </div>
          `).join('')}
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end;">
          <button id="costume-cancel" class="tb-btn">${i18n.t('dialog.cancel')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#costume-cancel').addEventListener('click', () => document.body.removeChild(overlay));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) document.body.removeChild(overlay); });

    overlay.querySelectorAll('.costume-item').forEach(item => {
      item.addEventListener('click', () => {
        const name = item.dataset.name;
        const idx = StageManager.getActiveSpriteIdx();
        const ok = StageManager.setSpriteCostumeByName(idx, name);
        if (ok) {
          const sprite = StageManager.getActiveSprite();
          document.getElementById('status-text').textContent = i18n.t('status.costumeApplied', null).replace('{name}', sprite.name);
        }
        document.body.removeChild(overlay);
        setTimeout(() => {
          document.getElementById('status-text').textContent = i18n.t('status.ready');
        }, 2000);
      });
    });
  }

  /** 刷新造型库显示（在角色面板中） */
  function refreshCostumeLibrary() {
    const container = document.getElementById('costume-library');
    if (!container) return;

    const names = CostumeManager.getAllNames();
    if (names.length === 0) {
      container.innerHTML = '<div style="color:var(--text-muted);font-size:11px;padding:8px;">' + i18n.t('sprites.emptyCostume') + '</div>';
      return;
    }

    container.innerHTML = '';
    names.forEach(name => {
      const div = document.createElement('div');
      div.className = 'costume-thumb';
      div.innerHTML = `
        <img src="file://${CostumeManager.getFilePath(name)}" style="width:32px;height:32px;object-fit:contain;">
        <span style="font-size:9px;color:var(--text-muted);display:block;word-break:break-all;">${name}</span>
      `;
      div.title = name;
      // 单击：应用到当前精灵
      div.addEventListener('click', () => {
        const idx = StageManager.getActiveSpriteIdx();
        StageManager.setSpriteCostumeByName(idx, name);
        document.getElementById('status-text').textContent = i18n.t('status.costumeApplied', null).replace('{name}', name);
        setTimeout(() => { document.getElementById('status-text').textContent = i18n.t('status.ready'); }, 1500);
      });
      // 右键：删除造型
      div.addEventListener('contextmenu', async (e) => {
        e.preventDefault();
        if (confirm(i18n.t('dialog.confirmDeleteCostume', null).replace('{name}', name))) {
          await CostumeManager.deleteCostume(name);
          refreshCostumeLibrary();
        }
      });
      container.appendChild(div);
    });
  }
  window.refreshCostumeLibrary = refreshCostumeLibrary;

  /** 清除当前精灵的贴图 */
  function clearCostume() {
    const idx = StageManager.getActiveSpriteIdx();
    StageManager.clearSpriteCostume(idx);
    document.getElementById('status-text').textContent = i18n.t('status.costumeCleared');
    setTimeout(() => {
      document.getElementById('status-text').textContent = i18n.t('status.ready');
    }, 2000);
  }

  /** 更新右侧 3 个窗口标题中的项目名 */
  function updateRwinTitles() {
    const name = EditorState.projectName || (i18n.isEnglish() ? 'Untitled' : '未命名项目');
    document.querySelectorAll('.rwin-pname').forEach(el => { el.textContent = name; });
  }

  // ==================== 独立面板窗口通信 ====================
  let _panelsOpened = false;
  let _stagePushTimer = null; // 执行期间高频推送精灵数据到舞台面板
  let _lastStageJSON = '';    // 脏检查：只在数据变化时发送

  function _startStagePushTimer() {
    if (_stagePushTimer) return;
    _stagePushTimer = setInterval(() => { _pushPanelSprites(); }, 33); // ~30fps，足够流畅
  }

  function _stopStagePushTimer() {
    if (_stagePushTimer) { clearInterval(_stagePushTimer); _stagePushTimer = null; }
    _lastStageJSON = '';
  }

  /** 推送精灵数据到面板窗口（带脏检查） */
  function _pushPanelSprites() {
    if (!_panelsOpened || !window.api || !window.api.sendPanelUpdate) return;
    const sprites = (typeof StageManager !== 'undefined') ? StageManager.getSprites() : [];
    const activeIdx = (typeof StageManager !== 'undefined') ? StageManager.getActiveSpriteIdx() : 0;
    // 轻量序列化：只包含关键字段用于脏检查
    const quickCheck = sprites.map(s => `${s.x|0},${s.y|0},${s.direction|0},${s.visible?1:0},${s.sayText||''}`).join(';');
    if (quickCheck === _lastStageJSON) return; // 数据没变，跳过发送
    _lastStageJSON = quickCheck;
    const data = sprites.map(s => ({
      name: s.name, x: s.x || 0, y: s.y || 0,
      direction: s.direction || 90, size: s.size || 100,
      visible: s.visible !== false, color: s.color || '#4ec9b0',
      rotationStyle: s.rotationStyle || 'allAround', sayText: s.sayText || '',
      costumeDataUrl: s.costumeImage ? s.costumeImage.src : null,
      isStage: s.isStage || false,  // 标记舞台精灵
    }));
    window.api.sendPanelUpdate({ type: 'stage', sprites: data });
    window.api.sendPanelUpdate({ type: 'sprites', sprites: data, activeIdx });
  }

  /** 推送项目标题到面板 */
  function _pushPanelTitle() {
    if (!_panelsOpened || !window.api || !window.api.sendPanelUpdate) return;
    window.api.sendPanelUpdate({ type: 'title', name: EditorState.projectName || '' });
  }

  /** 推送音频列表到编辑器本地渲染 */
  async function _pushAudioList() {
    const listEl = document.getElementById('audio-list');
    if (!listEl) return;
    if (!EditorState.projectPath) return;
    try {
      const files = await window.api.listDir(EditorState.projectPath + '/sounds');
      const audioFiles = (files || []).filter(f => /\.(mp3|wav|ogg|m4a|aac)$/i.test(f));
      _renderAudioList(audioFiles);
    } catch(e) {
      _renderAudioList([]);
    }
  }

  /** 渲染音频列表到编辑器 */
  function _renderAudioList(audioFiles) {
    const listEl = document.getElementById('audio-list');
    if (!listEl) return;
    if (audioFiles.length === 0) {
      listEl.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:8px;font-size:11px;">暂无音频</div>';
      return;
    }
    listEl.innerHTML = '';
    audioFiles.forEach((f, i) => {
      const item = document.createElement('div');
      item.className = 'audio-item';
      item.innerHTML = `<span class="audio-name">${f}</span>
        <button class="audio-btn" data-idx="${i}" data-act="play">▶</button>
        <button class="audio-btn del" data-idx="${i}" data-act="del"><img src="../icons/窗口操作图标/关闭.svg" class="tb-icon" style="height:10px;margin:0;"></button>`;
      listEl.appendChild(item);
    });
    listEl.querySelectorAll('.audio-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.currentTarget.dataset.idx);
        const act = e.currentTarget.dataset.act;
        if (act === 'play' && typeof SoundManager !== 'undefined') {
          SoundManager.play(audioFiles[idx]);
        } else if (act === 'del') {
          _deleteAudioFile(audioFiles[idx]);
        }
      });
    });
  }

  /** 添加音频文件 */
  async function _addAudioFile() {
    if (!EditorState.projectPath) return;
    const filePath = await window.api.selectAudioFile();
    if (!filePath) return;
    try {
      const fileName = filePath.replace(/\\/g, '/').split('/').pop();
      const dest = EditorState.projectPath + '/sounds/' + fileName;
      await window.api.copyFile(filePath, dest);
      if (typeof SoundManager !== 'undefined') {
        await SoundManager.loadSound(dest);
      }
      _pushAudioList();
    } catch(e) {
      console.warn('[Audio] 添加音频失败:', e);
    }
  }

  /** 删除音频文件 */
  async function _deleteAudioFile(fileName) {
    if (!EditorState.projectPath || !fileName) return;
    try {
      await window.api.deleteFile(EditorState.projectPath + '/sounds/' + fileName);
      _pushAudioList();
    } catch(e) {
      console.warn('[Audio] 删除音频失败:', e);
    }
  }

  /** 打开面板并监听操作（普通模式 + 高级模式） */
  function _initPanels() {
    console.log('[Panel] _initPanels called, projectMode:', EditorState.projectMode, 'api:', !!window.api, 'openPanels:', !!(window.api && window.api.openPanels));
    if (_panelsOpened) { console.log('[Panel] already opened, skip'); return; }
    if (!window.api || !window.api.openPanels) { console.warn('[Panel] API not available'); return; }
    if (EditorState.projectMode && EditorState.projectMode !== 'normal' && EditorState.projectMode !== 'advanced') { console.log('[Panel] not normal/advanced mode, skip'); return; }
    console.log('[Panel] Opening panels...');
    window.api.openPanels().then(() => {
      _panelsOpened = true;
      console.log('[Panel] Panels opened successfully');
      setTimeout(() => { _pushPanelTitle(); _pushPanelSprites(); _pushAudioList();
        // 推送渲染模式给面板窗口
        const rm = (typeof EditorState !== 'undefined' && EditorState.renderMode) || '2d';
        if (window.api && window.api.sendPanelUpdate) {
          window.api.sendPanelUpdate({ type: 'render-mode', renderMode: rm });
        }
      }, 600);
    }).catch(e => console.warn('[Panel] openPanels failed:', e));
    // 监听面板操作
    if (window.api.onPanelAction) {
      window.api.onPanelAction((action, data) => {
        if (action === 'select-sprite' && typeof StageManager !== 'undefined') {
          StageManager.setActiveSprite(data); _pushPanelSprites();
        } else if (action === 'add-sprite' && typeof StageManager !== 'undefined') {
          const s = StageManager.addSprite((i18n.isEnglish() ? 'Sprite' : '精灵') + (StageManager.getSprites().length + 1));
          const idx = StageManager.getSprites().indexOf(s);
          if (idx >= 0) StageManager.setActiveSprite(idx);
          _pushPanelSprites();
        } else if (action === 'upload-costume' && typeof uploadCostumeDialog === 'function') uploadCostumeDialog();
        else if (action === 'set-costume' && typeof setCostumeDialog === 'function') setCostumeDialog();
        else if (action === 'clear-costume' && typeof clearCostume === 'function') clearCostume();
        else if (action === 'clear-output') {
          if (typeof Executor !== 'undefined') Executor.clearOutput();
          const logEl = document.getElementById('output-log');
          if (logEl) logEl.textContent = '';
        }
        // 音频面板操作
        else if (action === 'request-audio-list') _pushAudioList();
        else if (action === 'play-audio' && typeof SoundManager !== 'undefined') SoundManager.play(data);
        else if (action === 'stop-all-audio' && typeof SoundManager !== 'undefined') SoundManager.stopAll();
        else if (action === 'add-audio') _addAudioFile();
        else if (action === 'delete-audio') _deleteAudioFile(data);
        // 面板请求渲染模式（面板窗口重建后的安全保障）
        else if (action === 'request-render-mode') {
          const rm = (typeof EditorState !== 'undefined' && EditorState.renderMode) || '2d';
          if (window.api && window.api.sendPanelUpdate) {
            window.api.sendPanelUpdate({ type: 'render-mode', renderMode: rm });
          }
        }
      });
    }
  }

  /** 显示项目所有代码文件 */
  async function showAllCodeDialog() {
    if (!EditorState.projectPath) {
      alert(i18n.t('status.openProjectFirst'));
      return;
    }

    const files = await window.api.readDirRecursive(EditorState.projectPath);
    if (!files || files.length === 0) {
      alert(i18n.t('status.projectEmpty'));
      return;
    }

    // 过滤文本类文件
    const textFiles = files.filter(f => /\.(json|js|ts|txt|md|html|css|xml|csv)$/i.test(f.path));

    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = `
      <div class="dialog-box" style="max-width:800px;width:90%;max-height:85vh;text-align:left;display:flex;flex-direction:column;">
        <h2 style="text-align:center;">${i18n.t('dialog.codeViewer', null).replace('{n}', textFiles.length)}</h2>
        <div style="display:flex;gap:8px;margin:12px 0;flex-wrap:wrap;">
          ${textFiles.map((f, i) => `<button class="tb-btn code-file-tab${i === 0 ? ' active' : ''}" data-idx="${i}" style="font-size:11px;padding:3px 8px;">${f.path}</button>`).join('')}
        </div>
        <div style="flex:1;overflow:auto;background:var(--bg-primary);border-radius:6px;border:1px solid var(--border);">
          <pre id="code-viewer" style="padding:12px;font-family:'Cascadia Code','Consolas',monospace;font-size:12px;color:var(--text-primary);white-space:pre-wrap;word-break:break-all;line-height:1.6;margin:0;"></pre>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end;">
          <button id="code-copy" class="tb-btn">${i18n.t('dialog.copyFile')}</button>
          <button id="code-close" class="tb-btn">${i18n.t('dialog.close')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const viewer = overlay.querySelector('#code-viewer');
    let currentIdx = 0;

    function showFile(idx) {
      currentIdx = idx;
      const f = textFiles[idx];
      viewer.textContent = `// 📄 ${f.path}\n${'='.repeat(60)}\n\n${f.content}`;
      overlay.querySelectorAll('.code-file-tab').forEach((btn, i) => {
        btn.classList.toggle('active', i === idx);
      });
    }

    showFile(0);

    overlay.querySelectorAll('.code-file-tab').forEach(btn => {
      btn.addEventListener('click', () => showFile(Number(btn.dataset.idx)));
    });

    overlay.querySelector('#code-copy').addEventListener('click', () => {
      navigator.clipboard.writeText(textFiles[currentIdx].content).then(() => {
        overlay.querySelector('#code-copy').textContent = i18n.t('dialog.copied');
        setTimeout(() => { overlay.querySelector('#code-copy').textContent = i18n.t('dialog.copyFile'); }, 1500);
      });
    });

    overlay.querySelector('#code-close').addEventListener('click', () => document.body.removeChild(overlay));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) document.body.removeChild(overlay); });
  }

  /** 保存项目到本地 ZIP（使用 File System Access API + JSZip） */
  async function saveProjectToLocal() {
    if (!EditorState.projectPath) {
      alert(i18n.t('status.openProjectFirst'));
      return;
    }

    // 检查浏览器支持
    if (!window.showDirectoryPicker) {
      alert(i18n.isEnglish()
        ? 'Your browser does not support File System Access API. Please use Chrome/Edge.'
        : '您的浏览器不支持 File System Access API，请使用 Chrome 或 Edge。');
      return;
    }

    const projectName = EditorState.projectName || 'project';
    document.getElementById('status-text').textContent = i18n.isEnglish() ? 'Saving to local...' : '正在保存到本地...';

    try {
      // 先保存到 VFS
      await ProjectManager.saveProject();
      EditorState._isDirty = false;
      EditorState._blocksSnapshot = JSON.stringify(EditorState.blocks);

      // 选择保存文件夹
      const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });

      // 收集当前项目的所有文件
      const projectPath = EditorState.projectPath.replace(/\\/g, '/').replace(/\/+$/, '');
      const vfsPrefix = 'vfs:';
      const vfsbPrefix = 'vfsb:';
      const projectPrefix = projectPath + '/';
      const zip = new JSZip();

      // 遍历 localStorage 收集项目文件
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        let filePath = null;
        let isBinary = false;

        if (key.startsWith(vfsPrefix) && !key.endsWith('/__dir__')) {
          filePath = key.slice(vfsPrefix.length);
        } else if (key.startsWith(vfsbPrefix)) {
          filePath = key.slice(vfsbPrefix.length);
          isBinary = true;
        }

        if (!filePath || !filePath.startsWith(projectPrefix)) continue;

        const relativePath = filePath.slice(projectPrefix.length);
        const content = localStorage.getItem(key);
        if (!content) continue;

        if (isBinary) {
          // base64 data URL 转二进制
          try {
            const base64Data = content.split(',')[1];
            if (base64Data) {
              zip.file(relativePath, base64Data, { base64: true });
            }
          } catch (e) {
            console.warn('[saveToLocal] 无法解码二进制文件:', relativePath, e);
          }
        } else {
          zip.file(relativePath, content);
        }
      }

      // 生成 ZIP Blob
      const zipBlob = await zip.generateAsync({ type: 'uint8array' });

      // 在选择的文件夹中创建 ZIP 文件
      const zipFileName = projectName + '.zip';
      const fileHandle = await dirHandle.getFileHandle(zipFileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(zipBlob);
      await writable.close();

      document.getElementById('status-text').textContent =
        (i18n.isEnglish() ? 'Saved to local: ' : '已保存到本地: ') + zipFileName;
      setTimeout(() => {
        document.getElementById('status-text').textContent = i18n.t('status.ready');
      }, 3000);

    } catch (e) {
      if (e.name === 'AbortError') {
        // 用户取消了文件夹选择
        document.getElementById('status-text').textContent = i18n.t('status.ready');
        return;
      }
      console.error('[saveToLocal] 保存失败:', e);
      alert((i18n.isEnglish() ? 'Save to local failed: ' : '保存到本地失败: ') + e.message);
      document.getElementById('status-text').textContent = i18n.t('status.ready');
    }
  }

  /** 显示发布弹窗（美观替代 prompt） */
  function showPublishDialog(projectName, options, onConfirm, onCancel) {
    options = options || {};
    const overlay = document.createElement('div');
    overlay.className = 'publish-dialog-overlay';
    const isEN = i18n.isEnglish();
    const isExt = options.isExtension;
    const existingProject = options.existingProject;
    const existingExtension = options.existingExtension;

    // 已发布警告 (项目)
    let existingProjectHtml = '';
    if (existingProject) {
      var warnTitle = isEN ? 'This project has been published before' : '该作品曾经发布过';
      var warnDesc = existingProject.description ? CommunityAPI.escapeHtml(existingProject.description).slice(0, 60) : (isEN ? 'No description' : '无描述');
      var updateLabel = isEN ? 'Update existing (overwrite)' : '更新已有作品\uff08覆盖\uff09';
      var copyLabel = isEN ? 'Create a new copy' : '创建新副本';
      existingProjectHtml =
        '<div class="publish-warning">' +
          '<span class="publish-warning-icon">⚠️</span>' +
          '<div>' +
            '<div class="publish-warning-title">' + warnTitle + '</div>' +
            '<div class="publish-warning-desc">「' + CommunityAPI.escapeHtml(existingProject.title) + '」 - ' + warnDesc + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="publish-choice">' +
          '<label class="publish-radio">' +
            '<input type="radio" name="project-action" value="update" checked />' +
            '<span>' + updateLabel + '</span>' +
          '</label>' +
          '<label class="publish-radio">' +
            '<input type="radio" name="project-action" value="copy" />' +
            '<span>' + copyLabel + '</span>' +
          '</label>' +
        '</div>';
    }

    // 已发布警告 (扩展)
    let existingExtHtml = '';
    if (existingExtension) {
      var extWarnTitle = isEN ? 'This extension has been published before' : '该扩展曾经发布过';
      var extWarnDesc = existingExtension.description ? CommunityAPI.escapeHtml(existingExtension.description).slice(0, 60) : (isEN ? 'No description' : '无描述');
      var extUpdateLabel = isEN ? 'Update existing extension' : '更新已有扩展\uff08覆盖\uff09';
      var extCopyLabel = isEN ? 'Create a new extension' : '创建新扩展';
      existingExtHtml =
        '<div class="publish-warning">' +
          '<span class="publish-warning-icon">⚠️</span>' +
          '<div>' +
            '<div class="publish-warning-title">' + extWarnTitle + '</div>' +
            '<div class="publish-warning-desc">「' + CommunityAPI.escapeHtml(existingExtension.name) + '」 v' + CommunityAPI.escapeHtml(existingExtension.version || '1.0.0') + ' - ' + extWarnDesc + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="publish-choice">' +
          '<label class="publish-radio">' +
            '<input type="radio" name="ext-action" value="update" checked />' +
            '<span>' + extUpdateLabel + '</span>' +
          '</label>' +
          '<label class="publish-radio">' +
            '<input type="radio" name="ext-action" value="copy" />' +
            '<span>' + extCopyLabel + '</span>' +
          '</label>' +
        '</div>';
    }

    // 扩展项目发布方式选择
    let publishModeHtml = '';
    if (isExt) {
      var modeExtOnly = isEN ? 'Extension only' : '仅发布扩展';
      var modeBoth = isEN ? 'Extension + Project' : '发布扩展 + 作品';
      publishModeHtml =
        '<div class="publish-mode-section">' +
          '<label class="publish-mode-label">' + (isEN ? 'Publish Mode' : '发布方式') + '</label>' +
          '<div class="publish-choice">' +
            '<label class="publish-radio">' +
              '<input type="radio" name="publish-mode" value="ext_only" checked />' +
              '<span>' + modeExtOnly + '</span>' +
            '</label>' +
            '<label class="publish-radio">' +
              '<input type="radio" name="publish-mode" value="both" />' +
              '<span>' + modeBoth + '</span>' +
            '</label>' +
          '</div>' +
        '</div>';
    }

    // 版本号输入 (仅扩展项目显示)
    let versionHtml = '';
    if (isExt) {
      versionHtml =
        '<div class="publish-field publish-field-version">' +
          '<label>' + (isEN ? 'Version' : '版本号') + '</label>' +
          '<input type="text" id="publish-version" value="1.0.0" maxlength="20" />' +
        '</div>';
    }

    overlay.innerHTML =
      '<div class="publish-dialog">' +
        '<div class="publish-dialog-header">' +
          '<h3>\ud83d\ude80 ' + (isEN ? 'Publish to Community' : '发布到社区') + '</h3>' +
          '<button class="publish-close" type="button">&times;</button>' +
        '</div>' +
        '<div class="publish-dialog-body">' +
          publishModeHtml +
          existingExtHtml +
          existingProjectHtml +
          '<div class="publish-field">' +
            '<label>' + (isEN ? 'Title' : '作品标题') + '</label>' +
            '<input type="text" id="publish-title" value="' + CommunityAPI.escapeHtml(projectName) + '" maxlength="100" />' +
          '</div>' +
          versionHtml +
          '<div class="publish-field">' +
            '<label>' + (isEN ? 'Description' : '作品描述') + '</label>' +
            '<textarea id="publish-desc" rows="4" placeholder="' + (isEN ? 'Describe your project...' : '为你的作品写一段描述...') + '"></textarea>' +
            '<div class="publish-char-count"><span id="desc-count">0</span>/500</div>' +
          '</div>' +
        '</div>' +
        '<div class="publish-dialog-footer">' +
          '<button class="publish-btn publish-btn-cancel" type="button">' + (isEN ? 'Cancel' : '取消') + '</button>' +
          '<button class="publish-btn publish-btn-confirm" type="button">' + (isEN ? 'Publish' : '发布') + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    // 字符计数
    const descEl = overlay.querySelector('#publish-desc');
    const countEl = overlay.querySelector('#desc-count');
    descEl.addEventListener('input', () => { countEl.textContent = descEl.value.length; });

    // 关闭
    function close() {
      overlay.remove();
      if (onCancel) onCancel();
    }
    overlay.querySelector('.publish-close').addEventListener('click', close);
    overlay.querySelector('.publish-btn-cancel').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    // 确认
    overlay.querySelector('.publish-btn-confirm').addEventListener('click', () => {
      const title = overlay.querySelector('#publish-title').value.trim();
      const desc = descEl.value.trim();
      if (!title) {
        overlay.querySelector('#publish-title').style.borderColor = 'var(--red, #f38ba8)';
        return;
      }
      let version = '1.0.0';
      if (isExt) {
        version = overlay.querySelector('#publish-version').value.trim() || '1.0.0';
      }
      // 发布模式
      let publishMode = 'project';
      if (isExt) {
        const modeRadios = overlay.querySelectorAll('input[name="publish-mode"]');
        modeRadios.forEach(r => { if (r.checked) publishMode = r.value; });
      }
      // 项目 action
      let projectAction = 'create';
      if (existingProject) {
        overlay.querySelectorAll('input[name="project-action"]').forEach(r => { if (r.checked) projectAction = r.value; });
      }
      // 扩展 action
      let extAction = 'create';
      if (existingExtension) {
        overlay.querySelectorAll('input[name="ext-action"]').forEach(r => { if (r.checked) extAction = r.value; });
      }
      overlay.remove();
      onConfirm({
        title, description: desc, version,
        publishMode,
        projectAction, projectExistingId: existingProject ? existingProject.id : null,
        extAction, extExistingId: existingExtension ? existingExtension.id : null,
        extId: options.extId || null,
      });
    });
  }

  /** 发布项目到社区 */
  async function publishToCommunity() {
    if (!EditorState.projectPath) {
      alert(i18n.t('status.openProjectFirst'));
      return;
    }

    if (typeof CommunityAPI === 'undefined') {
      alert(i18n.isEnglish()
        ? 'Community module not loaded. Please check your network connection.'
        : '社区模块未加载，请检查网络连接。');
      return;
    }

    CommunityAPI.init();
    if (!CommunityAPI.isConfigured()) {
      alert(i18n.isEnglish()
        ? 'Community is not configured yet. Please set up Supabase first.'
        : '社区尚未配置，请先设置 Supabase。');
      return;
    }

    // 恢复登录状态
    await CommunityAPI.restoreSession();

    if (!CommunityAPI.getUser()) {
      alert(i18n.isEnglish()
        ? 'Please login from the home page before publishing.'
        : '请先回到主页登录，然后再发布。');
      return;
    }

    const projectName = EditorState.projectName || '未命名项目';
    const isExtension = EditorState.projectMode === 'extension';

    // 检测是否已发布过同名作品
    let existingProject = null;
    let existingExtension = null;
    let extId = null;
    try {
      existingProject = await CommunityAPI.getUserProjectByTitle(CommunityAPI.getUser().id, projectName);
    } catch (e) {
      console.warn('[publish] 检查已有作品失败:', e);
    }

    // 如果是扩展项目，收集扩展文件并检测已有扩展
    let extensionFileContent = null;
    if (isExtension) {
      const projectPath = EditorState.projectPath.replace(/\\/g, '/').replace(/\/+$/, '');
      const vfsPrefix = 'vfs:';
      const extDir = projectPath + '/extensions/';

      // 收集扩展目录下的文件
      let extFiles = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key.startsWith(vfsPrefix)) continue;
        const filePath = key.slice(vfsPrefix.length);
        if (filePath.startsWith(extDir) && !filePath.endsWith('/__dir__')) {
          const fileName = filePath.slice(extDir.length);
          const content = localStorage.getItem(key);
          if (content) {
            extFiles.push({ name: fileName, content: content });
          }
        }
      }

      // 取第一个扩展文件作为主要内容
      if (extFiles.length > 0) {
        // 尝试解析 JSON 提取 extId 和 version
        try {
          const parsed = JSON.parse(extFiles[0].content);
          extId = parsed.id || parsed.ext_id || projectName.replace(/\s+/g, '_').toLowerCase();
        } catch (e) {
          extId = projectName.replace(/\s+/g, '_').toLowerCase();
        }
        extensionFileContent = extFiles[0].content;
      }

      // 检测已有扩展
      if (extId) {
        try {
          existingExtension = await CommunityAPI.getUserExtensionByName(CommunityAPI.getUser().id, projectName);
        } catch (e) {
          console.warn('[publish] 检查已有扩展失败:', e);
        }
      }
    }

    // 显示发布弹窗
    showPublishDialog(projectName, {
      isExtension,
      existingProject,
      existingExtension,
      extId,
    }, async (formData) => {
      document.getElementById('status-text').textContent = i18n.isEnglish() ? 'Publishing to community...' : '正在发布到社区...';

      try {
        // 先保存到 VFS
        await ProjectManager.saveProject();
        EditorState._isDirty = false;
        EditorState._blocksSnapshot = JSON.stringify(EditorState.blocks);

        let projectId = null;
        let extResultId = null;

        // ===== 发布扩展 =====
        if (isExtension && (formData.publishMode === 'ext_only' || formData.publishMode === 'both')) {
          // 重新收集扩展文件（发布时可能已修改）
          let currentExtFileContent = extensionFileContent;
          if (!currentExtFileContent) {
            const pp = EditorState.projectPath.replace(/\\/g, '/').replace(/\/+$/, '');
            const vfsPfx = 'vfs:';
            const eDir = pp + '/extensions/';
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i);
              if (!k.startsWith(vfsPfx)) continue;
              const fp = k.slice(vfsPfx.length);
              if (fp.startsWith(eDir) && !fp.endsWith('/__dir__')) {
                const c = localStorage.getItem(k);
                if (c) { currentExtFileContent = c; break; }
              }
            }
          }

          if (!currentExtFileContent) {
            const noFileMsg = i18n.isEnglish()
              ? 'No extension files found in extensions/ directory. Please create and save at least one .json or .js file.'
              : '未找到扩展文件。请在 extensions/ 目录下新建并保存至少一个 .json 或 .js 文件。';
            alert(noFileMsg);
            document.getElementById('status-text').textContent = i18n.t('status.ready');
            return;
          }

          let extResult;
          if (formData.extAction === 'update' && formData.extExistingId) {
            extResult = await CommunityAPI.updateExtension(formData.extExistingId, {
              name: formData.title,
              description: formData.description,
              version: formData.version,
            }, currentExtFileContent);
            extResultId = formData.extExistingId;
          } else {
            extResult = await CommunityAPI.publishExtension(
              formData.title,
              formData.extId || projectName.replace(/\s+/g, '_').toLowerCase(),
              formData.description,
              formData.version,
              currentExtFileContent
            );
            extResultId = extResult.data?.id;
          }

          if (extResult.error) {
            const extErrMsg = (i18n.isEnglish() ? 'Extension publish failed: ' : '扩展发布失败: ') + (extResult.error.message || extResult.error);
            if (formData.publishMode === 'ext_only') {
              alert(extErrMsg);
              document.getElementById('status-text').textContent = i18n.t('status.ready');
              return;
            } else {
              console.warn('[publish]', extErrMsg);
            }
          }
        }

        // ===== 发布作品 =====
        if (!isExtension || formData.publishMode === 'both') {
          // 收集项目文件并生成 ZIP
          const projectPath = EditorState.projectPath.replace(/\\/g, '/').replace(/\/+$/, '');
          const vfsPrefix = 'vfs:';
          const vfsbPrefix = 'vfsb:';
          const projectPrefix = projectPath + '/';
          const zip = new JSZip();
          let mainJsonData = null;
          let projectRenderMode = '2d';

          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            let filePath = null;
            let isBinary = false;

            if (key.startsWith(vfsPrefix) && !key.endsWith('/__dir__')) {
              filePath = key.slice(vfsPrefix.length);
            } else if (key.startsWith(vfsbPrefix)) {
              filePath = key.slice(vfsbPrefix.length);
              isBinary = true;
            }

            if (!filePath || !filePath.startsWith(projectPrefix)) continue;

            const relativePath = filePath.slice(projectPrefix.length);
            const content = localStorage.getItem(key);
            if (!content) continue;

            if ((relativePath === 'main.json' || relativePath === 'scripts/main.json') && !isBinary) {
              mainJsonData = content;
            }

            if (isBinary) {
              try {
                const base64Data = content.split(',')[1];
                if (base64Data) zip.file(relativePath, base64Data, { base64: true });
              } catch (e) {
                console.warn('[publish] 无法解码二进制文件:', relativePath, e);
              }
            } else {
              zip.file(relativePath, content);
            }
          }

          // 读取 project.json 获取渲染模式
          try {
            const cfgStr = localStorage.getItem('vfs:' + projectPath + '/project.json');
            if (cfgStr) {
              const cfg = JSON.parse(cfgStr);
              if (cfg.renderMode) projectRenderMode = cfg.renderMode;
            }
          } catch(e) {}

          const zipBlob = new Blob([await zip.generateAsync({ type: 'uint8array' })], { type: 'application/zip' });

          if (formData.projectAction === 'update' && formData.projectExistingId) {
            const projResult = await CommunityAPI.updateProject(formData.projectExistingId, {
              title: formData.title,
              description: formData.description,
              json_data: mainJsonData,
              render_mode: projectRenderMode,
            }, zipBlob);
            projectId = formData.projectExistingId;
            if (projResult.error) {
              alert((i18n.isEnglish() ? 'Project publish failed: ' : '作品发布失败: ') + (projResult.error.message || projResult.error));
              document.getElementById('status-text').textContent = i18n.t('status.ready');
              return;
            }
          } else {
            const projResult = await CommunityAPI.publishProject({
              title: formData.title,
              description: formData.description,
              json_data: mainJsonData,
              render_mode: projectRenderMode,
              is_public: true
            }, zipBlob);
            projectId = projResult.data?.id || projResult.data?.[0]?.id;
            if (projResult.error) {
              alert((i18n.isEnglish() ? 'Project publish failed: ' : '作品发布失败: ') + (projResult.error.message || projResult.error));
              document.getElementById('status-text').textContent = i18n.t('status.ready');
              return;
            }
          }
        }

        // 成功
        const isEN = i18n.isEnglish();
        let successMsg;
        if (isExtension && formData.publishMode === 'ext_only') {
          successMsg = isEN ? 'Extension published!' : '扩展已发布！';
        } else if (isExtension && formData.publishMode === 'both') {
          successMsg = isEN ? 'Extension & project published!' : '扩展与作品已发布！';
        } else {
          successMsg = isEN ? 'Published to community!' : '已发布到社区！';
        }

        document.getElementById('status-text').textContent = successMsg;
        setTimeout(() => {
          document.getElementById('status-text').textContent = i18n.t('status.ready');
        }, 3000);

        // 查看
        let viewUrl = null;
        if (projectId) {
          viewUrl = '../community/project-detail.html?id=' + projectId;
        } else if (extResultId) {
          viewUrl = '../community/extension-detail.html?id=' + extResultId;
        }

        if (viewUrl && confirm((isEN ? 'Published! View in community?' : '发布成功！是否在社区中查看？'))) {
          window.open(viewUrl, '_blank');
        }

      } catch (e) {
        console.error('[publish] 发布失败:', e);
        alert((i18n.isEnglish() ? 'Publish failed: ' : '发布失败: ') + e.message);
        document.getElementById('status-text').textContent = i18n.t('status.ready');
      }
    });
  }

  // ============================================================
  // 高级模式 (Godot-style) 初始化
  // ============================================================
  let _codeMirrorInstance = null;
  let _spriteScripts = {}; // index -> JS code
  let _nodeScripts = {};   // nodeId -> JS code（非 Sprite2D 节点的脚本）
  let _advancedInitialized = false;
  let _editorSpriteIdx = -1;  // 当前编辑器关联的精灵索引（不依赖 SceneGraph 选中状态）

  /** 设置编辑器当前关联的精灵索引（供 SceneTree.selectNode 调用） */
  function setEditorSpriteIdx(idx) { _editorSpriteIdx = idx; }
  /** 获取编辑器当前关联的精灵索引 */
  function getEditorSpriteIdx() { return _editorSpriteIdx; }

  function initAdvancedMode() {
    if (_advancedInitialized) return;
    _advancedInitialized = true;

    const mainLayout = document.getElementById('main-layout');
    const advancedLayout = document.getElementById('advanced-layout');
    if (!mainLayout || !advancedLayout) return;

    // 先将面板恢复到 main-layout（可能被 MC 模式或其他模式移走了）
    const palettePanel = document.getElementById('palette-panel');
    const editorPanel = document.getElementById('editor-panel');
    if (palettePanel && palettePanel.parentNode !== mainLayout) {
      mainLayout.insertBefore(palettePanel, mainLayout.firstChild);
    }
    if (editorPanel && editorPanel.parentNode !== mainLayout) {
      palettePanel?.parentNode?.insertBefore(editorPanel, palettePanel.nextSibling);
    }

    // 切换布局
    mainLayout.classList.add('hidden');
    advancedLayout.classList.remove('hidden');

    // 将积木面板和编辑器面板移入脚本区域
    const editorCanvas = document.getElementById('editor-canvas');
    const blocksContent = document.getElementById('script-blocks-content');
    if (palettePanel && blocksContent) blocksContent.appendChild(palettePanel);
    if (editorPanel && blocksContent) blocksContent.appendChild(editorPanel);

    // 舞台和输出使用独立面板窗口（与普通模式相同）
    _lastStageJSON = '';  // 重置脏检查，确保初始数据能推送到面板
    _initPanels();

    // 画布移入新容器后，重新计算尺寸
    setTimeout(() => {
      if (typeof EditorCanvas !== 'undefined') {
        EditorCanvas.resize();
        EditorCanvas.render();
      }
    }, 50);

    // 初始化 SceneGraph（场景图核心）
    const renderMode = (typeof EditorState !== 'undefined' && EditorState.renderMode) || '2d';
    if (typeof SceneGraph !== 'undefined') {
      SceneGraph.init(renderMode);
      // 同步到 StageManager
      if (typeof StageManager !== 'undefined') {
        StageManager.syncFromSceneGraph();
      }
    }

    // 初始化场景树、检查器和文件系统
    if (typeof SceneTree !== 'undefined') SceneTree.init();
    if (typeof Inspector !== 'undefined') Inspector.init();
    if (typeof FileSystemDock !== 'undefined') FileSystemDock.init();

    // 初始化 CodeMirror
    const jsEditorEl = document.getElementById('js-editor');
    if (jsEditorEl && typeof CodeMirror !== 'undefined') {
      _codeMirrorInstance = CodeMirror(jsEditorEl, {
        mode: 'javascript',
        theme: 'material-darker',
        lineNumbers: true,
        tabSize: 2,
        indentWithTabs: false,
        matchBrackets: true,
        autoCloseBrackets: true,
        value: '// 在此编写 JavaScript 代码\n// 可用对象：sprite（当前角色）、globalVars（全局变量）\n// 示例：\n// sprite.x = 100;\n// sprite.say("Hello!");\n',
      });
      // 实时保存代码：使用 _editorSpriteIdx 跟踪（不依赖 SceneGraph 选中状态）
      _codeMirrorInstance.on('change', () => {
        const selId = (typeof SceneGraph !== 'undefined') ? SceneGraph.getSelectedId() : null;

        if (_editorSpriteIdx >= 0) {
          _spriteScripts[_editorSpriteIdx] = _codeMirrorInstance.getValue();
        } else if (selId) {
          _nodeScripts[selId] = _codeMirrorInstance.getValue();
        }
      });
    }

    // 脚本 tab 切换
    const scriptTabs = document.querySelectorAll('.script-tab');
    scriptTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        scriptTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const tabName = tab.dataset.tab;
        document.getElementById('script-blocks-content').classList.toggle('hidden', tabName !== 'blocks');
        document.getElementById('script-js-content').classList.toggle('hidden', tabName !== 'js');
        if (tabName === 'js' && _codeMirrorInstance) {
          _codeMirrorInstance.refresh();
        }
      });
    });

    // 3D 和 UI 场景仅支持 JS 脚本，隐藏积木 tab
    if (typeof SceneGraph !== 'undefined' && SceneGraph.isJsOnly && SceneGraph.isJsOnly()) {
      const blocksTab = document.querySelector('.script-tab[data-tab="blocks"]');
      const jsTab = document.querySelector('.script-tab[data-tab="js"]');
      if (blocksTab) blocksTab.classList.add('hidden');
      if (jsTab) jsTab.click();
    }

    // ⧉ 新窗口编辑代码（支持任意节点类型）
    const popoutBtn = document.getElementById('btn-popout-js');
    if (popoutBtn && window.api && window.api.openJsEditor) {
      popoutBtn.addEventListener('click', () => {
        // 获取当前选中节点
        const selId = (typeof SceneGraph !== 'undefined') ? SceneGraph.getSelectedId() : null;
        const selIdx = (typeof SceneTree !== 'undefined') ? SceneTree.getSelectedIndex() : -1;

        if (!selId) {
          alert('请先在场景树中选择一个节点');
          return;
        }

        const node = (typeof SceneGraph !== 'undefined') ? SceneGraph.getNode(selId) : null;
        const isSprite = node && node.type === 'Sprite2D';
        const name = node ? node.name : '脚本';

        // 先保存当前编辑器内容
        if (_codeMirrorInstance) {
          // 精灵节点用 spriteIdx，其他节点用 nodeId
          if (isSprite && selIdx >= 0) {
            EditorApp.setSpriteScript(selIdx, _codeMirrorInstance.getValue());
          } else {
            _nodeScripts[selId] = _codeMirrorInstance.getValue();
          }
        }

        // 获取代码：优先用节点 ID 存储，回退到精灵索引
        let code;
        if (_nodeScripts[selId] !== undefined) {
          code = _nodeScripts[selId];
        } else if (isSprite && selIdx >= 0) {
          code = _spriteScripts[selIdx] || '// 在此编写 JavaScript 代码\n';
        } else {
          code = '// 在此编写 JavaScript 代码\n';
        }

        // 传递 nodeId 和 spriteIdx 用于回调识别
        window.api.openJsEditor({
          spriteIdx: selId,  // 用节点 ID 作为标识
          name: name + '.js',
          code: code
        });
      });

      // 监听外部窗口保存的代码
      window.api.onJsEditorCodeUpdated((nodeId, code) => {
        // 判断是精灵节点还是其他节点
        const node = (typeof SceneGraph !== 'undefined') ? SceneGraph.getNode(nodeId) : null;
        const isSprite = node && node.type === 'Sprite2D';
        const selIdx = (typeof SceneTree !== 'undefined') ? SceneTree.getSelectedIndex() : -1;

        if (isSprite && selIdx >= 0) {
          _spriteScripts[selIdx] = code;
        } else {
          _nodeScripts[nodeId] = code;
        }

        // 如果当前正在编辑这个节点，同步到内嵌编辑器
        const curSelId = (typeof SceneGraph !== 'undefined') ? SceneGraph.getSelectedId() : null;
        if (curSelId === nodeId && _codeMirrorInstance) {
          const cursor = _codeMirrorInstance.getCursor();
          _codeMirrorInstance.setValue(code);
          _codeMirrorInstance.setCursor(cursor);
        }

        const nodeName = node ? node.name : nodeId;
        document.getElementById('status-text').textContent = '已保存代码: ' + nodeName;
        console.log('[JS Editor] 外部窗口保存代码:', nodeName);
      });
    }

    // ==================== 编辑器全屏功能 ====================
    let _fsPanel = null;  // 当前全屏的面板
    let _fsExitBtn = null;

    function enterFullscreen(panel) {
      if (_fsPanel) exitFullscreen();
      panel.classList.add('panel-fullscreen');
      // 保持 tab 栏可见，让用户自由切换积木/JS 模式
      // 添加退出按钮
      _fsExitBtn = document.createElement('button');
      _fsExitBtn.className = 'fullscreen-exit';
      _fsExitBtn.innerHTML = '<img src="../icons/窗口操作图标/关闭.svg" class="tb-icon" style="height:12px;margin:0;"> 退出全屏 (Esc)';
      _fsExitBtn.addEventListener('click', exitFullscreen);
      panel.appendChild(_fsExitBtn);
      _fsPanel = panel;
      // 刷新当前内容区域
      _refreshContent();
    }

    function exitFullscreen() {
      if (!_fsPanel) return;
      _fsPanel.classList.remove('panel-fullscreen');
      if (_fsExitBtn) { _fsExitBtn.remove(); _fsExitBtn = null; }
      _fsPanel = null;
      _refreshContent();
    }

    function _refreshContent() {
      if (typeof EditorCanvas !== 'undefined' && EditorCanvas.resize) {
        setTimeout(() => EditorCanvas.resize(), 50);
      }
      if (_codeMirrorInstance) setTimeout(() => _codeMirrorInstance.refresh(), 50);
    }

    // 单一全屏按钮
    document.getElementById('btn-fs-editor')?.addEventListener('click', () => {
      if (_fsPanel) {
        exitFullscreen();
      } else {
        const panel = document.getElementById('script-editor-panel');
        if (panel) enterFullscreen(panel);
      }
    });

    // Esc 退出全屏 / F11 切换全屏
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && _fsPanel) {
        e.preventDefault();
        exitFullscreen();
      }
      if (e.key === 'F11') {
        e.preventDefault();
        const panel = document.getElementById('script-editor-panel');
        if (_fsPanel) {
          exitFullscreen();
        } else if (panel) {
          enterFullscreen(panel);
        }
      }
    });

    // 窗口 resize 时刷新内容
    window.addEventListener('resize', () => {
      if (_fsPanel) _refreshContent();
    });

    // 分割条拖拽调整高度
    const divider = document.getElementById('center-divider');
    const scriptPanel = document.getElementById('script-editor-panel');
    if (divider && scriptPanel) {
      let dragging = false;
      divider.addEventListener('mousedown', (e) => {
        dragging = true;
        e.preventDefault();
      });
      document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const center = document.getElementById('advanced-center');
        if (!center) return;
        const rect = center.getBoundingClientRect();
        const newHeight = rect.bottom - e.clientY;
        scriptPanel.style.height = Math.max(120, Math.min(newHeight, rect.height - 200)) + 'px';
        if (_codeMirrorInstance) _codeMirrorInstance.refresh();
      });
      document.addEventListener('mouseup', () => { dragging = false; });
    }

    // 自动选中第一个节点
    setTimeout(() => {
      if (typeof SceneGraph !== 'undefined' && typeof Inspector !== 'undefined') {
        const root = SceneGraph.getRoot();
        if (root && root.children && root.children.length > 0) {
          SceneTree.selectNode(root.children[0]);
        } else if (root) {
          Inspector.showNode(root.id);
        }
      }
    }, 100);

    // 注册 JS 脚本回调（周期性执行，与积木和事件循环同步）
    if (typeof Executor !== 'undefined' && Executor.setPostStartCallback) {
      Executor.setPostStartCallback(async () => {
        await runAdvancedScripts();
      });
      console.log('[高级模式] JS 脚本回调已注册');
    } else {
      console.warn('[高级模式] Executor 或 setPostStartCallback 不可用!');
    }

    console.log('[高级模式] Godot 式编辑器已初始化');
  }

  /** 初始化数据分析模式 */
  function initDataMode() {
    if (typeof DataAnalysis !== 'undefined') {
      DataAnalysis.init();
    }
    console.log('[数据分析模式] 已初始化');
  }

  /** 初始化 Minecraft 模组开发模式 */
  function initMinecraftMode() {
    if (typeof MinecraftMod !== 'undefined') {
      MinecraftMod.init();
    }
    console.log('[Minecraft 模组模式] 已初始化');
  }

  /** 初始化代码编程模式 */
  let _codeEditor = null;
  let _codeModeInitialized = false;
  let _hintDebounce = null;

  /** 注册代码自动补全 */
  function _registerCodeHints(editor, cmMode) {
    // 语言关键词字典
    const keywords = {
      'python': [
        'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await',
        'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except',
        'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is',
        'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try',
        'while', 'with', 'yield',
        // 内建函数
        'abs', 'all', 'any', 'bin', 'bool', 'bytes', 'callable', 'chr',
        'classmethod', 'compile', 'complex', 'delattr', 'dict', 'dir',
        'divmod', 'enumerate', 'eval', 'exec', 'filter', 'float', 'format',
        'frozenset', 'getattr', 'globals', 'hasattr', 'hash', 'help', 'hex',
        'id', 'input', 'int', 'isinstance', 'issubclass', 'iter', 'len',
        'list', 'locals', 'map', 'max', 'memoryview', 'min', 'next',
        'object', 'oct', 'open', 'ord', 'pow', 'print', 'property', 'range',
        'repr', 'reversed', 'round', 'set', 'setattr', 'slice', 'sorted',
        'staticmethod', 'str', 'sum', 'super', 'tuple', 'type', 'vars', 'zip',
        // 常用模块
        'os', 'sys', 'math', 'random', 'time', 'datetime', 'json', 're',
        'collections', 'itertools', 'functools', 'pathlib', 'subprocess',
      ],
      'javascript': [
        'arguments', 'await', 'break', 'case', 'catch', 'class', 'const',
        'continue', 'debugger', 'default', 'delete', 'do', 'else', 'export',
        'extends', 'false', 'finally', 'for', 'function', 'if', 'import',
        'in', 'instanceof', 'let', 'new', 'null', 'of', 'return', 'static',
        'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'undefined',
        'var', 'void', 'while', 'with', 'yield',
        // 全局对象
        'console', 'document', 'window', 'Math', 'JSON', 'Array', 'Object',
        'String', 'Number', 'Boolean', 'Date', 'RegExp', 'Map', 'Set',
        'Promise', 'Symbol', 'Proxy', 'Reflect', 'parseInt', 'parseFloat',
        'isNaN', 'isFinite', 'setTimeout', 'setInterval', 'clearTimeout',
        'clearInterval', 'fetch', 'alert', 'prompt', 'confirm',
      ],
      'text/x-c++src': [
        'alignas', 'alignof', 'and', 'asm', 'auto', 'bitand', 'bitor',
        'bool', 'break', 'case', 'catch', 'char', 'class', 'compl',
        'concept', 'const', 'consteval', 'constexpr', 'continue', 'co_await',
        'co_return', 'co_yield', 'decltype', 'default', 'delete', 'do',
        'double', 'else', 'enum', 'explicit', 'export', 'extern', 'false',
        'float', 'for', 'friend', 'goto', 'if', 'inline', 'int', 'long',
        'mutable', 'namespace', 'new', 'noexcept', 'not', 'nullptr', 'operator',
        'or', 'private', 'protected', 'public', 'register', 'requires',
        'return', 'short', 'signed', 'sizeof', 'static', 'struct', 'switch',
        'template', 'this', 'throw', 'true', 'try', 'typedef', 'typeid',
        'typename', 'union', 'unsigned', 'using', 'virtual', 'void', 'volatile',
        'wchar_t', 'while', 'xor',
        // 标准库
        'std', 'cout', 'cin', 'endl', 'string', 'vector', 'map', 'set',
        'array', 'pair', 'queue', 'stack', 'algorithm', 'iostream',
      ],
    };

    const words = keywords[cmMode] || keywords['javascript'];

    // 自定义 hint 函数
    function wordHint(cm) {
      const cur = cm.getCursor();
      const token = cm.getTokenAt(cur);
      let start = token.start;
      let end = cur.ch;
      const word = token.string.slice(0, end - start);

      if (!word || word.length < 1) return null;

      const list = words.filter(w => w.startsWith(word) && w !== word);

      // 也从当前文档提取标识符
      const docText = cm.getValue();
      const docWords = docText.match(/\b[a-zA-Z_]\w*\b/g) || [];
      const uniqueDocWords = [...new Set(docWords)].filter(w => w.startsWith(word) && w !== word && !list.includes(w));

      const allList = [...list, ...uniqueDocWords].sort().slice(0, 50);

      if (allList.length === 0) return null;

      return {
        list: allList,
        from: CodeMirror.Pos(cur.line, start),
        to: CodeMirror.Pos(cur.line, end),
      };
    }

    // 注册到 CodeMirror
    CodeMirror.registerHelper('hint', cmMode.includes('python') ? 'python' : (cmMode === 'text/x-c++src' ? 'clike' : 'javascript-custom'), wordHint);

    // 输入时自动弹出补全（防抖 300ms）
    let debounceTimer = null;
    editor.on('inputRead', (cm, change) => {
      if (change.text[0] && /^[a-zA-Z_]$/.test(change.text[0])) {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          const cur = cm.getCursor();
          const token = cm.getTokenAt(cur);
          if (token.string.length >= 2 && /^[a-zA-Z_]\w*$/.test(token.string)) {
            cm.showHint({ hint: wordHint, completeSingle: false });
          }
        }, 300);
      }
    });
  }

  function initCodeMode(mode) {
    if (_codeModeInitialized) return;
    _codeModeInitialized = true;

    // 语言和 CodeMirror 模式映射
    const langConfig = {
      'code-python':     { label: 'Python',     cmMode: 'python',         ext: 'py',  template: '# Python\nprint("Hello, World!")\n' },
      'code-cpp':        { label: 'C++',        cmMode: 'text/x-c++src',  ext: 'cpp', template: '#include <iostream>\nusing namespace std;\n\nint main() {\n    cout << "Hello, World!" << endl;\n    return 0;\n}\n' },
      'code-javascript': { label: 'JavaScript', cmMode: 'javascript',     ext: 'js',  template: '// JavaScript\nconsole.log("Hello, World!");\n' },
    };
    const cfg = langConfig[mode] || langConfig['code-python'];
    console.log(`[代码编程模式] ${cfg.label} 已初始化`);

    // 隐藏所有其他布局
    document.getElementById('main-layout')?.classList.add('hidden');
    document.getElementById('advanced-layout')?.classList.add('hidden');
    document.getElementById('data-layout')?.classList.add('hidden');
    document.getElementById('mc-layout')?.classList.add('hidden');
    document.getElementById('toolbar')?.classList.add('hidden');
    document.getElementById('palette-panel')?.classList.add('hidden');
    document.getElementById('stage-panel')?.classList.add('hidden');

    // 显示代码编辑器布局
    const codeLayout = document.getElementById('code-layout');
    if (codeLayout) codeLayout.classList.remove('hidden');

    // 更新语言标签
    const langLabel = document.getElementById('code-lang-label');
    if (langLabel) langLabel.textContent = cfg.label;

    // 初始化 CodeMirror
    const editorWrap = document.getElementById('code-editor-wrap');
    if (editorWrap && typeof CodeMirror !== 'undefined' && !_codeEditor) {
      // 临时显示布局以正确计算尺寸
      const wasHidden = codeLayout.classList.contains('hidden');
      if (wasHidden) {
        codeLayout.style.visibility = 'hidden';
        codeLayout.style.position = 'absolute';
        codeLayout.classList.remove('hidden');
      }

      _codeEditor = CodeMirror(editorWrap, {
        mode: cfg.cmMode,
        theme: 'material-darker',
        lineNumbers: true,
        tabSize: 4,
        indentWithTabs: false,
        matchBrackets: true,
        autoCloseBrackets: true,
        value: cfg.template,
        extraKeys: { 'Ctrl-Space': 'autocomplete' },
        hintOptions: { completeSingle: false },
      });

      // 注册语言特定的关键词补全
      _registerCodeHints(_codeEditor, cfg.cmMode);

      if (wasHidden) {
        codeLayout.classList.add('hidden');
        codeLayout.style.visibility = '';
        codeLayout.style.position = '';
      }

      // 延迟刷新确保正确渲染
      setTimeout(() => _codeEditor && _codeEditor.refresh(), 100);
    }

    // 绑定工具栏按钮
    document.getElementById('code-save-btn')?.addEventListener('click', async () => {
      if (!_codeEditor || !EditorState.projectPath) return;
      const code = _codeEditor.getValue();
      await window.api.writeFile(EditorState.projectPath + '/scripts/main.' + cfg.ext, code);
      const statusText = document.getElementById('code-status');
      if (statusText) {
        statusText.textContent = '✓ 已保存';
        setTimeout(() => { statusText.textContent = ''; }, 2000);
      }
      document.getElementById('status-text').textContent = '代码已保存';
      setTimeout(() => {
        document.getElementById('status-text').textContent = i18n.t('status.ready');
      }, 2000);
    });

    document.getElementById('code-clear-btn')?.addEventListener('click', () => {
      if (!_codeEditor) return;
      if (confirm('确定清空所有代码吗？')) {
        _codeEditor.setValue('');
      }
    });

    document.getElementById('code-run-btn')?.addEventListener('click', async () => {
      if (!_codeEditor) return;
      const code = _codeEditor.getValue();
      const outputWrap = document.getElementById('code-output-wrap');
      const outputEl = document.getElementById('code-output');
      const runBtn = document.getElementById('code-run-btn');
      const stopBtn = document.getElementById('code-stop-btn');
      const statusEl = document.getElementById('code-status');
      const inputBar = document.getElementById('code-input-bar');
      const stdinInput = document.getElementById('code-stdin-input');
      const stdinSend = document.getElementById('code-stdin-send');

      const langKey = cfg.cmMode === 'python' ? 'python' : (cfg.cmMode === 'javascript' ? 'javascript' : 'cpp');

      // 显示输出面板，清空内容
      outputWrap?.classList.remove('hidden');
      if (outputEl) outputEl.textContent = '';
      if (runBtn) runBtn.disabled = true;
      if (stopBtn) stopBtn.disabled = false;
      if (statusEl) statusEl.textContent = '运行中...';
      // 显示 stdin 输入栏（Python/C++ 可能需要 input()）
      inputBar?.classList.remove('hidden');

      // 设置流式输出监听（必须在 runCode 之前注册）
      if (window.api && window.api.onCodeOutput) {
        window.api.onCodeOutput((text, type) => {
          if (outputEl) {
            outputEl.textContent += text;
            // 自动滚动到底部
            outputEl.scrollTop = outputEl.scrollHeight;
          }
        });
        window.api.onCodeDone((exitCode) => {
          if (runBtn) runBtn.disabled = false;
          if (stopBtn) stopBtn.disabled = true;
          if (statusEl) statusEl.textContent = exitCode === 0 ? '✓ 完成' : `退出码 ${exitCode}`;
          if (outputEl) outputEl.textContent += `\n[进程结束, 退出码 ${exitCode}]`;
          inputBar?.classList.add('hidden');
          setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 5000);
        });
      }

      // stdin 发送函数
      async function sendStdin() {
        if (!stdinInput) return;
        const text = stdinInput.value;
        stdinInput.value = '';
        if (outputEl) {
          outputEl.textContent += text + '\n';
          outputEl.scrollTop = outputEl.scrollHeight;
        }
        if (window.api && window.api.sendCodeStdin) {
          await window.api.sendCodeStdin(text);
        }
      }
      if (stdinSend) stdinSend.onclick = sendStdin;
      if (stdinInput) stdinInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); sendStdin(); } };

      try {
        if (window.api && window.api.runCode) {
          await window.api.runCode(langKey, code, EditorState.projectPath);
        } else {
          // Web 环境回退
          if (langKey === 'javascript') {
            if (outputEl) {
              const origLog = console.log;
              console.log = (...args) => {
                outputEl.textContent += args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ') + '\n';
                outputEl.scrollTop = outputEl.scrollHeight;
                origLog(...args);
              };
              try {
                new Function(code)();
                outputEl.textContent += '[执行完成]\n';
              } catch (e) {
                outputEl.textContent += '❌ ' + e.message + '\n';
              }
              console.log = origLog;
            }
          } else {
            if (outputEl) {
              outputEl.textContent = `ℹ️ ${cfg.label} 代码只能在桌面版中运行。`;
            }
          }
          if (runBtn) runBtn.disabled = false;
          if (stopBtn) stopBtn.disabled = true;
          inputBar?.classList.add('hidden');
          if (statusEl) statusEl.textContent = '✓ 完成';
          setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
        }
      } catch (e) {
        if (outputEl) outputEl.textContent += '❌ ' + e.message + '\n';
        if (runBtn) runBtn.disabled = false;
        if (stopBtn) stopBtn.disabled = true;
        inputBar?.classList.add('hidden');
        if (statusEl) statusEl.textContent = '❌ 错误';
      }
    });

    document.getElementById('code-stop-btn')?.addEventListener('click', async () => {
      if (window.api && window.api.stopCode) {
        await window.api.stopCode();
      }
      const outputEl = document.getElementById('code-output');
      if (outputEl) outputEl.textContent += '\n[已停止]';
      const runBtn = document.getElementById('code-run-btn');
      const stopBtn = document.getElementById('code-stop-btn');
      const inputBar = document.getElementById('code-input-bar');
      if (runBtn) runBtn.disabled = false;
      if (stopBtn) stopBtn.disabled = true;
      inputBar?.classList.add('hidden');
    });

    // 加载已保存的代码
    _loadCodeFile(cfg.ext).then(code => {
      if (code && _codeEditor) {
        _codeEditor.setValue(code);
        setTimeout(() => _codeEditor && _codeEditor.refresh(), 100);
      }
    });

    // 窗口大小改变时刷新
    window.addEventListener('resize', () => {
      if (_codeEditor) setTimeout(() => _codeEditor.refresh(), 100);
    });

    // 在状态栏显示当前语言
    const statusText = document.getElementById('status-text');
    if (statusText) {
      statusText.textContent = `代码编程：${cfg.label}`;
    }
  }

  /** 加载已保存的代码文件 */
  async function _loadCodeFile(ext) {
    if (!EditorState.projectPath) return null;
    try {
      return await window.api.readFile(EditorState.projectPath + '/scripts/main.' + ext);
    } catch {
      return null;
    }
  }

  /** 获取代码编辑器实例 */
  function getCodeEditor() {
    return _codeEditor;
  }

  /** 获取当前精灵的 JS 脚本 */
  function getSpriteScript(index) {
    return _spriteScripts[index] || '';
  }

  /** 设置当前精灵的 JS 脚本 */
  function setSpriteScript(index, code) {
    _spriteScripts[index] = code;
  }

  /** 获取所有精灵脚本（用于保存） */
  function getAllSpriteScripts() {
    return { ..._spriteScripts };
  }

  /** 批量设置精灵脚本（用于加载） */
  function setAllSpriteScripts(scripts) {
    _spriteScripts = scripts || {};
  }

  /** 获取 CodeMirror 实例 */
  function getJsEditor() {
    return _codeMirrorInstance;
  }

  /** 获取节点的 JS 脚本（非 Sprite2D 节点） */
  function getNodeScript(nodeId) {
    return _nodeScripts[nodeId] || '';
  }

  /** 设置节点的 JS 脚本（非 Sprite2D 节点） */
  function setNodeScript(nodeId, code) {
    _nodeScripts[nodeId] = code;
  }

  document.addEventListener('DOMContentLoaded', async () => {
    // 全局错误捕获（帮助定位问题）
    window.addEventListener('error', (e) => {
      console.error('[全局错误]', e.message, e.filename, e.lineno);
    });
    window.addEventListener('unhandledrejection', (e) => {
      console.error('[未处理的Promise拒绝]', e.reason);
    });

    // 加载用户设置的主题和自定义CSS
    try {
      const settings = JSON.parse(localStorage.getItem('objector-settings') || '{}');
      if (settings.theme) {
        document.documentElement.setAttribute('data-theme', settings.theme);
      }
      if (settings.customCss) {
        let styleEl = document.getElementById('custom-style');
        if (!styleEl) {
          styleEl = document.createElement('style');
          styleEl.id = 'custom-style';
          document.head.appendChild(styleEl);
        }
        styleEl.textContent = settings.customCss;
      }
    } catch (e) {
      console.warn('[设置] 加载主题失败:', e);
    }

    // 应用 i18n 到 DOM
    i18n.applyToDOM();

    // 获取 URL 参数中的渲染模式
    const params = new URLSearchParams(window.location.search);
    const renderMode = params.get('render') || '2d';

    try {
    // 初始化各模块
    console.log('[初始化] EditorCanvas...');
    EditorCanvas.init();
    console.log('[初始化] Palette...');
    Palette.init();

    // 根据渲染模式初始化舞台（离屏 canvas，实际渲染由面板窗口负责）
    if (renderMode === '3d' && typeof Stage3D !== 'undefined') {
      console.log('[初始化] Stage3D (3D 模式)...');
      let stageCanvas = document.getElementById('stage-canvas');
      if (!stageCanvas) {
        stageCanvas = document.createElement('canvas');
        stageCanvas.id = 'stage-canvas';
        stageCanvas.width = 480;
        stageCanvas.height = 360;
        console.log('[初始化] 使用离屏 canvas 供 Stage3D');
      }
      const success = Stage3D.init(stageCanvas);
      if (!success) {
        console.warn('[Stage3D] 初始化失败，回退到 2D 模式');
        StageCanvas.init(stageCanvas);
      }
    } else {
      console.log('[初始化] StageCanvas (2D 模式)...');
      StageCanvas.init(); // 内部自动创建离屏 canvas
    }

    console.log('[初始化] StageManager...');
    StageManager.init();
    console.log('[初始化] FileEditor...');
    FileEditor.init();
    console.log('[初始化] DevMode...');
    DevMode.init();
    console.log('[初始化] 所有模块初始化完成');
    } catch(e) {
      console.error('[初始化失败]', e);
    }

    // 初始化侦测输入：跳过本地画布绑定（canvas 已离屏），仅绑定键盘事件
    document.addEventListener('keydown', (e) => {
      if (typeof SensingInput !== 'undefined' && SensingInput._setKey) {
        const mapped = SensingInput._mapKey ? SensingInput._mapKey(e.key) : e.key.toLowerCase();
        SensingInput._setKey(mapped, true);
      }
    });
    document.addEventListener('keyup', (e) => {
      if (typeof SensingInput !== 'undefined' && SensingInput._setKey) {
        const mapped = SensingInput._mapKey ? SensingInput._mapKey(e.key) : e.key.toLowerCase();
        SensingInput._setKey(mapped, false);
      }
    });
    // 从舞台面板接收 IPC 输入（鼠标/键盘）
    SensingInput.initFromPanel();

    // 初始化扩展计时器
    window.__extTimerStart = Date.now();

    // 获取项目路径和模式：优先从 IPC 获取（避免 file:// URL 中文编码问题），回退到 URL 参数
    let initData = null;
    try {
      if (window.api && window.api.getEditorInit) {
        initData = await window.api.getEditorInit();
      }
    } catch(e) {}
    const projectPath = (initData && initData.path) || params.get('path');
    const projectMode = (initData && initData.mode) || params.get('mode') || 'normal';
    const ipcRenderMode = (initData && initData.render) || params.get('render') || '2d';

    // 保存渲染模式到全局状态
    if (typeof EditorState !== 'undefined') {
      EditorState.renderMode = ipcRenderMode;
    }

    // 如果 IPC 传入的 renderMode 是 3d，但舞台已初始化为 2D，则切换到 3D
    if (ipcRenderMode === '3d' && renderMode !== '3d') {
      console.log('[初始化] IPC renderMode=3d，切换到 3D 模式...');
      switchTo3D();
    }

    // 高级模式初始化
    if (projectMode === 'advanced') {
      initAdvancedMode();
    }

    // 数据分析模式初始化
    if (projectMode === 'data') {
      initDataMode();
    }

    // Minecraft 模组开发模式初始化
    if (projectMode === 'minecraft') {
      initMinecraftMode();
    }

    // 代码编程模式初始化
    if (projectMode && projectMode.startsWith('code-')) {
      initCodeMode(projectMode);
    }

    if (projectPath) {
      loadProject(projectPath, projectMode);
    }

    // 社区作品在线预览：通过项目 ID 从社区 API 加载
    const previewId = params.get('preview');
    if (previewId) {
      loadProjectFromCommunity(previewId);
    }

    // ==================== 菜单栏交互 ====================
    const _actionHome = () => {
      if (EditorState._isDirty) {
        const msg = i18n.isEnglish() ? 'You have unsaved changes. Close anyway?' : '您有未保存的更改，确定要关闭吗？';
        if (!confirm(msg)) return;
      }
      // 关闭窗口
      if (window.api && window.api.windowClose) {
        window.api.windowClose();
      } else {
        window.close();
      }
    };
    const _actionSave = async () => {
      await ProjectManager.saveProject();
      EditorState._isDirty = false;
      EditorState._blocksSnapshot = JSON.stringify(EditorState.blocks);
    };

    // 运行时锁定编辑区
    function _lockEditorForRuntime() {
      const overlay = document.getElementById('runtime-overlay');
      if (overlay) overlay.classList.remove('hidden');
      ['palette-panel', 'editor-panel', 'right-panel'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('locked');
      });
    }

    function _unlockEditorAfterRuntime() {
      const overlay = document.getElementById('runtime-overlay');
      if (overlay) overlay.classList.add('hidden');
      ['palette-panel', 'editor-panel', 'right-panel'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('locked');
      });
    }

    const _actionRun = async () => {
      // 始终在编辑器本地执行
      Executor.clearOutput();
      _jsScriptFrameCount = 0;  // 重置帧计数器（用于调试日志）
      const outputLog = document.getElementById('output-log');
      if (outputLog) outputLog.textContent = '';
      // 清空面板输出
      if (_panelsOpened && window.api && window.api.sendPanelUpdate) {
        window.api.sendPanelUpdate({ type: 'output', action: 'set', text: '' });
      }
      // 锁定编辑区，禁止运行时编辑
      _lockEditorForRuntime();
      // 启动高频推送精灵数据到舞台面板（~60fps）
      _startStagePushTimer();
      // 本地执行
      await Executor.run();
      // 执行完成后停止推送
      _stopStagePushTimer();
      // 解除锁定
      _unlockEditorAfterRuntime();
      // 最后一次推送确保最终状态同步
      _pushPanelSprites();
    };
    const _actionStop = () => {
      _stopStagePushTimer();
      Executor.stop();
      SoundManager.stopAll();
      // 解除编辑区锁定
      _unlockEditorAfterRuntime();
      // 停止后最终推送一次
      _pushPanelSprites();
    };
    const _actionForceStop = () => {
      _stopStagePushTimer();
      Executor.forceStop();
      SoundManager.stopAll();
      // 解除编辑区锁定
      _unlockEditorAfterRuntime();
      _pushPanelSprites();
    };
    const _actionExportHtml = () => {
      if (typeof HtmlExporter === 'undefined') { alert('HtmlExporter 未加载！'); return; }
      const dlg = document.getElementById('export-settings-dialog');
      if (dlg) {
        const titleInput = document.getElementById('export-title');
        if (titleInput) titleInput.value = EditorState.projectName || '';
        // 初始化默认显示 HTML 选项
        _updateExportOptions();
        dlg.classList.remove('hidden');
      } else {
        HtmlExporter.exportProject({ touchControls:true, fullscreenBtn:true, showConsole:true }).catch(e => alert('导出失败: ' + e.message));
      }
    };

    // ==================== 触屏按键配置 ====================
    const DEFAULT_TOUCH_KEYS = [
      { id: 'up',    label: '▲', keyCode: 'ArrowUp',    x: 8,  y: 28, size: 42, shape: 'rect',   color: '#89b4fa', texture: '' },
      { id: 'down',  label: '▼', keyCode: 'ArrowDown',  x: 8,  y: 5,  size: 42, shape: 'rect',   color: '#89b4fa', texture: '' },
      { id: 'left',  label: '◀', keyCode: 'ArrowLeft',  x: 2,  y: 16, size: 42, shape: 'rect',   color: '#89b4fa', texture: '' },
      { id: 'right', label: '▶', keyCode: 'ArrowRight', x: 14, y: 16, size: 42, shape: 'rect',   color: '#89b4fa', texture: '' },
      { id: 'btn-a', label: 'A', keyCode: 'Space',      x: 88, y: 18, size: 52, shape: 'circle', color: '#a6e3a1', texture: '' },
      { id: 'btn-b', label: 'B', keyCode: 'Enter',      x: 78, y: 6,  size: 46, shape: 'circle', color: '#f38ba8', texture: '' },
    ];
    let _touchConfig = JSON.parse(JSON.stringify(DEFAULT_TOUCH_KEYS));

    // 摇杆默认配置
    const DEFAULT_JOYSTICK = {
      enabled: true, x: 12, y: 16, size: 120, color: '#89b4fa',
      mode: '4key',
      keys: {
        up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
        upLeft: 'KeyQ', upRight: 'KeyE', downLeft: 'KeyZ', downRight: 'KeyC'
      }
    };
    let _joystickConfig = JSON.parse(JSON.stringify(DEFAULT_JOYSTICK));

    // ---- 触屏配置自动保存/加载 ----
    const _TOUCH_STORAGE_KEY = 'objector_touch_config';
    const _JOYSTICK_STORAGE_KEY = 'objector_joystick_config';
    function _saveTouchConfig() {
      try { localStorage.setItem(_TOUCH_STORAGE_KEY, JSON.stringify(_touchConfig)); } catch(e) {}
    }
    function _saveJoystickConfig() {
      try { localStorage.setItem(_JOYSTICK_STORAGE_KEY, JSON.stringify(_joystickConfig)); } catch(e) {}
    }
    function _loadTouchConfig() {
      try {
        const s = localStorage.getItem(_TOUCH_STORAGE_KEY);
        if (s) { _touchConfig = JSON.parse(s); }
      } catch(e) {}
    }
    function _loadJoystickConfig() {
      try {
        const s = localStorage.getItem(_JOYSTICK_STORAGE_KEY);
        if (s) { _joystickConfig = JSON.parse(s); }
      } catch(e) {}
    }
    // 从 localStorage 加载已保存的配置
    _loadTouchConfig();
    _loadJoystickConfig();

    // 构建按键下拉选项 HTML
    function _buildKeyOptions() {
      const isEn = i18n.isEnglish();
      const groups = [
        { group: isEn ? 'Arrows' : '方向键', keys: ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'] },
        { group: isEn ? 'Actions' : '动作',  keys: ['Space','Enter','Escape','ShiftLeft','ControlLeft'] },
        { group: isEn ? 'Letters' : '字母',  keys: Array.from({length:26},(_,i)=>'Key'+String.fromCharCode(65+i)) },
        { group: isEn ? 'Numbers' : '数字',  keys: Array.from({length:10},(_,i)=>'Digit'+i) },
      ];
      return groups.map(g => `<optgroup label="${g.group}">${g.keys.map(k=>`<option value="${k}">${k.replace('Key','').replace('Digit','').replace('Arrow','')}</option>`).join('')}</optgroup>`).join('');
    }

    // 显示/隐藏“设置按键”按钮
    function _updateTouchConfigBtnVisibility() {
      const btn = document.getElementById('export-touch-config-btn');
      const chk = document.getElementById('export-touch');
      if (btn) btn.style.display = (chk && chk.checked) ? '' : 'none';
    }
    document.getElementById('export-touch')?.addEventListener('change', _updateTouchConfigBtnVisibility);

    // 打开触屏按键配置面板
    function _openTouchConfigPanel() {
      const overlay = document.getElementById('touch-config-overlay');
      if (!overlay) return;
      overlay.classList.remove('hidden');
      _renderTouchConfigPanel();
    }

    // 关闭配置面板
    function _closeTouchConfigPanel() {
      const overlay = document.getElementById('touch-config-overlay');
      if (overlay) overlay.classList.add('hidden');
    }

    // 构建配置面板完整 UI
    function _renderTouchConfigPanel() {
      const overlay = document.getElementById('touch-config-overlay');
      if (!overlay) return;
      const isEn = i18n.isEnglish();
      let optGroups = _buildKeyOptions();
    
      overlay.innerHTML = `<div class="custom-prompt-box" style="max-width:720px;width:96%;max-height:92vh;overflow-y:auto;">
        <div class="custom-prompt-title" style="font-size:14px;">\u2328\ufe0f ${isEn ? 'Touch Controls Config' : '触屏按键配置'}</div>
        <div style="display:flex;gap:14px;flex-wrap:wrap;">
          <!-- 左列：按键列表 -->
          <div id="tc-list" style="flex:1;min-width:240px;max-height:360px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;"></div>
          <!-- 右列：预览 -->
          <div style="flex:1;min-width:260px;">
            <div style="font-size:11px;color:var(--text-secondary);margin-bottom:4px;">${isEn ? 'Preview (drag buttons to reposition)' : '预览（拖动按钮调整位置）'}</div>
            <div id="tc-preview" style="position:relative;width:100%;aspect-ratio:16/9;background:#1a1a2e;border:1px solid var(--border);border-radius:8px;overflow:hidden;cursor:default;"></div>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;justify-content:space-between;align-items:center;flex-wrap:wrap;">
          <div style="display:flex;gap:6px;">
            <button id="tc-add" type="button" class="tb-btn" style="font-size:12px;">+ ${isEn ? 'Add Button' : '添加按键'}</button>
            <button id="tc-reset" type="button" class="tb-btn" style="font-size:12px;">\u21ba ${isEn ? 'Reset Default' : '恢复默认'}</button>
          </div>
          <button id="tc-close" type="button" class="tb-btn tb-run" style="font-size:12px;">${isEn ? 'Done' : '确定'}</button>
        </div>
        <!-- 摇杆配置区 -->
        <div id="tc-joystick-section" style="margin-top:12px;border-top:1px solid var(--border);padding-top:12px;"></div>
      </div>`;
    
      // 事件绑定
      overlay.querySelector('#tc-close')?.addEventListener('click', _closeTouchConfigPanel);
      overlay.querySelector('#tc-add')?.addEventListener('click', () => {
        const newId = 'btn-' + Date.now().toString(36);
        _touchConfig.push({ id: newId, label: '?', keyCode: 'Space', x: 50, y: 50, size: 48, shape: 'circle', color: '#f9e2af', texture: '' });
        _saveTouchConfig();
        _renderTouchConfigPanel();
      });
      overlay.querySelector('#tc-reset')?.addEventListener('click', () => {
        _touchConfig = JSON.parse(JSON.stringify(DEFAULT_TOUCH_KEYS));
        _joystickConfig = JSON.parse(JSON.stringify(DEFAULT_JOYSTICK));
        _saveTouchConfig();
        _saveJoystickConfig();
        _renderTouchConfigPanel();
      });
      overlay.addEventListener('click', (e) => { if (e.target === overlay) _closeTouchConfigPanel(); });
    
      _renderTouchList(optGroups);
      _renderTouchPreview();
      _renderJoystickConfig(optGroups);
    }

    // 渲染按键列表
    function _renderTouchList(optGroups) {
      const list = document.getElementById('tc-list');
      if (!list) return;
      const isEn = i18n.isEnglish();
      list.innerHTML = '';
      _touchConfig.forEach((btn, idx) => {
        const card = document.createElement('div');
        card.style.cssText = 'display:flex;align-items:center;gap:5px;padding:5px 7px;background:var(--bg-tertiary);border:1px solid var(--border);border-radius:6px;font-size:11px;';
        card.innerHTML = `
          <span style="width:8px;height:8px;border-radius:50%;background:${btn.color};flex-shrink:0;"></span>
          <input type="text" value="${btn.label.replace(/"/g,'&quot;')}" maxlength="4" style="width:32px;padding:2px 4px;background:var(--bg-surface);border:1px solid var(--border);border-radius:3px;color:var(--text-primary);font-size:11px;text-align:center;" data-idx="${idx}" data-field="label" />
          <select style="flex:1;min-width:70px;padding:2px;background:var(--bg-surface);border:1px solid var(--border);border-radius:3px;color:var(--text-primary);font-size:11px;" data-idx="${idx}" data-field="keyCode">${optGroups}</select>
          <input type="range" min="24" max="80" value="${btn.size}" style="width:50px;accent-color:${btn.color};" data-idx="${idx}" data-field="size" title="${isEn ? 'Size' : '大小'}: ${btn.size}px" />
          <button type="button" style="width:20px;height:20px;border:1px solid var(--border);border-radius:50%;background:${btn.shape==='circle'?btn.color:'var(--bg-surface)'};color:${btn.shape==='circle'?'#000':'var(--text-secondary)'};font-size:9px;cursor:pointer;" data-idx="${idx}" data-action="toggle-shape" title="${btn.shape}">${btn.shape==='circle'?'●':'■'}</button>
          <input type="color" value="${btn.color}" style="width:22px;height:22px;border:none;padding:0;cursor:pointer;background:transparent;" data-idx="${idx}" data-field="color" title="${isEn ? 'Color' : '颜色'}" />
          <label style="cursor:pointer;position:relative;" title="${isEn ? 'Set texture' : '设置贴图'}">
            <span style="font-size:13px;cursor:pointer;">🖼</span>
            <input type="file" accept="image/*" style="display:none;" data-idx="${idx}" data-field="texture" />
          </label>
          <button type="button" style="width:18px;height:18px;border:none;border-radius:3px;background:rgba(243,139,168,.2);color:#f38ba8;font-size:12px;cursor:pointer;flex-shrink:0;" data-idx="${idx}" data-action="delete" title="${isEn ? 'Delete' : '删除'}">✕</button>`;
        // 选中当前 keyCode
        const sel = card.querySelector('select');
        if (sel) sel.value = btn.keyCode;
        list.appendChild(card);
      });

      // 事件委托
      list.addEventListener('input', (e) => {
        const idx = parseInt(e.target.dataset.idx);
        const field = e.target.dataset.field;
        if (isNaN(idx) || !field || !_touchConfig[idx]) return;
        if (field === 'label') { _touchConfig[idx].label = e.target.value; }
        else if (field === 'keyCode') { _touchConfig[idx].keyCode = e.target.value; }
        else if (field === 'size') { _touchConfig[idx].size = parseInt(e.target.value); e.target.title = `${isEn?'Size':'大小'}: ${e.target.value}px`; }
        else if (field === 'color') { _touchConfig[idx].color = e.target.value; }
        else if (field === 'texture') {
          const file = e.target.files?.[0];
          if (file) {
            const reader = new FileReader();
            reader.onload = (ev) => { _touchConfig[idx].texture = ev.target.result; _saveTouchConfig(); _renderTouchConfigPanel(); };
            reader.readAsDataURL(file);
          }
          return;
        }
        _saveTouchConfig();
        _renderTouchPreview();
      });
      list.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.idx);
        const field = e.target.dataset.field;
        if (field === 'keyCode' && !isNaN(idx) && _touchConfig[idx]) {
          _touchConfig[idx].keyCode = e.target.value;
          _saveTouchConfig();
          _renderTouchPreview();
        }
      });
      list.addEventListener('click', (e) => {
        const btn2 = e.target.closest('[data-action]');
        if (!btn2) return;
        const idx = parseInt(btn2.dataset.idx);
        const action = btn2.dataset.action;
        if (action === 'delete') { _touchConfig.splice(idx, 1); _saveTouchConfig(); _renderTouchConfigPanel(); }
        else if (action === 'toggle-shape') { _touchConfig[idx].shape = _touchConfig[idx].shape === 'circle' ? 'rect' : 'circle'; _saveTouchConfig(); _renderTouchConfigPanel(); }
      });
    }

    // 渲染预览区
    function _renderTouchPreview() {
      const preview = document.getElementById('tc-preview');
      if (!preview) return;
      preview.innerHTML = '';
      const rect = preview.getBoundingClientRect();
      _touchConfig.forEach((btn, idx) => {
        const el = document.createElement('div');
        const s = btn.size * (rect.width / 480);
        const px = (btn.x / 100) * rect.width;
        const py = rect.height - (btn.y / 100) * rect.height;
        el.style.cssText = `position:absolute;left:${px}px;top:${py}px;width:${s}px;height:${s}px;display:flex;align-items:center;justify-content:center;font-size:${Math.max(8,s*0.35)}px;font-weight:700;color:#fff;cursor:grab;user-select:none;z-index:${idx+1};`;
        if (btn.shape === 'circle') {
          el.style.borderRadius = '50%';
          el.style.border = `2px solid ${btn.color}80`;
          el.style.background = `${btn.color}20`;
        } else {
          el.style.borderRadius = '6px';
          el.style.border = `1px solid ${btn.color}80`;
          el.style.background = `${btn.color}20`;
        }
        if (btn.texture) {
          el.style.backgroundImage = `url(${btn.texture})`;
          el.style.backgroundSize = 'cover';
          el.style.backgroundPosition = 'center';
          el.textContent = '';
        } else {
          el.textContent = btn.label;
        }
        el.dataset.idx = idx;
        el.title = `${btn.label} → ${btn.keyCode}`;
        // 拖拽定位
        let dragging = false, startX, startY, origX, origY;
        el.addEventListener('mousedown', (e) => {
          e.preventDefault(); dragging = true;
          startX = e.clientX; startY = e.clientY;
          origX = btn.x; origY = btn.y;
          el.style.cursor = 'grabbing'; el.style.zIndex = 100;
        });
        document.addEventListener('mousemove', (e) => {
          if (!dragging) return;
          const dx = ((e.clientX - startX) / rect.width) * 100;
          const dy = ((e.clientY - startY) / rect.height) * 100;
          btn.x = Math.max(0, Math.min(96, origX + dx));
          btn.y = Math.max(0, Math.min(96, origY - dy));
          _renderTouchPreview();
        });
        document.addEventListener('mouseup', () => {
          if (dragging) { dragging = false; el.style.cursor = 'grab'; el.style.zIndex = idx + 1; _saveTouchConfig(); }
        });
        preview.appendChild(el);
      });

      // 渲染摇杆预览
      if (_joystickConfig.enabled) {
        const jc = _joystickConfig;
        const scale = rect.width / 480;
        const js = jc.size * scale;
        const cx = (jc.x / 100) * rect.width;
        const cy = rect.height - (jc.y / 100) * rect.height;
        // 外圈
        const base = document.createElement('div');
        base.style.cssText = `position:absolute;left:${cx - js/2}px;top:${cy - js/2}px;width:${js}px;height:${js}px;border-radius:50%;border:2px solid ${jc.color}60;background:${jc.color}10;display:flex;align-items:center;justify-content:center;cursor:grab;user-select:none;z-index:50;`;
        base.title = '🎮 Joystick';
        // 内圆
        const inner = js * 0.38;
        const knob = document.createElement('div');
        knob.style.cssText = `width:${inner}px;height:${inner}px;border-radius:50%;background:${jc.color}40;border:1px solid ${jc.color}80;`;
        base.appendChild(knob);
        // 方向指示
        const dirs = ['↑','↗','→','↘','↓','↙','←','↖'];
        dirs.forEach((d, i) => {
          const angle = (i * 45 - 90) * Math.PI / 180;
          const r = js / 2 - 4;
          const dx = Math.cos(angle) * r;
          const dy = Math.sin(angle) * r;
          const lbl = document.createElement('div');
          lbl.style.cssText = `position:absolute;left:${cx + dx}px;top:${cy + dy}px;font-size:${Math.max(6, js*0.12)}px;color:${jc.color}80;pointer-events:none;`;
          lbl.textContent = d;
          preview.appendChild(lbl);
        });
        // 拖拽
        let dragging = false, startX2, startY2, origX, origY;
        base.addEventListener('mousedown', (e) => {
          e.preventDefault(); dragging = true;
          startX2 = e.clientX; startY2 = e.clientY;
          origX = jc.x; origY = jc.y;
          base.style.cursor = 'grabbing';
        });
        document.addEventListener('mousemove', (e) => {
          if (!dragging) return;
          const dx = ((e.clientX - startX2) / rect.width) * 100;
          const dy = ((e.clientY - startY2) / rect.height) * 100;
          jc.x = Math.max(4, Math.min(50, origX + dx));
          jc.y = Math.max(4, Math.min(50, origY - dy));
          _renderTouchPreview();
          _renderJoystickConfig(_buildKeyOptions());
        });
        document.addEventListener('mouseup', () => { if (dragging) { dragging = false; base.style.cursor = 'grab'; _saveJoystickConfig(); } });
        preview.appendChild(base);
      }
    }
    
    // 渲染摇杆配置区
    function _renderJoystickConfig(optGroups) {
      const section = document.getElementById('tc-joystick-section');
      if (!section) return;
      const isEn = i18n.isEnglish();
      const jc = _joystickConfig;
      const selCss = 'padding:2px;background:var(--bg-surface);border:1px solid var(--border);border-radius:3px;color:var(--text-primary);font-size:10px;';
      const labelCss = 'font-size:10px;color:var(--text-secondary);min-width:20px;text-align:center;';
    
      function keySel(name, val) {
        return `<select data-jskey="${name}" style="${selCss}">${optGroups}</select>`;
      }
    
      section.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;font-weight:600;color:var(--text-primary);">
            <input type="checkbox" data-js-field="enabled" ${jc.enabled?'checked':''} style="width:16px;height:16px;accent-color:var(--accent);" />
            <span>🎮 ${isEn ? 'Joystick' : '摇杆'}</span>
          </label>
          <select data-js-field="mode" style="padding:2px 6px;background:var(--bg-surface);border:1px solid var(--border);border-radius:4px;color:var(--text-primary);font-size:11px;">
            <option value="4key" ${jc.mode==='4key'?'selected':''}>${isEn?'4-Key Mode':'4键模式'} (${isEn?'diagonal = 2 keys':'斜角同时2键'})</option>
            <option value="8key" ${jc.mode==='8key'?'selected':''}>${isEn?'8-Key Mode':'8键模式'} (${isEn?'each direction':'每个方向独立'})</option>
          </select>
        </div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:8px;">
          <label style="font-size:11px;color:var(--text-secondary);">${isEn?'Position X':'X位置'} <input type="range" min="4" max="50" value="${jc.x}" data-js-field="x" style="width:70px;accent-color:var(--accent);vertical-align:middle;"><span style="font-size:10px;color:var(--text-muted);">${jc.x}%</span></label>
          <label style="font-size:11px;color:var(--text-secondary);">${isEn?'Position Y':'Y位置'} <input type="range" min="4" max="50" value="${jc.y}" data-js-field="y" style="width:70px;accent-color:var(--accent);vertical-align:middle;"><span style="font-size:10px;color:var(--text-muted);">${jc.y}%</span></label>
          <label style="font-size:11px;color:var(--text-secondary);">${isEn?'Size':'大小'} <input type="range" min="60" max="200" value="${jc.size}" data-js-field="size" style="width:70px;accent-color:var(--accent);vertical-align:middle;"><span style="font-size:10px;color:var(--text-muted);">${jc.size}px</span></label>
          <label style="font-size:11px;color:var(--text-secondary);">${isEn?'Color':'颜色'} <input type="color" value="${jc.color}" data-js-field="color" style="width:24px;height:24px;border:none;padding:0;cursor:pointer;background:transparent;vertical-align:middle;"></label>
        </div>
        <!-- 4键模式配置 -->
        <div id="js-4key-keys" style="display:${jc.mode==='4key'?'grid':'none'};grid-template-columns:1fr 1fr;gap:4px 10px;margin-bottom:6px;">
          <div style="display:flex;align-items:center;gap:4px;"><span style="${labelCss}">↑</span>${keySel('up', jc.keys.up)}</div>
          <div style="display:flex;align-items:center;gap:4px;"><span style="${labelCss}">↓</span>${keySel('down', jc.keys.down)}</div>
          <div style="display:flex;align-items:center;gap:4px;"><span style="${labelCss}">←</span>${keySel('left', jc.keys.left)}</div>
          <div style="display:flex;align-items:center;gap:4px;"><span style="${labelCss}">→</span>${keySel('right', jc.keys.right)}</div>
        </div>
        <!-- 8键模式配置 -->
        <div id="js-8key-keys" style="display:${jc.mode==='8key'?'grid':'none'};grid-template-columns:1fr 1fr;gap:4px 10px;margin-bottom:6px;">
          <div style="display:flex;align-items:center;gap:4px;"><span style="${labelCss}">↖</span>${keySel('upLeft', jc.keys.upLeft)}</div>
          <div style="display:flex;align-items:center;gap:4px;"><span style="${labelCss}">↗</span>${keySel('upRight', jc.keys.upRight)}</div>
          <div style="display:flex;align-items:center;gap:4px;"><span style="${labelCss}">↙</span>${keySel('downLeft', jc.keys.downLeft)}</div>
          <div style="display:flex;align-items:center;gap:4px;"><span style="${labelCss}">↘</span>${keySel('downRight', jc.keys.downRight)}</div>
          <div style="display:flex;align-items:center;gap:4px;"><span style="${labelCss}">↑</span>${keySel('up', jc.keys.up)}</div>
          <div style="display:flex;align-items:center;gap:4px;"><span style="${labelCss}">↓</span>${keySel('down', jc.keys.down)}</div>
          <div style="display:flex;align-items:center;gap:4px;"><span style="${labelCss}">←</span>${keySel('left', jc.keys.left)}</div>
          <div style="display:flex;align-items:center;gap:4px;"><span style="${labelCss}">→</span>${keySel('right', jc.keys.right)}</div>
        </div>`;
    
      // 设置下拉框选中值
      section.querySelectorAll('select[data-js-key]').forEach(sel => {
        sel.value = jc.keys[sel.dataset.jsKey] || 'ArrowUp';
      });
    
      // 事件委托
      section.addEventListener('input', (e) => {
        const f = e.target.dataset.jsField;
        if (f === 'x' || f === 'y' || f === 'size') {
          jc[f] = parseInt(e.target.value);
          // 更新显示文本
          const span = e.target.nextElementSibling;
          if (span) span.textContent = e.target.value + (f === 'size' ? 'px' : '%');
          _saveJoystickConfig();
          _renderTouchPreview();
        } else if (f === 'color') {
          jc[f] = e.target.value;
          _saveJoystickConfig();
          _renderTouchPreview();
        }
      });
      section.addEventListener('change', (e) => {
        const f = e.target.dataset.jsField;
        if (f === 'enabled') {
          jc.enabled = e.target.checked;
          _saveJoystickConfig();
          _renderTouchPreview();
        } else if (f === 'mode') {
          jc.mode = e.target.value;
          _saveJoystickConfig();
          _renderJoystickConfig(optGroups);
          _renderTouchPreview();
        }
        const jk = e.target.dataset.jsKey;
        if (jk) {
          jc.keys[jk] = e.target.value;
          _saveJoystickConfig();
        }
      });
    }
    
    // 绑定"设置按键"按钮
    document.getElementById('export-touch-config-btn')?.addEventListener('click', _openTouchConfigPanel);
    _updateTouchConfigBtnVisibility();

    // 导出对话框动态显隐逻辑
    function _updateExportOptions() {
      const fmt = document.querySelector('input[name="export-format"]:checked')?.value || 'html';
      const htmlOpts = document.getElementById('export-html-options');
      const exeOpts = document.getElementById('export-exe-options');
      if (htmlOpts) htmlOpts.style.display = (fmt === 'html') ? 'flex' : 'none';
      if (exeOpts) exeOpts.style.display = (fmt === 'exe') ? 'block' : 'none';
      _updateInstallerOptions();
    }
    function _updateInstallerOptions() {
      const pkg = document.querySelector('input[name="export-package"]:checked')?.value || 'zip';
      const installerOpts = document.getElementById('export-installer-options');
      if (installerOpts) installerOpts.style.display = (pkg === 'installer') ? 'block' : 'none';
    }
    // 格式切换
    document.querySelectorAll('input[name="export-format"]').forEach(r => r.addEventListener('change', _updateExportOptions));
    // 打包方式切换
    document.querySelectorAll('input[name="export-package"]').forEach(r => r.addEventListener('change', _updateInstallerOptions));

    // 导出对话框按钮事件
    document.getElementById('export-confirm')?.addEventListener('click', async () => {
      const dlg = document.getElementById('export-settings-dialog');
      if (dlg) dlg.classList.add('hidden');
      try {
        const format = document.querySelector('input[name="export-format"]:checked')?.value || 'html';
        if (format === 'exe') {
          const settings = {
            title: document.getElementById('export-title')?.value?.trim() || '',
            fullscreenBtn: !!document.getElementById('export-exe-fullscreen')?.checked,
            autoRun: !!document.getElementById('export-exe-autorun')?.checked,
            showConsole: !!document.getElementById('export-exe-console')?.checked,
            targetPlatform: document.querySelector('input[name="export-os"]:checked')?.value || 'win32',
            packageType: document.querySelector('input[name="export-package"]:checked')?.value || 'zip',
            installPathType: document.querySelector('input[name="export-install-path"]:checked')?.value || 'user-select',
          };
          await HtmlExporter.exportAsExe(settings);
        } else {
          const touchEnabled = !!document.getElementById('export-touch')?.checked;
          const settings = {
            title: document.getElementById('export-title')?.value?.trim() || '',
            touchControls: touchEnabled,
            touchConfig: touchEnabled ? JSON.parse(JSON.stringify(_touchConfig)) : null,
            joystickConfig: touchEnabled && _joystickConfig.enabled ? JSON.parse(JSON.stringify(_joystickConfig)) : null,
            fullscreenBtn: !!document.getElementById('export-fullscreen')?.checked,
            autoRun: !!document.getElementById('export-autorun')?.checked,
            showConsole: !!document.getElementById('export-console')?.checked,
          };
          await HtmlExporter.exportProject(settings);
        }
      } catch(e) { alert('导出失败: ' + e.message); }
    });
    document.getElementById('export-cancel')?.addEventListener('click', () => {
      const dlg = document.getElementById('export-settings-dialog');
      if (dlg) dlg.classList.add('hidden');
    });
    // 点击背景关闭
    document.getElementById('export-settings-dialog')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
    });

    // ==================== 积木转代码预览 ====================
    let _codePreviewLang = 'javascript';
    function showCodePreviewDialog() {
      if (typeof BlockCodeConverter === 'undefined') { alert(i18n.isEnglish() ? 'BlockCodeConverter not loaded' : '代码转换器未加载'); return; }
      const blocks = EditorState.blocks || {};
      if (Object.keys(blocks).length === 0) { alert(i18n.isEnglish() ? 'No blocks to convert' : '没有积木可以转换'); return; }
      const code = BlockCodeConverter.convertProject(blocks, _codePreviewLang);
      const dialog = document.getElementById('code-preview-dialog');
      const output = document.getElementById('code-preview-output');
      output.textContent = code;
      dialog.classList.remove('hidden');
      // 更新按钮高亮
      document.getElementById('code-preview-js').className = 'tb-btn' + (_codePreviewLang === 'javascript' ? ' tb-run' : '');
      document.getElementById('code-preview-python').className = 'tb-btn' + (_codePreviewLang === 'python' ? ' tb-run' : '');
    }
    document.getElementById('code-preview-js')?.addEventListener('click', () => { _codePreviewLang = 'javascript'; showCodePreviewDialog(); });
    document.getElementById('code-preview-python')?.addEventListener('click', () => { _codePreviewLang = 'python'; showCodePreviewDialog(); });
    document.getElementById('code-preview-copy')?.addEventListener('click', () => {
      const code = document.getElementById('code-preview-output')?.textContent || '';
      navigator.clipboard.writeText(code).then(() => {
        const btn = document.getElementById('code-preview-copy');
        const orig = btn.textContent;
        btn.textContent = i18n.isEnglish() ? '✅ Copied!' : '✅ 已复制';
        setTimeout(() => btn.textContent = orig, 1500);
      });
    });
    document.getElementById('code-preview-close')?.addEventListener('click', () => {
      document.getElementById('code-preview-dialog')?.classList.add('hidden');
    });

    // ==================== 导入 Scratch .sb3 ====================
    function importSB3File() {
      if (typeof SB3Importer === 'undefined') { alert(i18n.isEnglish() ? 'SB3Importer not loaded' : 'SB3导入器未加载'); return; }
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.sb3';
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const result = await SB3Importer.importFile(file);
          if (result && result.blocks) {
            // 合并导入的积木到当前项目
            let count = 0;
            for (const [id, block] of Object.entries(result.blocks)) {
              EditorState.blocks[id] = block;
              count++;
            }
            // 刷新画布
            if (typeof EditorCanvas !== 'undefined') EditorCanvas.render();
            EditorState._isDirty = true;
            const msg = i18n.isEnglish() ? `Imported ${count} blocks from ${file.name}` : `已从 ${file.name} 导入 ${count} 个积木`;
            document.getElementById('status-text').textContent = msg;
          }
        } catch (err) {
          alert((i18n.isEnglish() ? 'Import failed: ' : '导入失败: ') + err.message);
        }
      };
      input.click();
    }

    // ==================== 项目模板库 ====================
    const PROJECT_TEMPLATES = [
      {
        id: 'empty', icon: '<img src="../icons/Document.svg" style="height:24px;">',
        name: { zh: '空白项目', en: 'Blank Project' },
        desc: { zh: '从零开始创建', en: 'Start from scratch' },
        blocks: {}
      },
      {
        id: 'move-keys', icon: '<img src="../icons/Run.svg" style="height:24px;">',
        name: { zh: '键盘控制移动', en: 'Keyboard Movement' },
        desc: { zh: '用方向键控制角色移动', en: 'Control sprite with arrow keys' },
        blocks: {
          'tpl_ev1': { id: 'tpl_ev1', type: 'event_key_pressed', params: { key: 'ArrowUp' }, x: 100, y: 100, flowIn: null, flowOut: 'tpl_mv1' },
          'tpl_mv1': { id: 'tpl_mv1', type: 'change_y', params: { dy: 10 }, flowIn: 'tpl_ev1', flowOut: null }
        }
      },
      {
        id: 'bounce', icon: '🏀',
        name: { zh: '弹球动画', en: 'Bouncing Ball' },
        desc: { zh: '角色碰到边缘弹回', en: 'Sprite bounces at edges' },
        blocks: {
          'tpl_ev2': { id: 'tpl_ev2', type: 'event_start', params: {}, x: 100, y: 100, flowIn: null, flowOut: 'tpl_for1' },
          'tpl_for1': { id: 'tpl_for1', type: 'control_forever', params: {}, subBlocks: { body: 'tpl_mv2' }, flowIn: 'tpl_ev2', flowOut: null },
          'tpl_mv2': { id: 'tpl_mv2', type: 'move_steps', params: { steps: 5 }, flowIn: null, flowOut: 'tpl_bnc1' },
          'tpl_bnc1': { id: 'tpl_bnc1', type: 'bounce_edge', params: {}, flowIn: 'tpl_mv2', flowOut: null }
        }
      },
      {
        id: 'say-hello', icon: '<img src="../icons/Document.svg" style="height:24px;">',
        name: { zh: '打招呼', en: 'Say Hello' },
        desc: { zh: '角色说话并等待', en: 'Sprite says hello and waits' },
        blocks: {
          'tpl_ev3': { id: 'tpl_ev3', type: 'event_start', params: {}, x: 100, y: 100, flowIn: null, flowOut: 'tpl_say1' },
          'tpl_say1': { id: 'tpl_say1', type: 'looks_say', params: { text: 'Hello!', sec: 2 }, flowIn: 'tpl_ev3', flowOut: null }
        }
      },
      {
        id: 'click-counter', icon: '🔢',
        name: { zh: '点击计数器', en: 'Click Counter' },
        desc: { zh: '点击角色计数', en: 'Count clicks on sprite' },
        blocks: {
          'tpl_ev4': { id: 'tpl_ev4', type: 'event_sprite_clicked', params: {}, x: 100, y: 100, flowIn: null, flowOut: 'tpl_var1' },
          'tpl_var1': { id: 'tpl_var1', type: 'var_change', params: { name: 'count', delta: 1 }, flowIn: 'tpl_ev4', flowOut: null }
        }
      },
      {
        id: 'follow-mouse', icon: '🖱️',
        name: { zh: '跟随鼠标', en: 'Follow Mouse' },
        desc: { zh: '角色跟随鼠标移动', en: 'Sprite follows the mouse' },
        blocks: {
          'tpl_ev5': { id: 'tpl_ev5', type: 'event_start', params: {}, x: 100, y: 100, flowIn: null, flowOut: 'tpl_for2' },
          'tpl_for2': { id: 'tpl_for2', type: 'control_forever', params: {}, subBlocks: { body: 'tpl_goto_mouse' }, flowIn: 'tpl_ev5', flowOut: null },
          'tpl_goto_mouse': { id: 'tpl_goto_mouse', type: 'go_to_mouse', params: {}, flowIn: null, flowOut: null }
        }
      }
    ];

    function showTemplateDialog() {
      const dialog = document.getElementById('template-dialog');
      const list = document.getElementById('template-list');
      list.innerHTML = '';
      const isEn = i18n.isEnglish();
      PROJECT_TEMPLATES.forEach(tpl => {
        const card = document.createElement('div');
        card.style.cssText = 'padding:14px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;cursor:pointer;transition:all .2s;';
        card.innerHTML = `<div style="font-size:24px;margin-bottom:6px;">${tpl.icon}</div>
          <div style="font-weight:600;font-size:13px;">${isEn ? tpl.name.en : tpl.name.zh}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">${isEn ? tpl.desc.en : tpl.desc.zh}</div>`;
        card.addEventListener('mouseenter', () => card.style.borderColor = 'var(--accent)');
        card.addEventListener('mouseleave', () => card.style.borderColor = 'var(--border)');
        card.addEventListener('click', () => loadTemplate(tpl));
        list.appendChild(card);
      });
      dialog.classList.remove('hidden');
    }

    function loadTemplate(tpl) {
      document.getElementById('template-dialog')?.classList.add('hidden');
      // 清空当前积木并加载模板
      EditorState.blocks = JSON.parse(JSON.stringify(tpl.blocks));
      if (typeof EditorCanvas !== 'undefined') EditorCanvas.render();
      EditorState._isDirty = true;
      const isEn = i18n.isEnglish();
      document.getElementById('status-text').textContent = isEn ? `Template loaded: ${tpl.name.en}` : `已加载模板: ${tpl.name.zh}`;
    }

    document.getElementById('template-close')?.addEventListener('click', () => {
      document.getElementById('template-dialog')?.classList.add('hidden');
    });

    // ==================== 变量监视面板 ====================
    let _monitorVisible = false;
    let _monitorTimer = null;

    function toggleVariablesMonitor() {
      _monitorVisible = !_monitorVisible;
      const panel = document.getElementById('variables-monitor');
      if (_monitorVisible) {
        panel.classList.remove('hidden');
        updateVariablesMonitor();
        // 定时刷新
        if (!_monitorTimer) {
          _monitorTimer = setInterval(updateVariablesMonitor, 500);
        }
      } else {
        panel.classList.add('hidden');
        if (_monitorTimer) { clearInterval(_monitorTimer); _monitorTimer = null; }
      }
    }

    function updateVariablesMonitor() {
      const content = document.getElementById('monitor-content');
      if (!content || !_monitorVisible) return;
      const vars = (typeof Executor !== 'undefined' && Executor._getGlobalVars) ? Executor._getGlobalVars() : {};
      const keys = Object.keys(vars).filter(k => !k.startsWith('__'));
      if (keys.length === 0) {
        const isEn = i18n.isEnglish();
        content.innerHTML = `<div style="color:var(--text-muted);text-align:center;padding:12px;">${isEn ? 'Run project to see variable values' : '运行项目后显示变量值'}</div>`;
        return;
      }
      let html = '';
      for (const key of keys) {
        const val = vars[key];
        const displayVal = Array.isArray(val) ? JSON.stringify(val) : String(val);
        html += `<div style="display:flex;justify-content:space-between;padding:3px 6px;border-radius:4px;margin-bottom:2px;background:var(--bg-tertiary);">
          <span style="color:var(--accent);font-weight:500;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${key}">${key}</span>
          <span style="color:var(--text-primary);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${displayVal}">${displayVal}</span>
        </div>`;
      }
      content.innerHTML = html;
    }

    document.getElementById('monitor-close')?.addEventListener('click', () => toggleVariablesMonitor());

    const menuActions = {
      'home': _actionHome,
      'save': _actionSave,
      'save-local': () => saveProjectToLocal(),
      'export-html': _actionExportHtml,
      'publish': () => publishToCommunity(),
      'run': _actionRun,
      'stop': _actionStop,
      'force-stop': _actionForceStop,
      'load-ext': () => { if (typeof ExtensionDialog !== 'undefined') ExtensionDialog.show(); else loadExtensionDialog(); },
      'ext-docs': () => window.api && window.api.openExtensionDocs(),
      'view-code': () => showAllCodeDialog(),
      'blocks-guide': () => window.open('https://tomlct2015.github.io/Objector-Coder/blocks-guide/', '_blank'),
      'advanced-guide': () => window.open('https://tomlct2015.github.io/Objector-Coder/how-to-use-advanced-editor/', '_blank'),
      'minecraft-api': () => window.open('https://tomlct2015.github.io/Objector-Coder/minecraft-api/', '_blank'),
      'collab-push-progress': () => typeof CollaborationManager !== 'undefined' && CollaborationManager.pushProgress(),
      'collab-push-branch': () => typeof CollaborationManager !== 'undefined' && CollaborationManager.pushToBranch(),
      'collab-view-members': () => typeof CollaborationManager !== 'undefined' && CollaborationManager.viewMembers(),
      'collab-share-link': () => typeof CollaborationManager !== 'undefined' && CollaborationManager.generateShareLink(),
      'code-preview': () => showCodePreviewDialog(),
      'import-sb3': () => importSB3File(),
      'show-templates': () => showTemplateDialog(),
      'toggle-monitor': () => toggleVariablesMonitor(),
    };

    // 菜单栏下拉交互
    const menubar = document.getElementById('menubar');
    if (menubar) {
      let openMenu = null;
      const closeAllMenus = () => {
        menubar.querySelectorAll('.menu-item.open').forEach(m => m.classList.remove('open'));
        openMenu = null;
      };
      menubar.querySelectorAll('.menu-item').forEach(mi => {
        mi.addEventListener('click', (e) => {
          e.stopPropagation();
          const wasOpen = mi.classList.contains('open');
          closeAllMenus();
          if (!wasOpen) { mi.classList.add('open'); openMenu = mi; }
        });
        mi.addEventListener('mouseenter', () => {
          if (openMenu && openMenu !== mi) {
            closeAllMenus();
            mi.classList.add('open');
            openMenu = mi;
          }
        });
      });
      document.addEventListener('click', closeAllMenus);
      menubar.querySelectorAll('.menu-dropdown-item').forEach(item => {
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          const action = item.dataset.action;
          closeAllMenus();
          if (action && menuActions[action]) menuActions[action]();
        });
      });
    }

    // 工具栏运行/停止按钮
    document.getElementById('btn-run')?.addEventListener('click', _actionRun);
    document.getElementById('btn-stop')?.addEventListener('click', _actionStop);

    // AI 助手按钮
    document.getElementById('btn-ai-assistant')?.addEventListener('click', () => {
      if (typeof AIAssistant !== 'undefined') {
        AIAssistant.showPanel();
      } else {
        alert('AI 助手模块未加载');
      }
    });

    // 面板窗口快捷按钮（只有舞台按钮了）
    ['stage'].forEach(type => {
      document.getElementById('btn-panel-' + type)?.addEventListener('click', () => {
        if (window.api && window.api.showPanel) {
          // 如果面板尚未初始化，先初始化（确保 _panelsOpened = true）
          if (!_panelsOpened) {
            _initPanels();
          }
          window.api.showPanel(type);
          // 重置脏检查，确保新面板窗口能收到数据（面板可能刚重建）
          _lastStageJSON = '';
          setTimeout(() => {
            // 重新推送渲染模式（面板窗口可能已重建，需要重新告知渲染模式）
            const rm = (typeof EditorState !== 'undefined' && EditorState.renderMode) || '2d';
            if (window.api && window.api.sendPanelUpdate) {
              window.api.sendPanelUpdate({ type: 'render-mode', renderMode: rm });
            }
            _pushPanelTitle();
            _pushPanelSprites();
            _pushAudioList();
          }, 500);
        }
      });
    });

    document.getElementById('btn-cmd')?.addEventListener('click', () => {
      window.api?.openCmdWindow();
    });

    // 协作管理按钮
    document.getElementById('btn-collab')?.addEventListener('click', () => {
      if (typeof CollaborationManager !== 'undefined') {
        CollaborationManager.showPanel();
      } else {
        alert('协作管理模块未加载');
      }
    });

    // ========== 积木搜索 (Ctrl+F) ==========
    let _searchResults = [];
    let _searchIndex = 0;
    const searchBar = document.getElementById('search-bar');
    const searchInput = document.getElementById('search-input');
    const searchCount = document.getElementById('search-count');
    const searchPrev = document.getElementById('search-prev');
    const searchNext = document.getElementById('search-next');
    const searchClose = document.getElementById('search-close');

    function _openSearch() {
      if (searchBar) {
        searchBar.classList.remove('hidden');
        searchInput?.focus();
      }
    }

    function _closeSearch() {
      if (searchBar) searchBar.classList.add('hidden');
      _searchResults = [];
      _searchIndex = 0;
      if (searchCount) searchCount.textContent = '0 结果';
    }

    function _doSearch() {
      const query = searchInput?.value?.trim();
      if (!query) {
        _searchResults = [];
        _searchIndex = 0;
        if (searchCount) searchCount.textContent = '0 结果';
        return;
      }
      if (typeof EditorCanvas !== 'undefined') {
        _searchResults = EditorCanvas.searchBlocks(query);
        _searchIndex = 0;
        if (searchCount) searchCount.textContent = _searchResults.length + ' 结果';
        if (_searchResults.length > 0) {
          EditorCanvas.highlightSearchResults(_searchResults);
        }
      }
    }

    function _searchNav(dir) {
      if (_searchResults.length === 0) return;
      _searchIndex = (_searchIndex + dir + _searchResults.length) % _searchResults.length;
      const block = _searchResults[_searchIndex];
      if (block && typeof EditorCanvas !== 'undefined') {
        EditorCanvas.highlightSearchResults([block]);
      }
      if (searchCount) searchCount.textContent = (_searchIndex + 1) + '/' + _searchResults.length;
    }

    document.getElementById('btn-search')?.addEventListener('click', _openSearch);
    searchInput?.addEventListener('input', _doSearch);
    searchInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { _searchNav(e.shiftKey ? -1 : 1); e.preventDefault(); }
      if (e.key === 'Escape') _closeSearch();
    });
    searchPrev?.addEventListener('click', () => _searchNav(-1));
    searchNext?.addEventListener('click', () => _searchNav(1));
    searchClose?.addEventListener('click', _closeSearch);

    // ========== 教程系统 ==========
    document.getElementById('btn-tutorial')?.addEventListener('click', () => {
      if (typeof TutorialSystem !== 'undefined') {
        TutorialSystem.start('beginner');
      } else {
        alert('教程模块未加载');
      }
    });

    // 初始化教程系统
    if (typeof TutorialSystem !== 'undefined') {
      TutorialSystem.init();
      // 首次访问自动显示教程
      if (!TutorialSystem.isDone()) {
        setTimeout(() => TutorialSystem.start('beginner'), 1000);
      }
    }

    // 社区用户信息显示
    const communityUserInfo = document.getElementById('community-user-info');

    function refreshCommunityUI() {
      if (typeof CommunityAPI === 'undefined') return;
      const user = CommunityAPI.getUser();
      const profile = CommunityAPI.getProfile();
      if (user && communityUserInfo) {
        communityUserInfo.innerHTML = '<img src="../icons/User.svg" class="tb-icon" style="height:11px;"> ' + (profile?.username || user.email);
        communityUserInfo.classList.remove('hidden');
      } else if (communityUserInfo) {
        communityUserInfo.classList.add('hidden');
      }
      // 更新协作菜单可见性
      if (typeof CollaborationManager !== 'undefined') {
        CollaborationManager.updateMenuVisibility();
      }
    }

    // 初始化社区 API 并恢复登录状态
    if (typeof CommunityAPI !== 'undefined') {
      CommunityAPI.init();
      CommunityAPI.restoreSession().then(() => refreshCommunityUI());
    }

    // 项目重命名
    document.getElementById('btn-rename')?.addEventListener('click', () => ProjectManager.renameProject());
    document.getElementById('project-name')?.addEventListener('click', () => ProjectManager.renameProject());

    // 窗口控制按钮
    document.getElementById('win-minimize')?.addEventListener('click', () => window.api.windowMinimize());
    document.getElementById('win-maximize')?.addEventListener('click', () => window.api.windowMaximize());
    document.getElementById('win-close')?.addEventListener('click', () => window.api.windowClose());

    // 调试按钮
    document.getElementById('btn-debug-continue')?.addEventListener('click', () => DevMode.continueExecution());
    document.getElementById('btn-debug-step')?.addEventListener('click', () => DevMode.stepExecution());
    document.getElementById('btn-debug-stop')?.addEventListener('click', () => DevMode.stopDebug());

    // 舞台标签切换已移除（堆叠布局）

    // 精灵面板按钮（元素在隐藏面板中，用可选链）
    document.getElementById('btn-add-sprite')?.addEventListener('click', () => {
      const s = StageManager.addSprite((i18n.isEnglish() ? 'Sprite' : '精灵') + (StageManager.getSprites().length + 1));
      const idx = StageManager.getSprites().indexOf(s);
      if (idx >= 0) StageManager.setActiveSprite(idx);
    });
    document.getElementById('btn-upload-costume')?.addEventListener('click', uploadCostumeDialog);
    document.getElementById('btn-set-costume')?.addEventListener('click', setCostumeDialog);
    document.getElementById('btn-clear-costume')?.addEventListener('click', clearCostume);

    // 音频面板按钮（编辑器本地）
    document.getElementById('btn-add-audio')?.addEventListener('click', () => _addAudioFile());
    document.getElementById('btn-stop-all-audio')?.addEventListener('click', () => {
      if (typeof SoundManager !== 'undefined') SoundManager.stopAll();
    });

    // 键盘快捷键
    document.addEventListener('keydown', (e) => {
      // Ctrl+Z = 撤销
      if (e.ctrlKey && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        if (typeof HistoryManager !== 'undefined') HistoryManager.undo();
      }
      // Ctrl+Y 或 Ctrl+Shift+Z = 重做
      else if (e.ctrlKey && e.key === 'y') {
        e.preventDefault();
        if (typeof HistoryManager !== 'undefined') HistoryManager.redo();
      }
      else if (e.ctrlKey && e.shiftKey && e.key === 'Z') {
        e.preventDefault();
        if (typeof HistoryManager !== 'undefined') HistoryManager.redo();
      }
      // Ctrl+S = 保存
      else if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        _actionSave();
      }
      // F5 = 运行
      else if (e.key === 'F5' && !e.shiftKey) {
        e.preventDefault();
        _actionRun();
      }
      // Shift+F5 = 停止
      else if (e.key === 'F5' && e.shiftKey) {
        e.preventDefault();
        _actionStop();
      }
      // Ctrl+Shift+Q = 强制停止
      else if (e.ctrlKey && e.shiftKey && (e.key === 'Q' || e.key === 'q')) {
        e.preventDefault();
        _actionForceStop();
      }
    });

    // 定期更新积木计数（切换精灵时自动反映）+ 未保存状态检测
    EditorState._isDirty = false;
    EditorState._blocksSnapshot = JSON.stringify(EditorState.blocks || {});
    setInterval(() => {
      const count = Object.keys(EditorState.blocks || {}).length;
      const sprite = StageManager.getActiveSprite();
      const spriteName = sprite ? sprite.name : '';
      document.getElementById('block-count').textContent =
        (i18n.isEnglish() ? spriteName + ': ' : spriteName + '：') + count + (i18n.isEnglish() ? ' blocks' : ' 个积木');
      // 推送面板更新
      _pushPanelSprites();
      // 检测积木数据变化，标记未保存状态并记录历史
      const snapshot = JSON.stringify(EditorState.blocks || {});
      if (snapshot !== EditorState._blocksSnapshot) {
        EditorState._isDirty = true;
        // 记录撤销历史（防抖，避免拖拽时记录太多次）
        if (typeof HistoryManager !== 'undefined') {
          HistoryManager.pushSnapshotDebounced();
        }
      }
    }, 500);

    // 网页端未保存退出弹窗（刷新页面 / 关闭标签页 / 跳转外链）
    window.addEventListener('beforeunload', (e) => {
      if (EditorState._isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    // 监听主进程发来的加载新项目事件
    if (window.api && window.api.onLoadProject) {
      window.api.onLoadProject((path, mode, renderMode) => {
        // 重新加载页面以应用新的 renderMode
        if (renderMode) {
          const url = new URL(window.location.href);
          url.searchParams.set('path', path);
          url.searchParams.set('mode', mode || 'normal');
          url.searchParams.set('render', renderMode);
          window.location.href = url.toString();
        } else {
          loadProject(path, mode);
        }
      });
    }
  });

  // ============================================================
  // 渲染模式热切换：从 2D 切换到 3D（用于社区预览）
  // ============================================================
  function switchTo3D() {
    if (typeof Stage3D === 'undefined') return false;
    // 停止 2D 渲染循环
    StageCanvas.stop();
    // 查找或创建离屏 canvas
    var oldCanvas = document.getElementById('stage-canvas');
    var newCanvas;
    if (oldCanvas) {
      newCanvas = document.createElement('canvas');
      newCanvas.id = 'stage-canvas';
      newCanvas.width = 480;
      newCanvas.height = 360;
      if (oldCanvas.parentNode) {
        oldCanvas.parentNode.replaceChild(newCanvas, oldCanvas);
      }
    } else {
      newCanvas = document.createElement('canvas');
      newCanvas.id = 'stage-canvas';
      newCanvas.width = 480;
      newCanvas.height = 360;
    }
    // 初始化 3D 舞台
    var success = Stage3D.init(newCanvas);
    if (success) {
      // 重新绑定侦测输入
      if (typeof SensingInput !== 'undefined') SensingInput.init(newCanvas);
      console.log('[switchTo3D] 已切换到 3D 模式');
    } else {
      console.warn('[switchTo3D] Stage3D 初始化失败');
    }
    return success;
  }

  // ============================================================
  // 社区作品在线预览：从社区 API 获取项目并加载到编辑器
  // ============================================================
  async function loadProjectFromCommunity(projectId) {
    try {
      document.getElementById('status-text').textContent = i18n.isEnglish() ? 'Loading preview...' : '正在加载预览...';

      // 初始化社区 API
      if (typeof CommunityAPI === 'undefined') {
        throw new Error(i18n.isEnglish() ? 'Community module not loaded' : '社区模块未加载');
      }
      CommunityAPI.init();

      // 获取项目数据
      const res = await CommunityAPI.getProjectById(projectId);
      if (res.error || !res.data) {
        throw new Error(i18n.isEnglish() ? 'Project not found' : '作品不存在');
      }

      const project = res.data;
      const previewPath = 'vfs:community-preview/' + project.title;

      // 优先使用 ZIP 文件（包含完整项目结构、精灵、造型等）
      if (project.zip_url) {
        try {
          const resp = await fetch(project.zip_url);
          if (resp.ok) {
            const blob = await resp.blob();
            const zip = await JSZip.loadAsync(blob);

            // 二进制文件扩展名 → MIME 类型映射
            const BINARY_EXTS = {
              '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
              '.gif':'image/gif', '.bmp':'image/bmp', '.webp':'image/webp', '.svg':'image/svg+xml',
              '.wav':'audio/wav', '.mp3':'audio/mpeg', '.ogg':'audio/ogg'
            };
            function _mimeForName(fname) {
              const dot = fname.lastIndexOf('.');
              if (dot < 0) return null;
              return BINARY_EXTS[fname.slice(dot).toLowerCase()] || null;
            }

            // 将 ZIP 内容写入 VFS
            let _assetWarnCount = 0;
            for (const [relativePath, file] of Object.entries(zip.files)) {
              if (file.dir) continue;
              const fullPath = previewPath + '/' + relativePath;
              const mime = _mimeForName(file.name);
              if (mime) {
                // 二进制文件：用正确的 MIME 类型 data URL 存储
                try {
                  const base64 = await file.async('base64');
                  localStorage.setItem('vfsb:' + fullPath, 'data:' + mime + ';base64,' + base64);
                } catch (storeErr) {
                  _assetWarnCount++;
                  console.warn('[preview] 存储失败（可能超出容量）:', relativePath, storeErr.message);
                }
              } else {
                // 文本文件
                const text = await file.async('text');
                await window.api.writeFile(fullPath, text);
              }
            }
            if (_assetWarnCount > 0) {
              const msg = (i18n.isEnglish()
                ? 'Warning: {n} asset(s) failed to store (localStorage may be full). Try clearing browser storage.'
                : '警告：{n} 个素材存储失败（localStorage 可能已满），请尝试清除浏览器存储。').replace('{n}', _assetWarnCount);
              document.getElementById('status-text').textContent = msg;
            }

            // 更新目录索引
            const dirs = new Set();
            for (const [relativePath] of Object.entries(zip.files)) {
              const parts = relativePath.split('/');
              let dirPath = previewPath;
              for (let i = 0; i < parts.length - 1; i++) {
                dirPath += '/' + parts[i];
                dirs.add(dirPath);
              }
            }
            for (const dir of dirs) {
              const dirKey = 'vfs:' + dir + '/__dir__';
              if (!localStorage.getItem(dirKey)) {
                localStorage.setItem(dirKey, '1');
              }
            }

            // 读取 project.json 检查渲染模式，如需切换到 3D
            try {
              const cfgStr = await window.api.readFile(previewPath + '/project.json');
              if (cfgStr) {
                const cfg = JSON.parse(cfgStr);
                if (cfg.renderMode === '3d') {
                  switchTo3D();
                }
              }
            } catch(e) { /* ignore */ }

            document.getElementById('status-text').textContent = (i18n.isEnglish() ? 'Preview loaded: ' : '预览已加载: ') + project.title;
            await loadProject(previewPath, project.mode || 'normal');
            return;
          }
        } catch (zipErr) {
          console.warn('[preview] ZIP 加载失败，回退到 json_data:', zipErr.message);
        }
      }

      // 回退方案：使用 json_data（仅包含积木数据）
      if (project.json_data) {
        // 创建最小化的 project.json
        const config = {
          name: project.title || 'Preview',
          mode: project.mode || 'normal',
          renderMode: project.render_mode || '2d',
          sprites: []
        };
        // 如需 3D 模式，先切换舞台
        if (config.renderMode === '3d') {
          switchTo3D();
        }
        await window.api.writeFile(previewPath + '/project.json', JSON.stringify(config, null, 2));
        // 写入积木数据
        await window.api.writeFile(previewPath + '/scripts/main.json', project.json_data);

        document.getElementById('status-text').textContent = (i18n.isEnglish() ? 'Preview loaded (blocks only): ' : '预览已加载(仅积木): ') + project.title;
        await loadProject(previewPath, 'normal');
        return;
      }

      throw new Error(i18n.isEnglish() ? 'No preview data available' : '无可预览的数据');

    } catch (e) {
      console.error('[preview] 加载失败:', e);
      document.getElementById('status-text').textContent = (i18n.isEnglish() ? 'Preview failed: ' : '预览加载失败: ') + e.message;
      alert((i18n.isEnglish() ? 'Preview failed: ' : '在线预览失败: ') + e.message);
    }
  }

  async function loadProject(folder, mode) {
    try {
    const configStr = await window.api.readFile(folder + '/project.json');
    if (!configStr) return;

    const config = JSON.parse(configStr);
    EditorState.projectPath = folder;
    EditorState.projectName = config.name || i18n.t('app.unnamed');
    EditorState.projectMode = config.mode || mode || 'normal';
    document.getElementById('project-name').textContent = EditorState.projectName;

    // 检查项目渲染模式，如需切换到 3D
    if (config.renderMode === '3d' && (typeof Stage3D === 'undefined' || !Stage3D.isInitialized || !Stage3D.isInitialized())) {
      console.log('[loadProject] 项目为 3D 模式，切换舞台到 3D...');
      switchTo3D();
      if (typeof EditorState !== 'undefined') EditorState.renderMode = '3d';
    }

    // 更新右侧窗口标题中的项目名
    updateRwinTitles();

    // 初始化造型管理器（从项目 assets 目录加载）
    try {
      await CostumeManager.init(folder);
      refreshCostumeLibrary();
    } catch(e) {
      console.warn('[造型管理器] 初始化失败:', e.message);
    }

    // 加载项目扩展：从 extensions 目录加载可用定义，恢复已安装的扩展
    if (typeof ExtensionManager !== 'undefined') {
      // 加载项目 extensions 目录的所有扩展文件到可用池
      if (EditorState.projectPath) {
        try {
          await ExtensionManager.loadFromProject(EditorState.projectPath);
        } catch (e) {
          console.warn('[扩展] 加载项目扩展失败:', e.message);
        }
      }
      // 恢复已安装的扩展（根据 project.json 中保存的 installedExtensions）
      if (config.installedExtensions && Array.isArray(config.installedExtensions)) {
        const count = ExtensionManager.restoreInstalled(config.installedExtensions);
        if (count > 0) {
          Palette.init();
          console.log(`[扩展] 已恢复 ${count} 个已安装扩展`);
        }
      }
    }

    const scriptsStr = await window.api.readFile(folder + '/scripts/main.json');
    let mainBlocks = {};
    if (scriptsStr) {
      mainBlocks = Serializer.deserialize(scriptsStr);
    }

    // 恢复精灵数据（含贴图加载和积木恢复）
    if (config.sprites && Array.isArray(config.sprites) && config.sprites.length > 0) {
      StageManager.restoreSprites(config.sprites, folder);
      // 如果精灵没有自己的积木（旧项目），把 main.json 的积木分配给第一个精灵
      const sprites = StageManager.getSprites();
      const hasBlocks = sprites.some(s => s.blocks && Object.keys(s.blocks).length > 0);
      if (!hasBlocks && Object.keys(mainBlocks).length > 0) {
        // 旧项目：把所有积木分配给第一个精灵
        sprites[0].blocks = mainBlocks;
        EditorState.blocks = mainBlocks;
      }
    } else {
      // 无精灵数据，直接使用 main.json
      EditorState.blocks = mainBlocks;
    }

    document.getElementById('status-text').textContent = i18n.t('status.loaded', null).replace('{name}', EditorState.projectName);

    // 扩展模式：显示文件标签页
    if (EditorState.projectMode === 'extension') {
      document.getElementById('stage-panel').classList.add('extension-mode');
      const filesEl = document.getElementById('files-content');
      if (filesEl) filesEl.classList.remove('hidden');
      FileEditor.refreshFileList();
    }

    // 高级模式：激活 Godot 式布局并加载数据
    if (EditorState.projectMode === 'advanced') {
      initAdvancedMode();
      // projectMode 已设置为 'advanced'，重新初始化积木面板以显示场景分类
      if (typeof Palette !== 'undefined') Palette.init();

      // 恢复 SceneGraph - 优先从场景文件加载，回退到 config.sceneGraph
      let sceneLoaded = false;
      const sceneFileRel = config.mainScene || 'scenes/main.scene.json';
      const _pj = window.api.pathJoin || ((...a) => a.join('/'));
      const sceneFilePath = await _pj(folder, sceneFileRel);
      const scenesDir = await _pj(folder, 'scenes');
      const mainScenePath = await _pj(scenesDir, 'main.scene.json');
      // 跟踪当前场景名（供场景积木使用）
      EditorState._currentSceneName = sceneFileRel.replace(/^scenes\//, '').replace(/\.scene\.json$/, '');
      try {
        const sceneContent = await window.api.readFile(sceneFilePath);
        if (sceneContent && typeof SceneGraph !== 'undefined') {
          const sceneData = JSON.parse(sceneContent);
          if (sceneData.rootId || sceneData.nodes) {
            SceneGraph.fromJSON(sceneData);
            if (typeof StageManager !== 'undefined') StageManager.syncFromSceneGraph();
            // 3D 场景：同步 Mesh3D 节点到 Three.js 渲染
            if (typeof Stage3D !== 'undefined' && Stage3D.isInitialized && Stage3D.isInitialized()) {
              Stage3D.syncMeshesFromSceneGraph();
            }
            sceneLoaded = true;
            console.log('[高级模式] 已从场景文件加载:', sceneFilePath);
          }
        }
      } catch (e) {
        console.warn('[高级模式] 场景文件不存在，回退到 project.json');
      }

      if (!sceneLoaded && config.sceneGraph && typeof SceneGraph !== 'undefined') {
        // 旧项目回退：从 config.sceneGraph 加载
        SceneGraph.fromJSON(config.sceneGraph);
        if (typeof StageManager !== 'undefined') StageManager.syncFromSceneGraph();
        // 3D 场景：同步 Mesh3D 节点到 Three.js 渲染
        if (typeof Stage3D !== 'undefined' && Stage3D.isInitialized && Stage3D.isInitialized()) {
          Stage3D.syncMeshesFromSceneGraph();
        }
        // 保存为场景文件（迁移到文件系统）
        try {
          await window.api.ensureDir(scenesDir);
          const sceneData = { name: 'main', ...SceneGraph.toJSON() };
          await window.api.writeFile(mainScenePath, JSON.stringify(sceneData, null, 2));
          console.log('[高级模式] 已迁移场景数据到 scenes/main.scene.json');
        } catch (e) {
          console.warn('[高级模式] 保存场景文件失败:', e);
        }
      }

      // 新项目：确保默认场景文件存在
      if (!sceneLoaded && !config.sceneGraph && typeof SceneGraph !== 'undefined') {
        try {
          await window.api.ensureDir(scenesDir);
          const sceneData = { name: 'main', ...SceneGraph.toJSON() };
          await window.api.writeFile(mainScenePath, JSON.stringify(sceneData, null, 2));
          console.log('[高级模式] 已创建默认场景文件');
        } catch (e) {
          console.warn('[高级模式] 创建默认场景文件失败:', e);
        }
      }

      // 恢复 JS 脚本
      if (config.jsScripts && typeof EditorApp !== 'undefined' && EditorApp.setAllSpriteScripts) {
        const scripts = {};
        Object.keys(config.jsScripts).forEach(k => {
          scripts[parseInt(k)] = config.jsScripts[k];
        });
        EditorApp.setAllSpriteScripts(scripts);
      }

      // 自动选中第一个 Sprite2D 节点（确保编辑器与精灵关联、代码可保存/运行）
      if (typeof SceneGraph !== 'undefined' && typeof SceneTree !== 'undefined') {
        const root = SceneGraph.getRoot();
        let firstSpriteId = null;
        if (root && root.children) {
          for (const childId of root.children) {
            const child = SceneGraph.getNode(childId);
            if (child && child.type === 'Sprite2D') {
              firstSpriteId = childId;
              break;
            }
          }
        }
        if (firstSpriteId) {
          // selectNode 会设置 _editorSpriteIdx、加载脚本到编辑器、同步 StageManager
          SceneTree.selectNode(firstSpriteId);
          console.log('[高级模式] 已自动选中精灵:', firstSpriteId);
        } else {
          // 没有 Sprite2D，设置编辑器为默认代码
          if (EditorApp.getJsEditor()) {
            EditorApp.getJsEditor().setValue('// 在此编写 JavaScript 代码\n');
          }
        }
      }

      // 刷新场景树、检查器和文件系统
      if (typeof SceneTree !== 'undefined') SceneTree.refresh();
      if (typeof FileSystemDock !== 'undefined') FileSystemDock.refresh();
      if (typeof Inspector !== 'undefined') {
        const root = (typeof SceneGraph !== 'undefined') ? SceneGraph.getRoot() : null;
        if (root && root.children && root.children.length > 0) {
          Inspector.showNode(root.children[0]);
        } else if (root) {
          Inspector.showNode(root.id);
        }
      }

      // 3D 和 UI 场景仅支持 JS 脚本，隐藏积木 tab
      if (typeof SceneGraph !== 'undefined' && SceneGraph.isJsOnly && SceneGraph.isJsOnly()) {
        const blocksTab = document.querySelector('.script-tab[data-tab="blocks"]');
        const jsTab = document.querySelector('.script-tab[data-tab="js"]');
        if (blocksTab) blocksTab.classList.add('hidden');
        if (jsTab && !jsTab.classList.contains('active')) jsTab.click();
      } else {
        const blocksTab = document.querySelector('.script-tab[data-tab="blocks"]');
        if (blocksTab) blocksTab.classList.remove('hidden');
      }
    }

    // 数据分析模式：初始化并重新应用布局（防止被其他模块覆盖）
    if (EditorState.projectMode === 'data') {
      initDataMode();
      // 重新应用数据布局（即使已初始化，也要确保布局正确）
      if (typeof DataAnalysis !== 'undefined') {
        document.getElementById('main-layout')?.classList.add('hidden');
        document.getElementById('advanced-layout')?.classList.add('hidden');
        document.getElementById('data-layout')?.classList.remove('hidden');
        document.getElementById('toolbar')?.classList.add('hidden');
        document.getElementById('palette-panel')?.classList.add('hidden');
        document.getElementById('stage-panel')?.classList.add('hidden');
      }
      // 尝试加载已保存的数据分析代码
      try {
        const codeStr = await window.api.readFile(folder + '/scripts/main.js');
        if (codeStr && typeof DataAnalysis !== 'undefined') {
          DataAnalysis.setCode(codeStr);
        }
      } catch(e) {}
    }

    // Minecraft 模组开发模式：初始化并重新应用布局
    if (EditorState.projectMode === 'minecraft') {
      initMinecraftMode();
      // 重新将面板移入 mc-editor-panel（loadProject 过程中可能被重置）
      if (typeof MinecraftMod !== 'undefined') {
        const mcEditorPanel = document.getElementById('mc-editor-panel');
        const palettePanel = document.getElementById('palette-panel');
        const editorPanel = document.getElementById('editor-panel');
        const mainLayout = document.getElementById('main-layout');
        // 先恢复到 main-layout
        if (palettePanel && palettePanel.parentNode !== mainLayout) {
          mainLayout.insertBefore(palettePanel, mainLayout.firstChild);
        }
        if (editorPanel && editorPanel.parentNode !== mainLayout) {
          palettePanel?.parentNode?.insertBefore(editorPanel, palettePanel.nextSibling);
        }
        // 再移入 mc-editor-panel
        if (mcEditorPanel && palettePanel && editorPanel) {
          mcEditorPanel.appendChild(palettePanel);
          mcEditorPanel.appendChild(editorPanel);
        }
        document.getElementById('main-layout')?.classList.add('hidden');
        document.getElementById('advanced-layout')?.classList.add('hidden');
        document.getElementById('data-layout')?.classList.add('hidden');
        document.getElementById('mc-layout')?.classList.remove('hidden');
        document.getElementById('toolbar')?.classList.add('hidden');
        document.getElementById('stage-panel')?.classList.add('hidden');
        // 重新初始化积木面板
        if (typeof Palette !== 'undefined') Palette.init();
        // 延迟刷新 CodeMirror（布局从 hidden 变为可见后需要重新计算尺寸）
        // 同时重绘画布（移入新容器后需要重新计算尺寸）
        setTimeout(() => {
          if (typeof EditorCanvas !== 'undefined') {
            EditorCanvas.resize();
            EditorCanvas.render();
          }
          if (typeof MinecraftMod !== 'undefined' && MinecraftMod.getEditor && MinecraftMod.getEditor()) {
            MinecraftMod.getEditor().refresh();
          }
        }, 200);
      }
    }

    // 代码编程模式：重新应用布局
    if (EditorState.projectMode && EditorState.projectMode.startsWith('code-')) {
      initCodeMode(EditorState.projectMode);
      // 重新应用布局（确保隐藏其他布局）
      document.getElementById('main-layout')?.classList.add('hidden');
      document.getElementById('advanced-layout')?.classList.add('hidden');
      document.getElementById('data-layout')?.classList.add('hidden');
      document.getElementById('mc-layout')?.classList.add('hidden');
      document.getElementById('toolbar')?.classList.add('hidden');
      document.getElementById('palette-panel')?.classList.add('hidden');
      document.getElementById('stage-panel')?.classList.add('hidden');
      document.getElementById('code-layout')?.classList.remove('hidden');
      // 延迟刷新 CodeMirror
      setTimeout(() => {
        const editor = getCodeEditor();
        if (editor) editor.refresh();
      }, 200);
    }

    // 加载声音
    await loadProjectSounds();

    // 更新积木计数
    const count = Object.keys(EditorState.blocks).length;
    document.getElementById('block-count').textContent = i18n.t('editor.blockCount', null).replace('{n}', count);

    // 项目加载完成后重置未保存状态
    EditorState._isDirty = false;
    EditorState._blocksSnapshot = JSON.stringify(EditorState.blocks || {});

    // 初始化历史记录管理器（用于撤销/重做）
    if (typeof HistoryManager !== 'undefined') {
      HistoryManager.init();
    }

    // 初始化自动保存管理器
    if (typeof AutoSaveManager !== 'undefined') {
      AutoSaveManager.init();
    }
    } catch(e) {
      console.error('[项目加载失败]', e);
      document.getElementById('status-text').textContent = i18n.t('status.loadFailed', null).replace('{error}', e.message);
    } finally {
      // 无论加载是否完全成功，都尝试打开面板（高级模式已在 initAdvancedMode 中打开）
      try {
        _initPanels();
        _pushAudioList();
        // 项目加载完成后，强制推送精灵和标题数据到面板窗口
        // （高级模式中 _initPanels 在项目加载前就已调用，此时才有精灵数据）
        _lastStageJSON = '';  // 重置脏检查，确保数据推送到面板
        _pushPanelTitle();
        _pushPanelSprites();
      } catch(e) { console.error('[Panel] initPanels error:', e); }
    }
  }

  // ============================================================
  // 高级模式 JS 脚本执行
  // ============================================================

  /** 创建精灵 API 代理对象（将所有积木功能映射为方法） */
  function _createSpriteAPI(raw, idx) {
    const SM = (typeof StageManager !== 'undefined') ? StageManager : null;
    if (!SM) return raw;

    const proxy = Object.create(null);

    // 基础属性（getter/setter 直接读写原始精灵）
    Object.defineProperties(proxy, {
      name: { get() { return raw.name; }, set(v) { raw.name = v; if (typeof SceneTree !== 'undefined') SceneTree.refresh(); } },
      x: { get() { return raw.x; }, set(v) { raw.x = Number(v); } },
      y: { get() { return raw.y; }, set(v) { raw.y = Number(v); } },
      direction: { get() { return raw.direction; }, set(v) { raw.direction = Number(v); } },
      size: { get() { return raw.size; }, set(v) { raw.size = Number(v); } },
      visible: { get() { return raw.visible; }, set(v) { raw.visible = !!v; } },
      color: { get() { return raw.color; }, set(v) { raw.color = v; } },
      sayText: { get() { return raw.sayText; }, set(v) { raw.sayText = String(v); } },
      vx: { get() { return raw.vx || 0; }, set(v) { raw.vx = Number(v); } },
      vy: { get() { return raw.vy || 0; }, set(v) { raw.vy = Number(v); } },
      rotationStyle: { get() { return raw.rotationStyle; }, set(v) { raw.rotationStyle = v; } },
      _raw: { value: raw },
      _idx: { value: idx },
    });

    // === 外观 ===
    proxy.say = (text) => { SM.setSpriteSay(idx, String(text)); };
    proxy.sayFor = (text, sec) => { SM.setSpriteSay(idx, String(text)); setTimeout(() => SM.setSpriteSay(idx, ''), Number(sec) * 1000); };
    proxy.think = (text) => { SM.setSpriteSay(idx, '\u{1F4AD} ' + String(text)); };
    proxy.clearSay = () => { SM.setSpriteSay(idx, ''); };
    proxy.show = () => { raw.visible = true; };
    proxy.hide = () => { raw.visible = false; };
    proxy.setSize = (sz) => { SM.setSpriteSize(idx, Number(sz)); };
    proxy.changeSize = (n) => { SM.changeSpriteSize(idx, Number(n)); };
    proxy.nextCostume = async () => {
      if (typeof CostumeManager !== 'undefined') {
        const names = CostumeManager.getAllNames();
        if (names.length > 0) {
          const curName = raw.costumeName || '';
          const curIdx = names.indexOf(curName);
          await SM.setSpriteCostume(idx, names[(curIdx + 1) % names.length]);
        }
      }
    };
    proxy.setCostume = async (name) => { await SM.setSpriteCostume(idx, name); };
    proxy.setColor = (val) => { raw.colorEffect = Number(val); };
    proxy.clearEffects = () => { raw.colorEffect = 0; raw.size = 100; };

    // === 运动 ===
    proxy.move = (steps) => { SM.moveSprite(idx, Number(steps)); };
    proxy.turnRight = (deg) => { SM.rotateSprite(idx, Number(deg)); };
    proxy.turnLeft = (deg) => { SM.rotateSprite(idx, -Number(deg)); };
    proxy.pointInDirection = (deg) => { SM.setSpriteDir(idx, Number(deg)); };
    proxy.goTo = (x, y) => { SM.setSpritePos(idx, Number(x), Number(y)); };
    proxy.bounce = () => { SM.bounceSprite(idx); };
    proxy.clampToStage = () => {
      const hw = SM.STAGE_W / 2, hh = SM.STAGE_H / 2;
      raw.x = Math.max(-hw, Math.min(hw, raw.x));
      raw.y = Math.max(-hh, Math.min(hh, raw.y));
    };
    proxy.wrapAround = () => {
      const hw = SM.STAGE_W / 2, hh = SM.STAGE_H / 2;
      if (raw.x > hw) raw.x = -hw; else if (raw.x < -hw) raw.x = hw;
      if (raw.y > hh) raw.y = -hh; else if (raw.y < -hh) raw.y = hh;
    };
    proxy.goToRandomPosition = () => {
      const hw = SM.STAGE_W / 2, hh = SM.STAGE_H / 2;
      raw.x = Math.random() * hw * 2 - hw;
      raw.y = Math.random() * hh * 2 - hh;
    };

    // === 侦测 ===
    proxy.isTouchingEdge = () => SM.isTouchingEdge(idx);
    proxy.isTouchingSprite = (name) => {
      const all = SM.getSprites();
      const tIdx = all.findIndex(s => s.name === name);
      return tIdx >= 0 ? SM.isTouchingSprite(idx, tIdx) : false;
    };
    proxy.distanceTo = (name) => {
      const all = SM.getSprites();
      const t = all.find(s => s.name === name);
      return t ? SM.getDistanceToPoint(idx, t.x, t.y) : 0;
    };
    proxy.directionTo = (name) => {
      const all = SM.getSprites();
      const t = all.find(s => s.name === name);
      return t ? SM.getDirectionToPoint(idx, t.x, t.y) : 0;
    };
    proxy.distanceToMouse = () => {
      const SI = (typeof SensingInput !== 'undefined') ? SensingInput : null;
      return SI ? SM.getDistanceToPoint(idx, SI.getMouseX(), SI.getMouseY()) : 0;
    };
    proxy.directionToMouse = () => {
      const SI = (typeof SensingInput !== 'undefined') ? SensingInput : null;
      return SI ? SM.getDirectionToPoint(idx, SI.getMouseX(), SI.getMouseY()) : 0;
    };

    // === 高级运动 ===
    proxy.setVelocity = (vx, vy) => { SM.setVelocity(idx, vx, vy); };
    proxy.changeVelocity = (dvx, dvy) => { SM.changeVelocity(idx, dvx, dvy); };
    proxy.updateVelocity = () => { SM.updateVelocity(idx); };
    proxy.applyGravity = (g) => { SM.applyGravity(idx, g); };
    proxy.applyFriction = (f) => { SM.applyFriction(idx, f); };
    proxy.bounceEdgeVelocity = () => { SM.bounceEdgeVelocity(idx); };
    proxy.pointTowards = (tx, ty) => { SM.pointTowards(idx, tx, ty); };
    proxy.moveTowards = (tx, ty, steps) => { SM.moveTowards(idx, tx, ty, steps || 3); };

    // === 克隆 ===
    proxy.clone = () => SM.cloneSprite(idx);

    return proxy;
  }

  /** 创建全局 API 对象 */
  function _createGlobalAPI() {
    const SM = (typeof StageManager !== 'undefined') ? StageManager : null;
    const SI = (typeof SensingInput !== 'undefined') ? SensingInput : null;
    const SND = (typeof SoundManager !== 'undefined') ? SoundManager : null;

    return {
      get stageWidth() { return SM ? SM.STAGE_W : 480; },
      get stageHeight() { return SM ? SM.STAGE_H : 360; },
      getSprites: () => SM ? SM.getSprites() : [],
      getSpriteByName: (name) => SM ? SM.getSpriteByName(name) : null,
      getSpriteCount: () => SM ? SM.getSpriteCount() : 0,
      setActiveSprite: (idx) => SM && SM.setActiveSprite(idx),
      get mouseX() { return SI ? SI.getMouseX() : 0; },
      get mouseY() { return SI ? SI.getMouseY() : 0; },
      isMouseDown: () => SI ? SI.isMouseDown() : false,
      isKeyPressed: (key) => SI ? SI.isKeyPressed(key) : false,
      getVolume: () => SND ? SND.getVolume() : 0,
      setVolume: (v) => SND && SND.setVolume(v),
      random: (a, b) => Math.floor(Math.random() * (b - a + 1)) + a,
      randomFloat: () => Math.random(),
      randomRange: (a, b) => Math.random() * (b - a) + a,
      now: () => new Date(),
      timer: () => Date.now() / 1000,
    };
  }

  let _jsScriptFrameCount = 0;  // JS 脚本周期计数器（用于节流 UI 刷新）

  function runAdvancedScripts() {
    const sprites = (typeof StageManager !== 'undefined') ? StageManager.getSprites() : [];
    const globalVars = (typeof Executor !== 'undefined') ? Executor._getGlobalVars() : {};
    const editor = (typeof EditorApp !== 'undefined' && EditorApp.getJsEditor) ? EditorApp.getJsEditor() : null;
    const globalAPI = _createGlobalAPI();
    _jsScriptFrameCount++;
    if (_jsScriptFrameCount <= 3) console.log('[JS脚本] 第' + _jsScriptFrameCount + '帧, 精灵数:', sprites.length, '编辑器:', !!editor, '编辑索引:', _editorSpriteIdx);

    sprites.forEach((sprite, index) => {
      let code;
      // 只有编辑器当前关联的精灵才从编辑器读取代码
      if (editor && _editorSpriteIdx === index) {
        code = editor.getValue();
        _spriteScripts[index] = code;
      } else {
        // 使用该精灵自己的脚本
        code = _spriteScripts[index] || '';
      }
      if (!code || !code.trim() || /^\s*(\/\/[^\n]*\n?|\/\*[\s\S]*?\*\/\s*)+$/.test(code)) return;
      if (_jsScriptFrameCount <= 3) console.log('[JS脚本] 执行精灵', index, '代码长度:', code.length);

      try {
        const api = _createSpriteAPI(sprite, index);
        const logFn = (msg) => {
          const logEl = document.getElementById('output-log');
          if (logEl) logEl.textContent += '\n' + msg;
          if (window.api && window.api.sendPanelUpdate) {
            window.api.sendPanelUpdate({ type: 'output', action: 'append', text: '\n' + msg });
          }
        };
        // 常用方法作为全局函数注入
        const fn = new Function('sprite', 'globalVars', 'log', 'stage',
          'say', 'sayFor', 'think', 'move', 'turnRight', 'turnLeft',
          'show', 'hide', 'setSize', 'changeSize',
          code
        );
        fn(
          api, globalVars, logFn, globalAPI,
          api.say.bind(api), api.sayFor.bind(api), api.think.bind(api),
          api.move.bind(api), api.turnRight.bind(api), api.turnLeft.bind(api),
          api.show.bind(api), api.hide.bind(api), api.setSize.bind(api), api.changeSize.bind(api)
        );
      } catch (e) {
        console.error(`[JS执行错误] 角色 ${sprite.name || index}:`, e);
        const logEl = document.getElementById('output-log');
        if (logEl) {
          logEl.textContent += `\n[JS错误] ${sprite.name || ('角色' + index)}: ${e.message}`;
        }
      }
    });

    // 节流 UI 刷新（每 10 帧 ~330ms）
    if (_jsScriptFrameCount % 10 === 0) {
      if (typeof SceneTree !== 'undefined') SceneTree.refresh();
      if (typeof Inspector !== 'undefined') Inspector.refresh();
    }
  }

  return {
    getJsEditor,
    getSpriteScript,
    setSpriteScript,
    getAllSpriteScripts,
    setAllSpriteScripts,
    getNodeScript,
    setNodeScript,
    setEditorSpriteIdx,
    getEditorSpriteIdx,
    initAdvancedMode,
    runAdvancedScripts,
  };
})();
