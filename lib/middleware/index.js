'use strict';
/**
 * Created by Adrian on 30-Sep-16.
 */
module.exports = (thorin, opt, pluginObj) => {
  const files = thorin.util.readDirectory(__dirname, { relative: true });
  for(let i=0; i < files.length; i++) {
    if(files[i].indexOf('index') !== -1) continue;
    require('./' + files[i])(thorin, opt, pluginObj);
  }
};