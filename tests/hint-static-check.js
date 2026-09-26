#!/usr/bin/env node
/**
 * tests/hint-static-check.js — 提示/引导 UI 静态断言（issue #16）
 * 无浏览器环境：对 index.html / css/style.css / js/game.js 做结构断言。
 * 运行：node tests/run-tests.js
 */
var fs = require('fs');
var path = require('path');

var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
var css = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8');
var game = fs.readFileSync(path.join(__dirname, '..', 'js', 'game.js'), 'utf8');

function check(name, ok, detail) {
  return { name: name, pass: !!ok, detail: detail || (ok ? 'ok' : 'FAILED') };
}

function runChecks() {
  var out = [];

  /* ---------- HTML 结构 ---------- */
  out.push(check('HTML 提示按钮 #hint（含剩余次数 #hintCount）',
    /id="hint"/.test(html) && /id="hintCount"/.test(html)));
  out.push(check('HTML 「?」帮助按钮 #help（重看引导）',
    /id="help"/.test(html)));
  out.push(check('HTML 引导弹窗 #tutorial 含标题/正文/圆点/按钮',
    /id="tutorial"/.test(html) && /id="tutTitle"/.test(html) &&
    /id="tutText"/.test(html) && /id="tutDots"/.test(html) &&
    /id="tutNext"/.test(html) && /id="tutSkip"/.test(html)));
  out.push(check('HTML 引导圆点数量 = 4 步',
    (html.match(/<div class="tut-dots"[^>]*>([\s\S]*?)<\/div>/)[1]
      .match(/<span>/g) || []).length === 4));
  out.push(check('HTML 弹窗为 aria dialog（role/aria-modal/aria-labelledby）',
    /role="dialog"/.test(html) && /aria-modal="true"/.test(html) &&
    /aria-labelledby="tutTitle"/.test(html)));
  out.push(check('HTML 按序加载 hint.js → tutorial.js（均在 game.js 之前）',
    html.indexOf('js/hint.js') !== -1 && html.indexOf('js/tutorial.js') !== -1 &&
    html.indexOf('js/hint.js') < html.indexOf('js/game.js') &&
    html.indexOf('js/tutorial.js') < html.indexOf('js/game.js')));

  /* ---------- CSS 结构 ---------- */
  out.push(check('CSS 提示按钮态（含 disabled 置灰）',
    /button#hint/.test(css) && /button#hint:disabled/.test(css)));
  out.push(check('CSS 提示高亮 .tile-slot.hint 呼吸动画 + keyframes',
    /\.tile-slot\.hint/.test(css) && /@keyframes hintpulse/.test(css)));
  out.push(check('CSS 引导弹窗淡入（#tutorial.show 控制 pointer-events）',
    /#tutorial \{/.test(css) && /#tutorial\.show \{[^}]*pointer-events: auto/.test(css)));
  out.push(check('CSS 引导 z-index 高于通关弹窗（#overlay z:30）',
    (css.match(/#tutorial \{[\s\S]*?z-index: (\d+)/)[1] | 0) >=
    (css.match(/#overlay \{[\s\S]*?z-index: (\d+)/)[1] | 0)));
  out.push(check('CSS 引导进度圆点 .tut-dots span.active',
    /\.tut-dots span\.active/.test(css)));

  /* ---------- game.js 接线 ---------- */
  out.push(check('game.js 每局重置提示次数为 HINTS_PER_GAME（restart 内）',
    /restart\(\)[\s\S]{0,400}hintsLeft = Hint\.HINTS_PER_GAME/.test(game)));
  out.push(check('提示点击：高亮两枚 + describePath 播报 + 限时清除',
    /classList\.add\('hint'\)/.test(game) &&
    /Hint\.describePath\(pair\.path, grid\)/.test(game) &&
    /setTimeout\(clearHintHighlight/.test(game)));
  out.push(check('无可连对：toast 展示 ≥800ms 后才执行洗牌',
    /SHUFFLE_NOTICE_MS = (\d+)/.test(game) &&
    Number(RegExp.$1) >= 800 &&
    /showToast\('无可连对，正在洗牌', SHUFFLE_NOTICE_MS\)/.test(game) &&
    /setTimeout\(function \(\) \{[\s\S]{0,80}doShuffle\(\);[\s\S]{0,40}SHUFFLE_NOTICE_MS\)/.test(game)));
  out.push(check('洗牌延时受 gen 作废保护（restart 后不作废旧延时即触发）',
    /announceShuffle[\s\S]{0,300}myGen !== gen\) return;[\s\S]{0,60}doShuffle/.test(game)));
  out.push(check('「?」按钮点击重放引导（tutorial.show）',
    /helpBtn\.addEventListener\('click'[\s\S]{0,80}tutorial\.show\(\)/.test(game)));
  out.push(check('首访判定：读 linkup3d.tutorial，缺省弹出引导',
    /localStorage\.getItem\(Hint\.TUT_KEY\)/.test(game) &&
    /if \(!seenTutorial\) tutorial\.show\(\)/.test(game)));
  out.push(check('Tutorial 挂载提供 localStorage 读写适配器',
    /Tutorial\.mount\(\{[\s\S]{0,500}localStorage\.setItem\(Hint\.TUT_KEY/.test(game)));

  return out;
}

module.exports = { runChecks: runChecks };
