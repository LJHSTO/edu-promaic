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
| 单元及接口回归 | 102 项通过 | 80 项单元测试和 22 项接口测试。覆盖课堂流程、图谱检索范围、异步保护、班级授权、学习记录留存、审计预留、轮转及备份恢复。 |
| HTTPS 系统测试 | 2 项通过 | 用临时证书和文件凭据启动服务，验证停机轮转、留存、重启检查点，以及容量不足时拒绝发布并记录告警。 [系统测试](../../tests/system/protected-launch.test.js) |
| Linux 安装验证 | 通过 | Ubuntu 上启动安装后的 systemd 服务，验证证书和回环监听、服务账号、目录权限，以及 `401` 响应与签名审计的关联。 [安装测试](../../tests/system/linux-service.sh) |
| Nginx 网关 | 通过 | 使用参考模板启动网关。核对匿名 `401`、Bearer 读取、Cookie 同源写入与跨源拒绝，以及上游证书名称、CA 和访问日志。 [网关测试](../../tests/system/nginx-gateway.js) |
| 教学材料检索 | 20 条标注样例通过 | 核对点值、邻域、左右极限、约分和连续性等查询的首条结果，另测版本限制、域外查询与引用隔离。 [检索测试](../../tests/unit/learning_knowledge.test.js#L10) |
| 浏览器流程 | 通过 | 复核演示及 HTTPS 课堂，并验证 320 px 教师布局、按班级下载 CSV 和学生导出拒绝。 [质量报告](code_quality.md) |
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
| 输入和阶段校验 | 通过 | 限制 JSON 请求体、事件标识、版本与选项。独立验证阶段只接受答题。关闭提示时状态图先执行护栏。 [请求体处理](../../code/backend/server.js#L87) · [阶段校验](../../code/backend/classroom.js#L123) · [助手护栏](../../code/core_engine/learning_agent/agent.js#L19) |
| 数据类型检查 | 运行时校验 | 请求、工具与配置按运行时协议校验。静态全仓类型检查列入后续核对。 |
| 并发状态 | 通过 | 异步提示返回后重新读取已提交的会话，检查事件标识和版本，再写入快照。 [会话提交](../../code/backend/classroom.js#L313) |
| 错误与资源回收 | 通过 | 暂存快照写入同步后替换目标文件，失败保留上次状态。内部错误通过简明状态和请求编号定位。 [快照写入](../../code/backend/classroom-protection.js#L113) |
| 函数与文件长度、参数数量 | 符合 standard | 会话工厂不超过 60 行，受保护请求的两个 HTTP 函数各 5 个参数。课堂浏览器和离线体验脚本均不超过 600 行。圈复杂度使用项目阈值 10。 |
| 资源上限 | 已设定 | 单班最多 500 个会话，每轮最多 120 个事件。教师回放返回最近 20 个会话，审计接口返回最近 50 条本班记录。文件容量和外部请求设上限。 |
| 模块依赖与运行方式 | 单进程 | 依赖沿 HTTP、课堂服务、教学助手和知识模块传递。文件存储由同一进程提交。 |

## 5. 逐项代码审查

| 编号 | 位置 | 问题 | 处理与验证 |
|---|---|---|---|
| R01 | [离线体验渲染](walkthrough/体验.js#L352) | SM-B01。页面渲染、提示与教师回放集中，重构前入口圈复杂度 47。 | 拆成页面与交互函数，入口圈复杂度降到 1。 |
| R02 | [规则原型提示请求](../../code/frontend/app.js#L141) | SM-B01。请求、响应检查和提示展示混在异步函数中，重构前圈复杂度 28。 | 分离请求、数据校验与展示，入口圈复杂度降到 10。 |
| R03 | [规则原型作答](../../code/frontend/app.js#L210) | SM-B01。提交、阶段与控件状态相互耦合。 | 分开练习完成、验证完成及错答反馈，进入验证时清空线索。 |
| R04 | [HTTP 请求处理](../../code/backend/server.js#L87) | SM-B01。静态资源、JSON 读入、大小检查和业务判断集中在路由中。 | 分离路由、请求体解析和业务处理。集成用例验证媒体类型、状态码及多字节上限。 |
| R05 | [规则引擎](../../code/core_engine/decision_engine.js#L66) | SM-C01。沉默条件与触发和预算判断合写。 | 先处理保护和关闭，再计算线索等级。用例覆盖独立验证、关闭、冷却和预算。 |
| R06 | [会话幂等](../../code/backend/classroom.js#L296) | SM-V15。网络重试和多标签操作可能重复登记或覆盖进度。 | 按班级、持有人和创建键去重。作答按事件编号与会话版本核对。 [接口回归](../../tests/integration/api.test.js#L199) |
| R07 | [异步提交](../../code/backend/classroom.js#L313) | SM-V15。提示检索期间学生可能已进入下一阶段。 | 以最新阶段和版本决定提交。验证用例在检索尚未返回时切换阶段，拒绝迟到线索和回放记录。 [并发测试](../../tests/integration/api.test.js#L278) |
| R08 | [线索选择与校验](../../code/core_engine/learning_agent/agent.js#L119) | SM-V07。缺失字段、越界候选或错误的引用可能使线索脱离课包。 | 重新按版本获取匹配条目，核验等级与文本。材料不足时沿图谱补查，再用固定线索。数值工具使用独立例子。 [助手测试](../../tests/unit/learning_agent.test.js) |
| R09 | [会话记忆](../../code/core_engine/learning_agent/memory.js#L5) · [课堂回放](../../code/frontend/classroom.js#L399) | 近期错答与已用来源需要有明确的事件窗口。 | 会话记忆检查最近 16 个事件，保留最多 6 个来源编号。测试验证旧事件退出窗口、验证阶段误选不参与练习记忆及同级线索去重。 |
| R10 | [模型选择](../../code/core_engine/learning_agent/agent.js#L91) · [外部调用](../../code/backend/model-planner.js#L34) | SM-V07。外部输出可能截断或选择候选集以外的材料。 | 响应限时限量，只接受完整 JSON 中的候选编号。超时或无效编号使用内置排序。适配器测试核对请求字段及选择边界。 [模型测试](../../tests/unit/learning_agent.test.js#L83) |
| R11 | [课堂授权](../../code/backend/server.js#L213) · [会话归属](../../code/backend/classroom.js#L284) | 原型角色依赖页面切换，机构场景需要服务端权限。 | 受保护模式校验 RS256 访问令牌、签发方、受众、时间窗和鉴别等级。服务端名册决定班级角色，学生只能访问本人会话。 [授权回归](../../tests/integration/classroom_security.test.js#L130) |
| R12 | [加密与读取](../../code/backend/classroom-protection.js#L61) | SM-V07。损坏快照或班级文件错配可能被当作有效状态。 | 按班级绑定 AES-256-GCM 认证数据，启动时鉴别版本、密文和业务结构。用例覆盖错误密码材料、错误班级、明文和写入回滚。 [存储与审计测试](../../tests/unit/classroom_protection.test.js#L37) |
| R13 | [审计快照验证](../../code/backend/classroom-audit.js#L137) · [审计结果](../../code/backend/server.js#L199) | 操作追溯需要验证完整性，也要识别一份真实旧快照被当作当前记录。 | 授权与结果分别记录，读取限所属班级。归档前与独立保管的签名检查点比对，拒绝已确认历史的回退或分叉。 [审计测试](../../tests/unit/classroom_audit.test.js) |
| R14 | [文件容量](../../code/backend/classroom-protection.js#L9) · [审计容量](../../code/backend/classroom-audit.js#L8) | SM-V16。文件作为单进程存储时，容量与归档需要操作约定。 | 班级快照明文与审计日志各限 2 MiB。部署方配置容量监控、集中留存及归档周期。 [归档流程](security.md#审计归档与备份恢复) |
| R15 | [备份清单](../../code/backend/classroom-backup.js#L68) · [恢复入口](../../code/backend/classroom-backup.js#L136) | 恢复时要能发现缺件、替换和清单修改，并保护已有数据目录。 | 校验密文和清单后恢复到新目录。恢复较早的会话时，可携带符合独立检查点的现行审计。验证拒绝旧审计并读回原会话。 [备份测试](../../tests/unit/classroom_backup.test.js) |
| R16 | [线索回退](../../code/core_engine/learning_agent/agent.js#L134) | 介入策略的原因与执行阶段的故障应分别记录。 | 策略码说明为何启动帮助。回退码说明无材料、校验失败或图谱故障，保留实际执行步骤。 |
| R17 | [Linux 服务单元](../../deployment/linux/edu-promaic.service) | 应用发布、密钥管理和数据写入分属不同权限。 | 通过独立运行账户、只读发布目录、专用数据目录和文件式凭证约束运行。 [部署流程](deployment.md) |
| R18 | [课程包校验](../../code/core_engine/learning_agent/course-pack-schema.js#L61) | 版本、来源和概念关系写错时可能把越界片段带入线索。 | 启动时校验课包引用，检索仅使用发布范围内的片段。题目与答案单独校验，答案字段不能进入提示片段。 [课包用例](../../tests/unit/course_pack.test.js) |
| R19 | [汇总与导出](../../code/backend/classroom.js#L229) · [导出授权](../../code/backend/server.js#L170) | 首次通过率需明确分母，班级导出需要独立授权。 | 按是否提交验证分开计数，CSV 区分四种状态。接口验证同班教师可下载，跨班级或学生被拒绝，导出成功进入审计记录。 [授权测试](../../tests/integration/classroom_security.test.js#L130) |
| R20 | [审计轮转](../../code/backend/classroom-audit.js#L145) | SM-V16。活动审计达到上限后，需继续写入并保留连续性。 | 核对归档和末尾检查点后生成候选分段，延续全局序号与链头。测试覆盖连续轮转、容量上限和检查点不匹配。 |
| R21 | [会话留存](../../code/backend/classroom.js#L272) · [清理审计](../../code/backend/protected-profile.js#L41) | 到期会话应退出教师汇总和导出，旧时间和在途回复需单独处理。 | 按成功提交时间自然到期，未知时间的旧记录获得完整周期。删除写入前记录班级审计，跨超时的在途回复无法写回。 [留存测试](../../tests/unit/classroom_retention.test.js) |
| R22 | [停机处理](../../code/backend/server.js#L316) · [启动检查点](../../code/backend/protected-profile.js#L91) | 服务中断可能使已发出的响应缺少审计结果。 | 正常停机排空连接，保留已完成响应的审计结果。配置独立检查点后，启动拒绝缺失或回退的活动审计。 [系统测试](../../tests/system/protected-launch.test.js) |
| R23 | [受保护请求](../../code/backend/server.js#L213) | 鉴别或授权失败时，审计有请求编号，HTTP 响应缺少对应编号，网关日志无法关联。 | 在授权前设置服务端生成的请求编号。接口验收比对 `401`、`403` 的响应编号与审计编号。安装测试经 HTTPS 重验 `401`，并验证审计签名。 [接口测试](../../tests/integration/classroom_security.test.js#L120) · [安装测试](../../tests/system/linux-service.sh#L96) |
| R24 | [环境约束与验收](../../scripts/benchmark-classroom.js#L129) | 性能基准需要可复现的资源上限，也需要识别缺样、错误响应和指标超限。 | 工作流设置 4 核、8 GiB 与禁用交换空间。脚本核验约束，再检查样本数、响应内容、状态码和 P95，保存逐请求结果。 [基准工作流](../../.github/workflows/decision-benchmark.yml#L34) · [基准结果](code_quality.md#决策接口性能) |
| R25 | [审计容量预留](../../code/backend/classroom-audit.js#L200) · [响应结果](../../code/backend/server.js#L199) | 活动分段接近上限时，授权记录写入后可能没有足够空间写入结果。客户端断开也会绕过正常响应结束事件。 | 执行业务前预留结果记录的容量。HTTP 响应完成或连接关闭时只写一次结果。测试确认余量不足的发布返回 `503`，审计和课程文件保持原样。 [断线测试](../../tests/integration/classroom_security.test.js#L187) · [HTTPS 容量测试](../../tests/system/protected-launch.test.js#L73) |
| R26 | [容量告警](../../code/backend/classroom-audit.js#L175) | 运维需要在活动分段写满之前安排归档。 | 在 80% 和 95% 发出分级容量事件，每个进程对同一级别记录一次。系统测试核对进程日志，事件仅含级别和容量数据。 [运维命令](deployment.md#配置网关与验收) |
| R27 | [网关模板](../../deployment/linux/nginx-classroom.example.conf) | 独立服务测试无法覆盖网关上游证书校验、浏览器同源授权和访问日志字段。 | 用两段 HTTPS 启动网关与课堂服务。核对同源写入和跨源拒绝，证书名称或 CA 不匹配时返回 `502`，并将访问日志请求编号与签名审计对应。 [网关测试](../../tests/system/nginx-gateway.js#L103) |
| R28 | [图谱与检索编排](../../code/core_engine/learning_agent/agent.js#L63) · [课包检索范围](../../code/core_engine/learning_agent/knowledge.js#L72) | 主检索自行展开课包关系，无法体现当次图谱工具返回的范围。 | 主检索接收核验过的邻接编号，补查只选一个相邻概念。模型选材和输出均校验同一范围。回归测试确认已发布但相距两跳的课包片段不进入模型候选或显示结果。 [范围回归](../../tests/unit/learning_agent.test.js#L120) · [检索工具回归](../../tests/unit/learning_knowledge.test.js#L59) |

## 6. 复验与跟踪

现有自动检查通过。翻转课堂的作答、提示、独立验证和教师回看可按课程脚本复验。受保护课堂按学生、教师和审计员的班级权限分别验收。独立评审意见由评审人确认后记录。

等保三级为机构部署目标。正式评估以部署边界、机构多因素鉴别、日志留存、密钥管理、备份恢复、管理制度和测评机构结论为依据。 [等保三级对照](security.md#等保三级对照)

主动学习策略导入的评审记录保存在 #20 合并版本。五项规则与原型重构的基线、扫描截图和复验命令见代码质量报告。 [历史策略评审](https://github.com/LJHSTO/edu-promaic/blob/4b26a7a518aa450dc111177c8e7037ae55a7a214/docs/software/code_review.md) · [五项重构](code_quality.md)
