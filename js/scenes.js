/**
 * scenes.js — 战役场景接线模块（issue #74，刀2：game.js 拆单第二刀）
 *
 * 从 js/game.js 整迁的场景系统接线簇（行为零变化，纯重构，issue #53 语义逐字保留）：
 *   - currentSceneId / applyScene / renderSceneName / initSceneSystem 四函数；
 *   - starsHandle / sceneNameEl 内部状态（原为 game.js 闭包变量，本模块私有化）。
 *
 * 依赖注入纪律（工单口径「关卡/主题依赖一律 getter 注入，不许读 game.js 闭包变量」）：
 *   - campaignIdx / mode / difficulty 三个 game.js 可变状态经 opts.getCampaignIdx /
 *     opts.getMode / opts.getDifficulty 只读读取，本模块内以同名局部变量落位后
 *     再参与映射表达式（表达式文本与迁出前逐字一致，#53 老锁零改动重锚到本文件）；
 *   - sceneNameEl 由 game 顶层抓取后传入（opts.sceneNameEl，镜像刀1惯例）；
 *     starfield 抓取保留 #53 原句逐字（campaign-scene-check 老锁文本锁定，DOM id
 *     非闭包变量不违纪）；
 *   - Scene 数据表与 Stars 星幕经 window 全局模块取用（与 game.js 原 `window.Scene`/
 *     `window.Stars` 同源，含原 try/catch 静默降级），不复制不新造接口。
 *
 * game.js 同签名接线：
 *   var SceneUI = window.Scenes.init({ sceneNameEl, starfieldEl,
 *       getCampaignIdx, getMode, getDifficulty });
 *   var applyScene = SceneUI.applyScene; var initSceneSystem = SceneUI.initSceneSystem;
 * 模块形态镜像 js/audio-ui.js（刀1）：UMD 双端、'use strict'、var 风格、init 注入。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Scenes = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function init(opts) {
    opts = opts || {};
    // 三个 game.js 可变状态的只读 getter（缺省全 null：场景映射落到 hudSceneIdFor
    // 的 default 回退，与 game.js 未初始化态一致）
    var getCampaignIdx = opts.getCampaignIdx || function () { return null; };
    var getMode = opts.getMode || function () { return null; };
    var getDifficulty = opts.getDifficulty || function () { return null; };
    var sceneNameEl = opts.sceneNameEl || null;

    // Scene 数据表句柄（原 game.js 的 SC 适配器逐字迁入：无 Scene 环境静默降级）
    var SC = (function () {
      try { return window.Scene || null; } catch (e) { return null; }
    })();

    var starsHandle = null; // Stars 挂载句柄（原 game.js 闭包变量，本模块私有）

    function currentSceneId() {
      if (!SC) return null;
      // 状态经 getter 落位为同名局部变量——下方映射表达式与迁出前逐字一致（#53 锁）
      var campaignIdx = getCampaignIdx();
      var mode = getMode();
      var difficulty = getDifficulty();
      return SC.hudSceneIdFor(
        campaignIdx !== null ? 'campaign' : mode,
        campaignIdx !== null ? campaignIdx : difficulty);
    }

    function applyScene() {
      if (!SC) return;
      var scene = SC.byId(currentSceneId()) || SC.SCENES[SC.DEFAULT_SCENE_ID];
      try {
        document.documentElement.setAttribute('data-scene', scene.id);
      } catch (e) { /* 无 DOM 环境忽略 */ }
      if (starsHandle) starsHandle.setScene(scene);
      renderSceneName();
    }

    function renderSceneName() {
      if (!sceneNameEl || !SC) return;
      var scene = SC.byId(currentSceneId());
      sceneNameEl.textContent = scene ? scene.name : '—';
    }

    // 状态经 getter 注入纪律不变；starfield 抓取行保持 #53 原文逐字（campaign-scene-check
    // 老锁零改动锁定该行文本；DOM id 非闭包变量，不违注入纪律）
    function initSceneSystem() {
      starsHandle = window.Stars.mount(document.getElementById('starfield'));
      applyScene();
    }

    return {
      currentSceneId: currentSceneId,
      applyScene: applyScene,
      renderSceneName: renderSceneName,
      initSceneSystem: initSceneSystem
    };
  }

  return { init: init };
});
