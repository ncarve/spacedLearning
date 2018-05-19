'use strict';

const P = require('bluebird');
const uuid = require('uuid/v4');

const Question = class {
  constructor({id, question, answer}) {
    this.id = id;
    this.question = question;
    this.answer = answer;
    return;
  }

  complete = () => {
    return P.try(() => {
      if (this.id === undefined)
        this.id = uuid();
    });
  };
  
  present = () => {
    return {
      id: this.id,
      question: this.question,
      answer: this.answer
    };
  };
};

module.exports = Question;
