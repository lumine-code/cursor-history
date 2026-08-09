class Base {}

class First extends Base {}

class Second extends First {}

class Third extends First {}

const values = [
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
];

module.exports = { Base, First, Second, Third, values };
