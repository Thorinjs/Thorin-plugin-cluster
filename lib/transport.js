'use strict';
const ws = require('ws'),
  EVENT = require('./event');
/**
 * Created by Adrian on 30-Sep-16.
 */
module.exports = (thorin, opt, pluginObj) => {

  const logger = thorin.logger(opt.logger),
    providers = Symbol(),
    disabled = Symbol(),
    pending = Symbol();
  let requestId = 1;

  class ClusterTransport extends thorin.Interface.Transport {
    static publicName() {
      return "cluster"
    }

    constructor() {
      super();
      this.name = 'cluster';
      this.type = 2;
      this[providers] = {};
      this[disabled] = {};
      this[pending] = {};
      this.app = null;
    }

    shutdown() {
      if(!this.app) return false;
      for(let i=0; i < this.app.clients.length; i++) {
        let sObj = this.app.clients[i];
        this.sendEvent(sObj, EVENT.SHUTDOWN);
      }
    }

    authenticateClient(socket, msg) {
      if (!opt.token) {
        socket.__authenticated = true;
        return true;
      }  // no auth
      if (!msg || !msg.ts || !msg.token) return false;
      try {
        let hash = thorin.util.sha2(msg.ts + opt.token);
        if (hash !== msg.token) throw 1;
      } catch (e) {
        return false;
      }
      socket.__authenticated = true;
      return true;
    }

    handleEvent(socket, event, data, fnId, clientData) {
      switch (event) {
        case EVENT.ACTION_CALL:
          if (typeof data === 'object' && data && typeof data.type === 'string') {
            return this.handleRequest(socket, data.type, data.payload || {}, fnId, clientData);
          }
          break;
        case EVENT.ABORT:
          if (typeof fnId === 'string' && fnId) {
            return this.handleAbort(fnId);
          }
          break;
        case EVENT.SERVICE:
          pluginObj.addClient(data);
          break;
        default:
          return this.sendEvent(socket, EVENT.INVALID, null, fnId);
      }
    }

    handleConnection(socket) {
      socket.__authenticated = false;
      socket.__active = {};
      socket.on('message', (msg) => {
        try {
          msg = JSON.parse(msg);
        } catch (e) {
          return;
        }
        if (msg.e === EVENT.AUTH && !socket.__authenticated) {
          if (!this.authenticateClient(socket, msg.d)) {
            return this.sendEvent(socket, EVENT.AUTH_FAIL, null, msg.fn);
          }
          delete msg.d.token;
          socket.__client = msg.d;
          if(opt.debug && opt.debug.connect) {
            logger.trace(`<-- Client connected: ${socket.__client.name}`);
          }
          return this.sendEvent(socket, EVENT.AUTH_SUCCESS, null, msg.fn);
        }
        if (!socket.__authenticated) {
          return this.sendEvent(socket, EVENT.NO_AUTH, null, msg.fn);
        }
        return this.handleEvent(socket, msg.e, msg.d, msg.fn, msg.c);
      });
      socket.on('close', () => {
        Object.keys(socket.__active).forEach((fnId) => {
          this.handleAbort(fnId);
        });
        if(opt.debug && opt.debug.connect) {
          logger.trace(`<-- Client disconnected: ${socket.__client.name}`);
        }
        socket.__authenticated = false;
        delete socket.__client;
        socket.__active = {};
      });
    }

    sendEvent(socket, event, data, fn) {
      let d = {
        e: event
      };
      if (typeof data === 'object' && data) {
        d.d = data;
      }
      if (typeof fn === 'string' && fn) {
        d.fn = fn;
      }
      try {
        socket.send(JSON.stringify(d));
      } catch (e) {
      }
    }

    sendError(socket, err, fn) {
      return this.sendEvent(socket, EVENT.ERROR, err, fn);
    }

    sendResult(socket, result, fn) {
      return this.sendEvent(socket, EVENT.RESULT, result, fn);
    }

    listen(done) {
      let service = opt.service;
      let sopt = {
        port: service.port
      };
      if (service.host && thorin.sanitize('IP', service.host)) {
        sopt.host = service.host;
      } else {
        sopt.host = '0.0.0.0';
      }
      this.app = new ws.Server(sopt);
      this.app.on('connection', this.handleConnection.bind(this));
      let wasCalled = false;
      this.app._server.listen(sopt.port, sopt.host, (err) => {
        if (wasCalled) return;
        wasCalled = true;
        if (err) {
          logger.warn(`Could not start cluster transport server on port ${sopt.port}`);
          return done(err);
        }
        logger.trace(`Listening on port ${sopt.port}`);
        done();
      });
      this.app.on('error', (e) => {
        if (wasCalled) return;
        wasCalled = true;
        logger.warn(`Could not start cluster transport server on port ${sopt.port}`);
        return done(e);
      })
    }

    handleActionDispatch(actionObj, socket, payload, fnId, clientData) {
      let actionId = requestId++;
      if (actionObj.hasDebug !== false && opt.debug && opt.debug.request && thorin.env !== 'production') {
        logger.trace(`[START ${actionId}] - ${actionObj.name}`);
      }
      const intentObj = new thorin.Intent(actionObj.name, payload, (wasError, result) => {
        delete this[pending][fnId];
        let took = intentObj.took,
          err, isCustomErr = false;
        if (wasError) {
          err = (typeof result === 'object' && result.error ? result.error : result);
          if (err instanceof Error && err.name.indexOf('Thorin') === 0) {
            err = result.error;
          } else {
            err = thorin.error(result.error || result);
          }
          if (err && err.source) isCustomErr = true;
        }
        if (actionObj.hasDebug !== false && opt.debug && opt.debug.request) {
          if (wasError) {
            let msg = `[ENDED ${actionId} - ${result.type} [${err.code}]`;
            if (typeof err.statusCode !== 'undefined') {
              msg += ` - ${err.statusCode}`;
            }
            msg += ` (${took}ms)`;
            logger[err.statusCode < 500 ? 'trace' : 'warn'](msg);
            if (isCustomErr) {
              logger.trace(err.source.stack);
            }
          } else {
            logger.debug(`[ENDED ${actionId}] - ${result.type} (${took}ms)`)
          }
        }
        delete socket.__active[fnId];
        if (wasError) {
          return this.sendError(socket, result, fnId);
        }
        this.sendResult(socket, result, fnId);
      });
      if(typeof clientData === 'object') {
        intentObj.client(clientData);
      }
      this[pending][fnId] = intentObj;
      intentObj._setAuthorization('CLUSTER', 'AUTHENTICATED');
      intentObj.transport = 'cluster';
      socket.__active[fnId] = true;
      thorin.dispatcher.triggerIntent(intentObj);
    }

    handleRequest(socket, actionType, payload, fnId, clientData) {
      if (this[disabled][actionType]) {
        return this.sendEvent(socket, EVENT.UNAVAILABLE, null, fnId);
      }
      if (typeof this[providers][actionType] === 'undefined') {
        return this.sendError(socket, thorin.error('NOT_FOUND', 'The requested resource was not found', 404), fnId);
      }
      this[providers][actionType](socket, payload, fnId, clientData);
    }

    handleAbort(fnId) {
      let intentObj = this[pending][fnId];
      if (!intentObj) return;
      delete this[pending][fnId];
      if (intentObj.completed) return;
      intentObj.__trigger(thorin.Intent.EVENT.CLOSE);
    }

    routeAction(actionObj) {
      let shouldAdd = false;
      /* check authorization */
      if (opt.checkAuthorization) {
        for (let i = 0; i < actionObj.stack.length; i++) {
          let item = actionObj.stack[i];
          if (item.type !== 'authorize') continue;
          if (item.name === 'cluster#proxy') {
            shouldAdd = true;
            break;
          }
        }
      } else {
        shouldAdd = true;
      }
      if (!shouldAdd) return;
      this[providers][actionObj.name] = this.handleActionDispatch.bind(this, actionObj);
    }

    disableAction(actionName) {
      if (this[disabled][actionName]) return;
      this[disabled][actionName] = true;
    }

    enableAction(actionName) {
      if (!this[disabled][actionName]) return;
      delete this[disabled][actionName];
    }
  }

  return new ClusterTransport();
};