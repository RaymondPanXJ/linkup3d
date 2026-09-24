#!/usr/bin/env node
/**
 * tests/rank-static-check.js — 本地排行榜（Top10 分难度）的无浏览器接线静态断言（issue #13）
 * 验证 index.html / css/style.css / js/game.js / js/ranking.js
 * 在「排行按钮、面板结构、记录时机、存储接线、关闭方式、无障碍与降级」各端的一致性。
 *
 * 运行：node tests/run-tests.js 或单独 node tests/rank-static-check.js
 */
var fs = require('fs');
var path = require('path');

function runChecks() {
  var root = path.join(__dirname, '..');
  var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  var css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');
  var game = fs.readFileSync(path.join(root, 'js', 'game.js'), 'utf8');
  var ranking = fs.readFileSync(path.join(root, 'js', 'ranking.js'), 'utf8');

  var results = [];
  function check(name, cond, detail) {
    results.push({ name: name, pass: !!cond, detail: detail || (cond ? 'ok' : 'FAILED') });
  }

  /* 1. index.html：HUD 排行按钮、面板结构、脚本顺序 */
  check('HTML HUD 存在「排行」按钮（id=rank + aria-label）',
    /<button id="rank"[^>]*aria-label="本地排行榜"[^>]*>排行<\/button>/.test(html));
  check('HTML 排行面板为对话框语义（role=dialog + aria-modal + aria-label）',
    /<div id="rankOverlay"[^>]*role="dialog"/.test(html) &&
    /aria-modal="true"/.test(html) && /aria-label="本地排行榜"/.test(html));
  check('HTML 表格列齐全：名次/得分/用时/最高连击/日期',
    /<th>名次<\/th><th>得分<\/th><th>用时<\/th><th>最高连击<\/th><th>日期<\/th>/.test(html));
  check('HTML 面板含难度 tab 容器 / tbody / 关闭钮',
    /id="rankTabs"/.test(html) && /id="rankTbody"/.test(html) &&
    /<button id="rankClose"[^>]*aria-label="关闭排行榜"/.test(html));
  check('HTML 在 game.js 之前加载 ranking.js',
    html.indexOf('js/ranking.js') > 0 &&
    html.indexOf('js/ranking.js') < html.indexOf('js/game.js'));

  /* 2. ranking.js：UMD 双用、纯函数约束、存储键 */
  check('ranking.js 为 UMD（module.exports + window.Ranking）',
    /module\.exports = factory\(\)/.test(ranking) && /root\.Ranking = factory\(\)/.test(ranking));
  check('ranking.js 不直接调用 Date.now（时间戳参数注入）',
    !/Date\.now\(/.test(ranking));
  check('ranking.js 不含 DOM / localStorage 直接依赖（纯函数模块）',
    !/localStorage/.test(ranking) && !/document\./.test(ranking));
  check('ranking.js 存储键为 linkup3d.rank.<easy|standard|hard>',
    /'linkup3d\.rank\.'/.test(ranking) &&
    /RANK_TIERS = \{ easy: 'easy', normal: 'standard', hard: 'hard' \}/.test(ranking));
  check('ranking.js 容量常量为 10', /MAX_ENTRIES = 10/.test(ranking));

  /* 3. game.js：记录时机与存储接线 */
  check('game.js 引用 window.Ranking', /var RK = window\.Ranking/.test(game));
  check('通关结算调用 recordRound（当前唯一一局结束点 win()）',
    /function win\(\)[\s\S]{0,400}recordRound\(\)/.test(game));
  check('recordRound：0 分不入榜 + ts 用 Date.now 注入 createEntry',
    /function recordRound\(\)[\s\S]{0,200}!RK\.isEligible\(score\)[\s\S]{0,200}RK\.createEntry\(score, (?:seconds|tState\.elapsedSec), Math\.max\(maxCombo, 1\), Date\.now\(\)\)/.test(game));
  check('recordRound：wouldEnter 预判后 insert + setItem 写档',
    /function recordRound\(\)[\s\S]{0,400}RK\.wouldEnter\(board, score\)[\s\S]{0,200}RK\.insert\(board, entry\)[\s\S]{0,200}setItem\(RK\.rankKey\(difficulty\), RK\.serializeBoard\(next\)\)/.test(game));
  check('榜单读取走 parseBoard(rankKey) 且有 try/catch 保护',
    /function loadBoard\(diff\)[\s\S]{0,120}RK\.parseBoard\(localStorage\.getItem\(RK\.rankKey\(diff\)\)\)[\s\S]{0,80}catch/.test(game));
  check('本局 maxCombo 实时跟踪并在 restart 归零',
    /if \(combo > maxCombo\) maxCombo = combo/.test(game) &&
    (/maxCombo = 0/.test((game.match(/function restart\(\)[\s\S]*?\n  \}/) || [''])[0])));

  /* 4. game.js：面板渲染与交互（tab 切换 / 高亮 / 空榜 / 三种关闭） */
  check('面板渲染五列数据（名次/得分/用时/最高连击 xN/日期）',
    /cell\(String\(i \+ 1\)\)/.test(game) && /cell\(String\(e\.score\)\)/.test(game) &&
    /cell\(RK\.formatTime\(e\.seconds\)\)/.test(game) &&
    /cell\('x' \+ e\.maxCombo\)/.test(game) && /cell\(RK\.formatDate\(e\.ts\)\)/.test(game));
  check('本局新纪录行高亮（rank-new 类按 ts 匹配）',
    /e\.ts === lastRoundTs.*rank-new|if \(e\.ts === lastRoundTs\) tr\.className = 'rank-new'/.test(game));
  check('空榜占位文案（rank-empty + colSpan=5）',
    /rank-empty/.test(game) && /colSpan = 5/.test(game) &&
    /暂无记录，快来创造第一条吧/.test(game));
  check('难度 tab 三档切换（easy/normal/hard 各自 rankKey 读数）',
    /RANK_DIFFS = \[[\s\S]*?easy[\s\S]*?normal[\s\S]*?hard/.test(game) &&
    /rankTabs\.addEventListener\('click'/.test(game) &&
    /rankView = btn\.dataset\.key/.test(game));
  check('打开面板默认定位当前难度档',
    /function openRankPanel\(\)[\s\S]{0,60}rankView = difficulty/.test(game));
  check('关闭方式三选全实现：点遮罩 / Esc / 关闭钮',
    /rankOverlay\.addEventListener\('click'[\s\S]{0,120}ev\.target === rankOverlay/.test(game) &&
    /ev\.key === 'Escape'[\s\S]{0,80}closeRankPanel\(\)/.test(game) &&
    /rankClose\.addEventListener\('click', closeRankPanel\)/.test(game));

  /* 5. css：遮罩层级、开启态、高亮/空榜/tab 激活样式 */
  check('CSS #rankOverlay 固定全屏默认不可点，.show 可点',
    /#rankOverlay\s*\{[^}]*position:\s*fixed/.test(css) &&
    /#rankOverlay\s*\{[^}]*pointer-events:\s*none/.test(css) &&
    /#rankOverlay\.show\s*\{[^}]*pointer-events:\s*auto/.test(css));
  check('CSS 排行遮罩层级不低于通关弹窗（rank z-index ≥ overlay）',
    (function () {
      var oz = css.match(/#overlay\s*\{[^}]*z-index:\s*(\d+)/);
      var rz = css.match(/#rankOverlay\s*\{[^}]*z-index:\s*(\d+)/);
      return oz && rz && +rz[1] >= +oz[1];
    })());
  check('CSS 存在 #rank 按钮 / .rank-tab.active / tr.rank-new / tr.rank-empty 样式',
    /button#rank\s*\{/.test(css) && /\.rank-tab\.active\s*\{/.test(css) &&
    /tr\.rank-new td\s*\{/.test(css) && /tr\.rank-empty td\s*\{/.test(css));
  check('CSS 移动端 media query 覆盖排行面板（防破版）',
    (function () {
      var mq = css.match(/@media[^{]*\{([\s\S]*)$/);
      return mq && /\.rank-panel\s*\{[^}]*padding/.test(mq[1]);
    })());

  return results;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { runChecks: runChecks };
}

if (require.main === module) {
  var results = runChecks();
  var pass = 0;
  results.forEach(function (r) {
    console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name +
      (r.detail ? '  -> ' + r.detail : ''));
    if (r.pass) pass++;
  });
  console.log('----------------------------------------');
  console.log(pass + '/' + results.length + ' rank static checks passed');
  process.exit(pass === results.length ? 0 : 1);
}
