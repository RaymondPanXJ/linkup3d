/**
 * tests/level-simulation.define.js — T6a 逐关轻量确定性仿真（issue #37）
 *
 * 目标：用真实模块（campaign / frost / enemy / link3d）对 LEVELS 逐关仿真，
 * 每关 10 局（注入不同 rng 种子），只出报告、不改数据、不做调优（调优归 T6b）。
 *
 * 仿真口径（与 js/game.js 实际接线逐条对齐）：
 *   - 贪心玩家：每次取「行优先扫描到的首个同值可连对」（端点排除冰冻格，
 *     连线不可穿越冰冻格——与 Frost.isBoardSolvable 同一定义）消除，
 *     随后 Frost.thawAround 解冻四邻；步频按每 1.5s 一步近似。
 *     说明：不直接用 L.findSolvablePair——它对 rng 取值序洗牌且不了解冰冻端点，
 *     这里用确定性行优先扫描保证复现，并对齐 game.js 的冰冻选择门控。
 *   - 巡猎者：按关卡 hunter 参数走真实 Enemy.tick，时钟按 250ms 心跳推进
 *     （对齐 game.js 的 setInterval 250ms），事件按 game.js handleEnemyEvent
 *     同款迁移（telegraph→Frost.telegraph，freeze→Frost.freeze，不做可解性
 *     回滚——对齐 T4 取舍，死局统计正是 T6 要暴露的点）；预警目标被消除时
 *     按 eliminate() 路径显式 cancelTarget。
 *   - 洗牌：无可连对时按 game.js doShuffle 同款调一次 L.shuffleGrid
 *     （内部 200 次随机 + 构造性保底，保底口径不看冰冻）；洗牌后仍无
 *     冰冻可连对 → 记一次死局。
 *   - 时限：timeLimitSec > 0 时从开局计时，超时记「超时」（非死局）。
 *   - 时钟零依赖：不用 Date.now / setTimeout，全部注入推进。
 *
 * 断言口径（对齐 issue #37「断言从简」+ 验收「全套件全绿」）：
 * 每关死局数作为报告数据输出（L6/L8/L9 存在真实死局，见 PR/issue 报告，
 * 修复归 T6b，不让红灯常驻套件）；套件本身断言可全绿执行的确定性契约：
 * 全部 100 局收敛出合法结局、同种子重放逐字节一致、口径常量正确。
 * 通关率与平均用时只进报告（report()），是 T6b 调优的输入，不设硬断言。
 *
 * 运行：node tests/run-tests.js
 * 报告：node -e "process.stdout.write(require('./tests/level-simulation.define.js').report())"
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('../js/campaign.js'),
      require('../js/frost.js'),
      require('../js/enemy.js'),
      require('../js/link3d.js')
    );
  } else {
    root.LevelSimulation = factory(root.Campaign, root.Frost, root.Enemy, root.Link3D);
  }
})(typeof self !== 'undefined' ? self : this, function (CP, FRZ, ENM, L) {
  'use strict';

  var RUNS_PER_LEVEL = 10;     // 每关 10 局（issue #37：控制会话负载）
  var PLAYER_STEP_MS = 1500;   // 贪心玩家步频近似：每 1.5s 一步
  var HEARTBEAT_MS = 250;      // 心跳粒度（对齐 game.js 250ms interval）
  var CLOCK0_MS = 1000;        // 开局时钟基点（>0 便于预冻 telegraph/freeze 合法）

  function case_(name, pass, detail) {
    return { name: name, pass: !!pass, detail: detail || (pass ? 'ok' : 'FAILED') };
  }

  // mulberry32：小型确定性 PRNG，同种子必同局
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

  // 已冻结格集合 {"r,c": true}
  function frozenMap(frostState) {
    var m = {};
    FRZ.frozenList(frostState).forEach(function (p) { m[key(p.r, p.c)] = true; });
    return m;
  }

  // 行优先扫描首个「同值、双端未冻结、可连」对子；无则 null。
  // 冰冻格在 grid 中仍是占位值，连线天然不可穿越；此处只需排除冻结端点。
  function findFirstPair(grid, fmap) {
    var size = L.gridSize(grid);
    var byVal = {};
    for (var r = 1; r <= size.rows; r++) {
      for (var c = 1; c <= size.cols; c++) {
        var v = grid[r][c];
        if (v > 0 && !fmap[key(r, c)]) {
          (byVal[v] = byVal[v] || []).push({ r: r, c: c });
        }
      }
    }
    var values = Object.keys(byVal).map(Number).sort(function (x, y) { return x - y; });
    for (var i = 0; i < values.length; i++) {
      var cells = byVal[values[i]];
      for (var x = 0; x < cells.length; x++) {
        for (var y = x + 1; y < cells.length; y++) {
          if (L.findPath(grid, cells[x], cells[y])) {
            return { a: cells[x], b: cells[y] };
          }
        }
      }
    }
    return null;
  }

  // 巡猎者心跳一步：真实 Enemy.tick + game.js 同款事件迁移（无回滚，对齐 T4）
  function hunterStep(enemyState, frostState, grid, now, rng) {
    var tiles = {}, fmap = frozenMap(frostState);
    var size = L.gridSize(grid);
    for (var r = 1; r <= size.rows; r++) {
      for (var c = 1; c <= size.cols; c++) {
        if (grid[r][c] > 0 && !fmap[key(r, c)]) tiles[key(r, c)] = true;
      }
    }
    var ctx = {
      tiles: tiles,
      frozen: fmap,
      canFreeze: FRZ.countFrozen(frostState) < FRZ.MAX_FROZEN,
      rng: rng
    };
    var res = ENM.tick(enemyState, now, ctx);
    enemyState = res.state;
    for (var i = 0; i < res.events.length; i++) {
      var ev = res.events[i];
      if (ev.type === 'telegraph') {
        frostState = FRZ.telegraph(frostState, ev.r, ev.c, now, enemyState.telegraphMs);
      } else if (ev.type === 'freeze') {
        frostState = FRZ.freeze(frostState, ev.r, ev.c, now).state;
      }
      // 'cancel' / 'skip'：仿真无 UI，状态已在 tick 内推进
    }
    return { enemyState: enemyState, frostState: frostState };
  }

  /**
   * 单局仿真。返回 { outcome: 'clear'|'deadlock'|'timeout', timeUsedSec }
   * outcome 三选一必然成立（循环内每个出口都有返回），不会挂死：
   * 每轮要么消除（牌数 -2 单调递减），要么走死局/超时判定。
   */
  function simulateRun(lv, runIdx) {
    var rng = mulberry32(lv.id * 1000 + runIdx + 7);
    var grid = L.dealGrid(lv.rows, lv.cols, rng);
    var frostState = FRZ.create();
    var clock = CLOCK0_MS;

    // 预冻落位：对齐 game.js enterCampaign 的 telegraph(过去)→freeze 直链
    lv.frost.forEach(function (p) {
      frostState = FRZ.telegraph(frostState, p.r, p.c, CLOCK0_MS - 2, 1);
      frostState = FRZ.freeze(frostState, p.r, p.c, CLOCK0_MS - 1).state;
    });

    // 巡猎者启动：对齐 enterCampaign，时刻回拨一个周期后立即走首 tick 选目标
    var enemyState = null;
    if (lv.hunter) {
      enemyState = ENM.create(lv.hunter.cadenceMs, lv.hunter.telegraphMs,
        CLOCK0_MS - lv.hunter.cadenceMs);
      var h0 = hunterStep(enemyState, frostState, grid, CLOCK0_MS, rng);
      enemyState = h0.enemyState;
      frostState = h0.frostState;
    }

    var limitMs = lv.timeLimitSec > 0 ? lv.timeLimitSec * 1000 : Infinity;

    while (true) {
      if (L.countTiles(grid) === 0) {
        return { outcome: 'clear', timeUsedSec: (clock - CLOCK0_MS) / 1000 };
      }
      if (clock - CLOCK0_MS >= limitMs) {
        return { outcome: 'timeout', timeUsedSec: (clock - CLOCK0_MS) / 1000 };
      }

      // 心跳推进一个玩家步长（250ms × 6），巡猎者全程走真实 tick
      for (var sub = 0; sub < PLAYER_STEP_MS / HEARTBEAT_MS; sub++) {
        clock += HEARTBEAT_MS;
        if (enemyState) {
          var h = hunterStep(enemyState, frostState, grid, clock, rng);
          enemyState = h.enemyState;
          frostState = h.frostState;
        }
      }

      // 贪心玩家行动
      var pair = findFirstPair(grid, frozenMap(frostState));
      if (!pair) {
        // 对齐 game.js：无可连对 → 洗牌保底一次；仍无 → 死局
        L.shuffleGrid(grid, rng);
        pair = findFirstPair(grid, frozenMap(frostState));
        if (!pair) {
          return { outcome: 'deadlock', timeUsedSec: (clock - CLOCK0_MS) / 1000 };
        }
      }
      // 消除联动（对齐 eliminate()）：预警目标被消 → cancelTarget；四邻解冻
      if (enemyState && enemyState.target &&
          ((enemyState.target.r === pair.a.r && enemyState.target.c === pair.a.c) ||
           (enemyState.target.r === pair.b.r && enemyState.target.c === pair.b.c))) {
        enemyState = ENM.cancelTarget(enemyState, enemyState.target.r, enemyState.target.c);
      }
      frostState = FRZ.thawAround(frostState, pair.a.r, pair.a.c, pair.b.r, pair.b.c);
      grid[pair.a.r][pair.a.c] = 0;
      grid[pair.b.r][pair.b.c] = 0;
    }
  }

  // 单关汇总：10 局 → 通关/死局/超时计数 + 通关局平均用时（秒）+ 逐局结局（回放比对用）
  function simulateLevel(lv) {
    var clears = 0, deadlocks = 0, timeouts = 0, clearTimeSum = 0;
    var outcomes = [];
    for (var i = 0; i < RUNS_PER_LEVEL; i++) {
      var r = simulateRun(lv, i);
      outcomes.push(r.outcome + ':' + r.timeUsedSec);
      if (r.outcome === 'clear') {
        clears++;
        clearTimeSum += r.timeUsedSec;
      } else if (r.outcome === 'deadlock') {
        deadlocks++;
      } else if (r.outcome === 'timeout') {
        timeouts++;
      } else {
        outcomes[outcomes.length - 1] = 'INVALID';
      }
    }
    return {
      level: lv,
      clears: clears,
      deadlocks: deadlocks,
      timeouts: timeouts,
      avgClearSec: clears > 0 ? Math.round(clearTimeSum / clears) : 0,
      outcomes: outcomes
    };
  }

  var cached = null;
  function results() {
    if (!cached) {
      cached = CP.LEVELS.map(simulateLevel);
    }
    return cached;
  }

  // 逐关用例：结局合法（通关+死局+超时 = 10，全部收敛）；死局数进 detail 报告。
  // L6/L8/L9 死局为真实设计缺口（洗牌保底不看冰冻），修复归 T6b——见 PR 说明。
  function levelCases() {
    return results().map(function (s) {
      var lv = s.level;
      var detail = '通关 ' + s.clears + '/' + RUNS_PER_LEVEL +
        ' · 死局 ' + s.deadlocks + ' · 超时 ' + s.timeouts +
        ' · 通关平均 ' + s.avgClearSec + 's / par ' + lv.parSec + 's';
      return case_('仿真S-L' + lv.id + ' 「' + lv.name + '」10 局全部收敛出合法结局',
        s.clears + s.deadlocks + s.timeouts === RUNS_PER_LEVEL, detail);
    });
  }

  // 建议调优方向（一句话启发式，供 T6b 参考；贪心口径偏乐观是已知近似）
  function suggestion(s) {
    if (s.deadlocks > 0) {
      return '存在死局（冻结封锁型：洗牌保底不看冰冻），T6b 优先处理';
    }
    if (s.timeouts > 0) {
      return '贪心步频下仍出现超时（' + s.timeouts + '/10），时限或牌量需复核';
    }
    if (s.avgClearSec * 3 <= s.level.parSec) {
      return '贪心平均远低于 par（约 1/3 以下），par 偏宽，T6b 可考虑下调 par';
    }
    if (s.avgClearSec <= s.level.parSec) {
      return '贪心平均在 par 内且留有余量，par 基本合理，T6b 可微调密度';
    }
    return '贪心平均已超 par，par 偏紧，T6b 需复核 par 或牌量';
  }

  // 报告：10 行表格（issue #37 交付物），直接贴 issue 评论
  function report() {
    var lines = [];
    lines.push('| 关名 | 通关 x/10 | 死局 x | 平均用时 | 现行 par | 建议调优方向 |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    results().forEach(function (s) {
      lines.push('| L' + s.level.id + ' ' + s.level.name +
        ' | ' + s.clears + '/10' +
        ' | ' + s.deadlocks +
        ' | ' + (s.clears > 0 ? s.avgClearSec + 's' : '—') +
        ' | ' + s.level.parSec + 's' +
        ' | ' + suggestion(s) + ' |');
    });
    return lines.join('\n');
  }

  return {
    RUNS_PER_LEVEL: RUNS_PER_LEVEL,
    simulateRun: simulateRun,
    simulateLevel: simulateLevel,
    results: results,
    report: report,
    runAll: function () {
      var cases = levelCases();
      var runs = CP.LEVELS.length * RUNS_PER_LEVEL;
      var rs = results();
      // S10：覆盖 + 结局合法（所有计数只由三种合法结局累加而来）
      var allLegal = rs.every(function (s) {
        return s.clears + s.deadlocks + s.timeouts === RUNS_PER_LEVEL &&
          s.outcomes.every(function (o) { return o !== 'INVALID'; });
      });
      // S11：确定性回放——同种子重跑，逐局结局(含用时)完全一致
      var replayOk = CP.LEVELS.every(function (lv) {
        var again = simulateLevel(lv);
        return JSON.stringify(again.outcomes) ===
          JSON.stringify(rs[lv.id].outcomes);
      });
      return cases.concat([
        case_('仿真S10 逐关覆盖 ' + CP.LEVELS.length + ' 关 × ' + RUNS_PER_LEVEL +
          ' 局 = ' + runs + ' 局全部收敛出合法结局', allLegal),
        case_('仿真S11 确定性回放：同种子重跑 100 局结局与用时逐一一致', replayOk)
      ]);
    }
  };
});