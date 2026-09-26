# LEVEL_GUIDE — 关卡制作规范（AI 团队向）

> 本文档是新增/调整战役关卡时的制作规范，源自冰晶星云篇（T1–T7）已定稿的
> 模块契约与 T6a/T6b 调优实践。改关卡数据前通读全文，按「新增关卡流程」执行。

## 1. LEVELS 字段契约（`js/campaign.js`）

每个关卡定义为固定字段的对象，`validateLevel(def)` 非法即抛 `Error`：

| 字段 | 类型 | 口径 |
| --- | --- | --- |
| `id` | 非负整数 | 关卡序号，从 0 连续递增；第 0 关恒解锁 |
| `name` | 非空字符串 | 关名（星图/结算展示用） |
| `rows` / `cols` | 正整数 | 内容盘行列数，均 ≥4（**不含** link3d 扩展网格的外圈空边框） |
| `pairs` | 正整数 | 牌对数，`pairs × 2 ≤ rows × cols`（validateLevel 强制）；现有关卡均为满盘 `pairs = rows×cols/2` |
| `timeLimitSec` | 非负整数 | 时限（秒）；`0` 表示不限时 |
| `parSec` | 正整数 | 3★ 阈值（秒）；星级 = `≤parSec` 3★，`≤parSec×1.5` 2★，通关 1★（见 `Campaign.starsFor`） |
| `frost` | 数组 `[{r, c}]` | 开局预冻格；可为空数组 |
| `hunter` | `{cadenceMs, telegraphMs}` 或 `null` | 巡猎者参数；`null` 表示本关无巡猎者 |

**坐标口径（易错点）**：`frost` 的 `{r, c}` 与 frost/enemy 模块全部坐标一律为
**游戏内 1-based 内容格坐标**（不含 link3d 扩展网格的外圈空边框）。
不要与 `link3d.js` 内部扩展网格坐标（外圈 +1 的 0-based）混用。

预冻格选取原则（沿用现有关卡）：对称分布、避开盘面四角、避免开局即封死边缘连线位。

## 2. 设计约束

### 2.1 冻结后必可解（硬约束）

任何含 frost/hunter 的关卡，在仿真口径下 **10 局死局数必须为 0**。方法论（T6a/T6b 定稿）：

- 用真实模块（campaign / frost / enemy / link3d）跑 `tests/level-simulation.define.js` 口径的贪心仿真：行优先扫描首个可连对、每 1.5s 一步、巡猎者按真实 `Enemy.tick` 以 250ms 心跳推进、事件迁移与 `game.js#handleEnemyEvent` 同款；
- 洗牌保底（`shuffleGrid`）不看冰冻，因此「洗牌后仍无可连对」即记死局——这是仿真要暴露的核心点（T6b 裁决：洗牌同时全场解冻来兜底，新关卡若死局 > 0 优先按此思路调数据而非改规则）；
- 出报告：`node -e "process.stdout.write(require('./tests/level-simulation.define.js').report())"`。

### 2.2 par 取值方法

- 基线 = **贪心仿真平均通关用时 × 3**（真人相对贪心的余量系数）；
- 复核判据（与仿真 `suggestion()` 一致）：贪心平均 ≤ par/3 → par 偏宽可下调；贪心平均在 par 内且留余量 → 基本合理；贪心平均超 par → 偏紧，复核 par 或牌量；
- 调整后重跑仿真套件确认通关率与死局不回退。

### 2.3 hunter cadence 与 telegraph 的关系

- `telegraphMs` 是玩家反制窗口：预警期满后 freeze 才生效，玩家可在期内消除目标格取消冻结（`Enemy.cancelTarget` / tick 自愈）；
- `cadenceMs` 决定压制节奏：cadence 越短、telegraph 越短，压迫感越强。现有关卡 telegraph 统一 3000ms（终关 2500ms），cadence 从 30s（L6）收紧到 18s（L8/L9）；
- 约束校验（`validateLevel` 已强制）：`telegraphMs < cadenceMs`，否则预警期侵占下一周期；
- 同屏冰冻上限 4（`Frost.MAX_FROZEN`）：cadence 过短会大量 skip（`frozen-cap` 事件），实际压制力未必增加，调参时看仿真事件统计而非只看配置。

## 3. 返回值契约警示表（#35 教训制度化）

背景：T5 曾把 `SV.save()`（写盘布尔）的返回值赋给数据变量，导致存档被 `true` 污染、
星图解锁恒 false（issue #35）。核心原则：**修改型 API 返回什么，就只把它当什么用**。
接线前先读模块头部注释的返回契约，下表为高频错配清单：

| API | 返回 | 禁止用法 |
| --- | --- | --- |
| `save.recordResult(data, …)` | **新存档数据对象** | 丢弃返回值导致星级/纪录不落档 |
| `save.save(storage, data)` | **布尔**（写盘成败） | 返回值赋给数据变量（#35 原事故式：`data = SV.save(...)`） |
| `frost.telegraph(state, …)` | **裸的新 state** | 按信封解构 `{ state, applied }`（值为 undefined） |
| `frost.freeze(state, …)` | **信封 `{ state, applied }`** | 把返回值直接当 state 传递 |
| `frost.thawAround(state, …)` | **裸的新 state** | 按信封解构 |
| `enemy.tick(state, now, ctx)` | **`{ state, events }`** | 忽略 events（冻结请求靠事件传达） |

回归保障：`tests/starmap-static-check.js` 断言 `game.js` 源码中不得出现
`= SV.save(` / `= CampaignSave.save(` 赋值模式；新增同类接线时同步补静态断言。

## 4. 新增关卡流程

1. 在 `js/campaign.js` 的 `LEVELS` 追加/修改关卡定义（字段口径见第 1 节），确认 `validateAll()` 通过；
2. 跑仿真套件：`node tests/run-tests.js`（含每关 10 局仿真断言）；需要人读结果时跑 `report()` 输出调优表；
3. **死局必须为 0**——不为 0 时按 2.1 调整 frost 布局 / hunter 参数 / 洗牌兜底，禁止放松断言迁就数据；
4. 若新增静态断言或 HUD 结构有变化，同步更新对应 `tests/*-static-check.js` 选择器（选择器适配须在 PR 里说明，不得删改既有语义断言）；
5. UI/文案如涉及新机制，同步 `index.html` / `css/style.css` / 引导文案（`js/hint.js` 的 STEPS 有「无开发中/即将上线表述」静态断言）；
6. PR 里附仿真报告表（关名 / 通关 x/10 / 死局 / 平均用时 / par / 建议方向）。
