/**
 * 素材管理器 - 图片编辑 / 动图编辑 / 素材库管理
 */
(function () {
  // ========== 状态 ==========
  var _currentView = 'home'; // home | image | anim
  var _assetStore = []; // { id, name, type: 'image'|'anim', dataUrl|frames, width, height, createdAt }
  var _selectedAssetId = null;
  var _filterType = 'all'; // all | image | anim
  var _projectPath = null; // 从编辑器打开时传入

  // 图片编辑器状态
  var _imgTool = 'brush';
  var _imgColor = '#cccccc';
  var _imgSize = 3;
  var _imgDrawing = false;
  var _imgLastX = 0, _imgLastY = 0;
  var _imgHistory = [];
  var _imgHistoryIdx = -1;
  var _imgShapeStart = null; // {x,y} for rect/circle/line

  // 动图编辑器状态
  var _animFrames = []; // { canvas, dataUrl }
  var _animCurrentFrame = -1;
  var _animPlaying = false;
  var _animPlayTimer = null;
  var _animPlayIdx = 0;
  var _animTool = 'brush';
  var _animColor = '#cccccc';
  var _animSize = 3;
  var _animDrawing = false;
  var _animLastX = 0, _animLastY = 0;
  var _animHistory = [];
  var _animHistoryIdx = -1;
  var _animDragIdx = -1;

  // ========== 初始化 ==========
  document.addEventListener('DOMContentLoaded', function () {
    // 窗口控制
    document.getElementById('win-minimize')?.addEventListener('click', function () { window.api?.windowMinimize(); });
    document.getElementById('win-maximize')?.addEventListener('click', function () { window.api?.windowMaximize(); });
    document.getElementById('win-close')?.addEventListener('click', function () { window.api?.windowClose(); });

    // 工具栏
    document.getElementById('btn-back').addEventListener('click', goHome);
    document.getElementById('btn-save').addEventListener('click', saveCurrent);
    document.getElementById('btn-export').addEventListener('click', exportToProject);

    // 主页卡片
    document.getElementById('card-image').addEventListener('click', function () { openImageEditor(null); });
    document.getElementById('card-anim').addEventListener('click', function () { openAnimEditor(null); });

    // 主页按钮
    document.getElementById('btn-import-file').addEventListener('click', importFile);
    document.getElementById('btn-filter-all').addEventListener('click', function () { setFilter('all'); });
    document.getElementById('btn-filter-img').addEventListener('click', function () { setFilter('image'); });
    document.getElementById('btn-filter-gif').addEventListener('click', function () { setFilter('anim'); });

    // 图片编辑器工具栏
    initImageTools();
    // 动图编辑器工具栏
    initAnimTools();

    // 快捷键
    document.addEventListener('keydown', function (e) {
      if (_currentView === 'image') {
        if (e.ctrlKey && e.key === 'z') { e.preventDefault(); imgUndo(); }
        if (e.ctrlKey && e.key === 'y') { e.preventDefault(); imgRedo(); }
      }
      if (_currentView === 'anim') {
        if (e.ctrlKey && e.key === 'z') { e.preventDefault(); animFrameUndo(); }
        if (e.ctrlKey && e.key === 'y') { e.preventDefault(); animFrameRedo(); }
      }
    });

    // 加载素材库
    loadAssetStore();
  });

  // ========== 视图切换 ==========
  function switchView(view) {
    _currentView = view;
    document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('active'); });
    var el = document.getElementById('view-' + view);
    if (el) el.classList.add('active');

    var btnBack = document.getElementById('btn-back');
    var backSep = document.getElementById('back-sep');
    var viewTitle = document.getElementById('view-title');
    var btnSave = document.getElementById('btn-save');
    var btnExport = document.getElementById('btn-export');
    var winTitle = document.getElementById('window-title');

    if (view === 'home') {
      btnBack.style.display = 'none';
      backSep.style.display = 'none';
      viewTitle.textContent = '主页';
      btnSave.style.display = 'none';
      btnExport.style.display = 'none';
      winTitle.textContent = '📦 素材管理';
      refreshAssetGrid();
    } else if (view === 'image') {
      btnBack.style.display = '';
      backSep.style.display = '';
      viewTitle.textContent = '图片编辑器';
      btnSave.style.display = '';
      btnExport.style.display = '';
      winTitle.textContent = '🖼️ 图片编辑器';
    } else if (view === 'anim') {
      btnBack.style.display = '';
      backSep.style.display = '';
      viewTitle.textContent = '动图编辑器';
      btnSave.style.display = '';
      btnExport.style.display = '';
      winTitle.textContent = '🎞️ 动图编辑器';
    }
  }

  function goHome() {
    stopAnimPlayback();
    switchView('home');
  }

  function setStatus(msg) {
    var el = document.getElementById('status-text');
    el.textContent = msg;
    setTimeout(function () { if (el.textContent === msg) el.textContent = ''; }, 3000);
  }

  // ========== 素材库管理 ==========
  function loadAssetStore() {
    try {
      _assetStore = JSON.parse(localStorage.getItem('asset-manager-store') || '[]');
    } catch (e) { _assetStore = []; }
  }

  function saveAssetStore() {
    try {
      localStorage.setItem('asset-manager-store', JSON.stringify(_assetStore));
    } catch (e) {
      console.error('[AssetStore] save error:', e);
    }
  }

  function generateId() {
    return 'asset_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  }

  function setFilter(type) {
    _filterType = type;
    document.querySelectorAll('#view-home .tb-btn').forEach(function (b) { b.classList.remove('active'); });
    var id = type === 'all' ? 'btn-filter-all' : type === 'image' ? 'btn-filter-img' : 'btn-filter-gif';
    document.getElementById(id)?.classList.add('active');
    refreshAssetGrid();
  }

  function refreshAssetGrid() {
    var grid = document.getElementById('asset-grid');
    var empty = document.getElementById('asset-empty');
    var filtered = _filterType === 'all' ? _assetStore : _assetStore.filter(function (a) { return a.type === _filterType; });

    grid.innerHTML = '';
    empty.style.display = filtered.length === 0 ? '' : 'none';

    filtered.forEach(function (asset) {
      var item = document.createElement('div');
      item.className = 'asset-item' + (asset.id === _selectedAssetId ? ' selected' : '');
      var thumbSrc = asset.type === 'image' ? asset.dataUrl : (asset.frames && asset.frames[0] ? asset.frames[0] : '');
      item.innerHTML = '<img src="' + (thumbSrc || '') + '" alt="">' +
        '<div class="asset-name">' + escapeHtml(asset.name) + '</div>' +
        '<span class="asset-badge">' + (asset.type === 'image' ? '图' : '动') + '</span>';
      item.addEventListener('click', function () {
        _selectedAssetId = asset.id;
        if (asset.type === 'image') openImageEditor(asset);
        else openAnimEditor(asset);
      });
      item.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        if (confirm('删除素材 "' + asset.name + '"？')) {
          _assetStore = _assetStore.filter(function (a) { return a.id !== asset.id; });
          saveAssetStore();
          refreshAssetGrid();
        }
      });
      grid.appendChild(item);
    });
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ========== 导入文件 ==========
  async function importFile() {
    var filePath = await window.api?.selectImageFile();
    if (!filePath) return;

    try {
      var data = await window.api?.readFileBinary(filePath);
      if (!data) { setStatus('读取文件失败'); return; }
      var ext = filePath.split('.').pop().toLowerCase();
      var mime = ext === 'svg' ? 'image/svg+xml' : ext === 'gif' ? 'image/gif' : 'image/' + (ext === 'jpg' ? 'jpeg' : ext);
      var dataUrl = 'data:' + mime + ';base64,' + data;
      var name = filePath.split(/[\\/]/).pop();

      var asset = { id: generateId(), name: name, type: 'image', dataUrl: dataUrl, width: 0, height: 0, createdAt: Date.now() };
      _assetStore.push(asset);
      saveAssetStore();
      refreshAssetGrid();
      setStatus('已导入: ' + name);
    } catch (e) {
      setStatus('导入失败: ' + e.message);
    }
  }

  // ========== 图片编辑器 ==========
  function openImageEditor(asset) {
    switchView('image');
    var canvas = document.getElementById('img-canvas');
    var ctx = canvas.getContext('2d');

    if (asset && asset.dataUrl) {
      var img = new Image();
      img.onload = function () {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        document.getElementById('img-width').value = img.width;
        document.getElementById('img-height').value = img.height;
        updateCanvasInfo();
        imgPushHistory();
      };
      img.src = asset.dataUrl;
      canvas.dataset.assetId = asset.id;
    } else {
      var w = parseInt(document.getElementById('img-width').value) || 480;
      var h = parseInt(document.getElementById('img-height').value) || 360;
      canvas.width = w;
      canvas.height = h;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      canvas.dataset.assetId = '';
      updateCanvasInfo();
      imgPushHistory();
    }
  }

  function initImageTools() {
    // 工具按钮
    document.querySelectorAll('[data-tool]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        _imgTool = btn.dataset.tool;
        document.querySelectorAll('[data-tool]').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
      });
    });

    // 颜色
    document.getElementById('img-color').addEventListener('input', function (e) { _imgColor = e.target.value; });
    // 粗细
    document.getElementById('img-size').addEventListener('input', function (e) {
      _imgSize = parseInt(e.target.value);
      document.getElementById('img-size-label').textContent = _imgSize;
    });

    // 撤销/重做/清空
    document.getElementById('img-undo').addEventListener('click', imgUndo);
    document.getElementById('img-redo').addEventListener('click', imgRedo);
    document.getElementById('img-clear').addEventListener('click', function () {
      var canvas = document.getElementById('img-canvas');
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      imgPushHistory();
    });

    // 导入
    document.getElementById('img-import').addEventListener('click', imgImportToCanvas);
    // 调整尺寸
    document.getElementById('img-resize').addEventListener('click', imgResize);

    // Canvas 绘图事件
    var canvas = document.getElementById('img-canvas');
    canvas.addEventListener('mousedown', onImgMouseDown);
    canvas.addEventListener('mousemove', onImgMouseMove);
    canvas.addEventListener('mouseup', onImgMouseUp);
    canvas.addEventListener('mouseleave', onImgMouseUp);
  }

  function getCanvasPos(canvas, e) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height)
    };
  }

  function onImgMouseDown(e) {
    var canvas = document.getElementById('img-canvas');
    var pos = getCanvasPos(canvas, e);

    if (_imgTool === 'fill') {
      imgFill(canvas, Math.round(pos.x), Math.round(pos.y), hexToRgba(_imgColor));
      imgPushHistory();
      return;
    }
    if (_imgTool === 'text') {
      var text = prompt('输入文字:');
      if (text) {
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = _imgColor;
        ctx.font = (_imgSize * 4) + 'px "Microsoft YaHei", sans-serif';
        ctx.fillText(text, pos.x, pos.y);
        imgPushHistory();
      }
      return;
    }
    if (_imgTool === 'rect' || _imgTool === 'circle' || _imgTool === 'line') {
      _imgShapeStart = { x: pos.x, y: pos.y };
      _imgDrawing = true;
      // 保存当前画面用于预览
      _imgShapeSnapshot = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      return;
    }
    _imgDrawing = true;
    _imgLastX = pos.x;
    _imgLastY = pos.y;
  }

  function onImgMouseMove(e) {
    if (!_imgDrawing) return;
    var canvas = document.getElementById('img-canvas');
    var ctx = canvas.getContext('2d');
    var pos = getCanvasPos(canvas, e);

    if (_imgTool === 'brush' || _imgTool === 'eraser') {
      ctx.beginPath();
      ctx.moveTo(_imgLastX, _imgLastY);
      ctx.lineTo(pos.x, pos.y);
      ctx.strokeStyle = _imgTool === 'eraser' ? '#ffffff' : _imgColor;
      ctx.lineWidth = _imgSize;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
      _imgLastX = pos.x;
      _imgLastY = pos.y;
      return;
    }

    // 形状预览
    if (_imgShapeStart) {
      ctx.putImageData(_imgShapeSnapshot, 0, 0);
      ctx.strokeStyle = _imgColor;
      ctx.lineWidth = _imgSize;
      ctx.lineCap = 'round';
      if (_imgTool === 'rect') {
        ctx.strokeRect(_imgShapeStart.x, _imgShapeStart.y, pos.x - _imgShapeStart.x, pos.y - _imgShapeStart.y);
      } else if (_imgTool === 'circle') {
        var rx = Math.abs(pos.x - _imgShapeStart.x) / 2;
        var ry = Math.abs(pos.y - _imgShapeStart.y) / 2;
        var cx = (_imgShapeStart.x + pos.x) / 2;
        var cy = (_imgShapeStart.y + pos.y) / 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (_imgTool === 'line') {
        ctx.beginPath();
        ctx.moveTo(_imgShapeStart.x, _imgShapeStart.y);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
      }
    }
  }

  function onImgMouseUp(e) {
    if (!_imgDrawing) return;
    _imgDrawing = false;
    _imgShapeStart = null;
    _imgShapeSnapshot = null;
    imgPushHistory();
  }

  // 历史记录
  function imgPushHistory() {
    var canvas = document.getElementById('img-canvas');
    var data = canvas.toDataURL();
    _imgHistory = _imgHistory.slice(0, _imgHistoryIdx + 1);
    _imgHistory.push(data);
    if (_imgHistory.length > 50) _imgHistory.shift();
    _imgHistoryIdx = _imgHistory.length - 1;
  }

  function imgUndo() {
    if (_imgHistoryIdx <= 0) return;
    _imgHistoryIdx--;
    imgRestoreFromHistory();
  }

  function imgRedo() {
    if (_imgHistoryIdx >= _imgHistory.length - 1) return;
    _imgHistoryIdx++;
    imgRestoreFromHistory();
  }

  function imgRestoreFromHistory() {
    var canvas = document.getElementById('img-canvas');
    var ctx = canvas.getContext('2d');
    var img = new Image();
    img.onload = function () {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      updateCanvasInfo();
    };
    img.src = _imgHistory[_imgHistoryIdx];
  }

  function updateCanvasInfo() {
    var canvas = document.getElementById('img-canvas');
    document.getElementById('img-canvas-info').textContent = canvas.width + ' × ' + canvas.height;
  }

  async function imgImportToCanvas() {
    var filePath = await window.api?.selectImageFile();
    if (!filePath) return;
    try {
      var data = await window.api?.readFileBinary(filePath);
      if (!data) return;
      var ext = filePath.split('.').pop().toLowerCase();
      var mime = 'image/' + (ext === 'jpg' ? 'jpeg' : ext === 'svg' ? 'svg+xml' : ext);
      var dataUrl = 'data:' + mime + ';base64,' + data;
      var canvas = document.getElementById('img-canvas');
      var ctx = canvas.getContext('2d');
      var img = new Image();
      img.onload = function () {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        document.getElementById('img-width').value = img.width;
        document.getElementById('img-height').value = img.height;
        updateCanvasInfo();
        imgPushHistory();
        setStatus('已导入图片');
      };
      img.src = dataUrl;
    } catch (e) { setStatus('导入失败: ' + e.message); }
  }

  function imgResize() {
    var w = parseInt(document.getElementById('img-width').value) || 480;
    var h = parseInt(document.getElementById('img-height').value) || 360;
    var canvas = document.getElementById('img-canvas');
    var ctx = canvas.getContext('2d');
    var tmp = document.createElement('canvas');
    tmp.width = canvas.width;
    tmp.height = canvas.height;
    tmp.getContext('2d').drawImage(canvas, 0, 0);
    canvas.width = w;
    canvas.height = h;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, 0, 0, w, h);
    updateCanvasInfo();
    imgPushHistory();
    setStatus('尺寸已调整为 ' + w + '×' + h);
  }

  // 泛洪填充
  function imgFill(canvas, startX, startY, fillColor) {
    var ctx = canvas.getContext('2d');
    var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var data = imageData.data;
    var w = canvas.width, h = canvas.height;
    var idx = (startY * w + startX) * 4;
    var targetR = data[idx], targetG = data[idx + 1], targetB = data[idx + 2], targetA = data[idx + 3];

    if (targetR === fillColor[0] && targetG === fillColor[1] && targetB === fillColor[2] && targetA === fillColor[3]) return;

    var stack = [[startX, startY]];
    var visited = new Uint8Array(w * h);
    var tolerance = 30;

    function colorMatch(i) {
      return Math.abs(data[i] - targetR) <= tolerance &&
        Math.abs(data[i + 1] - targetG) <= tolerance &&
        Math.abs(data[i + 2] - targetB) <= tolerance &&
        Math.abs(data[i + 3] - targetA) <= tolerance;
    }

    while (stack.length > 0) {
      var p = stack.pop();
      var x = p[0], y = p[1];
      if (x < 0 || x >= w || y < 0 || y >= h) continue;
      var pi = y * w + x;
      if (visited[pi]) continue;
      var ci = pi * 4;
      if (!colorMatch(ci)) continue;
      visited[pi] = 1;
      data[ci] = fillColor[0];
      data[ci + 1] = fillColor[1];
      data[ci + 2] = fillColor[2];
      data[ci + 3] = fillColor[3];
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    ctx.putImageData(imageData, 0, 0);
  }

  function hexToRgba(hex) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return [r, g, b, 255];
  }

  // ========== 动图编辑器 ==========
  function openAnimEditor(asset) {
    switchView('anim');
    _animFrames = [];
    _animCurrentFrame = -1;
    _animHistory = [];
    _animHistoryIdx = -1;

    if (asset && asset.frames && asset.frames.length > 0) {
      asset.frames.forEach(function (dataUrl) {
        var c = document.createElement('canvas');
        c.width = asset.width || 480;
        c.height = asset.height || 360;
        var ctx = c.getContext('2d');
        var img = new Image();
        img.onload = function () {
          ctx.drawImage(img, 0, 0);
          refreshAnimFrames();
        };
        img.src = dataUrl;
        _animFrames.push({ canvas: c, dataUrl: dataUrl });
      });
      document.getElementById('anim-canvas').width = asset.width || 480;
      document.getElementById('anim-canvas').height = asset.height || 360;
      document.getElementById('anim-canvas').dataset.assetId = asset.id;
    } else {
      var c = document.getElementById('anim-canvas');
      c.width = 480; c.height = 360;
      c.dataset.assetId = '';
      // 添加一帧空白
      addBlankFrame();
    }
    setTimeout(function () { refreshAnimFrames(); }, 100);
  }

  function initAnimTools() {
    // 工具按钮
    document.querySelectorAll('[data-anim-tool]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        _animTool = btn.dataset.animTool;
        document.querySelectorAll('[data-anim-tool]').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
      });
    });

    // 颜色和粗细
    document.getElementById('anim-color').addEventListener('input', function (e) { _animColor = e.target.value; });
    document.getElementById('anim-size').addEventListener('input', function (e) { _animSize = parseInt(e.target.value); });

    // 帧操作
    document.getElementById('anim-add-frame').addEventListener('click', addBlankFrame);
    document.getElementById('anim-import-frame').addEventListener('click', animImportFrame);
    document.getElementById('anim-new-blank').addEventListener('click', addBlankFrame);

    // 撤销/重做/清空
    document.getElementById('anim-frame-undo').addEventListener('click', animFrameUndo);
    document.getElementById('anim-frame-redo').addEventListener('click', animFrameRedo);
    document.getElementById('anim-frame-clear').addEventListener('click', animFrameClear);

    // 播放控制
    document.getElementById('anim-play').addEventListener('click', startAnimPlayback);
    document.getElementById('anim-stop').addEventListener('click', stopAnimPlayback);
    document.getElementById('anim-fps').addEventListener('change', function (e) {
      var fps = parseInt(e.target.value) || 10;
      document.getElementById('anim-frame-duration').value = Math.round(1000 / fps);
      if (_animPlaying) { stopAnimPlayback(); startAnimPlayback(); }
    });
    document.getElementById('anim-frame-duration').addEventListener('change', function (e) {
      var dur = parseInt(e.target.value) || 100;
      document.getElementById('anim-fps').value = Math.round(1000 / dur);
      if (_animPlaying) { stopAnimPlayback(); startAnimPlayback(); }
    });

    // Canvas 绘图事件
    var canvas = document.getElementById('anim-canvas');
    canvas.addEventListener('mousedown', onAnimMouseDown);
    canvas.addEventListener('mousemove', onAnimMouseMove);
    canvas.addEventListener('mouseup', onAnimMouseUp);
    canvas.addEventListener('mouseleave', onAnimMouseUp);
  }

  function addBlankFrame() {
    var canvas = document.getElementById('anim-canvas');
    var w = canvas.width || 480, h = canvas.height || 360;
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    _animFrames.push({ canvas: c, dataUrl: c.toDataURL() });
    _animCurrentFrame = _animFrames.length - 1;
    loadFrameToCanvas(_animCurrentFrame);
    refreshAnimFrames();
  }

  async function animImportFrame() {
    var filePath = await window.api?.selectImageFile();
    if (!filePath) return;
    try {
      var data = await window.api?.readFileBinary(filePath);
      if (!data) return;
      var ext = filePath.split('.').pop().toLowerCase();
      var mime = 'image/' + (ext === 'jpg' ? 'jpeg' : ext === 'svg' ? 'svg+xml' : ext);
      var dataUrl = 'data:' + mime + ';base64,' + data;
      var mainCanvas = document.getElementById('anim-canvas');
      var c = document.createElement('canvas');
      c.width = mainCanvas.width; c.height = mainCanvas.height;
      var ctx = c.getContext('2d');
      var img = new Image();
      img.onload = function () {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        _animFrames.push({ canvas: c, dataUrl: c.toDataURL() });
        _animCurrentFrame = _animFrames.length - 1;
        loadFrameToCanvas(_animCurrentFrame);
        refreshAnimFrames();
        setStatus('已导入帧');
      };
      img.src = dataUrl;
    } catch (e) { setStatus('导入帧失败: ' + e.message); }
  }

  function loadFrameToCanvas(idx) {
    if (idx < 0 || idx >= _animFrames.length) return;
    var frame = _animFrames[idx];
    var canvas = document.getElementById('anim-canvas');
    var ctx = canvas.getContext('2d');
    canvas.width = frame.canvas.width;
    canvas.height = frame.canvas.height;
    ctx.drawImage(frame.canvas, 0, 0);
    _animCurrentFrame = idx;
    animPushHistory();
    document.getElementById('anim-play-overlay').style.display = 'none';
  }

  function saveCurrentFrameToStore() {
    if (_animCurrentFrame >= 0 && _animCurrentFrame < _animFrames.length) {
      var canvas = document.getElementById('anim-canvas');
      _animFrames[_animCurrentFrame].canvas = document.createElement('canvas');
      _animFrames[_animCurrentFrame].canvas.width = canvas.width;
      _animFrames[_animCurrentFrame].canvas.height = canvas.height;
      _animFrames[_animCurrentFrame].canvas.getContext('2d').drawImage(canvas, 0, 0);
      _animFrames[_animCurrentFrame].dataUrl = canvas.toDataURL();
    }
  }

  function refreshAnimFrames() {
    var list = document.getElementById('anim-frames-list');
    list.innerHTML = '';
    document.getElementById('anim-frame-count').textContent = _animFrames.length + ' 帧';

    _animFrames.forEach(function (frame, idx) {
      var item = document.createElement('div');
      item.className = 'anim-frame-item' + (idx === _animCurrentFrame ? ' active' : '');
      item.draggable = true;
      item.dataset.idx = idx;
      item.innerHTML = '<img src="' + (frame.dataUrl || frame.canvas.toDataURL()) + '">' +
        '<div class="frame-info"><div class="frame-name">帧 ' + (idx + 1) + '</div></div>' +
        '<button class="frame-del" title="删除">✕</button>';

      item.addEventListener('click', function (e) {
        if (e.target.classList.contains('frame-del')) return;
        saveCurrentFrameToStore();
        loadFrameToCanvas(idx);
        refreshAnimFrames();
      });

      item.querySelector('.frame-del').addEventListener('click', function (e) {
        e.stopPropagation();
        if (_animFrames.length <= 1) { setStatus('至少保留一帧'); return; }
        _animFrames.splice(idx, 1);
        if (_animCurrentFrame >= _animFrames.length) _animCurrentFrame = _animFrames.length - 1;
        if (_animCurrentFrame >= 0) loadFrameToCanvas(_animCurrentFrame);
        refreshAnimFrames();
      });

      // 拖拽排序
      item.addEventListener('dragstart', function (e) {
        _animDragIdx = idx;
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      item.addEventListener('dragend', function () {
        item.classList.remove('dragging');
        _animDragIdx = -1;
      });
      item.addEventListener('dragover', function (e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
      item.addEventListener('drop', function (e) {
        e.preventDefault();
        var from = _animDragIdx;
        var to = idx;
        if (from === to || from < 0) return;
        saveCurrentFrameToStore();
        var moved = _animFrames.splice(from, 1)[0];
        _animFrames.splice(to, 0, moved);
        // 更新当前帧索引
        if (_animCurrentFrame === from) _animCurrentFrame = to;
        else if (from < _animCurrentFrame && to >= _animCurrentFrame) _animCurrentFrame--;
        else if (from > _animCurrentFrame && to <= _animCurrentFrame) _animCurrentFrame++;
        refreshAnimFrames();
      });

      list.appendChild(item);
    });
  }

  // 动图画布事件
  function onAnimMouseDown(e) {
    var canvas = document.getElementById('anim-canvas');
    var pos = getCanvasPos(canvas, e);

    if (_animTool === 'fill') {
      imgFill(canvas, Math.round(pos.x), Math.round(pos.y), hexToRgba(_animColor));
      saveCurrentFrameToStore();
      animPushHistory();
      return;
    }
    _animDrawing = true;
    _animLastX = pos.x;
    _animLastY = pos.y;
  }

  function onAnimMouseMove(e) {
    if (!_animDrawing) return;
    var canvas = document.getElementById('anim-canvas');
    var ctx = canvas.getContext('2d');
    var pos = getCanvasPos(canvas, e);

    ctx.beginPath();
    ctx.moveTo(_animLastX, _animLastY);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = _animTool === 'eraser' ? '#ffffff' : _animColor;
    ctx.lineWidth = _animSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    _animLastX = pos.x;
    _animLastY = pos.y;
  }

  function onAnimMouseUp() {
    if (!_animDrawing) return;
    _animDrawing = false;
    saveCurrentFrameToStore();
    animPushHistory();
  }

  // 动图历史记录
  function animPushHistory() {
    var canvas = document.getElementById('anim-canvas');
    var data = canvas.toDataURL();
    _animHistory = _animHistory.slice(0, _animHistoryIdx + 1);
    _animHistory.push(data);
    if (_animHistory.length > 30) _animHistory.shift();
    _animHistoryIdx = _animHistory.length - 1;
  }

  function animFrameUndo() {
    if (_animHistoryIdx <= 0) return;
    _animHistoryIdx--;
    animRestoreFromHistory();
  }

  function animFrameRedo() {
    if (_animHistoryIdx >= _animHistory.length - 1) return;
    _animHistoryIdx++;
    animRestoreFromHistory();
  }

  function animRestoreFromHistory() {
    var canvas = document.getElementById('anim-canvas');
    var ctx = canvas.getContext('2d');
    var img = new Image();
    img.onload = function () {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      saveCurrentFrameToStore();
    };
    img.src = _animHistory[_animHistoryIdx];
  }

  function animFrameClear() {
    var canvas = document.getElementById('anim-canvas');
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    saveCurrentFrameToStore();
    animPushHistory();
  }

  // 播放控制
  function startAnimPlayback() {
    if (_animFrames.length < 2) { setStatus('至少需要 2 帧才能播放'); return; }
    stopAnimPlayback();
    saveCurrentFrameToStore();
    _animPlaying = true;
    _animPlayIdx = 0;
    document.getElementById('anim-play-overlay').style.display = 'none';
    var fps = parseInt(document.getElementById('anim-fps').value) || 10;
    var duration = parseInt(document.getElementById('anim-frame-duration').value) || 100;
    var loop = document.getElementById('anim-loop').checked;
    var canvas = document.getElementById('anim-canvas');
    var ctx = canvas.getContext('2d');

    function playNext() {
      if (!_animPlaying) return;
      var frame = _animFrames[_animPlayIdx];
      canvas.width = frame.canvas.width;
      canvas.height = frame.canvas.height;
      ctx.drawImage(frame.canvas, 0, 0);
      _animPlayIdx++;
      if (_animPlayIdx >= _animFrames.length) {
        if (loop) { _animPlayIdx = 0; }
        else { _animPlaying = false; document.getElementById('anim-play-overlay').style.display = ''; return; }
      }
      _animPlayTimer = setTimeout(playNext, duration);
    }
    playNext();
  }

  function stopAnimPlayback() {
    _animPlaying = false;
    if (_animPlayTimer) { clearTimeout(_animPlayTimer); _animPlayTimer = null; }
    document.getElementById('anim-play-overlay').style.display = '';
    // 恢复到当前编辑帧
    if (_animCurrentFrame >= 0 && _animCurrentFrame < _animFrames.length) {
      loadFrameToCanvas(_animCurrentFrame);
    }
  }

  // ========== 保存与导出 ==========
  async function saveCurrent() {
    if (_currentView === 'image') {
      await saveImage();
    } else if (_currentView === 'anim') {
      await saveAnimation();
    }
  }

  async function saveImage() {
    var canvas = document.getElementById('img-canvas');
    var dataUrl = canvas.toDataURL('image/png');
    var assetId = canvas.dataset.assetId;

    // 保存到磁盘
    var defaultName = 'image_' + Date.now() + '.png';
    var savePath = await window.api?.saveFileDialog(defaultName, [{ name: 'PNG 图片', extensions: ['png'] }, { name: 'JPEG 图片', extensions: ['jpg', 'jpeg'] }]);
    if (!savePath) return;

    try {
      var base64 = dataUrl.split(',')[1];
      await window.api?.writeFileBinary(savePath, base64);

      // 保存到素材库
      var name = savePath.split(/[\\/]/).pop();
      if (assetId) {
        var asset = _assetStore.find(function (a) { return a.id === assetId; });
        if (asset) {
          asset.dataUrl = dataUrl;
          asset.name = name;
          asset.width = canvas.width;
          asset.height = canvas.height;
        }
      } else {
        var newAsset = { id: generateId(), name: name, type: 'image', dataUrl: dataUrl, width: canvas.width, height: canvas.height, createdAt: Date.now() };
        _assetStore.push(newAsset);
        canvas.dataset.assetId = newAsset.id;
      }
      saveAssetStore();
      setStatus('已保存: ' + name);
    } catch (e) {
      setStatus('保存失败: ' + e.message);
    }
  }

  async function saveAnimation() {
    saveCurrentFrameToStore();
    var frames = _animFrames.map(function (f) { return f.dataUrl || f.canvas.toDataURL(); });
    var canvas = document.getElementById('anim-canvas');
    var assetId = canvas.dataset.assetId;

    // 保存每一帧为单独 PNG
    var savePath = await window.api?.saveFileDialog('anim_' + Date.now() + '.png', [{ name: 'PNG 图片', extensions: ['png'] }]);
    if (!savePath) return;

    try {
      // 保存所有帧
      var dir = savePath.replace(/[\\/][^\\/]+$/, '');
      var baseName = savePath.split(/[\\/]/).pop().replace(/\.png$/, '');
      for (var i = 0; i < frames.length; i++) {
        var framePath = dir + '/' + baseName + '_frame' + (i + 1) + '.png';
        var base64 = frames[i].split(',')[1];
        await window.api?.writeFileBinary(framePath, base64);
      }

      // 保存到素材库
      if (assetId) {
        var asset = _assetStore.find(function (a) { return a.id === assetId; });
        if (asset) {
          asset.frames = frames;
          asset.width = canvas.width;
          asset.height = canvas.height;
        }
      } else {
        var newAsset = { id: generateId(), name: baseName, type: 'anim', frames: frames, width: canvas.width, height: canvas.height, createdAt: Date.now() };
        _assetStore.push(newAsset);
        canvas.dataset.assetId = newAsset.id;
      }
      saveAssetStore();
      setStatus('已保存 ' + frames.length + ' 帧到 ' + dir);
    } catch (e) {
      setStatus('保存失败: ' + e.message);
    }
  }

  function exportToProject() {
    saveCurrentFrameToStore();
    // 弹出项目选择对话框
    var overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    var box = document.createElement('div');
    box.className = 'dialog-box';

    var recentProjects = [];
    try { recentProjects = JSON.parse(localStorage.getItem('recent-projects') || '[]'); } catch (e) {}

    var html = '<h2>导出到项目</h2>';
    html += '<div style="margin-bottom:12px;font-size:12px;color:var(--text2);">选择目标项目，素材将复制到项目的 assets/ 目录</div>';

    recentProjects.forEach(function (proj, idx) {
      var name = proj.name || proj.path.split(/[\\/]/).pop();
      html += '<div class="project-item" data-path="' + escapeHtml(proj.path) + '">' +
        '<div class="proj-name">' + escapeHtml(name) + '</div>' +
        '<div class="proj-path">' + escapeHtml(proj.path) + '</div></div>';
    });

    html += '<div class="btn-row">' +
      '<button class="tb-btn" id="export-select-dir">📂 选择目录</button>' +
      '<button class="tb-btn" id="export-cancel">取消</button></div>';

    box.innerHTML = html;
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    // 事件
    overlay.querySelectorAll('.project-item').forEach(function (item) {
      item.addEventListener('click', function () {
        var targetPath = item.dataset.path;
        doExportToDir(targetPath + '/assets');
        document.body.removeChild(overlay);
      });
    });

    box.querySelector('#export-select-dir').addEventListener('click', async function () {
      var dir = await window.api?.selectFolder();
      if (dir) {
        doExportToDir(dir + '/assets');
      }
      document.body.removeChild(overlay);
    });

    box.querySelector('#export-cancel').addEventListener('click', function () {
      document.body.removeChild(overlay);
    });

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) document.body.removeChild(overlay);
    });
  }

  async function doExportToDir(targetDir) {
    try {
      await window.api?.ensureDir(targetDir);

      if (_currentView === 'image') {
        var canvas = document.getElementById('img-canvas');
        var dataUrl = canvas.toDataURL('image/png');
        var base64 = dataUrl.split(',')[1];
        var fileName = 'export_' + Date.now() + '.png';
        await window.api?.writeFileBinary(targetDir + '/' + fileName, base64);
        setStatus('已导出到 ' + targetDir + '/' + fileName);
      } else if (_currentView === 'anim') {
        saveCurrentFrameToStore();
        for (var i = 0; i < _animFrames.length; i++) {
          var frameData = _animFrames[i].dataUrl || _animFrames[i].canvas.toDataURL();
          var base64 = frameData.split(',')[1];
          var frameName = 'export_' + Date.now() + '_frame' + (i + 1) + '.png';
          await window.api?.writeFileBinary(targetDir + '/' + frameName, base64);
        }
        setStatus('已导出 ' + _animFrames.length + ' 帧到 ' + targetDir);
      }
    } catch (e) {
      setStatus('导出失败: ' + e.message);
    }
  }
})();
