# Edu ProMAIC

[![自动检查](https://github.com/LJHSTO/edu-promaic/actions/workflows/checks.yml/badge.svg)](https://github.com/LJHSTO/edu-promaic/actions/workflows/checks.yml)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522-339933)](https://nodejs.org/)
[![许可证：MIT](https://img.shields.io/badge/许可证-MIT-blue)](LICENSE)

知点（Edu ProMAIC）是面向大一微积分翻转课堂的课前准备度工具。教师布置一节预习任务，学生阅读材料、完成分级提示练习和独立验证。上课前，教师查看首次通过情况与作答过程，决定课堂讨论哪类误解。

## 体验知点

[![观看知点体验视频](docs/software/media/原型封面.png)](docs/software/media/原型完整体验.mp4)

[观看体验视频](docs/software/media/原型完整体验.mp4) · [交互原型](docs/software/walkthrough/index.html) · [产品设计](docs/software/产品设计.md) · [技术架构](docs/software/architecture.md) · [技术入门](docs/software/技术入门.md)

https://github.com/user-attachments/assets/88507c7a-c416-4ac1-85a0-2b95fc526f21

第一课是“函数值与极限”。运行服务即可体验教师发布、学生作答和教师回看。视频和离线交互原型展示了后续图形活动和帮助偏好的设计。

学习智能体使用 LangGraph 编排提示。它根据会话中的错答和已用线索确定检索方向，通过概念关系和课包检索找到带出处的材料，必要时调用数值比较工具。独立验证由服务端保护。教师回放可以核对每次提示使用的工具和材料。 [技术架构](docs/software/architecture.md)

## 本地运行

演示服务使用 Node.js 22 或更新版本。安装锁定依赖后启动，即可使用内置课程检索、工具和提示编排。

```powershell
git clone https://github.com/LJHSTO/edu-promaic.git
cd edu-promaic
npm ci --ignore-scripts
npm start
```

在浏览器访问 [本地翻转课堂](http://127.0.0.1:3000/)。页面与 API 由同一服务提供。停止服务时在终端按 `Ctrl+C`。

历史规则交互原型包含学生工作台、教师示例记录、CSV 预览及故障模拟。[第三周原型](http://127.0.0.1:3000/prototype/)

端口被占用时，PowerShell 中可这样换端口：

```powershell
$env:PORT = '3001'
npm start
```

演示课堂接受回环连接，使用匿名会话。发布和作答记录保存在 `output/classroom.json`，也可通过 `CLASSROOM_FILE` 选择另一份记录。浏览器刷新或服务重启后可继续原会话。

机构课堂使用受保护配置，在 HTTPS 上接入机构身份，根据班级分配师生及审计权限，并加密保存课堂记录。部署材料提供 Linux 最小权限运行配置、审计归档和备份恢复流程。 [Linux 部署](docs/software/deployment.md) · [安全与等保三级对照](docs/software/security.md)

## 试一遍学习流程

1. 在教师入口发布“函数值与极限”。切换到学生入口，查看预习材料并开始练习。
2. 连续两次选择点值 `1`，展开“线索依据”查看学习记录、检索和引用。继续求助可看到独立数值对照，也可以暂停线索。
3. 练习选 `4`，进入无提示验证。刷新页面，确认仍在验证。先选 `7`，再选 `6`，查看重试后完成的结果。
4. 切回教师入口，核对本轮计入验证提交和完成，首次通过为 0。打开会话回放，查看点值误选与提示记录。上课可围绕“只改变单点取值时，极限是否改变”组织讨论。

## 检查与测试

开发检查使用 Node.js 22.13 或更新的 Node.js 22 版本，也可使用 Node.js 24。首次执行静态检查前安装锁定的开发依赖。

```powershell
npm ci --ignore-scripts
npm run check
npm run lint
npm test
npm run quality:duplicates
npm audit --audit-level=high
```

`npm test` 运行单元和接口集成测试。`npm run test:protected` 通过 OpenSSL 生成临时证书，验证真实 HTTPS 启动、停机与审计续写。GitHub Actions 在推送和 Pull Request 时运行检查，Linux 任务包含 HTTPS 系统测试。 [扫描与重构报告](docs/software/code_quality.md) · [代码评审记录](docs/software/code_review.md)

## 接口示例

`GET /api/health` 检查服务。课堂 API 提供发布、创建与恢复会话、提交操作、教师汇总和机构审计。演示配置支持单独调用规则 API `POST /api/decision/evaluate`。以下为 PowerShell 示例。

```powershell
$context = @{ consecutiveErrors = 2; misconceptionType = 'limit_equals_function_value' }
$body = $context | ConvertTo-Json
Invoke-RestMethod -Uri 'http://localhost:3000/api/decision/evaluate' -Method Post -ContentType 'application/json' -Body $body
```

响应示例：

```json
{
  "success": true,
  "data": {
    "action": "INTERVENE",
    "level": 1,
    "reasonCode": "REPEATED_ERRORS",
    "reason": "连续错误达到阈值，先从自我解释开始。"
  }
}
```

规则接口直接评估传入的上下文。课堂接口从服务端会话构建规则上下文并保存事件。 [接口说明](docs/software/接口说明.md)

## 仓库结构

```text
docs/
  requirements/   问题定义、功能与非功能规格、用户故事
  algorithm/      规则策略、参数与选型依据
  software/       架构、接口和原型说明
  mgmt/           团队协作、迭代计划、风险与议题落实记录
  retrospection/  阶段复盘
code/
  backend/        HTTP、课程包、课堂状态与本地存储
  frontend/       学生预习与教师课前回看
  core_engine/    不依赖网络或存储的决策逻辑
                  learning_agent/ 包含编排、工具、课程知识与记忆
tests/
  unit/           决策规则测试
  integration/    HTTP 接口及课堂流程测试
.github/          自动检查、Issue 和 PR 模板
data/             预留课程包、知识图谱与脱敏测试素材
```

## 文档与协作

开发资料：[用户故事](docs/requirements/user_stories.md) · [交互原型](docs/software/prototype/README.md) · [技术架构](docs/software/architecture.md) · [开发计划](docs/mgmt/week3_learning_plan.md) · [迭代记录](docs/mgmt/week3_delivery.md)。

- [问题定义与产品描述](docs/requirements/problem_definition.md)
- [功能规格](docs/requirements/functional_spec.md) · [非功能规格](docs/requirements/nonfunctional_spec.md) · [用户故事](docs/requirements/user_stories.md)
- [算法说明](docs/algorithm/research.md) · [系统架构](docs/software/architecture.md) · [原型说明](docs/software/prototype/README.md) · [课程设计](docs/software/课程设计.md)
- [沟通管理](docs/mgmt/communication_mgmt_plan.md) · [迭代计划](docs/mgmt/迭代计划.md) · [风险管理](docs/mgmt/risk_mgmt_plan.md)
- [任务记录](docs/mgmt/议题落实记录.md) · [复盘记录](docs/retrospection/README.md)
- [GitHub 协作流程](docs/mgmt/协作流程.md)

问题与建议统一提交到 [GitHub Issues](https://github.com/LJHSTO/edu-promaic/issues)。贡献流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。本项目采用 [MIT 许可证](LICENSE)。
