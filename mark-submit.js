/**
 * mark-submit.js — 为 task.yungu.org 任务详情页添加「标记为已交」按钮
 * 
 * 独立模块，不影响现有 content.js 的功能。
 * 适用于 #/stuTaskInfo/{taskPublishId}/... 页面。
 * 即使任务配置了 needEnclosure=true（需要附件），也能通过此按钮标记为已交。
 */
(() => {
  'use strict';

  const STORAGE_KEY = 'yungu-mark-submit-v1';
  const BTN_CONTAINER_ID = 'yungu-ms-container';
  const BTN_ID = 'yungu-ms-btn';
  const STATUS_CLASS = 'yungu-ms-status';

  // API 端点
  const API = {
    currentUser: '/api/currentUser',
    taskDetail: '/api/getMixedPublishDetail',
    achievement: '/api/student/getAchievementDetail',
    submit: '/api/users/taskPublish/status',
  };

  // 提交状态常量
  const ACHIEVEMENT_STATUS = {
    NOT_SUBMITTED: 1,
    SUBMITTED: 4,
  };

  // ==================== 工具函数 ====================
  
  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  /** 从 URL hash 提取 taskPublishId */
  function getTaskPublishId() {
    const match = window.location.hash.match(/\/stuTaskInfo\/(\d+)/);
    return match ? match[1] : null;
  }

  /** 检查是否在任务详情页 */
  function isTaskDetailPage() {
    return /\/stuTaskInfo\/\d+/.test(window.location.hash);
  }

  // ==================== API 调用 ====================
  
  let cachedUserId = null;

  async function getUserId() {
    if (cachedUserId) return cachedUserId;
    try {
      const resp = await fetch(API.currentUser);
      const data = await resp.json();
      cachedUserId = data?.content?.userId;
      return cachedUserId;
    } catch {
      return null;
    }
  }

  async function getTaskInfo(taskPublishId) {
    try {
      const resp = await fetch(`${API.taskDetail}?taskPublishId=${taskPublishId}`);
      const data = await resp.json();
      return {
        taskId: data?.content?.taskId,
        taskTitle: data?.content?.taskTitle,
        needEnclosure: data?.content?.needEnclosure,
      };
    } catch {
      return null;
    }
  }

  async function getAchievementStatus(taskPublishId) {
    try {
      const userId = await getUserId();
      if (!userId) return null;
      const resp = await fetch(API.achievement, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          distributionType: 1,
          ifPc: true,
          studentId: userId,
          taskPublishId: String(taskPublishId),
          teamId: null,
        }),
      });
      const data = await resp.json();
      return data?.content?.achievementStatus;
    } catch {
      return null;
    }
  }

  async function markAsSubmitted(taskId) {
    const userId = await getUserId();
    if (!userId) throw new Error('无法获取用户 ID');
    const resp = await fetch(API.submit, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: ACHIEVEMENT_STATUS.SUBMITTED,
        userIds: [userId],
        teamIds: null,
        taskId: taskId,
      }),
    });
    const data = await resp.json();
    if (!data?.status) throw new Error(data?.message || '提交失败');
    return data;
  }

  // ==================== UI ====================
  
  /** 注入样式 */
  function injectStyles() {
    if (document.getElementById('yungu-ms-styles')) return;
    const style = document.createElement('style');
    style.id = 'yungu-ms-styles';
    style.textContent = `
      #${BTN_CONTAINER_ID} {
        margin-top: 16px;
        display: flex;
        align-items: center;
        gap: 12px;
      }
      #${BTN_ID} {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 8px 20px;
        font-size: 14px;
        font-weight: 500;
        color: #fff;
        background: #2563eb;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        transition: background 0.2s, opacity 0.2s;
        user-select: none;
      }
      #${BTN_ID}:hover {
        background: #1d4ed8;
      }
      #${BTN_ID}:active {
        background: #1e40af;
      }
      #${BTN_ID}:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }
      #${BTN_ID}.is-success {
        background: #16a34a;
        cursor: default;
      }
      #${BTN_ID}.is-success:hover {
        background: #16a34a;
      }
      #${BTN_ID}.is-error {
        background: #dc2626;
      }
      .${STATUS_CLASS} {
        font-size: 13px;
        color: #6b7280;
      }
      .${STATUS_CLASS}.is-ok {
        color: #16a34a;
        font-weight: 500;
      }
    `;
    document.head.appendChild(style);
  }

  /** 找到可插入按钮的目标区域 */
  function findTargetArea() {
    // 优先在右侧面板中找上传/提交区域
    const selectors = [
      '.rightArea___1crF2',
      '[class*="rightArea"]',
      '.uploadResults___26j7J',
      '[class*="uploadResults"]',
      '.myAchievementBox___2V5X8',
      '[class*="myAchievementBox"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function createButton(taskTitle) {
    // 移除旧按钮
    const oldContainer = document.getElementById(BTN_CONTAINER_ID);
    if (oldContainer) oldContainer.remove();

    const container = document.createElement('div');
    container.id = BTN_CONTAINER_ID;

    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.innerHTML = '✅ Mark as submitted';
    btn.title = taskTitle ? `标记「${taskTitle}」为已交` : '标记为已交';

    const status = document.createElement('span');
    status.className = STATUS_CLASS;

    container.appendChild(btn);
    container.appendChild(status);

    return { container, btn, status };
  }

  function showLoading(btn) {
    btn.disabled = true;
    btn.innerHTML = '⏳ 提交中...';
  }

  function showSuccess(btn, status) {
    btn.classList.add('is-success');
    btn.disabled = true;
    btn.innerHTML = '✅ 已提交';
    status.textContent = '';
  }

  function showError(btn, status, msg) {
    btn.classList.add('is-error');
    btn.disabled = false;
    btn.innerHTML = '❌ 提交失败，点击重试';
    status.textContent = msg;
    status.className = `${STATUS_CLASS}`;
  }

  function showAlreadySubmitted(btn, status) {
    btn.classList.add('is-success');
    btn.disabled = true;
    btn.innerHTML = '✅ 已交';
    status.textContent = '该任务已标记为已交';
    status.className = `${STATUS_CLASS} is-ok`;
  }

  // ==================== 主流程 ====================

  async function run() {
    if (!isTaskDetailPage()) return;

    injectStyles();

    const taskPublishId = getTaskPublishId();
    if (!taskPublishId) return;

    // 等待右侧面板渲染
    let target = null;
    for (let i = 0; i < 30; i++) {
      target = findTargetArea();
      if (target) break;
      await sleep(500);
    }
    if (!target) return;

    // 获取任务信息
    const taskInfo = await getTaskInfo(taskPublishId);
    if (!taskInfo?.taskId) return;

    // 检查当前提交状态
    const currentStatus = await getAchievementStatus(taskPublishId);

    const { container, btn, status } = createButton(taskInfo.taskTitle);

    // 已交 → 显示状态
    if (currentStatus !== null && currentStatus !== ACHIEVEMENT_STATUS.NOT_SUBMITTED) {
      showAlreadySubmitted(btn, status);
      target.appendChild(container);
      return;
    }

    // 未交 → 绑定点击事件
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      showLoading(btn);

      try {
        await markAsSubmitted(taskInfo.taskId);
        showSuccess(btn, status);
        // 延迟刷新页面状态
        await sleep(2000);
        const newStatus = await getAchievementStatus(taskPublishId);
        if (newStatus !== ACHIEVEMENT_STATUS.NOT_SUBMITTED) {
          status.textContent = '刷新页面查看最新状态';
          status.className = `${STATUS_CLASS} is-ok`;
        }
      } catch (err) {
        showError(btn, status, err.message || '网络错误');
        // 5 秒后恢复按钮
        await sleep(5000);
        btn.classList.remove('is-error');
        btn.innerHTML = '✅ Mark as submitted';
        status.textContent = '';
        status.className = STATUS_CLASS;
      }
    });

    target.appendChild(container);
  }

  // ==================== 启动 ====================

  let lastHash = '';
  let runTimer = null;

  function scheduleRun() {
    if (runTimer) clearTimeout(runTimer);
    runTimer = setTimeout(() => {
      runTimer = null;
      const currentHash = window.location.hash;
      if (currentHash !== lastHash) {
        lastHash = currentHash;
        // 清理旧 UI
        const old = document.getElementById(BTN_CONTAINER_ID);
        if (old) old.remove();
        run();
      }
    }, 800);
  }

  // 监听 hash 变化
  window.addEventListener('hashchange', scheduleRun);

  // 页面首次加载
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      lastHash = window.location.hash;
      scheduleRun();
    });
  } else {
    lastHash = window.location.hash;
    scheduleRun();
  }

  // 同时监听 DOM 变化（SPA 内部跳转可能不触发 hashchange）
  const observer = new MutationObserver(() => {
    if (isTaskDetailPage() && window.location.hash !== lastHash) {
      scheduleRun();
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

})();
