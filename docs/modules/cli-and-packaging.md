# 模块：CLI 与打包

> 状态：✅ MVP 已实现
> 最近更新：2026-09-29

## 摘要
CLI 提供本地开发、契约校验、增量联调、修复工作流，以及一组**仓库运营命令**（模式体检、契约反查、PR 数据、历史重算）；Dockerfile/Compose 提供单机部署基线。

## CLI
```bash
# 本地开发与联调
giteehelper doctor
giteehelper manifest validate
giteehelper contract test
giteehelper integration run <module-key> [event-id]
giteehelper status <run-id>

# 仓库运营（归属精度与 PR 数据）
giteehelper pattern-health                     # 模式体检，存在失效模式时退出码非 0
giteehelper pattern-fix [--apply] [--include-review]
giteehelper rfc-sync                           # 只读拉取 docs/rfcs/meta/*.json
giteehelper rfc-coverage                       # 契约覆盖缺口，有未覆盖模块时退出码非 0
giteehelper rfc-apply [--apply]                # 预览/应用契约反查出的模式
giteehelper sync-pulls [--with-comments] [--no-files]
giteehelper pulls                              # PR 统计与依赖概览
giteehelper backfill-files [--fetch] [--max=N] # 回填历史事件缺失的文件列表
giteehelper backfill-pull-head [--apply] [--max=N] # 重算历史 PR 事件的提交者身份（head sha 定位）
giteehelper reanalyze                          # 按当前规则重算全部历史影响

# 清理与修复
giteehelper cleanup misleading-data
giteehelper repair create <impact-id>
giteehelper repair review <repair-id>
giteehelper repair apply <repair-id>
giteehelper repair test <repair-id>
giteehelper repair approve <repair-id>
```

npm scripts 下用 `npm run cli -- <command>` 调用。

## 关键文件
- `bin/giteehelper.js`
- `src/cli/index.ts`
- `Dockerfile` / `docker-compose.yml` / `.dockerignore`

## 命令语义
- `doctor`：先加载 Secret Store 再检查配置，只显示 configured/missing，不显示秘密（否则 Web 端已配置的 Token/飞书会被误报 missing）；
- `manifest validate`：校验 key、重复模块、负责人、路径和契约注册；
- `contract test`：契约未注册会失败，provider 未提交会列为 `stubbed`；
- `pattern-health` / `pattern-fix` / `rfc-*` / `backfill-files`：语义见影响模块的「归属三支柱」与「PR 级依赖图」。要点：pattern-fix 默认只做语义不变的机械修复；rfc-apply 未 `--apply` 时只打印预览；sync-pulls 默认连未合并 PR 的文件一起拉（`--no-files` 关闭），`--with-comments` 才拉评论；backfill-files 默认零 API 调用，`--fetch` 才按需回查（只读）并缓存回库；
- `backfill-pull-head`：修正历史 PR 事件的 `pullHead`（旧版把 `/pulls/{n}/commits` 的最老提交当成"提交者"）。默认**只预览**会修正哪些事件（回查 Gitee 提交列表，只读，每个 PR 分页拉全并只拉一次，`--max` 限回查的 PR 数，默认 200）；`--apply` 才写库。重算规则：事件 payload 里的 head sha 精确匹配 → 缺失/被 force push 抹掉时取「事件时刻之前」的最新提交 → 都不行记 unresolved。也可 `POST /api/admin/backfill-pull-head` 触发（202 受理后后台执行，看审计日志 `backfill_pull_head`）；
- `reanalyze`：按当前匹配规则重算全部历史影响（提交先删再按原始字段重新入库，`analysis_json`/`severity`/`conflict` 一并刷新），用于匹配规则收紧或补文件后清理旧噪声；也可 `POST /api/admin/reanalyze` 触发（202 受理后后台执行，完成情况看审计日志 `reanalyze_impacts`）。**实测顺序**：改模式/补文件后先 backfill 再 reanalyze；
- `repair apply` 使用 `git apply --check` 后才应用；`repair approve` 要求已 test，且只授权修复分支/PR。

## 验证
- `npm run build` 通过；Docker 单服务构建定义完成；
- 测试与生产数据隔离：`npm test` 前由 `pretest` 执行 `scripts/reset-test-db.mjs`，并把 `DATABASE_PATH` 指向 `data/test/giteehelper-test.db`（此前测试直连真实库，留下过 21 条测试生成的「已批准」修复包）；
- `npm test` 60 项通过（`tests/` 下 12 个文件），覆盖：WebHook 签名与事件标准化、影响匹配精度（深层路径/中文分词/停用词）、影响原因分类、RFC 契约反查（三件套模式、同名类不生成）、通知分组与身份、提交语义解析与幂等、**提交影响自带分档（确定/线索）**、历史 pullHead 重算（head sha 定位、事件时间界）、卡片概要与事件类型标注、契约版本兼容、联调桩、Repair Bundle 与审批边界、误导数据清理；
- 测试串行运行（`--test-concurrency=1` + SQLite `busy_timeout`），见后端平台 BUG-001。

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
- `pattern-health`/`rfc-sync` 等命令每次全量拉取文件树/PR，未做增量缓存；
- MCP 暴露尚未实现。

## 变更历史
| 日期 | 变更 | 关联需求 |
|---|---|---|
| 2026-09-26 | 完成 CLI、Repair 命令、Dockerfile 和 Compose | 实施阶段 6、7 |
| 2026-09-27 | 修复 Docker 生产模式端口监听地址 | BUG-001 |
| 2026-09-28 | 测试改用独立数据库 | 测试隔离 |
| 2026-09-28 | `doctor` 等命令启动时加载 Secret Store | 诊断准确性 |
| 2026-09-28 | 新增 `reanalyze` 与 `/api/admin/reanalyze` | 匹配精度 |
| 2026-09-28 | 新增 `pattern-health` / `pattern-fix` | 模式体检 |
| 2026-09-28 | 新增 `rfc-sync` / `rfc-coverage` / `rfc-apply` | 契约即代码 |
| 2026-09-28 | 新增 `sync-pulls`（默认带未合并 PR 文件）/ `pulls` | PR 级依赖图 |
| 2026-09-28 | 新增 `backfill-files [--fetch]`，回填 PR 文件到历史事件 | 归属准确度 |
| 2026-09-29 | 文档补齐仓库运营命令组与测试数（54 项 / 11 文件） | 文档同步 |
| 2026-09-29 | 新增 `backfill-pull-head [--apply]` 与 `/api/admin/backfill-pull-head`，重算历史 PR 事件的提交者身份 | 通知身份修复 |
