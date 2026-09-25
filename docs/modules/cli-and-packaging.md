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
- 修复 Bundle 流程有 Node Test 覆盖。

## 已知限制
- 尚未在 CI 中构建 Docker 镜像；
- `repair test` 是用户本地测试结果的记录命令，不会自动猜测项目测试命令；
- MCP 暴露尚未实现。

## 变更历史
| 日期 | 变更 | 关联需求 |
|---|---|---|
| 2026-09-26 | 完成 CLI、Repair 命令、Dockerfile 和 Compose | 实施阶段 6、7 |
