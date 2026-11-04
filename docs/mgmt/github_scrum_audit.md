# GitHub Scrum 核验：课程第 40–43 页

核验日期：2026-11-04。依据 [ISWEP.pdf](https://bettermorn.github.io/IntelligentSWEPractice/courseware/ISWEP.pdf) 的 PDF 物理页码 40–43。跟踪缺口：[#11](https://github.com/LJHSTO/edu-promaic/issues/11)。本记录区分公开页面可验证的设置、已实际修改的设置和尚未完成的操作。

## 1. 逐页结论

| 页码 | 要求 | 实际证据与本轮处理 | 结论 |
|---|---|---|---|
| 40 | Projects、Milestones、Issues 支撑计划—执行—追踪—复盘 | 三类入口均存在；本轮补当前任务绑定和[实际复盘](../retrospection/week3_scrum_retrospective.md) | 基础已具备，当前看板同步仍有缺口 |
| 41 | Backlog / To Do / In Progress / In Review / Done 五列 | [任务看板](https://github.com/users/LJHSTO/projects/1/views/3)为 board，Status 为待整理、待办、进行中、待评审、已完成 | 已完成 |
| 41 | 卡片关联 Issue / PR，反映 Sprint Backlog | 本轮读取实际公开数据，仅 #1/#2/#3/#5/#6 共 5 张旧卡，全部已完成；#7/#8/#9 未收录，新缺陷 #11 也待添加 | 未完成，不能用文档任务表代替卡片 |
| 41 | PR 合并后自动进入 Done | 2026-10-14 历史记录称已启用；本轮公开页面不提供可确认的已登录 Workflows 配置 | 本轮未复核，不能声明已通过 |
| 41 | 可挂 Story Points、类型标签；可用 Insights 燃尽图 | 标签已使用；Story Points 字段和燃尽图未配置。课件用“可挂”“可借助”说明辅助方式 | 可选项，不作为必达项冒充完成 |
| 42 | Milestone 起止日期、Issue 绑定、负责人 | 真实 Milestone #1/#2/#3 存在，描述写起止日期，Due 分别为 10-26/11-09/11-23；本轮实际补 #7/#8/#9 的 Assignees 和 Milestone | 已完成当前任务绑定 |
| 42 | Table / Roadmap 排期视图 | 同一项目的[迭代排期](https://github.com/users/LJHSTO/projects/1/views/4)是 Table，按 Milestone 分组，展示 Title/Assignees/Status/Labels/Milestone | 已完成 Table；未声称另有 Roadmap |
| 42 | Daily、Review、Retro 支撑 | [沟通计划](communication_mgmt_plan.md)已有状态和同步规则；本轮补计划关联及复盘。没有虚构站会或团队评审已经召开 | 机制与本轮记录已具备 |
| 43 | 标准缺陷表单，复现、预期/实际、优先级 | [.github/ISSUE_TEMPLATE/bug_report.yml](../../.github/ISSUE_TEMPLATE/bug_report.yml)已有必填环境、步骤、预期、实际、P0/P1/P2 | 已完成 |
| 43 | bug / priority 标签、Milestone、负责人 | 将本轮真实配置缺陷 #11 标为 bug、priority:P2、documentation，指派 LJHSTO，绑定 Milestone #2 | 已实际完成 |
| 43 | Bug 也进入同一 Kanban | #11 尚未进入项目，不能以已经创建 Issue 代替 | 未完成 |
| 43 | Fixes 关联并关闭已解决的 Issue | [PR #10](https://github.com/LJHSTO/edu-promaic/pull/10)含 `Fixes #7`，已合并且 #7 已关闭；补充完整/部分修复的使用规则 | 语法和关联已使用；Projects 自动移列另行核验 |

结论：**并非全部完成**。原有基础设置大部分符合课件，但新增工作没有同步到实际 Projects；本轮已修正可通过连接器处理的负责人、里程碑和缺陷分类，剩余卡片与 Workflows 由 #11 保持开放追踪。

## 2. 当前计划与实际绑定

| Issue | 当前状态 | 跟踪负责人 | 真实 GitHub Milestone | 目标与说明 |
|---|---|---|---|---|
| [#7 第三周交付](https://github.com/LJHSTO/edu-promaic/issues/7) | 已关闭，PR #10 已合并 | LJHSTO | #2：10-27 至 11-09 | 11-04 材料入库；课堂确认待进行 |
| [#8 会话与事件 PoC](https://github.com/LJHSTO/edu-promaic/issues/8) | 开放，未执行 | LJHSTO | #3：11-10 至 11-23 | 子目标 11-11；11-05 可开始自学准备 |
| [#9 课程包、授权与测量](https://github.com/LJHSTO/edu-promaic/issues/9) | 开放，未执行 | LJHSTO | #3：11-10 至 11-23 | 子目标 11-18，未将计划记为实测 |
| [#11 看板同步缺陷](https://github.com/LJHSTO/edu-promaic/issues/11) | 开放，部分处理 | LJHSTO | #2：10-27 至 11-09 | 补当前卡片并复核 Workflows 后再关闭 |

LJHSTO 沿用仓库现有维护责任，负责跟踪和组织认领；具体开发执行人仍待团队认领。两个自学子目标均早于 Milestone #3 的截止日期，不将 #8 错绑到 11-09 截止的迭代 #2，也不擅自修改既有迭代日期。

## 3. 缺陷闭环与同步规则

本轮 #11 是实际配置缺陷：从仓库 Issues 可看到 #8/#9，但进入看板没有相应卡片。预期是当前迭代任务在同一看板排期，实际仍只有 5 个历史事项。因为仍可直接从 Issues 跟踪，评为 P2，不捏造产品故障或真实学生事故。

1. 用缺陷表单记录步骤、环境、预期/实际、关联要求；维护者核定 `bug` 与一个 `priority:P0/P1/P2`，设置负责人和 Milestone。
2. 将 Issue 加入同一个项目，未开工为待办，开始处理为进行中，已有完整可评审变更再转待评审。
3. 完整修复的 PR 使用 `Fixes #编号`，合入默认分支后检查 Issue 关闭及卡片状态。部分处理使用 `Refs #编号`；本轮文档 PR 仅引用 #11，不提前关闭。
4. 已关闭不必然代表完成验收：重复、取消事项保留原因；核对自动化后仍需检查这一边界。
5. Daily 从进行中列记录完成、下一步和阻塞；Review 查看 Milestone 关闭数/总数、演示和验证；Retro 在 `docs/retrospection/` 记录事实和行动。会议是否召开另记，不由模板推定。

## 4. 剩余 Projects 操作与验收

操作对象是现有项目，不再新建重复看板。需能编辑该项目的已登录会话。

- [ ] 添加 #7，状态设为已完成；添加 #8/#9，状态设为待办；添加 #11，保持进行中。#4 为重复事项，不据其关闭状态推定完成。
- [ ] 在 Workflows 中确认 `Item closed` 与 `Pull request merged` 已启用，目标均为现有“已完成”选项。公开 HTML 中的空数组不能证明这些设置启用或停用。
- [ ] 建议启用 Auto-add，筛选 `repo:LJHSTO/edu-promaic is:issue is:open`，避免后续新 Issue 再次遗漏；关闭的 #7 需手动补入。
- [ ] 回到任务看板核对 9 张 Issue 卡（旧 5 张加 #7/#8/#9/#11），在 Table 核对负责人和 Milestone；以截图或操作记录补本节。
- [ ] 后续真实修复 PR 合并时复查 Issue 关闭和卡片自动移列，不为演示制造无意义缺陷。

本轮连接器没有 Projects 写操作；Chrome 自动化因无法可靠识别当前网址被安全机制停止。用户已确认尚未登录 Codex 内置浏览器，因此本轮未继续修改 Projects。没有更改访问权限、创建令牌或声称以上待办已经执行。

## 5. 验证范围

实际读取了公开项目的五列、5 张卡、字段、两个视图，以及仓库 Issues、Milestone 页面和 PR #10 的合并状态；实际写入 #7/#8/#9/#11 的绑定或分类，写入返回结果已核对。Workflows 的当前启用状态无法从公开页面核实。

本轮只改协作文档与 Issue 元数据。在 Windows、Node.js 24.22.1 下实际运行 `npm run check`、`npm test`（20/20）和 `git diff --check`，均通过；8 个变更文件 UTF-8 解码正常，44 处本地文档链接均存在。远端矩阵结果以本次 PR 的 Actions 为准。未进行产品功能、教学内容、成员会议或真实课堂效果的新验收。
