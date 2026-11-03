// Tests for finding hazards (gm-tools.js): the Stealth DC, the minimum
// rank, Trap Finder, and the GM's Detect card.
// Run: node tests/test-hazards.js   (or via tests/run-all.js)

const { createSandbox } = require("./sandbox");
const { assert, assertIncludes, assertNotIncludes, section, summary } = require("./test-helpers");

const ctx = createSandbox();
const state = ctx.__state;

// Scythe Blades: Stealth +13 (DC 23, trained), a mechanical trap
const hazard = (details = "<p>(trained)</p>", traits = ["Medium", "Common", "Mechanical", "Trap"]) => ({
  _id: "hz",
  name: "Scythe Blades",
  recordType: "npcs",
  data: { type: "hazard", level: 4, stealth: { value: 13, details }, traits },
});
const pc = (name, rank, perceptionMod, feats = []) => ({
  _id: name,
  name,
  recordType: "characters",
  effects: [],
  effectIds: [],
  data: { perception: String(rank), perceptionMod, feats, bonusFeats: [] },
});
const ezren = pc("Ezren", 2, 9);
const valeros = pc("Valeros", 1, 6);
const kyra = pc("Kyra", 0, 3);
const merisiel = pc("Merisiel", 2, 10, [{ name: "Trap Finder", data: { type: "feat" } }]);

section("The DC and the rank");
{
  assert("Stealth +13: DC 23", ctx.getHazardStealthDC(hazard()), 23);
  assert(
    "the minimum rank from the details",
    ["<p>(trained)</p>", "<p>(expert)</p>", "(master) or Detect Magic", "<p>(legendary)</p>", ""].map((d) => ctx.getHazardMinimumRank(hazard(d))),
    [1, 2, 3, 4, 0],
  );
  assert("Trap Finder: +1 against a trap", [ctx.getHazardPerceptionMod(merisiel, hazard()), ctx.getHazardPerceptionMod(merisiel, hazard("", ["Haunt"]))], [11, 10]);
  const master = { ...merisiel, data: { ...merisiel.data, thievery: "3" } };
  assert("... +2 with master Thievery", ctx.getHazardPerceptionMod(master, hazard()), 12);
  const realMods = ctx.getEffectsAndModifiersForToken;
  ctx.getEffectsAndModifiersForToken = (token, types) =>
    types.includes("perceptionBonus") ? [{ name: "Trap Finder (Perception vs traps)", type: "circumstance", value: 1, active: true }] : [];
  assert("... the feat's toggle on too: still +1, not +2", ctx.getHazardPerceptionMod(merisiel, hazard()), 11);
  ctx.getEffectsAndModifiersForToken = (token, types) =>
    types.includes("perceptionBonus") ? [{ name: "Some Other Bonus", type: "circumstance", value: 2, active: true }] : [];
  assert("... another +2 circumstance bonus: the higher only", ctx.getHazardPerceptionMod(merisiel, hazard()), 12);
  ctx.getEffectsAndModifiersForToken = realMods;
}

section("The rolls");
{
  const results = ctx.getHazardDetectionResults(hazard(), [ezren, valeros, kyra, merisiel], [14, 16, 20, 12]);
  assert("Ezren: 14 + 9 = 23, notices it", results[0], { name: "Ezren", mod: 9, natural: 14, total: 23, noticed: true, trapFinder: false });
  assert("Valeros: 16 + 6 = 22, doesn't", results[1].noticed, false);
  assert("Kyra, untrained: can't find a trained hazard", results[2], { name: "Kyra", rank: 0 });
  assert("Merisiel: 12 + 11 (Trap Finder) = 23, notices it", [results[3].total, results[3].noticed], [23, true]);
  const nat20 = ctx.getHazardDetectionResults(hazard(""), [kyra], [20])[0];
  assert("no minimum rank: an untrained character rolls; a natural 20 lifts a miss to a success", [nat20.total, nat20.noticed], [23, true]);
  assert("a natural 1 lowers a critical success to a success", ctx.getHazardDetectionResults(hazard(), [pc("Sajan", 4, 32)], [1])[0].noticed, true);
  assert("... a bare success to a failure", ctx.getHazardDetectionResults(hazard(), [pc("Seelah", 1, 22)], [1])[0].noticed, false);
}

section("The card");
{
  const card = ctx.getHazardDetectionCard(hazard(), ctx.getHazardDetectionResults(hazard(), [ezren, kyra], [14, 18]));
  assert("only the GM sees it", [card.startsWith("[gm]"), card.endsWith("[/gm]")], [true, true]);
  assertIncludes("the DC and the rank", card, "Perception vs Stealth DC 23 (trained)");
  assertIncludes("a roll", card, "- Ezren: 14 + 9 = 23, [color=green]notices it[/color]");
  assertIncludes("below the rank", card, "- Kyra: can't find it (needs trained Perception)");
  assertIncludes("with a minimum rank, only searchers", card, "only those Searching (exploring) or Seeking roll.");
  const withRogue = ctx.getHazardDetectionCard(hazard(), ctx.getHazardDetectionResults(hazard(), [ezren, merisiel], [14, 12]));
  assertIncludes("... with a Trap Finder rogue: the note", withRogue, "Seeking roll (Trap Finder: even when not Searching).");
  assertNotIncludes("not magical: no Detect Magic line", card, "Detect Magic");
  const magical = hazard("", ["Magical", "Trap"]);
  const open = ctx.getHazardDetectionCard(magical, ctx.getHazardDetectionResults(magical, [kyra], [5]));
  assertIncludes("no rank: everyone on entering", open, "Everyone gets this check on first entering the hazard's area.");
  assertIncludes("magical, no rank: Detect Magic shows it", open, "Detect Magic shows it's there, not what it is.");
}

section("The Detect button");
{
  let party = [ezren, valeros];
  let rolls = [10, 11];
  ctx.api.getParty = (cb) => cb(party);
  ctx.api.rollInstant = () => ({ total: rolls.shift() });
  state.messages = [];
  ctx.detectHazard(hazard());
  assertIncludes("the party rolls", state.messages[0], "- Valeros: 11 + 6 = 17");
  party = [];
  rolls = [9];
  ctx.api.getOtherTokens = () => [{ token: ezren }, { token: { _id: "gob", name: "Goblin", recordType: "npcs", data: {} } }];
  state.messages = [];
  ctx.detectHazard(hazard());
  assertIncludes("no Party Sheet: the characters on the scene", state.messages[0], "- Ezren: 9 + 9 = 18");
  assertNotIncludes("... not the NPCs", state.messages[0], "Goblin");
}

process.exitCode = summary() > 0 ? 1 : 0;
