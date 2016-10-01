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
   * */
  const PROXY_ERROR = thorin.error('CLUSTER.PROXY', 'Request not authorized.', 403);
  dispatcher
    .addAuthorization('cluster#proxy')
    .use((intentObj, next) => {
      const tokenType = intentObj.authorizationSource;
      if (intentObj.transport !== 'cluster') return next(PROXY_ERROR);
      if (tokenType !== 'CLUSTER') return next(PROXY_ERROR);
      return next();
    });
};