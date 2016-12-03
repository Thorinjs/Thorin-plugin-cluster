'use strict';
/**
 * Socket events
 */

module.exports = {
  NO_AUTH: 0,       // triggered when the socket is not authenticated
  AUTH: 1,          // triggered when a client wants to authenticate to another one
  AUTH_SUCCESS: 2,    // triggered when the auth was successful.
  AUTH_FAIL: 3,       // triggered when auth failed
  ERROR: 4,         // triggered when a generic error occurs.
  ACTION_CALL: 5,   // triggered when a client wants to call an action
  RESULT: 5,        // triggered when the action completed with a result.
  ABORT: 6,         // triggered when a request aborted (equivalent with the http abort)
  INVALID: 7,       // triggered when an invalid event was sent
  UNAVAILABLE: 8,   // triggered when action is not available.
  NOT_FOUND: 9,     // generic 404 not found action
  SERVICE: 10,       // triggered when the client announces the other client to connect to him.
  SHUTDOWN: 11,      // announce clients that we are shutting down and should not use us anymore.
  PING: 13,
  PONG: 14
};