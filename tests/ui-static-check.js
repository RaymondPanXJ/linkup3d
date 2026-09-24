#!/usr/bin/env node
/**
 * tests/ui-static-check.js — 无浏览器环境下的 UI 集成静态断言
 * 验证难度选择器在 index.html / css/style.css / js/game.js 三端的接线一致性，
 * 以及响应式样式与图案池容量等「不破版」前置条件。
 *
 * 既可作为模块被 run-tests.js 调用（runChecks() 返回结果数组），
 * 也可单独运行：node tests/ui-static-check.js
 */
var fs = require('fs');
var path = require('path');

function runChecks() {
var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
var css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');
var game = fs.readFileSync(path.join(root, 'js', 'game.js'), 'utf8');
var link3d = fs.readFileSync(path.join(root, 'js', 'link3d.js'), 'utf8');

var results = [];
function check(name, cond, detail) {
  results.push({ name: name, pass: !!cond, detail: detail || (cond ? 'ok' : 'FAILED') });
}

/* 1. index.html：难度选择器存在，三档按钮 data-key 齐全 */
var dataKeys = [];
var btnRe = /<button[^>]*class="diff-btn"[^>]*data-key="(\w+)"[^>]*>([^<]*)<\/button>/g;
var m;
while ((m = btnRe.exec(html)) !== null) dataKeys.push(m[1]);
check('HTML 难度按钮 = easy/normal/hard 各一',
  dataKeys.slice().sort().join(',') === 'easy,hard,normal',
  'data-keys=' + dataKeys.join(','));
check('HTML 按钮文案含尺寸标注 (4×4/4×6/6×8)',
  /4×4/.test(html) && /4×6/.test(html) && /6×8/.test(html));
check('HTML 选择器有可访问性标注 (role=group + aria-label)',
  /id="difficulty"[^>]*role="group"/.test(html) && /aria-label="难度选择"/.test(html));

/* 2. game.js：DIFFICULTIES 与 issue 要求一致，且与 HTML data-key 一一对应 */
var diffBlock = game.match(/var DIFFICULTIES = \{([\s\S]*?)\};/);
check('game.js 定义 DIFFICULTIES', !!diffBlock);
function dimsOf(key) {
  if (!diffBlock) return null;
  var re = new RegExp(key + '\\s*:\\s*\\{\\s*rows:\\s*(\\d+),\\s*cols:\\s*(\\d+)\\s*\\}');
  var d = diffBlock[1].match(re);
  return d ? { rows: +d[1], cols: +d[2] } : null;
}
check('难度尺寸：easy 4×4 / normal 4×6 / hard 6×8',
  JSON.stringify(dimsOf('easy')) === '{"rows":4,"cols":4}' &&
  JSON.stringify(dimsOf('normal')) === '{"rows":4,"cols":6}' &&
  JSON.stringify(dimsOf('hard')) === '{"rows":6,"cols":8}');
var gameKeys = diffBlock
  ? (diffBlock[1].match(/\b(easy|normal|hard)\s*:/g) || [])
      .map(function (s) { return s.split(':')[0].trim(); }).sort()
  : [];
check('game.js 难度键与 HTML data-key 一致',
  JSON.stringify(gameKeys) === JSON.stringify(dataKeys.slice().sort()),
  'game=' + gameKeys.join(',') + ' html=' + dataKeys.slice().sort().join(','));

/* 3. localStorage 持久化：读取 + 写入使用同一 key，且有异常保护 */
var keyMatch = game.match(/var DIFF_KEY = '([^']+)'/);
check('localStorage key 常量存在', !!keyMatch, keyMatch && keyMatch[1]);
check('localStorage 读取难度（getItem(DIFF_KEY) + try/catch 保护）',
  /localStorage\.getItem\(DIFF_KEY\)/.test(game) &&
  /try \{[\s\S]{0,80}getItem\(DIFF_KEY\)[\s\S]{0,80}catch/.test(game));
check('localStorage 写入难度（setItem(DIFF_KEY) + try/catch 保护）',
  /localStorage\.setItem\(DIFF_KEY, difficulty\)/.test(game));
check('非法/缺失存档回退默认 normal',
  /DIFFICULTIES\[key\] \? key : 'normal'/.test(game));

/* 4. 游戏逻辑接线：建盘/布局按当前尺寸，点击难度重开一局 */
check('buildBoard 按当前难度发牌 dealGrid(ROWS, COLS)',
  /function buildBoard\(\)[\s\S]{0,200}currentDims\(\)[\s\S]{0,200}L\.dealGrid\(ROWS, COLS\)/.test(game));
check('layout 按当前难度计算响应式尺寸',
  /function layout\(\)[\s\S]{0,120}currentDims\(\)/.test(game));
check('game.js 不再引用模块级 L.ROWS/L.COLS 常量',
  !/L\.ROWS|L\.COLS/.test(game));
check('点击难度：存档 → 重绘选中态 → restart',
  /difficulty = btn\.dataset\.key;[\s\S]{0,120}setItem\(DIFF_KEY[\s\S]{0,120}renderDifficulty\(\);[\s\S]{0,60}restart\(\);/.test(game));
check('初始化先 renderDifficulty 再 restart（保留上次选择生效）',
  /renderDifficulty\(\);\s*\n\s*restart\(\);/.test(game));

/* 5. 图案池覆盖最大难度对数（6×8 = 24 对） */
var emojiArr = game.match(/var EMOJIS = \[([\s\S]*?)\];/);
var emojiCount = emojiArr
  ? (emojiArr[1].match(/'[^']+'/g) || []).length : 0;
var uniqCount = emojiArr
  ? new Set(emojiArr[1].match(/'[^']+'/g) || []).size : 0;
check('EMOJIS 池 ≥ 24 且无重复（覆盖困难 24 对）',
  emojiCount >= 24 && uniqCount === emojiCount,
  '总数=' + emojiCount + ' 去重=' + uniqCount);

/* 6. link3d.js 默认尺寸 = 标准档，与 game.js normal 一致 */
var L = require(path.join(root, 'js', 'link3d.js'));
check('link3d 兼容常量 ROWS=4 COLS=6 与 normal 档一致',
  L.ROWS === dimsOf('normal').rows && L.COLS === dimsOf('normal').cols);
check('无参 dealGrid() 仍为 4×6 满盘 24 张（旧行为不变）',
  (function () {
    var g = L.dealGrid();
    return L.gridSize(g).rows === 4 && L.gridSize(g).cols === 6 && L.countTiles(g) === 24;
  })());

/* 7. CSS：选择器样式存在、激活态样式、移动端响应式覆盖 */
check('CSS 含 .difficulty / .diff-btn / .diff-btn.active',
  /\.difficulty\s*\{/.test(css) && /\.diff-btn\s*\{/.test(css) &&
  /\.diff-btn\.active\s*\{/.test(css));
check('CSS 移动端 media query 收紧难度按钮（防破版）',
  (function () {
    var mq = css.match(/@media[^{]*\{([\s\S]*)$/);
    return mq && /\.diff-btn\s*\{[^}]*font-size/.test(mq[1]) &&
                /\.hud\s*\{[^}]*gap/.test(mq[1]);
  })());
check('HTML HUD 结构完整（难度组位于 stats 与 restart 之间）',
  (function () {
    var i1 = html.indexOf('id="difficulty"');
    var i2 = html.indexOf('id="restart"');
    return i1 > 0 && i2 > i1;
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
  console.log(pass + '/' + results.length + ' UI static checks passed');
  process.exit(pass === results.length ? 0 : 1);
}
