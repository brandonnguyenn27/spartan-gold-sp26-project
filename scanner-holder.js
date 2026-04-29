"use strict";

const utils = require('./utils.js');

const args = process.argv.slice(2);
if (args[0] === 'sign' && args.length >= 3) {
  const privKey = args[1];
  const challenge = args[2];
  const sig = utils.sign(privKey, challenge);
  console.log('Signature:', sig);
} else if (args[0] === 'sign-mnemonic' && args.length >= 4) {
  const mnemonic = args[1];
  const password = args[2];
  const challenge = args[3];
  const kp = utils.generateKeypairFromMnemonic(mnemonic, password);
  console.log('PubKey:', kp.public);
  console.log('Address:', utils.calcAddress(kp.public));
  console.log('Signature:', utils.sign(kp.private, challenge));
} else {
  console.log('Usage:');
  console.log('  node scanner-holder.js sign <privateKeyPem> <challenge>');
  console.log('  node scanner-holder.js sign-mnemonic <mnemonic> <password> <challenge>');
}
