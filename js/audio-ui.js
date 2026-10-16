/**
 * audio-ui.js — 音频 UI 接线模块（issue #74，刀1：game.js 拆单首刀）
 *
 * 从 js/game.js 整迁的音频控制簇（行为零变化，纯重构）：
 *   - 静音按钮渲染与点击（原 renderMuteBtn 及其 click 监听）；
 *   - 背景音乐按钮渲染与点击（原 renderMusicBtn/MUSIC_KEY/musicPlayer/musicOn）；
 *   - 首手势重试监听（原 addMusicGestureListeners/removeMusicGestureListeners/
 *     onFirstGesture/ensureMusicStarted，issue #45 持续重试 / issue #47 重新武装
 *     与开机门语义逐字保留）；
 *   注：game.js 内联的 SFX 合成引擎（var SFX = (function(){})()）按工单口径
 *   留守原地不迁——本模块经 opts.SFX 注入使用，不复制不新造接口。
 *
 * 模块形态镜像 js/music.js（UMD 双端、'use strict'、var 风格）；
 * DOM 访问走 game.js 既有 UI 惯例（game 顶层解析元素后传入，本模块不抓 DOM）；
 * 音频依赖不新造接口：SFX 由 game.js 注入（缺省兜底 window.SFX）、
 * 播放器走 window.Music 既有 createPlayer()/diag() 只消费不动。
 *
 * game.js 同签名接线：`var SFX = AudioUI.init({ muteBtn, musicBtn, SFX })`
 * （SFX 引擎先于本行定义，init 返回捕获同名句柄），
 * 诊断消费点走 AudioUI.diag()（game 的 __audioDiag 形状零变化）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AudioUI = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function init(opts) {
    opts = opts || {};
    var muteBtn = opts.muteBtn || null;
    var musicBtn = opts.musicBtn || null;
    var SFX = opts.SFX || (typeof window !== 'undefined' ? window.SFX : null);
    if (!SFX) { throw new Error('audio-ui: 需要 SFX 引擎（opts.SFX 注入或 window.SFX）'); }

    /* ---------------- 静音按钮（WebAudio 程序化合成音效的总开关） ---------------- */
    function renderMuteBtn() {
      muteBtn.textContent = SFX.isMuted() ? '🔇' : '🔊';
      muteBtn.setAttribute('aria-pressed', SFX.isMuted() ? 'true' : 'false');
      muteBtn.setAttribute('aria-label', SFX.isMuted() ? '取消静音' : '静音');
    }
    muteBtn.addEventListener('click', function () {
      SFX.setMuted(!SFX.isMuted());
      renderMuteBtn();
    });
    renderMuteBtn();

    /* ---------------- 背景音乐（WebAudio 程序化合成，独立于 SFX 静音，issue #10） ---------------- */
    var MUSIC_KEY = 'linkup3d.music';
    var MU = window.Music;
    var musicPlayer = MU.createPlayer();
    var musicOn = false;
    try { musicOn = localStorage.getItem(MUSIC_KEY) !== '0'; } catch (e) { /* 无存储环境默认开 */ }

    function renderMusicBtn() {
      musicBtn.textContent = musicOn ? '♪' : '♩';
      musicBtn.classList.toggle('on', musicOn);
      musicBtn.setAttribute('aria-pressed', musicOn ? 'true' : 'false');
      musicBtn.setAttribute('aria-label', musicOn ? '关闭背景音乐' : '开启背景音乐');
    }

    // 浏览器自动播放策略：AudioContext 需在用户手势中才能恢复运行。
    // issue #45 根因2：once 一次性监听错过首手势窗口后整会话不再重试——
    // 改为持续监听，直到真正播放（isRunning）或偏好关闭（!musicOn）才解除。
    function ensureMusicStarted() {
      if (!musicOn || musicPlayer.isRunning()) return;
      musicPlayer.start();
    }

    musicBtn.addEventListener('click', function () {
      musicOn = !musicOn;
      try { localStorage.setItem(MUSIC_KEY, musicOn ? '1' : '0'); } catch (e) { /* 忽略 */ }
      if (musicOn) {
        // issue #47 追加：关 ♪ 时 onFirstGesture 的 !musicOn 分支已移除监听——
        // 切回必须重新武装，否则重试安全网永久失效（start 复用 #45 异步安全路径）。
        addMusicGestureListeners();
        ensureMusicStarted();
      } else {
        musicPlayer.stop();
      }
      renderMusicBtn();
    });

    var gestureEvents = ['pointerdown', 'touchstart', 'keydown'];
    var musicRetryEvents = gestureEvents.concat('click');
    var musicGestureActive = false;
    function addMusicGestureListeners() {
      if (musicGestureActive) return;
      musicGestureActive = true;
      musicRetryEvents.forEach(function (ev) {
        window.addEventListener(ev, onFirstGesture, { passive: true });
      });
    }
    function removeMusicGestureListeners() {
      musicGestureActive = false;
      musicRetryEvents.forEach(function (ev) {
        window.removeEventListener(ev, onFirstGesture);
      });
    }
    function onFirstGesture() {
      ensureMusicStarted();
      // start() 可能仍在等 resume 决议；isRunning() 未置真前保留监听，下次手势继续重试。
      if (musicPlayer.isRunning() || !musicOn) removeMusicGestureListeners();
    }
    addMusicGestureListeners();

    renderMusicBtn();
    // issue #47：开机无手势时不得启动——无激活上下文里 new AudioContext() 创建即挂起
    // 并触发浏览器告警。仅当已有激活（如 bfcache 恢复后仍保持激活）才立即启动，
    // 否则交给上方手势持续重试监听，ensure() 首次创建将发生在手势内，告警根除。
    if (musicOn && navigator.userActivation && navigator.userActivation.isActive === true) {
      ensureMusicStarted();
    }

    return {
      // 注入的 SFX 句柄原样回传（game 侧 AudioUI.SFX 与本地 SFX 同源）
      SFX: SFX,
      // 只读诊断（issue #45：供 game.js 的 window.__audioDiag；不创建 ctx，
      // 不触发动作，字段形状对 game 侧消费点零变化）
      diag: function () {
        var m = musicPlayer.diag();
        return { running: m.running, ctxState: m.ctxState, currentTime: m.currentTime,
                 musicOn: musicOn, listenersActive: musicGestureActive };
      }
    };
  }

  return { init: init };
});
