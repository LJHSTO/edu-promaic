# 知点代码评审

## 0. 评审准备

2026 年 11 月 25 日，评审范围包括「函数值与极限」翻转课堂、教学助手与受保护课堂。按课程发布、学生作答、提示编排、独立验证、教师回看和安全审计核对主流程，复核五项既有重构。项目的圈复杂度上限为 10，其余结构指标以 CodeQualitySkill 的 standard 阈值为参考。 [课程实践](https://github.com/bettermorn/IntelligentSWEPractice/blob/main/courseware/pages/part3develop.md#L1302-L1333) · [CodeQualitySkill](https://github.com/bettermorn/ACMWDevHubPPT/blob/master/Methodology/CodeQualitySkill.md) · [评审模板](https://github.com/bettermorn/ACMWDevHubPPT/blob/master/Methodology/CodeReviewTemplate.md)

## 1. 代码信息

| 检查项 | 评审范围 |
|---|---|
| 产品流程 | 教师发布、学生预习与独立验证、教师查看匿名或班级学习记录 |
| 教学助手 | LangGraph 编排、具名工具、课包检索、概念关系、会话记忆、引用验证与备用线索 |
| 保护与审计 | HTTPS 配置、机构令牌、角色与班级授权、会话归属、加密存储和审计链 |
| 语言与框架 | JavaScript、HTML、CSS、Node.js 和 LangGraph |
| 覆盖文件 | `code/backend`、`code/core_engine/learning_agent`、课堂页面、规则模块、原型及相关测试 |

## 2. 自动检查

| 检查项 | 结果 | 依据 |
|---|---|---|
| 语法与静态检查 | 0 个错误，0 条警告 | `npm run check`、`npm run lint` |
| 单元及接口回归 | 66 项通过 | 46 项单元测试和 20 项接口测试。覆盖发布与作答、事件重传、迟到线索、工具约束、跨班级访问、加密恢复和审计角色。 |
| 教学材料检索 | 20 条标注样例通过 | 核对点值、邻域、左右极限、约分和连续性等查询的首条结果，另测版本限制、域外查询与引用隔离。 [检索测试](../../tests/unit/learning_knowledge.test.js#L10) |
| 浏览器流程 | 通过 | 演示配置复核 11 个检查点，受保护配置通过 HTTPS 使用合成账号复核 5 个检查点。 [质量报告](code_quality.md) |
| 重复代码及依赖 | 0 个重复片段，0 项已知依赖漏洞 | `npm run quality:duplicates` 与 `npm audit --audit-level=high`。 [扫描报告](code_quality.md) |

## 3. 设计评审

| 检查项 | 结果 | 依据 |
|---|---|---|
| 需求可验收 | 通过 | 从班级发布到学生验证，再回到教师看板。验证阶段由服务端持有并推进。 [课堂接口](接口说明.md) |
| 模块职责清晰 | 通过 | HTTP 层负责路由和访问控制，会话层负责作答、阶段与持久化，状态图编排提示和材料校验。 [架构](architecture.md) |
| 检索范围有界 | 通过 | 查询限定课程版本、当前概念及一跳关系、提示深度和候选条数。公开引用包含稳定编号、课包版本和教材节标题。 [知识检索](../../code/core_engine/learning_agent/knowledge.js#L60) |
| 工具与模型边界 | 通过 | 工具用 Zod 校验参数。可选模型从校验后的材料中选择编号，发出的内容限提示等级和公开片段。 [工具定义](../../code/core_engine/learning_agent/tools.js#L8) · [模型适配器](../../code/backend/model-planner.js#L34) |
| 扩展与运行条件 | 已记录 | 文件存储按单进程运行。多进程和机构日志留存按目标环境验收。 [部署规范](security.md) |

## 4. 代码编写质量

| 检查项 | 结果 | 依据 |
|---|---|---|
| 命名与公共接口 | 通过 | 接口按课程、会话与教师视图组织。请求字段、学员状态和出错路径由接口用例约束。 [接口说明](接口说明.md) |
| 输入和阶段校验 | 通过 | 限制 JSON 请求体、事件标识、版本与选项。独立验证阶段只接受答题。关闭提示时状态图先执行护栏。 [请求体处理](../../code/backend/server.js#L76) · [阶段校验](../../code/backend/classroom.js#L123) · [助手护栏](../../code/core_engine/learning_agent/agent.js#L19) |
| 数据类型检查 | 运行时校验 | 请求、工具与配置按运行时协议校验。静态全仓类型检查列入后续核对。 |
| 并发状态 | 通过 | 异步提示返回后重新读取已提交的会话，检查事件标识和版本，再写入快照。 [会话提交](../../code/backend/classroom.js#L280) |
| 错误与资源回收 | 通过 | 暂存快照写入同步后替换目标文件，失败保留上次状态。内部错误通过简明状态和请求编号定位。 [快照写入](../../code/backend/classroom-protection.js#L113) |
| 函数与文件长度、参数数量 | 符合 standard | 会话工厂 60 行，受保护请求的两个 HTTP 函数各 5 个参数。课堂浏览器脚本 563 行，离线体验脚本 408 行。圈复杂度使用项目阈值 10。 |
| 资源上限 | 已设定 | 单班最多 500 个会话，每轮最多 120 个事件。教师回放返回最近 20 个会话，审计接口返回最近 50 条本班记录。文件容量和外部请求设上限。 |
| 模块依赖与运行方式 | 单进程 | 依赖沿 HTTP、课堂服务、教学助手和知识模块传递。文件存储由同一进程提交。 |

## 5. 逐项代码审查

| 编号 | 位置 | 问题 | 处理与验证 |
|---|---|---|---|
| R01 | [离线体验渲染](walkthrough/体验.js#L352) | SM-B01。页面渲染、提示与教师回放集中，重构前入口圈复杂度 47。 | 拆成页面与交互函数，入口圈复杂度降到 1。 |
| R02 | [规则原型提示请求](../../code/frontend/app.js#L141) | SM-B01。请求、响应检查和提示展示混在异步函数中，重构前圈复杂度 28。 | 分离请求、数据校验与展示，入口圈复杂度降到 10。 |
| R03 | [规则原型作答](../../code/frontend/app.js#L210) | SM-B01。提交、阶段与控件状态相互耦合。 | 分开练习完成、验证完成及错答反馈，进入验证时清空线索。 |
| R04 | [HTTP 请求处理](../../code/backend/server.js#L76) | SM-B01。静态资源、JSON 读入、大小检查和业务判断集中在路由中。 | 分离路由、请求体解析和业务处理。集成用例验证媒体类型、状态码及多字节上限。 |
| R05 | [规则引擎](../../code/core_engine/decision_engine.js#L66) | SM-C01。沉默条件与触发和预算判断合写。 | 先处理保护和关闭，再计算线索等级。用例覆盖独立验证、关闭、冷却和预算。 |
| R06 | [会话幂等](../../code/backend/classroom.js#L263) | SM-V15。网络重试和多标签操作可能重复登记或覆盖进度。 | 按班级、持有人和创建键去重。作答按事件编号与会话版本核对。 [接口回归](../../tests/integration/api.test.js#L199) |
| R07 | [异步提交](../../code/backend/classroom.js#L280) | SM-V15。提示检索期间学生可能已进入下一阶段。 | 以最新阶段和版本决定提交。验证用例在检索尚未返回时切换阶段，拒绝迟到线索和回放记录。 [并发测试](../../tests/integration/api.test.js#L278) |
| R08 | [线索选择与校验](../../code/core_engine/learning_agent/agent.js#L84) | SM-V07。缺失字段、越界候选或错误的引用可能使线索脱离课包。 | 重新按版本获取匹配条目，核验等级与文本。材料不足时沿图谱补查，再用固定线索。数值工具使用独立例子。 [助手测试](../../tests/unit/learning_agent.test.js#L62) |
| R09 | [会话记忆](../../code/core_engine/learning_agent/memory.js#L5) · [课堂回放](../../code/frontend/classroom.js#L399) | 需区分可观察作答、已使用来源和模型选材。 | 会话记忆检查最近 16 个事件，保留最多 6 个来源编号。回放呈现实际工具、引用与处理结果，供教师复查。 |
| R10 | [模型选择](../../code/core_engine/learning_agent/agent.js#L91) · [外部调用](../../code/backend/model-planner.js#L34) | SM-V07。外部输出可能截断或选择候选集以外的材料。 | 响应限时限量，只接受完整 JSON 中的候选编号。超时或无效编号使用内置排序。适配器测试核对请求字段及选择边界。 [模型测试](../../tests/unit/learning_agent.test.js#L83) |
| R11 | [课堂授权](../../code/backend/server.js#L196) · [会话归属](../../code/backend/classroom.js#L251) | 原型角色依赖页面切换，机构场景需要服务端权限。 | 受保护模式校验 RS256 访问令牌、签发方、受众、时间窗和鉴别等级。服务端名册决定班级角色，学生只能访问本人会话。 [授权回归](../../tests/integration/classroom_security.test.js#L130) |
| R12 | [加密与读取](../../code/backend/classroom-protection.js#L61) | SM-V07。损坏快照或班级文件错配可能被当作有效状态。 | 按班级绑定 AES-256-GCM 认证数据，启动时鉴别版本、密文和业务结构。用例覆盖错误密码材料、错误班级、明文和写入回滚。 [存储与审计测试](../../tests/unit/classroom_protection.test.js#L37) |
| R13 | [审计持久化](../../code/backend/classroom-audit.js#L62) · [审计结果](../../code/backend/server.js#L186) | 操作追溯需要限制字段并验证记录完整性。 | 先写入授权记录，响应完成后追加结果，写入结果失败时输出请求编号。启动时验证 HMAC 链，查询限审计员所在班级。完整旧快照回退检测与长期留存由独立日志平台承担。 [审计回归](../../tests/integration/classroom_security.test.js#L170) |
| R14 | [文件容量](../../code/backend/classroom-protection.js#L9) · [审计容量](../../code/backend/classroom-audit.js#L8) | SM-V16。文件作为单进程存储时，容量与归档需要操作约定。 | 班级快照明文与审计日志各限 2 MiB。机构部署前配置容量告警、归档和恢复演练。 [部署要求](security.md#机构部署) |

## 6. 复验与跟踪

现有自动检查通过。翻转课堂的作答、提示、独立验证和教师回看可按课程脚本复验。受保护课堂按学生、教师和审计员的班级权限分别验收。独立评审意见由评审人确认后记录。

等保三级为机构部署目标。正式评估以部署边界、机构多因素鉴别、日志留存、密钥管理、备份恢复、管理制度和测评机构结论为依据。 [等保三级对照](security.md#等保三级对照)

主动学习策略导入的评审记录保存在 #20 合并版本。五项规则与原型重构的基线、扫描截图和复验命令见代码质量报告。 [历史策略评审](https://github.com/LJHSTO/edu-promaic/blob/4b26a7a518aa450dc111177c8e7037ae55a7a214/docs/software/code_review.md) · [五项重构](code_quality.md)
