# 模块：CLI 与打包

> 状态：✅ MVP 已实现
> 最近更新：2026-09-26

## 摘要
CLI 提供本地开发、契约校验、增量联调和修复工作流；Dockerfile/Compose 提供单机部署基线。

## CLI
```bash
giteehelper doctor
giteehelper manifest validate
giteehelper contract test
giteehelper integration run <module-key> [event-id]
giteehelper status <run-id>
giteehelper repair create <impact-id>
giteehelper repair review <repair-id>
giteehelper repair apply <repair-id>
giteehelper repair test <repair-id>
giteehelper repair approve <repair-id>
```

## 关键文件
- `bin/giteehelper.js`
- `src/cli/index.ts`
- `Dockerfile`
- `docker-compose.yml`
- `.dockerignore`

## 命令语义
- `doctor`：只显示配置状态，不显示秘密；
- `manifest validate`：校验 key、重复模块、负责人、路径和契约注册；
- `contract test`：契约未注册会失败，provider 未提交会列为 `stubbed`；
- `repair apply` 使用 `git apply --check` 后才应用；
- `repair approve` 要求已 test，且只授权修复分支/PR。

## 验证
- `npm run build` 通过；
- Docker 单服务构建定义完成；
- CLI Doctor、manifest 和 contract 命令已实际运行；
- 修复 Bundle 流程有 Node Test 覆盖；
- 测试与生产数据隔离：`npm test` 前由 `pretest` 执行 `scripts/reset-test-db.mjs`，并把 `DATABASE_PATH` 指向 `data/test/giteehelper-test.db`。此前测试直接连 `data/giteehelper.db`，`seed()`、修复包创建和清理用例都会改写真实数据（真实库里因此留下 21 条由测试生成的「已批准」修复包），现在真实库不再被测试触碰；
- 当前共 25 个测试用例，覆盖 WebHook 签名与事件标准化、影响匹配精度、提交语义解析与幂等、契约版本兼容、负责人配色、联调桩、Repair Bundle 与审批边界、误导数据清理。

## Bug 与问题记录

### BUG-001 Docker 容器只监听回环地址（2026-09-27，已解决）
- 错误行为：WHEN Docker 将宿主机 8787 映射到容器 8787 THEN 服务只监听容器 `127.0.0.1`，宿主机和公网访问被连接重置。
- 期望行为：WHEN 在生产模式运行容器 THEN 服务 SHALL 监听 `0.0.0.0`，允许 Docker 端口映射转发流量。
- 不可破坏的行为：WHEN 本地开发模式运行 THEN 服务 SHALL CONTINUE TO 默认只监听 `127.0.0.1`。
- 根因：Express 启动地址硬编码为 `127.0.0.1`，容器网络无法通过该地址访问进程。
- 解决方式：根据 `NODE_ENV=production` 动态选择 `0.0.0.0`，开发模式保持 `127.0.0.1`。
- 验证方式：容器内外健康检查返回 200，宿主机公网端口可访问。

## 已知限制
- 尚未在 CI 中构建 Docker 镜像，仓库内也没有 lint / formatter 配置；
- `repair test` 是用户本地测试结果的记录命令，不会自动猜测项目测试命令；
- 测试脚本用 `DATABASE_PATH=...` 前缀传环境变量，依赖 POSIX shell，Windows 原生终端需自行设置；
- MCP 暴露尚未实现。

## 变更历史
| 日期 | 变更 | 关联需求 |
|---|---|---|
| 2026-09-26 | 完成 CLI、Repair 命令、Dockerfile 和 Compose | 实施阶段 6、7 |
| 2026-09-27 | 修复 Docker 生产模式端口监听地址 | BUG-001 |
| 2026-09-28 | 测试改用独立数据库，新增 14 个用例（共 25 个） | 测试隔离 |
| 2026-09-28 | `doctor` 等命令启动时加载 Secret Store，修复已配置项被报成 missing | 诊断准确性 |
