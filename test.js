"use strict";

const assert = require('chai').assert;

const utils = require('./utils.js');

const Block = require('./block.js');
const Blockchain = require('./blockchain.js');
const Client = require('./client.js');
const Miner = require('./miner.js');
const Transaction = require('./transaction.js');
const TicketTransaction = require('./ticket-transaction.js');
const { registerOrganizer, getOrganizer } = require('./ticket-organizers.js');
const { verifyEntry, generateChallenge } = require('./scanner.js');

// Generating keypair for multiple test cases, since key generation is slow.
const kp = utils.generateKeypair();
let addr = utils.calcAddress(kp.public);

const kp2 = utils.generateKeypair();
let addr2 = utils.calcAddress(kp2.public);

// Adding a POW target that should be trivial to match.
const EASY_POW_TARGET = BigInt("0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");

// Setting blockchain configuration.  (Usually this would be done during the creation of the genesis block.)
Blockchain.createInstance({ blockClass: Block, transactionClass: TicketTransaction });

describe('utils', () => {
  describe('.verifySignature', () => {
    let sig = utils.sign(kp.private, "hello");
    it('should accept a valid signature', () => {
      assert.ok(utils.verifySignature(kp.public, "hello", sig));
    });

    it('should reject an invalid signature', () => {
      assert.ok(!utils.verifySignature(kp.public, "goodbye", sig));
    });
  });
});

describe("Transaction", () => {
  let outputs = [{amount: 20, address: "ffff"},
                 {amount: 40, address: "face"}];
  let t = new Transaction({from: addr, pubKey: kp.public, outputs: outputs, fee: 1, nonce: 1});
  t.sign(kp.private);

  describe("#totalOutput", () => {
    it('should sum up all of the outputs and the transaction fee', () => {
      assert.equal(t.totalOutput(), 61);
    });
  });

});

