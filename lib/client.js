'use strict';
/**
 * Created by Adrian on 30-Sep-16.
 */
const ws = require('ws'),
  EventEmitter = require('events').EventEmitter,
  EVENT = require('./event');

const PING_TIMER = 2000;

module.exports = (thorin, opt, pluginObj) => {
  let eventId = 0,
    logger = thorin.logger(opt.logger),
    pending = Symbol(),
    active = Symbol(),
    ping = Symbol(),
    hbeat = Symbol();

  const HEARTBEAT_TIMER = opt.heartbeat || 20000;

  class ClusterClient extends EventEmitter {

    constructor(item) {
      super();
      this.type = item.type;
      this.name = item.name;
      this.host = item.host;
      this.port = item.port;
      this.sid = item.sid;
      this.client = null;
      this[pending] = {};
      this[active] = {};
      this[ping] = null;  // the pinger
      this[hbeat] = null;
    }

    startPing() {
      this[hbeat] = setTimeout(() => {
        if (typeof opt.debug === 'object' && opt.debug.connect || opt.debug === true) {
          logger.trace(`--> Client timeout: ${this.name}`);
        }
        this.disconnect();
      }, HEARTBEAT_TIMER);
      this.sendEvent(EVENT.PING);
    }

    stopPing() {
      if (this[ping]) clearTimeout(this[ping]);
      if (this[hbeat]) clearTimeout(this[hbeat]);
      this[ping] = null;
      this[hbeat] = null;
    }

    handlePong() {
      if (this.__disconnected) return;
      this.stopPing();
      this[ping] = setTimeout(() => {
        this.startPing();
      }, PING_TIMER);
    }

    sendEvent(event, data, fn, _client) {
      if (!this.client) return;
      let d = {
        e: event,
        d: data || {}
      };
      if (typeof fn === 'function') {
        eventId++;
        let eid = eventId.toString();
        this[pending][eid] = fn;
        d.fn = eid;
      } else if (typeof fn === 'string') {
        d.fn = fn;
      } else if (typeof fn === 'number') {
        d.fn = fn.toString();
      }
      if (typeof _client === 'object' && _client) {
        d.c = _client;
      }
      try {
        this.client.send(JSON.stringify(d));
        return eventId;
      } catch (e) {
        return false;
      }
    }

    abortEvent(fnId) {
      if (typeof this[pending][fnId] === 'undefined') return;  //already aborted
      delete this[pending][fnId];
      this.sendEvent(EVENT.ABORT, null, fnId);
    }

    /**
     *  Performs a dispatch to the current client
     *  Arguments:
     *  action - the action name
     *  payload - the payload to send
     *  NOTE:
     *  if opt is an object that contains request(),
     *  we will provide the abort() function in it.
     *  REQUEST OPTIONS:
     *    reqOpt.client -> intent client information
     *    IF it is a intent, use its data.
     * */
    dispatch(action, payload, reqOpt) {
      if (typeof action !== 'string' || !action) return Promise.reject(thorin.error('CLUSTER.DISPATCH', 'Missing action name'));
      let eventData = {
        type: action,
        payload: payload || {}
      };
      return new Promise((resolve, reject) => {
        let wasCalled = false,
          self = this;
        let timer = setTimeout(() => {
          if (wasCalled) return;
          wasCalled = true;
          if (this[active][fnId]) {
            delete this[active][fnId];
          }
          this.abortEvent(fnId);
          let err = thorin.error('CLUSTER.TIMEOUT', 'Request time out', 502);
          err.data = {
            node: this.type
          };
          reject(err);
          return this.emit('shutdown');
        }, reqOpt && reqOpt.timeout || opt.timeout);

        function onResponse(err, result) {
          if (wasCalled) return;
          wasCalled = true;
          clearTimeout(timer);
          if (self[active][fnId]) {
            delete self[active][fnId];
          }
          if (self[pending][fnId]) {
            delete self[pending][fnId];
          }
          if (err) return reject(err);
          resolve(result);
        }

        let clientData;
        if (typeof reqOpt === 'object' && reqOpt && reqOpt.client) {
          clientData = reqOpt.client;
        } else if (reqOpt instanceof thorin.Intent) {
          clientData = reqOpt.client();
        }
        let fnId = this.sendEvent(EVENT.ACTION_CALL, eventData, onResponse, clientData);
        if (fnId == false) {
          return Promise.reject(thorin.error('ABORTED', 'Request aborted'));
        }
        this[active][fnId] = onResponse;
        if (typeof reqOpt === 'object' && reqOpt) {
          if (typeof reqOpt.request === 'function') {
            let reqObj = {
              abort: () => {
                this.abortEvent(fnId);
                if (wasCalled) return;
                wasCalled = true;
                if (this[active][fnId]) {
                  delete this[active][fnId];
                }
                clearTimeout(timer);
                reject(thorin.error('ABORTED', 'Request aborted'));
              }
            };
            try {
              reqOpt.request(reqObj);
            } catch (e) {
              logger.warn(e);
            }
          }
        }
      });
    }

    handleMessage(msg) {
      let fn = msg.fn,
        event = msg.e,
        data = msg.d || {};
      if (typeof this[pending][fn] !== 'function') return;
      let msgFn = this[pending][fn];
      delete this[pending][fn];
      fn = function (err, data) {
        try {
          msgFn(err, data);
        } catch (e) {
          logger.warn(`Encountered an error while calling callback function`, msgFn.toString());
          logger.debug(e);
        }
      };
      switch (event) {
        case EVENT.AUTH_SUCCESS:
          return fn(null);
        case EVENT.RESULT:
          return fn(null, data);
        case EVENT.ABORT:
          return fn(thorin.error('ABORT', 'Request aborted', 400));
        case EVENT.NO_AUTH:
          return fn(thorin.error('CLUSTER.AUTHORIZATION', 'Missing authorization information', 401));
        case EVENT.AUTH_FAIL:
          return fn(thorin.error('CLUSTER.AUTHORIZATION', 'Invalid authorization information', 401));
        case EVENT.INVALID:
          return fn(thorin.error('CLUSTER.ERROR', 'Invalid request payload', 500));
        case EVENT.UNAVAILABLE:
          return fn(thorin.error('CLUSTER.UNAVAILABLE', 'The requested resource is currently unavailable', 400));
        case EVENT.ERROR:
          let rawError = data.error || data;
          let err = thorin.error(rawError.code || 'CLUSTER.ERROR', rawError.message || 'An unexpected error occurred', rawError.status || 400);
          err.ns = rawError.ns || 'CLUSTER';
          if (rawError.data) err.data = rawError.data;
          return fn(err);
      }
    }

    disconnect() {
      this.stopPing();
      if (!this.client) return;
      try {
        this.client.close();
      } catch (e) {
      }
      this.onDisconnect();
    }

    connect(done) {
      this.client = new ws(`ws://${this.host}:${this.port}`, {
        timeout: 2000
      });
      this.client.on('open', () => {
        let authData = {
          type: opt.service.type,
          name: opt.service.name
        };
        if (opt.token) {
          authData.type = opt.service.type;
          authData.ts = Date.now();
          authData.token = thorin.util.sha2(authData.ts + opt.token);
        }
        this.sendEvent(EVENT.AUTH, authData, (err) => {
          if (err) return done(err);
          done();
          // let the client connect to us.
          if (pluginObj.isIncoming) {
            if (opt.service.port != this.port || opt.service.host != this.host) {
              let data = Object.assign({
                sid: pluginObj.sid
              }, opt.service);
              this.sendEvent(EVENT.SERVICE, data);
            }
          }
          this.startPing();
        });
      });
      this.client.on('message', (msg) => {
        try {
          msg = JSON.parse(msg);
        } catch (e) {
        }
        if (typeof msg !== 'object' || !msg) return;
        if (msg.e === EVENT.PONG) return this.handlePong();
        if (msg.e === EVENT.SHUTDOWN) {
          return this.emit('shutdown');
        }
        if (typeof msg.fn !== 'string' || !msg.fn || typeof msg.e === 'undefined') return;
        this.handleMessage(msg);
      });
      this.client.on('error', (e) => {
        this.onDisconnect();
      });
      this.client.on('close', () => {
        this.onDisconnect();
      });
    }

    onDisconnect() {
      if (this.__disconnected) return;
      this.__disconnected = true;
      this.stopPing();
      Object.keys(this[active]).forEach((fnId) => {
        if (typeof this[active][fnId] === 'function') {
          this[active][fnId](thorin.error('ABORTED', 'Request aborted'));
        }
      });
      this[active] = {};
      this.emit('disconnect');
    }

    destroy() {
      this.client = null;
      this[pending] = {};
      this[active] = {};
      this.type = null;
      this.name = null;
      this.host = null;
      this.sid = null;
      this.removeAllListeners();
    }
  }

  pluginObj.Client = ClusterClient;
};