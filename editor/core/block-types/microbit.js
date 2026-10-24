/**
 * micro:bit 积木 - 实时控制 + 上传模式
 * 颜色: #00B06F (micro:bit 绿)
 */
(function () {
  const C = '#00B06F';
  const PINS = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'P11', 'P12', 'P13', 'P14', 'P15', 'P16', 'P19', 'P20'];

  BlockRegistry.registerCategory('microbit', 'micro:bit', C);

  // ===== LED 矩阵 =====
  BlockRegistry.register({
    type: 'mb_led_on', category: 'microbit', color: C,
    label: '🔲 显示 ❤ 图案', shape: 'stack',
    ports: { flowIn: true, flowOut: true }, params: [],
  });
  BlockRegistry.register({
    type: 'mb_led_off', category: 'microbit', color: C,
    label: '🔲 清屏', shape: 'stack',
    ports: { flowIn: true, flowOut: true }, params: [],
  });
  BlockRegistry.register({
    type: 'mb_led_pattern', category: 'microbit', color: C,
    label: '🔲 显示图案 {pattern}', shape: 'stack',
    ports: { flowIn: true, flowOut: true },
    params: [{ name: 'pattern', type: 'string', default: '0999090909999990909909090' }],
  });
  BlockRegistry.register({
    type: 'mb_led_pixel', category: 'microbit', color: C,
    label: '🔲 设置像素 x:{x} y:{y} 亮度:{b}', shape: 'stack',
    ports: { flowIn: true, flowOut: true },
    params: [
      { name: 'x', type: 'number', default: 0 },
      { name: 'y', type: 'number', default: 0 },
      { name: 'b', type: 'number', default: 9 },
    ],
  });
  BlockRegistry.separator('microbit');

  // ===== 文字显示 =====
  BlockRegistry.register({
    type: 'mb_text', category: 'microbit', color: C,
    label: '🔤 滚动显示 {text}', shape: 'stack',
    ports: { flowIn: true, flowOut: true },
    params: [{ name: 'text', type: 'string', default: 'Hello' }],
  });
  BlockRegistry.register({
    type: 'mb_show', category: 'microbit', color: C,
    label: '🔤 显示字符 {char}', shape: 'stack',
    ports: { flowIn: true, flowOut: true },
    params: [{ name: 'char', type: 'string', default: 'A' }],
  });
  BlockRegistry.separator('microbit');

  // ===== 蜂鸣器 =====
  BlockRegistry.register({
    type: 'mb_buzz', category: 'microbit', color: C,
    label: '🔊 蜂鸣器 {freq}Hz 持续 {dur}ms', shape: 'stack',
    ports: { flowIn: true, flowOut: true },
    params: [
      { name: 'freq', type: 'number', default: 440 },
      { name: 'dur', type: 'number', default: 500 },
    ],
  });
  BlockRegistry.register({
    type: 'mb_buzz_off', category: 'microbit', color: C,
    label: '🔇 关闭蜂鸣器', shape: 'stack',
    ports: { flowIn: true, flowOut: true }, params: [],
  });
  BlockRegistry.separator('microbit');

  // ===== 舵机 =====
  BlockRegistry.register({
    type: 'mb_servo', category: 'microbit', color: C,
    label: '⚙ 舵机 {pin} 转到 {angle}°', shape: 'stack',
    ports: { flowIn: true, flowOut: true },
    params: [
      { name: 'pin', type: 'dropdown', default: 'P0', options: PINS },
      { name: 'angle', type: 'number', default: 90 },
    ],
  });
  BlockRegistry.register({
    type: 'mb_servo_off', category: 'microbit', color: C,
    label: '⚙ 释放舵机 {pin}', shape: 'stack',
    ports: { flowIn: true, flowOut: true },
    params: [{ name: 'pin', type: 'dropdown', default: 'P0', options: PINS }],
  });
  BlockRegistry.separator('microbit');

  // ===== 电机 =====
  BlockRegistry.register({
    type: 'mb_motor', category: 'microbit', color: C,
    label: '🔄 电机 {which} 速度 {speed}', shape: 'stack',
    ports: { flowIn: true, flowOut: true },
    params: [
      { name: 'which', type: 'dropdown', default: 'A', options: ['A', 'B', 'ALL'] },
      { name: 'speed', type: 'number', default: 80 },
    ],
  });
  BlockRegistry.register({
    type: 'mb_motor_brake', category: 'microbit', color: C,
    label: '🛑 电机刹车', shape: 'stack',
    ports: { flowIn: true, flowOut: true }, params: [],
  });
  BlockRegistry.separator('microbit');

  // ===== NeoPixel RGB =====
  BlockRegistry.register({
    type: 'mb_rgb_init', category: 'microbit', color: C,
    label: '💡 初始化 RGB 灯 {pin} {count} 颗', shape: 'stack',
    ports: { flowIn: true, flowOut: true },
    params: [
      { name: 'pin', type: 'dropdown', default: 'P16', options: PINS },
      { name: 'count', type: 'number', default: 8 },
    ],
  });
  BlockRegistry.register({
    type: 'mb_rgb', category: 'microbit', color: C,
    label: '💡 RGB 全部 R:{r} G:{g} B:{b}', shape: 'stack',
    ports: { flowIn: true, flowOut: true },
    params: [
      { name: 'r', type: 'number', default: 255 },
      { name: 'g', type: 'number', default: 0 },
      { name: 'b', type: 'number', default: 0 },
    ],
  });
  BlockRegistry.register({
    type: 'mb_rgb_one', category: 'microbit', color: C,
    label: '💡 RGB 第 {idx} 颗 R:{r} G:{g} B:{b}', shape: 'stack',
    ports: { flowIn: true, flowOut: true },
    params: [
      { name: 'idx', type: 'number', default: 0 },
      { name: 'r', type: 'number', default: 0 },
      { name: 'g', type: 'number', default: 255 },
      { name: 'b', type: 'number', default: 0 },
    ],
  });
  BlockRegistry.register({
    type: 'mb_rgb_off', category: 'microbit', color: C,
    label: '💡 RGB 全部熄灭', shape: 'stack',
    ports: { flowIn: true, flowOut: true }, params: [],
  });
  BlockRegistry.separator('microbit');

  // ===== GPIO =====
  BlockRegistry.register({
    type: 'mb_pin_write', category: 'microbit', color: C,
    label: '📌 引脚 {pin} 写 {val}', shape: 'stack',
    ports: { flowIn: true, flowOut: true },
    params: [
      { name: 'pin', type: 'dropdown', default: 'P0', options: PINS },
      { name: 'val', type: 'number', default: 1 },
    ],
  });
  BlockRegistry.register({
    type: 'mb_pin_read', category: 'microbit', color: C,
    label: '📌 引脚 {pin} 模拟读取', shape: 'reporter',
    ports: { flowIn: false, flowOut: false },
    params: [{ name: 'pin', type: 'dropdown', default: 'P0', options: PINS }],
  });
  BlockRegistry.separator('microbit');

  // ===== 传感器 (reporter) =====
  BlockRegistry.register({
    type: 'mb_temp', category: 'microbit', color: C,
    label: '🌡 温度 (°C)', shape: 'reporter',
    ports: { flowIn: false, flowOut: false }, params: [],
  });
  BlockRegistry.register({
    type: 'mb_light', category: 'microbit', color: C,
    label: '☀ 光线强度', shape: 'reporter',
    ports: { flowIn: false, flowOut: false }, params: [],
  });
  BlockRegistry.register({
    type: 'mb_acc_x', category: 'microbit', color: C,
    label: '📐 加速度 X', shape: 'reporter',
    ports: { flowIn: false, flowOut: false }, params: [],
  });
  BlockRegistry.register({
    type: 'mb_acc_y', category: 'microbit', color: C,
    label: '📐 加速度 Y', shape: 'reporter',
    ports: { flowIn: false, flowOut: false }, params: [],
  });
  BlockRegistry.register({
    type: 'mb_acc_z', category: 'microbit', color: C,
    label: '📐 加速度 Z', shape: 'reporter',
    ports: { flowIn: false, flowOut: false }, params: [],
  });
  BlockRegistry.register({
    type: 'mb_gesture', category: 'microbit', color: C,
    label: '🤸 当前手势', shape: 'reporter',
    ports: { flowIn: false, flowOut: false }, params: [],
  });
  BlockRegistry.register({
    type: 'mb_sound', category: 'microbit', color: C,
    label: '🎤 声音强度 (V2)', shape: 'reporter',
    ports: { flowIn: false, flowOut: false }, params: [],
  });
  BlockRegistry.separator('microbit');

  // ===== 传感器 (boolean) =====
  BlockRegistry.register({
    type: 'mb_button', category: 'microbit', color: C,
    label: '🔘 按钮 {btn} 按下?', shape: 'boolean',
    ports: { flowIn: false, flowOut: false },
    params: [{ name: 'btn', type: 'dropdown', default: 'A', options: ['A', 'B'] }],
  });
  BlockRegistry.separator('microbit');

  // ===== 上传模式独有: 事件 =====
  BlockRegistry.register({
    type: 'mb_on_start', category: 'microbit', color: C,
    label: '🚀 当程序启动时', shape: 'hat',
    ports: { flowIn: false, flowOut: true },
    params: [],
  });
  BlockRegistry.register({
    type: 'mb_on_button', category: 'microbit', color: C,
    label: '🔘 当按钮 {btn} 按下时', shape: 'hat',
    ports: { flowIn: false, flowOut: true },
    params: [{ name: 'btn', type: 'dropdown', default: 'A', options: ['A', 'B'] }],
  });
  BlockRegistry.register({
    type: 'mb_on_gesture', category: 'microbit', color: C,
    label: '🤸 当手势为 {gesture} 时', shape: 'hat',
    ports: { flowIn: false, flowOut: true },
    params: [{ name: 'gesture', type: 'dropdown', default: 'shake', options: ['shake', 'up', 'down', 'left', 'right', 'face up', 'face down'] }],
  });
  BlockRegistry.register({
    type: 'mb_wait', category: 'microbit', color: C,
    label: '⏱ 等待 {ms} 毫秒', shape: 'stack',
    ports: { flowIn: true, flowOut: true },
    params: [{ name: 'ms', type: 'number', default: 1000 }],
  });
})();