describe('Block', () => {
  let prevBlock = new Block("8e7912");
  prevBlock.balances = new Map([ [addr, 500], ["ffff", 100], ["face", 99] ]);

  let outputs = [{amount: 20, address: "ffff"}, {amount: 40, address: "face"}];
  let t = new Transaction({from: addr, pubKey: kp.public, outputs: outputs, fee: 1, nonce: 0});

  describe('#addTransaction', () => {
    it("should fail if a transaction is not signed.", () => {
      let b = new Block(addr, prevBlock);
      let tx = new Transaction(t);
      assert.isFalse(b.addTransaction(tx));
    });

    it("should fail if the 'from' account does not have enough gold.", () => {
      let b = new Block(addr, prevBlock);
      let tx = new Transaction(t);
      tx.outputs = [{amount:20000000000000, address: "ffff"}];
      tx.sign(kp.private);
      assert.isFalse(b.addTransaction(tx));
    });

    it("should transfer gold from the sender to the receivers.", () => {
      let b = new Block(addr, prevBlock);
      let tx = new Transaction(t);
      tx.sign(kp.private);
      b.addTransaction(tx);
      assert.equal(b.balances.get(addr), 500-61); // Extra 1 for transaction fee.
      assert.equal(b.balances.get("ffff"), 100+20);
      assert.equal(b.balances.get("face"), 99+40);
    });

    it("should ignore any transactions that were already received in a previous block.", () => {
      let b = new Block(addr, prevBlock);
      let tx = new Transaction(t);
      tx.sign(kp.private);
      b.addTransaction(tx);

      // Attempting to add transaction to subsequent block.
      let b2 = new Block(addr, b);
      b2.addTransaction(tx);
      assert.isEmpty(b2.transactions);
    });
  });

  describe('#rerun', () => {
    it("should redo transactions to return to the same block.", () => {
      let b = new Block(addr, prevBlock);

      let tx = new Transaction(t);
      tx.sign(kp.private);
      b.addTransaction(tx);

      // Wiping out balances and then rerunning the block
      b.balances = new Map();
      b.rerun(prevBlock);

      // Verifying prevBlock's balances are unchanged.
      assert.equal(prevBlock.balances.get(addr), 500);
      assert.equal(prevBlock.balances.get("ffff"), 100);
      assert.equal(prevBlock.balances.get("face"), 99);

      // Verifying b's balances are correct.
      assert.equal(b.balances.get(addr), 500-61);
      assert.equal(b.balances.get("ffff"), 100+20);
      assert.equal(b.balances.get("face"), 99+40);
    });

    it("should take a serialized/deserialized block and get back the same block.", () => {
      let b = new Block(addr, prevBlock);

      let tx = new Transaction(t);
      tx.sign(kp.private);
      b.addTransaction(tx);

      let hash = b.hashVal();

      let serialBlock = b.serialize();
      let o = JSON.parse(serialBlock);
      let b2 = Blockchain.deserializeBlock(o);
      b2.rerun(prevBlock);

      // Verify hashes still match
      assert.equal(b2.hashVal(), hash);

      assert.equal(b2.balances.get(addr), 500-61);
      assert.equal(b2.balances.get("ffff"), 100+20);
      assert.equal(b2.balances.get("face"), 99+40);
    });
  });

  describe('ticket registry', () => {
    const eventId = 'test-event-1';

    before(() => {
      registerOrganizer(eventId, addr);
    });

    const expFar = 1000000;

    it('accepts a mint and records the recipient', () => {
      let b = new Block(addr, prevBlock);
      let mint = TicketTransaction.createMint({
        from: addr,
        nonce: 0,
        pubKey: kp.public,
        metadata: { eventId, seatInfo: '1A', expiration: expFar },
        mintNonce: 0,
        recipient: addr2,
      });
      mint.sign(kp.private);
      assert.isTrue(b.addTransaction(mint));
      assert.equal(b.getTicketOwner(mint.data.ticketId), addr2);
      assert.equal(b.eventMintCounts.get(eventId), 1);
      assert.deepEqual(b.ticketMetadata.get(mint.data.ticketId), mint.data.metadata);
    });

    it('rejects duplicate ticket id mint', () => {
      let b = new Block(addr, prevBlock);
      let mint = TicketTransaction.createMint({
        from: addr,
        nonce: 0,
        pubKey: kp.public,
        metadata: { eventId, seatInfo: '1A', expiration: expFar },
        mintNonce: 0,
        recipient: addr2,
      });
      mint.sign(kp.private);
      assert.isTrue(b.addTransaction(mint));
      let dup = TicketTransaction.createMint({
        from: addr,
        nonce: 1,
        pubKey: kp.public,
        metadata: { eventId, seatInfo: '1A', expiration: expFar },
        mintNonce: 0,
        recipient: addr2,
      });
      dup.sign(kp.private);
      assert.isFalse(b.addTransaction(dup));
    });

    it('accepts transfer from owner and updates registry', () => {
      let b = new Block(addr, prevBlock);
      let mint = TicketTransaction.createMint({
        from: addr,
        nonce: 0,
        pubKey: kp.public,
        metadata: { eventId, seatInfo: 'X', expiration: expFar },
        mintNonce: 10,
        recipient: addr2,
      });
      mint.sign(kp.private);
      assert.isTrue(b.addTransaction(mint));
      let tid = mint.data.ticketId;
      let xfer = TicketTransaction.createTransfer({
        from: addr2,
        nonce: 0,
        pubKey: kp2.public,
        ticketId: tid,
        recipient: addr,
        fee: 0,
      });
      xfer.sign(kp2.private);
      assert.isTrue(b.addTransaction(xfer));
      assert.equal(b.getTicketOwner(tid), addr);
    });

    it('rejects transfer when non-transferable', () => {
      let b = new Block(addr, prevBlock);
      let mint = TicketTransaction.createMint({
        from: addr,
        nonce: 0,
        pubKey: kp.public,
        metadata: { eventId, seatInfo: 'VIP', expiration: expFar, nonTransferable: true },
        mintNonce: 11,
        recipient: addr2,
      });
      mint.sign(kp.private);
      assert.isTrue(b.addTransaction(mint));
      let tid = mint.data.ticketId;
      let xfer = TicketTransaction.createTransfer({
        from: addr2,
        nonce: 0,
        pubKey: kp2.public,
        ticketId: tid,
        recipient: addr,
      });
      xfer.sign(kp2.private);
      assert.isFalse(b.addTransaction(xfer));
    });

    it('rejects transfer after expiration block height', () => {
      let b1 = new Block(addr, prevBlock);
      let mint = TicketTransaction.createMint({
        from: addr,
        nonce: 0,
        pubKey: kp.public,
        metadata: { eventId, seatInfo: 'EXP', expiration: 1 },
        mintNonce: 12,
        recipient: addr2,
      });
      mint.sign(kp.private);
      assert.isTrue(b1.addTransaction(mint));
      let tid = mint.data.ticketId;
      let b2 = new Block(addr, b1);
      let xfer = TicketTransaction.createTransfer({
        from: addr2,
        nonce: 0,
        pubKey: kp2.public,
        ticketId: tid,
        recipient: addr,
      });
      xfer.sign(kp2.private);
      assert.isFalse(b2.addTransaction(xfer));
    });

    it('rerun restores ticketRegistry and ticketMetadata after wipe', () => {
      let b = new Block(addr, prevBlock);
      let mint = TicketTransaction.createMint({
        from: addr,
        nonce: 0,
        pubKey: kp.public,
        metadata: { eventId, seatInfo: '2B', expiration: expFar },
        mintNonce: 1,
        recipient: addr2,
      });
      mint.sign(kp.private);
      b.addTransaction(mint);
      let tid = mint.data.ticketId;
      b.ticketRegistry = new Map();
      b.ticketMetadata = new Map();
      b.eventMintCounts = new Map();
      b.transactions = new Map([[mint.id, mint]]);
      b.balances = new Map(prevBlock.balances);
      b.nextNonce = new Map(prevBlock.nextNonce);
      assert.isTrue(b.rerun(prevBlock));
      assert.equal(b.getTicketOwner(tid), addr2);
      assert.deepEqual(b.ticketMetadata.get(tid), mint.data.metadata);
    });

    it('serialize/deserialize preserves registry and metadata after rerun', () => {
      let b = new Block(addr, prevBlock);
      let mint = TicketTransaction.createMint({
        from: addr,
        nonce: 0,
        pubKey: kp.public,
        metadata: { eventId, seatInfo: '3C', expiration: expFar },
        mintNonce: 2,
        recipient: addr2,
      });
      mint.sign(kp.private);
      b.addTransaction(mint);
      let tid = mint.data.ticketId;
      let o = JSON.parse(b.serialize());
      let b2 = Blockchain.deserializeBlock(o);
      assert.isTrue(b2.rerun(prevBlock));
      assert.equal(b2.getTicketOwner(tid), addr2);
      assert.deepEqual(b2.ticketMetadata.get(tid), mint.data.metadata);
      assert.equal(b2.hashVal(), b.hashVal());
    });
  });
});

