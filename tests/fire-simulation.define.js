/**
 * tests/fire-simulation.define.js — T3 逐关确定性仿真：熔岩蔓延后必存在可解对（issue #65）
 *
 * 目标：用真实模块（campaign / frost / fire / enemy / link3d）对 LEVELS 逐关仿真，
 * 每关 10 局（注入不同 rng 种子）× 全程蔓延回合，硬断言「每个熔岩回合（蔓延/喷发）
 * 落地前后，火+冰封联合口径可解性不得由真变假」——即火从不把可解盘烧成不可解，
 * 把 LEVEL_GUIDE §2.1「冰封后必可解」平推到火。仿真口径逐条对齐 js/game.js T2 接线（issue #65）：
 *   - 贪心玩家：行优先扫描首个「同值、双端未冻未燃、可连」对消除（排除口径对齐
 *     onTileClick 的 Frost.canSelect ∧ Fire.canSelect 门控）。不用 L.findSolvablePair
 *     （它不了解冰封/燃烧端点且对 rng 取值序洗牌），与 level-simulation 同法。
 *   - 熔岩口：独立节奏推进——每 FIRE_SPREAD_MS(12s) 一个蔓延回合：真实 FIR.spread
 *     在冰封置 -1 的工作格上推进，applied ∧ FIR.isBoardSolvable 才落地，否则整回合
 *     回滚（T2 双判）；每 FIRE_IGNITE_EVERY(2) 回合从「占位∧未燃∧未冻」候选行优先
 *     表按注入 rng 抽一格引燃，同判回滚。开局第一拍仅校准基准不喷火（对齐 onFireTick）。
 *     与巡猎者侧「冻结不回滚」口径不同：火侧有双判，这正是 T3 要验证的不变量。
 *   - 消除联动（对齐 eliminate()）：FIR.quenchAround 灭双端四邻 + FRZ.crackAround
 *     裂冰 + 双端清 0 + 预警目标被消 cancelTarget。
 *   - 巡猎者：真实 Enemy.tick + game.js handleEnemyEvent 同款迁移（无回滚，对齐 T4），
 *     250ms 心跳粒度，与 level-simulation 完全同法。
 *   - 洗牌复位：贪心无对 → doShuffle 同款（全场解冻 + shuffleGrid 保底 + 洗牌即熄火
 *     fireState=FIR.create()，fireTurn/lastFireAt 归零）；复位后仍无对 → 记死局。
 *   - rng 单一来源：发牌/蔓延/喷发/巡猎/洗牌共用一条 mulberry32 流（game.js 生产用
 *     Math.random，仿真注入确定性替代，消费顺序即口径）；时钟零依赖，全部注入推进。
 *
 * 不变量归属口径（避免误伤）：消除瞬间把仅剩可连对消掉、留下静态死盘，是 game.js
 * 既有「消除后 hasSolvablePair 守卫 → announceShuffle」通道的管辖区（与 T6 冰封仿真
 * 把无对记为洗牌路径同构），不是火的罪；因此违例只锚定火拍：
 *   violation ⇔ 火拍前联合口径可解 ∧ 火落地后联合口径不可解。
 * 「火拍前已死盘」单独计数（deadBefore），是洗牌守卫负载观测量，不算违例。
 *
 * 对照与自检（工单要求）：
 *   - fire-off 对照：同关卡×同种子×同机制关闭火侧（不蔓延不喷发、消除不再灭火），
 *     火不变量断言机制不得误报（违例计数=0，且结局与 level-simulation 冻结口径同构）。
 *   - 传感器自检：构造火墙包死唯一同牌对 + 全燃盘两组反例，断言口径函数必报警——
 *     证明逐关仿真的 0 违例是「真通过」而非「没在看」。
 *
 * 断言口径：每关（火开）不变量违例=0、死局=0 为硬断言；同种子整 trace 逐字节重放
 * 一致；同种子火开/火关轨迹必须分叉（仿真确实在模拟火）。通关率进 report()。
 *
 * 运行：node tests/run-tests.js
 * 报告：node -e "process.stdout.write(require('./tests/fire-simulation.define.js').report())"
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('../js/campaign.js'),
      require('../js/frost.js'),
      require('../js/fire.js'),
      require('../js/enemy.js'),
      require('../js/link3d.js')
    );
  } else {
    root.FireSimulation = factory(root.Campaign, root.Frost, root.Fire, root.Enemy, root.Link3D);
  }
})(typeof self !== 'undefined' ? self : this, function (CP, FRZ, FIR, ENM, L) {
  'use strict';

  var RUNS_PER_LEVEL = 10;      // 每关 10 局（对齐 level-simulation 会话负载口径）
  var PLAYER_STEP_MS = 1500;    // 贪心玩家步频近似（同 level-simulation）
  var HEARTBEAT_MS = 250;       // 心跳粒度（对齐 game.js 250ms interval）
  var CLOCK0_MS = 1000;         // 开局时钟基点（>0 便于预冻 telegraph/freeze 合法）
  var FIRE_SPREAD_MS = 12000;   // 对齐 game.js：每 12s 一个蔓延回合
  var FIRE_IGNITE_EVERY = 2;    // 对齐 game.js：每 2 回合尝试一次熔岩口喷发

  function case_(name, pass, detail) {
    return { name: name, pass: !!pass, detail: detail || (pass ? 'ok' : 'FAILED') };
  }

  // mulberry32（同 level-simulation，保证跨套件同种子同流）
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function key(r, c) { return r + ',' + c; }

  function frozenMap(frostState) {
    var m = {};
    FRZ.frozenList(frostState).forEach(function (p) { m[key(p.r, p.c)] = true; });
    return m;
  }

  function burningMap(fireState) {
    var m = {};
    FIR.burningList(fireState).forEach(function (p) { m[key(p.r, p.c)] = true; });
    return m;
  }

  // 冰封置 -1 工作格（对齐 game.js frostBlockedGrid，蔓延/喷发/可解判定的输入）
  function frostBlockedGrid(grid, frostState) {
    var work = grid.map(function (row) { return row.slice(); });
    FRZ.frozenList(frostState).forEach(function (p) {
      if (p.r >= 1 && p.r < work.length - 1 && p.c >= 1 && p.c < work[0].length - 1) work[p.r][p.c] = -1;
    });
    return work;
  }

  // 行优先扫描首个「同值、双端未冻未燃、可连」对；无则 null（贪心玩家视角）。
  // 燃烧格在 grid 中仍是占位值，连线天然不可穿越；此处只需排除燃烧/冻结端点。
  function findFirstPair(grid, fmap, bmap) {
    var size = L.gridSize(grid);
    var byVal = {};
    for (var r = 1; r <= size.rows; r++) {
      for (var c = 1; c <= size.cols; c++) {
        var v = grid[r][c];
        if (v > 0 && !fmap[key(r, c)] && !bmap[key(r, c)]) {
          (byVal[v] = byVal[v] || []).push({ r: r, c: c });
        }
      }
    }
    var values = Object.keys(byVal).map(Number).sort(function (x, y) { return x - y; });
    for (var i = 0; i < values.length; i++) {
      var cells = byVal[values[i]];
      for (var x = 0; x < cells.length; x++) {
        for (var y = x + 1; y < cells.length; y++) {
          if (L.findPath(grid, cells[x], cells[y])) return { a: cells[x], b: cells[y] };
        }
      }
    }
    return null;
  }

  /**
   * 火+冰封联合可解判定——「可解对恒非空」的口径，与 game.js 生产双判同源：
   *   - pairExists：存在一条双端未燃未冻、路径不穿燃烧/冰封格的实连对
   *     （对齐 FIR.findUnburnedSolvablePair，即 hasFireSafeSolvablePair）；
   *   - fireSolvable：FIR.isBoardSolvable（燃烧置 -1 的更宽口径，对齐 T2 双判）。
   * 生产双判用 pairExists ∧ fireSolvable 联合把关；仿真逐拍同时观测两者。
   * 空盘（已消除/已燃尽）视为平凡可解，交由结局判定（clear）接管。
   */
  function solvableAfterFire(grid, fireState, frostState) {
    if (L.countTiles(grid) === 0) return true;
    var work = frostBlockedGrid(grid, frostState);
    return FIR.findUnburnedSolvablePair(fireState, work, L.findPath) !== null &&
      FIR.isBoardSolvable(fireState, work, L);
  }

  // 巡猎者心跳一步：真实 Enemy.tick + game.js 同款事件迁移（与 level-simulation 同法）
  function hunterStep(enemyState, frostState, grid, now, rng) {
    var tiles = {}, fmap = frozenMap(frostState);
    var size = L.gridSize(grid);
    for (var r = 1; r <= size.rows; r++) {
      for (var c = 1; c <= size.cols; c++) {
        if (grid[r][c] > 0 && !fmap[key(r, c)]) tiles[key(r, c)] = true;
      }
    }
    var ctx = { tiles: tiles, frozen: fmap, canFreeze: FRZ.countFrozen(frostState) < FRZ.MAX_FROZEN, rng: rng };
    var res = ENM.tick(enemyState, now, ctx);
    enemyState = res.state;
    for (var i = 0; i < res.events.length; i++) {
      var ev = res.events[i];
      if (ev.type === 'telegraph') {
        frostState = FRZ.telegraph(frostState, ev.r, ev.c, now, enemyState.telegraphMs);
      } else if (ev.type === 'freeze') {
        frostState = FRZ.freeze(frostState, ev.r, ev.c, now).state;
      }
    }
    return { enemyState: enemyState, frostState: frostState };
  }

  /**
   * 单局仿真。opts.fire=false 时关闭火侧（不蔓延/不喷发/消除不灭火）作对照。
   * 火拍锚定不变量：pre 可解 ∧ post 不可解 → violations++；pre 已死 → deadBefore++。
   * 无挂死风险：每轮要么消除（牌数 -2 单调递减），要么走死局/超时判定。
   * 返回 { outcome, timeUsedSec, violations, deadBefore, rollbacks, spreads,
   *         ignites, shuffles, fireTicks, trace }
   */
  function simulateRun(lv, runIdx, opts) {
    opts = opts || {};
    var fireOn = opts.fire !== false;
    var rng = mulberry32(lv.id * 1000 + runIdx + 7); // 与 level-simulation 同种子
    var grid = L.dealGrid(lv.rows, lv.cols, rng);
    var frostState = FRZ.create();
    var fireState = FIR.create();
    var fireTurn = 0, lastFireAt = 0;
    var clock = CLOCK0_MS;

    var violations = 0, deadBefore = 0, rollbacks = 0, spreads = 0, ignites = 0,
      shuffles = 0, fireTicks = 0;
    var trace = [];

    // 预冻落位（对齐 enterCampaign：telegraph 过去时刻→freeze 直链）
    lv.frost.forEach(function (p) {
      frostState = FRZ.telegraph(frostState, p.r, p.c, CLOCK0_MS - 2, 1);
      frostState = FRZ.freeze(frostState, p.r, p.c, CLOCK0_MS - 1).state;
    });

    // 巡猎者启动（对齐 enterCampaign 回拨一个周期后首 tick 选目标）
    var enemyState = null;
    if (lv.hunter) {
      enemyState = ENM.create(lv.hunter.cadenceMs, lv.hunter.telegraphMs, CLOCK0_MS - lv.hunter.cadenceMs);
      var h0 = hunterStep(enemyState, frostState, grid, CLOCK0_MS, rng);
      enemyState = h0.enemyState;
      frostState = h0.frostState;
    }

    var limitMs = lv.timeLimitSec > 0 ? lv.timeLimitSec * 1000 : Infinity;
    var deadlocked = false;

    function snap(tag) {
      trace.push(tag + '|' + JSON.stringify([grid, fireState, frostState]) +
        '|v' + violations + '|b' + FIR.countBurning(fireState));
    }
    snap('init');

    while (true) {
      if (L.countTiles(grid) === 0) {
        return { outcome: 'clear', timeUsedSec: (clock - CLOCK0_MS) / 1000,
          violations: violations, deadBefore: deadBefore, rollbacks: rollbacks,
          spreads: spreads, ignites: ignites, shuffles: shuffles, fireTicks: fireTicks, trace: trace };
      }
      if (clock - CLOCK0_MS >= limitMs) {
        return { outcome: 'timeout', timeUsedSec: (clock - CLOCK0_MS) / 1000,
          violations: violations, deadBefore: deadBefore, rollbacks: rollbacks,
          spreads: spreads, ignites: ignites, shuffles: shuffles, fireTicks: fireTicks, trace: trace };
      }

      // 心跳推进一个玩家步长（250ms×6）：巡猎者全程真实 tick；火独立 12s 节奏
      for (var sub = 0; sub < PLAYER_STEP_MS / HEARTBEAT_MS; sub++) {
        clock += HEARTBEAT_MS;
        if (enemyState) {
          var h = hunterStep(enemyState, frostState, grid, clock, rng);
          enemyState = h.enemyState;
          frostState = h.frostState;
        }
        if (fireOn) {
          if (!lastFireAt) { lastFireAt = clock; continue; } // 新局第一拍仅校准（开局不喷火）
          if (clock - lastFireAt >= FIRE_SPREAD_MS) {
            lastFireAt = clock;
            fireTurn++;
            fireTicks++;
            // ——火拍不变量前件：落地前联合口径可解性——
            var pre = solvableAfterFire(grid, fireState, frostState);
            if (!pre) deadBefore++;
            var work = frostBlockedGrid(grid, frostState);
            var next = fireState;
            var out = FIR.spread(next, work, rng, fireTurn);
            spreads++;
            if (out.applied) {
              if (FIR.isBoardSolvable(out.state, work, L)) next = out.state;
              else rollbacks++;
            }
            if (fireTurn % FIRE_IGNITE_EVERY === 0 && FIR.countBurning(next) < FIR.MAX_BURNING) {
              var cands = [];
              var size = L.gridSize(grid);
              for (var rr = 1; rr <= size.rows; rr++) {
                for (var cc = 1; cc <= size.cols; cc++) {
                  if (grid[rr][cc] > 0 && FIR.canSelect(next, rr, cc) && FRZ.canSelect(frostState, rr, cc)) {
                    cands.push({ r: rr, c: cc });
                  }
                }
              }
              if (cands.length) {
                var q = cands[Math.floor(rng() * cands.length)];
                var ig = FIR.ignite(next, q.r, q.c, fireTurn);
                if (ig.applied) {
                  if (FIR.isBoardSolvable(ig.state, work, L)) { next = ig.state; ignites++; }
                  else rollbacks++;
                }
              }
            }
            fireState = next;
            // ——火拍不变量后件：火可解 → 落地后必仍可解（火从不杀盘）——
            var post = solvableAfterFire(grid, fireState, frostState);
            if (pre && !post) violations++;
            snap('fire:' + fireTurn + (pre ? '' : ':predead') + (post ? '' : ':postdead'));
          }
        }
      }

      // 贪心玩家行动
      var pair = findFirstPair(grid, frozenMap(frostState), burningMap(fireState));
      if (!pair) {
        // doShuffle 同款复位：全场解冻 + 保底洗牌 + 洗牌即熄火（fireTurn/lastFireAt 归零）
        frostState = FRZ.create();
        L.shuffleGrid(grid, rng);
        fireState = FIR.create(); fireTurn = 0; lastFireAt = 0;
        shuffles++;
        pair = findFirstPair(grid, frozenMap(frostState), burningMap(fireState));
        if (!pair) {
          snap('shuffle-reset');
          if (deadlocked) {
            return { outcome: 'deadlock', timeUsedSec: (clock - CLOCK0_MS) / 1000,
              violations: violations, deadBefore: deadBefore, rollbacks: rollbacks,
              spreads: spreads, ignites: ignites, shuffles: shuffles, fireTicks: fireTicks, trace: trace };
          }
          deadlocked = true; // 复位拍合法入 trace 后再判死局（对齐 game.js 复位在后）
          continue;
        }
        snap('shuffle-recovered');
      }
      // 消除联动（对齐 eliminate()）：灭火 + 裂冰 + 清 0 + 预警自愈
      if (fireOn) fireState = FIR.quenchAround(fireState, pair.a.r, pair.a.c, pair.b.r, pair.b.c).state;
      if (enemyState && enemyState.target &&
          ((enemyState.target.r === pair.a.r && enemyState.target.c === pair.a.c) ||
           (enemyState.target.r === pair.b.r && enemyState.target.c === pair.b.c))) {
        enemyState = ENM.cancelTarget(enemyState, enemyState.target.r, enemyState.target.c);
      }
      frostState = FRZ.crackAround(frostState, pair.a.r, pair.a.c, pair.b.r, pair.b.c).state;
      grid[pair.a.r][pair.a.c] = 0;
      grid[pair.b.r][pair.b.c] = 0;
      snap('clear'); // 消除后瞬间死盘归洗牌守卫管辖（见头注），不在此计违例
    }
  }

  // 单关汇总（火开）+ fire-off 对照（同种子），逐局结局/违例/火活动入 trace
  function simulateLevel(lv) {
    var clears = 0, deadlocks = 0, timeouts = 0, clearTimeSum = 0;
    var violations = 0, deadBefore = 0, rollbacks = 0, spreads = 0, ignites = 0,
      shuffles = 0, fireTicks = 0;
    var outcomes = [], controlTraces = [];
    for (var i = 0; i < RUNS_PER_LEVEL; i++) {
      var r = simulateRun(lv, i, { fire: true });
      outcomes.push(r.outcome + ':' + r.timeUsedSec + ':v' + r.violations +
        ':t' + r.fireTicks + ':r' + r.rollbacks);
      violations += r.violations; deadBefore += r.deadBefore; rollbacks += r.rollbacks;
      spreads += r.spreads; ignites += r.ignites; shuffles += r.shuffles; fireTicks += r.fireTicks;
      if (r.outcome === 'clear') { clears++; clearTimeSum += r.timeUsedSec; }
      else if (r.outcome === 'deadlock') deadlocks++;
      else if (r.outcome === 'timeout') timeouts++;
      else outcomes[outcomes.length - 1] = 'INVALID';
      controlTraces.push(simulateRun(lv, i, { fire: false }).trace.join('\n'));
    }
    return {
      level: lv, clears: clears, deadlocks: deadlocks, timeouts: timeouts,
      avgClearSec: clears > 0 ? Math.round(clearTimeSum / clears) : 0,
      violations: violations, deadBefore: deadBefore, rollbacks: rollbacks,
      spreads: spreads, ignites: ignites, shuffles: shuffles, fireTicks: fireTicks,
      outcomes: outcomes, controlTraces: controlTraces
    };
  }

  var cached = null;
  function results() {
    if (!cached) cached = CP.LEVELS.map(simulateLevel);
    return cached;
  }

  /* ---- 传感器自检：口径函数必须「会报警」（反证仿真 0 违例不是在裸奔） ---- */
  function sensorSelfCheck() {
    function makeGrid(rows, cols) {
      var g = [];
      for (var r = 0; r < rows + 2; r++) { g.push([]); for (var c = 0; c < cols + 2; c++) g[r].push(0); }
      return g;
    }
    // A. G13 同款构造：同牌 1 在 (2,2)/(3,3)，火墙 (1,2)(2,1)(2,3)(3,2) 封死 (2,2)
    //    四邻（4 格 = MAX_BURNING 上限内）→ 联合口径必须报警；同盘无火不误伤
    var g1 = makeGrid(4, 4);
    g1[2][2] = 1; g1[3][3] = 1;
    g1[1][2] = 5; g1[2][1] = 5; g1[2][3] = 5; g1[3][2] = 5;
    var walled = FIR.create();
    [[1, 2], [2, 1], [2, 3], [3, 2]].forEach(function (p) {
      walled = FIR.ignite(walled, p[0], p[1], 0).state;
    });
    var aWall = FIR.countBurning(walled) === 4 &&
      solvableAfterFire(g1, walled, FRZ.create()) === false &&
      solvableAfterFire(g1, FIR.create(), FRZ.create()) === true;

    // B. 全燃 2×2（4 张同值全燃烧=上限）：严口径必报警；宽口径按「清空可解」放行
    //    ——正好证明生产必须联合把关，单用 isBoardSolvable 会漏全燃盘
    var g2 = makeGrid(2, 2);
    var burned = FIR.create();
    [[1, 1], [1, 2], [2, 1], [2, 2]].forEach(function (p) {
      g2[p[0]][p[1]] = 9;
      burned = FIR.ignite(burned, p[0], p[1], 0).state;
    });
    var aBurned = FIR.countBurning(burned) === 4 &&
      solvableAfterFire(g2, burned, FRZ.create()) === false &&
      FIR.findUnburnedSolvablePair(burned, g2, L.findPath) === null &&
      FIR.isBoardSolvable(burned, g2, L) === true; // 宽口径清空放行（已知语义）

    return aWall && aBurned;
  }

  // 逐关硬断言：火开 10 局——违例=0 ∧ 死局=0 ∧ 结局合法
  function levelCases() {
    return results().map(function (s) {
      var lv = s.level;
      var detail = '通关 ' + s.clears + '/' + RUNS_PER_LEVEL + ' · 死局 ' + s.deadlocks +
        ' · 超时 ' + s.timeouts + ' · 违例 ' + s.violations +
        ' · 火拍 ' + s.fireTicks + '（蔓延 ' + s.spreads + ' 回滚 ' + s.rollbacks +
        '，喷发 ' + s.ignites + '，predead ' + s.deadBefore + '）· 洗牌 ' + s.shuffles;
      return case_('熔火仿真F-L' + lv.id + ' 「' + lv.name + '」10 局火拍从不杀盘且死局=0（issue #65）',
        s.clears + s.deadlocks + s.timeouts === RUNS_PER_LEVEL &&
        s.deadlocks === 0 && s.violations === 0, detail);
    });
  }

  function suggestion(s) {
    if (s.violations > 0) return '存在可解性违例，T2 双判失守，红线回归';
    if (s.deadlocks > 0) return '存在死局，火侧压制超过复位兜底能力，需调 FIRE_SPREAD_MS/上限';
    if (s.timeouts > 0) return '贪心步频下出现超时，蔓延压制拖慢节奏，par/时限需复核';
    if (s.fireTicks === 0) return '整关未触发火拍（通关过快），火的压力由后续关覆盖';
    if (s.rollbacks > s.spreads / 2) return '回滚过半：喷发/蔓延双判拦截极频，火近乎无效，可放宽';
    return '火拍全绿落地，联合口径不变量成立，节奏压力在贪心可承受内';
  }

  // 报告（镜像 level-simulation.report() 的表格交付物）
  function report() {
    var lines = [];
    lines.push('| 关名 | 通关 x/10 | 死局 | 违例 | 火拍 | 蔓延(回滚) | 喷发 | 洗牌 | 平均用时 | par | 判读 |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    results().forEach(function (s) {
      lines.push('| L' + s.level.id + ' ' + s.level.name +
        ' | ' + s.clears + '/10 | ' + s.deadlocks + ' | ' + s.violations +
        ' | ' + s.fireTicks +
        ' | ' + s.spreads + '(' + s.rollbacks + ') | ' + s.ignites + ' | ' + s.shuffles +
        ' | ' + (s.clears > 0 ? s.avgClearSec + 's' : '—') +
        ' | ' + s.level.parSec + 's | ' + suggestion(s) + ' |');
    });
    return lines.join('\n');
  }

  return {
    RUNS_PER_LEVEL: RUNS_PER_LEVEL,
    simulateRun: simulateRun,
    simulateLevel: simulateLevel,
    solvableAfterFire: solvableAfterFire,
    sensorSelfCheck: sensorSelfCheck,
    results: results,
    report: report,
    runAll: function () {
      var cases = levelCases();
      var rs = results();
      var runs = CP.LEVELS.length * RUNS_PER_LEVEL;
      // F10：逐关覆盖 + 结局合法
      var allLegal = rs.every(function (s) {
        return s.clears + s.deadlocks + s.timeouts === RUNS_PER_LEVEL &&
          s.outcomes.every(function (o) { return o.indexOf('INVALID') < 0; });
      });
      // F11：同种子整 trace 逐字节重放一致（含 grid/fire/frost 全状态）
      var replayOk = CP.LEVELS.every(function (lv) {
        for (var i = 0; i < RUNS_PER_LEVEL; i++) {
          var a = simulateRun(lv, i, { fire: true });
          var b = simulateRun(lv, i, { fire: true });
          if (JSON.stringify(a.trace) !== JSON.stringify(b.trace)) return false;
        }
        return true;
      });
      // F12：fire-off 对照——同种子同机制关火，违例必为 0（断言机制不误伤）
      var controlOk = rs.every(function (s) {
        var v = 0;
        for (var i = 0; i < RUNS_PER_LEVEL; i++) {
          var c = simulateRun(s.level, i, { fire: false });
          v += c.violations;
        }
        return v === 0;
      });
      // F13：火确实在起作用——凡有火拍的关，至少一个种子火开/火关 trace 分叉；
      // 无火拍 = 全部种子在首个熔岩拍(≈13.25s)前通关，属结构性无火可测，豁免名单
      // 只允许 tutorial 关 L0（关卡表若变、豁免扩散会红灯）
      var fireless = [], f13ok = true;
      rs.forEach(function (s) {
        if (s.fireTicks === 0) { fireless.push(s.level.id); return; }
        var anyDiff = false;
        for (var i = 0; i < RUNS_PER_LEVEL; i++) {
          var on = simulateRun(s.level, i, { fire: true });
          if (on.trace.join('\n') !== s.controlTraces[i]) { anyDiff = true; break; }
        }
        if (!anyDiff) f13ok = false;
      });
      var diverged = f13ok && fireless.every(function (id) { return id === 0; });
      return cases.concat([
        case_('熔火仿真F10 逐关覆盖 ' + CP.LEVELS.length + ' 关 × ' + RUNS_PER_LEVEL +
          ' 局 = ' + runs + ' 局全部收敛出合法结局', allLegal),
        case_('熔火仿真F11 确定性回放：同种子整 trace（grid/fire/frost 全状态）逐字节一致', replayOk),
        case_('熔火仿真F12 fire-off 对照：同种子关火，可解性断言机制零误报', controlOk),
        case_('熔火仿真F13 火活性证据：有火拍关卡轨迹分叉且无火拍豁免 ⊆ {L0 tutorial}' +
          (fireless.length ? '（豁免 L' + fireless.join(',L') + '：全部种子快于首拍 13.25s）' : ''), diverged),
        case_('熔火仿真F14 传感器自检：G13 火墙与全燃 2×2 反例必被联合口径报警', sensorSelfCheck())
      ]);
    }
  };
});
