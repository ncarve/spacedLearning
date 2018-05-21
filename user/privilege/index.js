'use strict';

const P = require('bluebird');
const uuid = require('uuid/v4');

const Privilege = class {
  constructor({id, name}) {
    this.id = id;
    this.name = name;
    return;
  };

  toString() {
    return `[Privilege ${this.name}, id ${this.id}]`
  }

  present = () => {
    return {
      id: this.id,
      name: this.name
    };
  };
};

module.exports = Privilege;
