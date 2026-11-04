# 第三周后的两周自学计划与里程碑

制定日期：2026-11-04；执行窗口：2026-11-05 至 2026-11-18。按当前日期起算，不沿用 10 月候选排期。LJHSTO 组织认领、收集产物，执行人待组员认领，不虚构成员承诺或会议。

## 1. 学习任务

| 时段 | 新技术与问题 | 官方材料 / 练习 | 可检查产物 |
|---|---|---|---|
| 11-05–11-06 | 服务端状态机、HTTP 契约，客户端不能解除验证 | [Node HTTP](https://nodejs.org/api/http.html)；设计 phase/eventId/sequence | 状态表、请求/错误 Schema、伪造阶段测试 |
| 11-07–11-08 | SQLite 事务、唯一键、驱动兼容与锁等待 | [事务](https://www.sqlite.org/lang_transaction.html)、[适用场景](https://www.sqlite.org/whentouse.html)；临时库重传同事件三次 | PoC、版本锁定理由；只存一条，失败回滚 |
| 11-09–11-11 | 会话恢复、幂等事件、重启回放 | 合成会话重启服务，模拟存储失败 | M-W3-1 会话与事件 PoC 包 |
| 11-12–11-13 | 课程包版本、来源、结构化模型草稿 | [DeepSeek JSON](https://api-docs.deepseek.com/guides/json_mode/)、[Ollama Schema](https://docs.ollama.com/capabilities/structured-outputs)；假响应测空值和越界 | 课程包 Schema、审核状态、无密钥故障夹具 |
| 11-14–11-15 | 教师授权与统计分母 | 合成班级 A/B 隔离，未开始/首次失败/重试分开 | 授权矩阵、跨班级拒绝、统计测试 |
| 11-16–11-18 | 并发请求、预热、延迟分位数 | 按 NFR-9/10 测量，保留原始数据 | M-W3-2 课程包、授权与测量报告 |

## 2. Milestone

| 里程碑 | 目标日期 | 完成判据 | 未通过时 |
|---|---|---|---|
| M-W3-1 会话与事件 PoC | 2026-11-11 | 代码/环境/事务与重传用例；刷新或伪造字段不能绕过服务端验证；只用合成数据 | 缩到单题，不增加课程，记录阻塞 |
| M-W3-2 课程包、授权与测量 | 2026-11-18 | Schema、审核入口设计、跨班级拒绝、耗时原始数据及 P50/P95/P99/失败率 | 不以目标代替实测，保留本机模板路线 |

计划尚未执行。原型与选型待教师确认；确认前可用合成数据完成自学 PoC，真实系统开发按课堂检查点推进。模型在线接入、真实班级数据、公开部署不是两周默认承诺。

## 3. 协作追踪

追踪入口：[第三周交付 #7](https://github.com/LJHSTO/edu-promaic/issues/7)、[M-W3-1 #8](https://github.com/LJHSTO/edu-promaic/issues/8)、[M-W3-2 #9](https://github.com/LJHSTO/edu-promaic/issues/9)。两个学习任务保持未完成，认领时记录执行人、US/FR/NFR、验收样例和里程碑编号。以 PR 提交笔记和 PoC，附环境及失败证据。

2026-11-04 补核：#8/#9 已实际绑定现有 [GitHub Milestone #3](https://github.com/LJHSTO/edu-promaic/milestone/3)（11-10 至 11-23），跟踪负责人为 LJHSTO，具体开发人待团队认领。上表的 M-W3-1/M-W3-2 是该迭代下的自学子目标，截止日仍为 11-11/11-18；11-05 起的自学属于前置准备，没有新建同名 GitHub Milestones。

第三周交付 #7 归入既有 Milestone #2（10-27 至 11-09）。用户登录后，#7/#8/#9/#11 已补入同一实际看板，关闭与合并自动移列均确认 On，新开放 Issue 自动入板已启用。配置修复由 [#11](https://github.com/LJHSTO/edu-promaic/issues/11) 与关联 PR 记录；#8/#9 继续保持待办，未将自学计划记为已执行。逐项证据见[Scrum 核验](github_scrum_audit.md)，第三周入口见[交付记录](week3_delivery.md)。旧迭代计划保留历史。
