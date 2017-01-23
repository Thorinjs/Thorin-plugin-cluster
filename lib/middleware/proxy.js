'use strict';
/**
 * This creates an authorization middleware that will check that the incoming
 * request is made by a microservice within the cluster. We perform the check by checking
 * the authorization token
 */
module.exports = function (thorin, opt, pluginObj) {
  const logger = thorin.logger(opt.logger),
    dispatcher = thorin.dispatcher;


  /*
   * All you need to do in your actions is to add
   *   .authorization('cluster#proxy')
   * and all the incoming requests will be filtered by this.
   * OPTIONS
   * - required=true - if set to false, we will not stop request, but simply not set intentObj.data('proxy_auth', true)
   * */
  const PROXY_ERROR = thorin.error('CLUSTER.PROXY', 'Request not authorized.', 401);
  dispatcher
    .addAuthorization('cluster#proxy')
    .use((intentObj, next, opt) => {
      const tokenType = intentObj.authorizationSource;
      if (intentObj.transport !== 'cluster') {
        if (opt.required === false) {
          intentObj.data('proxy_auth', false);
          return next();
        }
        return next(PROXY_ERROR);
      }
      if (tokenType !== 'CLUSTER') {
        if (opt.required === false) {
          intentObj.data('proxy_auth', false);
          return next();
        }
        return next(PROXY_ERROR);
      }
      if (opt.required === false) {
        intentObj.data('proxy_auth', true);
      }
      return next();
    });
};