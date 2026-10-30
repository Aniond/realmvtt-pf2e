// Combat riders: monster Strike riders, "can't use again for 1d4 rounds"
// recharges, and the rogue's Debilitating Strike.
//
//   - Strike riders (Monster Core): a Strike that lists Grab, Knockdown or
//     Push gets the rider on a hit, as a button that rolls the monster's
//     Grapple, Trip or Shove against the attack's target. These attempts
//     neither apply nor count toward the multiple attack penalty. A Strike
//     that lists Trip gets the monster's own Trip, with the penalty. The
//     maneuver card's outcomes and buttons do the rest. Constrict has its own
//     action, with its damage and basic save, in the module's data
//   - Recharges: an ability whose text says it can't be used again for 1d4
//     rounds gets a Start Recharge button. It rolls the rounds and keeps them
//     on the token (data.recharges); at the start of the monster's turn in
//     the round it's ready, the GM is told. The encounter's end clears them
//   - Debilitating Strike (Player Core pg. 162): with the rogue's toggle on,
//     a hit on an off-guard target lists the debilitations, until the end of
//     the rogue's next turn; Double Debilitation applies two
//
// "Until the end of <applier>'s next turn" is `{ value, unit:
// "end_applier_turn" }`: the value counts the applier's turn ends (checked
// live). On its own turn that's 2 (1 would end with this turn); on someone
// else's turn, a reaction, it's 1.

// ---------------------------------------------------------------- Strike riders

// By rider: the maneuver the monster rolls, and whether it's free of the
// multiple attack penalty (Monster Core's riders are; a listed Trip is the
// monster's own action)
const STRIKE_RIDERS = {
  grab: {
    name: "Grab",
    action: "Grapple",
    noMap: true,
    text: "1 action: the monster Grapples the target with the body part it attacked with. Or it extends a grab it already has to the end of its next turn.",
  },
  "improved-grab": {
    name: "Improved Grab",
    action: "Grapple",
    noMap: true,
    text: "Free action: the monster Grapples the target with the body part it attacked with.",
  },
  knockdown: { name: "Knockdown", action: "Trip", noMap: true, text: "1 action: the monster Trips the target." },
  "improved-knockdown": { name: "Improved Knockdown", action: "Trip", noMap: true, text: "Free action: the monster Trips the target." },
  push: {
    name: "Push",
    action: "Shove",
    noMap: true,
    text: "1 action: the monster Shoves the target. A distance listed with Push replaces the distance on a success.",
  },
  "improved-push": {
    name: "Improved Push",
    action: "Shove",
    noMap: true,
    text: "Free action: the monster Shoves the target. A distance listed with Push replaces the distance on a success.",
  },
  trip: { name: "Trip", action: "Trip", noMap: false, text: "The monster can Trip the target (its multiple attack penalty applies)." },
};

// A Strike's riders as slugs: the module stores names ("Grab"), the attack
// editor slugs ("improved-grab")
function getStrikeRiders(weapon) {
  const effects = weapon?.data?.attackEffects;
  if (!Array.isArray(effects)) return [];
  return [...new Set(effects.map((effect) => toSlug(String(effect || ""))).filter((slug) => STRIKE_RIDERS[slug]))];
}

// The attack card's lines on a hit (or with no DC to grade against): each
// rider's text, and a button that rolls its maneuver for the monster
function getStrikeRiderLines(metadata, degree) {
  if (degree !== null && degree !== undefined && !(degree >= 1)) return [];
  const riders = Array.isArray(metadata?.strikeRiders) ? metadata.strikeRiders : [];
  const lines = [];
  riders.forEach((slug) => {
    const rider = STRIKE_RIDERS[slug];
    if (!rider) return;
    lines.push(`**${rider.name}:** ${rider.text}`);
    lines.push(getStrikeRiderButton(rider, metadata?.tokenId, metadata?.targetId));
  });
  return lines;
}

