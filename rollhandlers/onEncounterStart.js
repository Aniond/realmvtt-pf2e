// Exploration activities at the encounter's start: Defend raises shields,
// and the GM gets a card of everyone's activity and Avoid Notice against each
// foe (exploration.js)
startEncounterExploration(data?.tokens);

// The encounter's threat before the fight, for the GM (gm-tools.js)
{
  const threatCard = getEncounterThreatCard(getEncounterThreatSummary(data?.tokens));
  if (threatCard) api.sendMessage(threatCard);
}
