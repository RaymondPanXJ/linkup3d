/* js/mobile.js —— 移动端适配辅助（issue #14）：纯函数，可在 node 下单测 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Link3DMobile = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // 视口宽度是否属于窄屏（360px 断点族）
  function isNarrowViewport(width) {
    return typeof width === 'number' && width <= 420;
  }

  // 窄屏下场景不做 scale 收缩（保证触摸热区与最小牌宽），其余按 fit 比例钳制到 (0,1]
  function sceneScale(width, fit) {
    if (isNarrowViewport(width)) return 1;
    if (!(typeof fit === 'number') || isNaN(fit)) return 1;
    return Math.max(0.1, Math.min(1, fit));
  }

  return {
    isNarrowViewport: isNarrowViewport,
    sceneScale: sceneScale
  };
});
