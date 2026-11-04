# GitHub Scrum 核验：课程第 40–43 页

核验及补齐日期：2026-11-04。依据 [ISWEP.pdf](https://bettermorn.github.io/IntelligentSWEPractice/courseware/ISWEP.pdf) 的 PDF 物理页码 40–43。修复跟踪：[#11](https://github.com/LJHSTO/edu-promaic/issues/11)。首次只读核验发现看板缺卡；用户登录后，已在原项目实际补录并检查 Workflows，下表反映补齐后的配置。

## 1. 逐页结论

| 页码 | 要求 | 实际证据与本轮处理 | 结论 |
|---|---|---|---|
| 40 | Projects、Milestones、Issues 支撑计划—执行—追踪—复盘 | 三类入口均存在；当前任务已入板，计划绑定和[实际复盘](../retrospection/week3_scrum_retrospective.md)已同步 | 已落实 |
| 41 | Backlog / To Do / In Progress / In Review / Done 五列 | [任务看板](https://github.com/users/LJHSTO/projects/1/views/3)为 board，Status 为待整理、待办、进行中、待评审、已完成 | 已完成 |
| 41 | 卡片关联 Issue / PR，反映 Sprint Backlog | 已在原项目添加 #7/#8/#9/#11；共 9 张 Issue 卡，#7 已完成、#8/#9 待办，#11 在修复合并前进行中 | 已实际补齐 |
| 41 | PR 合并后自动进入 Done | 登录后读取 `Pull request merged`：On，目标 `Status: 已完成`；`Item closed` 同为 On，覆盖 issue、pull request，目标相同 | 已核对实际配置 |
| 41 | 可挂 Story Points、类型标签；可用 Insights 燃尽图 | 标签已使用；Story Points 字段和燃尽图未配置。课件用“可挂”“可借助”说明辅助方式 | 可选项，不作为必达项冒充完成 |
| 42 | Milestone 起止日期、Issue 绑定、负责人 | 真实 Milestone #1/#2/#3 存在，描述写起止日期，Due 分别为 10-26/11-09/11-23；本轮实际补 #7/#8/#9 的 Assignees 和 Milestone | 已完成当前任务绑定 |
| 42 | Table / Roadmap 排期视图 | 同一项目的[迭代排期](https://github.com/users/LJHSTO/projects/1/views/4)是 Table，按 Milestone 分组，展示 Title/Assignees/Status/Labels/Milestone | 已完成 Table；未声称另有 Roadmap |
| 42 | Daily、Review、Retro 支撑 | [沟通计划](communication_mgmt_plan.md)已有状态和同步规则；本轮补计划关联及复盘。没有虚构站会或团队评审已经召开 | 机制与本轮记录已具备 |
| 43 | 标准缺陷表单，复现、预期/实际、优先级 | [.github/ISSUE_TEMPLATE/bug_report.yml](../../.github/ISSUE_TEMPLATE/bug_report.yml)已有必填环境、步骤、预期、实际、P0/P1/P2 | 已完成 |
| 43 | bug / priority 标签、Milestone、负责人 | 将本轮真实配置缺陷 #11 标为 bug、priority:P2、documentation，指派 LJHSTO，绑定 Milestone #2 | 已实际完成 |
| 43 | Bug 也进入同一 Kanban | #11 已入同一看板，Table 显示 bug、priority:P2、LJHSTO、Milestone #2 及进行中状态 | 已实际补齐 |
| 43 | Fixes 关联并关闭已解决的 Issue | [PR #10](https://github.com/LJHSTO/edu-promaic/pull/10)已使用 `Fixes #7`；本次完整修复 PR 使用 `Fixes #11`，以合并后的 Issue 时间线和项目状态记录闭环 | 已采用；实际关闭与移列结果记录于 #11 |

结论：**第 40–43 页的协作配置已补齐**。原有五列、Milestones、Table 和缺陷表单保留；新增卡片、负责人、真实 Milestone、自动移列和新任务自动入板均已在实际项目核对。自学任务 #8/#9 仍未执行，会议、课堂汇报与教师评审另行记录。

## 2. 当前计划与实际绑定

| Issue | 当前状态 | 跟踪负责人 | 真实 GitHub Milestone | 目标与说明 |
|---|---|---|---|---|
| [#7 第三周交付](https://github.com/LJHSTO/edu-promaic/issues/7) | 已关闭，PR #10 已合并 | LJHSTO | #2：10-27 至 11-09 | 11-04 材料入库；课堂确认待进行 |
| [#8 会话与事件 PoC](https://github.com/LJHSTO/edu-promaic/issues/8) | 开放，未执行 | LJHSTO | #3：11-10 至 11-23 | 子目标 11-11；11-05 可开始自学准备 |
| [#9 课程包、授权与测量](https://github.com/LJHSTO/edu-promaic/issues/9) | 开放，未执行 | LJHSTO | #3：11-10 至 11-23 | 子目标 11-18，未将计划记为实测 |
| [#11 看板同步缺陷](https://github.com/LJHSTO/edu-promaic/issues/11) | 配置修复完成，随关联 PR 合并关闭 | LJHSTO | #2：10-27 至 11-09 | 实际关闭与自动移列结果见 Issue 时间线 |

LJHSTO 沿用仓库现有维护责任，负责跟踪和组织认领；具体开发执行人仍待团队认领。两个自学子目标均早于 Milestone #3 的截止日期，不将 #8 错绑到 11-09 截止的迭代 #2，也不擅自修改既有迭代日期。

## 3. 缺陷闭环与同步规则

本轮 #11 的原始缺陷是从仓库 Issues 可看到 #8/#9，但进入看板没有相应卡片，只剩 5 个历史事项。因仍可直接从 Issues 跟踪，评为 P2；本轮补入缺卡并启用 Auto-add，处理真实配置缺口，没有捏造产品故障或真实学生事故。

1. 用缺陷表单记录步骤、环境、预期/实际、关联要求；维护者核定 `bug` 与一个 `priority:P0/P1/P2`，设置负责人和 Milestone。
2. 将 Issue 加入同一个项目，未开工为待办，开始处理为进行中，已有完整可评审变更再转待评审。
3. 完整修复的 PR 使用 `Fixes #编号`，合入默认分支后检查 Issue 关闭及卡片状态。部分处理使用 `Refs #编号`；前次 PR #12 只处理文档和元数据，故使用 Refs，本次补齐实际配置后才使用 Fixes。
4. 已关闭不必然代表完成验收：重复、取消事项保留原因；核对自动化后仍需检查这一边界。
5. Daily 从进行中列记录完成、下一步和阻塞；Review 查看 Milestone 关闭数/总数、演示和验证；Retro 在 `docs/retrospection/` 记录事实和行动。会议是否召开另记，不由模板推定。

## 4. 实际 Projects 操作与验收

操作对象是原有项目。用户登录后，通过已登录的内置浏览器直接操作并读取保存结果，没有新建重复看板或更改访问权限。

- [x] 添加 #7 为已完成、#8/#9 为待办、#11 为进行中。#4 是重复事项，没有据其关闭状态记成完成。
- [x] 核对 [Item closed](https://github.com/users/LJHSTO/projects/1/workflows/122952482)：On，issue/pull request → 已完成。
- [x] 核对 [Pull request merged](https://github.com/users/LJHSTO/projects/1/workflows/122952484)：On → 已完成。
- [x] 启用 [Auto-add to project](https://github.com/users/LJHSTO/projects/1/workflows/128753236)：仓库为 LJHSTO/edu-promaic，用户筛选为 `is:issue is:open`。保存后显示 On，项目启用规则数从 6 增为 7；GitHub 自动补充显示的 `is:issue,pr` 类型前缀不改变此处 Issue 筛选条件。
- [x] 在 Table 逐行核对 9 张 Issue 卡。Milestone #1 为旧 5 项；#2 为 #7/#11；#3 为 #8/#9。新四项的 Assignees 均为 LJHSTO。

本次关联修复 PR 也加入看板的待评审列。合并时检查 PR 自动进入已完成，以及 #11 被 Fixes 关闭后自动进入已完成；事件结果由 #11 的最终核验记录保存，不额外制造测试 Issue。之后项目会同时包含 9 张 Issue 卡和该真实修复 PR 卡。

首次核验曾受登录条件限制；本轮用户已登录后，该阻塞已解除。连接器继续用于仓库文档与 Issue 记录，Projects 设置通过可编辑浏览器会话完成，没有创建令牌。

## 5. 验证范围

实际读取并操作了五列、9 张 Issue 卡、两个视图及三条相关 Workflows；Table 中的状态、负责人和 Milestone 已核对。工作流检查基于已登录页面的 On 和目标字段，不再只依赖公开页面或历史说明。

本轮补实际项目设置并同步协作文档，不修改产品运行代码。前次 PR #12 的 20 项测试和四组矩阵检查通过；本次仓库要求的语法、20 项测试、文档链接及 UTF-8 检查结果随关联修复 PR 记录。未进行教学内容、成员会议或真实课堂效果的新验收。
