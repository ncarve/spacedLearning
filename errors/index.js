'use strict';

function HttpError(message, statusCode, params = {}) {
  this.message = message;
  this.statusCode = statusCode;
  this.name = "HttpError";
  for (key in params) {
    this[key] = params[key];
  }
  Error.captureStackTrace(this, HttpError);
}
HttpError.prototype = Object.create(Error.prototype);
HttpError.prototype.constructor = HttpError;

module.exports = {
  HttpError
};
