/**
 * 积木定义注册表
 * 每个积木类型通过 BlockRegistry.register() 注册
 */
const BlockRegistry = (function () {
  const _categories = [];
  const _blocks = {};
  const _paletteOrder = {};  // catId -> [{kind:'block', type:'...'}, {kind:'separator'}]

  return {
    /** 注册分类（已存在则跳过） */
    registerCategory(id, name, color) {
      if (_categories.some(c => c.id === id)) return;
      _categories.push({ id, name, color });
    },

    /** 注册积木定义
     * def: {
     *   type: 'move_steps',        // 唯一标识
     *   category: 'motion',        // 所属分类
     *   label: '移动 {steps} 步',   // 显示文本，{name} 为参数占位
     *   shape: 'stack',            // stack(普通)|hat(事件帽)|reporter(返回值)|boolean(菱形)|c-block(C形含子代码)
     *   ports: { flowIn, flowOut, params:[], subBlocks:[] },
     *   params: [{ name:'steps', type:'number', default:10 }],
     *   color: '#4C97FF',
     * }
     */
    register(def) {
      _blocks[def.type] = def;
      // 记录面板顺序
      if (def.category) {
        if (!_paletteOrder[def.category]) _paletteOrder[def.category] = [];
        _paletteOrder[def.category].push({ kind: 'block', type: def.type });
      }
    },

    /** 在面板中添加分割线（用于视觉上分隔不同组的积木） */
    separator(catId) {
      if (!_paletteOrder[catId]) _paletteOrder[catId] = [];
      _paletteOrder[catId].push({ kind: 'separator' });
    },

    getCategory(id) { return _categories.find(c => c.id === id); },
    getCategories() { return _categories; },
    getBlock(type) { return _blocks[type]; },
    getAllBlocks() { return _blocks; },
    getBlocksByCategory(catId) {
      return Object.values(_blocks).filter(b => b.category === catId);
    },

    /** 获取面板有序项列表（积木 + 分割线，按注册顺序） */
    getPaletteItems(catId) {
      const order = _paletteOrder[catId];
      if (!order || order.length === 0) {
        // 回退：无顺序记录时返回所有积木
        return this.getBlocksByCategory(catId).map(b => ({ kind: 'block', def: b }));
      }
      const items = [];
      order.forEach(entry => {
        if (entry.kind === 'separator') {
          items.push({ kind: 'separator' });
        } else {
          const def = _blocks[entry.type];
          if (def) items.push({ kind: 'block', def });
        }
      });
      return items;
    },

    /** 创建积木实例 */
    createBlock(type, x, y) {
      const def = _blocks[type];
      if (!def) return null;
      const params = {};
      (def.params || []).forEach(p => { params[p.name] = p.default; });
      return {
        id: 'blk_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
        type,
        x: x || 0,
        y: y || 0,
        params,
        flowIn: null,
        flowOut: null,
        paramConnections: {},   // paramName -> blockId (reporter)
        subBlocks: {},          // subName -> blockId (top of sub-stack)
      };
    },

    /** 获取积木的有效标签（支持动态标签 + i18n） */
    getLabel(block) {
      const def = _blocks[block.type];
      if (!def) return '';
      if (typeof def.getLabel === 'function') {
        return def.getLabel(block);
      }
      // i18n: 优先通过 labelKey 查找翻译，fallback 到 label
      if (def.labelKey && typeof i18n !== 'undefined') {
        var translated = i18n.t(def.labelKey, def.label);
        return translated;
      }
      return def.label;
    },

    /** 卸载分类及其所有积木（用于扩展卸载） */
    unregisterCategory(catId) {
      // 删除该分类下所有积木
      Object.keys(_blocks).forEach(type => {
        if (_blocks[type].category === catId) {
          delete _blocks[type];
        }
      });
      // 删除分类
      const idx = _categories.findIndex(c => c.id === catId);
      if (idx >= 0) _categories.splice(idx, 1);
    },

    /** 卸载单个积木 */
    unregisterBlock(type) {
      delete _blocks[type];
    },
  };
})();
