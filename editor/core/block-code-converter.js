/**
 * BlockCodeConverter - 将积木转换为 JavaScript / Python 代码
 * 用于代码预览功能，帮助学习者理解积木背后的代码
 */
const BlockCodeConverter = (function () {
  let _indent = 0;
  let _lang = 'javascript'; // 'javascript' or 'python'
  let _varDeclarations = new Set();
  let _listDeclarations = new Set();

  function indent() { return '  '.repeat(_indent); }
  function pyIndent() { return '    '.repeat(_indent); }

  /** 获取参数值（解析 reporter 连接） */
  function getParamValue(block, paramName, blocks) {
    if (block.paramConnections && block.paramConnections[paramName]) {
      const reporterId = block.paramConnections[paramName];
      const reporter = blocks[reporterId];
      if (reporter) return convertReporter(reporter, blocks);
    }
    const def = typeof BlockRegistry !== 'undefined' ? BlockRegistry.getBlock(block.type) : null;
    const paramDef = def?.params?.find(p => p.name === paramName);
    const val = block.params?.[paramName];
    if (val === undefined || val === null || val === '') {
      return paramDef?.default ?? 0;
    }
    if (paramDef?.type === 'string') return `"${val}"`;
    return val;
  }

  /** 转换 reporter 积木为表达式 */
  function convertReporter(block, blocks) {
    const type = block.type;
    const p = (name) => getParamValue(block, name, blocks);

    switch (type) {
      // 运算
      case 'op_add': return `(${p('a')} + ${p('b')})`;
      case 'op_sub': return `(${p('a')} - ${p('b')})`;
      case 'op_mul': return `(${p('a')} * ${p('b')})`;
      case 'op_div': return `(${p('a')} / ${p('b')})`;
      case 'op_mod': return `(${p('a')} % ${p('b')})`;
      case 'op_random': return _lang === 'python' ? `random.randint(${p('min')}, ${p('max')})` : `(Math.floor(Math.random() * (${p('max')} - ${p('min')} + 1)) + ${p('min')})`;
      case 'op_gt': return `(${p('a')} > ${p('b')})`;
      case 'op_lt': return `(${p('a')} < ${p('b')})`;
      case 'op_eq': return `(${p('a')} == ${p('b')})`;
      case 'op_and': return `(${p('a')} && ${p('b')})`;
      case 'op_or': return `(${p('a')} || ${p('b')})`;
      case 'op_not': return `(!${p('a')})`;
      case 'op_join': return _lang === 'python' ? `str(${p('a')}) + str(${p('b')})` : `String(${p('a')}) + String(${p('b')})`;
      case 'op_length': return _lang === 'python' ? `len(${p('str')})` : `String(${p('str')}).length`;
      case 'op_contains': return _lang === 'python' ? `(${p('str')} in ${p('sub')})` : `String(${p('str')}).includes(${p('sub')})`;
      case 'op_letter_of': return _lang === 'python' ? `${p('str')}[${p('index')}]` : `String(${p('str')})[${p('index')}]`;
      case 'op_math': {
        const fn = block.params?.fn || 'abs';
        const arg = p('n');
        const pyMap = { abs: 'abs', floor: 'math.floor', ceil: 'math.ceil', round: 'round', sqrt: 'math.sqrt', sin: 'math.sin', cos: 'math.cos', tan: 'math.tan', log: 'math.log' };
        const jsMap = { abs: 'Math.abs', floor: 'Math.floor', ceil: 'Math.ceil', round: 'Math.round', sqrt: 'Math.sqrt', sin: 'Math.sin', cos: 'Math.cos', tan: 'Math.tan', log: 'Math.log' };
        return _lang === 'python' ? `${pyMap[fn] || fn}(${arg})` : `${jsMap[fn] || fn}(${arg})`;
      }
      // 侦测
      case 'sensing_mouse_x': return _lang === 'python' ? 'mouse_x' : 'SensingInput.getMouseX()';
      case 'sensing_mouse_y': return _lang === 'python' ? 'mouse_y' : 'SensingInput.getMouseY()';
      case 'sensing_key_pressed': return _lang === 'python' ? `key_pressed("${block.params?.key}")` : `SensingInput.isKeyPressed("${block.params?.key}")`;
      case 'sensing_touching_edge': return _lang === 'python' ? 'touching_edge()' : 'StageManager.isTouchingEdge(StageManager.getActiveSpriteIdx())';
      case 'sensing_distance_to': return _lang === 'python' ? `distance_to("${block.params?.sprite}")` : `StageManager.distanceToSprite(StageManager.getActiveSpriteIdx(), "${block.params?.sprite}")`;
      case 'sensing_ask': return _lang === 'python' ? `input(${p('question')})` : `prompt(${p('question')})`;
      case 'sensing_answer': return _lang === 'python' ? 'answer' : 'Executor.getAnswer()';
      // 外观 reporter
      case 'looks_size': return _lang === 'python' ? 'sprite.size' : 'StageManager.getActiveSprite().size';
      case 'looks_costume_name': return _lang === 'python' ? 'sprite.costume_name' : 'StageManager.getActiveSprite().costumeName';
      // 运动 reporter
      case 'motion_x': return _lang === 'python' ? 'sprite.x' : 'StageManager.getActiveSprite().x';
      case 'motion_y': return _lang === 'python' ? 'sprite.y' : 'StageManager.getActiveSprite().y';
      case 'motion_direction': return _lang === 'python' ? 'sprite.direction' : 'StageManager.getActiveSprite().direction';
      // 变量
      case 'var_reporter': return block.params?.name || 'var';
      // 列表
      case 'list_reporter': return _lang === 'python' ? `str(${block.params?.name || 'list'})` : `JSON.stringify(${block.params?.name || 'list'})`;
      case 'list_item': return _lang === 'python' ? `${block.params?.name}[${p('index')}]` : `${block.params?.name}[${p('index')}]`;
      case 'list_length': return _lang === 'python' ? `len(${block.params?.name})` : `${block.params?.name}.length`;
      case 'list_contains': return _lang === 'python' ? `(${p('value')} in ${block.params?.name})` : `${block.params?.name}.includes(${p('value')})`;
      default: return block.params?.value || '0';
    }
  }

  /** 转换单个积木为代码行 */
  function convertBlock(block, blocks) {
    const type = block.type;
    const p = (name) => getParamValue(block, name, blocks);
    const lines = [];

    // 跳过事件入口（生成注释）
    if (type === 'event_start') {
      lines.push(_lang === 'python' ? '# 当绿旗被点击' : '// 当绿旗被点击');
      return lines;
    }
    if (type === 'event_key_pressed') {
      lines.push(_lang === 'python' ? `# 当按下 ${block.params?.key || 'space'} 键` : `// 当按下 ${block.params?.key || 'space'} 键`);
      return lines;
    }
    if (type === 'event_broadcast') {
      lines.push(_lang === 'python' ? `broadcast(${p('msg')})` : `broadcast(${p('msg')});`);
      return lines;
    }
    if (type === 'event_receive') {
      lines.push(_lang === 'python' ? `# 当接收到消息 ${block.params?.msg}` : `// 当接收到消息 ${block.params?.msg}`);
      return lines;
    }

    // ===== 运动 =====
    if (type === 'move_steps') lines.push(I(`StageManager.moveSprite(idx, ${p('steps')});`, `sprite.move(${p('steps')})`));
    else if (type === 'turn_right') lines.push(I(`StageManager.rotateSprite(idx, ${p('deg')});`, `sprite.turn(${p('deg')})`));
    else if (type === 'turn_left') lines.push(I(`StageManager.rotateSprite(idx, -${p('deg')});`, `sprite.turn(-${p('deg')})`));
    else if (type === 'go_to_xy') lines.push(I(`StageManager.setSpritePos(idx, ${p('x')}, ${p('y')});`, `sprite.goto(${p('x')}, ${p('y')})`));
    else if (type === 'go_to_random') lines.push(I(`StageManager.setSpritePos(idx, Math.random() * 480 - 240, Math.random() * 360 - 180);`, `sprite.goto(random.uniform(-240,240), random.uniform(-180,180))`));
    else if (type === 'change_x') lines.push(I(`sprite.x += ${p('dx')};`, `sprite.x += ${p('dx')}`));
    else if (type === 'set_x') lines.push(I(`sprite.x = ${p('x')};`, `sprite.x = ${p('x')}`));
    else if (type === 'change_y') lines.push(I(`sprite.y += ${p('dy')};`, `sprite.y += ${p('dy')}`));
    else if (type === 'set_y') lines.push(I(`sprite.y = ${p('y')};`, `sprite.y = ${p('y')}`));
    else if (type === 'point_direction') lines.push(I(`sprite.direction = ${p('dir')};`, `sprite.direction = ${p('dir')}`));
    else if (type === 'bounce_edge') lines.push(I(`StageManager.bounceSprite(idx);`, `sprite.bounce_edge()`));

    // ===== 外观 =====
    else if (type === 'looks_say') lines.push(I(`StageManager.setSpriteSay(idx, ${p('text')});`, `sprite.say(${p('text')})`));
    else if (type === 'looks_say_for') lines.push(I(`StageManager.setSpriteSay(idx, ${p('text')});`, `sprite.say(${p('text')})`), I(`await delay(${p('sec')} * 1000);`, `time.sleep(${p('sec')})`), I(`StageManager.setSpriteSay(idx, "");`, `sprite.say("")`));
    else if (type === 'looks_show') lines.push(I(`sprite.visible = true;`, `sprite.show()`));
    else if (type === 'looks_hide') lines.push(I(`sprite.visible = false;`, `sprite.hide()`));
    else if (type === 'looks_set_size') lines.push(I(`StageManager.setSpriteSize(idx, ${p('size')});`, `sprite.size = ${p('size')}`));
    else if (type === 'looks_change_size') lines.push(I(`sprite.size += ${p('delta')};`, `sprite.size += ${p('delta')}`));

    // ===== 控制 =====
    else if (type === 'control_wait') lines.push(I(`await delay(${p('sec')} * 1000);`, `time.sleep(${p('sec')})`));
    else if (type === 'control_repeat') {
      const n = p('times');
      if (_lang === 'python') {
        lines.push(`${pyIndent()}for _i in range(int(${n})):`, '');
      } else {
        lines.push(`${indent()}for (let _i = 0; _i < ${n}; _i++) {`, '');
      }
      // 子积木会在外部处理
      lines.push('__SUB_BLOCKS__:body');
      lines.push(_lang === 'python' ? '' : `${indent()}}`);
    }
    else if (type === 'control_forever') {
      if (_lang === 'python') {
        lines.push(`${pyIndent()}while True:`);
      } else {
        lines.push(`${indent()}while (true) {`);
      }
      lines.push('__SUB_BLOCKS__:body');
      lines.push(_lang === 'python' ? '' : `${indent()}}`);
    }
    else if (type === 'control_if_then') {
      const cond = p('cond');
      if (_lang === 'python') {
        lines.push(`${pyIndent()}if ${cond}:`);
      } else {
        lines.push(`${indent()}if (${cond}) {`);
      }
      lines.push('__SUB_BLOCKS__:body');
      lines.push(_lang === 'python' ? '' : `${indent()}}`);
    }
    else if (type === 'if_then') {
      const cond = p('cond');
      if (_lang === 'python') {
        lines.push(`${pyIndent()}if ${cond}:`);
      } else {
        lines.push(`${indent()}if (${cond}) {`);
      }
      lines.push('__SUB_BLOCKS__:body');
      lines.push(_lang === 'python' ? '' : `${indent()}}`);
    }
    else if (type === 'if_else') {
      const cond = p('cond');
      if (_lang === 'python') {
        lines.push(`${pyIndent()}if ${cond}:`);
      } else {
        lines.push(`${indent()}if (${cond}) {`);
      }
      lines.push('__SUB_BLOCKS__:then');
      if (_lang === 'python') {
        lines.push(`${pyIndent()}else:`);
      } else {
        lines.push(`${indent()}} else {`);
      }
      lines.push('__SUB_BLOCKS__:else');
      lines.push(_lang === 'python' ? '' : `${indent()}}`);
    }
    else if (type === 'control_if_else') {
      const cond = p('cond');
      if (_lang === 'python') {
        lines.push(`${pyIndent()}if ${cond}:`);
      } else {
        lines.push(`${indent()}if (${cond}) {`);
      }
      lines.push('__SUB_BLOCKS__:then');
      if (_lang === 'python') {
        lines.push(`${pyIndent()}else:`);
      } else {
        lines.push(`${indent()}} else {`);
      }
      lines.push('__SUB_BLOCKS__:else');
      lines.push(_lang === 'python' ? '' : `${indent()}}`);
    }
    else if (type === 'repeat_until') {
      const cond = p('cond');
      if (_lang === 'python') {
        lines.push(`${pyIndent()}while not (${cond}):`);
      } else {
        lines.push(`${indent()}while (!(${cond})) {`);
      }
      lines.push('__SUB_BLOCKS__:body');
      lines.push(_lang === 'python' ? '' : `${indent()}}`);
    }
    else if (type === 'control_stop') lines.push(I(`return '__STOP__';`, `return`));
    else if (type === 'stop_all') lines.push(I(`return '__STOP__';`, `return`));

    // ===== 变量 =====
    else if (type === 'var_set') {
      const name = block.params?.name || 'myVar';
      _varDeclarations.add(name);
      lines.push(I(`${name} = ${p('value')};`, `${name} = ${p('value')}`));
    }
    else if (type === 'var_change') {
      const name = block.params?.name || 'myVar';
      _varDeclarations.add(name);
      lines.push(I(`${name} += ${p('delta')};`, `${name} += ${p('delta')}`));
    }

    // ===== 列表 =====
    else if (type === 'list_add') {
      const name = block.params?.name || 'myList';
      _listDeclarations.add(name);
      lines.push(I(`${name}.push(${p('value')});`, `${name}.append(${p('value')})`));
    }
    else if (type === 'list_delete') {
      const name = block.params?.name || 'myList';
      lines.push(I(`${name}.splice(${p('index')}, 1);`, `del ${name}[${p('index')}]`));
    }
    else if (type === 'list_insert') {
      const name = block.params?.name || 'myList';
      lines.push(I(`${name}.splice(${p('index')}, 0, ${p('value')});`, `${name}.insert(${p('index')}, ${p('value')})`));
    }

    // ===== 声音 =====
    else if (type === 'sound_play') lines.push(I(`SoundManager.play(${p('name')});`, `sound.play(${p('name')})`));
    else if (type === 'sound_stop') lines.push(I(`SoundManager.stop(${p('name')});`, `sound.stop(${p('name')})`));

    // ===== 输出 =====
    else if (type === 'io_print') lines.push(I(`log(${p('msg')});`, `print(${p('msg')})`));

    // ===== 函数 =====
    else if (type === 'func_call') lines.push(I(`${block.params?.name || 'myFunc'}();`, `${block.params?.name || 'myFunc'}()`));
    else if (type === 'func_define') {
      if (_lang === 'python') {
        lines.push(`def ${block.params?.name || 'myFunc'}():`);
      } else {
        lines.push(`function ${block.params?.name || 'myFunc'}() {`);
      }
      lines.push('__SUB_BLOCKS__:body');
      lines.push(_lang === 'python' ? '' : `}`);
      lines.push('');
    }

    // ===== 广播 =====
    else if (type === 'event_broadcast') lines.push(I(`broadcast(${p('msg')});`, `broadcast(${p('msg')})`));

    // 默认
    else lines.push(I(`// ${type}(${JSON.stringify(block.params || {})})`, `# ${type}(${JSON.stringify(block.params || {})})`));

    return lines;
  }

  function I(jsLine, pyLine) {
    return _lang === 'python' ? pyIndent() + pyLine : indent() + jsLine;
  }

  /** 转换子积木 */
  function convertSubBlocks(block, blocks, slotName) {
    const subId = block.subBlocks?.[slotName];
    if (!subId) return [];
    const lines = [];
    let cur = blocks[subId];
    while (cur) {
      const blockLines = convertBlock(cur, blocks);
      // 处理子积木占位符
      for (const line of blockLines) {
        if (line.startsWith('__SUB_BLOCKS__:')) {
          const slot = line.split(':')[1];
          _indent++;
          const subLines = convertSubBlocks(cur, blocks, slot);
          lines.push(...subLines);
          _indent--;
        } else {
          lines.push(line);
        }
      }
      cur = cur.flowOut ? blocks[cur.flowOut] : null;
    }
    return lines;
  }

  /** 转换整个项目为代码 */
  function convertProject(blocks, lang) {
    _lang = lang || 'javascript';
    _indent = 0;
    _varDeclarations = new Set();
    _listDeclarations = new Set();

    // 找到所有顶级积木（无 flowIn 的帽子积木）
    const topBlocks = Object.values(blocks).filter(b => !b.flowIn && !isSubBlock(b.id, blocks));
    const allLines = [];

    // 头部
    if (_lang === 'python') {
      allLines.push('# Objector 积木程序 (Python)');
      allLines.push('# 自动生成自 Objector 图形化编辑器');
      allLines.push('');
      allLines.push('import random, math, time');
      allLines.push('');
    } else {
      allLines.push('// Objector 积木程序 (JavaScript)');
      allLines.push('// 自动生成自 Objector 图形化编辑器');
      allLines.push('');
    }

    // 先收集函数定义
    const funcBlocks = topBlocks.filter(b => b.type === 'func_define');
    for (const fb of funcBlocks) {
      const lines = convertBlock(fb, blocks);
      for (const line of lines) {
        if (line.startsWith('__SUB_BLOCKS__:')) {
          const slot = line.split(':')[1];
          _indent++;
          const subLines = convertSubBlocks(fb, blocks, slot);
          allLines.push(...subLines);
          _indent--;
        } else {
          allLines.push(line);
        }
      }
    }

    // 然后转换非函数积木
    const mainBlocks = topBlocks.filter(b => b.type !== 'func_define');
    for (const tb of mainBlocks) {
      const lines = convertBlock(tb, blocks);
      for (const line of lines) {
        if (line.startsWith('__SUB_BLOCKS__:')) {
          const slot = line.split(':')[1];
          _indent++;
          const subLines = convertSubBlocks(tb, blocks, slot);
          allLines.push(...subLines);
          _indent--;
        } else {
          allLines.push(line);
        }
      }
    }

    // 添加变量声明（插入到头部后面）
    if (_varDeclarations.size > 0 || _listDeclarations.size > 0) {
      const declLines = [];
      for (const v of _varDeclarations) {
        declLines.push(_lang === 'python' ? `${v} = 0` : `let ${v} = 0;`);
      }
      for (const l of _listDeclarations) {
        declLines.push(_lang === 'python' ? `${l} = []` : `let ${l} = [];`);
      }
      const insertIdx = _lang === 'python' ? 4 : 3;
      allLines.splice(insertIdx, 0, '', ...declLines, '');
    }

    return allLines.join('\n');
  }

  /** 判断是否为子积木 */
  function isSubBlock(blockId, blocks) {
    for (const b of Object.values(blocks)) {
      if (b.subBlocks) {
        for (const subId of Object.values(b.subBlocks)) {
          if (subId === blockId) return true;
        }
      }
    }
    return false;
  }

  return { convertProject, convertBlock, convertReporter };
})();
