/**
 * MicrobitBridge - micro:bit 串口通信模块
 * 实时模式: 通过 Electron IPC 调用主进程 serialport 与 micro:bit 通信
 * 上传模式: 提供 hex 编译和烧录接口
 */
const MicrobitBridge = (function () {
  let _connected = false;
  let _port = '';
  let _mode = 'realtime'; // 'realtime' | 'upload'
  let _simulatorMode = false; // 未连接真实设备时自动启用模拟器

  // ===== 连接管理 =====

  async function listPorts() {
    try {
      return await window.api.microbitListPorts();
    } catch (e) {
      console.warn('[MicrobitBridge] listPorts error:', e);
      return [];
    }
  }

  async function connect(portPath, mode) {
    _mode = mode || 'realtime';
    try {
      const result = await window.api.microbitConnect(portPath);
      if (result && result.ok) {
        _connected = true;
        _port = portPath;
        _simulatorMode = false;
        console.log('[MicrobitBridge] Connected to', portPath);
        return { ok: true };
      }
      return { ok: false, error: result ? result.error : 'Unknown error' };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  /** 启用模拟器 (无需真实设备) */
  function enableSimulator() {
    _simulatorMode = true;
    _connected = false;
    _port = 'simulator';
    console.log('[MicrobitBridge] Simulator enabled');
    return { ok: true };
  }

  function disableSimulator() {
    _simulatorMode = false;
    if (_port === 'simulator') _port = '';
  }

  function isUsingSimulator() { return _simulatorMode && !_connected; }

  function disconnect() {
    if (_connected) {
      window.api.microbitDisconnect();
      _connected = false;
      _port = '';
      console.log('[MicrobitBridge] Disconnected');
    }
    if (_simulatorMode) {
      _simulatorMode = false;
      _port = '';
      console.log('[MicrobitBridge] Simulator disabled');
    }
  }

  function isConnected() { return _connected || _simulatorMode; }
  function getMode() { return _mode; }

  // ===== 实时模式: 发送命令并等待响应 =====

  async function send(cmd) {
    // 优先走真实设备
    if (_connected) {
      try {
        const result = await window.api.microbitSend(cmd);
        if (result && result.ok) return result;
        return { ok: false, error: result ? result.error : 'Send failed' };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    }
    // 否则走模拟器
    if (_simulatorMode && typeof MicrobitSimulator !== 'undefined' && MicrobitSimulator.isReady()) {
      try {
        return MicrobitSimulator.handle(cmd);
      } catch (e) {
        return { ok: false, error: 'Simulator error: ' + e.message };
      }
    }
    console.warn('[MicrobitBridge] Not connected');
    return { ok: false, error: 'Not connected' };
  }

  /** 发送命令并解析响应数据 */
  async function query(cmd) {
    const result = await send(cmd);
    if (!result.ok) return null;
    const resp = result.response || '';
    if (resp.startsWith('OK:')) return resp.slice(3);
    if (resp.startsWith('OK')) return true;
    if (resp.startsWith('ERR:') || resp.startsWith('ER:')) {
      console.warn('[MicrobitBridge] Device error:', resp);
      return null;
    }
    return resp;
  }

  // ===== 高级 API (映射到固件协议) =====

  async function ledOn() { return await send('L1'); }
  async function ledOff() { return await send('L0'); }
  async function ledPattern(pat) { return await send('LI' + pat); }
  async function ledPixel(x, y, b) { return await send('PX' + x + ',' + y + ',' + b); }
  async function text(str) { return await send('T:' + str); }
  async function show(str) { return await send('S:' + str); }
  async function buzz(freq, dur) { return await send('BZ' + freq + ':' + (dur || 0)); }
  async function buzzOff() { return await send('BZ'); }
  async function servo(pin, angle) { return await send('SV' + pin + ',' + angle); }
  async function servoOff(pin) { return await send('SO' + pin); }
  async function motor(which, speed) { return await send('M:' + which + ',' + speed); }
  async function motorBrake() { return await send('MB'); }
  async function rgbInit(pin, count) { return await send('NI' + pin + ',' + count); }
  async function rgb(r, g, b) { return await send('C:' + r + ',' + g + ',' + b); }
  async function rgbOne(idx, r, g, b) { return await send('C:' + idx + ',' + r + ',' + g + ',' + b); }
  async function rgbOff() { return await send('C:0'); }
  async function pinWrite(pin, val, mode) { return await send('W:' + pin + ',' + val + (mode === 'pwm' ? ',pwm' : '')); }
  async function pinRead(pin) { return await query('Q:' + pin); }
  async function getTemp() { return await query('TE'); }
  async function getLight() { return await query('LT'); }
  async function getAcc() { return await query('AC'); }
  async function getButton() { return await query('BT'); }
  async function getGesture() { return await query('GE'); }
  async function getSound() { return await query('SN'); }
  async function getAll() { return await query('AL'); }

  // ===== 上传模式: 编译和烧录 =====

  /** 将积木树翻译为 MicroPython 代码 */
  function compileToPython(blocks) {
    if (typeof MicrobitCompiler !== 'undefined') {
      return MicrobitCompiler.compile(blocks);
    }
    return '# MicrobitCompiler not loaded\n';
  }

  /** 烧录 hex 到 micro:bit (通过 IPC) */
  async function flashHex(hexPath) {
    try {
      return await window.api.microbitFlash(hexPath);
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  /** 烧录实时模式固件 main.hex 到 micro:bit */
  async function flashMainHex() {
    try {
      return await window.api.microbitFlashMain();
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  /** 编译 Python 代码并烧录到 micro:bit (预编译固件 + makecombinedhex.py + 拖拽) */
  async function compileAndFlash(pyCode) {
    try {
      if (window.api && window.api.microbitCompileFlash) {
        return await window.api.microbitCompileFlash(pyCode);
      }
      return { ok: false, error: 'microbitCompileFlash API 不可用' };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  // ===== 串口连接对话框 =====

  function showConnectDialog(onConnected) {
    // 创建对话框
    let overlay = document.getElementById('microbit-connect-dialog');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'microbit-connect-dialog';
      overlay.className = 'custom-prompt-overlay';
      overlay.innerHTML = `
        <div class="custom-prompt-box" style="max-width:400px;">
          <div class="custom-prompt-title">🔌 连接 micro:bit</div>
          <div style="margin-bottom:12px;">
            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px;">串口 (COM)</label>
            <select id="mb-port-select" class="settings-input" style="width:100%;padding:8px;font-size:13px;">
              <option value="">扫描中...</option>
            </select>
          </div>
          <div id="mb-connect-status" style="font-size:12px;color:var(--text-muted);margin-bottom:12px;min-height:18px;"></div>
          <div style="display:flex;gap:8px;justify-content:flex-end;">
            <button id="mb-refresh-btn" class="tb-btn">🔄 刷新</button>
            <button id="mb-connect-cancel" class="tb-btn">取消</button>
            <button id="mb-connect-ok" class="tb-btn tb-run">连接</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      // 事件绑定
      document.getElementById('mb-connect-cancel').addEventListener('click', () => {
        overlay.classList.add('hidden');
      });
      document.getElementById('mb-refresh-btn').addEventListener('click', () => {
        _refreshPorts();
      });
      document.getElementById('mb-connect-ok').addEventListener('click', async () => {
        const port = document.getElementById('mb-port-select').value;
        const status = document.getElementById('mb-connect-status');
        if (!port) {
          status.textContent = '请选择串口';
          status.style.color = '#e74c3c';
          return;
        }
        status.textContent = '正在连接...';
        status.style.color = 'var(--accent2)';
        const result = await connect(port, 'realtime');
        if (result.ok) {
          status.textContent = '已连接: ' + port;
          status.style.color = 'var(--green)';
          setTimeout(() => {
            overlay.classList.add('hidden');
            if (onConnected) onConnected();
          }, 500);
        } else {
          status.textContent = '连接失败: ' + (result.error || '未知错误');
          status.style.color = '#e74c3c';
        }
      });
    }

    overlay.classList.remove('hidden');
    _refreshPorts();
  }

  async function _refreshPorts() {
    const select = document.getElementById('mb-port-select');
    if (!select) return;
    select.innerHTML = '<option value="">扫描中...</option>';
    const ports = await listPorts();
    select.innerHTML = '';
    if (ports.length === 0) {
      select.innerHTML = '<option value="">未检测到串口</option>';
      return;
    }
    // 优先选择包含 micro:bit / DAPLink / CMSIS 的端口
    ports.sort((a, b) => {
      const aMb = /micro|dap|cmsis/i.test(a.manufacturer || '') || /COM\d+/i.test(a.path);
      const bMb = /micro|dap|cmsis/i.test(b.manufacturer || '') || /COM\d+/i.test(b.path);
      return (bMb ? 1 : 0) - (aMb ? 1 : 0);
    });
    ports.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.path;
      opt.textContent = p.path + (p.manufacturer ? ' (' + p.manufacturer + ')' : '');
      select.appendChild(opt);
    });
  }

  return {
    listPorts, connect, disconnect, isConnected, getMode,
    enableSimulator, disableSimulator, isUsingSimulator,
    send, query,
    ledOn, ledOff, ledPattern, ledPixel, text, show,
    buzz, buzzOff, servo, servoOff, motor, motorBrake,
    rgbInit, rgb, rgbOne, rgbOff,
    pinWrite, pinRead,
    getTemp, getLight, getAcc, getButton, getGesture, getSound, getAll,
    compileToPython, flashHex, flashMainHex, compileAndFlash,
    showConnectDialog,
  };
})();