describe('TicketTransaction', () => {
  it('has stable id for same mint fields after sign', () => {
    let a = TicketTransaction.createMint({
      from: addr,
      nonce: 0,
      pubKey: kp.public,
      metadata: { eventId: 'e', seatInfo: 'z', expiration: 99 },
      mintNonce: 3,
      recipient: addr2,
    });
    a.sign(kp.private);
    let b = TicketTransaction.createMint({
      from: addr,
      nonce: 0,
      pubKey: kp.public,
      metadata: { eventId: 'e', seatInfo: 'z', expiration: 99 },
      mintNonce: 3,
      recipient: addr2,
    });
    b.sign(kp.private);
    assert.equal(a.id, b.id);
  });

  it('round-trips through Blockchain.makeTransaction', () => {
    let tx = TicketTransaction.createMint({
      from: addr,
      nonce: 5,
      pubKey: kp.public,
      metadata: { eventId: 'e2', seatInfo: 's', expiration: 100 },
      mintNonce: 0,
      recipient: addr2,
    });
    tx.sign(kp.private);
    let json = JSON.parse(JSON.stringify(tx));
    let tx2 = Blockchain.makeTransaction(json);
    assert.equal(tx2.id, tx.id);
    assert.isTrue(tx2.validSignature());
  });
});

