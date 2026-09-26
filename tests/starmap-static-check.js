#!/usr/bin/env node
/**
 * tests/starmap-static-check.js — 星图与战役流程主循环接线（issue #33, T5）
 * 无浏览器环境的静态断言 + 纯函数管线仿真：
 *   A. index.html：#campaign / 星图 / 确认弹窗 / 结算新按钮 / #frostDebug 移除 / 脚本顺序；
 *   B. js/timer.js：create(mode, limitSec) 扩展（含旧行为不变的向后兼容断言）；
 *   C. js/game.js：关卡装载/预冻/巡猎/结算存档/失败不存档/退出战役/按钮接线；
 *   D. css/style.css：星图节点三态、结算星级、弹层 show 态与 reduced-motion 回退；
 *   E. 管线仿真：用真实 Campaign/Save/Timer 模块复现战役状态机的核心口径
 *      （解锁链、星级判定、胜利存档/失败不存档、关卡时限归一化）。
 * 运行：node tests/run-tests.js 或单独 node tests/starmap-static-check.js
 */
var fs = require('fs');
var path = require('path');

function runChecks() {
  var root = path.join(__dirname, '..');
  var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  var css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');
  var game = fs.readFileSync(path.join(root, 'js', 'game.js'), 'utf8');
  var runner = fs.readFileSync(path.join(root, 'tests', 'run-tests.js'), 'utf8');
  var C = require('../js/campaign.js');
  var S = require('../js/save.js');
  var T = require('../js/timer.js');

  var results = [];
  function check(name, cond, detail) {
    results.push({ name: name, pass: !!cond, detail: detail || (cond ? 'ok' : 'FAILED') });
  }

  /* ================ A. index.html 结构 ================ */
  check('index.html 含战役入口按钮 #campaign',
    /<button id="campaign"/.test(html));
  check('index.html 含星图弹层 #starMap（role=dialog）与网格 #starmapGrid',
    /<div id="starMap" role="dialog"/.test(html) &&
    /<div id="starmapGrid" class="starmap-grid"/.test(html));
  check('index.html 含关卡确认弹窗 #levelConfirm 及取消/进入按钮',
    /<div id="levelConfirm" role="dialog"/.test(html) &&
    /<button id="confirmCancel"/.test(html) && /<button id="confirmGo"/.test(html));
  check('index.html 结算面板含星级行 #finalStars 与 下一关/星图 按钮',
    /<div id="finalStars"/.test(html) &&
    /<button id="nextLevel"/.test(html) && /<button id="toStarMap"/.test(html));
  check('index.html 调试开关 #frostDebug 已移除（要求6）',
    !/frostDebug/.test(html));
  check('index.html 按序加载 campaign.js → save.js → game.js',
    (function () {
      var iC = html.indexOf('js/campaign.js'), iS = html.indexOf('js/save.js'),
        iG = html.indexOf('js/game.js');
      return iC >= 0 && iS > iC && iG > iS;
    })());

  /* ================ B. timer.js create(mode, limitSec) 扩展 ================ */
  check('Timer.create 无 limitSec 的旧行为不变：timed=120 / endless=null',
    T.create('timed').limitSec === 120 && T.create('endless').limitSec === null);
  check('Timer.create timed+limitSec 采用自定义时限',
    T.create('timed', 180).limitSec === 180 && T.create('timed', 480).limitSec === 480);
  check('Timer.create endless 忽略 limitSec（仍为 null）',
    T.create('endless', 180).limitSec === null);
  check('Timer.create 非法 limitSec 回退 120（0/-5/小数/NaN/字符串）',
    [0, -5, 2.5, NaN, '180', undefined].every(function (v) {
      return T.create('timed', v).limitSec === 120;
    }));
  check('Timer.create 未知 mode 仍回退 endless 且 limitSec=null',
    (function () { var st = T.create('weird', 180); return st.mode === 'endless' && st.limitSec === null; })());

  /* ================ C. game.js 接线 ================ */
  check('game.js 引入 Campaign/Save 模块别名',
    /Campaign\b[\s\S]{0,200}Save\b/.test(game.slice(0, 400)) ||
    (/CP\s*=/.test(game) && /SV\s*=/.test(game)));
  check('game.js 战役态 campaignIdx 以 null 初始化（默认自由模式）',
    /var campaignIdx = null/.test(game));
  check('buildBoard/layout 战役局按关卡表尺寸出牌',
    /function buildBoard\(\)[\s\S]{0,300}campaignIdx !== null[\s\S]{0,120}CP\.LEVELS\[campaignIdx\]/.test(game) &&
    /function layout\(\)[\s\S]{0,300}campaignIdx !== null[\s\S]{0,120}CP\.LEVELS\[campaignIdx\]/.test(game));
  check('enterCampaign 按关卡时限建表：TM.create(mode, lv.timeLimitSec)',
    /TM\.create\(mode, lv\.timeLimitSec > 0 \? lv\.timeLimitSec : undefined\)/.test(game));
  check('enterCampaign 装载前复位对局态并重建盘面（gen++/stopTimer/buildBoard）',
    /function enterCampaign\(i\)[\s\S]{0,400}gen\+\+[\s\S]{0,400}stopTimer\(\)[\s\S]{0,1500}buildBoard\(\)/.test(game));
  check('预冻落位：telegraph(过去时刻)→freeze 直链（无预警期立即冻结）',
    /lv\.frost\.forEach[\s\S]{0,400}FRZ\.telegraph[\s\S]{0,200}FRZ\.freeze/.test(game));
  check('巡猎者按关卡参数启动并走真实 tick 管线；无 hunter 置 null',
    /lv\.hunter[\s\S]{0,300}ENM\.create\(lv\.hunter\.cadenceMs, lv\.hunter\.telegraphMs/.test(game) &&
    /ENM\.tick\(enemyState, hn, hunterCtx\(\)\)/.test(game) &&
    /else \{\s*enemyState = null;/.test(game));
  check('win 分支：战役局经 settleCampaignWin 结算并短路自由模式结算',
    /function win\(\)[\s\S]{0,600}?settleCampaignWin\(\); return; \}/.test(game));
  check('lose 分支：战役局调用 settleCampaignLoss',
    /function lose\(\)[\s\S]{0,800}campaignIdx !== null\) settleCampaignLoss\(\)/.test(game));
  check('settleCampaignWin：starsFor 定星 + SV.recordResult + SV.save 存档后回写 campaignData',
    /function settleCampaignWin\(\)[\s\S]{0,600}CP\.starsFor\(lv\.parSec, used\)[\s\S]{0,300}var nextData = SV\.recordResult\(campaignData, idx, stars, score, used\);[\s\S]{0,120}SV\.save\(storageSafe\(\), nextData\);[\s\S]{0,120}campaignData = nextData;/.test(game));
  // 回归（issue #35 / PR #34 评审）：SV.save 返回布尔写盘状态，禁止赋值给数据变量
  check('回归：game.js 不得出现 `= SV.save(` / `= CampaignSave.save(` 赋值模式',
    !/=\s*SV\.save\(/.test(game) && !/=\s*CampaignSave\.save\(/.test(game));
  check('settleCampaignLoss 不写存档（函数体无 SV.save/recordResult）',
    (function () {
      var m = game.match(/function settleCampaignLoss\(\)[\s\S]*?\n  \}/);
      return !!m && !/SV\.(save|recordResult)/.test(m[0]);
    })());
  check('restart 退出战役回自由模式',
    /function restart\(\)[\s\S]{0,900}campaignIdx !== null\) exitCampaign\(\)/.test(game));
  check('星图渲染：锁定关节点 disabled + aria-label 状态；解锁判定用 CP.isUnlocked',
    /function renderStarMap\(\)[\s\S]{0,1200}CP\.isUnlocked\(i, campaignData\)[\s\S]{0,400}node\.disabled = true/.test(game));
  check('星图节点点击仅放行解锁关（复核 isUnlocked 后开确认弹窗）',
    /starmapGridEl\.addEventListener\('click'[\s\S]{0,500}CP\.isUnlocked\(i, campaignData\)[\s\S]{0,200}openLevelConfirm\(i\)/.test(game));
  check('确认弹窗 进入关卡 → enterCampaign；星图[返回游戏] → exitCampaign',
    /confirmGoBtn\.addEventListener\('click'[\s\S]{0,200}enterCampaign\(confirmIdx\)/.test(game) &&
    /starmapBack\.addEventListener\('click'[\s\S]{0,200}exitCampaign\(\)/.test(game));
  check('下一关按钮按 isUnlocked 前进；星图按钮退出战役后开图',
    /nextLevelBtn\.addEventListener\('click'[\s\S]{0,250}CP\.isUnlocked\(next, campaignData\)[\s\S]{0,120}enterCampaign\(next\)/.test(game) &&
    /toStarMapBtn\.addEventListener\('click'[\s\S]{0,200}exitCampaign\(\)[\s\S]{0,120}openStarMap\(\)/.test(game));
  check('战役期间禁用模式/难度/结算按钮（setCampaignControlsDisabled）',
    /function setCampaignControlsDisabled\(dis\)[\s\S]{0,600}btn\.disabled = dis/.test(game) &&
    /enterCampaign[\s\S]{0,600}setCampaignControlsDisabled\(true\)/.test(game) &&
    /exitCampaign[\s\S]{0,400}setCampaignControlsDisabled\(false\)/.test(game));
  check('自由模式结算面板隐藏战役元素（showResult 按 campaignIdx 复位）',
    /function showResult\([\s\S]{0,400}campaignIdx === null\)[\s\S]{0,300}finalStarsEl\.hidden = true[\s\S]{0,200}nextLevelBtn\.hidden = true/.test(game));
  check('HUD 时间标签：战役限时=剩余 / 无尽=用时',
    /function syncCampaignTimeUi\(\)[\s\S]{0,300}'剩余'[\s\S]{0,200}'用时'/.test(game));

  /* ================ D. css/style.css ================ */
  check('CSS：星图弹层 #starMap / #levelConfirm 默认隐藏 + .show 显示',
    /#starMap \{[\s\S]{0,300}visibility: hidden/.test(css) && /#starMap\.show \{/.test(css) &&
    /#levelConfirm \{[\s\S]{0,300}visibility: hidden/.test(css) && /#levelConfirm\.show \{/.test(css));
  check('CSS：.starmap-node 三态 unlocked / locked / current',
    /\.starmap-node\.unlocked/.test(css) && /\.starmap-node\.locked \{/.test(css) &&
    /\.starmap-node\.current \{/.test(css));
  check('CSS：结算星级 .final-stars(.show) 与 .fstar(.lit) 点亮态',
    /\.final-stars \{ display: none/.test(css) && /\.final-stars\.show \{/.test(css) &&
    /\.final-stars \.fstar\.lit \{/.test(css));
  check('CSS：星级规则文案样式 .starmap-rule + 确认警示 .confirm-warn',
    /\.starmap-rule \{/.test(css) && /\.confirm-warn \{/.test(css));
  check('CSS：prefers-reduced-motion 回退（current 呼吸/星级点亮动画关闭）',
    (function () {
      var m = css.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/);
      return !!m && /\.starmap-node\.current \{ animation: none/.test(m[0]) &&
        /\.final-stars \.fstar \{ transition: none/.test(m[0]);
    })());

  /* ================ E. 管线仿真（真实 Campaign/Save/Timer 模块） ================ */
  // E1 解锁链：初始仅第 1 关解锁；第 1 关胜利存档后第 2 关解锁
  var d0 = S.initialData();
  check('仿真E1a 初始存档仅第 1 关解锁',
    C.isUnlocked(0, d0) && !C.isUnlocked(1, d0));
  var mem = (function () {
    var store = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem: function (k, v) { store[k] = String(v); }
    };
  })();
  var dWin = S.save(mem, S.recordResult(d0, 0, 3, 500, 55)) ? S.load(mem) : null;
  check('仿真E1b 胜利存档（3★）落盘回读后下一关解锁、星数落档',
    !!dWin && C.isUnlocked(1, dWin) && dWin.levels['0'].stars === 3);
  // E2 失败不存档：recordResult 未调用则解锁链不前移（星图仍显旧进度）
  check('仿真E2 失败路径=不写存档，解锁链停留在已存档态',
    C.isUnlocked(1, dWin) && !C.isUnlocked(2, dWin));
  // E3 星级口径：≤par=3★，≤par×1.5=2★，慢于 1.5×par 通关仍 1★
  check('仿真E3 starsFor：55/60→3★ 80/60→2★ 95/60→1★ 120/60→1★',
    C.starsFor(60, 55) === 3 && C.starsFor(60, 80) === 2 &&
    C.starsFor(60, 95) === 1 && C.starsFor(60, 120) === 1);
  // E4 关卡时限 → Timer 口径：limit>0 走 timed(自定义限)，limit=0 走 endless(null)
  var lv1 = C.LEVELS[0], lv2 = C.LEVELS[1];
  check('仿真E4 关卡时限接 Timer：L1 无尽=null / L2 timed=180 / L10 timed=480',
    T.create('endless', lv1.timeLimitSec > 0 ? lv1.timeLimitSec : undefined).limitSec === null &&
    T.create('timed', lv2.timeLimitSec).limitSec === 180 &&
    T.create('timed', C.LEVELS[9].timeLimitSec).limitSec === 480);
  // E5 星图解锁指针：与 renderStarMap 相同的“首个未解锁索引 = current”口径
  var unlockedIdx = C.LEVELS.length;
  for (var u = 0; u < C.LEVELS.length; u++) {
    if (C.isUnlocked(u, dWin)) unlockedIdx = u;
  }
  check('仿真E5 星图 current 指针=首个未解锁关（存档过 L1 后指向第 2 关）',
    unlockedIdx === 1);

  /* ================ F. 测试注册 ================ */
  check('run-tests.js 注册 starmap-static-check',
    /starmap-static-check/.test(runner));

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
