'use strict';
/**
 * The emitter middleware will essentially
 * try and execute a RPC once the
 * current intent is completed (success/error)
 */
module.exports = (thorin, opt, pluginObj) => {
  const logger = thorin.logger(opt.logger),
    dispatcher = thorin.dispatcher;
  let chainId = 0;
  /*
   * Registers the middleware that will emit
   * the action name to the cluster server, via publishing
   * */
  dispatcher
    .addMiddleware('cluster#chain')
    .use((intentObj, next, opt) => {
      opt = Object.assign({}, {
        service: null,
        action: null,
        result: false,
        payload: null,  // if set to function, we call it with intentObj and use the returned object as payload.
        input: true
      }, opt);
      if(!intentObj.__chainIds) intentObj.__chainIds = [];
      intentObj.__chainIds.push(chainId);
      intentObj.data(`__clusterChain${chainId}`, opt);
      chainId++;
      next();
    })
    .end((intentObj) => {
      if (intentObj.hasError() || !intentObj.__chainIds) return;
      for(let i=0; i < intentObj.__chainIds.length; i++) {
        doChain(intentObj, intentObj.__chainIds[i]);
      }
      delete intentObj.__chainIds;
    });

  function doChain(intentObj, chainId) {
    let opt = intentObj.data(`__clusterChain${chainId}`),
      data;
    if (!opt) return;
    if (!opt.service || !opt.action) {
      logger.warn(`Chain: for action ${intentObj.action} does not have a valid target service/action`);
      return;
    }
    if (typeof opt.payload === 'object' && opt.payload) {
      data = opt.payload;
    } else if(typeof opt.payload === 'function') {
      try {
        data = opt.payload(intentObj);
      } catch(e) {
        logger.warn(`Chain: for action ${intentObj.action} could not call the payload() function.`);
        logger.trace(e);
        return;
      }
      if(typeof data === 'undefined' || data === false) return;  // when false, we ignore payload.
    } else {
      if (opt.input === true && opt.result === false) {
        data = intentObj.input();
      } else if (opt.input === false && opt.result === true) {
        data = intentObj.result();
      } else {
        data = {};
        if (opt.input) {
          data.input = intentObj.input();
        }
        if (opt.result) data.result = intentObj.result();
      }
    }
    pluginObj
      .dispatch(opt.service, opt.action, data)
      .catch((e) => {
        if(thorin.env === 'development') return;
        logger.warn(`Chain: failed to trigger ${opt.action} to service ${opt.service}`);
        logger.debug(e);
      });
  }
};