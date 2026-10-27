// Trait-based action limits: the actions a creature uses and the spells it
// casts on its own turn, kept on its token (data.turnActions) for the same
// turn as the attack log (attack-log.js). Like the attack log, it suggests
// and never enforces: the card says when a use breaks a limit, and the roll
// or the effect still goes ahead.
//   - flourish, stance and overflow: one per round; hex and composition: one
//     per turn (a creature's own turn comes once a round, so its turn's log
//     covers both);
//   - finisher: no attack-trait actions for the rest of the turn, including
//     Strikes, spell attacks and maneuvers;
//   - press: only on the creature's turn, with a multiple attack penalty (an
//     attack already this turn);
//   - spellshape (legacy: metamagic): the next spell's card says it applies,
//     or that another action came first and wasted it;
//   - composition: a new one ends the one before, which the card says;
//   - stance: entering one ends the creature's other stance effects
//     (applyEffectButton).
// Loaded as one of the ruleset's scripts (ruleset.config.json,
// otherSettings.scripts), so it shares common.js's scope at runtime.

// The traits a use is logged with
const ACTION_LIMIT_TRAITS = [
  "attack",
  "composition",
  "finisher",
  "flourish",
  "hex",
  "metamagic",
  "overflow",
  "press",
  "spellshape",
  "stance",
];

// How long a composition can still be going, in rounds (Lingering
// Composition: up to 4)
const COMPOSITION_ROUNDS = 4;

// The creature's action log for the turn it is taking: { turnKey, uses }, or
// null when it isn't its turn
function getOpenTurnActionLog(...creatures) {
  const turn = getCurrentTurn();
  if (!turn || !creatures.some((creature) => isCreaturesTurn(turn, creature))) return null;
  const log = creatures
    .map((creature) => creature?.data?.turnActions || creature?.record?.data?.turnActions)
    .find((entry) => entry && typeof entry === "object" && entry.turnKey === turn.key);
  return { turnKey: turn.key, uses: Array.isArray(log?.uses) ? log.uses : [] };
}

// The time a log entry was made, from its id (`${Date.now()}-...`)
function getLogEntryTime(entry) {
  return parseInt(String(entry?.id || "").split("-")[0], 10) || 0;
}

function hasLimitTrait(use, trait) {
  return Array.isArray(use?.traits) && use.traits.includes(trait);
}

function isSpellshapeUse(use) {
  return hasLimitTrait(use, "spellshape") || hasLimitTrait(use, "metamagic");
}

