"use strict";

const { isOrganizer, getOrganizer } = require('./ticket-organizers.js');

const TICKET_TX_TYPE = Object.freeze({
  MINT: 'MINT_TICKET',
  TRANSFER: 'TRANSFER_TICKET',
});

const MAX_TICKETS_PER_EVENT = 10000;

function fail(reason) {
  return { ok: false, reason };
}

function ok() {
  return { ok: true };
}

function isTicketTx(data) {
  return Boolean(data && typeof data.type === 'string' &&
    (data.type === TICKET_TX_TYPE.MINT || data.type === TICKET_TX_TYPE.TRANSFER));
}

function validateMetadataShape(m) {
  if (!m || typeof m !== 'object') {
    return fail('Mint ticket metadata must be an object.');
  }
  const shapeRules = [
    [typeof m.eventId === 'string' && m.eventId.length > 0, 'metadata.eventId must be a non-empty string.'],
    [typeof m.seatInfo === 'string' && m.seatInfo.length > 0, 'metadata.seatInfo must be a non-empty string.'],
    [Number.isInteger(m.expiration), 'metadata.expiration must be an integer block height.'],
    [m.uri === undefined || typeof m.uri === 'string', 'metadata.uri must be a string when present.'],
    [m.nonTransferable === undefined || typeof m.nonTransferable === 'boolean', 'metadata.nonTransferable must be boolean when present.'],
    [
      m.royaltyRate === undefined ||
        (typeof m.royaltyRate === 'number' && m.royaltyRate >= 0 && m.royaltyRate <= 1),
      'metadata.royaltyRate must be a number between 0 and 1.',
    ],
  ];
  for (const [passes, reason] of shapeRules) {
    if (!passes) return fail(reason);
  }
  return ok();
}

function nonEmptyString(x) {
  return typeof x === 'string' && x.length > 0;
}

function validateMintTicket(block, tx) {
  const d = tx.data;
  if (d.type !== TICKET_TX_TYPE.MINT) {
    return fail('Invalid ticket tx type for mint validation.');
  }
  if (!nonEmptyString(d.ticketId)) {
    return fail('Mint ticket must include data.ticketId.');
  }
  const mdCheck = validateMetadataShape(d.metadata);
  if (!mdCheck.ok) return mdCheck;
  if (!nonEmptyString(d.recipient)) {
    return fail('Mint ticket must include data.recipient.');
  }
  if (!isOrganizer(d.metadata.eventId, tx.from)) {
    return fail(`Address is not organizer for event ${d.metadata.eventId}.`);
  }
  if (block.ticketRegistry.has(d.ticketId) || block.ticketMetadata.has(d.ticketId)) {
    return fail(`Ticket id already exists: ${d.ticketId}.`);
  }
  const count = block.eventMintCounts.get(d.metadata.eventId) || 0;
  if (count >= MAX_TICKETS_PER_EVENT) {
    return fail(`Mint cap reached for event ${d.metadata.eventId}.`);
  }
  return ok();
}

function applyMintTicket(block, tx) {
  const d = tx.data;
  const meta = { ...d.metadata };
  block.ticketRegistry.set(d.ticketId, d.recipient);
  block.ticketMetadata.set(d.ticketId, meta);
  const count = block.eventMintCounts.get(meta.eventId) || 0;
  block.eventMintCounts.set(meta.eventId, count + 1);
}

function sumPaidToOrganizer(outputs, organizerAddr) {
  return (outputs || []).reduce((sum, o) =>
    (o.address === organizerAddr ? sum + o.amount : sum), 0);
}

function validateTransferRoyalty(block, tx, meta, d) {
  const rate = meta.royaltyRate || 0;
  if (rate <= 0) return ok();
  if (d.salePrice === undefined || typeof d.salePrice !== 'number' || d.salePrice < 0) {
    return fail('Transfer requires data.salePrice when royaltyRate > 0.');
  }
  const royaltyDue = Math.floor(d.salePrice * rate);
  const organizerAddr = getOrganizer(meta.eventId);
  if (!organizerAddr) {
    return fail(`No organizer registered for event ${meta.eventId}.`);
  }
  const paidToOrganizer = sumPaidToOrganizer(tx.outputs, organizerAddr);
  if (paidToOrganizer < royaltyDue) {
    return fail(`Royalty underpaid: need ${royaltyDue}, got ${paidToOrganizer}.`);
  }
  return ok();
}

function validateTransferTicket(block, tx) {
  const d = tx.data;
  if (d.type !== TICKET_TX_TYPE.TRANSFER) {
    return fail('Invalid ticket tx type for transfer validation.');
  }
  if (!nonEmptyString(d.ticketId)) {
    return fail('Transfer ticket must include data.ticketId.');
  }
  if (!nonEmptyString(d.recipient)) {
    return fail('Transfer ticket must include data.recipient.');
  }
  const owner = block.ticketRegistry.get(d.ticketId);
  if (owner === undefined) {
    return fail(`Unknown ticket id: ${d.ticketId}.`);
  }
  if (owner !== tx.from) {
    return fail('Sender does not own this ticket.');
  }
  const meta = block.ticketMetadata.get(d.ticketId);
  if (!meta) {
    return fail('Ticket has no on-chain metadata (corrupt state).');
  }
  if (meta.nonTransferable === true) {
    return fail('Ticket is non-transferable.');
  }
  if (Number.isInteger(meta.expiration) && block.chainLength > meta.expiration) {
    return fail('Ticket has expired for transfers.');
  }
  return validateTransferRoyalty(block, tx, meta, d);
}

function applyTransferTicket(block, tx) {
  const d = tx.data;
  block.ticketRegistry.set(d.ticketId, d.recipient);
}

const VALIDATORS = {
  [TICKET_TX_TYPE.MINT]: validateMintTicket,
  [TICKET_TX_TYPE.TRANSFER]: validateTransferTicket,
};

const APPLIERS = {
  [TICKET_TX_TYPE.MINT]: applyMintTicket,
  [TICKET_TX_TYPE.TRANSFER]: applyTransferTicket,
};

function validateTicketTransaction(block, tx) {
  const validate = VALIDATORS[tx.data.type];
  if (!validate) {
    return fail(`Unknown ticket transaction type: ${tx.data.type}.`);
  }
  return validate(block, tx);
}

function applyTicketTransaction(block, tx) {
  const apply = APPLIERS[tx.data.type];
  if (apply) apply(block, tx);
}

module.exports = {
  TICKET_TX_TYPE,
  MAX_TICKETS_PER_EVENT,
  isTicketTx,
  validateTicketTransaction,
  applyTicketTransaction,
};
