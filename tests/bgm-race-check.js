#!/usr/bin/env node
/**
 * tests/bgm-race-check.js — BGM 启动竞态修复（issue #45）静态断言 + 状态机仿真
 *   A. 静态断言：music.js start() 必须经 resume 的 Promise 续接启动序列
 *      （禁止「fire-and-forget resume + 同步 return」模式）；game.js 手势监听
 *      持续重试（isRunning 未满足不移除）、__audioDiag 钩子在位。
 *   B. 运行时仿真：用真实 js/music.js 播放层对接最小 AudioContext 桩（本仓库无
 *      浏览器环境，AudioContext 属宿主 API，桩为必需且仅模拟浏览器语义），
 *      验证 suspended→resume 异步完成后才 running、并发 start 单一调度器、
 *      在途 stop 幂等取消。
 *
 * 运行：node tests/run-tests.js 或单独 node tests/bgm-race-check.js
 */
var fs = require('fs');
var path = require('path');

function makeAudioContextStub(opts) {
  opts = opts || {};
  // resumeBehavior: 'resolve'（默认，手势后恢复）| 'reject' | 'staySuspended'
  var behavior = opts.resumeBehavior || 'resolve';
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
      if (behavior === 'reject') return Promise.reject(new Error('not allowed'));
      return new Promise(function (resolve) {
        setTimeout(function () {
          if (behavior === 'resolve') ctx.state = 'running';
          resolve();
        }, 5);
      });
    },
    __resumeCalls: function () { return resumeCalls; }
  };
  return ctx;
}

