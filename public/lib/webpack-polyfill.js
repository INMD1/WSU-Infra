/**
 * Webpack Polyfill for wmks.js
 * Provides __webpack_require__.n() helper for named exports
 */
(function() {
  if (typeof __webpack_require__ === 'undefined') {
    window.__webpack_require__ = {};
  }

  // Polyfill for __webpack_require__.n() - named exports helper
  // https://webpack.js.org/guides/dependency-management/#exports-exposed-by-a-module
  if (typeof __webpack_require__.n === 'undefined') {
    __webpack_require__.n = function(m) {
      var getter = m && m.__esModule ?
        function getDefault() { return m.default; } :
        function getModuleExports() { return m; };
      Object.defineProperty(getter, 'esModule', { value: true });
      return getter;
    };
  }

  // Polyfill for __webpack_require__.d() - define exports helper
  if (typeof __webpack_require__.d === 'undefined') {
    __webpack_require__.d = function(exports, value) {
      for (var key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          var desc = Object.getOwnPropertyDescriptor(value, key);
          if (desc && (desc.get || desc.set)) {
            Object.defineProperty(exports, key, desc);
          } else {
            exports[key] = value[key];
          }
        }
      }
    };
  }

  console.log('[webpack-polyfill] Webpack helpers polyfilled');
})();
