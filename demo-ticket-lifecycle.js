"use strict";

const Blockchain = require('./blockchain.js');
const FakeNet = require('./fake-net.js');
const { registerOrganizer } = require('./ticket-organizers.js');
const { verifyEntry, generateChallenge } = require('./scanner.js');
const utils = require('./utils.js');

const EVENT_ID = 'evt-concert-2026';

console.log('=== NFT Ticket Lifecycle Demo ===\n');

let bc = Blockchain.createInstance({
  clients: [
    { name: 'Organizer', amount: 1000 },
    { name: 'Alice', amount: 200 },
    { name: 'Bob', amount: 200 },
    { name: 'Scalper', amount: 50 },
    { name: 'Minnie', amount: 500, mining: true },
  ],
  mnemonic: 'antenna dwarf settle sleep must wool ocean once banana tiger distance gate great similar chief cheap dinner dolphin picture swing twenty two file nuclear',
  net: new FakeNet(),
  transactionClass: require('./ticket-transaction.js'),
});

let [organizer, alice, bob, scalper] = bc.getClients('Organizer', 'Alice', 'Bob', 'Scalper');
registerOrganizer(EVENT_ID, organizer.address);

console.log('\n--- Step 1: Organizer mints tickets ---');
let mint1 = organizer.mintTicket({
  metadata: { eventId: EVENT_ID, seatInfo: 'A-1', expiration: 1000000, royaltyRate: 0.1 },
  mintNonce: 0, recipient: alice.address,
});
let mint2 = organizer.mintTicket({
  metadata: { eventId: EVENT_ID, seatInfo: 'VIP-1', expiration: 1000000, nonTransferable: true },
  mintNonce: 1, recipient: bob.address,
});
console.log(`Minted ticket ${mint1.data.ticketId.substring(0, 12)}... to Alice (seat A-1, royalty 10%)`);
console.log(`Minted ticket ${mint2.data.ticketId.substring(0, 12)}... to Bob (VIP, non-transferable)`);

bc.start(10000, () => {
  let lb = alice.lastBlock;
  console.log('\n--- Step 4: Final chain state ---');
  console.log(`Ticket ${mint1.data.ticketId.substring(0, 12)}... owner: ${bc.getClientName(lb.getTicketOwner(mint1.data.ticketId)) || lb.getTicketOwner(mint1.data.ticketId)}`);
  console.log(`Ticket ${mint2.data.ticketId.substring(0, 12)}... owner: ${bc.getClientName(lb.getTicketOwner(mint2.data.ticketId)) || lb.getTicketOwner(mint2.data.ticketId)}`);

  console.log('\n--- Step 5: Scanner verification at venue ---');
  let challenge = generateChallenge();

  let aliceKp = utils.generateKeypairFromMnemonic(
    'antenna dwarf settle sleep must wool ocean once banana tiger distance gate great similar chief cheap dinner dolphin picture swing twenty two file nuclear',
    'Alice_pswd'
  );
  let bobKp = utils.generateKeypairFromMnemonic(
    'antenna dwarf settle sleep must wool ocean once banana tiger distance gate great similar chief cheap dinner dolphin picture swing twenty two file nuclear',
    'Bob_pswd'
  );
  let scalperKp = utils.generateKeypairFromMnemonic(
    'antenna dwarf settle sleep must wool ocean once banana tiger distance gate great similar chief cheap dinner dolphin picture swing twenty two file nuclear',
    'Scalper_pswd'
  );

  let sig1 = utils.sign(bobKp.private, challenge);
  let r1 = verifyEntry(lb, mint1.data.ticketId, bobKp.public, challenge, sig1);
  console.log(`Bob scans ticket A-1: ${r1.allowed ? 'ALLOW' : 'DENY'} - ${r1.reason}`);

  let sig2 = utils.sign(bobKp.private, challenge);
  let r2 = verifyEntry(lb, mint2.data.ticketId, bobKp.public, challenge, sig2);
  console.log(`Bob scans VIP-1: ${r2.allowed ? 'ALLOW' : 'DENY'} - ${r2.reason}`);

  let sig3 = utils.sign(scalperKp.private, challenge);
  let r3 = verifyEntry(lb, mint1.data.ticketId, scalperKp.public, challenge, sig3);
  console.log(`Scalper tries A-1: ${r3.allowed ? 'ALLOW' : 'DENY'} - ${r3.reason}`);

  console.log('\n--- Balances ---');
  organizer.showAllBalances();
  console.log('\n=== Demo complete ===');
});

setTimeout(() => {
  console.log('\n--- Step 2: Alice transfers ticket A-1 to Bob (secondary sale with royalty) ---');
  alice.transferTicketWithRoyalty({
    ticketId: mint1.data.ticketId,
    recipient: bob.address,
    salePrice: 50,
    royaltyRate: 0.1,
    organizerAddress: organizer.address,
  });
  console.log('Alice posted transfer with salePrice=50, royalty=5 to organizer');
}, 500);

setTimeout(() => {
  console.log('\n--- Step 3: Scalper tries invalid transfer of A-1 (not owner) ---');
  try {
    scalper.transferTicket({ ticketId: mint1.data.ticketId, recipient: scalper.address });
    console.log('Scalper posted transfer (will be rejected by miners)');
  } catch (e) {
    console.log(`Scalper transfer error: ${e.message}`);
  }
}, 1500);

setTimeout(() => {
  console.log('\n--- Step 3b: Bob tries to transfer VIP (non-transferable) ---');
  try {
    bob.transferTicket({ ticketId: mint2.data.ticketId, recipient: alice.address });
    console.log('Bob posted VIP transfer (will be rejected by miners)');
  } catch (e) {
    console.log(`VIP transfer error: ${e.message}`);
  }
}, 2000);
