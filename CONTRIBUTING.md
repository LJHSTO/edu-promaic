# 贡献指南

## 任务与分支

先在 [Issues](https://github.com/LJHSTO/edu-promaic/issues)说明问题、验收条件和关联需求，再在[项目看板](https://github.com/users/LJHSTO/projects/1/views/3)认领。缺陷使用仓库的中文表单，维护者确认优先级后添加 `priority:P0/P1/P2` 标签。

`main` 保存已检查的交付版本。日常修改建议从 `main` 建立 `codex/主题` 或团队约定的功能分支，通过 PR 评审；目前没有单独维护的 `develop` 分支。

## 修改约定

沿用项目的 Node.js 内置模块和原生测试工具。纯决策放在 `code/core_engine/`，HTTP 与文件读取放在 `code/backend/`，界面与页面状态放在 `code/frontend/`。题目、提示和阈值变化同步到需求与接口说明。

文档使用 UTF-8，正文和界面默认简体中文。接口字段和代码标识符保留原名。写清哪些已实现、哪些待实现；课堂反馈和性能数字需要注明来源和测试条件。

## 提交前检查

```powershell
npm run check
npm test
```

还应按改动范围检查文档链接、中文显示和实际浏览器流程。涉及提示时机或保护阶段时，必须检查关闭、冷却、预算、主动求助和独立验证的组合。

PR 说明写清问题、最终行为、验证结果及剩余限制。完整解决使用 `Fixes #编号`，仅部分推进使用 `Refs #编号`。不提交密钥、学生身份信息、真实课堂记录、浏览器状态或本地生成的截图和日志。

## 需求与协作入口

标签主要使用 `documentation`、`requirements`、`enhancement` 和 `bug`；详细分工、完成定义和沟通方式见[沟通计划](docs/mgmt/communication_mgmt_plan.md)。