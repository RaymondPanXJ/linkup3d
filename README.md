# 🌌 《连星远航 · LinkVoyage》（linkup3d）

零依赖的网页版 3D 星系战役连连看。纯原生 JS + CSS 3D transform，无构建工具、无外部 CDN、无任何第三方依赖——双击 `index.html`、任意静态服务器或 GitHub Pages 即可游玩。

本仓库同时是一个「人类 Owner + AI 团队公开协作实验」的现场：AI 开发者领取 issue、写代码、开 PR、按评审返工；AI Tech Lead 负责脚手架、CI 与代码评审；人类 Owner 做产品决策与验收。issue 与 PR 历史就是完整开发过程记录，欢迎围观（详见文末「这个项目是怎么造出来的」）。

## 玩法

### 核心规则

点击两张相同图案的牌，若能用**不超过 2 次转弯**、不穿过其他牌的折线连通，即消除（支持棋盘外绕线）。场上没有可连对子时自动洗牌（保持占位不变，保证有解）。

### 六大系统

| 系统 | 说明 |
| --- | --- |
| 连击 | 每对 +10 分，4 秒窗口内连消有 combo 加成，分难度记录最高分 |
| 难度 | 简单 4×4 / 标准 4×6 / 困难 6×8 三档 |
| 限时 | 计时挑战模式总时长 120 秒，剩余 ≤10 秒进入警示态，支持暂停 |
| 排行榜 | 本地 Top10 分难度榜单（得分 / 用时 / 最高连击 / 日期） |
| 主题 | 深空 / 浅色 / 霓虹三主题切换，附带 Reduced Motion 无障碍适配 |
| 提示 | 每局 3 次提示，高亮一组当前可连对子 |

### 冰晶星云战役

主线战役模式，10 关星图逐级解锁（前一关获得 ≥1 星解锁下一关）：

- **星图**：冰晶星云 10 关（冷眠醒转 → 星核之眼），盘面、时限、Par 用时逐关递进；
- **冰封**：部分格位被寒冰封锁，不可选中也不可作连线端点；每成功消除一对，解冻与被消两牌四邻的冰冻格；
- **霜之巡猎者**：战役敌人按节拍（cadence）锁定格位，预警（telegraph）期满后将其冻结；同屏冰冻上限 4，敌人不作弊（冻结导致死局则由调用方回滚）；
- **星级**：用时 ≤ Par 得 3★，≤ Par×1.5 得 2★，通关得 1★；星级、最佳得分、最佳用时持久化存档并驱动星图解锁。

## 运行方式

```bash
# 方式一：直接打开
open index.html          # macOS / Windows 双击即可

# 方式二：在线玩
# https://raymondpanxj.github.io/linkup3d/

# 方式三：跑测试（401 项，Node ≥ 12，无依赖）
node tests/run-tests.js
```

## 架构

零依赖纯函数核心清单——每个模块都是 UMD（浏览器 `window.*` 与 Node `module.exports` 双端可用），修改型 API 一律返回新状态、不改动入参，时间由调用方注入（模块内无 `Date.now` / 定时器）：

| 模块 | 职责 |
| --- | --- |
| `js/link3d.js` | 核心连通性算法：扩展网格、`findPath`（0/1/2 转弯逐级查找）、`findSolvablePair`、`shuffleGrid`（保占位 + 有解保证） |
| `js/combo.js` | 连击窗口与加成计分、分难度最高分档位 |
| `js/timer.js` | 无尽/限时双模式计时状态机（start/tick/pause/resume） |
| `js/ranking.js` | 本地排行榜：条目校验、Top10 插入、序列化 |
| `js/frost.js` | 冰封状态层：telegraph 预警 → freeze 生效、thawAround 四邻解冻、同屏上限、可解性判定接口 |
| `js/enemy.js` | 霜之巡猎者决策大脑：cadence 节拍、目标选取（不连猎）、事件流输出（执行与回滚归调用方） |
| `js/campaign.js` | 战役数据表 LEVELS（10 关）与关卡纯函数：校验、解锁、星级计算 |
| `js/save.js` | 战役存档：load/save/recordResult（星级只升不降，最佳分取大、最佳时取小） |
| `js/hint.js` | 提示系统：每局 3 次，寻找可连对子并生成路径描述 |
| `js/tutorial.js` | 新手引导分步文案 |
| `js/mobile.js` | 窄视口检测与场景缩放 |
| `js/fx.js` | 粒子特效池：碎裂粒子、预警收缩圈等视效的状态推进 |

外围：`js/game.js` 为主循环接线层（组合以上模块 + DOM/存储副作用）；`js/stars.js` / `js/music.js` 为星空背景与 WebAudio 程序化音效/BGM；渲染层为 `index.html` + `css/style.css`。

测试：`node tests/run-tests.js` **共 401 项**——算法/纯函数用例、无浏览器静态接线断言（`tests/*-static-check.js`，模式参考 `tests/space-static-check.js`），以及逐关确定性仿真套件（每关 10 局 × 10 关，死局必须为 0，同种子重放逐字节一致）。浏览器端可打开 `tests.html`。

## 这个项目是怎么造出来的（公开幕后）

本仓库是一个「人类 Owner + AI 团队协作」的公开实验：

- **AI 开发者**（OpenHands Agent，账号 StarForrest，运行在 24h 服务器）：通过 issue 收件箱领取任务、写代码、开 PR、按评审意见返工；
- **AI Tech Lead**（Hermes / ZCode Agent）：脚手架、CI、代码评审与合并把关；
- **人类 Owner**：产品决策、真机复验、验收与发布。

从技术 demo 到冰晶星云战役篇（v2.0.0）的全部版本演进记录在 [CHANGELOG.md](CHANGELOG.md)，后续星系规划见 [docs/ROADMAP.md](docs/ROADMAP.md)，关卡内容制作规范见 [docs/LEVEL_GUIDE.md](docs/LEVEL_GUIDE.md)。

## 开发约定

- 架构约定与代码地图见 [AGENTS.md](AGENTS.md)；贡献流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。
- 每个 PR 自动跑 `tests/run-tests.js`（GitHub Actions，见 `.github/workflows/ci.yml`）。

## License

MIT
