'use strict';
/**
 * Created by Adrian on 30-Sep-16.
 */
const EventEmitter = require('events').EventEmitter,
  initClient = require('./client'),
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
          let idx = REGISTRY[item.type].indexOf(clientKey);
          if (idx !== -1) {
            REGISTRY[item.type].splice(idx, 1);
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
          let items = r.result,
            count = 0;
          for (let i = 0; i < items.length; i++) {
            let item = items[i];
            if (item.proto !== 'ws') continue;
            count++;
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
      let serviceItems = REGISTRY[serviceName];
      if (serviceItems.length === 0) return null;
      let idx = Math.floor(Math.random() * serviceItems.length);
      return REGISTRY_MAP[REGISTRY[serviceName][idx]];
    }

    /**
     * Dispatch the given action and payload to the given service
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
