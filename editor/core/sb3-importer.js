/**
 * Scratch 项目导入器 - 将 .sb3 文件转换为 Objector 项目
 * 支持 .sb3 (Scratch 3.0) 格式
 */
const SB3Importer = (function () {

  /** Scratch opcode → Objector block type 映射 */
  const OPCODE_MAP = {
    // ===== 事件 =====
    'event_whenflagclicked':          { type: 'event_flag' },
    'event_whenkeypressed':           { type: 'event_key', fields: { KEY_OPTION: 'key' } },
    'event_whenthisspriteclicked':    { type: 'event_clicked' },
    'event_whenbackdropswitchesto':   { type: 'event_backdrop' },
    'event_whenbroadcastreceived':    { type: 'event_receive', fields: { BROADCAST_OPTION: 'message' } },
    'event_broadcast':                { type: 'event_broadcast' },
    'event_broadcastandwait':         { type: 'event_broadcast_wait' },
    'event_whengreaterthan':          { type: 'event_greater_than', fields: { WHENGREATERTHANMENU: 'sensor' } },

    // ===== 运动 =====
    'motion_movesteps':               { type: 'move_steps', inputs: { STEPS: 'steps' } },
    'motion_turnright':               { type: 'turn_right', inputs: { DEGREES: 'degrees' } },
    'motion_turnleft':                { type: 'turn_left', inputs: { DEGREES: 'degrees' } },
    'motion_pointindirection':        { type: 'point_direction', inputs: { DIRECTION: 'direction' } },
    'motion_gotoxy':                  { type: 'goto_xy', inputs: { X: 'x', Y: 'y' } },
    'motion_changexby':              { type: 'change_x', inputs: { DX: 'dx' } },
    'motion_changeyby':              { type: 'change_y', inputs: { DY: 'dy' } },
    'motion_setx':                   { type: 'set_x', inputs: { X: 'x' } },
    'motion_sety':                   { type: 'set_y', inputs: { Y: 'y' } },
    'motion_glidesecstoxy':          { type: 'glide_to', inputs: { SECS: 'secs', X: 'x', Y: 'y' } },
    'motion_ifonedgebounce':         { type: 'bounce_edge' },

    // ===== 外观 =====
    'looks_say':                      { type: 'looks_say', inputs: { MESSAGE: 'text' } },
    'looks_sayforsecs':               { type: 'looks_say_for', inputs: { MESSAGE: 'text', SECS: 'secs' } },
    'looks_think':                    { type: 'looks_think', inputs: { MESSAGE: 'text' } },
    'looks_thinkforsecs':             { type: 'looks_think_for', inputs: { MESSAGE: 'text', SECS: 'secs' } },
    'looks_show':                     { type: 'looks_show' },
    'looks_hide':                     { type: 'looks_hide' },
    'looks_switchcostumeto':          { type: 'looks_switch_costume' },
    'looks_nextcostume':              { type: 'looks_next_costume' },
    'looks_setsizeto':                { type: 'looks_set_size', inputs: { SIZE: 'size' } },
    'looks_changesizeby':             { type: 'looks_change_size', inputs: { CHANGE: 'change' } },
    'looks_changeeffectby':           { type: 'looks_change_effect' },
    'looks_seteffectto':              { type: 'looks_set_effect' },
    'looks_cleargraphiceffects':      { type: 'looks_clear_effects' },
    'looks_gotofrontback':            { type: 'looks_goto_front_back' },
    'looks_goforwardbackwardlayers':  { type: 'looks_change_layer' },

    // ===== 控制 =====
    'control_wait':                   { type: 'control_wait', inputs: { DURATION: 'secs' } },
    'control_repeat':                 { type: 'control_repeat', inputs: { TIMES: 'times' } },
    'control_forever':                { type: 'control_forever' },
    'control_if':                     { type: 'control_if' },
    'control_if_else':                { type: 'control_if_else' },
    'control_stop':                   { type: 'control_stop' },
    'control_wait_until':             { type: 'control_wait_until' },
    'control_repeat_until':           { type: 'control_repeat_until' },
    'control_create_clone_of':        { type: 'control_create_clone' },
    'control_start_as_clone':         { type: 'control_start_clone' },
    'control_delete_this_clone':      { type: 'control_delete_clone' },

    // ===== 运算 =====
    'operator_add':                   { type: 'op_add', inputs: { NUM1: 'a', NUM2: 'b' } },
    'operator_subtract':              { type: 'op_subtract', inputs: { NUM1: 'a', NUM2: 'b' } },
    'operator_multiply':              { type: 'op_multiply', inputs: { NUM1: 'a', NUM2: 'b' } },
    'operator_divide':                { type: 'op_divide', inputs: { NUM1: 'a', NUM2: 'b' } },
    'operator_random':                { type: 'op_random', inputs: { FROM: 'a', TO: 'b' } },
    'operator_lt':                    { type: 'op_lt', inputs: { OPERAND1: 'a', OPERAND2: 'b' } },
    'operator_equals':                { type: 'op_equals', inputs: { OPERAND1: 'a', OPERAND2: 'b' } },
    'operator_gt':                    { type: 'op_gt', inputs: { OPERAND1: 'a', OPERAND2: 'b' } },
    'operator_and':                   { type: 'op_and' },
    'operator_or':                    { type: 'op_or' },
    'operator_not':                   { type: 'op_not' },
    'operator_mod':                   { type: 'op_mod', inputs: { NUM1: 'a', NUM2: 'b' } },
    'operator_round':                 { type: 'op_round', inputs: { NUM: 'num' } },
    'operator_mathop':                { type: 'op_math' },
    'operator_join':                  { type: 'op_join', inputs: { STRING1: 'a', STRING2: 'b' } },
    'operator_letter_of_string':      { type: 'op_letter', inputs: { LETTER: 'index', STRING: 'str' } },
    'operator_length':                { type: 'op_length', inputs: { STRING: 'str' } },
    'operator_contains':              { type: 'op_contains', inputs: { STRING1: 'str', STRING2: 'sub' } },

    // ===== 传感 =====
    'sensing_touchingobject':         { type: 'sensing_touching' },
    'sensing_touchingcolor':          { type: 'sensing_touching_color' },
    'sensing_distanceto':             { type: 'sensing_distance' },
    'sensing_askandwait':             { type: 'sensing_ask', inputs: { QUESTION: 'question' } },
    'sensing_answer':                 { type: 'sensing_answer' },
    'sensing_keypressed':             { type: 'sensing_key_pressed' },
    'sensing_mousedown':              { type: 'sensing_mouse_down' },
    'sensing_mousex':                 { type: 'sensing_mouse_x' },
    'sensing_mousey':                 { type: 'sensing_mouse_y' },
    'sensing_timer':                  { type: 'sensing_timer' },
    'sensing_resettimer':             { type: 'sensing_reset_timer' },
    'sensing_loudness':               { type: 'sensing_loudness' },
    'sensing_dayssince2000':          { type: 'sensing_days_since_2000' },
    'sensing_current':                { type: 'sensing_current' },

    // ===== 声音 =====
    'sound_play':                     { type: 'sound_play' },
    'sound_playuntildone':            { type: 'sound_play_until_done' },
    'sound_stopallsounds':            { type: 'sound_stop_all' },
    'sound_changevolumeby':           { type: 'sound_change_volume', inputs: { VOLUME: 'change' } },
    'sound_setvolumeto':              { type: 'sound_set_volume', inputs: { VOLUME: 'volume' } },

    // ===== 变量 =====
    'data_setvariableto':             { type: 'var_set', fields: { VARIABLE: 'name' }, inputs: { VALUE: 'value' } },
    'data_changevariableby':          { type: 'var_change', fields: { VARIABLE: 'name' }, inputs: { VALUE: 'change' } },
    'data_showvariable':              { type: 'var_show', fields: { VARIABLE: 'name' } },
    'data_hidevariable':              { type: 'var_hide', fields: { VARIABLE: 'name' } },

    // ===== 列表 =====
    'data_addtolist':                 { type: 'list_add', fields: { LIST: 'name' }, inputs: { ITEM: 'value' } },
    'data_deleteoflist':              { type: 'list_delete', fields: { LIST: 'name' } },
    'data_deletealloflist':           { type: 'list_delete_all', fields: { LIST: 'name' } },
    'data_insertatlist':             { type: 'list_insert', fields: { LIST: 'name' } },
    'data_replaceitemoflist':         { type: 'list_replace', fields: { LIST: 'name' } },
    'data_lengthoflist':             { type: 'list_length', fields: { LIST: 'name' } },
    'data_listcontainsitem':         { type: 'list_contains', fields: { LIST: 'name' } },
  };

  /** 解析 .sb3 文件（ZIP 格式） */
  async function parseSB3(file) {
    if (typeof JSZip === 'undefined') {
      throw new Error('JSZip 库未加载');
    }
    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const projectJson = await zip.file('project.json')?.async('text');
    if (!projectJson) throw new Error('无效的 sb3 文件：缺少 project.json');
    return JSON.parse(projectJson);
  }

  /** 将 Scratch 项目转换为 Objector 项目 */
  function convertProject(sb3Project) {
    const targets = sb3Project.targets || [];
    const allBlocks = {};
    let blockCounter = 0;
    const spriteNames = [];

    targets.forEach((target, targetIdx) => {
      if (target.blocks && Object.keys(target.blocks).length > 0) {
        const prefix = target.isStage ? 'stage' : 'sprite' + targetIdx;
        spriteNames.push(target.name);
        const blocks = _convertTargetBlocks(target.blocks, prefix, blockCounter);
        Object.assign(allBlocks, blocks);
        blockCounter += Object.keys(blocks).length;
      }
    });

    // 提取变量信息
    const variables = {};
    targets.forEach(target => {
      if (target.variables) {
        Object.values(target.variables).forEach(([name, val]) => {
          variables[name] = val;
        });
      }
    });

    return {
      name: sb3Project.meta?.platform?.name || 'Imported Scratch Project',
      blocks: allBlocks,
      variables,
      spriteNames,
    };
  }

  /** 转换单个角色的积木 */
  function _convertTargetBlocks(sb3Blocks, prefix, startIdx) {
    const result = {};
    const idMap = {}; // sb3 id -> objector id

    // 只处理非 shadow 的顶级积木及其链
    Object.entries(sb3Blocks).forEach(([sb3Id, sb3Block]) => {
      if (typeof sb3Block === 'object' && !sb3Block.shadow) {
        const objId = prefix + '_' + sb3Id.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 12);
        idMap[sb3Id] = objId;
      }
    });

    // 创建积木对象
    Object.entries(sb3Blocks).forEach(([sb3Id, sb3Block]) => {
      if (typeof sb3Block !== 'object' || sb3Block.shadow) return;
      const objId = idMap[sb3Id];
      if (!objId) return;

      const mapping = OPCODE_MAP[sb3Block.opcode];
      if (!mapping) {
        console.log('[SB3] 跳过未知 opcode:', sb3Block.opcode);
        return;
      }

      const block = {
        id: objId,
        type: mapping.type,
        x: sb3Block.topLevel ? (sb3Block.x || 100) : 100,
        y: sb3Block.topLevel ? (sb3Block.y || 100) : 100,
        params: {},
        flowIn: null,
        flowOut: null,
        paramConnections: {},
        subBlocks: {},
      };

      // 转换 fields（下拉菜单、变量名等）
      if (sb3Block.fields && mapping.fields) {
        Object.entries(mapping.fields).forEach(([fieldName, paramName]) => {
          const fieldVal = sb3Block.fields[fieldName];
          if (fieldVal) {
            block.params[paramName] = Array.isArray(fieldVal) ? fieldVal[0] : fieldVal;
          }
        });
      }

      // 转换 inputs（参数值）
      if (sb3Block.inputs && mapping.inputs) {
        Object.entries(mapping.inputs).forEach(([inputName, paramName]) => {
          const inputVal = sb3Block.inputs[inputName];
          if (!inputVal) return;

          // Scratch input 格式: [shadow_type, value]
          // value 可以是:
          //   [type, val]        → 直接值
          //   [type, val, id]    → 带 ID 的值
          //   "blockId"          → 引用另一个积木（reporter 连接）
          const val = inputVal[1];
          if (val === undefined || val === null) return;

          if (typeof val === 'string') {
            // 引用另一个积木 blockId（reporter 连接）
            const targetId = idMap[val];
            if (targetId) {
              block.paramConnections[paramName] = targetId;
            }
          } else if (Array.isArray(val)) {
            // 直接值: [type, actualValue, ...]
            const actualVal = val[1];
            if (actualVal !== undefined && actualVal !== null) {
              block.params[paramName] = actualVal;
            }
          }
        });
      }

      result[objId] = block;
    });

    // 建立 next（flowOut）连接
    Object.entries(sb3Blocks).forEach(([sb3Id, sb3Block]) => {
      if (typeof sb3Block !== 'object' || sb3Block.shadow) return;
      const objId = idMap[sb3Id];
      if (!objId || !result[objId]) return;

      // next 连接 → flowOut
      if (sb3Block.next && idMap[sb3Block.next]) {
        const nextObjId = idMap[sb3Block.next];
        if (result[nextObjId]) {
          result[objId].flowOut = nextObjId;
          result[nextObjId].flowIn = objId;
        }
      }

      // SUBSTACK 连接 → subBlocks.body（C 型积木）
      if (sb3Block.inputs?.SUBSTACK) {
        const subVal = sb3Block.inputs.SUBSTACK;
        const subBlockId = typeof subVal[1] === 'string' ? subVal[1] : null;
        if (subBlockId && idMap[subBlockId]) {
          const subObjId = idMap[subBlockId];
          if (result[subObjId]) {
            result[objId].subBlocks.body = subObjId;
            result[subObjId].flowIn = null; // 子积木不连 flowIn
          }
        }
      }

      // SUBSTACK2 连接 → subBlocks.else（if-else）
      if (sb3Block.inputs?.SUBSTACK2) {
        const subVal = sb3Block.inputs.SUBSTACK2;
        const subBlockId = typeof subVal[1] === 'string' ? subVal[1] : null;
        if (subBlockId && idMap[subBlockId]) {
          const subObjId = idMap[subBlockId];
          if (result[subObjId]) {
            result[objId].subBlocks.else = subObjId;
            result[subObjId].flowIn = null;
          }
        }
      }

      // CONDITION 连接（if 的条件）→ paramConnections
      if (sb3Block.inputs?.CONDITION) {
        const condVal = sb3Block.inputs.CONDITION;
        const condBlockId = typeof condVal[1] === 'string' ? condVal[1] : null;
        if (condBlockId && idMap[condBlockId]) {
          const condObjId = idMap[condBlockId];
          if (result[condObjId]) {
            result[objId].paramConnections.condition = condObjId;
          }
        }
      }
    });

    // 调整位置：确保非 topLevel 积木在子积木区域内有合理位置
    let yOffset = 0;
    Object.values(result).forEach(b => {
      if (b.y < 0) b.y = Math.abs(b.y) % 2000; // 修正负坐标
      if (b.x < 0) b.x = Math.abs(b.x) % 2000;
    });

    return result;
  }

  /** 导入项目到编辑器 */
  function importToEditor(project) {
    if (!project || !project.blocks) {
      console.error('[SB3] 无效的项目数据');
      return;
    }

    // 清空当前项目
    window.EditorState.blocks = {};

    // 添加所有积木
    let count = 0;
    Object.entries(project.blocks).forEach(([id, block]) => {
      window.EditorState.blocks[id] = block;
      count++;
    });

    // 初始化变量（如果有）
    if (project.variables && typeof EditorState !== 'undefined') {
      EditorState.variables = EditorState.variables || {};
      Object.entries(project.variables).forEach(([name, val]) => {
        EditorState.variables[name] = val;
      });
    }

    // 刷新画布
    if (typeof EditorCanvas !== 'undefined') {
      EditorCanvas.render();
    }

    // 更新积木计数
    const countEl = document.getElementById('block-count');
    if (countEl) {
      countEl.textContent = `积木: ${count}`;
    }

    // 记录历史（支持撤销）
    if (typeof HistoryManager !== 'undefined') {
      HistoryManager.pushSnapshot();
    }

    console.log('[SB3] 导入成功:', count, '个积木, 角色:', project.spriteNames?.join(', '));
    return count;
  }

  /** 从文件导入（便捷方法） */
  async function importFromFile(file) {
    const sb3Project = await parseSB3(file);
    const project = convertProject(sb3Project);
    const count = importToEditor(project);
    return { count, name: project.name, sprites: project.spriteNames };
  }

  return { parseSB3, convertProject, importToEditor, importFromFile };
})();