// A use as the log keeps it: its name, whether it is an action or a spell,
// and the traits that limit it
function getActionLimitUse(name, traits, kind = "action") {
  const names = getTraitNameList(traits);
  return {
    id: `${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
    name: name || "",
    kind,
    traits: ACTION_LIMIT_TRAITS.filter((trait) => names.includes(trait)),
  };
}

// The first earlier use this turn with a trait, or null
function findTurnUse(log, trait) {
  return (log?.uses || []).find((use) => hasLimitTrait(use, trait)) || null;
}

// The card's line after a finisher this turn, for an attack-trait use or an
// attack roll, or ""
function getAfterFinisherWarning(log) {
  const finisher = findTurnUse(log, "finisher");
  return finisher
    ? `**No attacks after a finisher:** ${finisher.name} was used this turn.`
    : "";
}

// The card's lines for the limits a use breaks, from the creature's logs
// this turn (null off its turn). otherTurn: it is another creature's turn in
// an encounter, which only press cares about.
function getActionLimitWarnings(use, log, attackLog, otherTurn = false) {
  const warnings = [];
  if (hasLimitTrait(use, "press")) {
    if (otherTurn) {
      warnings.push("**Press only on your turn:** it needs your multiple attack penalty.");
    } else if (attackLog && attackLog.attacks.length === 0) {
      warnings.push("**Press needs a multiple attack penalty:** there's no attack yet this turn.");
    }
  }
  if (!log) return warnings;
  const limits = [
    ["flourish", "One flourish per round"],
    ["stance", "One stance action per round"],
    ["overflow", "One overflow impulse per round"],
    ["hex", "One hex per turn"],
    ["composition", "One composition per turn"],
  ];
  limits.forEach(([trait, label]) => {
    if (!hasLimitTrait(use, trait)) return;
    const earlier = findTurnUse(log, trait);
    if (earlier) {
      warnings.push(`**${label}:** ${earlier.name} was already used this turn.`);
    }
  });
  if (hasLimitTrait(use, "attack") || hasLimitTrait(use, "finisher")) {
    const warning = getAfterFinisherWarning(log);
    if (warning) warnings.push(warning);
  }
  return warnings;
}

// The spellshape for a spell being cast: the last spellshape since the last
// spell this turn, and whether it is still good (nothing else came between),
// or null
function getPendingSpellshape(log, attackLog) {
  const uses = log?.uses || [];
  let lastSpell = -1;
  uses.forEach((use, index) => {
    if (use.kind === "spell") lastSpell = index;
  });
  const since = uses.slice(lastSpell + 1);
  let shapeIndex = -1;
  since.forEach((use, index) => {
    if (isSpellshapeUse(use)) shapeIndex = index;
  });
  if (shapeIndex < 0) return null;
  const shape = since[shapeIndex];
  const time = getLogEntryTime(shape);
  const attackedSince = (attackLog?.attacks || []).some(
    (attack) => getLogEntryTime(attack) > time,
  );
  const actedSince = since.slice(shapeIndex + 1).length > 0;
  return { name: shape.name, wasted: attackedSince || actedSince };
}

// The spell card's line for a spellshape, or ""
function getSpellshapeLine(log, attackLog) {
  const shape = getPendingSpellshape(log, attackLog);
  if (!shape) return "";
  return shape.wasted
    ? `**Spellshape wasted:** another action came between ${shape.name} and this spell.`
    : `**Spellshape:** ${shape.name} applies to this spell.`;
}

// The composition card's line when the caster's earlier composition may
// still be going, or ""
function getCompositionEndsLine(creature, spellName, round) {
  const last = creature?.data?.lastComposition || creature?.record?.data?.lastComposition;
  if (!last?.name || last.name === spellName) return "";
  const lastRound = Number(last.round);
  if (Number.isFinite(lastRound) && Number.isFinite(round) && round - lastRound >= COMPOSITION_ROUNDS) {
    return "";
  }
  return `**One composition at a time:** if ${last.name} is still going, it ends now.`;
}

// The values that log a use (and, for a composition, remember it), or null
function getLoggedActionValues(log, use, round = null) {
  if (!log || !use) return null;
  const values = { "data.turnActions": { turnKey: log.turnKey, uses: [...log.uses, use] } };
  if (use.kind === "spell" && hasLimitTrait(use, "composition")) {
    values["data.lastComposition"] = { name: use.name, round };
  }
  return values;
}

// Checks a use on a card and logs it: { lines, use }, where lines are the
// card's warnings and notes. creature is the record the sheet rolls from,
// token its token; kind is "action" or "spell". Off the creature's turn it
// logs nothing.
function checkActionLimits(creature, token, name, traits, kind = "action") {
  const use = getActionLimitUse(name, traits, kind);
  const turn = getCurrentTurn();
  const log = token?._id ? getOpenTurnActionLog(creature, token) : null;
  const attackLog = token?._id ? getOpenTurnAttackLog(creature, token) : null;
  const otherTurn = !!turn && !log && !!token?._id;
  const lines = getActionLimitWarnings(use, log, attackLog, otherTurn);
  if (lines.length > 0) {
    api.showNotification(
      lines.map((line) => line.replace(/\*\*/g, "")).join(" "),
      "yellow",
      "Action Limits",
    );
  }
  const round = getEncounterState()?.round ?? null;
  if (kind === "spell") {
    const shapeLine = getSpellshapeLine(log, attackLog);
    if (shapeLine) lines.push(shapeLine);
    if (log && hasLimitTrait(use, "composition")) {
      const endsLine = getCompositionEndsLine(creature || token, use.name, round);
      if (endsLine) lines.push(endsLine);
    }
  }
  const values = getLoggedActionValues(log, use, round);
  if (values) {
    api.setValuesOnTokenById(token._id, token.recordType, values);
  }
  return { lines, use };
}

// The stance effects on a token other than the one being entered: a new
// stance ends the old one (stance trait)
function getOtherStanceEffects(token, stanceName) {
  const name = String(stanceName || "").trim().toLowerCase();
  if (!name.startsWith("stance: ")) return [];
  return (token?.effects || []).filter((effect) => {
    const other = String(effect?.name || "").trim().toLowerCase();
    return effect?._id && other.startsWith("stance: ") && other !== name;
  });
}
