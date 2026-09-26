#!/usr/bin/env node
/**
 * tests/frost-wiring-static-check.js — 冻冰/巡猎者主循环接线（issue #31, T4）
 * 无浏览器环境的静态断言 + 纯函数管线仿真：
 *   A. index.html：frost.js/enemy.js 脚本按序加载、调试开关按钮存在；
 *   B. js/game.js：模块别名、点击/匹配守卫、消除联动、tick 心跳、restart 复位、音效；
 *   C. css/style.css：三态类名齐备 + prefers-reduced-motion 回退；
 *   D. 管线仿真：用真实 Frost/Enemy 模块复现接线的事件流（telegraph→freeze、
 *      上限 skip、消除解冻、isBoardSolvable 口径），验证 T4 接线的状态机口径与两个模块
 *      的 API 契约一致。模式沿用 T1/T2/T3 静态断言。
 *
 * 运行：node tests/run-tests.js 或单独 node tests/frost-wiring-static-check.js
 */
var fs = require('fs');
var path = require('path');

function runChecks() {
  var root = path.join(__dirname, '..');
  var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  var css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');
  var game = fs.readFileSync(path.join(root, 'js', 'game.js'), 'utf8');
  var runner = fs.readFileSync(path.join(root, 'tests', 'run-tests.js'), 'utf8');
  var F = require('../js/frost.js');
  var E = require('../js/enemy.js');
  var L = require('../js/link3d.js');

  var results = [];
  function check(name, cond, detail) {
    results.push({ name: name, pass: !!cond, detail: detail || (cond ? 'ok' : 'FAILED') });
  }

  /* ================ A. index.html 资源加载 ================ */
  var scriptSrcs = (html.match(/<script src="([^"]+)"><\/script>/g) || [])
    .map(function (s) { return s.match(/src="([^"]+)"/)[1]; });
  var iFrost = scriptSrcs.indexOf('js/frost.js');
  var iEnemy = scriptSrcs.indexOf('js/enemy.js');
  var iGame = scriptSrcs.indexOf('js/game.js');
  check('index.html 按序加载 frost.js → enemy.js → game.js',
    iFrost >= 0 && iEnemy > iFrost && iGame > iEnemy,
    'frost=' + iFrost + ' enemy=' + iEnemy + ' game=' + iGame);
  check('index.html 调试开关按钮 #frostDebug 已按 T5（issue #33 要求6）移除',
    !/<button id="frostDebug"/.test(html));

  /* ================ B. game.js 接线 ================ */
  check('game.js 引入 Frost/Enemy 模块别名',
    /window\.Frost/.test(game) && /window\.Enemy/.test(game));
  check('点击守卫：onTileClick 经 Frost.canSelect 拦截冻结格',
    /function onTileClick\([\s\S]{0,600}FRZ\.canSelect\(frostState, r, c\)/.test(game));
  check('匹配守卫：连通判定前经 Frost.canMatch 把关端点',
    /FRZ\.canMatch\(frostState, a\.r, a\.c, b\.r, b\.c\)[\s\S]{0,200}L\.findPath\(grid, a, b\)/.test(game));
  check('消除联动：eliminate 内调用 Frost.thawAround（规则2 邻格解冻）',
    /function eliminate\([\s\S]{0,1500}FRZ\.thawAround\(frostState, a\.r, a\.c, b\.r, b\.c\)/.test(game));
  check('敌人联动：消除预警目标 → Enemy.cancelTarget',
    /function eliminate\([\s\S]{0,1500}ENM\.cancelTarget\(enemyState/.test(game));
  check('心跳驱动：Enemy.tick 由 setInterval 轮询（沿用 onTimerTick 模式，无 rAF）',
    /ENM\.tick\(enemyState, now, hunterCtx\(\)\)/.test(game) &&
    /setInterval\(onHunterTick, \d+\)/.test(game) &&
    !/requestAnimationFrame/.test(game));
  check('事件接线：telegraph/freeze/cancel/skip 四类事件均有处理分支',
    /ev\.type === 'telegraph'/.test(game) && /ev\.type === 'freeze'/.test(game) &&
    /ev\.type === 'cancel'/.test(game) && /'skip'/.test(game));
  check('Frost 兜底口径：telegraph 事件调用 FRZ.telegraph、freeze 事件读 out.applied',
    /FRZ\.telegraph\(frostState, ev\.r, ev\.c, now, HUNTER_TELEGRAPH_MS\)/.test(game) &&
    /FRZ\.freeze\(frostState, ev\.r, ev\.c, now\)/.test(game) &&
    /out\.applied/.test(game));
  check('取舍记录：freeze 分支不做可解性回滚（issue #31 要求5，T6 验证），注释在位',
    /取舍记录（issue #31 要求5）/.test(game));
  check('ctx.canFreeze 按 Frost 上限口径注入（countFrozen < MAX_FROZEN）',
    /FRZ\.countFrozen\(frostState\) < FRZ\.MAX_FROZEN/.test(game));
  check('restart 复位冻冰/敌人状态（frostState = FRZ.create()）',
    /function restart\(\)[\s\S]{0,600}frostState = FRZ\.create\(\)/.test(game));
  // issue #39 裁决1 推翻原「frostState 原样保留」口径：洗牌全场解冻（保底不看冰冻，
  // 冻结封锁点位会使「洗牌后必有解」失效）。断言改为洗牌路径重置冻结并清三态类。
  check('洗牌全场解冻（issue #39 裁决1）：doShuffle 重置 frostState 并清 frozen/warn 类 + toast',
    /function doShuffle\(\)[\s\S]{0,400}frostState = FRZ\.create\(\)/.test(game) &&
    /function doShuffle\(\)[\s\S]{0,600}classList\.remove\('tile-frozen'\)/.test(game) &&
    /function doShuffle\(\)[\s\S]{0,600}classList\.remove\('tile-frost-warn'\)/.test(game) &&
    /function doShuffle\(\)[\s\S]{0,600}showToast\('搅动星尘,寒冰消融'\)/.test(game) &&
    /function doShuffle\(\)[\s\S]{0,800}shuffleGrid\(grid\)/.test(game));
  check('音效接线：freeze/thaw/warn 三个新声部存在且在事件分支触发',
    /freeze: function/.test(game) && /thaw: function/.test(game) && /warn: function/.test(game) &&
    /SFX\.freeze\(\)/.test(game) && /SFX\.thaw\(\)/.test(game) && /SFX\.warn\(\)/.test(game));
  check('预警音效节流：每秒至多一次（isThreatening + 1000ms 阈值）',
    /ENM\.isThreatening\(enemyState, now\)[\s\S]{0,80}1000/.test(game));

  /* ================ C. css/style.css 三态类名 ================ */
  check('CSS：冰冻覆盖 .tile-frozen', /\.tile-slot\.tile-frozen/.test(css));
  check('CSS：预警红晕 .tile-frost-warn + 呼吸动画 frostwarn',
    /\.tile-slot\.tile-frost-warn/.test(css) && /@keyframes frostwarn/.test(css));
  check('CSS：解冻碎裂 .tile-thawing + 动画',
    /\.tile-slot\.tile-thawing/.test(css) && /@keyframes thawburst/.test(css));
  var rm = css.match(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\n\}/);
  check('CSS：prefers-reduced-motion 回退（关动画，仅静态 tint/描边）',
    !!rm && /tile-frost-warn/.test(rm[0]) && /animation: none/.test(rm[0]));

  /* ================ D. 纯函数管线仿真（真实 Frost + Enemy 模块） ================ */
  // 复现 game.js 接线逻辑的最小状态机：验证事件流/状态迁移与两个模块契约吻合。
  function makeCtx(frostState, tiles) {
    var frozen = {};
    F.frozenList(frostState).forEach(function (p) {
      frozen[p.r + ',' + p.c] = true;
      delete tiles[p.r + ',' + p.c];
    });
    return {
      tiles: tiles, frozen: frozen,
      canFreeze: F.countFrozen(frostState) < F.MAX_FROZEN,
      rng: function () { return 0; }
    };
  }

  // D1: telegraph → 预警期满 freeze applied=true，Frost 生效（两段式管线）
  var fs1 = F.create();
  var es1 = E.create(1000, 500, 0);
  var tiles1 = { '1,1': true, '1,2': true, '2,1': true, '2,2': true };
  var r1 = E.tick(es1, 1000, makeCtx(fs1, tiles1));
  check('仿真D1a tick 到点发出 telegraph 事件（r,c 升序首格 1,1）',
    r1.events.length === 1 && r1.events[0].type === 'telegraph' &&
    r1.events[0].r === 1 && r1.events[0].c === 1);
  fs1 = F.telegraph(fs1, r1.events[0].r, r1.events[0].c, 1000, 500);
  check('仿真D1b 预警期内牌照常可选（telegraph 不冻结）',
    F.canSelect(fs1, 1, 1) && F.isTelegraphActive(fs1, 1, 1, 1400));
  var r2 = E.tick(r1.state, 1400, makeCtx(fs1, tiles1));
  check('仿真D1c 预警未期满 tick 无事件', r2.events.length === 0);
  var r3 = E.tick(r2.state, 1500, makeCtx(fs1, tiles1));
  check('仿真D1d 期满 tick 发出 freeze 事件', r3.events.length === 1 && r3.events[0].type === 'freeze');
  var out3 = F.freeze(fs1, r3.events[0].r, r3.events[0].c, 1500);
  check('仿真D1e 接线按 out.applied 落地：冻结生效且可选性反转',
    out3.applied === true && !F.canSelect(out3.state, 1, 1) &&
    !F.canMatch(out3.state, 1, 1, 1, 2));
  fs1 = out3.state;

  // D2: 规则2 解冻通道——消除 (1,2)+(2,2)... 需同类可连对，这里直接验证 thawAround 坐标口径
  var thawed = F.thawAround(fs1, 1, 2, 2, 1); // (1,1) 与 (1,2)/(2,1) 正交相邻
  check('仿真D2 消除邻格解冻：(1,1) 解除，非邻格保留',
    F.canSelect(thawed, 1, 1) && F.countFrozen(thawed) === 0);

  // D3: 上限 4 —— 4 格冻结后 canFreeze=false → tick 返回 skip(frozen-cap)
  var fs3 = F.create();
  var capKeys = ['1,1', '1,2', '2,1', '2,2'];
  for (var i = 0; i < capKeys.length; i++) {
    var pp = capKeys[i].split(',');
    fs3 = F.freeze(F.telegraph(fs3, +pp[0], +pp[1], 0, 10), +pp[0], +pp[1], 10).state;
  }
  check('仿真D3a Frost.MAX_FROZEN 上限生效：countFrozen === 4', F.countFrozen(fs3) === 4);
  var es3 = E.create(1000, 500, 0);
  var r3b = E.tick(es3, 1000, makeCtx(fs3, { '1,1': true, '1,2': true }));
  check('仿真D3b 达上限接线 ctx.canFreeze=false → skip(frozen-cap) 不选目标',
    r3b.events.length === 1 && r3b.events[0].type === 'skip' &&
    r3b.events[0].reason === 'frozen-cap');

  // D4: isBoardSolvable 口径侧证（本单接线不启用回滚，issue #31 要求5；T6 备用）——
  // 3×4 内容盘（扩展网格 5×6）：值1/2/3 各一对分居两侧列；
  // 冻结左列 3 格（≤ MAX_FROZEN）后每对都缺一个可选端点 → 不可解。
  var grid4 = [
    [0, 0, 0, 0, 0, 0],
    [0, 1, 0, 0, 1, 0],
    [0, 2, 0, 0, 2, 0],
    [0, 3, 0, 0, 3, 0],
    [0, 0, 0, 0, 0, 0]
  ];
  var plain = F.create();
  check('仿真D4a 前置：未冻结盘可解', F.isBoardSolvable(plain, grid4, L));
  var fs4 = F.create();
  var becameUnsolvable = false;
  var seq = [[1, 1], [2, 1], [3, 1]]; // 内容 1-based 左列：逐对封死一个端点
  for (var j = 0; j < seq.length && !becameUnsolvable; j++) {
    var o = F.freeze(F.telegraph(fs4, seq[j][0], seq[j][1], 0, 10), seq[j][0], seq[j][1], 10);
    if (!o.applied) break;
    fs4 = o.state;
    if (!F.isBoardSolvable(fs4, grid4, L)) becameUnsolvable = true;
  }
  check('仿真D4b isBoardSolvable 可判不可解且冻结前状态恢复可选（T6 回滚口径备用）',
    becameUnsolvable && F.canSelect(plain, 1, 1) && F.canMatch(plain, 1, 1, 1, 4));

  // D5: 预警期消除目标 → cancelTarget 后 tick 不再发 freeze
  var fs5 = F.create();
  var es5 = E.create(1000, 500, 0);
  var t5 = { '1,1': true, '1,2': true };
  var rr = E.tick(es5, 1000, makeCtx(fs5, t5));
  fs5 = F.telegraph(fs5, rr.events[0].r, rr.events[0].c, 1000, 500);
  var cancelled = E.cancelTarget(rr.state, 1, 1);
  delete t5['1,1']; // 玩家消除了目标格
  var rf = E.tick(cancelled, 1500, makeCtx(fs5, t5));
  check('仿真D5 cancelTarget 后原目标不再收到 freeze 事件',
    rf.events.every(function (e) { return !(e.type === 'freeze' && e.r === 1 && e.c === 1); }));

  /* ================ E. 测试注册 ================ */
  check('run-tests.js 注册 frost-wiring-static-check',
    /frost-wiring-static-check/.test(runner));

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
