/**
 * 场景类积木 - 仅在高级模式下可见
 * 提供场景管理功能：切换、保存、创建、查询场景信息
 */
(function () {
  var C = '#00897B';
  BlockRegistry.registerCategory('scene', '场景', C);

  // === 事件入口 ===
  BlockRegistry.register({

    type: 'scene_on_load', category: 'scene', color: C,
    label: '🎬 当场景加载时', labelKey: 'blocks.scene.scene_on_load', shape: 'hat',
    ports: { flowIn: false, flowOut: true },
    params: [],
  });
  BlockRegistry.separator('scene');


  // === 场景切换 ===
  BlockRegistry.register({
    type: 'scene_switch', category: 'scene', color: C,
    label: '切换场景 {name}', labelKey: 'blocks.scene.scene_switch', shape: 'stack',
    ports: { flowIn: true, flowOut: true },
    params: [{ name: 'name', type: 'string', default: 'main' }],
  });

  BlockRegistry.register({

    type: 'scene_switch_with_transition', category: 'scene', color: C,
    label: '切换场景 {name} 淡入 {duration}秒', labelKey: 'blocks.scene.scene_switch_with_transition', shape: 'stack',
    ports: { flowIn: true, flowOut: true },
    params: [
      { name: 'name', type: 'string', default: 'main' },
      { name: 'duration', type: 'number', default: 0.5 },
    ],
  });
  BlockRegistry.separator('scene');


  // === 场景保存 ===
  BlockRegistry.register({
    type: 'scene_save', category: 'scene', color: C,
    label: '保存当前场景为 {name}', labelKey: 'blocks.scene.scene_save', shape: 'stack',
    ports: { flowIn: true, flowOut: true },
    params: [{ name: 'name', type: 'string', default: 'main' }],
  });

  BlockRegistry.register({

    type: 'scene_save_auto', category: 'scene', color: C,
    label: '保存当前场景（使用原名）', labelKey: 'blocks.scene.scene_save_auto', shape: 'stack',
    ports: { flowIn: true, flowOut: true },
    params: [],
  });
  BlockRegistry.separator('scene');


  // === 场景重载 ===
  BlockRegistry.register({

    type: 'scene_reload', category: 'scene', color: C,
    label: '重新加载当前场景', labelKey: 'blocks.scene.scene_reload', shape: 'stack',
    ports: { flowIn: true, flowOut: true },
    params: [],
  });
  BlockRegistry.separator('scene');


  // === 场景创建 ===
  BlockRegistry.register({

    type: 'scene_create', category: 'scene', color: C,
    label: '新建场景 {name} 类型 {type}', labelKey: 'blocks.scene.scene_create', shape: 'stack',
    ports: { flowIn: true, flowOut: true },
    params: [
      { name: 'name', type: 'string', default: 'level2' },
      { name: 'type', type: 'dropdown', default: 'Scene2D', options: [['2D 场景', 'Scene2D'], ['3D 场景', 'Scene3D'], ['UI 场景', 'SceneUI']] },
    ],
  });
  BlockRegistry.separator('scene');


  // === 报告器（查询信息） ===
  BlockRegistry.register({
    type: 'scene_name', category: 'scene', color: C,
    label: '当前场景名', labelKey: 'blocks.scene.scene_name', shape: 'reporter',
    ports: { flowIn: false, flowOut: false },
    params: [],
  });

  BlockRegistry.register({
    type: 'scene_type', category: 'scene', color: C,
    label: '当前场景类型', labelKey: 'blocks.scene.scene_type', shape: 'reporter',
    ports: { flowIn: false, flowOut: false },
    params: [],
  });

  BlockRegistry.register({
    type: 'scene_exists', category: 'scene', color: C,
    label: '场景 {name} 存在?', labelKey: 'blocks.scene.scene_exists', shape: 'boolean',
    ports: { flowIn: false, flowOut: false },
    params: [{ name: 'name', type: 'string', default: 'main' }],
  });

  BlockRegistry.register({
    type: 'scene_node_count', category: 'scene', color: C,
    label: '当前场景节点数', labelKey: 'blocks.scene.scene_node_count', shape: 'reporter',
    ports: { flowIn: false, flowOut: false },
    params: [],
  });

  BlockRegistry.register({
    type: 'scene_node_type', category: 'scene', color: C,
    label: '节点 {id} 的类型', labelKey: 'blocks.scene.scene_node_type', shape: 'reporter',
    ports: { flowIn: false, flowOut: false },
    params: [{ name: 'id', type: 'string', default: '1' }],
  });
})();
