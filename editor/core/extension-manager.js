/**
 * 扩展管理器 - 支持加载自定义扩展积木（JSON 和 JS 两种格式）
 *
 * === 格式一：JSON 文件 ===
 * {
 *   "id": "my-extension",
 *   "name": "我的扩展",
 *   "color": "#FF6B6B",
 *   "blocks": [ { "type": "ext_block", "label": "...", "shape": "stack", "params": [...] } ],
 *   "executors": {
 *     "ext_block": "function(params, scope) { ... }"   // 函数字符串
 *   }
 * }
 *
 * === 格式二：JS 文件 ===
 * ExtensionManager.registerExtension({
 *   id: 'my-extension',
 *   name: '我的扩展',
 *   color: '#FF6B6B',
 *   blocks: [ ... ],
 *   executors: {
 *     ext_block: function(params, scope) { ... }   // 直接写函数，不需要字符串
 *   }
 * });
 */
const ExtensionManager = (function () {
  const _extensions = new Map(); // id -> extension definition (已安装)
  const _customExecutors = new Map(); // blockType -> executor function
  const _jsSources = []; // 原始 JS 源码（用于导出）
  const _availableExtensions = new Map(); // id -> extension definition (可用但未安装)
  const _installedIds = new Set(); // 当前已安装的扩展 ID
  let _lastRegisteredId = null; // 最近一次 registerExtension 成功注册的扩展 ID
  let _availableOnly = false; // 加载模式标记：true 时 registerExtension 只注册不安装

  /**
   * 注册一个扩展
   * @param {Object} extDef - 扩展定义对象
   */
  function registerExtension(extDef) {
    if (!extDef || !extDef.id || !extDef.blocks) {
      console.error('ExtensionManager: 无效的扩展定义', extDef);
      return false;
    }

    // 如果已存在同 id 扩展，先卸载旧版
    if (_extensions.has(extDef.id)) {
      uninstallExtension(extDef.id);
    }

    // 注册分类（避免与内置分类重复时报错）
    if (!_existsCategory(extDef.id)) {
      BlockRegistry.registerCategory(extDef.id, extDef.name || extDef.id, extDef.color || '#888888');
    }

    // 注册积木
    extDef.blocks.forEach(blockDef => {
      blockDef.category = extDef.id;
      if (!blockDef.color) blockDef.color = extDef.color || '#888888';

      if (!blockDef.ports) {
        blockDef.ports = {
          flowIn: blockDef.shape === 'stack' || blockDef.shape === 'c-block',
          flowOut: blockDef.shape === 'stack' || blockDef.shape === 'c-block',
        };
      }

      BlockRegistry.register(blockDef);
    });

    // 注册执行器：支持字符串和函数两种类型
    if (extDef.executors) {
      Object.entries(extDef.executors).forEach(([blockType, executor]) => {
        try {
          let fn;
          if (typeof executor === 'function') {
            // JS 文件：直接传函数对象
            fn = executor;
          } else if (typeof executor === 'string') {
            // JSON 文件：函数字符串，动态解析
            fn = new Function('return ' + executor)();
          } else {
            console.error(`ExtensionManager: 执行器 ${blockType} 类型无效`);
            return;
          }
          _customExecutors.set(blockType, fn);
        } catch (err) {
          console.error(`ExtensionManager: 无法解析执行器 ${blockType}:`, err);
        }
      });
    }

    // 可用池始终记录
    if (!_availableExtensions.has(extDef.id)) {
      _availableExtensions.set(extDef.id, extDef);
    }
    // 根据模式决定是否自动安装
    if (!_availableOnly) {
      _extensions.set(extDef.id, extDef);
      _installedIds.add(extDef.id);
    }
    _lastRegisteredId = extDef.id;
    console.log(`ExtensionManager: 已注册扩展 "${extDef.name || extDef.id}"，包含 ${extDef.blocks.length} 个积木`);
    return true;
  }

  function _existsCategory(catId) {
    return BlockRegistry.getCategories().some(c => c.id === catId);
  }

  /**
   * 从 JSON 字符串加载扩展
   */
  function loadFromJSON(jsonStr) {
    try {
      const extDef = JSON.parse(jsonStr);
      return registerExtension(extDef);
    } catch (err) {
      console.error('ExtensionManager: JSON 解析失败:', err);
      return false;
    }
  }

  /**
   * 从 JS 文件内容加载扩展（动态执行脚本）
   * JS 文件内应调用 ExtensionManager.registerExtension({...})
   */
  function loadFromJS(jsContent) {
    try {
      _jsSources.push(jsContent); // 存储原始源码
      const script = document.createElement('script');
      script.textContent = jsContent;
      document.head.appendChild(script);
      document.head.removeChild(script);
      return true;
    } catch (err) {
      console.error('ExtensionManager: JS 执行失败:', err);
      alert((i18n.isEnglish() ? 'Extension JS execution error: ' : '扩展 JS 文件执行出错：') + err.message);
      return false;
    }
  }

  /**
   * 从文件路径加载扩展（自动检测 JSON / JS 格式）
   * 返回值: { ok: boolean, id: string|null }
   */
  async function loadFromFile(filePath) {
    const content = await window.api.readFile(filePath);
    if (!content) return { ok: false, id: null };

    if (filePath.endsWith('.js')) {
      _lastRegisteredId = null;
      const result = loadFromJS(content);
      return { ok: result, id: _lastRegisteredId };
    }

    // JSON 格式：先解析拿 id，再注册
    try {
      const extDef = JSON.parse(content);
      const ok = registerExtension(extDef);
      return { ok, id: extDef.id || null };
    } catch (err) {
      console.error('ExtensionManager: JSON 解析失败:', err);
      return { ok: false, id: null };
    }
  }

  /**
   * 从项目的 extensions 目录加载所有扩展到可用池（不自动安装，仅注册定义）
   */
  async function loadFromProject(projectPath) {
    const extDir = projectPath + '/extensions';
    await window.api.ensureDir(extDir);
    const files = await window.api.listDir(extDir);
    let count = 0;
    for (const file of files) {
      if (file.endsWith('.json') || file.endsWith('.js')) {
        const ok = await _loadFileAsAvailable(extDir + '/' + file);
        if (ok) count++;
      }
    }
    return count;
  }

  /**
   * 从文件加载扩展到可用池（不自动安装，仅注册定义）
   */
  async function _loadFileAsAvailable(filePath) {
    const content = await window.api.readFile(filePath);
    if (!content) return false;

    if (filePath.endsWith('.js')) {
      // JS 文件：执行脚本，用 _availableOnly 标记让 registerExtension 只注册不安装
      try {
        _jsSources.push(content);
        _availableOnly = true;
        const script = document.createElement('script');
        script.textContent = content;
        document.head.appendChild(script);
        document.head.removeChild(script);
        _availableOnly = false;
        return true;
      } catch (err) {
        console.error('ExtensionManager: JS 执行失败:', err);
        return false;
      }
    }

    // JSON 文件：仅注册到可用池
    try {
      const extDef = JSON.parse(content);
      registerAvailable(extDef);
      return true;
    } catch (err) {
      console.error('ExtensionManager: JSON 解析失败:', err);
      return false;
    }
  }

  /**
   * 获取自定义执行器
   */
  function getExecutor(blockType) {
    return _customExecutors.get(blockType) || null;
  }

  /**
   * 获取所有自定义执行器（用于导出）
   */
  function getExecutors() {
    return _customExecutors;
  }

  /**
   * 获取所有扩展的原始 JS 源码（用于导出）
   */
  function getJsSources() {
    return _jsSources.slice();
  }

  /**
   * 获取所有已加载的扩展
   */
  function getExtensions() {
    return Array.from(_extensions.values());
  }

  /**
   * 注册一个可用扩展定义（不自动安装，仅记录定义供后续 installExtension 使用）
   */
  function registerAvailable(extDef) {
    if (!extDef || !extDef.id || !extDef.blocks) return false;
    _availableExtensions.set(extDef.id, extDef);
    return true;
  }

  /**
   * 获取所有可用扩展定义（包括已安装和未安装的）
   */
  function getAvailableExtensions() {
    return Array.from(_availableExtensions.values());
  }

  /**
   * 获取可用扩展定义
   */
  function getAvailableDefinition(extId) {
    return _availableExtensions.get(extId) || null;
  }

  /**
   * 安装扩展（从可用池中取出并注册到积木系统）
   */
  function installExtension(extId) {
    if (_extensions.has(extId)) return true; // 已安装
    const def = _availableExtensions.get(extId);
    if (!def) {
      console.warn(`ExtensionManager: 可用扩展 "${extId}" 未找到`);
      return false;
    }
    const ok = registerExtension(def);
    if (ok) _installedIds.add(extId);
    return ok;
  }

  /**
   * 卸载扩展（同时清理 BlockRegistry 中的分类和积木）
   */
  function uninstallExtension(extId) {
    const ext = _extensions.get(extId);
    if (!ext) return false;
    // 清理自定义执行器
    ext.blocks.forEach(b => _customExecutors.delete(b.type));
    // 清理 BlockRegistry 中的分类和积木
    if (typeof BlockRegistry !== 'undefined' && BlockRegistry.unregisterCategory) {
      BlockRegistry.unregisterCategory(extId);
    } else {
      ext.blocks.forEach(b => {
        if (typeof BlockRegistry !== 'undefined' && BlockRegistry.unregisterBlock) {
          BlockRegistry.unregisterBlock(b.type);
        }
      });
    }
    _extensions.delete(extId);
    _installedIds.delete(extId);
    console.log(`ExtensionManager: 已卸载扩展 "${ext.name || extId}"`);
    return true;
  }

  /** 获取已安装扩展 ID 列表（用于项目保存） */
  function getInstalledIds() {
    return Array.from(_installedIds);
  }

  /** 设置已安装扩展 ID 列表（用于项目加载时恢复） */
  function setInstalledIds(ids) {
    _installedIds.clear();
    (ids || []).forEach(id => _installedIds.add(id));
  }

  /** 检查扩展是否已安装 */
  function isInstalled(extId) {
    return _extensions.has(extId);
  }

  /**
   * 批量安装已保存的扩展（项目加载时调用）
   */
  function restoreInstalled(ids) {
    let count = 0;
    (ids || []).forEach(id => {
      if (installExtension(id)) count++;
    });
    return count;
  }

  return {
    registerExtension,
    registerAvailable,
    getAvailableExtensions,
    getAvailableDefinition,
    installExtension,
    loadFromJSON,
    loadFromJS,
    loadFromFile,
    loadFromProject,
    getExecutor,
    getExecutors,
    getJsSources,
    getExtensions,
    uninstallExtension,
    getInstalledIds,
    setInstalledIds,
    isInstalled,
    restoreInstalled,
  };
})();