describe('Week 3 — royalties and scanner', () => {
  const eventId = 'royalty-event';
  const expFar = 1000000;
  let prevBlock;
  let organizerAddr;

  before(() => {
    organizerAddr = addr;
    registerOrganizer(eventId, organizerAddr);
    prevBlock = new Block("8e7912");
    prevBlock.balances = new Map([ [addr, 500], [addr2, 300] ]);
  });

  describe('royalty enforcement', () => {
    it('accepts transfer with correct royalty payment', () => {
      let b = new Block(addr, prevBlock);
      let mint = TicketTransaction.createMint({
        from: addr, nonce: 0, pubKey: kp.public,
        metadata: { eventId, seatInfo: 'R1', expiration: expFar, royaltyRate: 0.1 },
        mintNonce: 100, recipient: addr2,
      });
      mint.sign(kp.private);
      assert.isTrue(b.addTransaction(mint));
      let tid = mint.data.ticketId;
      let royalty = Math.floor(50 * 0.1);
      let xfer = TicketTransaction.createTransfer({
        from: addr2, nonce: 0, pubKey: kp2.public,
        ticketId: tid, recipient: addr, salePrice: 50,
        outputs: [{ amount: royalty, address: organizerAddr }],
      });
      xfer.sign(kp2.private);
      assert.isTrue(b.addTransaction(xfer));
      assert.equal(b.getTicketOwner(tid), addr);
      assert.equal(b.balanceOf(organizerAddr), 500 + royalty);
    });

    it('rejects transfer when royalty is underpaid', () => {
      let b = new Block(addr, prevBlock);
      let mint = TicketTransaction.createMint({
        from: addr, nonce: 0, pubKey: kp.public,
        metadata: { eventId, seatInfo: 'R2', expiration: expFar, royaltyRate: 0.1 },
        mintNonce: 101, recipient: addr2,
      });
      mint.sign(kp.private);
      assert.isTrue(b.addTransaction(mint));
      let tid = mint.data.ticketId;
      let xfer = TicketTransaction.createTransfer({
        from: addr2, nonce: 0, pubKey: kp2.public,
        ticketId: tid, recipient: addr, salePrice: 50,
        outputs: [{ amount: 1, address: organizerAddr }],
      });
      xfer.sign(kp2.private);
      assert.isFalse(b.addTransaction(xfer));
    });

    it('rejects transfer missing salePrice when royaltyRate > 0', () => {
      let b = new Block(addr, prevBlock);
      let mint = TicketTransaction.createMint({
        from: addr, nonce: 0, pubKey: kp.public,
        metadata: { eventId, seatInfo: 'R3', expiration: expFar, royaltyRate: 0.05 },
        mintNonce: 102, recipient: addr2,
      });
      mint.sign(kp.private);
      assert.isTrue(b.addTransaction(mint));
      let tid = mint.data.ticketId;
      let xfer = TicketTransaction.createTransfer({
        from: addr2, nonce: 0, pubKey: kp2.public,
        ticketId: tid, recipient: addr,
      });
      xfer.sign(kp2.private);
      assert.isFalse(b.addTransaction(xfer));
    });

    it('allows transfer with no royalty when royaltyRate is 0 or absent', () => {
      let b = new Block(addr, prevBlock);
      let mint = TicketTransaction.createMint({
        from: addr, nonce: 0, pubKey: kp.public,
        metadata: { eventId, seatInfo: 'R4', expiration: expFar },
        mintNonce: 103, recipient: addr2,
      });
      mint.sign(kp.private);
      assert.isTrue(b.addTransaction(mint));
      let tid = mint.data.ticketId;
      let xfer = TicketTransaction.createTransfer({
        from: addr2, nonce: 0, pubKey: kp2.public,
        ticketId: tid, recipient: addr,
      });
      xfer.sign(kp2.private);
      assert.isTrue(b.addTransaction(xfer));
    });
  });

  describe('scanner verifyEntry', () => {
    it('ALLOW for valid owner with correct signature', () => {
      let b = new Block(addr, prevBlock);
      let mint = TicketTransaction.createMint({
        from: addr, nonce: 0, pubKey: kp.public,
        metadata: { eventId, seatInfo: 'S1', expiration: expFar },
        mintNonce: 200, recipient: addr2,
      });
      mint.sign(kp.private);
      b.addTransaction(mint);
      let tid = mint.data.ticketId;
      let challenge = generateChallenge();
      let sig = utils.sign(kp2.private, challenge);
      let result = verifyEntry(b, tid, kp2.public, challenge, sig);
      assert.isTrue(result.allowed);
    });

    it('DENY when signer is not the owner', () => {
      let b = new Block(addr, prevBlock);
      let mint = TicketTransaction.createMint({
        from: addr, nonce: 0, pubKey: kp.public,
        metadata: { eventId, seatInfo: 'S2', expiration: expFar },
        mintNonce: 201, recipient: addr2,
      });
      mint.sign(kp.private);
      b.addTransaction(mint);
      let tid = mint.data.ticketId;
      let challenge = generateChallenge();
      let sig = utils.sign(kp.private, challenge);
      let result = verifyEntry(b, tid, kp.public, challenge, sig);
      assert.isFalse(result.allowed);
      assert.include(result.reason, 'not the ticket owner');
    });

    it('DENY for unknown ticket', () => {
      let b = new Block(addr, prevBlock);
      let challenge = generateChallenge();
      let sig = utils.sign(kp.private, challenge);
      let result = verifyEntry(b, 'nonexistent', kp.public, challenge, sig);
      assert.isFalse(result.allowed);
      assert.include(result.reason, 'Unknown');
    });

    it('DENY for expired ticket', () => {
      let b1 = new Block(addr, prevBlock);
      let mint = TicketTransaction.createMint({
        from: addr, nonce: 0, pubKey: kp.public,
        metadata: { eventId, seatInfo: 'S3', expiration: 1 },
        mintNonce: 202, recipient: addr2,
      });
      mint.sign(kp.private);
      b1.addTransaction(mint);
      let tid = mint.data.ticketId;
      let b2 = new Block(addr, b1);
      let challenge = generateChallenge();
      let sig = utils.sign(kp2.private, challenge);
      let result = verifyEntry(b2, tid, kp2.public, challenge, sig);
      assert.isFalse(result.allowed);
      assert.include(result.reason, 'expired');
    });

    it('DENY for invalid signature', () => {
      let b = new Block(addr, prevBlock);
      let mint = TicketTransaction.createMint({
        from: addr, nonce: 0, pubKey: kp.public,
        metadata: { eventId, seatInfo: 'S4', expiration: expFar },
        mintNonce: 203, recipient: addr2,
      });
      mint.sign(kp.private);
      b.addTransaction(mint);
      let tid = mint.data.ticketId;
      let result = verifyEntry(b, tid, kp2.public, 'challenge', 'badsig');
      assert.isFalse(result.allowed);
      assert.include(result.reason, 'Invalid signature');
    });

    it('ALLOW with note for non-transferable VIP ticket', () => {
      let b = new Block(addr, prevBlock);
      let mint = TicketTransaction.createMint({
        from: addr, nonce: 0, pubKey: kp.public,
        metadata: { eventId, seatInfo: 'VIP', expiration: expFar, nonTransferable: true },
        mintNonce: 204, recipient: addr2,
      });
      mint.sign(kp.private);
      b.addTransaction(mint);
      let tid = mint.data.ticketId;
      let challenge = generateChallenge();
      let sig = utils.sign(kp2.private, challenge);
      let result = verifyEntry(b, tid, kp2.public, challenge, sig);
      assert.isTrue(result.allowed);
      assert.include(result.reason, 'non-transferable');
    });
  });
});

