// The attack log: the attacks a creature makes on its own turn, kept on its
// token (data.turnAttacks). The multiple attack penalty and the weapon traits
// that build momentum read it:
//   - Strikes keep their 1st/2nd/3rd buttons, and the card says when the
//     button clicked isn't the attack the log counts;
//   - spell attacks and attack-trait skill actions (Grapple, Trip...) take
//     the penalty from the log, ticked in the roll prompt, where it can be
//     unticked;
//   - forceful, sweep, twin and backswing apply from the earlier attacks;
//   - each logged attack's card has a button that takes it back out of the
//     log, for a roll made by mistake. Nothing here is enforced.
// onTurnStart records whose turn it is, with a key of its own, in a campaign
// variable that every client can read at once. A log counts only on its own
// creature's turn, so a reaction on another creature's turn (Reactive
// Strike) neither counts nor takes the penalty, and a new turn starts a new
// log. Loaded as one of the ruleset's scripts (ruleset.config.json,
// otherSettings.scripts), so it shares common.js's scope at runtime.

const TURN_VARIABLE = "pf2eTurn";

// The turn being taken: { key, tokenId, recordId }, or null outside an
// encounter
function getCurrentTurn() {
  try {
    if (typeof api?.getCampaignVariable !== "function") return null;
    const turn = api.getCampaignVariable(TURN_VARIABLE);
    if (!turn || typeof turn !== "object" || !turn.key || !turn.tokenId) return null;
    const state = getEncounterState();
    if (state && state.round <= 0) return null;
    return turn;
  } catch (e) {
    return null;
  }
}