function getStrikeRiderButton(rider, monsterId, targetId) {
  const fence = "```";
  const call = `rollStrikeRider(${JSON.stringify(String(monsterId || ""))}, ${JSON.stringify(String(targetId || ""))}, ${JSON.stringify(rider.action)}, ${rider.noMap})`;
  return `${fence}Roll_${rider.action}_(${rider.name.replace(/\s+/g, "_")})\n${call};\n${fence}`;
}

// A token on the scene by id: the current one, or another
function findSceneToken(tokenId) {
  if (!tokenId) return null;
  const current = api.getToken();
  if (current?._id === tokenId) return current;
  return (api.getOtherTokens() || []).map((t) => t?.token || t).find((t) => t?._id === tokenId) || null;
}

// The rider's button: the monster's Athletics check for the maneuver,
// against the attack's target, through performSkillAction (so the maneuver
// card's outcomes and Apply buttons follow)
function rollStrikeRider(monsterId, targetId, actionName, noMap) {
  const monster = findSceneToken(monsterId);
  if (!monster) {
    api.showNotification("The monster's token isn't on the scene.", "yellow", "Notice");
    return;
  }
  performSkillAction(monster, "athletics", actionName, true, {
    ...(targetId ? { targetId } : {}),
    ...(noMap ? { noMultipleAttackPenalty: true } : {}),
  });
}

// ---------------------------------------------------------------- Recharges

