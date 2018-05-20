'use strict';

const P = require('bluebird');
const uuid = require('uuid/v4');

const Question = class {
  constructor({id, question, answer, nb_correct, nb_wrong}) {
    this.id = id;
    this.question = question;
    this.answer = answer;
    this.nb_correct = nb_correct;// || 0;
    this.nb_wrong = nb_wrong;// || 0;
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
      answer: this.answer,
      nb_correct: this.nb_correct,
      nb_wrong: this.nb_wrong
    };
  };

  toString() {
    return `${this.question} => ${this.answer}`;
  }
};

module.exports = Question;
