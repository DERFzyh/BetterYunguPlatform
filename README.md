# Task Yungu 卡片置顶/隐藏插件

## 功能
- 针对 `task.yungu.org` 页面中 class 形如 `studenttabcardbox___...` 的元素。
- 在每个卡片底部增加两个按钮：`置顶`、`隐藏`。
- 点击后会记住状态，刷新页面后仍生效。
- 自动将分页任务列表合并为一个滚动列表（插件加载后自动执行）。

## 安装方式（Chrome）
1. 打开 `chrome://extensions/`。
2. 打开右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择当前目录 `task-yungu-pin-hide-extension`。

## 功能列表

### 1. 卡片置顶/隐藏（content.js）
- `置顶`：把该卡片移动到父容器最前面。
- `隐藏`：直接隐藏该卡片。
- 再次点击对应按钮可取消状态。

### 2. 标记为已交（mark-submit.js）
- 在任务详情页（`#/stuTaskInfo/{id}/...`）右侧面板底部添加「✅ Mark as submitted」按钮。
- 点击后调用 API 将该任务标记为已交（status=4）。
- 即使任务配置了「需要附件」（needEnclosure=true），也能通过此按钮提交。
- 已交的任务会显示绿色已交状态，不会重复提交。
