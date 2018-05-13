'use strict';

function HttpError(message, statusCode) {
  this.message = message;
  this.statusCode = statusCode;
  this.name = "HttpError";
  Error.captureStackTrace(this, HttpError);
}
HttpError.prototype = Object.create(Error.prototype);
HttpError.prototype.constructor = HttpError;

module.exports = {
  HttpError
};