// Records whose turn starts (onTurnStart); without a token, no one's
// (onEncounterEnd). A character's turn also matches its record, which its
// sheet rolls from; an NPC's only its token, as tokens of one NPC share it.
function setCurrentTurn(token) {
  if (typeof api?.setCampaignVariable !== "function") return;
  api.setCampaignVariable(
    TURN_VARIABLE,
    token?._id
      ? {
          key: `${token._id}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
          tokenId: token._id,
          recordId: token.recordType === "characters" ? token.recordId || null : null,
        }
      : {},
  );
}

function isCreaturesTurn(turn, creature) {
  if (!turn || !creature) return false;
  const ids = [creature._id, creature.recordId, creature.record?._id].filter(Boolean);
  return ids.includes(turn.tokenId) || (!!turn.recordId && ids.includes(turn.recordId));
}

// The creature's log for the turn it is taking: { turnKey, attacks }, or
// null when it isn't its turn
function getOpenTurnAttackLog(...creatures) {
  const turn = getCurrentTurn();
  if (!turn || !creatures.some((creature) => isCreaturesTurn(turn, creature))) return null;
  const log = creatures
    .map((creature) => creature?.data?.turnAttacks || creature?.record?.data?.turnAttacks)
    .find((entry) => entry && typeof entry === "object" && entry.turnKey === turn.key);
  const uncounted = getUncountedAttackIds(...creatures);
  const attacks = (Array.isArray(log?.attacks) ? log.attacks : []).filter(
    (attack) => !uncounted.has(attack?.id),
  );
  return { turnKey: turn.key, attacks };
}

// The attacks taken back out of the log with the card's button (a roll made
// by mistake): data.turnAttackSkips, entry id -> turn key
function getUncountedAttackIds(...creatures) {
  const ids = new Set();
  creatures.forEach((creature) => {
    const skips = creature?.data?.turnAttackSkips || creature?.record?.data?.turnAttackSkips;
    if (skips && typeof skips === "object") {
      Object.keys(skips).forEach((id) => ids.add(id));
    }
  });
  return ids;
}

// The attack this is on the creature's turn (1, 2 or 3 for the third and
// later), or null when it isn't its turn
function getNextAttackNumber(...creatures) {
  const log = getOpenTurnAttackLog(...creatures);
  return log ? Math.min(log.attacks.length + 1, 3) : null;
}

function getOrdinal(n) {
  return ["", "1st", "2nd", "3rd"][n] || `${n}th`;
}

// The card's line when the button clicked isn't the attack the log counts,
// or ""
function getAttackNumberHint(attackNumber, nextAttackNumber) {
  if (!nextAttackNumber || !attackNumber || attackNumber === nextAttackNumber) return "";
  return `This is the ${getOrdinal(nextAttackNumber)} attack this turn, rolled as the ${getOrdinal(attackNumber)}.`;
}

// The multiple attack penalty for the attack the log counts: one ticked
// modifier, or [] for the first attack or off the creature's turn
function getTurnMapModifiers(attackNumber) {
  if (attackNumber !== 2 && attackNumber !== 3) return [];
  return [
    {
      name: `Multiple Attack Penalty (${getOrdinal(attackNumber)} attack)`,
      type: "",
      value: attackNumber === 2 ? -5 : -10,
      active: true,
      isPenalty: true,
    },
  ];
}

// What the roll records in the log when its result comes in (metadata
// turnAttack), or null when it isn't the creature's turn. The log so far
// rides along, as the result handler can't read the token, and a reroll of
// the same attack replaces its entry by id.
function getTurnAttackMetadata(token, creature, attack = {}) {
  if (!token?._id) return null;
  const log = getOpenTurnAttackLog(token, creature);
  if (!log) return null;
  return {
    tokenId: token._id,
    recordType: token.recordType,
    log,
    entry: {
      id: `${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
      kind: attack.kind || "strike",
      name: attack.name || "",
      weaponId: attack.weaponId || null,
      baseItem: attack.baseItem || null,
      targetId: attack.targetId || null,
    },
  };
}

// The values that log an attack's result (degree: -1 to 2, null without a
// DC), or null
function getLoggedTurnAttackValues(turnAttack, degree = null) {
  if (!turnAttack?.log || !turnAttack?.entry?.id) return null;
  const attacks = (turnAttack.log.attacks || []).filter(
    (attack) => attack?.id !== turnAttack.entry.id,
  );
  attacks.push({ ...turnAttack.entry, degree: Number.isFinite(degree) ? degree : null });
  return { "data.turnAttacks": { ...turnAttack.log, attacks } };
}

function logTurnAttack(turnAttack, degree = null) {
  const values = getLoggedTurnAttackValues(turnAttack, degree);
  if (!values) return;
  api.setValuesOnTokenById(turnAttack.tokenId, turnAttack.recordType, values);
}

// The card's button that takes the attack back out of the log, for a roll
// made by mistake, or "". It only marks the entry's id, so it never has to
// read the token, and a log written later from an older copy still leaves the
// attack out.
function getUncountAttackButton(turnAttack) {
  const id = turnAttack?.entry?.id;
  if (!id || !turnAttack?.tokenId || !turnAttack?.log?.turnKey) return "";
  const values = JSON.stringify({ [`data.turnAttackSkips.${id}`]: turnAttack.log.turnKey });
  return `\`\`\`Remove_From_Attack_Count
api.setValuesOnTokenById(${JSON.stringify(turnAttack.tokenId)}, ${JSON.stringify(turnAttack.recordType)}, ${values});
api.showNotification("This attack no longer counts toward the multiple attack penalty this turn.", "yellow", "Attack Log");
\`\`\``;
}

// The modifiers forceful, sweep, twin and backswing give a Strike from the
// earlier attacks this turn: { attack, damage }. targetId is the Strike's
// target (sweep needs one); damageDice is the weapon's number of damage dice.
function getMomentumTraitModifiers(log, weapon, { targetId = null, damageDice = 0 } = {}) {
  const result = { attack: [], damage: [] };
  if (!log || !weapon) return result;
  const traits = (Array.isArray(weapon.data?.traits) ? weapon.data.traits : []).map((trait) =>
    String(typeof trait === "string" ? trait : trait?.name || "").trim().toLowerCase(),
  );
  const withThisWeapon = log.attacks.filter(
    (attack) => attack.kind === "strike" && weapon._id && attack.weaponId === weapon._id,
  );

  // Forceful: the 2nd attack with it adds 1 per damage die, later ones 2
  if (traits.includes("forceful") && withThisWeapon.length > 0 && damageDice > 0) {
    result.damage.push({
      name: "Forceful",
      type: "circumstance",
      value: withThisWeapon.length === 1 ? damageDice : damageDice * 2,
      active: true,
    });
  }

  // Twin: after attacking with a different weapon of the same type
  const baseItem = getBaseItemSlug(weapon);
  if (
    traits.includes("twin") &&
    damageDice > 0 &&
    log.attacks.some(
      (attack) =>
        attack.kind === "strike" &&
        attack.baseItem === baseItem &&
        attack.weaponId !== weapon._id,
    )
  ) {
    result.damage.push({ name: "Twin", type: "circumstance", value: damageDice, active: true });
  }

  // Sweep: after attempting to attack a different target with it
  if (
    traits.includes("sweep") &&
    targetId &&
    withThisWeapon.some((attack) => attack.targetId && attack.targetId !== targetId)
  ) {
    result.attack.push({ name: "Sweep", type: "circumstance", value: 1, active: true });
  }

  // Backswing: the attack after a miss with it
  const last = withThisWeapon[withThisWeapon.length - 1];
  if (traits.includes("backswing") && last && last.degree !== null && last.degree <= 0) {
    result.attack.push({ name: "Backswing", type: "circumstance", value: 1, active: true });
  }
  return result;
}
