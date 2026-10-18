/**
 * 教程系统 - 交互式入门教程
 */
const TutorialSystem = (function () {
  let _steps = [];
  let _currentStep = 0;
  let _overlay = null;
  let _highlight = null;

  const TUTORIALS = {
    beginner: {
      title: '📖 入门教程：创建你的第一个程序',
      steps: [
        {
          text: '👋 欢迎使用 Objector！\n\n这是一个图形化积木编程编辑器，让你用拖拽的方式创建程序。\n\n让我们开始吧！',
          highlight: null,
        },
        {
          text: '📦 左侧是<b>积木面板</b>，包含所有可用的积木。\n\n积木按类别分组：事件、运动、外观、控制等。\n\n试试点击一个分类看看！',
          highlight: '#palette-panel',
        },
        {
          text: '🖱️ 从积木面板<b>拖拽</b>一个积木到中间的编辑区。\n\n积木会自动连接到已有积木的后面。\n\n试试拖一个 "当绿旗被点击" 事件积木！',
          highlight: '#editor-canvas',
        },
        {
          text: '🔗 积木通过<b>连接线</b>自动链接。\n\n蓝色箭头表示执行顺序，黄色虚线表示子代码。\n\n你可以拖拽积木重新排列！',
          highlight: '#editor-canvas',
        },
        {
          text: '▶️ 点击工具栏的 <b>"▶ 运行"</b> 按钮执行程序。\n\n你会看到角色按照积木的顺序执行动作！',
          highlight: '#btn-run',
        },
        {
          text: '💾 项目会自动保存。\n\n你也可以按 <b>Ctrl+S</b> 手动保存，或点击菜单 "项目 → 另存为"。\n\n试试保存你的第一个项目！',
          highlight: null,
        },
        {
          text: '🎉 恭喜！你完成了入门教程。\n\n现在你可以：\n• 探索更多积木类型\n• 创建复杂程序\n• 使用 AI 助手 (🤖)\n• 查看积木使用指南\n\n祝你编程愉快！',
          highlight: null,
        },
      ],
    },
    ai: {
      title: '🤖 AI 助手教程',
      steps: [
        {
          text: '🤖 Objector 内置了 AI 助手，可以帮你生成积木、解释代码、调试问题。\n\n点击工具栏的 <b>"🤖 AI"</b> 按钮打开 AI 窗口。',
          highlight: '#btn-ai-assistant',
        },
        {
          text: '⚙️ 首次使用需要配置 AI 服务。\n\n点击 AI 窗口的 "⚙️ 设置" 按钮，注册你的 AI 模型服务（支持 OpenAI、DeepSeek、通义千问等）。',
          highlight: null,
        },
        {
          text: '💬 配置完成后，你可以在聊天框中输入问题。\n\n例如：\n• "帮我生成一个让角色转圈的积木"\n• "解释一下当前代码"\n• "这段代码有什么问题？"',
          highlight: null,
        },
        {
          text: '🔧 AI 生成的积木会以<b>工具卡片</b>形式显示。\n\n点击 "✅ 同意执行" 让 AI 添加积木到编辑区。\n\n所有修改操作都需要你确认！',
          highlight: null,
        },
        {
          text: '🎉 AI 助手教程完成！\n\nAI 可以帮你：\n• 快速生成积木\n• 连接到已有积木\n• 修改/删除积木\n• 解释代码逻辑\n• 调试和优化\n\n试试看吧！',
          highlight: null,
        },
      ],
    },
  };

  function start(tutorialId) {
    const tutorial = TUTORIALS[tutorialId] || TUTORIALS.beginner;
    _steps = tutorial.steps;
    _currentStep = 0;

    _overlay = document.getElementById('tutorial-overlay');
    _highlight = document.getElementById('tutorial-highlight');

    if (!_overlay) {
      console.error('[Tutorial] overlay not found');
      return;
    }

    _overlay.classList.remove('hidden');
    _showStep();
  }

  function _showStep() {
    if (_currentStep < 0 || _currentStep >= _steps.length) {
      close();
      return;
    }

    const step = _steps[_currentStep];
    const titleEl = document.getElementById('tutorial-title');
    const indicatorEl = document.getElementById('tutorial-step-indicator');
    const contentEl = document.getElementById('tutorial-content');
    const prevBtn = document.getElementById('tutorial-prev');
    const nextBtn = document.getElementById('tutorial-next');

    if (titleEl) titleEl.textContent = `📖 步骤 ${_currentStep + 1}`;
    if (indicatorEl) indicatorEl.textContent = `${_currentStep + 1} / ${_steps.length}`;
    if (contentEl) contentEl.innerHTML = step.text.replace(/\n/g, '<br>');

    if (prevBtn) prevBtn.style.display = _currentStep === 0 ? 'none' : '';
    if (nextBtn) nextBtn.textContent = _currentStep === _steps.length - 1 ? '完成 ✓' : '下一步 ▶';

    // 高亮目标元素
    if (step.highlight) {
      const target = document.querySelector(step.highlight);
      if (target && _highlight) {
        const rect = target.getBoundingClientRect();
        _highlight.style.display = 'block';
        _highlight.style.left = (rect.left - 4) + 'px';
        _highlight.style.top = (rect.top - 4) + 'px';
        _highlight.style.width = (rect.width + 8) + 'px';
        _highlight.style.height = (rect.height + 8) + 'px';
      }
    } else if (_highlight) {
      _highlight.style.display = 'none';
    }
  }

  function next() {
    _currentStep++;
    if (_currentStep >= _steps.length) {
      close();
    } else {
      _showStep();
    }
  }

  function prev() {
    if (_currentStep > 0) {
      _currentStep--;
      _showStep();
    }
  }

  function close() {
    if (_overlay) _overlay.classList.add('hidden');
    if (_highlight) _highlight.style.display = 'none';
    _currentStep = 0;
    localStorage.setItem('objector-tutorial-done', '1');
  }

  function isDone() {
    return localStorage.getItem('objector-tutorial-done') === '1';
  }

  // 初始化按钮事件
  function init() {
    const nextBtn = document.getElementById('tutorial-next');
    const prevBtn = document.getElementById('tutorial-prev');
    const skipBtn = document.getElementById('tutorial-skip');

    if (nextBtn) nextBtn.addEventListener('click', next);
    if (prevBtn) prevBtn.addEventListener('click', prev);
    if (skipBtn) skipBtn.addEventListener('click', close);
  }

  return { start, next, prev, close, isDone, init, TUTORIALS };
})();
