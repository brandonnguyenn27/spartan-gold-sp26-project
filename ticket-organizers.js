"use strict";

/**
 * Week 1 static allowlist: eventId -> organizer address (must match tx.from for mints).
 * Call registerOrganizer from drivers/tests; production can replace with genesis config later.
 */
const organizers = new Map();

function registerOrganizer(eventId, organizerAddress) {
  organizers.set(eventId, organizerAddress);
}

function getOrganizer(eventId) {
  return organizers.get(eventId);
}

function isOrganizer(eventId, address) {
  return organizers.get(eventId) === address;
}

module.exports = {
  registerOrganizer,
  getOrganizer,
  isOrganizer,
};
