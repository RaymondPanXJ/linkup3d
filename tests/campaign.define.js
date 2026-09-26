/**
 * tests/campaign.define.js — 战役数据表与纯函数用例（issue #25）
 * 运行：node tests/run-tests.js
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../js/campaign.js'));
  } else {
    root.CampaignTests = factory(root.Campaign);
  }
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  function case_(name, pass, detail) {
    return { name: name, pass: !!pass, detail: detail || (pass ? 'ok' : 'FAILED') };
  }

  function throwsError(fn) {
    try { fn(); return false; } catch (e) { return e instanceof Error; }
  }

  // 用例C1 数据表形状：10 关、id 连续 0..9、字段齐全且整体校验通过
  function c1() {
    var L = C.LEVELS;
    var shapeOk = Array.isArray(L) && L.length === 10 &&
      L.every(function (d, i) {
        return d.id === i && typeof d.name === 'string' && d.name.length > 0 &&
          'rows' in d && 'cols' in d && 'pairs' in d &&
          'timeLimitSec' in d && 'parSec' in d && 'frost' in d && 'hunter' in d;
      });
    var valid = true;
    var err = '';
    try { C.validateAll(L); } catch (e) { valid = false; err = e.message; }
    return case_('用例C1 LEVELS 共 10 关、id 连续、字段齐全且 validateAll 通过',
      shapeOk && valid, err || 'ok');
  }

  // 用例C2 基线表逐关核对：名称/盘面/对数/时限/标准时间/巡猎者参数
  function c2() {
    var expect = [
      ['冷眠醒转', 4, 4, 8, 0, 60, null],
      ['微光航道', 4, 6, 12, 180, 90, null],
      ['霜纹初现', 4, 6, 12, 180, 100, null],
      ['巡猎初鸣', 4, 6, 12, 240, 150, [25000, 3000]],
      ['冰湖', 4, 6, 12, 240, 150, [20000, 3000]],
      ['双子冰缝', 6, 8, 24, 300, 200, null],
      ['极夜', 6, 8, 24, 360, 240, [30000, 3000]],
      ['白毛风', 6, 8, 24, 360, 260, [22000, 3000]],
      ['冰下回声', 6, 8, 24, 420, 300, [18000, 3000]],
      ['星核之眼', 6, 8, 24, 480, 340, [15000, 2500]]
    ];
    var bad = '';
    for (var i = 0; i < expect.length; i++) {
      var d = C.LEVELS[i], e = expect[i];
      if (!d || d.name !== e[0] || d.rows !== e[1] || d.cols !== e[2] ||
          d.pairs !== e[3] || d.timeLimitSec !== e[4] || d.parSec !== e[5]) {
        bad = '第' + i + '关基础字段不符: ' + JSON.stringify(d);
        break;
      }
      if (e[6] === null) {
        if (d.hunter !== null) { bad = '第' + i + '关 hunter 应为 null'; break; }
      } else {
        if (!d.hunter || d.hunter.cadenceMs !== e[6][0] ||
            d.hunter.telegraphMs !== e[6][1]) {
          bad = '第' + i + '关 hunter 参数不符: ' + JSON.stringify(d.hunter);
          break;
        }
      }
    }
    return case_('用例C2 TechLead 基线表逐关核对（10 关）', !bad, bad || 'ok');
  }

  // 用例C3 基线表 frost 规格：L2=2 格、L5=4 格、L8=2 格，其余为空
  function c3() {
    var expectCounts = [0, 0, 2, 0, 0, 4, 0, 0, 2, 0];
    var bad = '';
    for (var i = 0; i < 10; i++) {
      var d = C.LEVELS[i];
      if (!Array.isArray(d.frost) || d.frost.length !== expectCounts[i]) {
        bad = '第' + i + '关 frost 数量=' + (d.frost && d.frost.length);
        break;
      }
      for (var j = 0; j < d.frost.length; j++) {
        var cell = d.frost[j];
        if (cell.r < 1 || cell.r > d.rows || cell.c < 1 || cell.c > d.cols) {
          bad = '第' + i + '关 frost 越界: ' + JSON.stringify(cell);
          break;
        }
      }
    }
    return case_('用例C3 frost 数量与 1-based 合法位置（L2/L5/L8）', !bad, bad || 'ok');
  }

  // 用例C4 validateLevel 合法边界：最小合法定义 + 时间/为0（不限时）通过
  function c4() {
    var min = { id: 0, name: '最小', rows: 4, cols: 4, pairs: 8,
      timeLimitSec: 0, parSec: 1, frost: [], hunter: null };
    var half = { id: 1, name: '满盘', rows: 4, cols: 4, pairs: 8,
      timeLimitSec: 30.5, parSec: 10, frost: [{ r: 4, c: 4 }],
      hunter: { cadenceMs: 1000, telegraphMs: 999 } };
    var ok = C.validateLevel(min) === true && C.validateLevel(half) === true;
    return case_('用例C4 validateLevel 接受合法定义（含不限时/满对数/边界格）', ok);
  }

  // 用例C5 validateLevel 拒绝：非对象、缺字段、非字符串名
  function c5() {
    var base = { id: 0, name: 'x', rows: 4, cols: 4, pairs: 8,
      timeLimitSec: 60, parSec: 30, frost: [], hunter: null };
    var bad = [];
    bad.push(throwsError(function () { C.validateLevel(null); }));
    bad.push(throwsError(function () { C.validateLevel([]); }));
    bad.push(throwsError(function () { C.validateLevel(42); }));
    var missing = {};
    bad.push(throwsError(function () { C.validateLevel(missing); }));
    ['name', 'rows', 'cols', 'pairs', 'timeLimitSec', 'parSec', 'frost', 'hunter']
      .forEach(function (k) {
        var d = JSON.parse(JSON.stringify(base));
        delete d[k];
        bad.push(throwsError(function () { C.validateLevel(d); }));
      });
    var nameStr = JSON.parse(JSON.stringify(base));
    nameStr.name = '';
    bad.push(throwsError(function () { C.validateLevel(nameStr); }));
    var all = bad.every(function (b) { return b; });
    return case_('用例C5 validateLevel 拒绝非对象/缺字段/空名', all,
      '拒绝项 ' + bad.filter(Boolean).length + '/' + bad.length);
  }

  // 用例C6 validateLevel 拒绝盘面尺寸：<4×4、非整数、非正
  function c6() {
    function mutate(fn) {
      var d = { id: 0, name: 'x', rows: 4, cols: 4, pairs: 8,
        timeLimitSec: 60, parSec: 30, frost: [], hunter: null };
      fn(d);
      return throwsError(function () { C.validateLevel(d); });
    }
    var ok = mutate(function (d) { d.rows = 3; }) &&
             mutate(function (d) { d.cols = 3; }) &&
             mutate(function (d) { d.rows = 0; }) &&
             mutate(function (d) { d.cols = -4; }) &&
             mutate(function (d) { d.rows = 4.5; }) &&
             mutate(function (d) { d.cols = NaN; });
    return case_('用例C6 validateLevel 拒绝盘面 <4×4 / 非整数 / 非正', ok);
  }

  // 用例C7 validateLevel 拒绝：对数超盘、对数非正、parSec 非正、时限为负
  function c7() {
    function mutate(fn) {
      var d = { id: 0, name: 'x', rows: 4, cols: 4, pairs: 8,
        timeLimitSec: 60, parSec: 30, frost: [], hunter: null };
      fn(d);
      return throwsError(function () { C.validateLevel(d); });
    }
    var ok = mutate(function (d) { d.pairs = 9; }) &&          // 4×4=16 格，9 对需 18 格
             mutate(function (d) { d.pairs = 0; }) &&
             mutate(function (d) { d.pairs = -2; }) &&
             mutate(function (d) { d.pairs = 2.5; }) &&
             mutate(function (d) { d.parSec = 0; }) &&
             mutate(function (d) { d.parSec = -5; }) &&
             mutate(function (d) { d.timeLimitSec = -1; });
    return case_('用例C7 validateLevel 拒绝 pairs 超盘/非正、parSec≤0、时限<0', ok);
  }

  // 用例C8 validateLevel 拒绝 frost：非数组、非 {r,c}、越界、重复
  function c8() {
    function mutate(fn) {
      var d = { id: 0, name: 'x', rows: 4, cols: 4, pairs: 8,
        timeLimitSec: 60, parSec: 30, frost: [], hunter: null };
      fn(d);
      return throwsError(function () { C.validateLevel(d); });
    }
    var ok = mutate(function (d) { d.frost = '2,2'; }) &&
             mutate(function (d) { d.frost = [null]; }) &&
             mutate(function (d) { d.frost = [{ r: 0, c: 1 }]; }) &&
             mutate(function (d) { d.frost = [{ r: 1, c: 1.5 }]; }) &&
             mutate(function (d) { d.frost = [{ r: 5, c: 1 }]; }) &&
             mutate(function (d) { d.frost = [{ r: 1, c: 5 }]; }) &&
             mutate(function (d) { d.frost = [{ r: 1, c: 1 }, { r: 1, c: 1 }]; });
    return case_('用例C8 validateLevel 拒绝非法 frost（类型/0/小数/越界/重复）', ok);
  }

  // 用例C9 validateLevel 拒绝 hunter：缺字段、非正整数、telegraph ≥ cadence
  function c9() {
    function mutate(fn) {
      var d = { id: 0, name: 'x', rows: 4, cols: 4, pairs: 8,
        timeLimitSec: 60, parSec: 30, frost: [], hunter: null };
      fn(d);
      return throwsError(function () { C.validateLevel(d); });
    }
    var ok = mutate(function (d) { d.hunter = {}; }) &&
             mutate(function (d) { d.hunter = { cadenceMs: 1000 }; }) &&
             mutate(function (d) { d.hunter = { cadenceMs: 0, telegraphMs: 100 }; }) &&
             mutate(function (d) { d.hunter = { cadenceMs: 1000, telegraphMs: 0 }; }) &&
             mutate(function (d) { d.hunter = { cadenceMs: 1000, telegraphMs: 1000 }; }) &&
             mutate(function (d) { d.hunter = { cadenceMs: 1000, telegraphMs: 2000 }; }) &&
             mutate(function (d) { d.hunter = 'hunter'; });
    return case_('用例C9 validateLevel 拒绝非法 hunter（含 telegraphMs ≥ cadenceMs）', ok);
  }

  // 用例C10 解锁：第 0 关恒解锁；后续需前一关 ≥1 星；越界索引 false
  function c10() {
    var empty = { v: 1, levels: {} };
    var one = { v: 1, levels: { '0': { stars: 1, bestScore: 10, bestTimeSec: 40 } } };
    var zero = { v: 1, levels: { '0': { stars: 0, bestScore: 0, bestTimeSec: 0 } } };
    var ok = C.isUnlocked(0, empty) === true &&
             C.isUnlocked(1, empty) === false &&
             C.isUnlocked(1, zero) === false &&
             C.isUnlocked(1, one) === true &&
             C.isUnlocked(2, one) === false &&
             C.isUnlocked(9, one) === false &&
             C.isUnlocked(-1, one) === false &&
             C.isUnlocked(10, one) === false &&
             C.isUnlocked(0, null) === true;
    return case_('用例C10 isUnlocked 边界（首关恒开/前一关≥1星/越界）', ok);
  }

  // 用例C11 解锁链：逐关通关推进，全 10 关按序解锁
  function c11() {
    var prog = { v: 1, levels: {} };
    var ok = true;
    for (var i = 0; i < 10; i++) {
      if (!C.isUnlocked(i, prog)) { ok = false; break; }
      prog.levels[String(i)] = { stars: 2, bestScore: 100, bestTimeSec: 50 };
    }
    var afterAll = C.isUnlocked(10, prog) === false;
    return case_('用例C11 解锁链按通关顺序推进至末关', ok && afterAll);
  }

  // 用例C12 nextLevel：返回下一关对象，末关/非法索引返回 null
  function c12() {
    var n0 = C.nextLevel(0);
    var ok = n0 && n0.id === 1 && n0.name === '微光航道' &&
             C.nextLevel(8).id === 9 &&
             C.nextLevel(9) === null &&
             C.nextLevel(-1) === null &&
             C.nextLevel(99) === null &&
             C.nextLevel(1.5) === null;
    return case_('用例C12 nextLevel 返回下一关，末关/非法为 null', !!ok);
  }

  // 用例C13 starsFor 星级边界：=par 3 星、=par×1.5 2 星、其后 1 星
  function c13() {
    var ok = C.starsFor(100, 1) === 3 &&
             C.starsFor(100, 100) === 3 &&      // 上边界含
             C.starsFor(100, 100.5) === 2 &&
             C.starsFor(100, 150) === 2 &&      // par×1.5 上边界含
             C.starsFor(100, 150.5) === 1 &&
             C.starsFor(100, 10000) === 1;
    return case_('用例C13 starsFor 三档边界（≤par=3，≤par×1.5=2，否则1）', ok);
  }

  // 用例C14 starsFor：timeUsed ≤0（未通关）为 0 星；非法 parSec 抛 Error
  function c14() {
    var ok = C.starsFor(100, 0) === 0 &&
             C.starsFor(100, -5) === 0 &&
             C.starsFor(100, NaN) === 0 &&
             throwsError(function () { C.starsFor(0, 50); }) &&
             throwsError(function () { C.starsFor(-1, 50); }) &&
             throwsError(function () { C.starsFor(1.5, 50); });
    return case_('用例C14 starsFor 未通关 0 星 + 非正 parSec 抛错', ok);
  }

  // 用例C15 levelAt：合法返回定义，非法返回 null
  function c15() {
    var ok = C.levelAt(0).id === 0 && C.levelAt(9).id === 9 &&
             C.levelAt(10) === null && C.levelAt(-1) === null &&
             C.levelAt(2.5) === null;
    return case_('用例C15 levelAt 合法返回定义 / 非法返回 null', ok);
  }

  // 用例C16 validateAll：篡改数据表（id 与索引不一致）即抛
  function c16() {
    var badTable = JSON.parse(JSON.stringify(C.LEVELS));
    badTable[7].id = 42;
    return case_('用例C16 validateAll 检出 id 与索引不一致并抛错',
      throwsError(function () { C.validateAll(badTable); }));
  }

  return {
    runAll: function () {
      return [c1(), c2(), c3(), c4(), c5(), c6(), c7(), c8(),
              c9(), c10(), c11(), c12(), c13(), c14(), c15(), c16()];
    }
  };
});
