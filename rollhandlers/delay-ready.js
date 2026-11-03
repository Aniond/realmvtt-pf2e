// Delay and Ready (Player Core pg. 416-417; roadmap H26).
//
//   - Delay: when its turn begins, a creature pauses it. It's out of the
//     initiative order (it can't use reactions) until it returns, at the end
//     of any other creature's turn, and its initiative moves there for good.
//     Effects at the start and end of its turn happen at Delay: the turn
//     hooks have run them by the time the GM ends the delayed turn, so they
//     don't run again on the turn it returns to in that round. A creature
//     that stays out a whole round loses the delayed turn's actions and keeps
//     its initiative. The delay is kept on the token (data.delaying: { round,
//     returned }), cleared at the end of the turn it returns to or when its
//     turn comes round again; Realm can't take a token out of the tracker,
//     so it stays there and the GM ends the delayed turn
//   - Return: the delaying creature's initiative goes just after the
//     creature whose turn it is, so the tracker's next turn is its own
//     (checked live: the tracker orders turns by initiative as they change)
//   - Ready: a card with the action and trigger the player types, usable as
//     a reaction before their next turn. A readied attack takes the multiple
//     attack penalty the creature has when it Readies: the card names the
//     attack button to use. Nothing is kept: reactions aren't tracked

// The creature's delay, { round, returned }, or null when it isn't delaying
function getDelayState(token) {
  const delay = token?.data?.delaying ?? token?.record?.data?.delaying;
  if (!delay || typeof delay !== "object") return null;
  const round = parseInt(delay.round, 10);
  return Number.isFinite(round) ? { round, returned: delay.returned === true } : null;
}

// The initiative just after the creature whose turn it is: halfway to the
// next one below it in the tracker
function getReturnInitiative(currentInitiative, otherInitiatives) {
  const below = (otherInitiatives || []).filter(
    (initiative) => Number.isFinite(initiative) && initiative < currentInitiative,
  );
  const next = below.length > 0 ? Math.max(...below) : currentInitiative - 1;
  return Math.round(((currentInitiative + next) / 2) * 1000) / 1000;
}

// Delay, from the creature's sheet or the GM's panel: the delay on the token
// and a card with the Return button. The GM ends the turn.
function delayTurn(token) {
  if (!token?._id) {
    api.showNotification("Delay needs the creature's token on the scene.", "yellow", "Delay");
    return;
  }
  const name = getTokenDisplayName(token);
  getCombatRound((round) => {
    if (!round) {
      api.showNotification("Delay is for an encounter's turn order.", "yellow", "Delay");
      return;
    }
    if (!isCreaturesTurn(getCurrentTurn(), token)) {
      api.showNotification(`It isn't ${name}'s turn: Delay is used as their turn begins.`, "yellow", "Delay");
    }
    api.setValuesOnTokenById(token._id, "tokens", { "data.delaying": { round, returned: false } });
    api.sendMessage(
      `**:free-action: ${name} Delays.** They're out of the initiative order and can't use reactions until they return, at the end of another creature's turn. End the turn to go on.\n${getChatButton("Return", token, "returnFromDelay(token)")}`,
      undefined,
      [],
      [],
      token,
    );
  });
}

// Return: the delaying creature's initiative just after the creature whose
// turn it is, in one write
function returnFromDelay(token) {
  const name = getTokenDisplayName(token);
  const delay = getDelayState(token);
  if (!delay || delay.returned) {
    api.showNotification(`${name} isn't delaying.`, "yellow", "Delay");
    return;
  }
  const turn = getCurrentTurn();
  if (!turn || turn.tokenId === token._id) {
    api.showNotification(`${name} returns at the end of another creature's turn.`, "yellow", "Delay");
    return;
  }
  api.getCombatTracker((tracker) => {
    const ids = tracker?.tokenIds || [];
    const others = getMinionSceneTokens().filter((other) => ids.includes(other._id) && other._id !== token._id);
    const current = others.find((other) => other._id === turn.tokenId);
    const currentInitiative = parseFloat(current?.data?.initiative);
    if (!Number.isFinite(currentInitiative)) {
      api.showNotification("The creature whose turn it is has no initiative.", "yellow", "Delay");
      return;
    }
    const initiative = getReturnInitiative(
      currentInitiative,
      others.filter((other) => other._id !== current._id).map((other) => parseFloat(other.data?.initiative)),
    );
    api.setValuesOnTokenById(token._id, "tokens", {
      "data.initiative": initiative,
      "data.delaying": { round: delay.round, returned: true },
    });
    api.sendMessage(
      `**:free-action: ${name} returns** to the initiative order, acting after ${getTokenDisplayName(current)}.`,
      undefined,
      [],
      [],
      token,
    );
  });
}

// At the start of a creature's turn: one that Delayed a whole round without
// returning loses the delayed turn's actions and keeps its initiative
function endFullRoundDelay(token, round) {
  const delay = getDelayState(token);
  const turnRound = parseInt(round, 10);
  if (!delay || delay.returned || !Number.isFinite(turnRound) || turnRound <= delay.round) return;
  api.setValuesOnTokenById(token._id, "tokens", { "data.delaying": null });
  api.sendMessage(
    `**${getTokenDisplayName(token)}** Delayed a whole round without returning: the delayed turn's actions are lost, and their initiative stays where it was.`,
    undefined,
    [],
    [],
    token,
  );
}

// At the end of a creature's turn, what the turn hooks do:
//   - repeat: false on the turn it returned to in the round it Delayed (its
//     turn's start and end effects happened at Delay)
//   - sustain: false on the delayed turn (it Sustains on the turn it returns
//     to)
//   - clear: the delay ends with the turn it returned to
function getDelayTurnEnd(token, round) {
  const delay = getDelayState(token);
  if (!delay) return { repeat: true, sustain: true, clear: false };
  if (!delay.returned) return { repeat: true, sustain: false, clear: false };
  return { repeat: parseInt(round, 10) !== delay.round, sustain: true, clear: true };
}

// Ready (2 actions, concentrate): the action and trigger the player types,
// and for a readied attack the button for the multiple attack penalty the
// creature has now. The GM ends the turn.
function readyAction(token, record = null) {
  if (!token?._id) {
    api.showNotification("Ready needs the creature's token on the scene.", "yellow", "Ready");
    return;
  }
  const name = getTokenDisplayName(token);
  const attackNumber = getNextAttackNumber(record || token, token) || 1;
  api.showValuePrompt("Ready", "The action, and its trigger", (value) => {
    const text = `${value ?? ""}`.trim();
    if (!text) return;
    api.sendMessage(
      `**:two-actions: ${name} Readies:** ${text}\n${getReadyNote(attackNumber)}`,
      undefined,
      [],
      [],
      token,
    );
  });
}

// The Ready card's rules line, and the attack button a readied Strike uses
function getReadyNote(attackNumber) {
  const note = "If the trigger happens before their next turn, they can use the action as a reaction. Their turn ends.";
  if (attackNumber < 2) return note;
  const penalty = attackNumber === 2 ? "-5, -4 agile" : "-10, -8 agile";
  return `${note} A readied attack takes the multiple attack penalty they have now: the ${getOrdinal(attackNumber)} attack button (${penalty}).`;
}
