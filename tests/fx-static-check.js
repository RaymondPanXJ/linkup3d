#!/usr/bin/env node
/**
 * tests/fx-static-check.js — 视效粒子层（fx.js）无浏览器静态断言（issue #41）
 * 验证 UMD 双端导出、纯函数核心（createPool/makeBurst/step 行为与 60 上限）、
 * reduced-motion 时 burst no-op、池总量护栏、game.js 三处 burst 接线与
 * --telegraph-ms 注入、index.html 挂载 #fxlayer、CSS 收缩圈/冻结弹跳/解冻渐隐/
 * 连击光晕/星级 pop 及 reduced-motion 回退、测试注册完整性。
 * 模式沿用 T1 campaign-static-check.js / T4 enemy-static-check.js。
 *
 * 运行：node tests/run-tests.js 或单独 node tests/fx-static-check.js
 */
var fs = require('fs');
var path = require('path');

function runChecks() {
  var root = path.join(__dirname, '..');
  var fx = fs.readFileSync(path.join(root, 'js', 'fx.js'), 'utf8');
  var game = fs.readFileSync(path.join(root, 'js', 'game.js'), 'utf8');
  var css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');
  var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  var runner = fs.readFileSync(path.join(root, 'tests', 'run-tests.js'), 'utf8');
  var FX = require('../js/fx.js');

  var results = [];
  function check(name, cond, detail) {
    results.push({ name: name, pass: !!cond, detail: detail || (cond ? 'ok' : 'FAILED') });
  }

  /* 1. UMD 双端导出（与 frost.js / enemy.js 同构） */
  check('fx.js UMD：浏览器 window.FX + Node module.exports',
    /root\.FX = factory\(\)/.test(fx) &&
    /module\.exports = factory\(\)/.test(fx) &&
    /typeof self !== 'undefined' \? self : this/.test(fx));
  check('fx.js 公开 API 齐备（KINDS/createPool/makeBurst/step/mount）',
    FX && !!(FX.KINDS && FX.createPool && FX.makeBurst && FX.step && FX.mount));

  /* 2. 纯函数核心行为（Node 侧真实调用） */
  check('fx.js 三种 kind 齐备（freeze/thaw/star）',
    !!(FX.KINDS.freeze && FX.KINDS.thaw && FX.KINDS.star));
  check('fx.js 单次 burst 粒子上限 60',
    FX.MAX_PER_BURST === 60 &&
    FX.makeBurst(10, 20, 'thaw', Math.random).length <= 60);
  check('fx.js makeBurst 未知 kind 返回空数组',
    FX.makeBurst(0, 0, 'nope', Math.random).length === 0);
  check('fx.js makeBurst 确定性：同 rand 序列同结果',
    (function () {
      var s = 1;
      function rand() { s = (s * 9301 + 49297) % 233280; return s / 233280; }
      var a = FX.makeBurst(3, 4, 'freeze', rand);
      s = 1;
      var b = FX.makeBurst(3, 4, 'freeze', rand);
      return JSON.stringify(a) === JSON.stringify(b) && a.length > 0;
    })());
  check('fx.js step 推进寿命后全部回收',
    (function () {
      var pool = FX.createPool();
      pool.items = FX.makeBurst(0, 0, 'freeze', Math.random);
      var lifeMax = Math.max.apply(null, pool.items.map(function (p) { return p.life; }));
      return FX.step(pool, lifeMax + 0.01) === 0 && pool.items.length === 0;
    })());

  /* 3. reduced-motion：burst no-op（不生成粒子不启动 rAF） */
  check('fx.js burst 在 reduced-motion / 无 ctx 时 no-op',
    /function burst\(x, y, kind\) \{\s*\n\s*if \(reduced \|\| !ctx\) return;/.test(fx));

  /* 4. 性能护栏：池总量上限（丢最旧） */
  check('fx.js 粒子池总量护栏（≤3×60，溢出丢最旧）',
    /MAX_PER_BURST \* 3/.test(fx) && /head\.splice\(0, overflow\)/.test(fx));

  /* 5. game.js 接线：挂载 + 三处 burst + --telegraph-ms 注入 */
  check('game.js 挂载 #fxlayer（window.FX.mount）',
    /window\.FX/.test(game) && /getElementById\('fxlayer'\)/.test(game) &&
    /\.mount\(/.test(game));
  check('game.js 冻结生效处 burst(freeze)', /fxBurst\(ev\.r, ev\.c, 'freeze'\)/.test(game));
  check('game.js 解冻处 burst(thaw)', /fxBurst\(p\.r, p\.c, 'thaw'\)/.test(game));
  check('game.js 结算点亮星处 burst(star)（与逐颗点亮延迟同步）',
    /fxLayer\.burst\(cx, cy, 'star'\)/.test(game) && /i \* 300 \+ 200/.test(game));
  check('game.js --telegraph-ms 注入（默认 + 按关 telegraphMs 同步）',
    /setProperty\('--telegraph-ms', ms \+ 'ms'\)/.test(game) &&
    /setTelegraphMs\(HUNTER_TELEGRAPH_MS\)/.test(game) &&
    /setTelegraphMs\(lv\.hunter\.telegraphMs\)/.test(game));
  check('game.js 连击 ≥3 时 body.combo-active 钩子',
    /classList\.toggle\('combo-active', CB\.isActive\(combo\)\)/.test(game));

  /* 6. index.html 挂载 */
  check('index.html：#fxlayer canvas + fx.js 脚本（game.js 之前）',
    /<canvas id="fxlayer"/.test(html) &&
    /<script src="js\/fx\.js"><\/script>\s*\n\s*<script src="js\/game\.js"><\/script>/.test(html));

  /* 7. CSS 表现层 */
  check('CSS：#fxlayer 固定全屏层且不吃事件',
    /#fxlayer \{[^}]*position: fixed[^}]*\}/.test(css) &&
    /#fxlayer \{[^}]*pointer-events: none/.test(css));
  check('CSS：预警收缩圈动画时长绑定 --telegraph-ms（两次收缩）',
    /\.tile-slot\.tile-frost-warn::before \{/.test(css) &&
    /animation: frost-shrink var\(--telegraph-ms, 3000ms\)/.test(css) &&
    /@keyframes frost-shrink \{[\s\S]*?scale\(1\.6\)[\s\S]*?scale\(1\.6\)/.test(css));
  check('CSS：冻结瞬间 80ms scale 弹跳 + 冰壳渐变内阴影',
    /\.tile-slot\.tile-frozen \{ animation: frost-land \.08s/.test(css) &&
    /@keyframes frost-land \{[^}]*scale\(/.test(css) &&
    /\.tile-slot\.tile-frozen::before \{[^}]*linear-gradient/.test(css) &&
    /\.tile-slot\.tile-frozen::before \{[^}]*inset 0 0/.test(css));
  check('CSS：解冻碎裂纹理 + 透明度渐隐',
    /\.tile-slot\.tile-thawing::before \{[^}]*animation: thaw-crack \.56s ease-out forwards/.test(css) &&
    /@keyframes thaw-crack \{[\s\S]*?opacity: 0; \}/.test(css));
  check('CSS：连击 ≥3 棋盘呼吸光晕（body.combo-active 钩子）',
    /body\.combo-active #stage \{[^}]*animation: combo-breathe/.test(css));
  check('CSS：星级点亮 pop（1→1.25 峰值回落）+ 级联延迟（复用 300/600ms 节奏）',
    /\.final-stars \.fstar\.lit \{ animation: star-pop/.test(css) &&
    /@keyframes star-pop \{[\s\S]*?scale\(1\);[\s\S]*?scale\(1\.45\);[\s\S]*?scale\(1\.25\);/.test(css) &&
    /\.final-stars \.fstar\.lit:nth-child\(2\) \{ animation-delay: \.3s/.test(css) &&
    /\.final-stars \.fstar\.lit:nth-child\(3\) \{ animation-delay: \.6s/.test(css));

  /* 8. reduced-motion CSS 回退：新动画全关停，收缩圈为静态可见红边框 */
  var rm = css.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/) || [''];
  var rmBlock = rm[0];
  check('CSS reduced-motion：收缩圈退化为静态红边框（animation:none + opacity:1）',
    /\.tile-slot\.tile-frost-warn::before \{[^}]*animation: none;[^}]*opacity: 1;/.test(rmBlock));
  check('CSS reduced-motion：冻结弹跳/碎裂纹理/呼吸光晕/星级 pop 全部关停',
    /\.tile-slot\.tile-frozen \{ animation: none; \}/.test(rmBlock) &&
    /\.tile-slot\.tile-thawing::before \{ animation: none;/.test(rmBlock) &&
    /body\.combo-active #stage \{ animation: none; \}/.test(rmBlock) &&
    /\.final-stars \.fstar\.lit \{ animation: none; \}/.test(rmBlock));

  /* 9. 注册完整性 */
  check('run-tests.js 已注册 fx-static-check',
    /require\('\.\/fx-static-check\.js'\)/.test(runner) &&
    /fxChecks\.runChecks\(\)/.test(runner));

  return results;
}

if (require.main === module) {
  runChecks().forEach(function (r) {
    console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + '  -> ' + r.detail);
  });
}

module.exports = { runChecks: runChecks };
