/**
 * MicrobitCompiler - 上传模式: 积木 → MicroPython → hex
 * 数据驱动架构: STMT_MAP + EXPR_MAP 查找表
 *
 * 核心逻辑: _parse(blockId) 统一递归解析
 *   - 沿 flowOut 链遍历积木
 *   - 遇到 C 型槽 → 递归调用 _parse(subBlocks[slot])
 *   - 遇到参数 → _resolve() 解析 paramConnections 或原始值
 *
 * 积木数据结构 (block-defs.js createBlock):
 *   block.flowOut          = string|null  (下一个积木 ID, 普通链)
 *   block.flowIn           = string|null  (上一个积木 ID)
 *   block.subBlocks        = {}           (C型槽: { slotName: firstBlockId })
 *   block.paramConnections = {}           (返回值: { paramName: reporterBlockId })
 */
var MicrobitCompiler = (function () {

  // ================================================================
  //  辅助函数
  // ================================================================
  var _pad = function (n) { return ' '.repeat(Math.max(0, n)); };
  var _pyName = function (s) { return String(s || '_').replace(/[^a-zA-Z0-9_]/g, '_'); };
  var _pin = function (n) { return 'pin' + (n || 'P0').replace(/^P/i, '').toLowerCase(); };
  var _esc = function (s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); };

  function _val(v) {
    if (typeof v === 'number') return String(v);
    if (typeof v === 'string') {
      if (/^-?\d+(\.\d+)?$/.test(v)) return v;
      return '\'' + v.replace(/'/g, "\\'") + '\'';
    }
    if (typeof v === 'boolean') return v ? 'True' : 'False';
    return String(v || 0);
  }

  function _bodyOrPass(code, indent) {
    return code.trim() ? code : _pad(indent) + 'pass\n';
  }

  function _servoCode(pin, angle) {
    var n = Number(angle);
    if (!isNaN(n)) {
      var a = Math.max(0, Math.min(180, n));
      return Math.round(500 + (a / 180) * 2000);
    }
    // 动态表达式: 输出 Python 计算
    return 'int(500+max(0,min(180,' + angle + '))/180*2000)';
  }

  function _motorCode(which, speed) {
    var s = Number(speed);
    if (!isNaN(s)) {
      // 静态数值: JS 端直接计算 PWM
      s = Math.max(-100, Math.min(100, s));
      var pwm = Math.round(Math.abs(s) * 1023 / 100);
      if (which === 'ALL') {
        return [
          s >= 0 ? 'pin1.write_analog(' + pwm + ')' : 'pin1.write_analog(0)',
          s >= 0 ? 'pin2.write_analog(0)' : 'pin2.write_analog(' + pwm + ')',
          s >= 0 ? 'pin13.write_analog(' + pwm + ')' : 'pin13.write_analog(0)',
          s >= 0 ? 'pin14.write_analog(0)' : 'pin14.write_analog(' + pwm + ')'
        ].join('\n');
      }
      var p1 = which === 'A' ? 'pin1' : 'pin13';
      var p2 = which === 'A' ? 'pin2' : 'pin14';
      return s >= 0 ? p1 + '.write_analog(' + pwm + ')\n' + p2 + '.write_analog(0)'
                    : p1 + '.write_analog(0)\n' + p2 + '.write_analog(' + pwm + ')';
    }
    // 动态表达式: 输出 Python 计算
    if (which === 'ALL') {
      return '_s=max(-100,min(100,int(' + speed + ')))\n' +
        '_p=abs(_s)*1023//100\n' +
        'pin1.write_analog(_p if _s>=0 else 0)\n' +
        'pin2.write_analog(0 if _s>=0 else _p)\n' +
        'pin13.write_analog(_p if _s>=0 else 0)\n' +
        'pin14.write_analog(0 if _s>=0 else _p)';
    }
    var p1 = which === 'A' ? 'pin1' : 'pin13';
    var p2 = which === 'A' ? 'pin2' : 'pin14';
    return '_s=max(-100,min(100,int(' + speed + ')))\n' +
      '_p=abs(_s)*1023//100\n' +
      p1 + '.write_analog(_p if _s>=0 else 0)\n' +
      p2 + '.write_analog(0 if _s>=0 else _p)';
  }

  /** 安全获取 subBlocks 中的入口 ID */
  function _getSubEntry(block, slotName) {
    var sb = block.subBlocks;
    if (!sb || typeof sb !== 'object') return null;
    var val = sb[slotName];
    if (Array.isArray(val)) return val[0] || null;
    if (typeof val === 'string') return val;
    return null;
  }

  // ================================================================
  //  核心解析引擎 — 一个统一递归函数
  // ================================================================

  /**
   * _parse(blockId, blocks, indent) → Python 代码字符串
   *
   * 从 blockId 开始, 沿 flowOut 链遍历:
   *   1. 查 STMT_MAP 找到 handler → 翻译当前积木
   *   2. handler 内部遇到 C 型槽 → 调用 _parse(subBlockId, blocks, indent+1) 递归
   *   3. handler 内部遇到参数 → 调用 _resolve() 解析 paramConnections / 原始值
   *   4. 处理完后 cur = cur.flowOut, 继续下一个积木
   */
  function _parse(blockId, blocks, indent) {
    var code = '';
    var visited = {};
    var curId = blockId;

    while (curId && !visited[curId]) {
      visited[curId] = true;
      var cur = blocks[curId];
      if (!cur) break;

      var handler = STMT_MAP[cur.type];
      if (handler) {
        var line = handler(cur, blocks, indent);
        if (line) code += _pad(indent) + line + '\n';
      } else {
        var skip = ['mb_on_start','event_start','mb_on_button','mb_on_gesture','func_define'];
        if (skip.indexOf(cur.type) < 0) {
          console.warn('[MicrobitCompiler] 未翻译的语句积木:', cur.type, 'id=' + cur.id);
          code += _pad(indent) + '# 未翻译: ' + cur.type + '\n';
        }
      }

      curId = cur.flowOut || null;
    }

    return code;
  }

  /** 解析参数: paramConnections 优先 → reporter 表达式, 否则用原始值 */
  function _resolve(block, paramName, blocks) {
    var pc = block.paramConnections;
    if (pc && typeof pc === 'object') {
      var connId = pc[paramName];
      if (typeof connId === 'string' && blocks[connId]) {
        return _walkExpr(connId, blocks);
      }
    }
    return _val((block.params || {})[paramName]);
  }

  /** 解析表达式积木 → 表达式字符串 */
  function _walkExpr(blockId, blocks) {
    var b = blocks[blockId];
    if (!b) return '0';
    var handler = EXPR_MAP[b.type];
    if (handler) return handler(b, blocks);
    console.warn('[MicrobitCompiler] 未翻译的表达式积木:', b.type, 'id=' + b.id);
    return _val(Object.values(b.params || {})[0] || 0);
  }

  // ================================================================
  //  STMT_MAP: 语句级翻译查找表
  //  C 型槽积木内部: 调用 _parse(subBlockId, blocks, indent+1) 递归
  //  参数: 调用 _resolve(block, paramName, blocks)
  // ================================================================

  var STMT_MAP = {
    // ----- micro:bit LED -----
    'mb_led_on': function () { return 'display.show(Image.HEART)'; },
    'mb_led_off': function () { return 'display.clear()'; },
    'mb_led_pattern': function (b, blocks) { return 'display.show(Image(' + _resolve(b, 'pattern', blocks) + '))'; },
    'mb_led_pixel': function (b, blocks) {
      return 'display.set_pixel(' + _resolve(b, 'x', blocks) + ',' + _resolve(b, 'y', blocks) + ',' + _resolve(b, 'b', blocks) + ')';
    },
    'mb_text': function (b, blocks) { return 'display.scroll(' + _resolve(b, 'text', blocks) + ')'; },
    'mb_show': function (b, blocks) { return 'display.show(' + _resolve(b, 'char', blocks) + ')'; },

    // ----- micro:bit 蜂鸣器 -----
    'mb_buzz': function (b, blocks) { return 'music.pitch(' + _resolve(b, 'freq', blocks) + ',' + _resolve(b, 'dur', blocks) + ')'; },
    'mb_buzz_off': function () { return 'music.stop()'; },

    // ----- micro:bit 舵机 -----
    'mb_servo': function (b, blocks, indent) {
      var pin = _pin((b.params || {}).pin);
      return pin + '.write_analog(' + _servoCode(pin, _resolve(b, 'angle', blocks)) + ')\n' + _pad(indent) + pin + '.set_analog_period(20)';
    },
    'mb_servo_off': function (b) { return _pin((b.params || {}).pin) + '.write_digital(0)'; },

    // ----- micro:bit 电机 -----
    'mb_motor': function (b, blocks) { return _motorCode((b.params || {}).which, _resolve(b, 'speed', blocks)); },
    'mb_motor_brake': function () { return 'pin1.write_analog(0)\npin2.write_analog(0)\npin13.write_analog(0)\npin14.write_analog(0)'; },

    // ----- micro:bit NeoPixel -----
    'mb_rgb_init': function (b, blocks) {
      return '_np=_NP.NeoPixel(' + _pin((b.params || {}).pin) + ',' + _resolve(b, 'count', blocks) + ')';
    },
    'mb_rgb': function (b, blocks, indent) {
      var I = _pad(indent);
      return 'if _np:\n' + I + ' for i in range(len(_np)):\n' + I + '  _np[i]=(' + _resolve(b, 'r', blocks) + ',' + _resolve(b, 'g', blocks) + ',' + _resolve(b, 'b', blocks) + ')\n' + I + ' _np.show()';
    },
    'mb_rgb_one': function (b, blocks, indent) {
      var I = _pad(indent);
      return 'if _np:\n' + I + ' _np[' + _resolve(b, 'idx', blocks) + ']=(' + _resolve(b, 'r', blocks) + ',' + _resolve(b, 'g', blocks) + ',' + _resolve(b, 'b', blocks) + ')\n' + I + ' _np.show()';
    },
    'mb_rgb_off': function (b, blocks, indent) { return 'if _np:\n' + _pad(indent) + ' _np.clear()'; },

    // ----- micro:bit GPIO -----
    'mb_pin_write': function (b, blocks) { return _pin((b.params || {}).pin) + '.write_digital(' + _resolve(b, 'val', blocks) + ')'; },

    // ----- micro:bit 等待 -----
    'mb_wait': function (b, blocks) { return 'utime.sleep_ms(' + _resolve(b, 'ms', blocks) + ')'; },

    // ===== 控制 =====
    'wait': function (b, blocks) { return 'utime.sleep(' + _resolve(b, 'sec', blocks) + ')'; },
    'stop_all': function () { return 'raise SystemExit'; },

    // ===== C 型槽积木 — 递归调用 _parse =====
    'repeat': function (b, blocks, indent) {
      var body = _parse(_getSubEntry(b, 'body'), blocks, indent + 1);
      return 'for _i in range(' + _resolve(b, 'times', blocks) + '):\n' + _bodyOrPass(body, indent + 1);
    },
    'forever': function (b, blocks, indent) {
      var body = _parse(_getSubEntry(b, 'body'), blocks, indent + 1);
      return 'while True:\n' + _bodyOrPass(body, indent + 1) + _pad(indent) + ' sleep(20)\n';
    },
    'if_then': function (b, blocks, indent) {
      var body = _parse(_getSubEntry(b, 'body'), blocks, indent + 1);
      return 'if ' + _resolve(b, 'cond', blocks) + ':\n' + _bodyOrPass(body, indent + 1);
    },
    'if_else': function (b, blocks, indent) {
      var thenCode = _parse(_getSubEntry(b, 'then'), blocks, indent + 1);
      var elseCode = _parse(_getSubEntry(b, 'else'), blocks, indent + 1);
      return 'if ' + _resolve(b, 'cond', blocks) + ':\n' + _bodyOrPass(thenCode, indent + 1) +
             _pad(indent) + 'else:\n' + _bodyOrPass(elseCode, indent + 1);
    },
    'repeat_until': function (b, blocks, indent) {
      var body = _parse(_getSubEntry(b, 'body'), blocks, indent + 1);
      return 'while not (' + _resolve(b, 'cond', blocks) + '):\n' + _bodyOrPass(body, indent + 1);
    },

    // ===== 变量 =====
    'var_set': function (b, blocks) { return _pyName((b.params || {}).name) + ' = ' + _resolve(b, 'val', blocks); },
    'var_change': function (b, blocks) { var n = _pyName((b.params || {}).name); return n + ' = ' + n + ' + ' + _resolve(b, 'val', blocks); },
    'var_show': function (b) { return 'display.scroll(str(' + _pyName((b.params || {}).name) + '))'; },
    'var_hide': function () { return null; },
    'scope_local': function (b, blocks, indent) {
      var body = _parse(_getSubEntry(b, 'body'), blocks, indent);
      return body.trim() ? body.trimEnd() : null;
    },

    // ===== 函数 =====
    'func_call': function (b, blocks) {
      var name = _pyName((b.params || {}).name);
      var extras = b._extraParams || [];
      return name + '(' + extras.map(function (ep) { return _resolve(b, ep.name, blocks); }).join(',') + ')';
    },
    'func_return': function (b, blocks) { return 'return ' + _resolve(b, 'val', blocks); },

    // ===== 列表 =====
    'list_push': function (b, blocks) { return _pyName((b.params || {}).list) + '.append(' + _resolve(b, 'val', blocks) + ')'; },
    'list_delete': function (b, blocks) { return _pyName((b.params || {}).list) + '.pop((' + _resolve(b, 'idx', blocks) + ')-1)'; },
    'list_insert': function (b, blocks) { return _pyName((b.params || {}).list) + '.insert((' + _resolve(b, 'idx', blocks) + ')-1,' + _resolve(b, 'val', blocks) + ')'; },
    'list_set': function (b, blocks) { return _pyName((b.params || {}).list) + '[(' + _resolve(b, 'idx', blocks) + ')-1] = ' + _resolve(b, 'val', blocks); },
    'list_clear': function (b) { return _pyName((b.params || {}).list) + '.clear()'; },
    'list_sort': function (b) { var p = b.params || {}; return _pyName(p.list) + '.sort(' + (p.order === '降序' ? 'reverse=True' : '') + ')'; },
    'list_reverse': function (b) { return _pyName((b.params || {}).list) + '.reverse()'; },
    'list_foreach': function (b, blocks, indent) {
      var p = b.params || {};
      var body = _parse(_getSubEntry(b, 'body'), blocks, indent + 1);
      return 'for ' + _pyName(p.var || 'item') + ' in ' + _pyName(p.list) + ':\n' + _bodyOrPass(body, indent + 1);
    },
  };

  // ================================================================
  //  EXPR_MAP: 表达式级翻译查找表
  // ================================================================
  function _bin(op) {
    return function (b, blocks) { return '(' + _resolve(b, 'a', blocks) + op + _resolve(b, 'b', blocks) + ')'; };
  }

  var EXPR_MAP = {
    // 运算: 基础
    'op_add': _bin('+'),  'op_sub': _bin('-'),  'op_mul': _bin('*'),
    'op_div': _bin('/'),  'op_mod': _bin('%'),  'op_pow': _bin('**'),
    'op_random': function (b, blocks) { return 'random.randint(' + _resolve(b, 'a', blocks) + ',' + _resolve(b, 'b', blocks) + ')'; },
    'op_random_float': function () { return 'random.random()'; },

    // 运算: 比较
    'op_lt': _bin('<'),  'op_gt': _bin('>'),
    'op_lte': _bin('<='), 'op_gte': _bin('>='),
    'op_eq': _bin('=='),  'op_neq': _bin('!='),

    // 运算: 逻辑
    'op_and': function (b, blocks) { return '(' + _resolve(b, 'a', blocks) + ' and ' + _resolve(b, 'b', blocks) + ')'; },
    'op_or':  function (b, blocks) { return '(' + _resolve(b, 'a', blocks) + ' or ' + _resolve(b, 'b', blocks) + ')'; },
    'op_not': function (b, blocks) { return '(not ' + _resolve(b, 'a', blocks) + ')'; },

    // 运算: 字符串
    'op_join':        function (b, blocks) { return '(str(' + _resolve(b, 'a', blocks) + ')+str(' + _resolve(b, 'b', blocks) + '))'; },
    'op_strlen':      function (b, blocks) { return 'len(str(' + _resolve(b, 's', blocks) + '))'; },
    'op_substr':      function (b, blocks) { return 'str(' + _resolve(b, 's', blocks) + ')[(' + _resolve(b, 'start', blocks) + ')-1:' + _resolve(b, 'end', blocks) + ']'; },
    'op_str_index':   function (b, blocks) { return 'str(' + _resolve(b, 's', blocks) + ').find(' + _resolve(b, 'sub', blocks) + ')'; },
    'op_str_contains': function (b, blocks) { return '(' + _resolve(b, 'sub', blocks) + ' in str(' + _resolve(b, 's', blocks) + '))'; },
    'op_str_upper':   function (b, blocks) { return 'str(' + _resolve(b, 's', blocks) + ').upper()'; },
    'op_str_lower':   function (b, blocks) { return 'str(' + _resolve(b, 's', blocks) + ').lower()'; },
    'op_str_trim':    function (b, blocks) { return 'str(' + _resolve(b, 's', blocks) + ').strip()'; },
    'op_str_repeat':  function (b, blocks) { return '(str(' + _resolve(b, 's', blocks) + ')*int(' + _resolve(b, 'n', blocks) + '))'; },
    'op_str_replace': function (b, blocks) { return 'str(' + _resolve(b, 's', blocks) + ').replace(' + _resolve(b, 'from', blocks) + ',' + _resolve(b, 'to', blocks) + ')'; },
    'op_char_at':     function (b, blocks) { return 'str(' + _resolve(b, 's', blocks) + ')[(' + _resolve(b, 'n', blocks) + ')-1]'; },
    'op_to_number':   function (b, blocks) { return 'float(' + _resolve(b, 's', blocks) + ')'; },
    'op_to_string':   function (b, blocks) { return 'str(' + _resolve(b, 'n', blocks) + ')'; },
    'op_newline':     function () { return '"\\n"'; },

    // 运算: 数学函数
    'op_math': function (b, blocks) {
      var fn = (b.params || {}).fn || 'abs';
      var n = _resolve(b, 'n', blocks);
      var map = { abs:'abs', floor:'math.floor', ceil:'math.ceil', round:'round',
        sqrt:'math.sqrt', sin:'math.sin', cos:'math.cos', tan:'math.tan',
        asin:'math.asin', acos:'math.acos', atan:'math.atan',
        log:'math.log', log2:'math.log2', exp:'math.exp' };
      if (fn === 'sign') return '(1 if ' + n + '>0 else(-1 if ' + n + '<0 else 0))';
      return (map[fn] || fn) + '(' + n + ')';
    },
    'op_min':   function (b, blocks) { return 'min(' + _resolve(b, 'a', blocks) + ',' + _resolve(b, 'b', blocks) + ')'; },
    'op_max':   function (b, blocks) { return 'max(' + _resolve(b, 'a', blocks) + ',' + _resolve(b, 'b', blocks) + ')'; },
    'op_clamp': function (b, blocks) { return 'max(' + _resolve(b, 'min', blocks) + ',min(' + _resolve(b, 'max', blocks) + ',' + _resolve(b, 'n', blocks) + '))'; },
    'op_lerp':  function (b, blocks) { return '(' + _resolve(b, 'a', blocks) + '+(' + _resolve(b, 'b', blocks) + '-' + _resolve(b, 'a', blocks) + ')*' + _resolve(b, 't', blocks) + ')'; },
    'op_pi': function () { return 'math.pi'; },
    'op_e':  function () { return 'math.e'; },

    // 变量 (reporter)
    'var_get': function (b) { return _pyName((b.params || {}).name); },

    // 函数 (reporter)
    'func_call_reporter': function (b, blocks) {
      var name = _pyName((b.params || {}).name);
      var extras = b._extraParams || [];
      return name + '(' + extras.map(function (ep) { return _resolve(b, ep.name, blocks); }).join(',') + ')';
    },
    'func_param_get': function (b) { return _pyName((b.params || {}).name); },

    // 列表 (reporter)
    'list_create': function (b, blocks) {
      var extras = b._extraParams || [];
      if (extras.length === 0) return '[]';
      return '[' + extras.map(function (ep) { return _resolve(b, ep.name, blocks); }).join(',') + ']';
    },
    'list_get':      function (b, blocks) { return _pyName((b.params || {}).list) + '[(' + _resolve(b, 'idx', blocks) + ')-1]'; },
    'list_length':   function (b) { return 'len(' + _pyName((b.params || {}).list) + ')'; },
    'list_contains': function (b, blocks) { return '(' + _resolve(b, 'val', blocks) + ' in ' + _pyName((b.params || {}).list) + ')'; },
    'list_index_of': function (b, blocks) {
      var list = _pyName((b.params || {}).list);
      var val = _resolve(b, 'val', blocks);
      return '((' + list + '.index(' + val + ')+1) if ' + val + ' in ' + list + ' else 0)';
    },
    'list_join': function (b, blocks) { return _resolve(b, 'sep', blocks) + '.join(str(x) for x in ' + _pyName((b.params || {}).list) + ')'; },

    // micro:bit 传感器 (reporter)
    'mb_temp':    function () { return 'temperature()'; },
    'mb_light':   function () { return 'display.read_light_level()'; },
    'mb_acc_x':   function () { return 'accelerometer.get_x()'; },
    'mb_acc_y':   function () { return 'accelerometer.get_y()'; },
    'mb_acc_z':   function () { return 'accelerometer.get_z()'; },
    'mb_gesture': function () { return 'accelerometer.current_gesture()'; },
    'mb_sound':   function () { return 'microphone.sound_level()'; },
    'mb_button':  function (b) { return 'button_' + ((b.params || {}).btn || 'A').toLowerCase() + '.is_pressed()'; },
    'mb_pin_read': function (b) { return _pin((b.params || {}).pin) + '.read_analog()'; },
  };

  // ================================================================
  //  诊断工具
  // ================================================================

  /** 打印积木树结构 (方便调试) */
  function debugDump(blocks) {
    var lines = [];
    var allIds = Object.keys(blocks);
    var tops = allIds.filter(function (id) {
      var b = blocks[id];
      if (!b) return false;
      if (b.flowIn) return false;
      for (var i = 0; i < allIds.length; i++) {
        var other = blocks[allIds[i]];
        if (other && other.subBlocks) {
          for (var k in other.subBlocks) {
            if (other.subBlocks[k] === id) return false;
          }
        }
      }
      return true;
    });
    function dumpOne(id, depth) {
      var b = blocks[id];
      if (!b) { lines.push('  '.repeat(depth) + '??? ' + id); return; }
      var info = b.type + ' [' + id + ']';
      if (b.paramConnections && Object.keys(b.paramConnections).length > 0) {
        info += ' paramConn=' + JSON.stringify(b.paramConnections);
      }
      lines.push('  '.repeat(depth) + info);
      if (b.subBlocks) {
        for (var slot in b.subBlocks) {
          var subId = b.subBlocks[slot];
          lines.push('  '.repeat(depth + 1) + '└─' + slot + ':');
          var cur = subId;
          var vis = {};
          while (cur && !vis[cur]) {
            vis[cur] = true;
            dumpOne(cur, depth + 2);
            cur = blocks[cur] ? blocks[cur].flowOut : null;
          }
        }
      }
    }
    function dumpChain(id, depth) {
      var cur = id;
      var vis = {};
      while (cur && !vis[cur]) {
        vis[cur] = true;
        dumpOne(cur, depth);
        cur = blocks[cur] ? blocks[cur].flowOut : null;
      }
    }
    tops.forEach(function (id) { dumpChain(id, 0); });
    return lines.join('\n');
  }

  // ================================================================
  //  主编译入口
  // ================================================================

  function compile(blocks) {
    var code = 'from microbit import *\nimport music\nimport utime\nimport random\nimport math\n';
    code += 'try:\n import neopixel as _NP\nexcept:\n _NP=None\n\n';

    var funcs = [], starts = [], buttons = [], gestures = [];
    Object.values(blocks).forEach(function (b) {
      switch (b.type) {
        case 'func_define':   funcs.push(b); break;
        case 'event_start':
        case 'mb_on_start':   starts.push(b); break;
        case 'mb_on_button':  buttons.push(b); break;
        case 'mb_on_gesture': gestures.push(b); break;
      }
    });

    // 1. 函数定义
    funcs.forEach(function (fn) {
      var p = fn.params || {};
      var name = _pyName(p.name);
      var extras = fn._extraParams || [];
      var params = extras.map(function (ep) { return _pyName(ep.name); }).join(',');
      code += 'def ' + name + '(' + params + '):\n';
      var body = _parse(fn.flowOut, blocks, 1);
      code += _bodyOrPass(body, 1) + '\n';
    });

    // 2. 主程序
    starts.forEach(function (start) {
      var body = _parse(start.flowOut, blocks, 0);
      if (body.trim()) code += body + '\n';
    });

    // 3. 按钮事件
    buttons.forEach(function (btn) {
      var btnName = (btn.params || {}).btn || 'A';
      code += 'def on_button_' + btnName.toLowerCase() + '():\n';
      var body = _parse(btn.flowOut, blocks, 1);
      code += _bodyOrPass(body, 1) + '\n';
    });
    if (buttons.length > 0) {
      code += 'while True:\n';
      buttons.forEach(function (btn) {
        var btnName = (btn.params || {}).btn || 'A';
        code += ' if button_' + btnName.toLowerCase() + '.is_pressed():\n';
        code += '  on_button_' + btnName.toLowerCase() + '()\n';
      });
      code += ' sleep(50)\n\n';
    }

    // 4. 手势事件
    if (gestures.length > 0) {
      code += 'while True:\n';
      code += ' g = accelerometer.current_gesture()\n';
      gestures.forEach(function (ges) {
        var g = (ges.params || {}).gesture || 'shake';
        code += ' if g == \'' + g + '\':\n';
        var body = _parse(ges.flowOut, blocks, 2);
        code += _bodyOrPass(body, 2);
      });
      code += ' sleep(100)\n';
    }

    return code;
  }

  return { compile: compile, debug: debugDump, STMT_MAP: STMT_MAP, EXPR_MAP: EXPR_MAP };
})();
