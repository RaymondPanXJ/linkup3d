#!/usr/bin/env node
/**
 * tests/audio-gesture-static-check.js — 开机无手势创建 AudioContext 告警修复（issue #47）
 *   A. 静态断言：game.js 开机段不得无条件调用 ensureMusicStarted（须有
 *      navigator.userActivation.isActive 门）；music.js 无手势路径
 *      （userActivation.hasBeenActive === false）不得调用 ctx.resume()；
 *      __audioDiag 暴露 userActive 字段。
 *   B. 运行时仿真：真实 music.js 播放层 + AudioContext 桩 + userActivation 桩，
 *      验证 hasBeenActive=false 时 start() 决议 false 且零 resume 调用，
 *      激活后重试可正常进入播放。
 *
 * 运行：node tests/run-tests.js 或单独 node tests/audio-gesture-static-check.js
 */
var readUtf8 = require('./read-utf8.js');
var path = require('path');

function makeAudioContextStub(opts) {
  opts = opts || {};
  var resumeCalls = 0;
  function param() {
    return {
      value: 0,
      setValueAtTime: function () {}, cancelScheduledValues: function () {},
      exponentialRampToValueAtTime: function () {}
    };
  }
  function node() {
    return {
      connect: function (n) { return n; }, disconnect: function () {},
      start: function () {}, stop: function () {},
      gain: param(), frequency: param(),
      type: '', buffer: null
    };
  }
  var ctx = {
    state: opts.initialState || 'suspended',
    currentTime: 0,
    sampleRate: 44100,
    destination: node(),
    createGain: node,
    createOscillator: node,
    createBufferSource: node,
    createBiquadFilter: node,
    createBuffer: function (ch, len) {
      return { getChannelData: function () { return new Float32Array(len); } };
    },
    resume: function () {
      resumeCalls++;
      return new Promise(function (resolve) {
        setTimeout(function () { ctx.state = 'running'; resolve(); }, 5);
      });
    },
    __resumeCalls: function () { return resumeCalls; }
  };
  return ctx;
}

// 以给定 AudioContext / userActivation 桩加载真实 music.js 播放层
function loadPlayer(ctxStub, activation) {
  var code = readUtf8(path.join(__dirname, '..', 'js', 'music.js'));
  var win = { AudioContext: function () { return ctxStub; } };
  var factory = new Function('window', 'self', 'module', 'navigator', 'setInterval', 'clearInterval',
    code + '\n;return (typeof module === "object" && module.exports) ? module.exports : window.Music;');
  var Music = factory(win, win, undefined, { userActivation: activation },
    function () { return 0; }, function () {});
  return Music.createPlayer();
}

