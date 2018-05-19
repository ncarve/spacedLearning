'use strict';

const P = require('bluebird');
const crypto = P.promisifyAll(require('crypto'));
const uuid = require('uuid/v4');

const iterations = 1024;
const keylen = 32;

const User = class {
  constructor({id, username, password, pwhash, salt}) {
    this.id = id;
    this.username = username;
    this.password = password;
    if (pwhash) {
      this.pwhashBytes = Buffer.from(pwhash, 'base64');
    }
    if (salt) {
      this.saltBytes = Buffer.from(salt, 'base64');
    }
    return;
  };

  complete = () => {
    return P.try(() => {
        if (this.id === undefined)
          this.id = uuid();
      })
      .then(() => crypto.randomBytesAsync(16))
      .then((saltBytes) => {
        this.saltBytes = saltBytes;
        return crypto.pbkdf2Async(this.password, saltBytes, iterations, keylen, 'sha256');
      })
      .then((pwhashBytes) => {
        this.pwhashBytes = pwhashBytes;
      });
  };

  hasPassword = (password) => {
    return P.props({
      actual: crypto.pbkdf2Async(Buffer.from(password, 'utf8'), this.saltBytes, iterations, keylen, 'sha256'),
      expected: this.pwhash
    })
    .then(({actual, expected}) => (actual.equals(expected)));
  };

  toString() {
    return `[User ${this.username}, id ${this.id}]`
  }

  present = () => {
    return {
      id: this.id,
      username: this.username
    };
  };
};

module.exports = User;
