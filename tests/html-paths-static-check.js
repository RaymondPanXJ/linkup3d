#!/usr/bin/env node
/**
 * tests/html-paths-static-check.js — 仓库根 html 引用路径的静态断言
 *
 * 背景（findings-next §② 浏览器实测）：tests.html 曾以 `src="tests.define.js"`
 * 引用测试定义（相对仓库根解析为 /tests.define.js → 404），浏览器打开
 * tests.html 永远停在「运行中…」；`src="../js/link3d.js"` 与回链
 * `href="../index.html"` 同样越出仓库根，挂在任何子路径下都会断链。
 *
 * 断言口径：仓库根 index.html / tests.html 中所有本地 src/href 引用，
 * 一律以所在文件目录（仓库根）解析，且解析结果必须落在仓库内且磁盘存在。
 * 带 ?v= 缓存参数的引用先剥参数再查文件（issue #52 缓存击穿机制兼容）。
 *
 * 运行：node tests/run-tests.js 或单独 node tests/html-paths-static-check.js
 */
var fs = require('fs');
var path = require('path');
var readUtf8 = require('./read-utf8.js');

/* 提取属性值为真实路径的 src/href 引用：跳过 data:/#/外部URL/模板占位 */
function localRefs(html) {
  var refs = [];
  var re = /(?:src|href)="([^"]+)"/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    var v = m[1];
    if (!v || v.charAt(0) === '#') continue;
    if (/^(data:|https?:|\/\/)/.test(v)) continue;
    if (v.indexOf('${') >= 0) continue;
    refs.push(v);
  }
  return refs;
}

function runChecks() {
  var root = path.join(__dirname, '..');
  var results = [];
  function check(name, cond, detail) {
    results.push({ name: name, pass: !!cond, detail: detail || (cond ? 'ok' : 'FAILED') });
  }

  ['index.html', 'tests.html'].forEach(function (f) {
    var html = readUtf8(path.join(root, f));
    var bad = [];
    localRefs(html).forEach(function (ref) {
      var clean = ref.split('?')[0].split('#')[0];
      if (!clean) return;
      var abs = path.resolve(root, clean);
      var rel = path.relative(root, abs);
      if (rel === '' || rel.charAt(0) === '.' || rel.indexOf('..' + path.sep) === 0 || path.isAbsolute(rel)) {
        bad.push(ref + '（越出仓库根）');
      } else if (!fs.existsSync(abs)) {
        bad.push(ref + '（磁盘不存在）');
      }
    });
    check(f + ' 全部本地 src/href 以仓库根可解析且磁盘存在',
      bad.length === 0, bad.length ? '断链: ' + bad.join(', ') : 'ok');
  });

  /* tests.html 浏览器套件三处关键路径逐字锁死（防再次漂回 ../ 或裸文件名） */
  var t = readUtf8(path.join(root, 'tests.html'));
  check('tests.html 回链为 index.html（非 ../index.html）',
    /href="index\.html"/.test(t) && !/\.\.\/index\.html/.test(t));
  check('tests.html 加载 js/link3d.js（非 ../js/）',
    /src="js\/link3d\.js"/.test(t) && !/\.\.\/js\/link3d\.js/.test(t));
  check('tests.html 加载 tests/tests.define.js（非裸 tests.define.js）',
    /src="tests\/tests\.define\.js"/.test(t) && !/src="tests\.define\.js"/.test(t));

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
