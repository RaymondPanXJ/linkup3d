#!/usr/bin/env node
/**
 * tests/space.define.js — 太空主题背景 + 程序化 BGM 纯函数用例（issue #10）
 * 覆盖 js/music.js 调度层与 js/stars.js 数学层（不依赖浏览器 API）。
 * 运行：node tests/run-tests.js
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../js/music.js'), require('../js/stars.js'));
  } else {
    root.SpaceTests = factory(root.Music, root.Stars);
  }
})(typeof self !== 'undefined' ? self : this, function (M, S) {
  'use strict';

  function case_(name, pass, detail) {
    return { name: name, pass: !!pass, detail: detail || (pass ? 'ok' : 'FAILED') };
  }

  function stepsOf(evs, role) {
    return evs.filter(function (e) { return e.role === role; })
              .map(function (e) { return e.step; });
  }

  // 用例S1 BPM 在 100–125 区间，时值换算正确
  function s1() {
    var ok = M.BPM >= 100 && M.BPM <= 125 &&
             Math.abs(M.stepSeconds() - 60 / M.BPM / 4) < 1e-9 &&
             Math.abs(M.barSeconds() - M.stepSeconds() * M.STEPS_PER_BAR) < 1e-9 &&
             M.BEATS_PER_BAR === 4 && M.STEPS_PER_BAR === 16;
    return case_('用例S1 BPM∈[100,125] 且拍/步时值换算正确', ok,
      'BPM=' + M.BPM + ' bar=' + M.barSeconds().toFixed(3) + 's');
  }

  // 用例S2 和弦进行 Am→F→C→G 循环，音高换算正确
  function s2() {
    var names = M.PROGRESSION.map(function (c) { return c.name; }).join(',');
    var ok = names === 'Am,F,C,G' &&
             M.progressionAt(0).name === 'Am' &&
             M.progressionAt(3).name === 'G' &&
             M.progressionAt(4).name === 'Am' &&        // 循环
             M.progressionAt(7).name === 'G' &&
             Math.abs(M.midiToFreq(69) - 440) < 1e-9 && // A4 = 440Hz
             Math.abs(M.midiToFreq(57) - 220) < 1e-9 && // A3 = 220Hz
             Math.abs(M.midiToFreq(45) - 110) < 1e-9;   // A2 = 110Hz
    return case_('用例S2 和弦进行 Am→F→C→G 循环 + MIDI→Hz', ok, names);
  }

  // 用例S3 单小节鼓组：kick 正拍 / snare 2、4 拍 / hat 全八分反拍
  function s3() {
    var evs = M.buildBarEvents(0);
    var kick = stepsOf(evs, 'kick'), snare = stepsOf(evs, 'snare'), hat = stepsOf(evs, 'hat');
    var ok = kick.join(',') === '0,4,8,12' &&
             snare.join(',') === '4,12' &&
             hat.join(',') === '1,3,5,7,9,11,13,15';
    return case_('用例S3 鼓组编排：kick四拍 / snare二四拍 / hat反拍', ok,
      'kick=' + kick.join(',') + ' snare=' + snare.join(',') + ' hat=' + hat.join(','));
  }

  // 用例S4 单小节 bass/琶音：步位与音池正确，事件按 step 升序
  function s4() {
    var evs = M.buildBarEvents(0); // Am
    var bass = evs.filter(function (e) { return e.role === 'bass'; });
    var arp = evs.filter(function (e) { return e.role === 'arp'; });
    var sorted = evs.every(function (e, i) { return i === 0 || evs[i - 1].step <= e.step; });
    var bassOk = stepsOf(evs, 'bass').join(',') === M.BASS_STEPS.join(',') &&
                 bass.every(function (e) { return Math.abs(e.freq - M.midiToFreq(45)) < 1e-6; });
    var arpSteps = stepsOf(evs, 'arp');
    var arpOk = arpSteps.join(',') === '0,2,4,6,8,10,12,14' &&
                arp.every(function (e) {
                  return M.PROGRESSION[0].tones.some(function (n) {
                    return Math.abs(e.freq - M.midiToFreq(n)) < 1e-6;
                  });
                });
    return case_('用例S4 bass 切分 + 琶音八分，事件按步升序', bassOk && arpOk && sorted,
      'bass=' + stepsOf(evs, 'bass').join(',') + ' arp=' + arpSteps.join(','));
  }

  // 用例S5 buildLoop：跨小节拼接，step 全局递增且和弦随小节轮换
  function s5() {
    var loop = M.buildLoop(4);
    var bars = {};
    var monotonic = true, prev = -1;
    loop.forEach(function (e) {
      bars[e.bar] = (bars[e.bar] || 0) + 1;
      if (e.step < prev) monotonic = false;
      prev = e.step;
    });
    var amBass = loop.filter(function (e) { return e.bar === 0 && e.role === 'bass'; });
    var gBass = loop.filter(function (e) { return e.bar === 3 && e.role === 'bass'; });
    var ok = Object.keys(bars).length === 4 && monotonic &&
             amBass.every(function (e) { return Math.abs(e.freq - M.midiToFreq(45)) < 1e-6; }) &&
             gBass.every(function (e) { return Math.abs(e.freq - M.midiToFreq(43)) < 1e-6; }) &&
             loop.length === 4 * M.buildBarEvents(0).length;
    return case_('用例S5 buildLoop 四小节拼接：全局步号 + 和弦随小节轮换', ok,
      'events=' + loop.length + ' bars=' + JSON.stringify(bars));
  }

  // 用例S6 每小节事件计数稳定（各小节事件数一致 → 循环无缝）
  function s6() {
    var n0 = M.buildBarEvents(0).length, n1 = M.buildBarEvents(1).length,
        n7 = M.buildBarEvents(7).length;
    return case_('用例S6 各小节事件数一致（循环无缝）', n0 === n1 && n1 === n7,
      'bars: ' + n0 + '/' + n1 + '/' + n7);
  }

  // 用例S7 星空密度：随面积增长且有上下限（性能护栏）
  function s7() {
    var small = S.starCountFor(320, 568), mid = S.starCountFor(1280, 800),
        big = S.starCountFor(3840, 2160);
    var ok = small >= 40 && big <= 360 && small <= mid && mid <= big;
    return case_('用例S7 星星数量随面积缩放并钳制在 [40,360]', ok,
      small + '/' + mid + '/' + big);
  }

  // 用例S8 分层半径：各层落在自身区间，近层整体大于远层
  function s8() {
    var ok = true, i, r;
    for (i = 0; i < S.LAYERS.length; i++) {
      var l = S.LAYERS[i];
      r = S.pickStarRadius(i, 0);
      ok = ok && Math.abs(r - l.rMin) < 1e-9;
      r = S.pickStarRadius(i, 0.999999);
      ok = ok && r > l.rMin && r < l.rMax;
    }
    ok = ok && S.LAYERS[2].vy > S.LAYERS[0].vy; // 近层更快 → 视差
    return case_('用例S8 星层半径/速度分层（视差前提）', ok);
  }

  // 用例S9 闪烁透明度：周期函数，值域 [base-amp, base+amp]
  function s9() {
    var base = 0.55, amp = 0.4, min = Infinity, max = -Infinity, ok = true;
    for (var i = 0; i <= 100; i++) {
      var a = S.starAlpha(i / 100, base, amp);
      if (a < min) min = a;
      if (a > max) max = a;
      ok = ok && a >= base - amp - 1e-9 && a <= base + amp + 1e-9;
    }
    ok = ok && Math.abs(S.starAlpha(0, base, amp) - S.starAlpha(1.25 - 0.25, base, amp)) < 1e-9;
    return case_('用例S9 闪烁 alpha 周期且有界', ok,
      'range=[' + min.toFixed(2) + ',' + max.toFixed(2) + ']');
  }

  // 用例S10 视差位移：向对侧回绕，坐标恒在 [0,1)
  function s10() {
    var near = S.LAYERS[2], far = S.LAYERS[0];
    var a = S.advance({ x: 0.001, y: 0.001 }, 1, near, 800);
    var wrapped = a.x > 0.9 && a.y > 0.9; // 越界后从对侧回绕
    var nearMove = S.advance({ x: 0.5, y: 0.5 }, 0.1, near, 800);
    var farMove = S.advance({ x: 0.5, y: 0.5 }, 0.1, far, 800);
    var parallax = (0.5 - nearMove.x) > (0.5 - farMove.x); // 近层位移更大
    var inRange = true;
    for (var i = 0; i < 200; i++) {
      a = S.advance(a, 0.4, near, 1000);
      if (!(a.x >= 0 && a.x < 1 && a.y >= 0 && a.y < 1)) { inRange = false; break; }
    }
    return case_('用例S10 星星漂移回绕 + 近层视差更快', wrapped && parallax && inRange);
  }

  return {
    runAll: function () {
      return [s1(), s2(), s3(), s4(), s5(), s6(), s7(), s8(), s9(), s10()];
    }
  };
});
