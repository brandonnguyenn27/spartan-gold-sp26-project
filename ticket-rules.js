"use strict";

const { isOrganizer, getOrganizer } = require('./ticket-organizers.js');

const TICKET_TX_TYPE = Object.freeze({
  MINT: 'MINT_TICKET',
  TRANSFER: 'TRANSFER_TICKET',
});

const MAX_TICKETS_PER_EVENT = 10000;

function isTicketTx(data) {
  if (!data || typeof data.type !== 'string') return false;
  return data.type === TICKET_TX_TYPE.MINT || data.type === TICKET_TX_TYPE.TRANSFER;
}

function validateMetadataShape(m) {
  if (!m || typeof m !== 'object') {
    return { ok: false, reason: 'Mint ticket metadata must be an object.' };
  }
  if (typeof m.eventId !== 'string' || m.eventId.length === 0) {
    return { ok: false, reason: 'metadata.eventId must be a non-empty string.' };
  }
  if (typeof m.seatInfo !== 'string' || m.seatInfo.length === 0) {
    return { ok: false, reason: 'metadata.seatInfo must be a non-empty string.' };
  }
  if (!Number.isInteger(m.expiration)) {
    return { ok: false, reason: 'metadata.expiration must be an integer block height.' };
  }
  if (m.uri !== undefined && typeof m.uri !== 'string') {
    return { ok: false, reason: 'metadata.uri must be a string when present.' };
  }
  if (m.nonTransferable !== undefined && typeof m.nonTransferable !== 'boolean') {
    return { ok: false, reason: 'metadata.nonTransferable must be boolean when present.' };
  }
  if (m.royaltyRate !== undefined) {
    if (typeof m.royaltyRate !== 'number' || m.royaltyRate < 0 || m.royaltyRate > 1) {
      return { ok: false, reason: 'metadata.royaltyRate must be a number between 0 and 1.' };
    }
  }
  return { ok: true };
}

function validateMintTicket(block, tx) {
  const d = tx.data;
  if (d.type !== TICKET_TX_TYPE.MINT) {
    return { ok: false, reason: 'Invalid ticket tx type for mint validation.' };
  }
  if (!d.ticketId || typeof d.ticketId !== 'string') {
    return { ok: false, reason: 'Mint ticket must include data.ticketId.' };
  }
  const mdCheck = validateMetadataShape(d.metadata);
  if (!mdCheck.ok) return mdCheck;
  if (!d.recipient || typeof d.recipient !== 'string') {
    return { ok: false, reason: 'Mint ticket must include data.recipient.' };
  }
  if (!isOrganizer(d.metadata.eventId, tx.from)) {
    return { ok: false, reason: `Address is not organizer for event ${d.metadata.eventId}.` };
  }
  if (block.ticketRegistry.has(d.ticketId) || block.ticketMetadata.has(d.ticketId)) {
    return { ok: false, reason: `Ticket id already exists: ${d.ticketId}.` };
  }
  const count = block.eventMintCounts.get(d.metadata.eventId) || 0;
  if (count >= MAX_TICKETS_PER_EVENT) {
    return { ok: false, reason: `Mint cap reached for event ${d.metadata.eventId}.` };
  }
  return { ok: true };
}

function applyMintTicket(block, tx) {
  const d = tx.data;
  const meta = { ...d.metadata };
  block.ticketRegistry.set(d.ticketId, d.recipient);
  block.ticketMetadata.set(d.ticketId, meta);
  const count = block.eventMintCounts.get(meta.eventId) || 0;
  block.eventMintCounts.set(meta.eventId, count + 1);
}

function validateTransferTicket(block, tx) {
  const d = tx.data;
  if (d.type !== TICKET_TX_TYPE.TRANSFER) {
    return { ok: false, reason: 'Invalid ticket tx type for transfer validation.' };
  }
  if (!d.ticketId || typeof d.ticketId !== 'string') {
    return { ok: false, reason: 'Transfer ticket must include data.ticketId.' };
  }
  if (!d.recipient || typeof d.recipient !== 'string') {
    return { ok: false, reason: 'Transfer ticket must include data.recipient.' };
  }
  const owner = block.ticketRegistry.get(d.ticketId);
  if (owner === undefined) {
    return { ok: false, reason: `Unknown ticket id: ${d.ticketId}.` };
  }
  if (owner !== tx.from) {
    return { ok: false, reason: 'Sender does not own this ticket.' };
  }
  const meta = block.ticketMetadata.get(d.ticketId);
  if (!meta) {
    return { ok: false, reason: 'Ticket has no on-chain metadata (corrupt state).' };
  }
  if (meta.nonTransferable === true) {
    return { ok: false, reason: 'Ticket is non-transferable.' };
  }
  if (Number.isInteger(meta.expiration) && block.chainLength > meta.expiration) {
    return { ok: false, reason: 'Ticket has expired for transfers.' };
  }
  const rate = meta.royaltyRate || 0;
  if (rate > 0) {
    if (d.salePrice === undefined || typeof d.salePrice !== 'number' || d.salePrice < 0) {
      return { ok: false, reason: 'Transfer requires data.salePrice when royaltyRate > 0.' };
    }
    const royaltyDue = Math.floor(d.salePrice * rate);
    const organizerAddr = getOrganizer(meta.eventId);
    if (!organizerAddr) {
      return { ok: false, reason: `No organizer registered for event ${meta.eventId}.` };
    }
    const paidToOrganizer = (tx.outputs || []).reduce((sum, o) => {
      return o.address === organizerAddr ? sum + o.amount : sum;
    }, 0);
    if (paidToOrganizer < royaltyDue) {
      return { ok: false, reason: `Royalty underpaid: need ${royaltyDue}, got ${paidToOrganizer}.` };
    }
  }
  return { ok: true };
}

function applyTransferTicket(block, tx) {
  const d = tx.data;
  block.ticketRegistry.set(d.ticketId, d.recipient);
}

function validateTicketTransaction(block, tx) {
  const t = tx.data.type;
  if (t === TICKET_TX_TYPE.MINT) return validateMintTicket(block, tx);
  if (t === TICKET_TX_TYPE.TRANSFER) return validateTransferTicket(block, tx);
  return { ok: false, reason: `Unknown ticket transaction type: ${t}.` };
}

function applyTicketTransaction(block, tx) {
  if (tx.data.type === TICKET_TX_TYPE.MINT) applyMintTicket(block, tx);
  else if (tx.data.type === TICKET_TX_TYPE.TRANSFER) applyTransferTicket(block, tx);
}

module.exports = {
  TICKET_TX_TYPE,
  MAX_TICKETS_PER_EVENT,
  isTicketTx,
  validateTicketTransaction,
  applyTicketTransaction,
};
