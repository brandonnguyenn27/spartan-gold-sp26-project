"use strict";

const crypto = require('crypto');
const utils = require('./utils.js');

function generateChallenge() {
  return crypto.randomBytes(16).toString('hex');
}

function verifyEntry(block, ticketId, pubKey, challenge, sig) {
  if (!block.ticketRegistry || !block.ticketRegistry.has(ticketId)) {
    return { allowed: false, reason: 'Unknown ticket.' };
  }
  const owner = block.ticketRegistry.get(ticketId);
  const meta = block.ticketMetadata ? block.ticketMetadata.get(ticketId) : null;

  if (meta && Number.isInteger(meta.expiration) && block.chainLength > meta.expiration) {
    return { allowed: false, reason: 'Ticket expired.' };
  }
  if (!utils.verifySignature(pubKey, challenge, sig)) {
    return { allowed: false, reason: 'Invalid signature.' };
  }
  const holderAddr = utils.calcAddress(pubKey);
  if (holderAddr !== owner) {
    return { allowed: false, reason: 'Signer is not the ticket owner.' };
  }
  if (meta && meta.nonTransferable) {
    return { allowed: true, reason: 'ALLOW (non-transferable VIP ticket).' };
  }
  return { allowed: true, reason: 'ALLOW.' };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.log('Usage: node scanner.js <block-json-file> [ticketId] [pubKey] [challenge] [sig]');
    console.log('  Omit ticketId..sig to enter interactive mode (prints a challenge).');
    process.exit(1);
  }
  const fs = require('fs');
  const Blockchain = require('./blockchain.js');
  const Block = require('./block.js');
  const TicketTransaction = require('./ticket-transaction.js');
  Blockchain.createInstance({ blockClass: Block, transactionClass: TicketTransaction });

  const raw = JSON.parse(fs.readFileSync(args[0], 'utf8'));
  const block = Blockchain.deserializeBlock(raw);

  if (args.length >= 5) {
    const [, ticketId, pubKey, challenge, sig] = args;
    const result = verifyEntry(block, ticketId, pubKey, challenge, sig);
    console.log(result.allowed ? 'ALLOW' : 'DENY', '-', result.reason);
  } else {
    const challenge = generateChallenge();
    console.log('Challenge:', challenge);
    console.log('Have the holder run:');
    console.log(`  node scanner-holder.js sign <privateKeyPem> ${challenge}`);
    console.log('Then re-run:');
    console.log(`  node scanner.js ${args[0]} <ticketId> <pubKeyPem> ${challenge} <sig>`);
  }
}

module.exports = { generateChallenge, verifyEntry };
