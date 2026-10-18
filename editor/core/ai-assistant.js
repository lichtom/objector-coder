/**
 * AI 助手模块 - 轻量客户端
 * 打开独立的 Electron 窗口进行 AI 对话
 * 编辑器端负责：提供积木数据、执行工具操作
 */
const AIAssistant = (function () {

  /** 获取完整积木目录文本 */
  function _getBlockCatalog() {
    const allBlocks = typeof BlockRegistry !== 'undefined' ? BlockRegistry.getAllBlocks() : {};
    const categories = typeof BlockRegistry !== 'undefined' ? BlockRegistry.getCategories() : [];
    let catalog = '可用积木分类和类型：\n';
    categories.forEach(cat => {
      const blocks = Object.values(allBlocks).filter(b => b.category === cat.id);
      catalog += `\n【${cat.name}】(分类ID: ${cat.id})\n`;
      blocks.forEach(b => {
        const params = (b.params || []).map(p => {
          let typeStr = p.type;
          if (p.default !== undefined) typeStr += '=' + JSON.stringify(p.default);
          return `${p.name}:${typeStr}`;
        }).join(', ');
        const shape = b.shape || 'stack';
        const ports = [];
        if (b.ports?.flowIn) ports.push('flowIn');
        if (b.ports?.flowOut) ports.push('flowOut');
        if (b.subBlocks) ports.push('subBlocks:' + b.subBlocks.join('|'));
        catalog += `  - type="${b.type}" shape=${shape} label="${b.label}"${params ? ' params={' + params + '}' : ''}${ports.length ? ' ports=[' + ports.join(',') + ']' : ''}\n`;
      });
    });
    return catalog;
  }

  /** 获取当前项目积木的文本描述 */
  function _getCurrentBlocksDescription() {
    const blocks = window.EditorState?.blocks || {};
    const count = Object.keys(blocks).length;
    if (count === 0) return '当前项目没有积木。';
    let desc = `当前项目有 ${count} 个积木：\n`;
    Object.values(blocks).forEach(b => {
      const def = typeof BlockRegistry !== 'undefined' ? BlockRegistry.getBlock(b.type) : null;
      const label = def ? def.label : b.type;
      const paramStr = Object.entries(b.params || {}).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ');
      desc += `  [${b.id}] type="${b.type}" label="${label}"${paramStr ? ' (' + paramStr + ')' : ''} pos=(${Math.round(b.x)},${Math.round(b.y)})`;
      if (b.flowIn) desc += ` flowIn=${b.flowIn}`;
      if (b.flowOut) desc += ` flowOut=${b.flowOut}`;
      if (b.subBlocks && Object.keys(b.subBlocks).length) desc += ` subBlocks=${JSON.stringify(b.subBlocks)}`;
      if (b.paramConnections && Object.keys(b.paramConnections).length) desc += ` paramConn=${JSON.stringify(b.paramConnections)}`;
      desc += '\n';
    });
    return desc;
  }

  /** 打开 AI 窗口 */
  async function showPanel() {
    const initData = {
      blockCatalog: _getBlockCatalog(),
      currentBlocks: _getCurrentBlocksDescription(),
    };
    if (window.api?.openAIWindow) {
      await window.api.openAIWindow(initData);
    } else {
      alert('AI 窗口功能仅在桌面版可用');
    }
  }

  /** 在编辑器端执行工具操作 */
  function _executeTool(name, args) {
    const blocks = window.EditorState?.blocks;
    if (!blocks) return '编辑器未就绪';

    // ========== 辅助函数 ==========

    /** 连接到已有积木的指定位置 */
    function _connectToExisting(newBlock, targetId, connectType, subSlot, connectParam) {
      const target = blocks[targetId];
      if (!target) return false;
      const targetDef = typeof BlockRegistry !== 'undefined' ? BlockRegistry.getBlock(target.type) : null;
      const newDef = typeof BlockRegistry !== 'undefined' ? BlockRegistry.getBlock(newBlock.type) : null;

      if (connectType === 'flowOut') {
        // 接在目标积木后面（flowOut 链）
        if (targetDef?.ports?.flowOut && newDef?.ports?.flowIn) {
          // 先把目标原来的 flowOut 接给新积木
          if (target.flowOut) {
            const oldNext = blocks[target.flowOut];
            if (oldNext) oldNext.flowIn = newBlock.id;
            newBlock.flowOut = target.flowOut;
          }
          target.flowOut = newBlock.id;
          newBlock.flowIn = target.id;
          // 调整位置
          const sz = typeof BlockRenderer !== 'undefined' ? BlockRenderer.measureBlock(target) : { w: 120, h: 40 };
          newBlock.x = target.x;
          newBlock.y = target.y + sz.h;
        }
        return true;
      }

      if (connectType === 'flowIn') {
        // 插在目标积木前面
        if (newDef?.ports?.flowOut && targetDef?.ports?.flowIn) {
          if (target.flowIn) {
            const oldPrev = blocks[target.flowIn];
            if (oldPrev) oldPrev.flowOut = newBlock.id;
            newBlock.flowIn = target.flowIn;
          }
          newBlock.flowOut = target.id;
          target.flowIn = newBlock.id;
          const sz = typeof BlockRenderer !== 'undefined' ? BlockRenderer.measureBlock(newBlock) : { w: 120, h: 40 };
          newBlock.x = target.x;
          newBlock.y = target.y - sz.h;
        }
        return true;
      }

      if (connectType === 'sub') {
        // 放入 C 型槽
        const slotName = subSlot || (targetDef?.subBlocks?.[0]) || 'body';
        if (targetDef?.subBlocks?.includes(slotName)) {
          target.subBlocks = target.subBlocks || {};
          target.subBlocks[slotName] = newBlock.id;
          newBlock.flowIn = null;
          // 调整位置到 C 型槽内部
          const sz = typeof BlockRenderer !== 'undefined' ? BlockRenderer.measureBlock(target) : { w: 120, h: 80 };
          newBlock.x = target.x + 20;
          newBlock.y = target.y + 36; // C 型槽内部偏移
        }
        return true;
      }

      if (connectType === 'param') {
        // 连接到参数输入槽（reporter/boolean 连到 stack 的参数）
        const paramName = connectParam;
        if (paramName && (newDef?.shape === 'reporter' || newDef?.shape === 'boolean')) {
          target.paramConnections = target.paramConnections || {};
          target.paramConnections[paramName] = newBlock.id;
          // 调整位置到参数槽旁边
          const sz = typeof BlockRenderer !== 'undefined' ? BlockRenderer.measureBlock(target) : { w: 120, h: 40 };
          newBlock.x = target.x - 60;
          newBlock.y = target.y;
        }
        return true;
      }

      return false;
    }

    // ========== generate_blocks ==========
    if (name === 'generate_blocks') {
      const newBlocks = args.blocks || [];
      if (!Array.isArray(newBlocks) || newBlocks.length === 0) return '没有要添加的积木';

      const idMap = {};
      let added = 0;

      newBlocks.forEach((gb, idx) => {
        const def = typeof BlockRegistry !== 'undefined' ? BlockRegistry.getBlock(gb.type) : null;
        if (!def) return;

        const newId = 'ai_' + Date.now().toString(36) + '_' + idx + '_' + Math.random().toString(36).slice(2, 4);
        idMap[idx] = newId;

        const block = {
          id: newId,
          type: gb.type,
          x: gb.x || 100 + idx * 20,
          y: gb.y || 100 + idx * 60,
          params: {},
          flowIn: null,
          flowOut: null,
          paramConnections: {},
          subBlocks: {},
        };

        // 初始化默认参数
        (def.params || []).forEach(p => { block.params[p.name] = p.default; });
        if (gb.params) {
          Object.entries(gb.params).forEach(([k, v]) => { block.params[k] = v; });
        }

        blocks[newId] = block;
        added++;
      });

      // 连接新积木之间的链（按顺序）
      const ids = Object.keys(idMap);
      for (let i = 0; i < ids.length - 1; i++) {
        const curBlock = blocks[idMap[ids[i]]];
        const nextBlock = blocks[idMap[ids[i + 1]]];
        if (!curBlock || !nextBlock) continue;
        const curDef = typeof BlockRegistry !== 'undefined' ? BlockRegistry.getBlock(curBlock.type) : null;
        const nextDef = typeof BlockRegistry !== 'undefined' ? BlockRegistry.getBlock(nextBlock.type) : null;
        if (curDef?.ports?.flowOut && nextDef?.ports?.flowIn) {
          curBlock.flowOut = nextBlock.id;
          nextBlock.flowIn = curBlock.id;
          // 自动对齐位置：下一个积木在当前积木正下方
          const sz = typeof BlockRenderer !== 'undefined' ? BlockRenderer.measureBlock(curBlock) : { w: 120, h: 40 };
          nextBlock.x = curBlock.x;
          nextBlock.y = curBlock.y + sz.h;
        }
      }

      // 连接到已有积木
      newBlocks.forEach((gb, idx) => {
        if (!gb.connectTo || !idMap[idx]) return;
        const newBlock = blocks[idMap[idx]];
        if (!newBlock) return;
        _connectToExisting(newBlock, gb.connectTo, gb.connectType || 'flowOut', gb.subSlot, gb.connectParam);
      });

      if (typeof EditorCanvas !== 'undefined') EditorCanvas.render();
      if (typeof HistoryManager !== 'undefined') HistoryManager.pushSnapshot();
      const countEl = document.getElementById('block-count');
      if (countEl) countEl.textContent = `积木: ${Object.keys(blocks).length}`;
      _autoSave();
      return `已添加 ${added} 个积木`;
    }

    // ========== modify_blocks ==========
    if (name === 'modify_blocks') {
      const blockIds = args.blockIds || [];
      const action = args.action;
      let modified = 0;

      if (action === 'delete') {
        blockIds.forEach(id => {
          if (!blocks[id]) return;
          const b = blocks[id];
          // 修复 flow 链连接
          if (b.flowIn && blocks[b.flowIn]) blocks[b.flowIn].flowOut = b.flowOut;
          if (b.flowOut && blocks[b.flowOut]) blocks[b.flowOut].flowIn = b.flowIn;
          // 从所有父级的 subBlocks 中移除
          Object.values(blocks).forEach(parent => {
            if (parent.subBlocks) {
              Object.keys(parent.subBlocks).forEach(key => {
                if (parent.subBlocks[key] === id) delete parent.subBlocks[key];
              });
            }
          });
          // 从所有父级的 paramConnections 中移除
          Object.values(blocks).forEach(parent => {
            if (parent.paramConnections) {
              Object.keys(parent.paramConnections).forEach(key => {
                if (parent.paramConnections[key] === id) delete parent.paramConnections[key];
              });
            }
          });
          // 删除子积木链
          if (b.subBlocks) {
            Object.values(b.subBlocks).forEach(subId => {
              if (blocks[subId]) delete blocks[subId];
            });
          }
          delete blocks[id];
          modified++;
        });
      } else if (action === 'move') {
        blockIds.forEach((id, i) => {
          if (blocks[id]) {
            if (args.x !== undefined) blocks[id].x = args.x;
            if (args.y !== undefined) blocks[id].y = args.y + i * 60;
            modified++;
          }
        });
      } else if (action === 'update') {
        blockIds.forEach(id => {
          if (blocks[id] && args.params) {
            Object.entries(args.params).forEach(([k, v]) => {
              blocks[id].params[k] = v;
            });
            modified++;
          }
        });
      } else if (action === 'connect') {
        // 连接两个已有积木
        blockIds.forEach(id => {
          if (!blocks[id] || !args.targetId || !blocks[args.targetId]) return;
          const srcBlock = blocks[id];
          _connectToExisting(srcBlock, args.targetId, args.connectType || 'flowOut', args.subSlot, args.connectParam);
          modified++;
        });
      } else if (action === 'disconnect') {
        // 断开连接
        blockIds.forEach(id => {
          if (!blocks[id]) return;
          const b = blocks[id];
          if (b.flowIn && blocks[b.flowIn]) blocks[b.flowIn].flowOut = null;
          b.flowIn = null;
          if (b.flowOut && blocks[b.flowOut]) blocks[b.flowOut].flowIn = null;
          b.flowOut = null;
          modified++;
        });
      }

      if (modified > 0) {
        if (typeof EditorCanvas !== 'undefined') EditorCanvas.render();
        if (typeof HistoryManager !== 'undefined') HistoryManager.pushSnapshot();
        _autoSave();
      }
      return `已${action === 'delete' ? '删除' : action === 'move' ? '移动' : action === 'update' ? '更新' : action === 'connect' ? '连接' : '断开'} ${modified} 个积木`;
    }

    // ========== manage_sprites ==========
    if (name === 'manage_sprites') {
      const action = args.action;
      const SM = typeof StageManager !== 'undefined' ? StageManager : null;
      if (!SM) return '角色管理模块未加载';

      if (action === 'add_sprite') {
        const spriteName = args.name || '新角色';
        const sprite = SM.addSprite(spriteName);
        if (sprite) {
          // 自动切换到新角色
          const idx = SM.getSprites().length - 1;
          SM.setActiveSprite(idx);
          _autoSave();
          return `已添加并切换到角色: ${spriteName} (索引: ${idx})`;
        }
        return '添加角色失败';
      }

      if (action === 'delete_sprite') {
        const idx = args.spriteIndex;
        if (idx === undefined || idx < 0) return '请指定角色索引 (spriteIndex)';
        const sprites = SM.getSprites();
        if (!sprites || idx >= sprites.length) return `角色索引 ${idx} 无效，当前有 ${sprites?.length || 0} 个角色`;
        if (sprites.length <= 1) return '不能删除最后一个角色';
        const removedName = sprites[idx]?.name || `角色${idx}`;
        SM.removeSprite(idx);
        _autoSave();
        return `已删除角色: ${removedName}`;
      }

      if (action === 'switch_sprite') {
        const idx = args.spriteIndex;
        if (idx === undefined || idx < 0) return '请指定角色索引 (spriteIndex)';
        const sprites = SM.getSprites();
        if (!sprites || idx >= sprites.length) return `角色索引 ${idx} 无效`;
        SM.setActiveSprite(idx);
        const name = sprites[idx]?.name || `角色${idx}`;
        return `已切换到角色: ${name}`;
      }

      if (action === 'list_sprites') {
        const sprites = SM.getSprites();
        if (!sprites || sprites.length === 0) return '当前没有角色';
        const activeIdx = SM.getActiveSpriteIdx();
        let desc = `当前有 ${sprites.length} 个角色：\n`;
        sprites.forEach((s, i) => {
          const marker = i === activeIdx ? ' ← (当前)' : '';
          const blockCount = Object.keys(s.blocks || {}).length;
          desc += `  [${i}] ${s.name} (积木: ${blockCount}个, 位置: x=${Math.round(s.x)}, y=${Math.round(s.y)})${marker}\n`;
        });
        return desc;
      }

      if (action === 'switch_costume') {
        const sprite = SM.getActiveSprite();
        if (!sprite) return '没有选中的角色';
        const idx = args.costumeIndex ?? 0;
        if (!sprite.costumes || idx >= sprite.costumes.length) return `造型索引 ${idx} 无效`;
        SM.setSpriteCostume(SM.getActiveSpriteIdx(), idx);
        return `已切换造型到: ${sprite.costumes[idx]?.name || idx}`;
      }

      if (action === 'delete_costume') {
        const sprite = SM.getActiveSprite();
        if (!sprite) return '没有选中的角色';
        const idx = args.costumeIndex ?? 0;
        if (!sprite.costumes || sprite.costumes.length <= 1) return '不能删除最后一个造型';
        if (idx >= sprite.costumes.length) return `造型索引 ${idx} 无效`;
        const costumeName = sprite.costumes[idx]?.name || `造型${idx}`;
        sprite.costumes.splice(idx, 1);
        _autoSave();
        return `已删除造型: ${costumeName}`;
      }

      return '未知角色操作: ' + action;
    }

    // ========== run_project ==========
    if (name === 'run_project') {
      if (typeof Executor !== 'undefined') {
        Executor.run();
        return '项目已开始运行，请查看舞台效果';
      }
      return '执行器未加载';
    }

    // ========== save_project ==========
    if (name === 'save_project') {
      _autoSave();
      return '项目已保存';
    }

    return '未知操作: ' + name;
  }

  /** 自动保存项目 */
  function _autoSave() {
    try {
      if (typeof AutoSaveManager !== 'undefined' && AutoSaveManager.save) {
        AutoSaveManager.save();
      } else if (typeof ProjectManager !== 'undefined' && ProjectManager.save) {
        ProjectManager.save();
      }
    } catch (e) {
      console.error('[AI] Auto-save error:', e.message);
    }
  }

  /** 执行 AI >>> 指令 */
  function _execCmd(cmd) {
    cmd = cmd.trim();
    const parts = cmd.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
    const action = (parts[0] || '').toLowerCase();
    const sub = (parts[1] || '').toLowerCase();
    const SM = typeof StageManager !== 'undefined' ? StageManager : null;

    // sprite 系列指令
    if (action === 'sprite') {
      if (!SM) return 'ERROR:角色管理模块未加载';

      if (sub === 'add') {
        const name = (parts[2] || '').replace(/^"|"$/g, '') || '新角色';
        const s = SM.addSprite(name);
        if (s) {
          const idx = SM.getSprites().length - 1;
          SM.setActiveSprite(idx);
          _autoSave();
          return String(idx);
        }
        return 'ERROR:添加角色失败';
      }

      if (sub === 'delete') {
        const idx = parseInt(parts[2]);
        if (isNaN(idx)) return 'ERROR:请提供角色索引';
        const sprites = SM.getSprites();
        if (idx < 0 || idx >= sprites.length) return `ERROR:索引 ${idx} 无效(共${sprites.length}个角色)`;
        if (sprites.length <= 1) return 'ERROR:不能删除最后一个角色';
        const name = sprites[idx].name;
        SM.removeSprite(idx);
        _autoSave();
        return `OK:已删除角色"${name}"`;
      }

      if (sub === 'rename') {
        const idx = parseInt(parts[2]);
        if (isNaN(idx)) return 'ERROR:请提供角色索引';
        const sprites = SM.getSprites();
        if (idx < 0 || idx >= sprites.length) return `ERROR:索引 ${idx} 无效`;
        const newName = (parts[3] || '').replace(/^"|"$/g, '');
        if (!newName) return 'ERROR:请提供新名称';
        const oldName = sprites[idx].name;
        sprites[idx].name = newName;
        SM.renderSpriteList();
        _autoSave();
        return `OK:已重命名"${oldName}"为"${newName}"`;
      }

      if (sub === 'switch') {
        const idx = parseInt(parts[2]);
        if (isNaN(idx)) return 'ERROR:请提供角色索引';
        const sprites = SM.getSprites();
        if (idx < 0 || idx >= sprites.length) return `ERROR:索引 ${idx} 无效`;
        SM.setActiveSprite(idx);
        return `OK:已切换到角色"${sprites[idx].name}"(${idx})`;
      }

      if (sub === 'list') {
        const sprites = SM.getSprites();
        if (sprites.length === 0) return '(无角色)';
        const activeIdx = SM.getActiveSpriteIdx();
        return sprites.map((s, i) => {
          const blockCount = Object.keys(s.blocks || {}).length;
          return `[${i}] ${s.name} (${blockCount}个积木)${i === activeIdx ? ' ←当前' : ''}`;
        }).join('\n');
      }

      if (sub === 'clone') {
        const idx = parseInt(parts[2]);
        if (isNaN(idx)) return 'ERROR:请提供角色索引';
        const cloneIdx = SM.cloneSprite(idx);
        if (cloneIdx !== null) {
          _autoSave();
          return String(cloneIdx);
        }
        return 'ERROR:克隆失败';
      }

      if (sub === 'get_id') {
        const name = (parts[2] || '').replace(/^"|"$/g, '');
        if (!name) return 'ERROR:请提供角色名';
        const idx = SM.getSpriteIndexByName(name);
        if (idx < 0) return `ERROR:未找到角色"${name}"`;
        return String(idx);
      }

      if (sub === 'info') {
        const idx = parseInt(parts[2]);
        if (isNaN(idx)) return 'ERROR:请提供角色索引';
        const s = SM.getSprite(idx);
        if (!s) return `ERROR:索引 ${idx} 无效`;
        const blockCount = Object.keys(s.blocks || {}).length;
        return `名称:${s.name} 位置:(${Math.round(s.x)},${Math.round(s.y)}) 方向:${s.direction} 大小:${s.size}% 可见:${s.visible} 积木:${blockCount}个`;
      }

      if (sub === 'set_pos') {
        const idx = parseInt(parts[2]);
        const x = parseFloat(parts[3]);
        const y = parseFloat(parts[4]);
        if (isNaN(idx)) return 'ERROR:请提供角色索引';
        SM.setSpritePos(idx, x, y);
        return `OK:已设置位置(${x},${y})`;
      }

      if (sub === 'set_dir') {
        const idx = parseInt(parts[2]);
        const dir = parseFloat(parts[3]);
        if (isNaN(idx)) return 'ERROR:请提供角色索引';
        SM.setSpriteDir(idx, dir);
        return `OK:已设置方向${dir}`;
      }

      if (sub === 'set_size') {
        const idx = parseInt(parts[2]);
        const size = parseFloat(parts[3]);
        if (isNaN(idx)) return 'ERROR:请提供角色索引';
        SM.setSpriteSize(idx, size);
        return `OK:已设置大小${size}%`;
      }

      if (sub === 'set_visible') {
        const idx = parseInt(parts[2]);
        const visible = parts[3] !== '0' && parts[3] !== 'false';
        if (isNaN(idx)) return 'ERROR:请提供角色索引';
        SM.setSpriteVisible(idx, visible);
        return `OK:已${visible ? '显示' : '隐藏'}角色`;
      }

      return `ERROR:未知 sprite 子命令: ${sub}`;
    }

    // run / save 指令
    if (action === 'run') {
      if (typeof Executor !== 'undefined') {
        Executor.run();
        return 'OK:项目已开始运行';
      }
      return 'ERROR:执行器未加载';
    }

    if (action === 'save') {
      _autoSave();
      return 'OK:项目已保存';
    }

    if (action === 'blocks_count') {
      const blocks = window.EditorState?.blocks || {};
      return String(Object.keys(blocks).length);
    }

    return `ERROR:未知指令: ${action} (可用: sprite, run, save, blocks_count)`;
  }

  /** 注册编辑器端事件监听 */
  function initEditorListeners() {
    if (!window.api) return;

    // 接收工具执行请求
    if (window.api.onAIExecuteTool) {
      window.api.onAIExecuteTool((name, args) => {
        const result = _executeTool(name, args);
        window.api.aiToolExecResult(result);
      });
    }

    // 接收指令执行请求（>>> 命令）
    if (window.api.onAIExecCmd) {
      window.api.onAIExecCmd((cmd) => {
        const result = _execCmd(cmd);
        window.api.aiCmdResult(result);
      });
    }

    // 接收积木数据请求
    if (window.api.onAIRequestBlocks) {
      window.api.onAIRequestBlocks(() => {
        const desc = _getCurrentBlocksDescription();
        window.api.aiBlocksResponse(desc);
      });
    }
  }

  // 自动初始化
  if (typeof window !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initEditorListeners);
    } else {
      initEditorListeners();
    }
  }

  return {
    showPanel,
    getBlockCatalog: _getBlockCatalog,
    getCurrentBlocks: _getCurrentBlocksDescription,
    executeTool: _executeTool,
    initEditorListeners,
  };
})();
