# Edu ProMAIC

[![自动检查](https://github.com/LJHSTO/edu-promaic/actions/workflows/checks.yml/badge.svg)](https://github.com/LJHSTO/edu-promaic/actions/workflows/checks.yml)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522-339933)](https://nodejs.org/)
[![许可证：MIT](https://img.shields.io/badge/许可证-MIT-blue)](LICENSE)

Edu ProMAIC 是面向大学新生微积分练习的主动学习辅助工具。学生反复出错时，它先问一个帮助梳理思路的问题，再逐步提供线索；提示后答对，还要做一道无提示变式题。

目前仓库提供一个“极限与函数值”练习演示、规则决策接口和自动化测试。教师看板、持久化学习记录、完整课程包及模型接入仍在计划中，详见[功能规格](docs/requirements/functional_spec.md)。

## 本地运行

需要 Node.js 22 或更新版本和随附的 npm。项目使用 Node.js 内置模块，没有需要安装的第三方依赖，也不需要模型密钥。

```powershell
git clone https://github.com/LJHSTO/edu-promaic.git
cd edu-promaic
npm start
```

在浏览器访问 [http://localhost:3000](http://localhost:3000)。页面与 API 由同一服务提供。停止服务时在终端按 `Ctrl+C`。

端口被占用时，PowerShell 中可这样换端口：

```powershell
$env:PORT = '3001'
npm start
```

默认只监听本机。若需要在受控演示环境中从其他设备访问，可另设 `HOST`；当前版本没有账户和权限隔离，不用于真实班级数据。

## 试一遍学习流程

1. 在练习题中选择错误答案并提交。第一次错误只给出对错反馈，连续两次错误后出现自我解释提示。
2. 点击“再给一点线索”查看下一层提示，也可以收起提示或关闭本题主动提示。
3. 答对练习题后进入独立验证。此时提示区清空，求助按钮不可用。
4. 完成验证后查看本轮结果。“在提示后答对”和“验证题独立答对”分别记录。

演示状态只保存在当前页面，刷新会重新开始。错误次数、冷却时间和提示预算用于演示规则，不代表已经验证过的教学参数。

## 检查与测试

```powershell
npm run check
npm test
```

`npm test` 运行全部单元和接口集成测试。也可用 `npm run test:unit`、`npm run test:integration` 分别运行。GitHub Actions 在推送和 Pull Request 时执行相同检查。

## 接口示例

`GET /api/health` 检查服务；`POST /api/decision/evaluate` 根据上下文返回决策。PowerShell 调用示例：

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

请求字段、默认值和错误响应见[接口说明](docs/software/接口说明.md)。演示接口不保存学习记录；调用方负责维护单题上下文。

## 仓库结构

```text
docs/
  requirements/   问题定义、功能与非功能规格、用户故事
  algorithm/      规则策略、参数与选型依据
  software/       架构、接口和原型说明
  mgmt/           团队协作、迭代计划、风险与议题落实记录
  retrospection/  阶段复盘
code/
  backend/        HTTP 服务和静态页面入口
  frontend/       学生练习演示
  core_engine/    不依赖网络或存储的决策逻辑
tests/
  unit/           决策规则测试
  integration/    HTTP 接口测试
.github/          自动检查、Issue 和 PR 模板
data/             预留课程包、知识图谱与脱敏测试素材
```

## 文档与协作

- [问题定义与产品描述](docs/requirements/problem_definition.md)
- [功能规格](docs/requirements/functional_spec.md) · [非功能规格](docs/requirements/nonfunctional_spec.md) · [用户故事](docs/requirements/user_stories.md)
- [算法说明](docs/algorithm/research.md) · [系统架构](docs/software/architecture.md) · [原型说明](docs/software/prototype/README.md) · [课程设计](docs/software/课程设计.md)
- [沟通管理](docs/mgmt/communication_mgmt_plan.md) · [迭代计划](docs/mgmt/迭代计划.md) · [风险管理](docs/mgmt/risk_mgmt_plan.md)
- [本轮 issue 落实记录](docs/mgmt/议题落实记录.md) · [复盘记录](docs/retrospection/README.md)

问题与建议统一提交到 [GitHub Issues](https://github.com/LJHSTO/edu-promaic/issues)。贡献流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。本项目采用 [MIT 许可证](LICENSE)。
