'use strict';
/**
 * Raw Websocket Cluster communication with sconfig discovery.
 */
const initMiddleware = require('./lib/middleware/index'),
  initCluster = require('./lib/cluster'),
  initAction = require('./lib/clusterAction'),
  initBoot = require('./lib/boot');
const MIN_RAND_PORT = 40000,
  MAX_RAND_PORT = 50000;
module.exports = function (thorin, opt, pluginName) {
  opt = thorin.util.extend({
    logger: pluginName || 'cluster',
    debug: {
      request: true,
      connect: false
    },
    gateway: 'https://discovery.sconfig.io/dispatch', // the discovery server
    timeout: 20000,        // the default timeout between service calls.
    token: null,          // the shared security token
    interval: 8000,       // the interval in ms between registry calls
    service: {            // service information
      type: thorin.app,   // the microservice kind
      name: thorin.id,    // the microservice name
      proto: 'ws',        // the proto that will be used for communication
      ttl: 10000,         // the default TTL for this node.
      tags: [],           // additional node tags.
      host: 'internal',   // the host to use for inter-communication. See thorin.getIp()
      port: 6501          // the port to use for incoming RPC. IF set to null, we will choose a random port between 40000-50000
    }
  }, opt);
  if(opt.service) {
    if(opt.service.host) opt.service.host = thorin.getIp(opt.service.host);
    if(opt.service.port == null) {
      let randPort = Math.floor(Math.random() * (MAX_RAND_PORT - MIN_RAND_PORT) + MIN_RAND_PORT);
      opt.service.port = randPort;
    }
  }

  const pluginObj = initCluster(thorin, opt);
  initMiddleware(thorin, opt, pluginObj);
  initBoot(thorin, opt, pluginObj);
  initAction(thorin, opt, pluginObj);
  return pluginObj;
};
module.exports.publicName = 'cluster';