# linkup3d — 3D 连连看

- 纯原生 JS + CSS 3D transform（刻意不依赖 Three.js/CDN，保证离线静态托管可用）。
- 结构：`index.html` 入口；`css/style.css`；`js/link3d.js`（核心算法，UMD，浏览器+Node 双用）；`js/game.js`（UI/逻辑）；`tests/`（算法自测，Node 与浏览器共用用例）。
- 网格模型：扩展网格，外圈边框恒为空 → 连线可绕棋盘外侧。`findPath` 按 0/1/2 转弯逐级查找。
- `shuffleGrid` 保持占位集合不变并保证有解（随机 200 次失败后有构造性兜底）。
- 测试：`node tests/run-tests.js`（37 项 = 16 算法用例（含 200 局整局模拟）+ 21 项无浏览器 UI 接线静态断言 tests/ui-static-check.js）；浏览器看 `tests.html`。
- 尺寸：link3d.js 不含写死尺寸，一律 `gridSize(grid)` 从扩展网格推导；`dealGrid()`/`dealGrid(rng)` 旧签名默认 4×6。
- 部署：任意静态服务器，如 `python3 -m http.server`（目录需可被静态托管，文件权限 644）。

## 自动收件箱/夜间任务运行须知（bot: StarForrest）

- 禁止任何浏览器工具（本环境会永久挂起）；UI 验证写静态断言，模式参考 `tests/space-static-check.js`。
- 已有测试用例一字不许改来迁就新代码；若因 HUD 结构变化需适配选择器，在 PR 里说明。
- UI 改动必须同步 `index.html` 与 `css/`。
- 不碰 `.github/`。产物文件写完 `chmod 644`。
- 认领/返工/复位全流程纪律见已安装技能 `inbox-workflow`，以其为准。