describe('Week 4 — security audit', () => {
  const eventId = 'sec-event';
  const expFar = 1000000;
  let prevBlock;

  before(() => {
    registerOrganizer(eventId, addr);
    prevBlock = new Block("8e7912");
    prevBlock.balances = new Map([ [addr, 500], [addr2, 300] ]);
  });

  describe('double-spend and ownership', () => {
    it('second transfer of same ticket fails after ownership changed', () => {
      let b = new Block(addr, prevBlock);
      let mint = TicketTransaction.createMint({
        from: addr, nonce: 0, pubKey: kp.public,
        metadata: { eventId, seatInfo: 'DS1', expiration: expFar },
        mintNonce: 300, recipient: addr2,
      });
      mint.sign(kp.private);
      assert.isTrue(b.addTransaction(mint));
      let tid = mint.data.ticketId;
      let xfer1 = TicketTransaction.createTransfer({
        from: addr2, nonce: 0, pubKey: kp2.public,
        ticketId: tid, recipient: addr,
      });
      xfer1.sign(kp2.private);
      assert.isTrue(b.addTransaction(xfer1));
      assert.equal(b.getTicketOwner(tid), addr);
      let xfer2 = TicketTransaction.createTransfer({
        from: addr2, nonce: 1, pubKey: kp2.public,
        ticketId: tid, recipient: addr,
      });
      xfer2.sign(kp2.private);
      assert.isFalse(b.addTransaction(xfer2));
    });

    it('transfer from non-owner (wrong from) is rejected', () => {
      let b = new Block(addr, prevBlock);
      let mint = TicketTransaction.createMint({
        from: addr, nonce: 0, pubKey: kp.public,
        metadata: { eventId, seatInfo: 'DS2', expiration: expFar },
        mintNonce: 301, recipient: addr2,
      });
      mint.sign(kp.private);
      assert.isTrue(b.addTransaction(mint));
      let tid = mint.data.ticketId;
      let xfer = TicketTransaction.createTransfer({
        from: addr, nonce: 1, pubKey: kp.public,
        ticketId: tid, recipient: addr,
      });
      xfer.sign(kp.private);
      assert.isFalse(b.addTransaction(xfer));
    });

    it('replay of old signed transfer after ownership change fails', () => {
      let b = new Block(addr, prevBlock);
      let mint = TicketTransaction.createMint({
        from: addr, nonce: 0, pubKey: kp.public,
        metadata: { eventId, seatInfo: 'DS3', expiration: expFar },
        mintNonce: 302, recipient: addr2,
      });
      mint.sign(kp.private);
      assert.isTrue(b.addTransaction(mint));
      let tid = mint.data.ticketId;
      let xfer1 = TicketTransaction.createTransfer({
        from: addr2, nonce: 0, pubKey: kp2.public,
        ticketId: tid, recipient: addr,
      });
      xfer1.sign(kp2.private);
      assert.isTrue(b.addTransaction(xfer1));
      let replay = TicketTransaction.createTransfer({
        from: addr2, nonce: 0, pubKey: kp2.public,
        ticketId: tid, recipient: addr,
      });
      replay.sign(kp2.private);
      assert.isFalse(b.addTransaction(replay));
    });
  });

  describe('mint abuse', () => {
    it('non-organizer mint is rejected', () => {
      let b = new Block(addr, prevBlock);
      let mint = TicketTransaction.createMint({
        from: addr2, nonce: 0, pubKey: kp2.public,
        metadata: { eventId, seatInfo: 'MA1', expiration: expFar },
        mintNonce: 400, recipient: addr2,
      });
      mint.sign(kp2.private);
      assert.isFalse(b.addTransaction(mint));
    });

    it('duplicate ticketId across blocks via rerun is rejected', () => {
      let b1 = new Block(addr, prevBlock);
      let mint = TicketTransaction.createMint({
        from: addr, nonce: 0, pubKey: kp.public,
        metadata: { eventId, seatInfo: 'MA2', expiration: expFar },
        mintNonce: 401, recipient: addr2,
      });
      mint.sign(kp.private);
      assert.isTrue(b1.addTransaction(mint));
      let tid = mint.data.ticketId;
      let b2 = new Block(addr, b1);
      let dup = TicketTransaction.createMint({
        from: addr, nonce: 1, pubKey: kp.public,
        metadata: { eventId, seatInfo: 'MA2', expiration: expFar },
        mintNonce: 401, recipient: addr,
      });
      dup.sign(kp.private);
      assert.isFalse(b2.addTransaction(dup));
      assert.equal(b2.getTicketOwner(tid), addr2);
    });
  });

  describe('royalty bypass', () => {
    it('transfer with royaltyRate > 0 but zero outputs is rejected', () => {
      let b = new Block(addr, prevBlock);
      let mint = TicketTransaction.createMint({
        from: addr, nonce: 0, pubKey: kp.public,
        metadata: { eventId, seatInfo: 'RB1', expiration: expFar, royaltyRate: 0.1 },
        mintNonce: 500, recipient: addr2,
      });
      mint.sign(kp.private);
      assert.isTrue(b.addTransaction(mint));
      let tid = mint.data.ticketId;
      let xfer = TicketTransaction.createTransfer({
        from: addr2, nonce: 0, pubKey: kp2.public,
        ticketId: tid, recipient: addr, salePrice: 100,
        outputs: [],
      });
      xfer.sign(kp2.private);
      assert.isFalse(b.addTransaction(xfer));
    });

    it('under-reported salePrice still requires correct royalty on reported amount', () => {
      let b = new Block(addr, prevBlock);
      let mint = TicketTransaction.createMint({
        from: addr, nonce: 0, pubKey: kp.public,
        metadata: { eventId, seatInfo: 'RB2', expiration: expFar, royaltyRate: 0.1 },
        mintNonce: 501, recipient: addr2,
      });
      mint.sign(kp.private);
      assert.isTrue(b.addTransaction(mint));
      let tid = mint.data.ticketId;
      let lowPrice = 10;
      let royalty = Math.floor(lowPrice * 0.1);
      let xfer = TicketTransaction.createTransfer({
        from: addr2, nonce: 0, pubKey: kp2.public,
        ticketId: tid, recipient: addr, salePrice: lowPrice,
        outputs: [{ amount: royalty, address: addr }],
      });
      xfer.sign(kp2.private);
      assert.isTrue(b.addTransaction(xfer));
    });
  });

  describe('scanner spoofing', () => {
    it('valid sig but wrong pubkey vs registry → DENY', () => {
      let b = new Block(addr, prevBlock);
      let mint = TicketTransaction.createMint({
        from: addr, nonce: 0, pubKey: kp.public,
        metadata: { eventId, seatInfo: 'SC1', expiration: expFar },
        mintNonce: 600, recipient: addr2,
      });
      mint.sign(kp.private);
      b.addTransaction(mint);
      let tid = mint.data.ticketId;
      let challenge = generateChallenge();
      let sig = utils.sign(kp.private, challenge);
      let result = verifyEntry(b, tid, kp.public, challenge, sig);
      assert.isFalse(result.allowed);
      assert.include(result.reason, 'not the ticket owner');
    });

    it('non-transferable ticket still valid for entry by owner', () => {
      let b = new Block(addr, prevBlock);
      let mint = TicketTransaction.createMint({
        from: addr, nonce: 0, pubKey: kp.public,
        metadata: { eventId, seatInfo: 'SC2', expiration: expFar, nonTransferable: true },
        mintNonce: 601, recipient: addr2,
      });
      mint.sign(kp.private);
      b.addTransaction(mint);
      let tid = mint.data.ticketId;
      let challenge = generateChallenge();
      let sig = utils.sign(kp2.private, challenge);
      let result = verifyEntry(b, tid, kp2.public, challenge, sig);
      assert.isTrue(result.allowed);
    });
  });

  describe('data integrity and sync', () => {
    it('serialize + deserialize + rerun equals original registry', () => {
      let b = new Block(addr, prevBlock);
      let mint = TicketTransaction.createMint({
        from: addr, nonce: 0, pubKey: kp.public,
        metadata: { eventId, seatInfo: 'DI1', expiration: expFar, royaltyRate: 0.05 },
        mintNonce: 700, recipient: addr2,
      });
      mint.sign(kp.private);
      b.addTransaction(mint);
      let tid = mint.data.ticketId;
      let royalty = Math.floor(20 * 0.05);
      let xfer = TicketTransaction.createTransfer({
        from: addr2, nonce: 0, pubKey: kp2.public,
        ticketId: tid, recipient: addr, salePrice: 20,
        outputs: [{ amount: royalty, address: addr }],
      });
      xfer.sign(kp2.private);
      b.addTransaction(xfer);
      let origOwner = b.getTicketOwner(tid);
      let origMeta = b.ticketMetadata.get(tid);
      let origHash = b.hashVal();
      let o = JSON.parse(b.serialize());
      let b2 = Blockchain.deserializeBlock(o);
      assert.isTrue(b2.rerun(prevBlock));
      assert.equal(b2.getTicketOwner(tid), origOwner);
      assert.deepEqual(b2.ticketMetadata.get(tid), origMeta);
      assert.equal(b2.hashVal(), origHash);
    });

    it('tampered transaction in deserialized block causes rerun failure', () => {
      let b = new Block(addr, prevBlock);
      let mint = TicketTransaction.createMint({
        from: addr, nonce: 0, pubKey: kp.public,
        metadata: { eventId, seatInfo: 'DI2', expiration: expFar },
        mintNonce: 701, recipient: addr2,
      });
      mint.sign(kp.private);
      b.addTransaction(mint);
      let o = JSON.parse(b.serialize());
      let txEntry = o.transactions[0];
      txEntry[1].data.recipient = 'TAMPERED_ADDRESS';
      let b2 = Blockchain.deserializeBlock(o);
      assert.isFalse(b2.rerun(prevBlock));
    });
  });
});

