(() => {
  const CARD_SELECTORS = [
    '[class*="studentTabCardBox___"]',
    '[class*="studenttabcardbox___"]',
    '[data-type*="学生角色跳转到任务说明"]',
    '[data-type*="任务说明"]'
  ];
  const KEY_PREFIX = "yungu-card-state-v1:";
  const CARD_ID_ATTR = "data-yungu-card-id";
  const TOOL_ATTR = "data-yungu-tools";
  const WRAP_ATTR = "data-yungu-wrap";
  const HIDDEN_CLASS = "yungu-hidden-by-extension";
  const CARD_CLASS_PATTERN = /(^|\s)studenttabcardbox___[^\s]*/i;
  const FAB_ID = "yungu-fab";
  const TOAST_ID = "yungu-toast";
  const FEEDBACK_BTN_SELECTOR = ".publicService_feedbackBtn";
  const FEEDBACK_TOGGLE_KEY = "yungu-hide-feedback-enabled-v1";
  const SHOW_HIDDEN_TASKS_KEY = "yungu-show-hidden-tasks-v1";
  const UNPAGED_LIST_KEY = "yungu-unpaged-list-enabled-v1";
  const HIDDEN_PREVIEW_CLASS = "yungu-hidden-preview";
  const CARD_HIDDEN_ATTR = "data-yungu-hidden";
  const CARD_KEY_ATTR = "data-yungu-key";
  const ARCHIVED_ATTR = "data-yungu-archived";
  const UNPAGED_LIST_ID = "yungu-unpaged-list";
  const PAGINATION_ROOT_SELECTORS = [
    ".ant-pagination",
    '[class*="pagination"]',
    '[class*="Pagination"]'
  ];
  let scanTimer = null;
  let unpagedTimer = null;
  let observerPaused = false;
  let unpagedEnabled = true;
  let unpagedRunning = false;
  let hideFeedbackEnabled = true;
  let showHiddenTasks = false;
  function isTargetCard(element) {
    if (!(element instanceof HTMLElement)) return false;
    const className = element.className || "";
    if (typeof className !== "string") return false;
    if (CARD_CLASS_PATTERN.test(className)) return true;
    const dataType = element.getAttribute("data-type") || "";
    return dataType.includes("任务说明");
  }

  function collectCards() {
    const unique = new Set();
    const cards = [];
    CARD_SELECTORS.forEach((selector) => {
      const found = document.querySelectorAll(selector);
      found.forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        if (!isTargetCard(node)) return;
        if (unique.has(node)) return;
        unique.add(node);
        cards.push(node);
      });
    });
    return cards;
  }


  let cardIdSeed = 0;

  function readState(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result) => {
        resolve(result[key] || { pinned: false, hidden: false });
      });
    });
  }

  function writeState(key, state) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: state }, resolve);
    });
  }

  function readBooleanState(key, defaultValue) {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result) => {
        if (typeof result[key] === "boolean") {
          resolve(result[key]);
          return;
        }
        resolve(defaultValue);
      });
    });
  }

  function writeBooleanState(key, value) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: Boolean(value) }, resolve);
    });
  }

  function simpleHash(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function getCardTextSnippet(card) {
    return (card.innerText || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180);
  }

  function ensureCardId(card, index) {
    if (card.hasAttribute(CARD_ID_ATTR)) {
      return card.getAttribute(CARD_ID_ATTR);
    }

    const snippet = getCardTextSnippet(card);
    const raw = `${snippet}::${index}::${card.className || ""}::${cardIdSeed}`;
    cardIdSeed += 1;
    const id = simpleHash(raw);
    card.setAttribute(CARD_ID_ATTR, id);
    return id;
  }

  function setHidden(targetElement, hidden) {
    if (targetElement instanceof HTMLElement) {
      targetElement.setAttribute(CARD_HIDDEN_ATTR, hidden ? "1" : "0");
    }
    if (hidden && !showHiddenTasks) {
      targetElement.classList.add(HIDDEN_CLASS);
      targetElement.classList.remove(HIDDEN_PREVIEW_CLASS);
      targetElement.style.display = "none";
    } else {
      targetElement.classList.remove(HIDDEN_CLASS);
      targetElement.style.removeProperty("display");
      if (hidden && showHiddenTasks) {
        targetElement.classList.add(HIDDEN_PREVIEW_CLASS);
      } else {
        targetElement.classList.remove(HIDDEN_PREVIEW_CLASS);
      }
    }
  }

  function refreshHiddenTaskDisplay() {
    const wraps = document.querySelectorAll(`[${WRAP_ATTR}="1"]`);
    wraps.forEach((wrap) => {
      if (!(wrap instanceof HTMLElement)) return;
      const hidden = wrap.getAttribute(CARD_HIDDEN_ATTR) === "1";
      setHidden(wrap, hidden);
    });
  }

  async function refreshHiddenTaskDisplayFromStorage() {
    const wraps = Array.from(document.querySelectorAll(`[${WRAP_ATTR}="1"]`));
    await Promise.all(
      wraps.map(async (wrap) => {
        if (!(wrap instanceof HTMLElement)) return;
        const key = wrap.getAttribute(CARD_KEY_ATTR);
        if (key) {
          const state = await readState(key);
          setHidden(wrap, Boolean(state.hidden));
          return;
        }
        // 兼容旧版本：没有存储 key 时，用当前标记/按钮状态兜底。
        const hiddenByAttr = wrap.getAttribute(CARD_HIDDEN_ATTR) === "1";
        const hiddenBtn = wrap.querySelector(".yungu-tool-btn.is-active:last-child");
        const hiddenByButton = hiddenBtn instanceof HTMLElement && hiddenBtn.textContent?.includes("取消隐藏");
        setHidden(wrap, Boolean(hiddenByAttr || hiddenByButton));
      })
    );
  }

  function setPinned(targetElement, pinned) {
    const parent = targetElement.parentElement;
    if (!parent) return;

    if (pinned) {
      parent.prepend(targetElement);
    } else {
      parent.append(targetElement);
    }
  }

  function updateButtonState(button, active, activeText, normalText) {
    button.classList.toggle("is-active", active);
    button.textContent = active ? activeText : normalText;
  }

  async function applyCardState(targetElement, key, pinButton, hideButton) {
    const state = await readState(key);
    setPinned(targetElement, Boolean(state.pinned));
    setHidden(targetElement, Boolean(state.hidden));
    updateButtonState(pinButton, Boolean(state.pinned), "取消置顶", "置顶");
    updateButtonState(hideButton, Boolean(state.hidden), "取消隐藏", "隐藏");
  }

  async function togglePinned(targetElement, key, pinButton) {
    const state = await readState(key);
    const next = { ...state, pinned: !state.pinned };
    await writeState(key, next);
    setPinned(targetElement, Boolean(next.pinned));
    updateButtonState(pinButton, Boolean(next.pinned), "取消置顶", "置顶");
  }

  async function toggleHidden(targetElement, key, hideButton) {
    const state = await readState(key);
    const next = { ...state, hidden: !state.hidden };
    await writeState(key, next);
    setHidden(targetElement, Boolean(next.hidden));
    updateButtonState(hideButton, Boolean(next.hidden), "取消隐藏", "隐藏");
  }

  function createWrap(card) {
    const currentParent = card.parentElement;
    if (!currentParent) return null;
    if (currentParent.hasAttribute(WRAP_ATTR)) return currentParent;

    const wrap = document.createElement("div");
    wrap.setAttribute(WRAP_ATTR, "1");
    wrap.className = "yungu-card-wrap";
    currentParent.insertBefore(wrap, card);
    wrap.appendChild(card);
    return wrap;
  }

  function buildTools(card, wrap, key) {
    const tools = document.createElement("div");
    tools.className = "yungu-tools-bar";
    tools.setAttribute(TOOL_ATTR, "1");

    const pinButton = document.createElement("button");
    pinButton.type = "button";
    pinButton.className = "yungu-tool-btn";
    pinButton.textContent = "置顶";

    const hideButton = document.createElement("button");
    hideButton.type = "button";
    hideButton.className = "yungu-tool-btn";
    hideButton.textContent = "隐藏";

    pinButton.addEventListener("click", () => {
      togglePinned(wrap, key, pinButton);
    });

    hideButton.addEventListener("click", () => {
      toggleHidden(wrap, key, hideButton);
    });

    tools.appendChild(pinButton);
    tools.appendChild(hideButton);
    wrap.setAttribute(CARD_KEY_ATTR, key);
    wrap.appendChild(tools);

    applyCardState(wrap, key, pinButton, hideButton);
  }

  function showToast(text) {
    let toast = document.getElementById(TOAST_ID);
    if (!toast) {
      toast = document.createElement("div");
      toast.id = TOAST_ID;
      toast.style.position = "fixed";
      toast.style.right = "16px";
      toast.style.bottom = "64px";
      toast.style.zIndex = "2147483647";
      toast.style.background = "rgba(17,24,39,0.92)";
      toast.style.color = "#fff";
      toast.style.padding = "8px 10px";
      toast.style.borderRadius = "8px";
      toast.style.fontSize = "12px";
      toast.style.pointerEvents = "none";
      document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.style.opacity = "1";
    window.setTimeout(() => {
      if (toast) toast.style.opacity = "0";
    }, 1200);
  }

  function ensureFab() {
    if (!document.body) return;
    let fab = document.getElementById(FAB_ID);
    if (fab) {
      removeDuplicateFab(fab);
      updateFabLabel(fab);
      return;
    }
    fab = document.createElement("button");
    fab.id = FAB_ID;
    fab.type = "button";
    fab.style.position = "fixed";
    fab.style.right = "16px";
    fab.style.bottom = "16px";
    fab.style.width = "40px";
    fab.style.height = "40px";
    fab.style.borderRadius = "999px";
    fab.style.border = "1px solid #2563eb";
    fab.style.background = "#2563eb";
    fab.style.color = "#fff";
    fab.style.fontSize = "16px";
    fab.style.cursor = "pointer";
    fab.style.zIndex = "2147483647";
    updateFabLabel(fab);
    fab.addEventListener("click", async (event) => {
      if (event.shiftKey) {
        hideFeedbackEnabled = !hideFeedbackEnabled;
        await writeBooleanState(FEEDBACK_TOGGLE_KEY, hideFeedbackEnabled);
      } else {
        showHiddenTasks = !showHiddenTasks;
        await writeBooleanState(SHOW_HIDDEN_TASKS_KEY, showHiddenTasks);
        await refreshHiddenTaskDisplayFromStorage();
      }
      updateFabLabel(fab);
      const count = scanAndEnhance();
      if (event.shiftKey) {
        const switchText = hideFeedbackEnabled ? "开" : "关";
        showToast(`隐藏反馈按钮：${switchText}，已匹配 ${count} 个卡片`);
      } else {
        const switchText = showHiddenTasks ? "显示" : "不显示";
        showToast(`已隐藏任务：${switchText}，已匹配 ${count} 个卡片`);
      }
    });
    document.body.appendChild(fab);
    removeDuplicateFab(fab);
  }

  function removeFab() {
    const fab = document.getElementById(FAB_ID);
    if (fab) fab.remove();
  }

  function removeDuplicateFab(currentFab) {
    if (!(currentFab instanceof HTMLButtonElement)) return;
    const candidates = document.querySelectorAll("button");
    candidates.forEach((button) => {
      if (!(button instanceof HTMLButtonElement)) return;
      if (button === currentFab) return;
      const sameId = button.id === FAB_ID;
      const legacyYunguFab =
        button.textContent?.trim().startsWith("Y") &&
        (button.title || "").includes("Yungu 插件");
      if (sameId || legacyYunguFab) {
        button.remove();
      }
    });
  }

  function updateFabLabel(fab) {
    if (!(fab instanceof HTMLElement)) return;
    fab.textContent = showHiddenTasks ? "Y显" : "Y隐";
    fab.title =
      `Yungu 插件：点击切换是否显示已隐藏任务（当前${showHiddenTasks ? "显示" : "不显示"}）；` +
      `Shift+点击切换隐藏反馈按钮（当前${hideFeedbackEnabled ? "开" : "关"}）`;
    fab.style.background = showHiddenTasks ? "#16a34a" : "#2563eb";
    fab.style.border = showHiddenTasks ? "1px solid #16a34a" : "1px solid #2563eb";
  }

  function sleep(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  function isElementDisabled(element) {
    if (!(element instanceof HTMLElement)) return true;
    if (element.hasAttribute("disabled")) return true;
    if (element.getAttribute("aria-disabled") === "true") return true;
    const className = element.className || "";
    if (typeof className === "string" && /disabled/i.test(className)) return true;
    return false;
  }

  function findNextPageButton() {
    const directSelectors = [
      ".ant-pagination-next button",
      ".ant-pagination-next",
      '[aria-label*="next" i]',
      '[title*="下一页"]'
    ];
    for (const selector of directSelectors) {
      const candidate = document.querySelector(selector);
      if (!(candidate instanceof HTMLElement)) continue;
      if (!isElementDisabled(candidate) && !isElementDisabled(candidate.parentElement)) {
        return candidate;
      }
    }
    const allButtons = document.querySelectorAll("button, a");
    for (const button of allButtons) {
      if (!(button instanceof HTMLElement)) continue;
      const text = (button.textContent || "").trim();
      if (!text) continue;
      if (text === "下一页" || text === "下页" || text === ">") {
        if (!isElementDisabled(button) && !isElementDisabled(button.parentElement)) {
          return button;
        }
      }
    }
    return null;
  }

  function findTaskListHostFromWraps(wraps) {
    const parentCount = new Map();
    wraps.forEach((wrap) => {
      const parent = wrap.parentElement;
      if (!parent) return;
      const count = parentCount.get(parent) || 0;
      parentCount.set(parent, count + 1);
    });
    let host = null;
    let maxCount = 0;
    parentCount.forEach((count, parent) => {
      if (count > maxCount) {
        maxCount = count;
        host = parent;
      }
    });
    return host;
  }

  function ensureUnpagedContainer(taskListHost) {
    if (!(taskListHost instanceof HTMLElement)) return null;
    let container = document.getElementById(UNPAGED_LIST_ID);
    if (container instanceof HTMLElement) return container;
    container = document.createElement("div");
    container.id = UNPAGED_LIST_ID;
    container.style.width = "100%";
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "12px";
    taskListHost.parentElement?.insertBefore(container, taskListHost);
    return container;
  }

  function hidePaginationRoots() {
    PAGINATION_ROOT_SELECTORS.forEach((selector) => {
      const roots = document.querySelectorAll(selector);
      roots.forEach((root) => {
        if (!(root instanceof HTMLElement)) return;
        root.style.display = "none";
      });
    });
  }

  function collectUnarchivedWraps() {
    const wraps = document.querySelectorAll(`[${WRAP_ATTR}="1"]`);
    const result = [];
    wraps.forEach((wrap) => {
      if (!(wrap instanceof HTMLElement)) return;
      if (wrap.getAttribute(ARCHIVED_ATTR) === "1") return;
      if (wrap.closest(`#${UNPAGED_LIST_ID}`)) return;
      result.push(wrap);
    });
    return result;
  }

  function moveCurrentPageToUnpagedContainer() {
    const wraps = collectUnarchivedWraps();
    if (!wraps.length) return 0;
    const host = findTaskListHostFromWraps(wraps);
    const container = ensureUnpagedContainer(host);
    if (!(container instanceof HTMLElement)) return 0;
    let moved = 0;
    wraps.forEach((wrap) => {
      if (!(wrap instanceof HTMLElement)) return;
      wrap.setAttribute(ARCHIVED_ATTR, "1");
      container.appendChild(wrap);
      moved += 1;
    });
    return moved;
  }

  async function runUnpagedListFlow() {
    if (!unpagedEnabled || unpagedRunning) return;
    unpagedRunning = true;
    try {
      let guard = 0;
      while (guard < 80) {
        guard += 1;
        scanAndEnhance();
        moveCurrentPageToUnpagedContainer();
        hidePaginationRoots();
        const nextButton = findNextPageButton();
        if (!(nextButton instanceof HTMLElement)) break;
        nextButton.click();
        await sleep(700);
      }
    } finally {
      unpagedRunning = false;
    }
  }

  function scheduleUnpagedFlow() {
    if (!unpagedEnabled) return;
    if (unpagedTimer) return;
    unpagedTimer = window.setTimeout(() => {
      unpagedTimer = null;
      runUnpagedListFlow();
    }, 350);
  }

  function hideFeedbackButton() {
    const feedbackButtons = document.querySelectorAll(FEEDBACK_BTN_SELECTOR);
    feedbackButtons.forEach((element) => {
      if (!(element instanceof HTMLElement)) return;
      if (hideFeedbackEnabled) {
        element.style.display = "none";
        element.style.visibility = "hidden";
        element.style.pointerEvents = "none";
      } else {
        element.style.removeProperty("display");
        element.style.removeProperty("visibility");
        element.style.removeProperty("pointer-events");
      }
    });
  }

  function scanAndEnhance() {
    if (observerPaused) return;
    observerPaused = true;
    hideFeedbackButton();
    refreshHiddenTaskDisplay();
    const cards = collectCards();
    cards.forEach((card, index) => {
      if (!(card instanceof HTMLElement)) return;
      const existingWrap = card.closest(`[${WRAP_ATTR}="1"]`);
      if (existingWrap?.querySelector(`[${TOOL_ATTR}="1"]`)) {
        if (existingWrap instanceof HTMLElement && !existingWrap.getAttribute(CARD_KEY_ATTR)) {
          const id = ensureCardId(card, index);
          existingWrap.setAttribute(CARD_KEY_ATTR, `${KEY_PREFIX}${id}`);
        }
        return;
      }

      const id = ensureCardId(card, index);
      const key = `${KEY_PREFIX}${id}`;
      const wrap = createWrap(card);
      if (!wrap) return;
      if (wrap.querySelector(`[${TOOL_ATTR}="1"]`)) return;
      buildTools(card, wrap, key);
    });
    observerPaused = false;
    return cards.length;
  }

  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = window.setTimeout(() => {
      scanTimer = null;
      hideFeedbackButton();
      const matchedCount = scanAndEnhance();
      if (matchedCount > 0) {
        ensureFab();
        scheduleUnpagedFlow();
      } else {
        removeFab();
      }
    }, 120);
  }

  const observer = new MutationObserver(() => {
    scheduleScan();
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("hashchange", scheduleScan);
  Promise.all([
    readBooleanState(FEEDBACK_TOGGLE_KEY, true),
    readBooleanState(SHOW_HIDDEN_TASKS_KEY, false),
    readBooleanState(UNPAGED_LIST_KEY, true)
  ]).then(([feedbackValue, showHiddenValue, unpagedValue]) => {
    hideFeedbackEnabled = feedbackValue;
    showHiddenTasks = showHiddenValue;
    unpagedEnabled = unpagedValue;
    scheduleScan();
  });
})();
