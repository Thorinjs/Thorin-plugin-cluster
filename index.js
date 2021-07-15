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
    heartbeat: 20000,
    token: null,          // the shared security token
    interval: 8000,       // the interval in ms between registry calls
    delay: 0,                               // the number of milliseconds to delay the initial registration. Default disabled.
    versioned: false,     // if set to true, dispatching will keep count of the acive versioned items.
    service: {            // service information
      type: thorin.app,   // the microservice kind
      name: thorin.id,    // the microservice name
      proto: 'ws',        // the proto that will be used for communication
      version: null,                          // The numeric version of the current application version. This is to roll out older version versions of the app, so that we have zero-downtime upgrades
      // IF this variable is not set, we look into process.env.APP_VERSION and if it is a number, we use it.
      ttl: 10000,         // the default TTL for this node.
      tags: [],           // additional node tags.
      host: 'internal',   // the host to use for inter-communication. See thorin.getIp()
      port: 6501          // the port to use for incoming RPC. IF set to null, we will choose a random port between 40000-50000
    },
    alias: {  // aliases for services. (eg: service-name.namespace : https://api.myservice.com
    },
  }, opt);
  if (typeof opt.service === 'object' && opt.service) {
    if (opt.service.host) opt.service.host = thorin.getIp(opt.service.host);
    if (opt.service.port == null) {
      let randPort = Math.floor(Math.random() * (MAX_RAND_PORT - MIN_RAND_PORT) + MIN_RAND_PORT);
      opt.service.port = randPort;
    }
    if (opt.service.version == null && typeof process.env.APP_VERSION !== 'undefined') {
      let ver = process.env.APP_VERSION;
      if (typeof ver === 'string') ver = parseInt(ver, 10);
      if (typeof ver === 'number' && ver > 0) {
        opt.service.version = ver;
      }
    }
  }

  const pluginObj = initCluster(thorin, opt);
  initMiddleware(thorin, opt, pluginObj);
  initBoot(thorin, opt, pluginObj);
  initAction(thorin, opt, pluginObj);
  return pluginObj;
};
module.exports.publicName = 'cluster';