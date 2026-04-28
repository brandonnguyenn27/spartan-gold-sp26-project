"use strict";

const utils = require('./utils.js');
const Transaction = require('./transaction.js');
const { TICKET_TX_TYPE } = require('./ticket-rules.js');

const TICKET_ID_PREFIX = 'TICKET_ID';

function makeTicketId({ eventId, seatInfo, mintNonce }) {
  const canonical = JSON.stringify({
    eventId: String(eventId),
    seatInfo: String(seatInfo),
    mintNonce: Number(mintNonce),
  });
  return utils.hash(TICKET_ID_PREFIX + canonical);
}

module.exports = class TicketTransaction extends Transaction {
  /**
   * Organizer signs; data.recipient is initial owner.
   */
  static createMint({ from, nonce, pubKey, metadata, mintNonce, recipient, fee = 0 }) {
    const ticketId = makeTicketId({
      eventId: metadata.eventId,
      seatInfo: metadata.seatInfo,
      mintNonce,
    });
    const exp = parseInt(String(metadata.expiration), 10);
    const data = {
      type: TICKET_TX_TYPE.MINT,
      ticketId,
      metadata: {
        eventId: String(metadata.eventId),
        seatInfo: String(metadata.seatInfo),
        expiration: exp,
        ...(metadata.uri !== undefined ? { uri: String(metadata.uri) } : {}),
        ...(metadata.nonTransferable === true ? { nonTransferable: true } : {}),
      },
      recipient,
    };
    return new TicketTransaction({ from, nonce, pubKey, outputs: [], fee, data });
  }

  /**
   * Current owner signs; data.recipient is new owner.
   */
  static createTransfer({ from, nonce, pubKey, ticketId, recipient, fee = 0, outputs = [] }) {
    const data = {
      type: TICKET_TX_TYPE.TRANSFER,
      ticketId,
      recipient,
    };
    return new TicketTransaction({ from, nonce, pubKey, outputs, fee, data });
  }
};

module.exports.makeTicketId = makeTicketId;
