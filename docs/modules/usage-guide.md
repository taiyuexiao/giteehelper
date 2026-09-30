# 模块：使用指南

> 状态：✅
> 最近更新：2026-09-29

## 最快开始
1. 在项目目录运行 `npm run dev`，或直接访问已启动的 `http://127.0.0.1:8787`（默认端口 8787，由 `PORT` 覆盖）。
2. 使用 `.env` 中的 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 登录；未设置 `ADMIN_PASSWORD` 时，服务启动会生成随机管理员密码并只在控制台打印一次。
3. 进入“接入设置”，直接填写 Gitee API Base、Token、WebHook Secret、仓库和主分支；敏感值留空表示保持不变。目标仓库字段右侧的问号包含企业和个人仓库示例。
4. 进入“模块与契约”，把示例模块替换为真实模块、负责人、路径、契约和共享场景。
5. 进入“规则”，确认规范、Review 和契约变化规则。
6. 配置飞书群机器人后发送测试消息。

## 日常工作流
### 1. 看变化影响
- 打开“待处理”查看阻塞、契约和待确认项；
- 点击“关系图”聚焦某个事件；
- 在节点检查器查看证据关系和置信度。

### 2. 逛仓库全景（`/repo`）
- 3D 全景按负责人分区展示仓库、模块与最近提交；新提交带脉冲特效，60 秒自动刷新；
- 未读提示条给出新提交数，「跳到最新」直接飞过去；三级下钻（仓库 → 负责人区域 → 模块）用点击和面包屑导航；
- 没有公网回调的时段，用「补齐提交」手动回填最近 30 个提交。

### 3. 读懂飞书通知
- 卡片头部写**提交作者（姓名+邮箱）**、**推送账号**、（PR 事件另有）**PR 作者**——账号常被多人共用，对齐时找的是人不是账号；
- 「依据」一行分档：有文件路径证据的是**确定**影响（列出具体文件）；只有语义匹配的标**（线索）**，请人工判断是否真的读写过该契约；
- 只有「确定 + 契约/阻塞级」才挂 ⚠ 需确认；卡片尾部若列出在飞 PR，说明主干这次前进会波及它们，需要合并同步后重跑门禁。

### 4. 跑增量联调
- 打开“联调运行”，输入模块 Key；
- 查看真实模块与契约桩矩阵；`contract_verified` 不等于真实联调完成。

### 5. 生成修复
- 在“待处理”点击“生成修复”；
- 在“修复包”查看 diff、测试补丁和来源；
- 本地执行：
  ```bash
  npm run cli -- repair review <repair-id>
  npm run cli -- repair apply <repair-id>
  npm run cli -- repair test <repair-id>
  ```
- 人工批准后再创建修复分支/PR，禁止直接写主干。

### 6. 接入真实事件
- Gitee WebHook 回调：`https://<公网域名>/api/webhooks/gitee`；
- 本地没有公网地址时，先使用“同步 Gitee PR”或本地测试事件验证；
- 飞书未配置时只产生 dry-run 审计。

## 归属精度运营（命令行）
归属精度取决于「事件里有没有文件」和「模式能不能命中它」。推荐顺序：

```bash
npm run cli -- pattern-health               # 1. 体检：哪些模块的模式命不中任何文件
npm run cli -- pattern-fix --apply          # 2. 机械修复（语义不变）；文档侧改写加 --include-review 人工确认
npm run cli -- rfc-sync                     # 3. 拉取 RFC meta，反查工作项归属
npm run cli -- rfc-coverage                 # 4. 哪些模块没有契约背书（精度上限就在这里）
npm run cli -- rfc-apply --apply            # 5. 应用契约反查出的精确模式
npm run cli -- sync-pulls                   # 6. 拉全量 PR（默认带未合并 PR 的文件）建依赖图
npm run cli -- backfill-files --fetch       # 7. 给历史 PR/评论事件补文件列表
npm run cli -- reanalyze                    # 8. 用新规则+新证据重算全部历史影响
```

改完模式或补完文件后**一定要 reanalyze**，否则库里还是旧规则的噪声影响。实测一轮走完：事件覆盖 7%→38%，路径证据覆盖的影响 190→554 条，重算后总影响 510→67 条。

## 修正历史通知的提交者身份
早期版本把 PR 提交列表里**最老**的提交当成"提交者"，历史事件的 payload 里存的可能是错的人（控制台回看旧记录时可见）。修复只对新事件生效，历史数据用：

```bash
npm run cli -- backfill-pull-head            # 预览会修正哪些事件（回查 Gitee 提交列表，只读）
npm run cli -- backfill-pull-head --apply    # 应用修正
```

重算按事件当时的 head sha 精确定位；head sha 缺失或被 force push 抹掉时取「事件时刻之前」的最新提交；都不行就如实记 unresolved，不按位置猜。也可在「接入设置」所在的服务器上调用 `POST /api/admin/backfill-pull-head`（后台执行，完成情况看审计日志）。

## 资料入口
- [产品规格](product-spec.md)
- [技术设计](technical-design.md)
- [Gitee/飞书接入](gitee-feishu-integrations.md)
- [影响、联调与修复](impact-and-integration.md)
- [仓库全景与实时提交同步](repo-panorama.md)
- [CLI 与打包](cli-and-packaging.md)
