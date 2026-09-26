# Changelog

本项目所有值得注意的变更都记录在此文件。
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [2.0.0] - 2026-09

冰晶星云战役篇：游戏从单棋盘连连看升级为带星图、存档与战役敌人的星系战役。

### Added

- **冰晶星云战役**：10 关战役数据表（`js/campaign.js` LEVELS + `validateLevel` 校验）、星图界面与关卡装载流程、星级结算（≤Par 3★ / ≤Par×1.5 2★ / 通关 1★）、前一关 ≥1 星解锁下一关（T5，issue #25/#34）。
- **战役存档**：本地持久化（`js/save.js`，星级只升不降、最佳分取大、最佳时取小）（T5）。
- **冰封机制**：冰冻格不可选中/不可作连线端点、消除解冻四邻、预警（telegraph）期满才冻结、同屏上限 4、可解性判定接口（`js/frost.js`）（T2，issue #27）。
- **霜之巡猎者**：按 cadence 节拍选格与预警的敌人决策大脑（`js/enemy.js`），事件化接线游戏主循环（HUD 预警圈 / 冻结音效 / 目标消除取消）（T3/T4，issue #29/#31）。
- **视效打磨**：解冻碎裂粒子、预警收缩圈、冻结质感、星级点亮 pop、连击呼吸光晕，全部带 Reduced Motion 降级（`js/fx.js` + CSS）（T7，issue #41）。
- **逐关确定性仿真套件**：每关 10 局贪心仿真入 CI（死局硬断言 = 0、同种子重放逐字节一致），配套调优报告（`tests/level-simulation.define.js`）（T6a，issue #37）。
- **洗牌全场解冻**：无可连对洗牌时同步清空全部冰冻与预警，兜住「洗牌保底不看冰冻」型死局；par 收紧、L9 cadence 调至 18s（T6b 平衡裁决，issue #39）。
- 文档收口：README 重写、`docs/ROADMAP.md`、`docs/LEVEL_GUIDE.md`（T8，issue #43）。

## [1.0.0] - 2026-09

初始技术 demo 及其同期上线的完整玩法系统。

### Added

- 3D 连连看核心：扩展网格连通性算法（折线 ≤2 转弯、棋盘外绕线，`js/link3d.js` UMD 双端模块）、CSS 3D 立方体牌与透视棋盘、自动洗牌（保占位 + 有解保证）（issue #2）。
- WebAudio 程序化音效与静音开关；内联 SVG favicon（issue #4/#6）。
- 难度三档：简单 4×4 / 标准 4×6 / 困难 6×8（issue #7）。
- 连击计分与分难度最高分（issue #9）。
- 太空主题动态星空背景 + WebAudio 程序化 BGM（issue #11）。
- 计时挑战模式（120 秒倒计时 + 暂停）（issue #17）。
- 本地排行榜 Top10 分难度（issue #18）。
- 触屏与移动端适配（HUD 收纳、44px 热区、360px 断点、性能降级）（issue #19）。
- 主题切换系统（深空 / 浅色 / 霓虹）与无障碍适配（issue #20）。
- 提示系统（每局 3 次）与新手引导（issue #16）。