// "can't use X again for 1d4 rounds", "can't Burble again", "cannot ...",
// "can't be used again", and formulas with a modifier (1d6+1); not "again for
// 24 hours"
const RECHARGE_PATTERN = /(?:can'?t|cannot)\s[^.]*?again\s+for\s+(\d+d\d+(?:\s*[+-]\s*\d+)?|\d+)\s*rounds?/i;

// An ability's recharge: the formula, or ""
function getRechargeFormula(action) {
  const text = api.richTextToMarkdown ? api.richTextToMarkdown(action?.data?.description || "") : `${action?.data?.description || ""}`;
  // A button reads as its label ("1d4_Rounds" -> "1d4 Rounds")
  const plain = `${text}`.replace(/```([^\n]*)\n[\s\S]*?```/g, (block, label) => ` ${label.replace(/_/g, " ")} `);
  const match = plain.match(RECHARGE_PATTERN);
  return match ? match[1].replace(/\s+/g, "") : "";
}

function getRechargeButton(action) {
  const formula = getRechargeFormula(action);
  const token = api.getToken();
  if (!formula || !token?._id) return "";
  return getChatButton(
    `Start_Recharge_(${formula}_rounds)`,
    token,
    `startRecharge(token, ${JSON.stringify(action?.name || "The ability")}, ${JSON.stringify(formula)})`,
  );
}

// The token's recharges without this ability, plus it ready at readyRound
function getRechargeValues(token, name, readyRound) {
  const others = (Array.isArray(token?.data?.recharges) ? token.data.recharges : []).filter((entry) => entry?.name !== name);
  return { "data.recharges": [...others, { name, readyRound }] };
}

// Rolls the rounds; in combat, keeps the round it's ready in
function startRecharge(token, name, formula) {
  if (!token?._id) return;
  const rounds = /^\d+$/.test(formula) ? parseInt(formula, 10) : parseInt(api.rollInstant(formula)?.total, 10) || 1;
  getCombatRound((round) => {
    const who = getCreatureName(token);
    if (!round) {
      api.sendMessage(`${who} can't use ${name} again for ${rounds} round${rounds > 1 ? "s" : ""} (${formula}).`, undefined, [], [], token);
      return;
    }
    const readyRound = round + rounds;
    api.setValuesOnTokenById(token._id, token.recordType, getRechargeValues(token, name, readyRound));
    api.sendMessage(
      `${who} can't use ${name} again for ${rounds} round${rounds > 1 ? "s" : ""} (${formula}): [gm]ready at the start of its turn in round ${readyRound}.[/gm]`,
      undefined,
      [],
      [],
      token,
    );
  });
}

// Turn start: the abilities ready this round, and the recharges left
function getReadyRecharges(token, round) {
  const entries = Array.isArray(token?.data?.recharges) ? token.data.recharges : [];
  if (!round || entries.length === 0) return null;
  const ready = entries.filter((entry) => parseInt(entry?.readyRound, 10) <= round);
  if (ready.length === 0) return null;
  return { ready: ready.map((entry) => entry.name), left: entries.filter((entry) => !ready.includes(entry)) };
}

function runTurnStartRecharges(token, round) {
  const result = getReadyRecharges(token, round);
  if (!result) return;
  api.setValuesOnTokenById(token._id, token.recordType, { "data.recharges": result.left });
  api.sendMessage(`[gm]${getCreatureName(token)} can use ${result.ready.join(" and ")} again.[/gm]`, undefined, [], [], token);
}

// The encounter's end: recharges don't carry into the next one
function clearEncounterRecharges(tokens) {
  (tokens || []).forEach((token) => {
    if (Array.isArray(token?.data?.recharges) && token.data.recharges.length > 0) {
      api.setValuesOnTokenById(token._id, token.recordType, { "data.recharges": [] });
    }
  });
}

// ---------------------------------------------------------------- Debilitating Strike

// Whether a toggle (its predicate value) is on
function isToggleOn(record, value) {
  return (record?.data?.toggles || []).some(
    (toggle) => toggle?.data?.toggled === true && `${toggle?.data?.predicateValue || ""}`.trim() === value,
  );
}

// How many debilitations a Strike applies: 0 with the toggle off, 1, or 2
// with Double Debilitation
function getDebilitationCount(record) {
  if (!isToggleOn(record, "debilitation")) return 0;
  return hasFeatNamed(record, "Double Debilitation") ? 2 : 1;
}

// Feats that add debilitations to choose from
const DEBILITATION_FEATS = [
  "Vicious Debilitations",
  "Precise Debilitations",
  "Tactical Debilitations",
  "Methodical Debilitations",
  "Eldritch Debilitations",
  "Bloody Debilitation",
  "Critical Debilitation",
];

function hasDebilitationFeats(record) {
  return DEBILITATION_FEATS.some((name) => hasFeatNamed(record, name));
}

// The value that lasts until the end of the creature's next turn: 2 on its
// own turn (or out of combat), 1 on someone else's (a reaction)
function getEndOfNextTurnValue(...creatures) {
  const turn = getCurrentTurn();
  if (!turn) return 2;
  return creatures.some((creature) => isCreaturesTurn(turn, creature)) ? 2 : 1;
}

// The attack card's lines: a hit on an off-guard target (Debilitating
// Strike's trigger), the debilitations and a button for enfeebled
function getDebilitationLines(metadata, degree) {
  const count = parseInt(metadata?.debilitation, 10) || 0;
  if (!(degree >= 1) || !count || !metadata?.isOffGuard) return [];
  const applier = { id: metadata?.tokenId || "", name: metadata?.tokenName || "the rogue" };
  const duration = parseInt(metadata?.debilitationDuration, 10) === 1 ? 1 : 2;
  return [
    `**Debilitating Strike** (free action, until the end of your next turn): ${count > 1 ? "two debilitations (Double Debilitation; removing one removes both)" : "one debilitation"}:`,
    "- a -10-foot status penalty to its Speeds",
    "- enfeebled 1",
    ...(metadata?.debilitationFeats ? ["- or one from your debilitation feats"] : []),
    getRiderButton(
      "Apply_Enfeebled_1",
      metadata?.targetId,
      metadata?.targetName,
      `applyDebilitation(token, "Enfeebled", ${JSON.stringify(applier)}, ${duration})`,
    ),
  ];
}

// A button for the target: the one the attack was against, or the selected
// token when it had none
function getRiderButton(label, targetId, targetName, call) {
  if (targetId) return getManeuverButton(label, targetId, targetName || "the target", call);
  const fence = "```";
  return `${fence}${label}\n(api.getSelectedOrDroppedToken() || []).map((t) => t?.token || t).forEach((token) => ${call});\n${fence}`;
}

function applyDebilitation(token, condition, applier = {}, value = 2) {
  if (!token) return;
  api.addEffect(condition, token, { value: value === 1 ? 1 : 2, unit: "end_applier_turn" }, { value: 1, _id: applier.id, name: applier.name });
}
