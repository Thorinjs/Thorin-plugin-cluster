'use strict';
/**
 * The cluster authorization action extension.
 */
const PAGINATION_FIELDS = ['start_date', 'end_date', 'limit', 'page', 'order', 'order_by'];
module.exports = function (thorin, opt, pluginObj) {
  const logger = thorin.logger(opt.logger),
    Action = thorin.Action;
  const HANDLER_TYPE = 'proxy';
  Action.HANDLER_TYPE.PROXY_CLUSTER = 'proxy.cluster';

  class ThorinAction extends Action {

    /**
     * This will be available for all actions, it will allow one service's action handlers
     * to proxy the incoming intent to another service within the cluster system.
     * NOTE:
     *  the name MUST contain "cluster#" to identify that we're going to
     *  proxy the request to a specific service, and not to another internal action.
     *  The pattern is: "cluster#{serviceName}"
     * Ex:
     *
     *  thorin.dispatcher.addAction('myAction')
     *      .use((intentObj, next) => {
     *        intentObj.input('someValue', 1);    // override the intent's input.
     *        next();
     *      })
     *      .before('proxy', (intentObj, serviceData) => {
     *        console.log('Will proxy action to ${serviceData.ip});
     *      })
     *      .proxy('cluster#myOtherService', {
     *        action: 'some.other.custom.action'  // it defaults to the current action's name
     *      })
     *      .after('proxy', (intentObj, response) => {
     *        console.log(`Proxy successful. Response:`, response);
     *      })
     *      .use((intentObj) => {
     *        console.log("myOtherService responded with: ", intentObj.result());
     *        // here is where we can mutate the result of the intent to send back to the client.
     *        intentObj.send();
     *      });
     *      OPTIONS:
     *        - action=string -> the target action name found on the service app
     *        - payload=object -> the base payload that will override the intent input.
     *        - rawInput=false -> should we use intentObj.input() or intentObj.rawInput
     *        - exclude: [],  -> array of keys to exclude from input
     *        - fields: {} -> a key-value object that will convert the key into the value of the key to be transfered.
     *                      This is essentially a mapping between services.
     *                      Eg:
     *                        fields: {
     *                          code: 'action_code',        -> input.code will be converted to input.action_code
     *                          message: 'action_message'   -> input.message will be converted into action_message
     *                        }
     *              NOTE: special fields:
     *                    - _pagination -> white-lists all pagination fields (start_date, end_date, limit, page, order, order_by)
     * */
    proxy(proxyServiceName, opt) {
      if (typeof proxyServiceName !== 'string' || !proxyServiceName) {
        logger.error(`proxy() of action ${this.name} must have a valid string for the proxy service name`);
        return this;
      }
      let tmp = proxyServiceName.split('#'),
        proxyName = tmp[0],
        serviceName = tmp[1];
      if (proxyName !== 'cluster') {
        if (typeof super.proxy === 'function') {
          return super.proxy.apply(this, arguments);
        }
        logger.warn(`proxy() must contain a service name with the pattern: cluster#{serviceName} [current: ${proxyServiceName}]`);
        return this;
      }
      let options = Object.assign({}, {
        serviceName: serviceName,
        rawInput: true,
        action: this.name,
        exclude: [],
        payload: {}
      }, opt || {});
      this.stack.push({
        name: proxyServiceName,
        type: Action.HANDLER_TYPE.PROXY_CLUSTER,
        opt: options
      });
      return this;
    }

    /*
     * Runs our custom proxy middleware function.
     * */
    _runCustomType(intentObj, handler, done) {
      if (handler.type !== Action.HANDLER_TYPE.PROXY_CLUSTER) {
        return super._runCustomType.apply(this, arguments);
      }
      let opt = handler.opt,
        serviceName = opt.serviceName,
        actionName = opt.action,
        intentInput = {};
      if (opt.rawInput === true || typeof opt.fields === 'object' && opt.fields) {
        intentInput = intentObj.rawInput;
      } else {
        intentInput = intentObj.input();
      }
      let payload = opt.payload ? JSON.parse(JSON.stringify(opt.payload)) : {};
      if (typeof opt.fields === 'object' && opt.fields) {
        Object.keys(opt.fields).forEach((keyName) => {
          if (keyName === '_pagination') {
            for (let i = 0, len = PAGINATION_FIELDS.length; i < len; i++) {
              let pagKey = PAGINATION_FIELDS[i];
              if (typeof intentInput[pagKey] === 'undefined' || intentInput[pagKey] == null) continue;
              payload[pagKey] = intentInput[pagKey];
            }
            return;
          }
          if (typeof intentInput[keyName] === 'undefined') return;
          let newKeyName = opt.fields[keyName];
          if (newKeyName === true) {
            payload[keyName] = intentInput[keyName];
          } else if (typeof newKeyName === 'string') {
            payload[newKeyName] = intentInput[keyName];
          }
        });
      } else {
        payload = Object.assign({}, intentInput, opt.payload);
      }
      if(opt.exclude instanceof Array) {
        for(let i=0; i < opt.exclude.length; i++) {
          let keyName = opt.exclude[i];
          if(typeof payload[keyName] !== 'undefined') delete payload[keyName];
        }
      }
      this._runHandler(
        'before',
        HANDLER_TYPE,
        intentObj,
        serviceName,
        actionName,
        payload
      );

      pluginObj
        .dispatch(serviceName, actionName, payload, intentObj)
        .then((res) => {
          if (typeof res.meta !== 'undefined') {
            intentObj.setMeta(res.meta);
          }
          if (typeof res.result !== 'undefined') {
            intentObj.result(res.result);
          }
        })
        .catch((e) => intentObj.error(e))
        .finally(() => {
          this._runHandler(
            'after',
            HANDLER_TYPE,
            intentObj,
            serviceName,
            actionName,
            payload
          );
          done();
        });
    }
  }

  thorin.Action = ThorinAction;
};
