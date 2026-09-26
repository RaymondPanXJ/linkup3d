/**
 * tests/enemy.define.js — 「霜之巡猎者」纯函数大脑用例（issue #29）
 * 覆盖：节拍精度（cadence 到点才发事件）、两段式时序（telegraph→freeze）、
 * 优先级①邻接冻结格 / ②注入随机、同格不连猎、上限跳过、无目标跳过、
 * 预警被消除取消（显式 cancelTarget 与 ctx.tiles 自愈）、rng 注入确定性、
 * 纯函数不可变性、快照往返、非法输入防御。
 * 运行：node tests/run-tests.js
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../js/enemy.js'));
  } else {
    root.EnemyTests = factory(root.Enemy);
  }
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  function case_(name, pass, detail) {
    return { name: name, pass: !!pass, detail: detail || (pass ? 'ok' : 'FAILED') };
  }

  // 固定序列随机源：依次吐出序列值，耗尽后循环最后一个
  function seqRng(seq) {
    var i = 0;
    return function () {
      var v = seq[Math.min(i, seq.length - 1)];
      i += 1;
      return v;
    };
  }

  function json(v) { return JSON.stringify(v); }

  // 常用夹具：cadence=10000，telegraph=3000，create 于 t=0 → 首次行动 t=10000
  function fresh() { return E.create(10000, 3000, 0); }

  // 用例E1 create：初始状态可序列化、首行动在 now+cadence、无目标不威胁
  function e1() {
    var s = fresh();
    return case_('用例E1 create 初始状态（nextActionAt=now+cadence / target=null）',
      s.nextActionAt === 10000 && s.cycleStartAt === 0 && s.target === null &&
      s.lastTarget === null && E.isThreatening(s, 0) === false &&
      json(JSON.parse(json(s))) === json(s));
  }

  // 用例E2 节拍精度：cadence 未到点无任何事件，到点（=）当刻才发 telegraph
  function e2() {
    var s = fresh();
    var r1 = E.tick(s, 9999, { tiles: { '1,1': true } });
    var r2 = E.tick(s, 10000, { tiles: { '1,1': true }, rng: seqRng([0]) });
    var ev = r2.events;
    return case_('用例E2 节拍精度：9999 无事件 / 10000 到点发 telegraph(untilMs=now+tel)',
      r1.events.length === 0 && r1.state.nextActionAt === 10000 &&
      ev.length === 1 && ev[0].type === 'telegraph' && ev[0].r === 1 && ev[0].c === 1 &&
      ev[0].untilMs === 13000 && r2.state.target.until === 13000);
  }

  // 用例E3 两段式时序：预警期内静默，期满 tick 发 freeze 并清空目标进入下一周期
  function e3() {
    var s = E.tick(fresh(), 10000, { tiles: { '1,1': true, '1,2': true }, rng: seqRng([0]) }).state;
    var mid = E.tick(s, 12999, { tiles: { '1,1': true, '1,2': true } });
    var done = E.tick(mid.state, 13000, { tiles: { '1,1': true, '1,2': true } });
    return case_('用例E3 时序契约：telegraph 期满发 freeze，target 清空、nextActionAt+=cadence',
      mid.events.length === 0 && E.isThreatening(mid.state, 12999) === true &&
      done.events.length === 1 && done.events[0].type === 'freeze' &&
      done.events[0].r === 1 && done.events[0].c === 1 &&
      done.state.target === null && done.state.lastTarget === '1,1' &&
      done.state.nextActionAt === 20000 &&
      E.isThreatening(done.state, 13000) === false);
  }

  // 用例E4 优先级①：邻接已冻结格的候选必中选（即使随机源指向他处）
  function e4() {
    // 候选升序 [(1,1),(1,3),(2,3)]；冻结格 (2,2) → 仅 (1,2)?不存在、(2,3) 邻接 (2,2)
    var tiles = { '1,1': true, '1,3': true, '2,3': true };
    var frozen = { '2,2': true };
    var r = E.tick(fresh(), 10000, { tiles: tiles, frozen: frozen, rng: seqRng([0.99]) });
    var ev = r.events[0];
    return case_('用例E4 优先级①：与冻结格正交相邻的候选优先（rng 指他处也中）',
      ev.type === 'telegraph' && ev.r === 2 && ev.c === 3);
  }

  // 用例E5 优先级②随机：无冻结格时按注入 rng 从升序候选池取值
  function e5() {
    var tiles = { '1,1': true, '1,2': true, '2,1': true };
    var a = E.tick(fresh(), 10000, { tiles: tiles, rng: seqRng([0]) });
    var b = E.tick(fresh(), 10000, { tiles: tiles, rng: seqRng([0.99]) });
    return case_('用例E5 优先级②：rng=0 → 升序首格(1,1)；rng→1 → 末格(2,1)',
      a.events[0].r === 1 && a.events[0].c === 1 &&
      b.events[0].r === 2 && b.events[0].c === 1);
  }

  // 用例E6 同格不连猎：freeze 后下一周期 rng 再指同格也选他格；预警取消同样不连猎
  function e6() {
    var tiles = { '1,1': true, '1,2': true };
    var s = E.tick(fresh(), 10000, { tiles: tiles, rng: seqRng([0]) }).state; // 猎 (1,1)
    s = E.tick(s, 13000, { tiles: tiles }).state; // freeze，lastTarget='1,1'
    var next = E.tick(s, 20000, { tiles: tiles, rng: seqRng([0]) }); // rng=0 本会选 (1,1)
    var ev = next.events[0];
    return case_('用例E6 同格不连猎：上一目标被排除，改选 (1,2)',
      ev.type === 'telegraph' && ev.r === 1 && ev.c === 2);
  }

  // 用例E7 上限跳过：canFreeze=false 时发 skip 不选目标，计时照走
  function e7() {
    var r = E.tick(fresh(), 10000, { canFreeze: false, tiles: { '1,1': true } });
    var later = E.tick(r.state, 19999, { canFreeze: false, tiles: { '1,1': true } });
    var ok1 = r.events.length === 1 && r.events[0].type === 'skip' &&
      r.events[0].reason === 'frozen-cap' && r.state.target === null &&
      r.state.nextActionAt === 20000 && later.events.length === 0;
    var back = E.tick(r.state, 20000, { canFreeze: true, tiles: { '1,1': true }, rng: seqRng([0]) });
    return case_('用例E7 上限跳过：frozen-cap 事件 / 不选目标 / 计时照走 / 解除后可行动',
      ok1 && back.events[0].type === 'telegraph');
  }

  // 用例E8 无目标跳过：tiles 空 → no-target，计时照走；有目标恢复后可行动
  function e8() {
    var r = E.tick(fresh(), 10000, { tiles: {}, rng: seqRng([0]) });
    var back = E.tick(r.state, 20000, { tiles: { '3,4': true }, rng: seqRng([0]) });
    return case_('用例E8 无目标：skip(no-target)，下一周期有格即恢复猎杀',
      r.events[0].type === 'skip' && r.events[0].reason === 'no-target' &&
      r.state.nextActionAt === 20000 && back.events[0].type === 'telegraph' &&
      back.events[0].r === 3 && back.events[0].c === 4);
  }

  // 用例E9 cancelTarget：目标一致才取消并进入下一周期；不一致原样返回
  function e9() {
    var s = E.tick(fresh(), 10000, { tiles: { '1,1': true, '1,2': true }, rng: seqRng([0]) }).state;
    var wrong = E.cancelTarget(s, 1, 2);
    var right = E.cancelTarget(s, 1, 1);
    var after = E.tick(right, 20000, { tiles: { '1,1': true, '1,2': true }, rng: seqRng([0.99]) });
    return case_('用例E9 cancelTarget：命中目标即取消（nextActionAt+=cadence）/ 未命中不改状态',
      json(wrong) === json(s) && right.target === null &&
      right.nextActionAt === 20000 && E.isThreatening(right, 11000) === false &&
      after.events[0].type === 'telegraph');
  }

  // 用例E10 ctx.tiles 自愈：调用方漏调 cancelTarget 时，tick 发现目标格消失自动取消
  function e10() {
    var s = E.tick(fresh(), 10000, { tiles: { '1,1': true, '1,2': true }, rng: seqRng([0]) }).state;
    var r = E.tick(s, 11000, { tiles: { '1,2': true } }); // (1,1) 已被玩家消除
    return case_('用例E10 目标格消失自愈：cancel 事件 + 目标清空 + 计时推进',
      r.events.length === 1 && r.events[0].type === 'cancel' &&
      r.events[0].r === 1 && r.events[0].c === 1 &&
      r.state.target === null && r.state.nextActionAt === 20000);
  }

  // 用例E11 rng 注入确定性：同 rng 序列 + 同 ctx → 事件流与状态逐 tick 全等
  function e11() {
    function play() {
      var tiles = { '1,1': true, '1,2': true, '2,1': true, '2,2': true };
      var rng = seqRng([0.9, 0.1, 0.55, 0.7]);
      var s = fresh();
      var log = [];
      [10000, 13000, 20000, 23000, 30000].forEach(function (t) {
        var r = E.tick(s, t, { tiles: tiles, rng: rng });
        log.push(json(r.events));
        s = r.state;
      });
      return { log: log, state: json(s) };
    }
    var a = play(), b = play();
    return case_('用例E11 rng 注入确定性：同序列同结果（事件流+终态全等）',
      json(a.log) === json(b.log) && a.state === b.state && a.log.join('').length > 0);
  }

  // 用例E12 纯函数不可变：tick/cancelTarget 不改动入参状态
  function e12() {
    var s = E.tick(fresh(), 10000, { tiles: { '1,1': true, '1,2': true }, rng: seqRng([0]) }).state;
    var before = json(s);
    E.tick(s, 13000, { tiles: { '1,1': true, '1,2': true } });
    E.cancelTarget(s, 1, 1);
    return case_('用例E12 纯函数：tick/cancelTarget 返回新状态且入参零改动',
      json(s) === before);
  }

  // 用例E13 snapshot/restore：JSON 往返深等价；损坏输入降级为静默状态
  function e13() {
    var s = E.tick(fresh(), 10000, { tiles: { '2,3': true }, rng: seqRng([0]) }).state;
    var round = json(E.restore(E.snapshot(s))) === json(s);
    var obj = json(E.restore(s)) === json(s);
    var bad = E.restore('{oops');
    var r = E.tick(bad, 1e9, { tiles: { '1,1': true } });
    return case_('用例E13 snapshot/restore 往返深等价 / 损坏输入静默（tick 永不行动）',
      round && obj && r.events.length === 0 && r.state.cadenceMs === 0);
  }

  // 用例E14 rng 缺失/非法回退：无 rng 或返回越界值时取升序首候选（确定性兜底）
  function e14() {
    var tiles = { '2,1': true, '1,2': true, '1,1': true };
    var a = E.tick(fresh(), 10000, { tiles: tiles });
    var b = E.tick(fresh(), 10000, { tiles: tiles, rng: function () { return 1.5; } });
    var c = E.tick(fresh(), 10000, { tiles: tiles, rng: function () { throw new Error('x'); } });
    return case_('用例E14 rng 缺失/越界/抛错 → 确定性取升序首格 (1,1)',
      a.events[0].r === 1 && a.events[0].c === 1 &&
      b.events[0].r === 1 && b.events[0].c === 1 &&
      c.events[0].r === 1 && c.events[0].c === 1);
  }

  // 用例E15 独苗豁免：唯一候选即上一目标时仍可选中（防止猎人被饿死）
  function e15() {
    var tiles = { '1,1': true };
    var s = E.tick(fresh(), 10000, { tiles: tiles, rng: seqRng([0]) }).state;
    s = E.tick(s, 13000, { tiles: tiles }).state; // freeze 后 lastTarget='1,1'
    var next = E.tick(s, 20000, { tiles: tiles, rng: seqRng([0]) });
    return case_('用例E15 独苗豁免：仅剩上一目标时允许再次预警',
      next.events[0].type === 'telegraph' &&
      next.events[0].r === 1 && next.events[0].c === 1);
  }

  // 用例E16 防御：非法 cadence（≤0）/非数值 now → 无事件不抛错；缺 ctx 走 no-target 跳过
  function e16() {
    var bad1 = E.tick(E.create(0, 3000, 0), 1e9, { tiles: { '1,1': true } });
    var bad2 = E.tick(E.create(10000, 0, 0), 1e9, { tiles: { '1,1': true } });
    var bad3 = E.tick(fresh(), 'soon', { tiles: { '1,1': true } });
    var bad4 = E.tick(fresh(), 10000);
    var bad5 = E.tick(null, 10000, { tiles: { '1,1': true } });
    return case_('用例E16 防御：非法 cadence/telegraph/now/null 状态 → 无事件；缺 ctx → no-target',
      bad1.events.length === 0 && bad2.events.length === 0 &&
      bad3.events.length === 0 && bad5.events.length === 0 &&
      bad4.events.length === 1 && bad4.events[0].type === 'skip' &&
      bad4.events[0].reason === 'no-target');
  }

  return {
    runAll: function () {
      return [e1(), e2(), e3(), e4(), e5(), e6(), e7(), e8(), e9(),
              e10(), e11(), e12(), e13(), e14(), e15(), e16()];
    }
  };
});
