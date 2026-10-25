/**
 * MicrobitSimulator - micro:bit 模拟器 (实时模式 + 上传模式)
 * 模拟 5x5 LED 矩阵、A/B 按钮、GPIO 引脚、传感器数据
 *
 * 用法:
 *   MicrobitSimulator.init(container?)  // 初始化 UI
 *   MicrobitSimulator.handle(cmd)       // 处理固件协议命令, 返回 { ok, response }
 *   MicrobitSimulator.destroy()         // 销毁 UI
 */
var MicrobitSimulator = (function () {
  var _led = [];
  var _buttonA = false;
  var _buttonB = false;
  var _pins = {};
  var _sensors = {
    temperature: 22, light: 128,
    ax: 0, ay: 0, az: -1024,
    sound: 30, gesture: 'none'
  };
  var _scrollTimer = null;
  var _inited = false;
  var _root = null;

  var IMAGES = {
    HEART:     '0909099999999990999000900',
    HAPPY:     '0000009090000009000909990',
    SAD:       '0000009090000000999090009',
    ANGRY:     '9000909090000000999090009',
    CONFUSED:  '0000009090000000090090900',
    ASLEEP:    '0000099999000000999000000',
    SURPRISED: '0909090009900099000909990',
    MEH:       '0000090009000000900099999',
    YES:       '0000000090000909090090009',
    NO:        '9000909090009000000000000',
    DIAMOND:   '0090009090900909009000900',
    SQUARE:    '9999990009900099000999999',
    TRIANGLE:  '0090009990900909999999999',
    COW:       '9000990009999990999000900',
    RABBIT:    '9090090900999990909000000',
    DUCK:      '0990099900099900000000000',
    HOUSE:     '0090009990999999909999099',
    GHOST:     '0999099999999999909090109',
    SWORD:     '0090000900099900090009000',
    GIRAFFE:   '9900009000090000900009000'
  };

  function _digitPattern(n) {
    var d = {
      '0': '0990090090900909009009900', '1': '0090009900009000090009990',
      '2': '0990090090009000900099990', '3': '0999090009009909000909990',
      '4': '9000990099999000090009000', '5': '999999000099900000909990',
      '6': '099909000099909000909990', '7': '9999900090009000900090000',
      '8': '0999090009099909000909990', '9': '0999090009099990000909990'
    };
    return d[n] || '00000'.repeat(5);
  }

  function _letterPattern(c) {
    // 大写字母 (5×5 全高度)
    var u = {
      'A': '0999090009999999000990009', 'B': '9999090090999909009099990',
      'C': '0999090000900009000909990', 'D': '9990090090900099009099900',
      'E': '9999990000999009000099999', 'F': '9999990000999009000090000',
      'G': '0999090000900999000909990', 'H': '9000990009999999000990009',
      'I': '0999000900009000090009990', 'J': '0009000009000099000909990',
      'K': '9000990090999009009090009', 'L': '9000090000900009000099999',
      'M': '9000999999909099000990009', 'N': '9000999009909099009990009',
      'O': '0999090009900099000909990', 'P': '9999090009999909000090000',
      'Q': '0999090009900099099009909', 'R': '9999090009999909009090009',
      'S': '0999090000099900000909990', 'T': '9999900900009000090000900',
      'U': '9000990009900099000909990', 'V': '9000990009900099000900900',
      'W': '9000990009909099999990009', 'X': '9000909090009000909090009',
      'Y': '9000909090009000090000900', 'Z': '9999900090009000900099999'
    };
    // 小写字母 (3行高度, 与 5 行大写区分)
    var lo = {
      'a': '0000000000099009009009990', 'b': '9000090000999009000999900',
      'c': '0000000000099909000009990', 'd': '0000900009099909000909990',
      'e': '0000000000099909990090000', 'f': '0099009000999000900009000',
      'g': '0000000000099909000909990', 'h': '9000090000999009000990009',
      'i': '0090000000009000090000900', 'j': '0009000000000900009090900',
      'k': '9000090090990009009090090', 'l': '0990000900009000090009990',
      'm': '0000000000999999090990009', 'n': '0000000000999009000990009',
      'o': '0000000000099009000909900', 'p': '0000000000999009000999900',
      'q': '0000000000099009000909990', 'r': '0000000000999009000090000',
      's': '0000000000099909900009900', 't': '0900009000999000900000900',
      'u': '0000000000900099000909990', 'v': '0000000000900099000900900',
      'w': '0000000000900099090900900', 'x': '0000000000900090090090009',
      'y': '0000000000900099000909990', 'z': '0000000000999900090099990'
    };
    return u[c] || lo[c] || '00000'.repeat(5);
  }

  function _charPattern(ch) {
    var c = String(ch);
    if (/^[a-z]$/.test(c)) return _letterPattern(c);
    c = c.toUpperCase();
    if (IMAGES[c]) return IMAGES[c];
    if (/^[0-9]$/.test(c)) return _digitPattern(c);
    if (/^[A-Z]$/.test(c)) return _letterPattern(c);
    return '00000'.repeat(5);
  }

  function init(container) {
    if (_inited) return;
    for (var y = 0; y < 5; y++) {
      _led[y] = [];
      for (var x = 0; x < 5; x++) _led[y][x] = 0;
    }
    _buttonA = false; _buttonB = false;
    _pins = {};

    if (container) {
      // 在容器内创建 #microbit-sim-root 子元素，便于 CSS 选择器匹配
      var rootEl = document.createElement('div');
      rootEl.id = 'microbit-sim-root';
      rootEl.innerHTML = _buildHtml();
      container.appendChild(rootEl);
      _root = rootEl;
    } else {
      var aside = document.getElementById('right-panel');
      if (!aside) return;
      _root = document.createElement('div');
      _root.id = 'microbit-sim-root';
      aside.appendChild(_root);
      _root.innerHTML = _buildHtml();
    }
    _bindEvents();
    _renderLed();
    _renderPins();
    _renderSensors();
    _inited = true;
  }

  function destroy() {
    if (_scrollTimer) { clearTimeout(_scrollTimer); _scrollTimer = null; }
    if (_root && _root.parentNode) _root.parentNode.removeChild(_root);
    _root = null;
    _inited = false;
  }

  function isReady() { return _inited; }

  function _buildHtml() {
    var ledRows = '';
    for (var y = 0; y < 5; y++) {
      var row = '';
      for (var x = 0; x < 5; x++) {
        row += '<div class="mbs-led" data-x="' + x + '" data-y="' + y + '"></div>';
      }
      ledRows += '<div class="mbs-row">' + row + '</div>';
    }
    return '' +
      '<div class="mbs-board">' +
        '<div class="mbs-title">🎛️ micro:bit 模拟器</div>' +
        '<div class="mbs-plate">' +
          '<button class="mbs-btn mbs-btn-a" data-btn="A">A</button>' +
          '<div class="mbs-led-frame">' + ledRows + '</div>' +
          '<button class="mbs-btn mbs-btn-b" data-btn="B">B</button>' +
        '</div>' +
        '<div class="mbs-pins"></div>' +
        '<div class="mbs-sensors"></div>' +
        '<div class="mbs-toolbar">' +
          '<button class="mbs-tbtn" data-action="reset" title="重置">🔄</button>' +
          '<button class="mbs-tbtn" data-action="clear" title="清屏">⬛</button>' +
          '<button class="mbs-tbtn" data-action="happy" title="笑脸">😊</button>' +
          '<button class="mbs-tbtn" data-action="heart" title="爱心">❤️</button>' +
          '<button class="mbs-tbtn" data-action="sad" title="难过">😢</button>' +
          '<button class="mbs-tbtn" data-action="yes" title="Yes">✔</button>' +
        '</div>' +
      '</div>';
  }

  function _bindEvents() {
    if (!_root) return;
    _root.querySelectorAll('.mbs-btn').forEach(function (b) {
      var k = b.getAttribute('data-btn');
      var press = function (e) { e.preventDefault(); _setButton(k, true); };
      var release = function (e) { e.preventDefault(); _setButton(k, false); };
      b.addEventListener('mousedown', press);
      b.addEventListener('touchstart', press);
      b.addEventListener('mouseup', release);
      b.addEventListener('mouseleave', release);
      b.addEventListener('touchend', release);
      b.addEventListener('touchcancel', release);
    });
    _root.addEventListener('click', function (e) {
      var pin = e.target.closest('.mbs-pin');
      if (pin && !e.target.classList.contains('mbs-pin-input')) {
        _togglePinMode(pin.getAttribute('data-pin'));
      }
      var tbtn = e.target.closest('.mbs-tbtn');
      if (tbtn) {
        var action = tbtn.getAttribute('data-action');
        if (action === 'reset') handle('RST');
        else if (action === 'clear') handle('L0');
        else if (action === 'happy') handle('HA');
        else if (action === 'heart') handle('L1');
        else if (action === 'sad') handle('SA');
        else if (action === 'yes') handle('YE');
      }
    });
    _root.addEventListener('input', function (e) {
      if (e.target.classList.contains('mbs-pin-input')) {
        var name = e.target.getAttribute('data-pin');
        var v = parseInt(e.target.value, 10);
        if (isNaN(v)) v = 0;
        _pins[name].value = Math.max(0, Math.min(1023, v));
        _renderPinOne(name);
      } else if (e.target.classList.contains('mbs-sensor-input')) {
        var key = e.target.getAttribute('data-key');
        var v = parseFloat(e.target.value);
        if (!isNaN(v)) _sensors[key] = v;
      }
    });
  }

  function _setButton(k, pressed) {
    if (k === 'A') _buttonA = !!pressed;
    else if (k === 'B') _buttonB = !!pressed;
    var el = _root && _root.querySelector('.mbs-btn-' + k.toLowerCase());
    if (el) el.classList.toggle('active', !!pressed);
  }

  function _togglePinMode(name) {
    if (!_pins[name]) _pins[name] = { mode: 'digital-out', value: 0 };
    var p = _pins[name];
    var modes = ['digital-out', 'analog-out', 'analog-in'];
    var i = modes.indexOf(p.mode);
    p.mode = modes[(i + 1) % modes.length];
    _renderPinOne(name);
  }

  function _renderLed() {
    if (!_root) return;
    _root.querySelectorAll('.mbs-led').forEach(function (c) {
      var x = +c.getAttribute('data-x');
      var y = +c.getAttribute('data-y');
      var b = (_led[y] && _led[y][x]) || 0;
      b = Math.max(0, Math.min(9, b));
      var alpha = b / 9;
      if (b === 0) {
        c.style.background = 'rgba(30,30,35,0.85)';
        c.style.boxShadow = 'inset 0 0 2px rgba(0,0,0,0.6)';
      } else {
        c.style.background = 'rgba(255,60,60,' + Math.max(0.2, alpha) + ')';
        c.style.boxShadow = '0 0 ' + (3 + b) + 'px rgba(255,60,60,' + (alpha * 0.9) + '), inset 0 0 2px rgba(255,200,200,0.6)';
      }
    });
  }

  function _applyPattern(str) {
    if (typeof str !== 'string') return;
    var s = str.replace(/[\s]/g, '');
    if (s.length < 25) return;
    for (var y = 0; y < 5; y++) {
      for (var x = 0; x < 5; x++) {
        var ch = s[y * 5 + x];
        var v = parseInt(ch, 10);
        if (isNaN(v)) v = (ch === 'X' || ch === '#') ? 9 : 0;
        _led[y][x] = Math.max(0, Math.min(9, v));
      }
    }
    _renderLed();
  }

  function _clearLed() {
    for (var y = 0; y < 5; y++) for (var x = 0; x < 5; x++) _led[y][x] = 0;
    _renderLed();
  }

  function _scrollText(txt) {
    if (_scrollTimer) { clearTimeout(_scrollTimer); _scrollTimer = null; }
    var chars = String(txt).split('');
    var cols = [];
    chars.forEach(function (ch) {
      var pat = _charPattern(ch);
      for (var c = 0; c < 5; c++) {
        var col = [];
        for (var r = 0; r < 5; r++) {
          var v = parseInt(pat[r * 5 + c], 10);
          col.push(isNaN(v) ? 0 : v);
        }
        cols.push(col);
      }
      cols.push([0, 0, 0, 0, 0]);
    });
    var pos = 0;
    var total = cols.length;
    var step = function () {
      for (var y = 0; y < 5; y++) {
        for (var x = 0; x < 5; x++) {
          var idx = pos + x;
          _led[y][x] = idx < total ? (cols[idx][y] || 0) : 0;
        }
      }
      _renderLed();
      pos++;
      if (pos < total + 5) _scrollTimer = setTimeout(step, 120);
    };
    step();
  }

  function _showChar(ch) { _applyPattern(_charPattern(ch)); }

  function _renderPins() {
    if (!_root) return;
    var box = _root.querySelector('.mbs-pins');
    if (!box) return;
    var list = ['P0','P1','P2','P3','P4','P5','P6','P7','P8','P9',
                'P10','P11','P12','P13','P14','P15','P16','P19','P20'];
    var html = '<div class="mbs-pins-title">GPIO 引脚 <span class="mbs-hint">(点击切换)</span></div><div class="mbs-pins-grid">';
    list.forEach(function (p) { html += _pinHtml(p); });
    html += '</div>';
    box.innerHTML = html;
  }

  function _renderPinOne(name) {
    if (!_root) return;
    var el = _root.querySelector('.mbs-pin[data-pin="' + name + '"]');
    if (!el) return;
    var wasFocused = document.activeElement === el.querySelector('.mbs-pin-input');
    el.outerHTML = _pinHtml(name);
    if (wasFocused) {
      var newEl = _root.querySelector('.mbs-pin[data-pin="' + name + '"] .mbs-pin-input');
      if (newEl) { newEl.focus(); newEl.select(); }
    }
  }

  function _pinHtml(name) {
    var p = _pins[name] || { mode: 'digital-out', value: 0 };
    var modeTag = p.mode === 'analog-in' ? 'IN' : (p.mode === 'analog-out' ? 'PWM' : 'OUT');
    var modeColor = p.mode === 'analog-in' ? '#60a5fa' : (p.mode === 'analog-out' ? '#f59e0b' : '#64748b');
    var alpha = Math.max(0.2, Math.min(1, p.value / 1023));
    var dotColor = p.value > 512 ? 'rgba(255,180,60,' + alpha + ')' : 'rgba(80,200,255,' + alpha + ')';
    var inputHtml = '';
    if (p.mode === 'analog-in') {
      inputHtml = '<input class="mbs-pin-input" data-pin="' + name + '" type="number" min="0" max="1023" value="' + p.value + '" onclick="event.stopPropagation();">';
    }
    return '' +
      '<div class="mbs-pin" data-pin="' + name + '" title="点击切换模式">' +
        '<div class="mbs-pin-dot" style="background:' + dotColor + ';"></div>' +
        '<div class="mbs-pin-name">' + name + '</div>' +
        '<div class="mbs-pin-mode" style="background:' + modeColor + ';">' + modeTag + '</div>' +
        inputHtml +
      '</div>';
  }

  function _renderSensors() {
    if (!_root) return;
    var box = _root.querySelector('.mbs-sensors');
    if (!box) return;
    var items = [
      { k: 'temperature', label: '温度', unit: '°C', min: -20, max: 60, step: 0.1 },
      { k: 'light', label: '光照', unit: '', min: 0, max: 255, step: 1 },
      { k: 'sound', label: '声音', unit: '', min: 0, max: 255, step: 1 },
      { k: 'ax', label: '加速度X', unit: '', min: -2048, max: 2048, step: 1 },
      { k: 'ay', label: '加速度Y', unit: '', min: -2048, max: 2048, step: 1 },
      { k: 'az', label: '加速度Z', unit: '', min: -2048, max: 2048, step: 1 }
    ];
    var html = '<div class="mbs-sensors-title">传感器 <span class="mbs-hint">(模拟输入)</span></div>';
    items.forEach(function (it) {
      html += '' +
        '<div class="mbs-sensor">' +
          '<span class="mbs-sensor-label">' + it.label + '</span>' +
          '<input class="mbs-sensor-input" data-key="' + it.k + '" type="number" min="' + it.min + '" max="' + it.max + '" step="' + it.step + '" value="' + _sensors[it.k] + '">' +
          '<span class="mbs-sensor-unit">' + it.unit + '</span>' +
        '</div>';
    });
    box.innerHTML = html;
  }

  function _ensureLedInit() {
    if (_led.length === 0) {
      for (var y = 0; y < 5; y++) {
        _led[y] = [];
        for (var x = 0; x < 5; x++) _led[y][x] = 0;
      }
    }
  }

  function handle(cmd) {
    if (typeof cmd !== 'string') return { ok: false, error: 'bad cmd' };
    _ensureLedInit();
    var c = cmd.trim();
    if (!c || c[0] === '#') return { ok: true };

    if (c === 'P') return { ok: true, response: 'OK:102400' };
    if (c === 'RST') { _clearLed(); _buttonA = false; _buttonB = false; return { ok: true, response: 'OK' }; }

    if (c === 'L1') { _applyPattern(IMAGES.HEART); return { ok: true, response: 'OK' }; }
    if (c === 'L0') { _clearLed(); return { ok: true, response: 'OK' }; }
    if (c.indexOf('LI') === 0) {
      var pat = c.slice(2).trim();
      if (pat.length >= 25) { _applyPattern(pat); return { ok: true, response: 'OK' }; }
      return { ok: true, response: 'ER:bad pattern' };
    }
    if (c.indexOf('PX') === 0) {
      var parts = c.slice(2).split(',');
      var x = parseInt(parts[0], 10), y = parseInt(parts[1], 10), b = parseInt(parts[2], 10);
      if (!isNaN(x) && !isNaN(y) && !isNaN(b) && x >= 0 && x < 5 && y >= 0 && y < 5) {
        _led[y][x] = Math.max(0, Math.min(9, b));
        _renderLed();
        return { ok: true, response: 'OK' };
      }
      return { ok: true, response: 'ER:invalid pixel' };
    }
    if (c.indexOf('L:') === 0) {
      var name = c.slice(2).toUpperCase();
      if (IMAGES[name]) { _applyPattern(IMAGES[name]); return { ok: true, response: 'OK' }; }
      return { ok: true, response: 'ER:unknown image' };
    }
    if (c.indexOf('T:') === 0) { _scrollText(c.slice(2)); return { ok: true, response: 'OK' }; }
    if (c.indexOf('S:') === 0) {
      var txt = c.slice(2);
      if (txt.length === 1) _showChar(txt);
      else _scrollText(txt);
      return { ok: true, response: 'OK' };
    }
    var EMOTE = { HA: 'HAPPY', SA: 'SAD', AN: 'ANGRY', CO: 'CONFUSED',
                  SL: 'ASLEEP', SU: 'SURPRISED', ME: 'MEH', YE: 'YES', NO: 'NO' };
    if (EMOTE[c]) { _applyPattern(IMAGES[EMOTE[c]]); return { ok: true, response: 'OK' }; }

    if (c === 'BZ') { return { ok: true, response: 'OK' }; }
    if (c.indexOf('BZ') === 0) { return { ok: true, response: 'OK' }; }

    if (c.indexOf('SV') === 0) {
      var sp = c.slice(2).split(',');
      if (sp.length >= 2 && _isValidPin(sp[0])) {
        var ang = Math.max(0, Math.min(180, parseInt(sp[1], 10) || 0));
        var pwm = Math.round((500 + ang * 2000 / 180) * 1023 / 20000);
        _writePin(sp[0], pwm, 'analog-out');
        return { ok: true, response: 'OK' };
      }
      return { ok: true, response: 'ER:bad servo' };
    }
    if (c.indexOf('SO') === 0) {
      var pn = c.slice(2);
      if (_isValidPin(pn)) { _writePin(pn, 0, 'analog-out'); return { ok: true, response: 'OK' }; }
      return { ok: true, response: 'ER:bad pin' };
    }

    if (c.indexOf('M:') === 0) return { ok: true, response: 'OK' };
    if (c === 'MB') return { ok: true, response: 'OK' };
    if (c.indexOf('MC') === 0) return { ok: true, response: 'OK' };
    if (c.indexOf('NI') === 0) return { ok: true, response: 'OK' };
    if (c.indexOf('C:') === 0) return { ok: true, response: 'OK' };

    if (c.indexOf('W:') === 0) {
      var wp = c.slice(2).split(',');
      if (wp.length >= 2 && _isValidPin(wp[0])) {
        var wv = parseInt(wp[1], 10) || 0;
        var pwmMode = wp[2] === 'pwm';
        _writePin(wp[0], wv, pwmMode ? 'analog-out' : 'digital-out');
        return { ok: true, response: 'OK' };
      }
      return { ok: true, response: 'ER:bad pin' };
    }

    if (c.indexOf('Q:') === 0) {
      var qn = c.slice(2).toUpperCase();
      if (_pins[qn] && _pins[qn].mode === 'analog-in') {
        return { ok: true, response: 'OK:' + _pins[qn].value };
      }
      return { ok: true, response: 'OK:0' };
    }
    if (c === 'TE') return { ok: true, response: 'OK:' + _sensors.temperature };
    if (c === 'LT') return { ok: true, response: 'OK:' + Math.floor(_sensors.light) };
    if (c === 'AC') {
      var ax = _sensors.ax, ay = _sensors.ay, az = _sensors.az;
      var m = Math.sqrt(ax * ax + ay * ay + az * az);
      return { ok: true, response: 'OK:' + Math.floor(ax) + ',' + Math.floor(ay) + ',' + Math.floor(az) + ',' + Math.floor(m) };
    }
    if (c === 'BT') return { ok: true, response: 'OK:' + (_buttonA ? 1 : 0) + ',' + (_buttonB ? 1 : 0) };
    if (c === 'GE') return { ok: true, response: 'OK:' + (_sensors.gesture || 'none') };
    if (c === 'SN') return { ok: true, response: 'OK:' + Math.floor(_sensors.sound) };
    if (c === 'AL') {
      var ax2 = _sensors.ax, ay2 = _sensors.ay, az2 = _sensors.az;
      var m2 = Math.sqrt(ax2 * ax2 + ay2 * ay2 + az2 * az2);
      return { ok: true, response: 'OK:' + [
        _sensors.temperature, Math.floor(_sensors.light),
        Math.floor(ax2), Math.floor(ay2), Math.floor(az2), Math.floor(m2),
        _buttonA ? 1 : 0, _buttonB ? 1 : 0
      ].join(',') };
    }

    if (c === 'RO' || c === 'RF') return { ok: true, response: 'OK' };
    if (c.indexOf('RI:') === 0) return { ok: true, response: 'OK' };
    if (c.indexOf('WD:') === 0) return { ok: true, response: 'OK' };

    return { ok: true, response: 'ER:sim-unknown ' + c };
  }

  var VALID_PINS = ['P0','P1','P2','P3','P4','P5','P6','P7','P8','P9','P10',
                    'P11','P12','P13','P14','P15','P16','P19','P20'];
  function _isValidPin(n) { return VALID_PINS.indexOf(String(n).toUpperCase()) >= 0; }

  function _writePin(name, val, mode) {
    name = String(name).toUpperCase();
    if (!_pins[name]) _pins[name] = { mode: 'digital-out', value: 0 };
    if (mode) _pins[name].mode = mode;
    _pins[name].value = Math.max(0, Math.min(1023, parseInt(val, 10) || 0));
    _renderPinOne(name);
  }

  return {
    init: init,
    destroy: destroy,
    isReady: isReady,
    handle: handle,
    pressButton: function (k, pressed) { _setButton(k, pressed); },
    setSensor: function (key, val) { if (key in _sensors) _sensors[key] = val; },
    getLed: function () { return _led.map(function (r) { return r.slice(); }); }
  };
})();