function runChecks() {
  var results = [];
  function push(name, pass, detail) {
    results.push({ name: name, pass: !!pass, detail: detail || (pass ? 'ok' : 'FAILED') });
  }
  function caseAsync(name, promise) {
    return promise.then(function (r) {
      return { name: name, pass: !!r.pass, detail: r.detail || (r.pass ? 'ok' : 'FAILED') };
    }, function (e) {
      return { name: name, pass: false, detail: 'threw: ' + (e && e.message) };
    });
  }

  var root = path.join(__dirname, '..');
  var game = readUtf8(path.join(root, 'js', 'game.js'));
  var music = readUtf8(path.join(root, 'js', 'music.js'));

  /* ============ A. 静态断言 ============ */
  push('game.js 开机段不得无条件调用 ensureMusicStarted（旧裸启动行已移除）',
    !/if \(musicOn\) ensureMusicStarted\(\); *(\/\/|$)/m.test(game));
  push('game.js 开机启动须有 userActivation.isActive 门（=== true 严格判定）',
    /navigator\.userActivation && navigator\.userActivation\.isActive === true[\s\S]{0,120}ensureMusicStarted\(\)/.test(game));
  push('game.js 开机门仍尊重偏好（musicOn 与激活门同判）',
    /musicOn && navigator\.userActivation/.test(game));
  push('music.js 存在 activationBlocked 守卫（hasBeenActive === false 判定）',
    /function activationBlocked\(\)[\s\S]{0,200}navigator\.userActivation[\s\S]{0,120}hasBeenActive === false/.test(music));
  push('music.js resumed() 在调用 ctx.resume() 前检查 activationBlocked 并跳过',
    /if \(activationBlocked\(\)\) return Promise\.resolve\(false\);[\s\S]{0,80}var p = ctx\.resume\(\)/.test(music));
  push('music.js activationBlocked 在 userActivation 缺失时放行（旧浏览器维持重试行为）',
    /typeof navigator !== 'undefined' && navigator\.userActivation/.test(music));
  push('game.js __audioDiag 暴露 userActive 字段（hasBeenActive，缺支持时 null）',
    /userActive: navigator\.userActivation \? navigator\.userActivation\.hasBeenActive : null/.test(game));
  push('game.js SFX 惰性创建路径不变（ensureCtx 仍由 play 于手势内触发，未加开机调用）',
    /function play\(voice\)[\s\S]{0,120}ensureCtx\(\)/.test(game) &&
    !/if \(musicOn && navigator\.userActivation[\s\S]{0,200}SFX\.(match|combo|fail|play)/.test(game));
  // TechLead 追加缺陷（issue #47 评论）：♪ 关→开 后监听已被 !musicOn 分支移除，须重新武装
  push('game.js ♪ 切回 true 时重新武装手势监听（addMusicGestureListeners 在 toggle-on 路径）',
    /musicOn = !musicOn;[\s\S]{0,300}if \(musicOn\) \{[\s\S]{0,200}addMusicGestureListeners\(\);[\s\S]{0,120}ensureMusicStarted\(\)/.test(game));
  push('game.js addMusicGestureListeners 幂等（已武装时不重复注册）',
    /function addMusicGestureListeners\(\) \{\s*if \(musicGestureActive\) return;/.test(game));
  push('game.js 开机即武装监听（安全网默认在位）',
    /^\s{2}addMusicGestureListeners\(\);/m.test(game));

  /* ============ B. 运行时仿真 ============ */
  var uaFalse = { isActive: false, hasBeenActive: false };
  var uaTrue = { isActive: true, hasBeenActive: true };

  // C1：hasBeenActive=false（无手势）→ start 决议 false、零 resume 调用、不 running
  var c1 = (function () {
    var ctx = makeAudioContextStub({ initialState: 'suspended' });
    var p = loadPlayer(ctx, uaFalse);
    return p.start().then(function (ok) {
      return {
        pass: ok === false && p.isRunning() === false && ctx.__resumeCalls() === 0,
        detail: 'resolved=' + ok + ' running=' + p.isRunning() +
                ' resumeCalls=' + ctx.__resumeCalls()
      };
    });
  })();

  // C2：激活后（手势内）重试 → 正常 resume 并进入播放
  var c2 = (function () {
    var ctx = makeAudioContextStub({ initialState: 'suspended' });
    var activated = false;
    var p = loadPlayer(ctx, uaFalse);
    return p.start().then(function (first) {
      // 模拟首次手势到达：userActivation 转为已激活
      uaFalse.isActive = true; uaFalse.hasBeenActive = true;
      activated = true;
      return p.start().then(function (second) {
        var good = first === false && second === true && p.isRunning() === true &&
                   ctx.__resumeCalls() === 1 && activated;
        var detail = 'first=' + first + ' retry=' + second +
          ' running=' + p.isRunning() + ' resumeCalls=' + ctx.__resumeCalls();
        p.stop();
        return { pass: good, detail: detail };
      });
    });
  })();

  // C3：hasBeenActive=true（bfcache 恢复等已有激活）→ 开机立即启动不受阻
  var c3 = (function () {
    var ctx = makeAudioContextStub({ initialState: 'suspended' });
    var p = loadPlayer(ctx, uaTrue);
    return p.start().then(function (ok) {
      var good = ok === true && p.isRunning() === true && ctx.__resumeCalls() === 1;
      var detail = 'resolved=' + ok + ' running=' + p.isRunning() +
        ' resumeCalls=' + ctx.__resumeCalls();
      p.stop();
      return { pass: good, detail: detail };
    });
  })();

  return Promise.all([
    caseAsync('仿真C1 无激活（hasBeenActive=false）：start 决议 false 且零 resume 调用', c1),
    caseAsync('仿真C2 首次手势激活后重试：resume 一次并进入播放', c2),
    caseAsync('仿真C3 已有激活（bfcache 恢复）：开机立即启动不受阻', c3)
  ]).then(function (asyncResults) {
    return results.concat(asyncResults);
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { runChecks: runChecks };
}

if (require.main === module) {
  runChecks().then(function (results) {
    var pass = 0;
    results.forEach(function (r) {
      console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name +
        (r.detail ? '  -> ' + r.detail : ''));
      if (r.pass) pass++;
    });
    console.log('----------------------------------------');
    console.log(pass + '/' + results.length + ' audio-gesture checks passed');
    process.exit(pass === results.length ? 0 : 1);
  });
}
