'use strict';
/**
 * Created by Adrian on 30-Sep-16.
 */
const EventEmitter = require('events').EventEmitter,
  initClient = require('./client'),
  net = require('net'),
  initTransport = require('./transport');

module.exports = (thorin, opt) => {
  const logger = thorin.logger(opt.logger);
  let fetcherObj,
    transportObj;
  let isIncoming = !!(opt.service && opt.service.port && opt.service.host && opt.service.type),
    actionName = (isIncoming ? 'registry.announce' : 'registry.get'),
    actionPayload = (isIncoming ? opt.service : {});

  let REGISTRY = {},
    timer = null,
    isStarted = false,
    REGISTRY_MAP = {},
    ACTIVE_REGISTRY_MAP = {},
    CURRENT_SID;

  thorin.on(thorin.EVENT.EXIT, () => {
    Object.keys(REGISTRY_MAP).forEach((key) => {
      let clientObj = REGISTRY_MAP[key];
      if (!clientObj) return;
      try {
        clientObj.disconnect();
      } catch (e) {
      }
    });
  });


  /**
   * This is the cluster plugin class
   * */
  class ClusterPlugin extends EventEmitter {

    isIncoming() {
      return isIncoming;
    }

    get sid() {
      return CURRENT_SID;
    }

    /*
    * Checks to see if the given TCP port is available
    * */
    isPortAvailable(port) {
      return new Promise((resolve) => {
        let server = net.createServer();
        server.once('error', function () {
          resolve(false);
        });
        server.once('listening', function () {
          // close the server if listening doesn't fail
          server.once('close', function () {
            resolve(true);
          });
          server.close();
        });
        server.listen(port);
      });
    }

    registerTransport(done) {
      if (!isIncoming || transportObj) return done();
      transportObj = initTransport(thorin, opt, pluginObj);
      thorin.dispatcher.registerTransport(transportObj);
      transportObj.listen(done);
    }

    stop() {
      if (!transportObj) return false;
      return transportObj.shutdown();
    }

    addClient(item) {
      if (typeof item.type !== 'string' || typeof item.host !== 'string' || typeof item.port !== 'number') return false;
      let clientKey = item.host + ':' + item.port;
      if (REGISTRY_MAP[clientKey]) return;  // already added.
      if (typeof REGISTRY[item.type] === 'undefined') REGISTRY[item.type] = [];
      let clientObj = new pluginObj.Client(item);
      if (!clientObj) return;
      clientObj.connect((err) => {
        if (err) {
          logger.warn(`Could not connect to client ${item.type} (${item.host}:${item.port}`);
          return false;
        }
        if (opt.debug && opt.debug.connect) {
          logger.trace(`--> Connected to: ${item.name}`);
        }
        REGISTRY_MAP[clientKey] = clientObj;
        let idx = REGISTRY[item.type].indexOf(clientKey);
        if (idx === -1) {
          REGISTRY[item.type].push(clientKey);
        }
        clientObj.on('disconnect', () => {
          delete REGISTRY_MAP[clientKey];
          // Remove from the active registry map
          if (typeof ACTIVE_REGISTRY_MAP[item.type] === 'object') {
            let sidx = ACTIVE_REGISTRY_MAP[item.type].indexOf(clientKey);
            if (sidx !== -1) {
              ACTIVE_REGISTRY_MAP[item.type].splice(sidx, 1);
            }
          }
          // Remove from connection registry map.
          let idx = REGISTRY[item.type].indexOf(clientKey);
          if (idx !== -1) {
            REGISTRY[item.type].splice(idx, 1);
          }
          if (opt.debug && opt.debug.connect) {
            logger.trace(`--> Disconnected from: ${item.name}`);
          }
          clientObj.destroy();
        });
        clientObj.on('shutdown', () => {
          delete REGISTRY_MAP[clientKey];
          // Remove from connection registry map
          let idx = REGISTRY[item.type].indexOf(clientKey);
          if (idx !== -1) {
            REGISTRY[item.type].splice(idx, 1);
          }
          // Remove from active registry map
          if (typeof ACTIVE_REGISTRY_MAP[item.type] === 'object') {
            let sidx = ACTIVE_REGISTRY_MAP[item.type].indexOf(clientKey);
            if (sidx !== -1) {
              ACTIVE_REGISTRY_MAP[item.type].splice(sidx, 1);
            }
          }
          if (opt.debug && opt.debug.connect) {
            logger.trace(`--> Shutdown from: ${item.name}`);
          }
          clientObj.disconnect();
        });
      });
    }

    refresh(done) {
      if (!fetcherObj) {
        fetcherObj = thorin.fetcher(opt.gateway, {
          authorization: opt.token
        });
      }
      fetcherObj
        .dispatch(actionName, actionPayload)
        .then((r) => {
          if (r.meta) {
            CURRENT_SID = r.meta.sid;
          }
          let items = r.result || [],
            count = 0;
          ACTIVE_REGISTRY_MAP = {}; // reset our current registry map
          for (let i = 0; i < items.length; i++) {
            let item = items[i];
            if (item.proto !== 'ws') continue;
            count++;
            if (typeof ACTIVE_REGISTRY_MAP[item.type] === 'undefined') ACTIVE_REGISTRY_MAP[item.type] = [];
            ACTIVE_REGISTRY_MAP[item.type].push(item.host + ':' + item.port);
            this.addClient(item);
          }
          if (!isStarted) {
            isStarted = true;
            let msg = `Joined the registry cluster`;
            if (isIncoming) {
              msg += ' as receiver';
            } else {
              msg += ' as sender';
            }
            msg += ` [nodes: ${count}]`;
            logger.trace(msg);
          }
          done && done();
        })
        .catch((e) => {
          logger.warn(`Could not refresh registry: ${e.code}`);
          console.log(e);
          if (typeof done === 'function') {
            logger.warn(e);
            done(e);
          }
        });
    }

    /**
     * Manually start and stop the discovery system.
     * */
    start() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      let intervalSeconds = (opt.interval ? opt.interval : Math.abs(opt.service.ttl * 0.6) * 1000);
      intervalSeconds = Math.max(intervalSeconds, 2000); // min 2sec.
      timer = setTimeout(() => {
        pluginObj.refresh(() => this.start());
      }, intervalSeconds);
    }

    stopRegistry() {
      clearTimeout(timer);
      timer = null;
    }

    elect(serviceName) {
      if (typeof serviceName !== 'string' || !serviceName) return null;
      if (typeof REGISTRY[serviceName] === 'undefined') return null;
      let serviceItems = REGISTRY[serviceName],
        activeItems = ACTIVE_REGISTRY_MAP[serviceName] || [];
      if (serviceItems.length === 0) return null;
      let normalIdx = Math.floor(Math.random() * serviceItems.length);
      if (opt.versioned !== true || activeItems.length === 0) {
        return REGISTRY_MAP[REGISTRY[serviceName][normalIdx]];
      }
      // Priority will have active items over previous versions.
      activeItems = activeItems.concat([]); // copy array
      do {
        let idx = Math.floor(Math.random() * activeItems.length);
        let clientObj = REGISTRY_MAP[activeItems[idx]];
        if (!clientObj) {
          activeItems.splice(idx, 1);
        } else {
          return clientObj;
        }
      } while (activeItems.length > 0);
      // otherwise, return first available.
      let defaultClient = REGISTRY_MAP[REGISTRY[serviceName][normalIdx]];
      if (!defaultClient) {
        defaultClient = REGISTRY_MAP[REGISTRY[serviceName][0]];
      }
      return defaultClient;
    }

    /**
     * Dispatch the given action and payload to the given service
     * NOTE: if _opt.required = false, we will resolve if no node is available.
     * */
    dispatch(serviceName, actionName, payload, _opt) {
      if (typeof serviceName !== 'string' || !serviceName) {
        return Promise.reject(thorin.error('CLUSTER.DISPATCH', 'A valid service name is required.'));
      }
      if (typeof actionName !== 'string' || !actionName) {
        return Promise.reject(thorin.error('CLUSTER.DISPATCH', 'A valid action name is required.'));
      }
      if (typeof payload !== 'object' || !payload) payload = {};
      let clientObj = this.elect(serviceName);
      if (!clientObj) {
        if (typeof _opt === 'object' && _opt && _opt.required === false) {
          return Promise.resolve(); // silent fail
        }
        logger.trace(`No available node for ${serviceName} -> ${actionName}`);
        let err = thorin.error('CLUSTER.UNAVAILABLE', 'Service node is offline', 502);
        err.data = {
          node: serviceName
        };
        return Promise.reject(err);
      }
      return clientObj.dispatch(actionName, payload, _opt);
    }

    get nodes() {
      let nodes = Object.keys(REGISTRY);
      return nodes;
    }

    get registry() {
      return REGISTRY;
    }

    set registry(v) {
    }

  }

  let pluginObj = new ClusterPlugin();
  initClient(thorin, opt, pluginObj);
  return pluginObj;
};
