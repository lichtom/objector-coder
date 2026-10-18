/**
 * Panel Window Script - 独立面板窗口（舞台+输出合并）
 * 支持 2D / 3D 双渲染模式
 */
(function () {
  const W = 480, H = 360;

  // ==================== 窗口控制按钮 ====================
  let _isPinned = false;
  document.getElementById('btn-pin').addEventListener('click', () => {
    _isPinned = !_isPinned;
    const btn = document.getElementById('btn-pin');
    btn.classList.toggle('pinned', _isPinned);
    btn.title = _isPinned ? '取消置顶' : '置顶';
    window.api.panelSetAlwaysOnTop(_isPinned);
  });
  document.getElementById('btn-minimize').addEventListener('click', () => {
    window.api.panelMinimize();
  });
  document.getElementById('btn-maximize').addEventListener('click', () => {
    window.api.panelMaximize();
  });
  document.getElementById('btn-close').addEventListener('click', () => {
    window.api.panelClose();
  });

  // ==================== 分割条拖拽 ====================
  const divider = document.getElementById('panel-divider');
  const stageArea = document.getElementById('stage-area');
  const outputArea = document.getElementById('output-area');
  let _dragging = false;

  divider.addEventListener('mousedown', (e) => {
    _dragging = true;
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!_dragging) return;
    const bodyRect = document.body.getBoundingClientRect();
    const titlebarH = 28;
    const divH = 4;
    const totalH = bodyRect.height - titlebarH - divH;
    const stageH = Math.max(100, Math.min(totalH - 60, e.clientY - titlebarH));
    stageArea.style.flex = 'none';
    stageArea.style.height = stageH + 'px';
    outputArea.style.flex = '1';
    _resizeStageCanvas();
  });
  document.addEventListener('mouseup', () => { _dragging = false; });

  // ==================== 渲染状态 ====================
  let _sprites = [];
  let _dirty = true;
  let _renderMode = '2d'; // '2d' or '3d'

  // ==================== 2D 渲染器 ====================
  let _canvas2d = document.getElementById('stage-canvas');
  let _ctx = _canvas2d.getContext('2d');
  _canvas2d.width = W;
  _canvas2d.height = H;
  let _imgCache = {};
  let _bgImg = null;

  function renderStage2D() {
    _ctx.clearRect(0, 0, W, H);
    if (_bgImg && _bgImg.complete) {
      const imgW = _bgImg.naturalWidth || _bgImg.width;
      const imgH = _bgImg.naturalHeight || _bgImg.height;
      const scale = Math.min(W / imgW, H / imgH);
      const dw = imgW * scale, dh = imgH * scale;
      _ctx.drawImage(_bgImg, (W - dw) / 2, (H - dh) / 2, dw, dh);
    } else {
      _ctx.fillStyle = '#ffffff';
      _ctx.fillRect(0, 0, W, H);
    }
    _sprites.forEach(s => {
      if (s.isStage) return;
      if (!s.visible) return;
      _ctx.save();
      const cx = W / 2 + (s.x || 0);
      const cy = H / 2 - (s.y || 0);
      _ctx.translate(cx, cy);
      if (s.rotationStyle === 'allAround') {
        _ctx.rotate(((s.direction || 90) - 90) * Math.PI / 180);
      } else if (s.rotationStyle === 'leftRight') {
        if ((s.direction || 90) > 180) _ctx.scale(-1, 1);
      }
      const sc = (s.size || 100) / 100;
      _ctx.scale(sc, sc);
      if (s.costumeDataUrl) {
        let img = _imgCache[s.costumeDataUrl];
        if (!img) {
          img = new Image();
          img.src = s.costumeDataUrl;
          _imgCache[s.costumeDataUrl] = img;
          img.onload = () => { _dirty = true; };
        } else if (img.complete) {
          const maxDim = 64;
          let dw = img.width, dh = img.height;
          if (dw > maxDim || dh > maxDim) {
            const ratio = Math.min(maxDim / dw, maxDim / dh);
            dw *= ratio; dh *= ratio;
          }
          _ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
        }
      } else {
        _ctx.beginPath();
        _ctx.moveTo(0, -18); _ctx.lineTo(14, 14); _ctx.lineTo(-14, 14); _ctx.closePath();
        _ctx.fillStyle = s.color || '#4ec9b0'; _ctx.fill();
        _ctx.strokeStyle = '#fff'; _ctx.lineWidth = 1.5; _ctx.stroke();
        _ctx.fillStyle = '#fff';
        _ctx.beginPath(); _ctx.arc(-4, -4, 3, 0, Math.PI * 2); _ctx.arc(4, -4, 3, 0, Math.PI * 2); _ctx.fill();
        _ctx.fillStyle = '#333';
        _ctx.beginPath(); _ctx.arc(-3, -4, 1.5, 0, Math.PI * 2); _ctx.arc(5, -4, 1.5, 0, Math.PI * 2); _ctx.fill();
      }
      _ctx.restore();
      if (s.sayText) {
        _ctx.save();
        _ctx.font = '12px "Microsoft YaHei",sans-serif';
        const tw = _ctx.measureText(s.sayText).width;
        const bx = cx + 20, by = cy - 30;
        _ctx.fillStyle = '#fff'; _ctx.strokeStyle = '#999'; _ctx.lineWidth = 1;
        rrect(_ctx, bx, by, tw + 16, 24, 8); _ctx.fill(); _ctx.stroke();
        _ctx.fillStyle = '#333';
        _ctx.fillText(s.sayText, bx + 8, by + 16);
        _ctx.restore();
      }
    });
  }

  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r); ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r); ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r); ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r); ctx.closePath();
  }

  // ==================== 3D 渲染器 ====================
  let _scene3d = null, _camera3d = null, _renderer3d = null;
  let _spriteMeshes3d = new Map();  // sprite name -> THREE.Mesh
  let _spriteTextures3d = new Map(); // sprite name -> costume URL
  let _groundMesh3d = null, _gridHelper3d = null;
  let _initialized3d = false;
  const SCENE_SIZE = 50;

  function _initRenderer3D() {
    if (typeof THREE === 'undefined') {
      console.error('[Panel3D] Three.js 未加载');
      return false;
    }
    // 替换 canvas（2D context 不能转为 WebGL）
    const oldCanvas = document.getElementById('stage-canvas');
    if (!oldCanvas) return false;
    const newCanvas = document.createElement('canvas');
    newCanvas.id = 'stage-canvas';
    newCanvas.width = W;
    newCanvas.height = H;
    newCanvas.style.cssText = oldCanvas.style.cssText;
    newCanvas.className = oldCanvas.className;
    oldCanvas.parentNode.replaceChild(newCanvas, oldCanvas);

    try {
      _scene3d = new THREE.Scene();
      _scene3d.background = new THREE.Color(0x87ceeb);

      _camera3d = new THREE.PerspectiveCamera(60, W / H, 0.1, 1000);
      _camera3d.position.set(0, 25, 35);
      _camera3d.lookAt(0, 0, 0);

      _renderer3d = new THREE.WebGLRenderer({ canvas: newCanvas, antialias: true });
      _renderer3d.setSize(W, H, false);
      _renderer3d.shadowMap.enabled = true;
      _renderer3d.shadowMap.type = THREE.PCFSoftShadowMap;

      // 光照
      _scene3d.add(new THREE.AmbientLight(0xffffff, 0.7));
      const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
      dirLight.position.set(10, 20, 10);
      dirLight.castShadow = true;
      dirLight.shadow.mapSize.set(1024, 1024);
      _scene3d.add(dirLight);

      // 地面
      const gGeo = new THREE.PlaneGeometry(SCENE_SIZE * 2, SCENE_SIZE * 2);
      const gMat = new THREE.MeshStandardMaterial({ color: 0x88cc88, roughness: 0.8 });
      _groundMesh3d = new THREE.Mesh(gGeo, gMat);
      _groundMesh3d.rotation.x = -Math.PI / 2;
      _groundMesh3d.receiveShadow = true;
      _scene3d.add(_groundMesh3d);

      _gridHelper3d = new THREE.GridHelper(SCENE_SIZE * 2, 20, 0x444444, 0x666666);
      _gridHelper3d.position.y = 0.01;
      _gridHelper3d.material.opacity = 0.25;
      _gridHelper3d.material.transparent = true;
      _scene3d.add(_gridHelper3d);

      _initialized3d = true;
      console.log('[Panel3D] 3D 渲染器初始化成功');
      return true;
    } catch (e) {
      console.error('[Panel3D] 初始化失败:', e.message);
      return false;
    }
  }

  function _disposeRenderer3D() {
    if (!_initialized3d) return;
    _initialized3d = false;
    _spriteMeshes3d.forEach(mesh => {
      _scene3d.remove(mesh);
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) {
        if (mesh.material.map) mesh.material.map.dispose();
        mesh.material.dispose();
      }
    });
    _spriteMeshes3d.clear();
    _spriteTextures3d.clear();
    if (_renderer3d) _renderer3d.dispose();
    _renderer3d = null;
    _scene3d = null;
    _camera3d = null;
  }

  function _2DTo3D(x, y) {
    const scale = SCENE_SIZE / 240;
    return { x: x * scale, y: 1, z: -y * scale };
  }

  function _getOrCreateSpriteMesh3D(sprite) {
    const key = sprite.name || ('sprite_' + sprite.index);
    let mesh = _spriteMeshes3d.get(key);
    const costumeUrl = sprite.costumeDataUrl || '';
    const lastCostume = _spriteTextures3d.get(key);

    // 造型变化时重建
    if (mesh && costumeUrl !== lastCostume) {
      if (mesh.material.map) mesh.material.map.dispose();
      mesh.material.dispose();
      _scene3d.remove(mesh);
      mesh = null;
    }

    if (!mesh) {
      let material;
      let geometry;
      if (costumeUrl) {
        // 加载贴图
        const loader = new THREE.TextureLoader();
        const texture = loader.load(costumeUrl, () => { _dirty = true; });
        texture.colorSpace = THREE.SRGBColorSpace;
        geometry = new THREE.PlaneGeometry(4, 4);
        material = new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          side: THREE.DoubleSide
        });
      } else {
        // 默认彩色方块
        material = new THREE.MeshBasicMaterial({
          color: new THREE.Color(sprite.color || '#4a90d9'),
          side: THREE.DoubleSide
        });
        geometry = new THREE.PlaneGeometry(4, 4);
      }
      mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      _scene3d.add(mesh);
      _spriteMeshes3d.set(key, mesh);
      _spriteTextures3d.set(key, costumeUrl);
    }
    return mesh;
  }

  function _updateSpriteMesh3D(sprite, mesh) {
    const pos = _2DTo3D(sprite.x || 0, sprite.y || 0);
    mesh.position.set(pos.x, pos.y + (sprite._height3d || 0), pos.z);
    const s = (sprite.size || 100) / 100;
    mesh.scale.set(s, s, s);
    if (sprite.rotationStyle === 'allAround') {
      mesh.rotation.y = (90 - (sprite.direction || 90)) * Math.PI / 180;
    } else if (sprite.rotationStyle === 'leftRight') {
      mesh.rotation.y = (sprite.direction || 90) > 180 ? Math.PI : 0;
    }
    mesh.visible = sprite.visible !== false;
  }

  function renderStage3D() {
    if (!_initialized3d || !_renderer3d) return;

    const currentKeys = new Set();
    _sprites.forEach((sprite, idx) => {
      if (sprite.isStage) return;
      const key = sprite.name || ('sprite_' + idx);
      currentKeys.add(key);
      sprite.index = idx;
      const mesh = _getOrCreateSpriteMesh3D(sprite);
      _updateSpriteMesh3D(sprite, mesh);
    });

    // 清理已删除的精灵
    _spriteMeshes3d.forEach((mesh, key) => {
      if (!currentKeys.has(key)) {
        _scene3d.remove(mesh);
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) {
          if (mesh.material.map) mesh.material.map.dispose();
          mesh.material.dispose();
        }
        _spriteMeshes3d.delete(key);
        _spriteTextures3d.delete(key);
      }
    });

    _renderer3d.render(_scene3d, _camera3d);
  }

  // ==================== 舞台自适应窗口大小 ====================
  function _resizeStageCanvas() {
    const stageArea = document.getElementById('stage-area');
    if (!stageArea) return;
    const cv = document.getElementById('stage-canvas');
    if (!cv) return;
    const aw = stageArea.clientWidth - 8;
    const ah = stageArea.clientHeight - 8;
    if (aw <= 0 || ah <= 0) return;
    const aspect = W / H;
    let cw, ch;
    if (aw / ah > aspect) {
      ch = ah; cw = Math.floor(ch * aspect);
    } else {
      cw = aw; ch = Math.floor(cw / aspect);
    }
    cv.width = W;
    cv.height = H;
    cv.style.width = cw + 'px';
    cv.style.height = ch + 'px';
    // 3D 渲染器需要更新视口
    if (_renderer3d) {
      _renderer3d.setSize(W, H, false);
      if (_camera3d) _camera3d.aspect = W / H;
      if (_camera3d) _camera3d.updateProjectionMatrix();
    }
    _dirty = true;
  }
  window.addEventListener('resize', _resizeStageCanvas);
  setTimeout(_resizeStageCanvas, 100);

  // ==================== 模式切换 ====================
  function switchToMode(mode) {
    if (mode === _renderMode) return;
    console.log('[Panel] 切换渲染模式:', _renderMode, '->', mode);
    _renderMode = mode;
    if (mode === '3d') {
      if (!_initialized3d) _initRenderer3D();
    } else {
      _disposeRenderer3D();
      // 恢复 2D canvas
      const canvas = document.getElementById('stage-canvas');
      if (canvas) {
        _canvas2d = canvas;
        _ctx = canvas.getContext('2d');
        if (!_ctx) {
          // canvas 被 3D 占用了，需要重建
          const newCanvas = document.createElement('canvas');
          newCanvas.id = 'stage-canvas';
          newCanvas.width = W;
          newCanvas.height = H;
          newCanvas.style.cssText = canvas.style.cssText;
          canvas.parentNode.replaceChild(newCanvas, canvas);
          _canvas2d = newCanvas;
          _ctx = newCanvas.getContext('2d');
        }
      }
    }
    _dirty = true;
  }

  // ==================== 渲染循环 ====================
  function renderLoop() {
    if (_dirty) {
      _dirty = false;
      if (_renderMode === '3d' && _initialized3d) {
        renderStage3D();
      } else {
        renderStage2D();
      }
    }
    // 3D 模式下持续渲染（动画需要）
    if (_renderMode === '3d' && _initialized3d) {
      renderStage3D();
    }
    requestAnimationFrame(renderLoop);
  }
  requestAnimationFrame(renderLoop);

  // ==================== 输出面板 ====================
  const logEl = document.getElementById('output-log');
  document.getElementById('btn-clear-output').addEventListener('click', () => {
    logEl.textContent = '';
  });

  // ==================== IPC 接收 ====================
  let _renderModeReceived = false; // 跟踪是否已收到 render-mode
  window.api.onPanelUpdate((data) => {
    if (data.type === 'stage' || data.type === 'sprites') {
      _sprites = data.sprites || [];
      // 如果还没收到 render-mode，主动请求（面板窗口重建后的安全保障）
      if (!_renderModeReceived && window.api && window.api.panelAction) {
        _renderModeReceived = true; // 标记已请求，避免重复
        window.api.panelAction('request-render-mode');
      }
      // 提取舞台精灵的贴图作为背景（仅 2D 模式用）
      const stageSprite = _sprites.find(s => s.isStage);
      if (stageSprite && stageSprite.costumeDataUrl) {
        if (!_bgImg || _bgImg.src !== stageSprite.costumeDataUrl) {
          const img = new Image();
          img.onload = () => { _dirty = true; };
          img.src = stageSprite.costumeDataUrl;
          _bgImg = img;
        }
      } else {
        if (_bgImg) {
          _bgImg = null;
          _dirty = true;
        }
      }
      _dirty = true;
    } else if (data.type === 'output') {
      if (data.action === 'append') {
        logEl.textContent += data.text;
        logEl.scrollTop = logEl.scrollHeight;
      } else if (data.action === 'clear') {
        logEl.textContent = '';
      } else if (data.action === 'set') {
        logEl.textContent = data.text || '';
        logEl.scrollTop = logEl.scrollHeight;
      }
    } else if (data.type === 'title') {
      document.getElementById('pname').textContent = data.name || '未命名项目';
    } else if (data.type === 'render-mode') {
      // 切换渲染模式
      _renderModeReceived = true;
      switchToMode(data.renderMode || '2d');
    }
  });

  // ==================== 输入捕获 ====================
  function _getCanvas() {
    return document.getElementById('stage-canvas');
  }

  document.addEventListener('mousemove', (e) => {
    const canvas = _getCanvas();
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left) / rect.width * W - W / 2);
    const y = Math.round(-((e.clientY - rect.top) / rect.height * H - H / 2));
    window.api.panelInput('mouse-move', { x, y });
  });
  document.addEventListener('mousedown', (e) => {
    const canvas = _getCanvas();
    if (!canvas || !canvas.contains(e.target)) return;
    window.api.panelInput('mouse-down', {});
  });
  document.addEventListener('mouseup', (e) => {
    const canvas = _getCanvas();
    if (!canvas || !canvas.contains(e.target)) return;
    window.api.panelInput('mouse-up', {});
  });
  document.addEventListener('click', (e) => {
    const canvas = _getCanvas();
    if (!canvas || !canvas.contains(e.target)) return;
    const rect = canvas.getBoundingClientRect();
    const wx = Math.round((e.clientX - rect.left) / rect.width * W - W / 2);
    const wy = Math.round(-((e.clientY - rect.top) / rect.height * H - H / 2));
    for (let i = _sprites.length - 1; i >= 0; i--) {
      const s = _sprites[i];
      if (!s.visible || s.isStage) continue;
      const dx = wx - (s.x || 0), dy = wy - (s.y || 0);
      const hitRadius = 30 * ((s.size || 100) / 100);
      if (dx * dx + dy * dy <= hitRadius * hitRadius) {
        window.api.panelInput('sprite-click', { index: i });
        break;
      }
    }
  });
  const keyMap = { ' ': 'space', 'ArrowUp': 'up', 'ArrowDown': 'down', 'ArrowLeft': 'left', 'ArrowRight': 'right', 'Enter': 'enter', 'Shift': 'shift', 'Control': 'control', 'Alt': 'alt' };
  document.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const keyName = keyMap[e.key] || e.key.toLowerCase();
    window.api.panelInput('key-down', { key: keyName, raw: e.key });
  });
  document.addEventListener('keyup', (e) => {
    const keyName = keyMap[e.key] || e.key.toLowerCase();
    window.api.panelInput('key-up', { key: keyName, raw: e.key });
  });
})();