describe('Client', () => {
  let genesis = new Block("8e7912");
  genesis.balances = new Map([ [addr, 500], ["ffff", 100], ["face", 99] ]);
  let net = { broadcast: function(){} };

  let outputs = [{amount: 20, address: "ffff"}, {amount: 40, address: "face"}];
  let t = new Transaction({from: addr, pubKey: kp.public, outputs: outputs, fee: 1, nonce: 0});
  t.sign(kp.private);

  let outputs2 = [{amount: 10, address: "face"}];
  let t2 = new Transaction({from: addr, pubKey: kp.public, outputs: outputs2, fee: 1, nonce: 1});
  t2.sign(kp.private);

  let clint = new Client({net: net, startingBlock: genesis});
  clint.log = function(){};

  let miner = new Miner({name: "Minnie", net: net, startingBlock: genesis});
  miner.log = function(){};

  describe('#receiveBlock', () => {
    it("should reject any block without a valid proof.", () => {
      let b = new Block(addr, genesis);
      b.addTransaction(t);
      // Receiving and verifying block
      b = clint.receiveBlock(b);
      assert.isNull(b);
    });

    it("should store all valid blocks, but only change lastBlock if the newer block is better.", () => {
      let b = new Block(addr, genesis, EASY_POW_TARGET);
      b.addTransaction(t);
      // Finding a proof.
      miner.currentBlock = b;
      b.proof = 0;
      miner.findProof(true);
      // Receiving and verifying block
      clint.receiveBlock(b);
      assert.equal(clint.blocks.get(b.id), b);
      assert.equal(clint.lastBlock, b);

      let b2 = new Block(addr, b, EASY_POW_TARGET);
      b2.addTransaction(t2);
      // Finding a proof.
      miner.currentBlock = b2;
      b2.proof = 0;
      miner.findProof(true);
      // Receiving and verifying block
      clint.receiveBlock(b2);
      assert.equal(clint.blocks.get(b2.id), b2);
      assert.equal(clint.lastBlock, b2);

      let bAlt = new Block(addr, genesis, EASY_POW_TARGET);
      bAlt.addTransaction(t2);
      // Finding a proof.
      miner.currentBlock = bAlt;
      bAlt.proof = 0;
      miner.findProof(true);
      // Receiving and verifying block
      clint.receiveBlock(bAlt);
      assert.equal(clint.blocks.get(bAlt.id), bAlt);
      assert.equal(clint.lastBlock, b2);
    });
  });
});
