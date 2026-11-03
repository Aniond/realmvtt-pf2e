// Recharging abilities don't carry into the next encounter
// (combat-riders.js)
clearEncounterRecharges(data?.tokens);

// Nor does a stratagem (class-extras.js)
(data?.tokens || []).forEach(clearStratagem);

// Nor does a delay (delay-ready.js)
clearEncounterDelays(data?.tokens);

// On Encounter End, calculate XP based on PF2e rules: the party's average
// level and size against each enemy (gm-tools.js)
const encounter = getEncounterThreatSummary(data?.tokens);

if (encounter) {
  const { partyLevel: avgPartyLevel, partySize, totalXp: totalXP, breakdown: xpBreakdown } = encounter;

  // The budgets are for 4 characters, adjusted for the party's size
  const partyAdjustment = partySize - 4;

  let adjustmentMessage = "";
  let adjustmentAsterix = "";
  if (partyAdjustment !== 0) {
    adjustmentAsterix = "*";
    adjustmentMessage = `[center](*After Party Size Adjustment: ${partyAdjustment})[/center]`;
  }

  const severity = `${encounter.threat}${adjustmentAsterix}`;

  // Adjust XP awards based on party size
  // Formula: (Total XP × 4) ÷ Party Size = XP per character
  // This normalizes progression for non-standard party sizes
  const adjustedXP = Math.floor((totalXP * 4) / (partySize || 4));

  // Build party size adjustment message if not standard
  let partySizeMessage = "";
  if (partySize !== 4) {
    partySizeMessage = `[center]Party Size: ${partySize} | Base XP: ${totalXP} → Adjusted: ${adjustedXP}[/center]\n`;
  }

  // Build macro for awarding XP
  let macro = "";
  if (xpBreakdown.length > 0) {
    macro = `\`\`\`Award_XP
if (isGM) {
  api.awardExp(${adjustedXP}, 'Encounter with ${xpBreakdown.length} enemies (${severity}).');
  api.sendMessage('Awarded ${adjustedXP} XP to the Party.');
}
\`\`\`
`;

    // Build breakdown message
    let breakdownMsg = xpBreakdown
      .map((e) => `- ${e.name} (Lvl ${e.level} ${e.type}): ${e.xp} XP`)
      .join("\n");

    api.sendMessage(
      `**[center]Encounter Ended[/center]**
[center]Party Level: ${avgPartyLevel} | Severity: ${severity}[/center]
${partySizeMessage}${adjustmentMessage}**[center]${adjustedXP} XP awarded to each party member[/center]**

**Breakdown:**
${breakdownMsg}

${macro}`
    );
  }
}

// Rage ends with the encounter, and the temporary Hit Points left from it go
// (class-extras.js)
{
  const rageLines = clearRageTempHp(data?.tokens);
  if (rageLines.length > 0) api.sendMessage(rageLines.join("\n"));
}

// End the effects that last one encounter (stances, Panache, Rage and the
// like), as Foundry does when an encounter ends. Realm doesn't end them
// itself: ending an encounter only resets the combat tracker.
{
  const removals = getEncounterEndRemovals(data?.tokens);
  const removing = new Map(removals.map(({ token, effects }) => [token, effects]));
  // Then forget the turn rounds the condition upkeep kept on each token
  getEncounterTokens(data?.tokens).forEach((token) => {
    const effectIds = (removing.get(token) || []).map((effect) => effect._id);
    removeEffectsInOrder(effectIds, token, () =>
      clearConditionUpkeepRounds(token),
    );
  });
  const summary = getEncounterEndSummary(removals);
  if (summary) {
    api.sendMessage(summary);
  }
}

// Uses per minute, round and turn come back when the encounter ends
// (limited-uses.js)
getEncounterTokens(data?.tokens)
  .filter((token) => token?.recordType === "characters")
  .forEach((token) => {
    const recharges = getLimitedUseRecharges(token, "encounterEnd");
    if (Object.keys(recharges).length > 0) {
      api.setValuesOnTokenById(token._id, token.recordType, recharges);
    }
  });

// The encounter is over: encounter predicates no longer hold, and no one's
// turn is being taken (attack-log.js)
setEncounterState([], 0);
setCurrentTurn(null);

// Sustained spells' lists start over next encounter (sustain.js)
clearSustainedSpells(data?.tokens);
