/**
 * music.js — 程序化动感 BGM（WebAudio 合成，零音频文件 / 零 CDN，issue #10）
 *
 * 结构：
 *   - 纯函数调度层（UMD，可在 Node 测试）：BPM/步长、和弦进行、单小节/多小节事件序列；
 *   - 浏览器播放层 createPlayer()：前瞻式（lookahead）小节调度器，
 *     振荡器 + 噪声缓冲合成 bass / 琶音 /  kick / snare / hat。
 *
 * 风格：A 小调 Am→F→C→G 四小节循环，112 BPM 电子律动。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Music = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BPM = 112;               // 每分钟拍数（要求 100–125 区间）
  var BEATS_PER_BAR = 4;       // 4/4 拍
  var STEPS_PER_BAR = 16;      // 每小节 16 个十六分音符步

  function stepSeconds() { return 60 / BPM / 4; }
  function barSeconds() { return stepSeconds() * STEPS_PER_BAR; }

  function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  // 和弦进行：root 为 bass 音（低八度），tones 为琶音音池（高八度）
  var PROGRESSION = [
    { name: 'Am', root: 45, tones: [57, 60, 64, 69] }, // A2 | A3 C4 E4 A4
    { name: 'F',  root: 41, tones: [53, 57, 60, 65] }, // F2 | F3 A3 C4 F4
    { name: 'C',  root: 48, tones: [60, 64, 67, 72] }, // C3 | C4 E4 G4 C5
    { name: 'G',  root: 43, tones: [55, 59, 62, 67] }  // G2 | G3 B3 D4 G4
  ];

  // bass 切分节奏步位（十六分音符，0 起）
  var BASS_STEPS = [0, 3, 6, 8, 11, 14];

  function progressionAt(bar) { return PROGRESSION[bar % PROGRESSION.length]; }

  /**
   * 生成单小节事件序列，按 step 升序。
   * 事件：{step, role: bass|arp|kick|snare|hat, freq?, dur}，dur 单位为步。
   */
  function buildBarEvents(bar) {
    var ch = progressionAt(bar);
    var evs = [], i;
    for (i = 0; i < BASS_STEPS.length; i++) {
      evs.push({ step: BASS_STEPS[i], role: 'bass', freq: midiToFreq(ch.root), dur: 2 });
    }
    for (i = 0; i < STEPS_PER_BAR; i += 2) {
      evs.push({ step: i, role: 'arp', freq: midiToFreq(ch.tones[(i / 2) % ch.tones.length]), dur: 1 });
    }
    for (i = 0; i < STEPS_PER_BAR; i += 4) {
      evs.push({ step: i, role: 'kick', dur: 1 });
    }
    evs.push({ step: 4, role: 'snare', dur: 1 });
    evs.push({ step: 12, role: 'snare', dur: 1 });
    for (i = 1; i < STEPS_PER_BAR; i += 2) {
      evs.push({ step: i, role: 'hat', dur: 1 });
    }
    evs.sort(function (a, b) { return a.step - b.step; });
    return evs;
  }

  /** numBars 小节的完整序列（step 为全局步号，附带 bar 索引），供调度/测试复用 */
  function buildLoop(numBars) {
    var out = [];
    for (var b = 0; b < numBars; b++) {
      buildBarEvents(b).forEach(function (e) {
        var c = { step: e.step + b * STEPS_PER_BAR, bar: b,
                  role: e.role, dur: e.dur };
        if (e.freq !== undefined) c.freq = e.freq;
        out.push(c);
      });
    }
    return out;
  }

  /* ---------------- 浏览器播放层 ---------------- */
  function createPlayer() {
    var ctx = null, master = null, noiseBuf = null;
    var timer = null, startTime = 0, nextBar = 0, running = false;
    var MASTER_GAIN = 0.22;

    function ensure() {
      var AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
      if (!AC) return false;
      if (!ctx) {
        try { ctx = new AC(); } catch (e) { return false; }
        master = ctx.createGain();
        master.gain.value = MASTER_GAIN;
        master.connect(ctx.destination);
        noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.2), ctx.sampleRate);
        var d = noiseBuf.getChannelData(0);
        for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      if (ctx.state === 'suspended' && ctx.resume) { try { ctx.resume(); } catch (e) { /* 忽略 */ } }
      return true;
    }

    function voice(e, t) {
      if (e.role === 'kick') {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(150, t);
        o.frequency.exponentialRampToValueAtTime(42, t + 0.11);
        g.gain.setValueAtTime(0.9, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
        o.connect(g).connect(master);
        o.start(t); o.stop(t + 0.16);
      } else if (e.role === 'hat' || e.role === 'snare') {
        var s = ctx.createBufferSource(); s.buffer = noiseBuf;
        var f = ctx.createBiquadFilter(), g2 = ctx.createGain();
        var isHat = e.role === 'hat';
        f.type = isHat ? 'highpass' : 'bandpass';
        f.frequency.value = isHat ? 7000 : 1800;
        var peak = isHat ? 0.12 : 0.3, dur = isHat ? 0.04 : 0.12;
        g2.gain.setValueAtTime(peak, t);
        g2.gain.exponentialRampToValueAtTime(0.001, t + dur);
        s.connect(f).connect(g2).connect(master);
        s.start(t); s.stop(t + dur + 0.02);
      } else {
        var osc = ctx.createOscillator(), g3 = ctx.createGain();
        var isBass = e.role === 'bass';
        osc.type = isBass ? 'triangle' : 'square';
        osc.frequency.setValueAtTime(e.freq, t);
        var pk = isBass ? 0.5 : 0.1, d2 = e.dur * stepSeconds() * 0.9;
        g3.gain.setValueAtTime(0.0001, t);
        g3.gain.exponentialRampToValueAtTime(pk, t + 0.012);
        g3.gain.exponentialRampToValueAtTime(0.0001, t + d2);
        osc.connect(g3).connect(master);
        osc.start(t); osc.stop(t + d2 + 0.03);
      }
    }

    function scheduleBar(bar, when) {
      var sd = stepSeconds();
      buildBarEvents(bar).forEach(function (e) { voice(e, when + e.step * sd); });
    }

    function tick() {
      var horizon = ctx.currentTime + 0.35;
      while (startTime + nextBar * barSeconds() < horizon) {
        scheduleBar(nextBar, startTime + nextBar * barSeconds());
        nextBar++;
      }
    }

    return {
      isRunning: function () { return running; },
      start: function () {
        if (running || !ensure()) return;
        // 尚处 autoplay 限制（ctx suspended）时不启动，等下一次用户手势重试
        if (ctx.state !== 'running') return;
        running = true;
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.setValueAtTime(MASTER_GAIN, ctx.currentTime);
        startTime = ctx.currentTime + 0.06;
        nextBar = 0;
        tick();
        timer = setInterval(tick, 60);
      },
      stop: function () {
        if (!running) return;
        running = false;
        clearInterval(timer);
        timer = null;
        // 已排期的小节音符靠主增益淡出，避免逐节点追踪取消
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
        master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
      }
    };
  }

  return {
    BPM: BPM,
    BEATS_PER_BAR: BEATS_PER_BAR,
    STEPS_PER_BAR: STEPS_PER_BAR,
    BASS_STEPS: BASS_STEPS,
    PROGRESSION: PROGRESSION,
    stepSeconds: stepSeconds,
    barSeconds: barSeconds,
    midiToFreq: midiToFreq,
    progressionAt: progressionAt,
    buildBarEvents: buildBarEvents,
    buildLoop: buildLoop,
    createPlayer: createPlayer
  };
});
