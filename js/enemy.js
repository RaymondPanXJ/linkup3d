/**
 * enemy.js — 「霜之巡猎者」敌人纯函数大脑（无 DOM / 无存储 / 无内部定时器 / 无随机源内置）
 *
 * 敌人设计（issue #29，TechLead 定稿）：
 *   每 cadenceMs 一次行动循环；每次行动先在目标格登记 telegraphMs 预警，
 *   期满执行冻结。目标从「当前可正常操作且未冻结」的格子（ctx.tiles 注入）中选，
 *   优先级 ①与任一已冻结格正交相邻的格（ctx.frozen 注入，制造连锁压力）
 *   ②随机（ctx.rng 注入，保证 Node 确定性测试）。同一目标不被连续选中两次。
 *
 * 时序契约（T4 接线必须按此执行，不留歧义）——事件驱动两段式：
 *   1) tick 在行动时刻选出目标，返回事件 {type:'telegraph', r, c, untilMs}；
 *      调用方收到后调用 Frost.telegraph(frostState, r, c, now, telegraphMs) 登记冻结预警
 *      （untilMs = 注入的 now + telegraphMs，绝对时刻）。预警期内牌照常可被玩家消除。
 *   2) 预警期满后的第一次 tick 返回事件 {type:'freeze', r, c}，同时清除内部目标并进入下一周期；
 *      调用方收到后执行 Frost.freeze(frostState, r, c, now)：
 *      - applied=false（上限/重复等，Frost 兜底）→ 什么都不做；
 *      - applied=true → 调用方用 Frost.isBoardSolvable 检查盘面，不可解则回滚（解冻）。
 *      Enemy 不感知冻结是否生效（不内置冻结结果），回滚与可解性检查归调用方。
 *   3) 预警期内玩家消除了目标格：调用方显式调用 cancelTarget(state, r, c)；
 *      若调用方漏调，tick 会经 ctx.tiles 发现目标格已消失，自动取消并返回
 *      {type:'cancel', r, c} 事件（供 UI 撤掉红晕）。取消即结束本周期，下一行动
 *      时刻按原节拍推进（nextActionAt += cadenceMs，计时照走）。
 *   4) 上限跳过：tick 前调用方按 Frost.countFrozen(frostState) < MAX_FROZEN 算好
 *      ctx.canFreeze；达上限时本次行动返回 {type:'skip', reason:'frozen-cap'}，
 *      不选目标，计时照走。无可选目标时返回 {type:'skip', reason:'no-target'}。
 *   5) cadence 口径：nextActionAt 只在周期结束（freeze 发出 / 取消 / skip）时 += cadenceMs，
 *      行动间隔严格等于 cadenceMs（以调度时刻为准，无漂移）；每个 tick 至多产生一个事件。
 *
 * 状态结构（纯数据、可 JSON 序列化）：
 *   { cadenceMs, telegraphMs,
 *     cycleStartAt,                  // 最近一次行动（预警开始）时刻
 *     nextActionAt,                  // 下一行动（下次可选目标）时刻
 *     target: { r, c, until } | null,// 进行中的预警格（until = 预警期满绝对时刻）
 *     lastTarget: "r,c" | null }     // 上次选中的目标（禁止连猎同格）
 * 坐标为游戏内 1-based 内容格坐标（与 frost.js / campaign.js 口径一致）。
 *
 * 纯函数约束：所有修改型 API 一律返回新状态，绝不改动入参；代码不含
 * document / localStorage / Date.now / window. / setTimeout，时间一律由调用方注入，
 * 随机源一律经 ctx.rng 注入（风格对齐 js/frost.js，静态断言沿用 T1/T2 约束检查）。
 *
 * 该文件同时可在浏览器（window.Enemy）与 Node（module.exports）中使用。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Enemy = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------- 内部工具 ---------------- */

  function key(r, c) {
    return r + ',' + c;
  }

  function parseKey(k) {
    var i = k.indexOf(',');
    return { r: +k.slice(0, i), c: +k.slice(i + 1) };
  }

  function isCoord(v) {
    return typeof v === 'number' && isFinite(v) &&
      Math.floor(v) === v && v >= 1;
  }

  function isTime(v) {
    return typeof v === 'number' && isFinite(v) && v >= 0;
  }

  function isPos(v) {
    return typeof v === 'number' && isFinite(v) && v > 0;
  }

  // 入参防御：非法/被篡改的状态一律归一为安全空状态（cadence 归 0 → tick 静默）
  function normalize(s) {
    var out = {
      cadenceMs: 0, telegraphMs: 0,
      cycleStartAt: 0, nextActionAt: 0,
      target: null, lastTarget: null
    };
    if (!s || typeof s !== 'object') return out;
    if (isPos(s.cadenceMs)) out.cadenceMs = s.cadenceMs;
    if (isPos(s.telegraphMs)) out.telegraphMs = s.telegraphMs;
    if (isTime(s.cycleStartAt)) out.cycleStartAt = s.cycleStartAt;
    if (isTime(s.nextActionAt)) out.nextActionAt = s.nextActionAt;
    var t = s.target;
    if (t && typeof t === 'object' && isCoord(t.r) && isCoord(t.c) && isTime(t.until)) {
      out.target = { r: t.r, c: t.c, until: t.until };
    }
    if (typeof s.lastTarget === 'string') {
      var p = parseKey(s.lastTarget);
      if (isCoord(p.r) && isCoord(p.c)) out.lastTarget = s.lastTarget;
    }
    return out;
  }

  function clone(s) {
    return {
      cadenceMs: s.cadenceMs, telegraphMs: s.telegraphMs,
      cycleStartAt: s.cycleStartAt, nextActionAt: s.nextActionAt,
      target: s.target ? { r: s.target.r, c: s.target.c, until: s.target.until } : null,
      lastTarget: s.lastTarget
    };
  }

  function has(map, k) {
    return !!map && typeof map === 'object' &&
      Object.prototype.hasOwnProperty.call(map, k) && !!map[k];
  }

  // 正交四邻是否与任一冻结格相邻（优先级①；ctx.frozen 缺省视为无冻结格）
  function adjacentToFrozen(ctx, r, c) {
    return has(ctx.frozen, key(r - 1, c)) || has(ctx.frozen, key(r + 1, c)) ||
      has(ctx.frozen, key(r, c - 1)) || has(ctx.frozen, key(r, c + 1));
  }

  // 候选格：ctx.tiles 中值truthy 且坐标合法的键，按 (r, c) 数值升序保证确定性
  function candidates(ctx) {
    var tiles = ctx.tiles;
    if (!tiles || typeof tiles !== 'object') return [];
    var list = [];
    Object.keys(tiles).forEach(function (k) {
      if (!tiles[k]) return;
      var p = parseKey(k);
      if (isCoord(p.r) && isCoord(p.c)) list.push(p);
    });
    list.sort(function (a, b) { return a.r - b.r || a.c - b.c; });
    return list;
  }

  // 从 pool 中按注入随机源取一个；rng 缺失/返回非法值时取首个（确定性兜底）
  function pick(pool, rng) {
    if (typeof rng !== 'function') return pool[0];
    var v;
    try { v = rng(); } catch (e) { return pool[0]; }
    if (typeof v !== 'number' || !isFinite(v) || v < 0 || v >= 1) return pool[0];
    var i = Math.floor(v * pool.length);
    return pool[i < pool.length ? i : pool.length - 1];
  }

  /* ---------------- 公开 API ---------------- */

  // 初始状态：首个行动在 now + cadenceMs
  function create(cadenceMs, telegraphMs, now) {
    var cad = isPos(cadenceMs) ? cadenceMs : 0;
    var tel = isPos(telegraphMs) ? telegraphMs : 0;
    var t0 = isTime(now) ? now : 0;
    return {
      cadenceMs: cad, telegraphMs: tel,
      cycleStartAt: t0,
      nextActionAt: t0 + cad,
      target: null, lastTarget: null
    };
  }

  /**
   * tick(state, now, ctx) → { state, events }
   * ctx = {
   *   canFreeze: bool  调用方按 Frost.countFrozen < MAX_FROZEN 算好（缺省视为 true，
   *                    真正上限兜底在 Frost.freeze 的 applied）,
   *   tiles:  {"r,c": true}  现存可操作且未冻结的格,
   *   frozen: {"r,c": true}  已冻结格（可选，缺省 {}；用于优先级①邻接判定）,
   *   rng:    () => [0,1)   注入随机源（缺省确定性取首候选）
   * }
   * 每 tick 至多一个事件；时序契约见模块头。
   */
  function tick(state, now, ctx) {
    var s = clone(normalize(state));
    var c = ctx && typeof ctx === 'object' ? ctx : {};
    if (s.cadenceMs <= 0 || s.telegraphMs <= 0 || !isTime(now)) {
      return { state: s, events: [] };
    }

    // —— 预警进行中 ——
    if (s.target) {
      var tk = key(s.target.r, s.target.c);
      if (!has(c.tiles, tk)) {
        // 目标格已被消除/消失（调用方未走 cancelTarget 时的自愈）：取消并推进周期
        var gone = { r: s.target.r, c: s.target.c };
        s.target = null;
        s.nextActionAt += s.cadenceMs;
        return { state: s, events: [{ type: 'cancel', r: gone.r, c: gone.c }] };
      }
      if (now < s.target.until) {
        return { state: s, events: [] }; // 预警期内：无事发生
      }
      // 预警期满：发出冻结请求，进入下一周期（冻结执行与回滚归调用方，见模块头契约 2）
      var fr = { type: 'freeze', r: s.target.r, c: s.target.c };
      s.lastTarget = key(s.target.r, s.target.c);
      s.target = null;
      s.nextActionAt += s.cadenceMs;
      return { state: s, events: [fr] };
    }

    // —— 空档期：未到行动时刻 ——
    if (now < s.nextActionAt) return { state: s, events: [] };

    // —— 行动时刻 ——
    if (c.canFreeze === false) {
      s.nextActionAt += s.cadenceMs; // 达上限：静默跳过，计时照走
      return { state: s, events: [{ type: 'skip', reason: 'frozen-cap' }] };
    }

    var all = candidates(c);
    // 同一目标不连猎：仅当还有其它候选时才排除 lastTarget（避免独苗格把猎人饿死）
    var pool = all;
    if (s.lastTarget && all.length > 1) {
      var filtered = all.filter(function (p) { return key(p.r, p.c) !== s.lastTarget; });
      if (filtered.length > 0) pool = filtered;
    }
    var adj = pool.filter(function (p) { return adjacentToFrozen(c, p.r, p.c); });
    if (adj.length > 0) pool = adj; // 优先级①：邻接冻结格
    if (pool.length === 0) {
      s.nextActionAt += s.cadenceMs; // 无目标：跳过，计时照走
      return { state: s, events: [{ type: 'skip', reason: 'no-target' }] };
    }

    var t = pick(pool, c.rng);
    s.cycleStartAt = now;
    s.target = { r: t.r, c: t.c, until: now + s.telegraphMs };
    s.lastTarget = key(t.r, t.c);
    return {
      state: s,
      events: [{ type: 'telegraph', r: t.r, c: t.c, untilMs: now + s.telegraphMs }]
    };
  }

  // 玩家消除预警中的目标格 → 取消该次猎杀；仅当 (r,c) 与进行中目标一致才生效。
  // 取消即结束本周期，下一行动时刻按原节拍推进（nextActionAt += cadenceMs）。
  function cancelTarget(state, r, c) {
    var s = clone(normalize(state));
    if (s.target && s.target.r === r && s.target.c === c) {
      s.target = null;
      s.nextActionAt += s.cadenceMs;
    }
    return s;
  }

  // 是否有进行中的预警（供 UI 显示「猎杀进行中」；期满即 false）
  function isThreatening(state, now) {
    var s = normalize(state);
    return !!s.target && isTime(now) && now < s.target.until;
  }

  function snapshot(state) {
    return JSON.stringify(normalize(state));
  }

  // 兼容 JSON 字符串或已解析对象；损坏输入安全降级为静默状态（cadence 0 → tick 不行动）
  function restore(json) {
    if (typeof json === 'object' && json !== null) return normalize(json);
    if (typeof json !== 'string' || !json) return normalize(null);
    var obj;
    try { obj = JSON.parse(json); } catch (e) { return normalize(null); }
    return normalize(obj);
  }

  return {
    create: create,
    tick: tick,
    cancelTarget: cancelTarget,
    isThreatening: isThreatening,
    snapshot: snapshot,
    restore: restore
  };
});
