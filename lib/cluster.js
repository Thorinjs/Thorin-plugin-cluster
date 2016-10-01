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
    REGISTRY_MAP = {},
    CURRENT_SID;


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

    addClient(item) {
      if (typeof item.type !== 'string' || typeof item.host !== 'string' || typeof item.port !== 'number' || typeof item.sid !== 'string') return false;
      if (REGISTRY_MAP[item.sid]) return;  // already added.
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
        REGISTRY_MAP[item.sid] = clientObj;
        let idx = REGISTRY[item.type].indexOf(item.sid);
        if (idx === -1) {
          REGISTRY[item.type].push(item.sid);
        }
        clientObj.on('disconnect', () => {
          delete REGISTRY_MAP[item.sid];
          let idx = REGISTRY[item.type].indexOf(item.sid);
          if (idx !== -1) {
            REGISTRY[item.type].splice(idx, 1);
          }
          if (opt.debug && opt.debug.connect) {
            logger.trace(`--> Disconnected from:${item.name}`);
          }
          delete REGISTRY[item.sid];
          clientObj.destroy();
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
          if(typeof done === 'function') {
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
      if (timer) clearTimeout(timer);
      let intervalSeconds = (opt.interval ? opt.interval : Math.abs(opt.service.ttl * 0.6) * 1000);
      intervalSeconds = Math.max(intervalSeconds, 2000); // min 2sec.
      timer = setInterval(() => {
        pluginObj.refresh();
      }, intervalSeconds);
    }

    stop() {
      clearInterval(timer);
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
        return Promise.reject(thorin.error('CLUSTER.UNAVAILABLE', 'Service node is offline', 502));
      }
      return clientObj.dispatch(actionName, payload, _opt);
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