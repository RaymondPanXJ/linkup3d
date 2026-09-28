/**
 * tests/read-utf8.js — 统一以 LF 行尾读取源文件（issue #55）
 * Windows core.autocrlf=true 检出会把工作区文件变成 CRLF，
 * 静态断言正则中的 \n 锚点（如 /\n  \}/）随之失配产生假阳性。
 * 所有静态断言的文件读取一律经过本 helper 归一后再比较。
 */
var fs = require('fs');

function readUtf8(p) {
  return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
}

module.exports = readUtf8;
