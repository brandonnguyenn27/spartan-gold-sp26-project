"use strict";

const Blockchain = require('./blockchain.js');
const FakeNet = require('./fake-net.js');
const { registerOrganizer } = require('./ticket-organizers.js');

const EVENT_ID = 'evt-demo-1';

console.log('Ticket smoke: starting...');

let bc = Blockchain.createInstance({
  clients: [
    { name: 'Alice', amount: 233 },
    { name: 'Bob', amount: 99 },
    { name: 'Minnie', amount: 400, mining: true },
  ],
  mnemonic: 'antenna dwarf settle sleep must wool ocean once banana tiger distance gate great similar chief cheap dinner dolphin picture swing twenty two file nuclear',
  net: new FakeNet(),
  transactionClass: require('./ticket-transaction.js'),
});

let [alice, bob] = bc.getClients('Alice', 'Bob');
registerOrganizer(EVENT_ID, alice.address);

const meta = { eventId: EVENT_ID, seatInfo: 'A-1', expiration: 1000000 };
let mint = alice.mintTicket({ metadata: meta, mintNonce: 0, recipient: bob.address });

bc.start(8000, () => {
  console.log('Ticket registry on Alice last block:');
  console.log(Array.from(alice.lastBlock.ticketRegistry.entries()));
  console.log('Ticket metadata keys:', Array.from(alice.lastBlock.ticketMetadata.keys()));
  let owner = alice.lastBlock.getTicketOwner(mint.data.ticketId);
  console.log(`Owner of ${mint.data.ticketId}: ${owner} (expect Bob ${bob.address})`);
  let ownerAfter = alice.lastBlock.getTicketOwner(mint.data.ticketId);
  console.log(`Owner after transfer mined (if any): ${ownerAfter}`);
});

setTimeout(() => {
  bob.transferTicket({ ticketId: mint.data.ticketId, recipient: alice.address });
}, 500);
