# 主动学习策略模块

代码来自 [Calculus Quest 的 proactive_test 分支提交 365ae97](https://github.com/LJHSTO/calculus-quest/tree/365ae97)。导入范围为 `lib/proactive-policy/` 下的证据包、时机门控和支架动作三个模块。保留 CommonJS 接口，使用 `.cjs` 扩展名适配课设的 ES 模块包。

| 模块 | 用途 |
|---|---|
| `evidence-package.cjs` | 将观察事实、推断分数和缺失记录分开 |
| `timing-gate.cjs` | 根据证据、阶段、偏好和冷却决定继续等待或进入帮助 |
| `support-action.cjs` | 约束提示深度、教学功能、下一步独立活动与复查题标识 |

三个模块只使用 Node.js 内置能力，可由会话服务或课程 Agent 编排调用。现有演示仍使用原决策接口。将这些模块接入学生流程时，由服务端提供可信阶段与权限，按课程数据核对提示内容，并负责持久化。

运行单测与既有接口测试：

```sh
npm test
```

审查版接受 JSON 兼容的证据资料。独立验证使用 `verification` 阶段，计时门控接收调用方维护的冷却截止时间；`cooldownMs` 是保留的策略配置值。支架的复查标识必须为非空字符串，泄露标记必须为布尔值。

复跑导入范围的静态检查和重复检查（Node.js 22.13 或更新的受支持 LTS 版本）：

```sh
npx --yes eslint@10.15.0 --config tests/research-policy-eslint.config.mjs "code/core_engine/research_policy/*.cjs"
npx --yes jscpd@5.4.3 --min-lines 6 --min-tokens 40 --format javascript code/core_engine/research_policy
node --test --experimental-test-coverage --test-coverage-include='code/core_engine/research_policy/*.cjs' tests/unit/*.test.js tests/integration/*.test.js
```
