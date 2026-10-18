/**
 * 协作管理器 - 使用 Supabase 数据库
 * 支持：推送进度、推送到分支、查看人员、分享链接
 */
const CollaborationManager = (function () {
  const TABLE_NAME = 'project_collaborations';
  const BRANCHES_TABLE = 'project_branches';

  /** 获取当前项目 ID */
  function _getProjectId() {
    return window.EditorState?.projectPath || null;
  }

  /** 获取当前用户 */
  function _getUser() {
    if (typeof CommunityAPI === 'undefined') return null;
    return CommunityAPI.getUser();
  }

  /** 检查是否已登录 */
  function isLoggedIn() {
    return !!_getUser();
  }

  /** 更新协作菜单可见性 */
  function updateMenuVisibility() {
    const menuCollab = document.getElementById('menu-collab');
    if (!menuCollab) return;
    
    if (isLoggedIn()) {
      menuCollab.classList.remove('hidden');
    } else {
      menuCollab.classList.add('hidden');
    }
  }

  /** 获取项目数据 */
  function _getProjectData() {
    const blocks = window.EditorState?.blocks || {};
    const sprites = typeof StageManager !== 'undefined' ? StageManager.getSprites() : [];
    
    return {
      blocks: JSON.parse(JSON.stringify(blocks)),
      sprites: sprites.map(s => ({
        name: s.name,
        x: s.x, y: s.y,
        direction: s.direction,
        size: s.size,
        costumeName: s.costumeName,
        costumePath: s.costumePath,
      })),
      blockCount: Object.keys(blocks).length,
    };
  }

  /** 推送进度（增量更新） */
  async function pushProgress() {
    const user = _getUser();
    if (!user) {
      alert('请先登录社区');
      return;
    }

    const projectId = _getProjectId();
    if (!projectId) {
      alert('请先保存项目');
      return;
    }

    const projectName = window.EditorState?.projectName || '未命名项目';
    const projectData = _getProjectData();

    try {
      if (typeof CommunityAPI === 'undefined' || !CommunityAPI.isConfigured()) {
        alert('社区 API 未初始化');
        return;
      }

      // 检查项目是否已存在
      const existing = await CommunityAPI.getUserProjectByTitle(user.id, projectName);
      
      if (existing) {
        // 更新现有项目（增量）
        const result = await CommunityAPI.updateProject(existing.id, {
          project_data: projectData,
          updated_at: new Date().toISOString(),
        });
        
        if (result.error) {
          alert('推送进度失败: ' + result.error.message);
          return;
        }
        
        alert('✅ 进度已推送到项目: ' + projectName);
      } else {
        // 创建新项目
        const result = await CommunityAPI.publishProject({
          user_id: user.id,
          title: projectName,
          description: 'Objector 协作项目',
          project_data: projectData,
          is_public: false,
        });
        
        if (result.error) {
          alert('创建协作项目失败: ' + result.error.message);
          return;
        }
        
        alert('✅ 已创建协作项目并推送进度: ' + projectName);
      }

      // 更新状态栏
      const statusEl = document.getElementById('status-text');
      if (statusEl) {
        statusEl.textContent = '✅ 进度已推送';
        setTimeout(() => { statusEl.textContent = i18n.t('status.ready'); }, 2000);
      }
    } catch (e) {
      console.error('[Collaboration] Push progress error:', e);
      alert('推送进度失败: ' + e.message);
    }
  }

  /** 推送到分支（创建版本快照） */
  async function pushToBranch() {
    const user = _getUser();
    if (!user) {
      alert('请先登录社区');
      return;
    }

    const projectName = window.EditorState?.projectName || '未命名项目';
    
    const branchName = prompt('输入分支/版本名称:', 'v1.0');
    if (!branchName) return;

    const projectData = _getProjectData();

    try {
      if (typeof CommunityAPI === 'undefined' || !CommunityAPI.isConfigured()) {
        alert('社区 API 未初始化');
        return;
      }

      // 插入分支记录
      const { error } = await CommunityAPI._supabase
        .from(BRANCHES_TABLE)
        .insert({
          user_id: user.id,
          project_name: projectName,
          branch_name: branchName,
          project_data: projectData,
          created_at: new Date().toISOString(),
        });

      if (error) {
        alert('推送分支失败: ' + error.message);
        return;
      }

      alert('✅ 已推送分支: ' + branchName);
      
      const statusEl = document.getElementById('status-text');
      if (statusEl) {
        statusEl.textContent = '✅ 分支已推送: ' + branchName;
        setTimeout(() => { statusEl.textContent = i18n.t('status.ready'); }, 2000);
      }
    } catch (e) {
      console.error('[Collaboration] Push branch error:', e);
      alert('推送分支失败: ' + e.message);
    }
  }

  /** 查看协作者 */
  async function viewMembers() {
    const user = _getUser();
    if (!user) {
      alert('请先登录社区');
      return;
    }

    const projectName = window.EditorState?.projectName || '未命名项目';

    try {
      if (typeof CommunityAPI === 'undefined' || !CommunityAPI.isConfigured()) {
        alert('社区 API 未初始化');
        return;
      }

      // 查询项目的所有协作者
      const { data, error } = await CommunityAPI._supabase
        .from(BRANCHES_TABLE)
        .select('user_id, created_at')
        .eq('project_name', projectName)
        .order('created_at', { ascending: false });

      if (error) {
        alert('查询协作者失败: ' + error.message);
        return;
      }

      // 获取用户信息
      const userIds = [...new Set(data.map(d => d.user_id))];
      const memberPromises = userIds.map(async (uid) => {
        const { data: profile } = await CommunityAPI._supabase
          .from('profiles')
          .select('username, email')
          .eq('id', uid)
          .single();
        return { id: uid, ...profile };
      });

      const members = await Promise.all(memberPromises);

      // 显示协作者列表
      const memberList = members.map(m => 
        `👤 ${m.username || m.email || '匿名用户'}`
      ).join('\n');

      alert(`项目: ${projectName}\n\n协作者 (${members.length}人):\n${memberList || '暂无协作者'}`);
    } catch (e) {
      console.error('[Collaboration] View members error:', e);
      alert('查看协作者失败: ' + e.message);
    }
  }

  /** 生成分享链接 */
  async function generateShareLink() {
    const user = _getUser();
    if (!user) {
      alert('请先登录社区');
      return;
    }

    const projectName = window.EditorState?.projectName || '未命名项目';

    try {
      if (typeof CommunityAPI === 'undefined' || !CommunityAPI.isConfigured()) {
        alert('社区 API 未初始化');
        return;
      }

      // 检查项目是否已存在
      const existing = await CommunityAPI.getUserProjectByTitle(user.id, projectName);
      
      if (!existing) {
        alert('项目尚未发布到社区，请先推送进度');
        return;
      }

      // 更新项目为公开
      const { error } = await CommunityAPI.updateProject(existing.id, {
        is_public: true,
      });

      if (error) {
        alert('生成分享链接失败: ' + error.message);
        return;
      }

      // 生成分享链接
      const shareUrl = `${window.location.origin}/community/project-detail.html?id=${existing.id}`;
      
      // 复制到剪贴板
      await navigator.clipboard.writeText(shareUrl).catch(() => {
        prompt('复制以下链接分享：', shareUrl);
        return;
      });

      alert('✅ 分享链接已复制到剪贴板！\n\n' + shareUrl);
    } catch (e) {
      console.error('[Collaboration] Share link error:', e);
      alert('生成分享链接失败: ' + e.message);
    }
  }

  /** 初始化 */
  function init() {
    updateMenuVisibility();
  }

  return {
    init,
    updateMenuVisibility,
    pushProgress,
    pushToBranch,
    viewMembers,
    generateShareLink,
    isLoggedIn,
  };
})();
