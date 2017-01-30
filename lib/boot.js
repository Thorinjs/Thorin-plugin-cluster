'use strict';
/**
 * Boots up the cluster, by registering to the discovery system
 * and connecting to all the clients
 */
const SCONFIG_REGISTRY_QUERY = 'https://api.sconfig.io/discovery',
  SCONFIG_DISCOVERY = 'https://discovery.sconfig.io/dispatch';
const url = require('url');
module.exports = (thorin, opt, pluginObj) => {
  const async = thorin.util.async,
    logger = thorin.logger(opt.logger);

  /* Boot up the plugin on run */
  pluginObj.run = (next) => {
    let calls = [];

    if (!opt.token) {
      if (typeof process.env.DISCOVERY_KEY === 'string') {
        opt.token = process.env.DISCOVERY_KEY;
      } else if (typeof process.env.DISCOVERY_TOKEN === 'string') {
        opt.token = process.env.DISCOVERY_TOKEN;
      } else if(typeof process.env.SCONFIG_KEY === 'string') {
        opt.token = process.env.SCONFIG_KEY;
      }
    }
    // CHECK if we have a SCONFIG_URL set in environment
    if (typeof process.env.SCONFIG_URL === 'string') {
      try {
        let tmp = url.parse(process.env.SCONFIG_URL);
        tmp.pathname = '/dispatch';
        tmp = url.format(tmp, false);
        opt.gateway = tmp;
      } catch (e) {
      }
    }

    /* Start the incoming server */
    calls.push((done) => {
      pluginObj.registerTransport(done);
    });

    /* Check if we're integrated with sconfig */
    calls.push((done) => {
      if (opt.token) return done();
      if (opt.gateway !== SCONFIG_DISCOVERY) return done();  // custom gateway.
      let sconfigKey = thorin.config.getSconfigKey();
      if (!sconfigKey) return done();
      // strip the private part out.
      sconfigKey = sconfigKey.split('.')[0];
      // try and fetch the discovery key from sconfig registry.
      logger.trace(`Fetching discovery token from sconfig.io`);
      thorin
        .fetcher(SCONFIG_REGISTRY_QUERY, {
          timeout: 3000,
          authorization: sconfigKey,
          method: 'GET'
        })
        .dispatch('discovery.token')
        .then((r) => {
          opt.token = r.result.token;
          done();
        })
        .catch((e) => {
          logger.warn(`Could not fetch discovery token from sconfig: ${e.code}`);
          logger.trace(e);
          done(e);
        });
    });

    /* check that the token works. */
    calls.push((done) => {
      if (!opt.token) {
        logger.warn(`No discovery token found in configuration.`);
        return done(thorin.error('CLUSTER.TOKEN', 'No valid discovery token available.'));
      }
      if (opt.token.indexOf('-') === -1) {
        opt.token = thorin.env + '-' + opt.token;
      }
      pluginObj.refresh(done);
    });

    calls.push((done) => {
      pluginObj.start();
      done();
    });


    async.series(calls, (e) => {
      if (e) {
        logger.warn(`Could not boot up cluster plugin`);
        return next(e);
      }
      next();
    });

  };

};