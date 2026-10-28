// Concealment and detection (Player Core pg. 442-447): targeting a
// concealed creature takes a DC 5 flat check, a hidden (or invisible, or
// undetected) one a DC 11 flat check, and a dazzled or blinded attacker
// treats everything as concealed or hidden. A creature you're hidden from,
// or undetected by, is off-guard to you.
//   - Strike and spell attack cards show the worst flat check with a Flat
//     Check button. Nothing is rolled or refused for the GM: the button is
//     there to click, and the GM rules on the result.
//   - An attacker that is hidden, invisible or undetected makes its target
//     off-guard, applied to the target's AC as flanking is.
// Effects aren't per observer in Realm, so a condition on a token counts
// against every creature; the GM removes it when it no longer applies.
// Loaded as one of the ruleset's scripts (ruleset.config.json,
// otherSettings.scripts), so it shares common.js's scope at runtime.

// The target's conditions that need a flat check to target it
const TARGET_FLAT_CHECKS = [
  { condition: "concealed", dc: 5 },
  { condition: "hidden", dc: 11 },
  { condition: "invisible", dc: 11 },
  { condition: "undetected", dc: 11 },
];

// The attacker's conditions that make every target concealed or hidden
const ATTACKER_FLAT_CHECKS = [
  { condition: "dazzled", dc: 5, label: "dazzled" },
  { condition: "blinded", dc: 11, label: "blinded" },
];

// The conditions that make the attacker's target off-guard to it
const UNSEEN_ATTACKER_CONDITIONS = ["hidden", "invisible", "undetected"];

// The flat check an attacker needs to target a creature: { dc, reason } for
// the worst one, or null
function getConcealmentFlatCheck(attacker, target) {
  const checks = [];
  TARGET_FLAT_CHECKS.forEach(({ condition, dc }) => {
    if (target && getTokenCondition(target, condition)) {
      checks.push({ dc, reason: `${getTokenDisplayName(target)} is ${condition}` });
    }
  });
  ATTACKER_FLAT_CHECKS.forEach(({ condition, dc, label }) => {
    if (attacker && getTokenCondition(attacker, condition)) {
      checks.push({ dc, reason: `${getTokenDisplayName(attacker)} is ${label}` });
    }
  });
  if (checks.length === 0) return null;
  return checks.sort((a, b) => b.dc - a.dc)[0];
}

// Whether the attacker is hidden, invisible or undetected, so its target is
// off-guard to it
function isUnseenAttacker(attacker) {
  return !!attacker && UNSEEN_ATTACKER_CONDITIONS.some((condition) => getTokenCondition(attacker, condition));
}

// The attack card's line and Flat Check button for the check, or ""
function getConcealmentLine(check) {
  if (!check?.dc) return "";
  const fence = "```";
  const name = `Flat Check (DC ${check.dc})`;
  const button = `${fence}Flat_Check_DC${check.dc}\napi.promptRoll(${JSON.stringify(name)}, "1d20", [], { rollName: "Flat Check", dc: ${check.dc} }, "flatCheck");\n${fence}`;
  return `**Flat check DC ${check.dc}:** ${check.reason}; on a failure the attack misses.\n${button}`;
}
