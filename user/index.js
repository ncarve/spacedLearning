'use strict';

const P = require('bluebird');
const R = require('ramda');
const crypto = P.promisifyAll(require('crypto'));
const uuid = require('uuid/v4');

const iterations = 1024;
const keylen = 32;

const User = class {
  constructor({id, username, password, pwhash, salt, token}) {
    this.id = id;
    this.username = username;
    this.password = password;
    this.token = token;
    this.privileges = [];

    if (pwhash) {
      this.pwhashBytes = Buffer.from(pwhash, 'base64');
    }
    if (salt) {
      this.saltBytes = Buffer.from(salt, 'base64');
    }
    return;
  };

  addPrivileges(newPrivileges) {
    this.privileges = this.privileges.concat(newPrivileges);
  }

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

  hasPrivilege = (privilegeName) => {
    return R.find(privilege => privilege.name == privilegeName, this.privileges);
  }

  hasPassword = (password) => {
    return P.props({
      actual: crypto.pbkdf2Async(Buffer.from(password, 'utf8'), this.saltBytes, iterations, keylen, 'sha256'),
      expected: this.pwhashBytes
    })
    .then(({actual, expected}) => {
      return actual.equals(expected);
    });
  };

  toString() {
    return `[User ${this.username}, id ${this.id}]`
  }

  present = () => {
    return {
      id: this.id,
      username: this.username,
      token: this.token
    };
  };
};

module.exports = User;