// 在沙箱里以给定 AudioContext 加载真实 music.js 播放层
function loadPlayer(ctxStub) {
  var code = fs.readFileSync(path.join(__dirname, '..', 'js', 'music.js'), 'utf8');
  var win = { AudioContext: function () { return ctxStub; } };
  // 统计调度器 setInterval：验证并发 start 只建一个调度器
  var intervals = 0, cleared = 0, live = {};
  function setIntervalFake(fn, ms) { intervals++; var id = intervals; live[id] = fn; return id; }
  function clearIntervalFake(id) { if (live[id]) { cleared++; delete live[id]; } }
  var sandboxWindow = win, sandboxSelf = win, sandboxModule;
  var factory = new Function('window', 'self', 'module', 'setInterval', 'clearInterval',
    code + '\n;return (typeof module === "object" && module.exports) ? module.exports : window.Music;');
  var Music = factory(sandboxWindow, sandboxSelf, undefined, setIntervalFake, clearIntervalFake);
  return {
    player: Music.createPlayer(),
    schedulerIntervals: function () { return intervals; },
    liveSchedulers: function () { return Object.keys(live).length; }
  };
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
  var game = fs.readFileSync(path.join(root, 'js', 'game.js'), 'utf8');
  var music = fs.readFileSync(path.join(root, 'js', 'music.js'), 'utf8');

  /* ============ A. 静态断言 ============ */
  // 根因1：禁止「ensure 内 fire-and-forget resume 后同步 return」模式
  push('music.js 不再有 ensure 内 fire-and-forget ctx.resume()',
    !/if \(ctx\.state === 'suspended' && ctx\.resume\) \{ try \{ ctx\.resume\(\)/.test(music));
  push('music.js start() 经 resume 的 Promise 续接启动序列（then 内才置 running）',
    /function resumed\(\)[\s\S]{0,600}ctx\.resume\(\)[\s\S]{0,300}\.then\(/.test(music) &&
    /starting = resumed\(\)\.then\(function \(ok\)[\s\S]{0,400}running = true/.test(music));
  push('music.js running 只在 resume 决议 state=running 后置位（start 返回 Promise）',
    /return p\.then\(function \(\) \{ return ctx\.state === 'running'; \}/.test(music) &&
    /if \(!ok \|\| running\) return running/.test(music));
  push('music.js 禁止旧的同步早退模式（state !== running 即 return 不启动）',
    !/if \(ctx\.state !== 'running'\) return;/.test(music));
  push('music.js 并发 start 共享在途 promise（单一调度器守卫）',
    /if \(starting\) return starting;/.test(music));
  push('music.js 在途启动期间 stop 可取消（幂等，不残留调度器）',
    /if \(starting\) \{ stopDuringStart = true; return; \}/.test(music) &&
    /if \(stopDuringStart\) \{ stopDuringStart = false; return false; \}/.test(music));

  // 根因2：game.js 手势持续重试
  push('game.js 手势注册不再使用 once:true',
    !/window\.addEventListener\(ev, onFirstGesture, \{ once: true/.test(game));
  push('game.js onFirstGesture 仅在 isRunning 或偏好关闭时移除监听（持续重试）',
    /function onFirstGesture\(\)[\s\S]{0,300}ensureMusicStarted\(\)[\s\S]{0,300}if \(musicPlayer\.isRunning\(\) \|\| !musicOn\) removeMusicGestureListeners\(\)/.test(game));
  push('game.js 监听覆盖 pointerdown/touchstart/keydown（含 click 扩展）',
    /gestureEvents = \['pointerdown', 'touchstart', 'keydown'\]/.test(game) &&
    /musicRetryEvents = gestureEvents\.concat\('click'\)/.test(game));
  push('game.js 暴露只读 __audioDiag（sfx/music 两端 ctxState+currentTime，music 含 running）',
    /window\.__audioDiag = function \(\)[\s\S]{0,400}sfx:[\s\S]{0,120}ctxState[\s\S]{0,120}currentTime[\s\S]{0,200}running:[\s\S]{0,200}ctxState/.test(game));
  push('SFX 音色/触发点不变（match/combo/fail 仍经 play 统一走 ensureCtx）',
    /match: function \(\)[\s\S]{0,200}tone\(784/.test(game) &&
    /fail: function \(\)[\s\S]{0,200}play\(function/.test(game));

  /* ============ B. 运行时仿真（真实 music.js 播放层 + AudioContext 桩） ============ */

  // B1 核心回归：suspended ctx，start() 必须等 resume 完成后才 running
  var b1 = (function () {
    var ctx = makeAudioContextStub({ initialState: 'suspended' });
    var env = loadPlayer(ctx);
    var p = env.player;
    var syncRunning = null;
    var startPromise = p.start();
    syncRunning = p.isRunning(); // 同步检查：resume 尚未完成，此时必须未启动
    return startPromise.then(function (ok) {
      return {
        pass: ok === true && syncRunning === false && p.isRunning() === true &&
              p.diag().running === true && ctx.__resumeCalls() === 1,
        detail: 'syncRunning=' + syncRunning + ' resolved=' + ok +
                ' final=' + p.isRunning() + ' resumeCalls=' + ctx.__resumeCalls()
      };
    });
  })();

  // B2 并发双击：两个 start 共享同一在途启动，只创建一个调度器
  var b2 = (function () {
    var ctx = makeAudioContextStub({ initialState: 'suspended' });
    var env = loadPlayer(ctx);
    var p = env.player;
    return Promise.all([p.start(), p.start()]).then(function (rs) {
      var ok = rs[0] === true && rs[1] === true &&
               env.schedulerIntervals() === 1 && env.liveSchedulers() === 1 &&
               ctx.__resumeCalls() === 1;
      p.stop();
      return { pass: ok, detail: 'results=' + JSON.stringify(rs) +
        ' schedulers=' + env.schedulerIntervals() + ' resumeCalls=' + ctx.__resumeCalls() };
    });
  })();

  // B3 在途 stop：resume 决议前关闭 → 不进入播放、无残留调度器
  var b3 = (function () {
    var ctx = makeAudioContextStub({ initialState: 'suspended' });
    var env = loadPlayer(ctx);
    var p = env.player;
    var sp = p.start();
    p.stop();
    return sp.then(function (ok) {
      return {
        pass: ok === false && p.isRunning() === false && env.liveSchedulers() === 0,
        detail: 'resolved=' + ok + ' running=' + p.isRunning() +
                ' liveSchedulers=' + env.liveSchedulers()
      };
    });
  })();

  // B4 resume 被拒（非手势调用）：start 决议 false，播放器可再次安全重试
  var b4 = (function () {
    var ctx = makeAudioContextStub({ initialState: 'suspended', resumeBehavior: 'reject' });
    var env = loadPlayer(ctx);
    var p = env.player;
    return p.start().then(function (first) {
      // 失败后可重试：桩改为可恢复（模拟下一次真实手势）
      ctx.resume = function () {
        return new Promise(function (res) {
          setTimeout(function () { ctx.state = 'running'; res(); }, 5);
        });
      };
      return p.start().then(function (second) {
        var liveRunning = p.isRunning();
        var ok = first === false && second === true && liveRunning === true &&
                 env.liveSchedulers() === 1;
        p.stop();
        return { pass: ok, detail: 'first=' + first + ' retry=' + second +
          ' running=' + liveRunning };
      });
    });
  })();

  // B5 已 running 的 ctx（自动播放允许的浏览器）：start 决议 true 且不额外调 resume
  var b5 = (function () {
    var ctx = makeAudioContextStub({ initialState: 'running' });
    var env = loadPlayer(ctx);
    var p = env.player;
    return p.start().then(function (ok) {
      var good = ok === true && p.isRunning() === true && ctx.__resumeCalls() === 0;
      p.stop();
      return { pass: good, detail: 'resolved=' + ok + ' resumeCalls=' + ctx.__resumeCalls() };
    });
  })();

  return Promise.all([
    caseAsync('仿真B1 suspended ctx：等待 resume 完成后才置 running（根因1回归）', b1),
    caseAsync('仿真B2 并发双击 start：共享在途启动，仅一个调度器（验收4）', b2),
    caseAsync('仿真B3 在途启动中 stop：取消进入播放且无残留调度器（验收6）', b3),
    caseAsync('仿真B4 resume 被拒：决议 false，下次手势可重试成功', b4),
    caseAsync('仿真B5 ctx 已 running：直接启动且不再调 resume', b5)
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
    console.log(pass + '/' + results.length + ' bgm-race checks passed');
    process.exit(pass === results.length ? 0 : 1);
  });
}
