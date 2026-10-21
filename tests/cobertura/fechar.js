// globalTeardown: junta a cobertura que cada teste deixou no cache e gera o relatório.
const MCR = require('monocart-coverage-reports');
const { on, options } = require('./config');

module.exports = async () => {
  if (on) await MCR(options).generate();
};
