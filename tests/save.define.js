/**
 * tests/save.define.js — 战役存档 v1 纯函数用例（issue #25）
 * 运行：node tests/run-tests.js
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../js/save.js'));
  } else {
    root.CampaignSaveTests = factory(root.CampaignSave);
  }
})(typeof self !== 'undefined' ? self : this, function (S) {
  'use strict';

  function case_(name, pass, detail) {
    return { name: name, pass: !!pass, detail: detail || (pass ? 'ok' : 'FAILED') };
  }

  // 简易内存 storage（可注入行为）
  function memStorage(initial) {
    var store = {};
    if (initial) store[S.STORAGE_KEY] = initial;
    return {
      store: store,
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem: function (k, v) { store[k] = String(v); }
    };
  }

  function entry(stars, bestScore, bestTimeSec) {
    return { stars: stars, bestScore: bestScore, bestTimeSec: bestTimeSec };
  }

  // 用例S1 常量：存储键 linkup3d.campaign.v1，版本 1
  function s1() {
    var ok = S.STORAGE_KEY === 'linkup3d.campaign.v1' && S.SCHEMA_VERSION === 1;
    var init = S.initialData();
    return case_('用例S1 存储键 linkup3d.campaign.v1 + schema v1',
      ok && init.v === 1 && Object.keys(init.levels).length === 0);
  }

  // 用例S2 load 降级：storage 缺失/无键/空串/损坏 JSON/类型错误 → 初始档
  function s2() {
    var ok = JSON.stringify(S.load(null)) === JSON.stringify(S.initialData()) &&
             JSON.stringify(S.load({})) === JSON.stringify(S.initialData()) &&
             JSON.stringify(S.load(memStorage())) === JSON.stringify(S.initialData()) &&
             JSON.stringify(S.load(memStorage(''))) === JSON.stringify(S.initialData()) &&
             JSON.stringify(S.load(memStorage('{not json'))) === JSON.stringify(S.initialData()) &&
             JSON.stringify(S.load(memStorage('[]'))) === JSON.stringify(S.initialData()) &&
             JSON.stringify(S.load(memStorage('"str"'))) === JSON.stringify(S.initialData());
    return case_('用例S2 load 对缺失/损坏/类型错误一律降级初始档', ok);
  }

  // 用例S3 load 降级：版本不符、levels 非对象、键非法、字段越界/类型错
  function s3() {
    var bad = [
      JSON.stringify({ v: 2, levels: {} }),
      JSON.stringify({ levels: {} }),
      JSON.stringify({ v: 1 }),
      JSON.stringify({ v: 1, levels: [] }),
      JSON.stringify({ v: 1, levels: { 'x': entry(1, 1, 1) } }),
      JSON.stringify({ v: 1, levels: { '-1': entry(1, 1, 1) } }),
      JSON.stringify({ v: 1, levels: { '0': entry(4, 1, 1) } }),
      JSON.stringify({ v: 1, levels: { '0': entry(-1, 1, 1) } }),
      JSON.stringify({ v: 1, levels: { '0': entry(1, -1, 1) } }),
      JSON.stringify({ v: 1, levels: { '0': entry(1, 1, -1) } }),
      JSON.stringify({ v: 1, levels: { '0': entry('3', 1, 1) } }),
      JSON.stringify({ v: 1, levels: { '0': entry(1, 1.5, 1) } })
    ];
    var ok = bad.every(function (raw) {
      return JSON.stringify(S.load(memStorage(raw))) === JSON.stringify(S.initialData());
    });
    return case_('用例S3 load 对版本/结构/字段非法一律降级初始档', ok);
  }

  // 用例S4 load 往返：合法档原样读回，且与源对象解耦（深拷贝）
  function s4() {
    var data = { v: 1, levels: { '0': entry(3, 1200, 45), '2': entry(1, 300, 120) } };
    var st = memStorage(JSON.stringify(data));
    var loaded = S.load(st);
    var loaded2 = S.load(st);
    loaded.levels['0'].stars = 0;
    var ok = loaded2.levels['0'].stars === 3 &&
             loaded2.levels['2'].bestTimeSec === 120 &&
             loaded2.v === 1;
    return case_('用例S4 load 合法档往返 + 深拷贝解耦', ok);
  }

  // 用例S5 save 往返 + 写入内容即序列化 JSON
  function s5() {
    var st = memStorage();
    var data = { v: 1, levels: { '1': entry(2, 800, 95) } };
    var written = S.save(st, data);
    var raw = st.store[S.STORAGE_KEY];
    var ok = written === true && raw === JSON.stringify(data) &&
             JSON.stringify(S.load(st)) === JSON.stringify(data);
    return case_('用例S5 save 写入存储键并可通过 load 往返', ok);
  }

  // 用例S6 save 防御：非法档拒绝写入返回 false；storage 抛错/缺失不抛异常
  function s6() {
    var st = memStorage();
    var reject = S.save(st, { v: 9, levels: {} }) === false &&
                 S.save(st, null) === false &&
                 S.save(st, { v: 1, levels: { '0': entry(9, 0, 0) } }) === false &&
                 Object.keys(st.store).length === 0;
    var throwing = {
      getItem: function () { throw new Error('QuotaExceeded'); },
      setItem: function () { throw new Error('QuotaExceeded'); }
    };
    var noThrow = S.save(throwing, { v: 1, levels: {} }) === false &&
                  S.save(null, { v: 1, levels: {} }) === false &&
                  JSON.stringify(S.load(throwing)) === JSON.stringify(S.initialData());
    return case_('用例S6 save 拒绝非法档 / storage 抛错安全返回 false', reject && noThrow);
  }

  // 用例S7 recordResult 新档写入：星级/最高分/最短时间一次记录
  function s7() {
    var out = S.recordResult(S.initialData(), 0, 3, 1200, 45);
    var e = out.levels['0'];
    var ok = out !== S.initialData() && !!e && e.stars === 3 &&
             e.bestScore === 1200 && e.bestTimeSec === 45;
    return case_('用例S7 recordResult 新档写入首个关卡条目', ok);
  }

  // 用例S8 recordResult 纯函数：不修改入参档
  function s8() {
    var data = { v: 1, levels: { '0': entry(1, 100, 100) } };
    var snapshot = JSON.stringify(data);
    S.recordResult(data, 0, 3, 999, 10);
    S.recordResult(data, 1, 2, 50, 50);
    return case_('用例S8 recordResult 不修改入参（返回新档）',
      JSON.stringify(data) === snapshot);
  }

  // 用例S9 合并规则：星级只升不降；bestScore 取大；bestTimeSec 取小
  function s9() {
    var d = S.initialData();
    d = S.recordResult(d, 0, 2, 500, 100);
    d = S.recordResult(d, 0, 1, 900, 80);   // 星级回退→保留2；分取大；时取小
    var e1 = d.levels['0'];
    d = S.recordResult(d, 0, 3, 300, 120);  // 星升3；分不回退；时不回退
    var e2 = d.levels['0'];
    var ok = e1.stars === 2 && e1.bestScore === 900 && e1.bestTimeSec === 80 &&
             e2.stars === 3 && e2.bestScore === 900 && e2.bestTimeSec === 80;
    return case_('用例S9 合并：星级只升 / bestScore 取大 / bestTimeSec 取小', ok);
  }

  // 用例S10 无效值不参与极值合并：score≤0、timeUsed≤0 保留旧值
  function s10() {
    var d = { v: 1, levels: { '3': entry(2, 700, 90) } };
    d = S.recordResult(d, 3, 2, 0, 0);
    var e = d.levels['3'];
    var ok = e.bestScore === 700 && e.bestTimeSec === 90 && e.stars === 2;
    return case_('用例S10 score/timeUsed ≤0 不覆盖既有极值', ok);
  }

  // 用例S11 recordResult 非法入参：越界 idx / 非法 stars → 原样返回（不受损）
  function s11() {
    var d = { v: 1, levels: { '0': entry(3, 10, 5) } };
    var snap = JSON.stringify(d);
    var ok = JSON.stringify(S.recordResult(d, -1, 1, 1, 1)) === snap &&
             JSON.stringify(S.recordResult(d, 1.5, 1, 1, 1)) === snap &&
             JSON.stringify(S.recordResult(d, 0, 4, 1, 1)) === snap &&
             JSON.stringify(S.recordResult(d, 0, -1, 1, 1)) === snap &&
             JSON.stringify(S.recordResult(d, 0, 1.5, 1, 1)) === snap;
    return case_('用例S11 非法 idx/stars 原样返回原档', ok);
  }

  // 用例S12 recordResult 接收非法整档：降级为初始档而非崩溃
  function s12() {
    var out = S.recordResult(null, 0, 1, 10, 10);
    var bad = S.recordResult({ v: 7, levels: {} }, 0, 1, 10, 10);
    var ok = JSON.stringify(out) === JSON.stringify(S.initialData()) &&
             JSON.stringify(bad) === JSON.stringify(S.initialData());
    return case_('用例S12 非法整档入参降级初始档', ok);
  }

  // 用例S13 isValidData：正/反例
  function s13() {
    var good = { v: 1, levels: { '0': entry(0, 0, 0), '9': entry(3, 99999, 1) } };
    var ok = S.isValidData(good) === true &&
             S.isValidData(S.initialData()) === true &&
             S.isValidData({}) === false &&
             S.isValidData([]) === false &&
             S.isValidData('x') === false &&
             S.isValidData({ v: 1, levels: null }) === false &&
             S.isValidLevelEntry(entry(3, 0, 0)) === true &&
             S.isValidLevelEntry({ stars: 1 }) === false;
    return case_('用例S13 isValidData / isValidLevelEntry 正反例', ok);
  }

  // 用例S14 端到端：load → 逐关记录 → save → 重载，星级链与极值保持一致
  function s14() {
    var st = memStorage();
    var p = S.load(st);
    p = S.recordResult(p, 0, 3, 1000, 50);
    p = S.recordResult(p, 0, 2, 1200, 55);
    S.save(st, p);
    var q = S.load(st);
    var ok = q.levels['0'].stars === 3 && q.levels['0'].bestScore === 1200 &&
             q.levels['0'].bestTimeSec === 50 && !q.levels['1'];
    return case_('用例S14 load→record→save→load 端到端一致', ok);
  }

  return {
    runAll: function () {
      return [s1(), s2(), s3(), s4(), s5(), s6(), s7(), s8(),
              s9(), s10(), s11(), s12(), s13(), s14()];
    }
  };
});
