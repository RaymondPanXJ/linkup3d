#!/usr/bin/env node
/**
 * tests/campaign-scene-check.js — 战役场景系统静态+单元断言（issue #53）
 * 无浏览器环境：scene.js 纯函数直接 require；game.js/index.html/style.css
 * 走静态正则断言（模式参考 space-static-check.js）。
 *
 * 运行：node tests/run-tests.js 或单独 node tests/campaign-scene-check.js
 */
var readUtf8 = require('./read-utf8.js');
var path = require('path');
var Scene = require('../js/scene.js');

function runChecks() {
  var root = path.join(__dirname, '..');
  var html = readUtf8(path.join(root, 'index.html'));
  var css = readUtf8(path.join(root, 'css', 'style.css'));
  var game = readUtf8(path.join(root, 'js', 'game.js'));
  var stars = readUtf8(path.join(root, 'js', 'stars.js'));

  var results = [];
  function check(name, cond, detail) {
    results.push({ name: name, pass: !!cond, detail: detail || (cond ? 'ok' : 'FAILED') });
  }

  /* 1. 数据表：10 战役场景 + 3 无尽场景 + 默认，全部通过 validateScene */
  check('scene.js 数据表含 default + s0..s9 + se-easy/normal/hard 共 14 场景',
    ['default', 's0', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9',
      'se-easy', 'se-normal', 'se-hard'].every(function (id) {
      return Scene.byId(id) !== null;
    }) && Object.keys(Scene.SCENES).length === 14);
  check('全部场景 validateScene 通过（hex 色板/density/elements 约束）',
    Object.keys(Scene.SCENES).every(function (k) {
      try { return Scene.validateScene(Scene.SCENES[k]); } catch (e) { return false; }
    }));
  check('10 战役场景名逐一对应',
    Scene.SCENES.s0.name === '沉眠深空' && Scene.SCENES.s1.name === '光带航道' &&
    Scene.SCENES.s2.name === '霜野' && Scene.SCENES.s3.name === '警戒宙域' &&
    Scene.SCENES.s4.name === '冰原反射' && Scene.SCENES.s5.name === '双星裂隙' &&
    Scene.SCENES.s6.name === '暗夜极光' && Scene.SCENES.s7.name === '风雪星云' &&
    Scene.SCENES.s8.name === '深渊回声' && Scene.SCENES.s9.name === '星核');
  check('10 战役场景底色 hex 两两互异（每关独立色调）',
    (function () {
      var bases = {};
      for (var i = 0; i < 10; i++) {
        var b = Scene.SCENES['s' + i].palette.base;
        if (bases[b]) return false;
        bases[b] = true;
      }
      return true;
    })());
  check('每关 palette.glow1 色调互异（辉光层独立）',
    (function () {
      var g = {};
      for (var i = 0; i < 10; i++) {
        var v = Scene.SCENES['s' + i].palette.glow1;
        if (g[v]) return false;
        g[v] = true;
      }
      return true;
    })());
  check('每战役关至少一个叠加宇宙元素（default 除外）',
    (function () {
      for (var i = 0; i < 10; i++) {
        if (!(Scene.SCENES['s' + i].elements.length >= 1)) return false;
      }
      return true;
    })());
  check('星群密度 density ∈ (0,1] 且逐关有差异',
    (function () {
      var ds = {};
      for (var i = 0; i < 10; i++) {
        var d = Scene.SCENES['s' + i].density;
        if (!(d > 0 && d <= 1)) return false;
        ds[d] = true;
      }
      return Object.keys(ds).length >= 4;
    })());

  /* 2. 映射纯函数 */
  check('sceneForLevel(0..9) → s0..s9 一一对应',
    (function () {
      for (var i = 0; i < 10; i++) {
        if (Scene.sceneForLevel(i).id !== 's' + i) return false;
      }
      return true;
    })());
  check('sceneForLevel 越界/非法安全回退 default',
    Scene.sceneForLevel(10).id === 'default' &&
    Scene.sceneForLevel(-1).id === 'default' &&
    Scene.sceneForLevel(1.5).id === 'default' &&
    Scene.sceneForLevel('3').id === 'default');
  check('sceneForLevelIndex 与 sceneForLevel 同步（索引折算）',
    Scene.sceneForLevelIndex(0).id === 's0' &&
    Scene.sceneForLevelIndex(9).id === 's9' &&
    Scene.sceneForLevelIndex(10).id === 'default');
  check('hudSceneIdFor 战役模式：campaignIdx → s<idx>，越界回退 default',
    Scene.hudSceneIdFor('campaign', 0) === 's0' &&
    Scene.hudSceneIdFor('campaign', 2) === 's2' &&
    Scene.hudSceneIdFor('campaign', 5) === 's5' &&
    Scene.hudSceneIdFor('campaign', 9) === 's9' &&
    Scene.hudSceneIdFor('campaign', 99) === 'default');
  check('hudSceneIdFor 无尽/限时按难度映射三常驻场景',
    Scene.hudSceneIdFor('endless', 'easy') === 'se-easy' &&
    Scene.hudSceneIdFor('endless', 'normal') === 'se-normal' &&
    Scene.hudSceneIdFor('endless', 'hard') === 'se-hard' &&
    Scene.hudSceneIdFor('timed', 'hard') === 'se-hard');
  check('hudSceneIdFor 未知模式回退 default',
    Scene.hudSceneIdFor('bogus', 'easy') === 'default');
  check('endlessSceneIdFor 非法难度回退 normal 场景',
    Scene.endlessSceneIdFor('???') === 'se-normal');

  /* 3. 渐变：blend 参数有效、hex 通道插值 */
  check('blend(t=0/1) 端点还原 from/to 色板',
    (function () {
      var a = Scene.SCENES.s0, b = Scene.SCENES.s9;
      var f = Scene.blend(a, b, 0), t = Scene.blend(a, b, 1);
      return f.palette.base === a.palette.base && t.palette.base === b.palette.base;
    })());
  check('blend 中间值产生合法 hex 色',
    (function () {
      var m = Scene.blend(Scene.SCENES.s0, Scene.SCENES.s9, 0.5);
      return /^#[0-9a-fA-F]{6}$/.test(m.palette.base);
    })());

  /* 4. 叠加元素布点：确定性、归一化坐标 */
  check('elementItems 同种子确定性（同 scene+seed 两次布点一致）',
    (function () {
      function rnd() { return 0.5; }
      var a = Scene.elementItems(Scene.SCENES.s7, rnd);
      var b = Scene.elementItems(Scene.SCENES.s7, rnd);
      return a.length > 0 && JSON.stringify(a) === JSON.stringify(b);
    })());
  check('elementItems 数量 = 各元素 count 之和',
    (function () {
      var s = Scene.SCENES.s9, n = 0;
      s.elements.forEach(function (el) { n += el.count; });
      return Scene.elementItems(s, function () { return 0.25; }).length === n;
    })());

  /* 5. index.html 接线 */
  check('index.html 在 stars.js 之前加载 scene.js（含 ?v= 缓存位）',
    html.indexOf('js/scene.js?v=') !== -1 &&
    html.indexOf('js/scene.js?v=') < html.indexOf('js/stars.js?v=') &&
    html.indexOf('js/stars.js?v=') < html.indexOf('js/game.js?v='));
  check('index.html HUD 场景名元素 #sceneName（label 场景）',
    /id="sceneName"/.test(html) && /<span class="label">场景<\/span>/.test(html));

  /* 6. game.js 接线 */
  check('game.js 挂载后经 initSceneSystem 初始化场景（保留原 Stars.mount 行）',
    /initSceneSystem\(\);/.test(game) &&
    /window\.Stars\.mount\(document\.getElementById\('starfield'\)\)/.test(game));
  check('game.js 设置 html[data-scene] 并调用句柄 setScene',
    /setAttribute\('data-scene', scene\.id\)/.test(game) &&
    /starsHandle\.setScene\(scene\)/.test(game));
  check('game.js HUD 场景名渲染（sceneNameEl.textContent = scene.name）',
    /sceneNameEl\.textContent = scene \? scene\.name/.test(game));
  check('game.js 进关/退局/新局三处接线 applyScene',
    (game.match(/applyScene\(\);/g) || []).length >= 4);
  check('game.js 战役局以 campaignIdx 折算场景 id（hudSceneIdFor）',
    /SC\.hudSceneIdFor\(/.test(game) && /campaignIdx !== null \? 'campaign' : mode/.test(game));

  /* 7. stars.js 场景通道（句柄 setScene + blend 渐变） */
  check('stars.js 挂载句柄暴露 setScene',
    /setScene: setScene/.test(stars));
  check('stars.js 场景切换走 Scene.blend ≥1s 渐变',
    /SceneLib\.blend\(fromScene, targetScene/.test(stars));

  /* 8. css：data-scene 覆盖背景变量，三主题之后（后者胜出） */
  check('style.css 含 13 个 html[data-scene=...] 覆盖块（s0..s9 + 三无尽）',
    (css.match(/html\[data-scene="/g) || []).length === 13);
  check('style.css data-scene 块位于全部 [data-theme] 块之后（场景调色胜出）',
    (function () {
      var lastTheme = css.lastIndexOf('[data-theme=');
      var firstScene = css.indexOf('html[data-scene=');
      return lastTheme !== -1 && firstScene !== -1 && firstScene > lastTheme;
    })());
  check('style.css 场景块仅覆盖四个背景变量（不破面板/文字主题变量）',
    (function () {
      var blocks = css.split(/html\[data-scene="/).slice(1);
      return blocks.every(function (b) {
        b = b.slice(0, b.indexOf('}'));
        return b.indexOf('--bg-base') !== -1 && b.indexOf('--bg-glow-1') !== -1 &&
          b.indexOf('--bg-glow-2') !== -1 && b.indexOf('--bg-glow-3') !== -1 &&
          !/--(panel|text|btn|accent|star)-/.test(b);
      });
    })());
  check('style.css html[data-scene] 背景 transition ≥1s（CSS 侧同步渐变）',
    /html\[data-scene\]\s*\{[^}]*transition:\s*background-color\s+1s/.test(css));
  check('style.css s9 星核底色与数据表一致（#140802）',
    /html\[data-scene="s9"\]\s*\{[^}]*--bg-base:\s*#140802/.test(css));

  /* 9. 资源约束：零图片/外部资源 */
  check('scene.js 无图片/外部资源引用（纯数据表）',
    !/https?:\/\/|\.png|\.jpg|\.svg|fetch\(|new Image/.test(
      readUtf8(path.join(root, 'js', 'scene.js'))));

  return results;
}

module.exports = { runChecks: runChecks };

if (require.main === module) {
  var rs = runChecks();
  var pass = 0;
  rs.forEach(function (r) {
    console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + '  -> ' + r.detail);
    if (r.pass) pass++;
  });
  console.log('----------------------------------------');
  console.log(pass + '/' + rs.length + ' passed');
  process.exit(pass === rs.length ? 0 : 1);
}
