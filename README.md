# 🐴 linkup3d — 3D 连连看

零依赖的网页版 3D 连连看小游戏。纯原生 JS + CSS 3D transform，无构建工具、无外部 CDN，双击 index.html 或任意静态服务器即可玩。

## 玩法

- 4×6 棋盘，12 对 emoji 牌
- 点击两张相同图案的牌，若能用**不超过 2 次转弯**、不穿过其他牌的折线连通，即消除（支持棋盘外绕线）
- 场上没有可连对子时自动洗牌（保持占位不变，保证有解）
- 计分：每对 +10，4 秒内连消有 combo 加成

## 本地运行

```bash
# 方式一：直接打开
open index.html          # macOS / Windows 双击即可

# 方式二：静态服务器
python3 -m http.server 8123
# 浏览器打开 http://localhost:8123
```

## 开发

核心连通性算法在 `js/link3d.js`，UMD 模块，浏览器与 Node 双端可用：

```bash
node tests/run-tests.js    # 12 个算法用例，CI 同款
```

- 3D 实现：每张牌是六面 CSS 立方体，棋盘 `perspective` + `rotateX/rotateY` 跟随鼠标
- 架构约定与代码地图见 [AGENTS.md](AGENTS.md)
- 贡献流程见 [CONTRIBUTING.md](CONTRIBUTING.md)

## CI

每个 PR 自动跑 `tests/run-tests.js`（GitHub Actions，见 `.github/workflows/ci.yml`）。

## 这个项目是怎么造出来的（公开幕后）

本仓库是一个「人类 Owner + AI 团队协作」的公开实验：
- **AI 开发者**（OpenHands Agent，运行在公司机房 24h 服务器）：领取 issue、写代码、开 PR、按 review 意见返工
- **AI Tech Lead**（Hermes Agent）：脚手架、CI、代码评审、合并
- **人类 Owner**：产品决策、验收、发布

issue 和 PR 历史就是完整开发过程记录，欢迎围观。

## License

MIT
