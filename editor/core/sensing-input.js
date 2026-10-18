/**
 * 侦测输入追踪器 - 追踪鼠标/键盘状态
 * 支持本地画布输入和远程面板输入（IPC）
 */
const SensingInput = (function () {
  let _mouseX = 0;
  let _mouseY = 0;
  let _mouseDown = false;
  let _keysDown = {};  // key -> true
  let _timerStart = Date.now();
  let _spriteClickCallbacks = [];  // 精灵点击回调列表

  function init(canvasEl) {
    // 鼠标移动
    canvasEl.addEventListener('mousemove', (e) => {
      const rect = canvasEl.getBoundingClientRect();
      // 转换为舞台坐标（中心为 0,0）
      _mouseX = e.clientX - rect.left - rect.width / 2;
      _mouseY = -(e.clientY - rect.top - rect.height / 2);  // y 轴翻转
    });

    // 鼠标按下/释放
    canvasEl.addEventListener('mousedown', () => { _mouseDown = true; });
    canvasEl.addEventListener('mouseup', () => { _mouseDown = false; });

    // 键盘
    document.addEventListener('keydown', (e) => {
      const mapped = mapKey(e.key);
      _keysDown[mapped] = true;
    });

    document.addEventListener('keyup', (e) => {
      const mapped = mapKey(e.key);
      _keysDown[mapped] = false;
    });
  }

  // 直接设置状态（用于面板模式）
  function _setMouse(x, y) {
    _mouseX = x;
    _mouseY = y;
  }

  function _setMouseDown(down) {
    _mouseDown = down;
  }

  function _setKey(key, down) {
    _keysDown[key] = down;
  }

  /**
   * 从舞台面板 IPC 初始化输入监听
   */
  function initFromPanel() {
    if (!window.api || !window.api.onPanelInput) return;
    window.api.onPanelInput((type, data) => {
      if (type === 'mouse-move') {
        _mouseX = data.x;
        _mouseY = data.y;
      } else if (type === 'mouse-down') {
        _mouseDown = true;
      } else if (type === 'mouse-up') {
        _mouseDown = false;
      } else if (type === 'key-down') {
        _keysDown[data.key] = true;
      } else if (type === 'key-up') {
        _keysDown[data.key] = false;
      } else if (type === 'sprite-click') {
        _spriteClickCallbacks.forEach(cb => cb(data.index));
      }
    });
  }

  function mapKey(key) {
    const map = {
      ' ': 'space',
      'ArrowUp': 'up', 'ArrowDown': 'down', 'ArrowLeft': 'left', 'ArrowRight': 'right',
      'Enter': 'enter', 'Shift': 'shift', 'Control': 'control', 'Alt': 'alt',
      'Escape': 'escape', 'Tab': 'tab', 'Backspace': 'backspace',
    };
    return map[key] || key.toLowerCase();
  }

  function getMouseX() { return _mouseX; }
  function getMouseY() { return _mouseY; }
  function isMouseDown() { return _mouseDown; }
  function isKeyPressed(key) {
    const k = String(key).toLowerCase().trim();
    return !!_keysDown[k];
  }

  function getTimer() {
    return (Date.now() - _timerStart) / 1000;  // 秒
  }

  function resetTimer() {
    _timerStart = Date.now();
  }

  /**
   * 注册精灵点击回调
   */
  function onSpriteClick(callback) {
    _spriteClickCallbacks.push(callback);
  }

  return {
    init, initFromPanel, getMouseX, getMouseY, isMouseDown, isKeyPressed,
    getTimer, resetTimer, onSpriteClick, _mapKey: mapKey,
    // 面板模式直接设置状态
    _setMouse, _setMouseDown, _setKey,
  };
})();
