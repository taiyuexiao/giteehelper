# 模块：使用指南

> 状态：✅
> 最近更新：2026-09-26

## 最快开始
1. 在项目目录运行 `npm run dev`，或直接访问已启动的 `http://127.0.0.1:8876`。
2. 使用 `.env` 中的 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 登录。
3. 进入“接入设置”，确认 Gitee Token、目标仓库和主分支。
4. 进入“模块与契约”，把示例模块替换为真实模块、负责人、路径、契约和共享场景。
5. 进入“规则”，确认规范、Review 和契约变化规则。
6. 配置飞书群机器人后发送测试消息。

## 日常工作流
### 1. 看变化影响
- 打开“待处理”查看阻塞、契约和待确认项；
- 点击“关系图”聚焦某个事件；
- 在节点检查器查看证据关系和置信度。

### 2. 跑增量联调
- 打开“联调运行”；
- 输入模块 Key；
- 查看真实模块与契约桩矩阵；
- `contract_verified` 不等于真实联调完成。

### 3. 生成修复
- 在“待处理”点击“生成修复”；
- 在“修复包”查看 diff、测试补丁和来源；
- 本地执行：
  ```bash
  npm run cli -- repair review <repair-id>
  npm run cli -- repair apply <repair-id>
  npm run cli -- repair test <repair-id>
  ```
- 人工批准后再创建修复分支/PR，禁止直接写主干。

### 4. 接入真实事件
- Gitee WebHook 回调：`https://<公网域名>/api/webhooks/gitee`；
- 本地没有公网地址时，先使用“同步 Gitee PR”或本地测试事件验证；
- 飞书未配置时只产生 dry-run 审计。

## 资料入口
- [产品规格](product-spec.md)
- [技术设计](technical-design.md)
- [Gitee/飞书接入](gitee-feishu-integrations.md)
- [影响、联调与修复](impact-and-integration.md)
