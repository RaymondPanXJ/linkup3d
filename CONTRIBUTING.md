# 贡献指南

谢谢参与！这个项目刻意保持零依赖：不要引入任何 npm 包或构建工具。

## 流程

1. 从 open issue 里认领一个（或在评论区说一声，避免撞车）。带 `agent:ok` 标签的对自动化代理友好。
2. 从 `main` 开分支，命名 `<类型>/<简述>`，如 `feat/sound-effects`、`fix/shake-anim`。
3. Commit message 用 [Conventional Commits](https://www.conventionalcommits.org/)：`feat: ...` / `fix: ...` / `test: ...` / `docs: ...`。
4. 改动 `js/link3d.js` 必须同步更新 `tests/tests.define.js`，并保持 `node tests/run-tests.js` 全绿。
5. 开 PR：填模板，说明动机 → 方案 → 验证方式。CI 全绿 + 一名 reviewer 批准才会合并。

## 代码约定

- 纯原生 JS（ES2017 以内语法），零运行时依赖
- 算法与 UI 分离：纯逻辑进 `js/link3d.js`（UMD 导出，Node 可测），DOM 操作只出现在 `js/game.js`
- 中文界面文案；代码注释中文英文都行
- 所有产物文件权限 644

## 演示项目特别约定

这是一个「人类 + AI 协作」公开实验。AI 代理（OpenHands）作为开发者工作时：
- 在 issue 评论里认领与汇报进度（这是它的"站会"）
- PR 描述里引用 issue 编号
- review 意见必须逐条回应后再请求复审
