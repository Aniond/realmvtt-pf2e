// Stances: entering one ends the creature's other stance (the stance
// trait), when its effect is applied with the action card's button
// (applyEffectButton).
//
// The ruleset assists the GM and doesn't police the action economy: no
// warnings for flourish, press, finisher, hex or composition, and no
// per-turn action log. The GM runs those at the table.
// Loaded as one of the ruleset's scripts (ruleset.config.json,
// otherSettings.scripts), so it shares common.js's scope at runtime.

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
