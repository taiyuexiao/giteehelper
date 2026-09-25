# 模块：Web 控制台

> 状态：✅ MVP 已实现
> 最近更新：2026-09-26

## 摘要
React/Vite Web 控制台提供完整管理面：登录、待处理、关系图、模块与契约、联调运行、修复包、规则编辑、用户管理、审计中心和接入设置。日常通知仍以 Gitee/飞书为主，GUI 用于配置和诊断。

## 页面
- `/`：Action Inbox、指标、影响与行动；
- `/graph`：React Flow 分层关系图、事件聚焦、搜索、类型过滤、来源/置信度；
- `/modules`：模块/契约、新建模块、发起联调；
- `/runs`：联调记录、真实/Stub 组合、运行结果；
- `/repairs`：修复包 diff、测试、批准、下载；
- `/rules`：YAML 规则编辑、启停、dry-run；
- `/users`：角色和 Gitee/飞书身份映射；
- `/audit`：资源/动作筛选；
- `/integrations`：Gitee/飞书连接、项目配置、检查清单。

## 关键文件
- `src/client/App.tsx`
- `src/client/api.ts`
- `src/client/components.tsx`
- `src/client/pages/*.tsx`
- `src/client/styles.css`

## 设计约束
- 运维型界面使用中性色、8px 卡片圆角和稳定表格/网格；
- 图标使用 lucide-react；
- 桌面侧栏、平板双列、移动单列；
- 不把完整代码发送到飞书；
- 页面只显示配置状态，不显示 Token/Secret。

## 验证
- 登录后 9 个页面均可加载；
- 关系图 DOM、图例、节点详情可见；
- 1280px 视口下页面 `scrollWidth === viewportWidth`，无全局横向溢出；
- Dashboard 显示真实同步 PR 产生的影响；
- 各页面无浏览器运行时错误。

## Bug 与问题记录

### BUG-002 关系图全量力导向导致信息密度过高（2026-09-26，已解决）
- 错误行为：WHEN 打开包含多事件、多契约的关系图 THEN 力导向布局节点拥挤、边标签互相覆盖，用户无法识别主要影响路径。
- 期望行为：WHEN 用户打开关系图 THEN 系统 SHALL 默认聚焦最新事件的影响路径，并提供全景、搜索、类型过滤和节点检查器。
- 不可破坏的行为：WHEN 用户切换全景或搜索 THEN 系统 SHALL CONTINUE TO 允许拖拽、缩放、查看全部节点和关系置信度。
- 根因：全量节点同时参与力导向布局，事件节点数量增长后边标签和节点标签失去稳定位置。
- 解决方式：改用 React Flow 自定义节点，按人员/模块/契约/场景/事件分层布局；默认聚焦最新事件及其直接关系，边标签移入节点检查器。
- 验证方式：默认视图 12 个可见节点、0 个节点重叠、无浏览器错误；搜索、聚焦、节点检查器和全景模式均可操作。

### BUG-001 React Router 缺少 BrowserRouter（2026-09-26，已解决）
- 错误行为：WHEN 登录成功并首次加载控制台 THEN `useLocation()` 抛出 Router Context 错误，页面空白。
- 期望行为：WHEN 登录成功 THEN 系统 SHALL 渲染控制台路由和导航。
- 不可破坏的行为：WHEN 未登录 THEN 系统 SHALL CONTINUE TO 显示登录页。
- 根因：`App.tsx` 使用 `Routes/NavLink`，但 `main.tsx` 未包裹 `BrowserRouter`。
- 解决方式：在 `src/client/main.tsx` 中包裹 `BrowserRouter`。
- 验证方式：重新构建后登录成功，9 个页面均可加载，浏览器错误日志为空。

## 已知限制
- 表单仍以 MVP 表格/Modal 为主，未完成复杂向导；
- 全景模式的大规模节点仍需要虚拟化和更高级聚合；
- 审计分页、用户批量导入、规则 diff 尚未完成。

## 变更历史
| 日期 | 变更 | 关联需求 |
|---|---|---|
| 2026-09-26 | 完成完整控制台、关系图、规则、用户、审计、运行和修复页面 | 实施阶段 5 |
| 2026-09-26 | 修复 Router Context 导致的登录后空白 | BUG-001 |
| 2026-09-26 | 将关系图重构为事件聚焦、分层布局和节点检查器 | BUG-002 |
