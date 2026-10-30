// Combat riders: monster Strike riders, "can't use again for 1d4 rounds"
// recharges, and the rogue's Debilitating Strike.
//
//   - Strike riders (Monster Core): a Strike that lists Grab, Knockdown or
//     Push (or Trip) gets the rider's text and a button on a hit. Grab:
//     grabbed until the end of the monster's next turn. Knockdown and Trip:
//     prone. Push: 5 feet, 10 on a critical hit (a reminder; the GM moves the
//     token). The Improved versions are free actions. Constrict has its own
//     action, with its damage and basic save, in the module's data
//   - Recharges: an ability whose text says it can't be used again for 1d4
//     rounds gets a Start Recharge button. It rolls the rounds and keeps them
//     on the token (data.recharges); at the start of the monster's turn in
//     the round it's ready, the GM is told
//   - Debilitating Strike (Player Core pg. 162): with the rogue's toggle on,
//     a hit on an off-guard target lists the debilitations, until the end of
//     the rogue's next turn; Double Debilitation applies two
//
// "Until the end of <applier>'s next turn", applied on the applier's turn,
// is `{ value: 2, unit: "end_applier_turn" }`: the value counts the
// applier's turn ends (checked live), so 1 would end with this turn.
const UNTIL_END_OF_NEXT_TURN = { value: 2, unit: "end_applier_turn" };

// ---------------------------------------------------------------- Strike riders

const STRIKE_RIDERS = {
  grab: {
    name: "Grab",
    text: "1 action: the target is grabbed until the end of the monster's next turn.",
    condition: "Grabbed",
  },
  "improved-grab": {
    name: "Improved Grab",
    text: "Free action: the target is grabbed until the end of the monster's next turn.",
    condition: "Grabbed",
  },
  knockdown: { name: "Knockdown", text: "1 action: the monster knocks the target prone.", condition: "Prone" },
  "improved-knockdown": {
    name: "Improved Knockdown",
    text: "Free action: the monster knocks the target prone.",
    condition: "Prone",
  },
  trip: { name: "Trip", text: "The target falls prone.", condition: "Prone" },
  push: {
    name: "Push",
    text: "1 action: the target is pushed 5 feet away from the monster (10 feet on a critical hit).",
  },
  "improved-push": {
    name: "Improved Push",
    text: "Free action: the target is pushed 5 feet away from the monster (10 feet on a critical hit).",
  },
};

// A Strike's riders as slugs: the module stores names ("Grab"), the attack
// editor slugs ("improved-grab")
function getStrikeRiders(weapon) {
  const effects = weapon?.data?.attackEffects;
  if (!Array.isArray(effects)) return [];
  return [...new Set(effects.map((effect) => toSlug(String(effect || ""))).filter((slug) => STRIKE_RIDERS[slug]))];
}

// The attack card's lines on a hit (or with no DC to grade against): each
// rider's text, and a button for its condition on the target
function getStrikeRiderLines(metadata, degree) {
  if (degree !== null && degree !== undefined && !(degree >= 1)) return [];
  const riders = Array.isArray(metadata?.strikeRiders) ? metadata.strikeRiders : [];
  const applier = { id: metadata?.tokenId || "", name: metadata?.tokenName || "the monster" };
  const lines = [];
  riders.forEach((slug) => {
    const rider = STRIKE_RIDERS[slug];
    if (!rider) return;
    lines.push(`**${rider.name}:** ${rider.text}`);
    if (rider.condition) {
      lines.push(
        getRiderButton(
          `Apply_${rider.condition}`,
          metadata?.targetId,
          metadata?.targetName,
          `applyStrikeRider(token, ${JSON.stringify(rider.condition)}, ${JSON.stringify(applier)})`,
        ),
      );
    }
  });
  return lines;
}

// A button for the target: the one the attack was against, or the selected
// token when it had none
function getRiderButton(label, targetId, targetName, call) {
  if (targetId) return getManeuverButton(label, targetId, targetName || "the target", call);
  const fence = "```";
  return `${fence}${label}\n(api.getSelectedOrDroppedToken() || []).map((t) => t?.token || t).forEach((token) => ${call});\n${fence}`;
}

// Grabbed lasts until the end of the monster's next turn; prone until the
// creature stands
function applyStrikeRider(token, condition, applier = {}) {
  if (!token) return;
  if (condition === "Grabbed") {
    api.addEffect("Grabbed", token, UNTIL_END_OF_NEXT_TURN, { value: 1, _id: applier.id, name: applier.name });
  } else {
    applyManeuverCondition(token, condition, 1);
  }
}

// ---------------------------------------------------------------- Recharges

// An ability's "can't use <it> again for 1d4 rounds": the formula, or ""
function getRechargeFormula(action) {
  const text = api.richTextToMarkdown ? api.richTextToMarkdown(action?.data?.description || "") : `${action?.data?.description || ""}`;
  // A button reads as its label ("1d4_Rounds" -> "1d4 Rounds")
  const plain = `${text}`.replace(/```([^\n]*)\n[\s\S]*?```/g, (block, label) => ` ${label.replace(/_/g, " ")} `);
  const match = plain.match(/can'?t use [^.]*?again for\s+(\d+d\d+|\d+)\s*rounds?/i);
  return match ? match[1] : "";
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

// The attack card's lines: a hit on an off-guard target (Debilitating
// Strike's trigger), the debilitations and a button for enfeebled
function getDebilitationLines(metadata, degree) {
  const count = parseInt(metadata?.debilitation, 10) || 0;
  if (!(degree >= 1) || !count || !metadata?.isOffGuard) return [];
  const applier = { id: metadata?.tokenId || "", name: metadata?.tokenName || "the rogue" };
  return [
    `**Debilitating Strike** (free action, until the end of your next turn): ${count > 1 ? "two debilitations (Double Debilitation; removing one removes both)" : "one debilitation"}:`,
    "- a -10-foot status penalty to its Speeds",
    "- enfeebled 1",
    getRiderButton(
      "Apply_Enfeebled_1",
      metadata?.targetId,
      metadata?.targetName,
      `applyDebilitation(token, "Enfeebled", ${JSON.stringify(applier)})`,
    ),
  ];
}

function applyDebilitation(token, condition, applier = {}) {
  if (!token) return;
  api.addEffect(condition, token, UNTIL_END_OF_NEXT_TURN, { value: 1, _id: applier.id, name: applier.name });
}
