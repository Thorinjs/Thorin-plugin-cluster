'use strict';
/**
 * Raw Websocket Cluster communication with sconfig discovery.
 */
const initMiddleware = require('./lib/middleware/index'),
  initCluster = require('./lib/cluster'),
  initAction = require('./lib/clusterAction'),
  initBoot = require('./lib/boot');
module.exports = function (thorin, opt, pluginName) {
  opt = thorin.util.extend({
    logger: pluginName || 'cluster',
    debug: {
      request: true,
      connect: false
    },
    gateway: 'https://discovery.sconfig.io/dispatch', // the discovery server
    timeout: 5000,        // the default timeout between service calls.
    token: null,          // the shared security token
    interval: 10000,       // the interval in ms between registry calls
    service: {            // service information
      type: thorin.app,   // the microservice kind
      name: thorin.id,    // the microservice name
      proto: 'ws',        // the proto that will be used for communication
      ttl: 20000,         // the default TTL for this node.
      tags: [],           // additional node tags.
      host: 'internal',   // the host to use for inter-communication. See thorin.getIp()
      port: 6501          // the port to use for incoming RPC
    }
  }, opt);
  opt.service.host = thorin.getIp(opt.service.host);
  const pluginObj = initCluster(thorin, opt);
  initMiddleware(thorin, opt, pluginObj);
  initBoot(thorin, opt, pluginObj);
  initAction(thorin, opt, pluginObj);
  return pluginObj;
};
module.exports.publicName = 'cluster';