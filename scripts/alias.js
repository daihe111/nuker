const path = require('path');
const resolve = p => path.resolve(__dirname, '../', p);

module.exports = {
  compiler: resolve('src/compiler'),
  core: resolve('src/core'),
  shared: resolve('src/shared'),
  web: resolve('src/platforms/web'),
  server: resolve('src/server'),
  sfc: resolve('src/sfc')
};
