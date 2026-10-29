// Tests for the GM tools (gm-tools.js): encounter XP with Proficiency without
// Level, advancement speed, initiative ties and hazard Stealth, and the DC
// helper.

const fs = require("fs");
const vm = require("vm");
const { createSandbox } = require("./sandbox");
const { assert, assertIncludes, section, summary } = require("./test-helpers");

const ctx = createSandbox();

let settings = {};
ctx.api.getSetting = (key) => settings[key] ?? null;

function runHook(file, data) {
  ctx.__state.messages.length = 0;
  ctx.data = data;
  const code = fs.readFileSync(`${__dirname}/../rollhandlers/${file}`, "utf8");
  new vm.Script(`(function () {\n${code}\n})();`, { filename: file }).runInContext(ctx);
}

const pc = (id, level) => ({ _id: id, recordType: "characters", faction: "party", data: { level } });
const foe = (id, level, data = {}) => ({ _id: id, name: id, recordType: "npcs", faction: "enemy", data: { level, ...data } });
const party = [pc("a", 5), pc("b", 5), pc("c", 5), pc("d", 5)];

section("Encounter XP: the standard table");
{
  settings = {};
  const xp = (diff, opts) => ctx.getEncounterXp(diff, opts);
  assert("-4 to +4: 10 ... 160", [-4, -1, 0, 1, 4].map((d) => xp(d)), [10, 30, 40, 60, 160]);
  assert("more than 4 below: none", xp(-5), 0);
  assert("more than 4 above: 160", xp(6), 160);
  assert("simple hazard: a fifth (2 to 32)", [-4, 0, 4].map((d) => xp(d, { hazard: true })), [2, 8, 32]);
  assert("complex hazard: the creature table", xp(2, { hazard: true, complex: true }), 80);
}

section("Encounter XP: Proficiency without Level (Q36)");
{
  settings = { proficiencyWithoutLevel: "yes" };
  const xp = (diff, opts) => ctx.getEncounterXp(diff, opts);
  assert("-7 to +7 table", [-7, -5, -4, -1, 0, 1, 3, 5, 7].map((d) => xp(d)), [9, 14, 18, 32, 40, 48, 72, 108, 160]);
  assert("6 below still grants XP", xp(-6), 12);
  assert("more than 7 below: none", xp(-8), 0);
  assert("more than 7 above: 160", xp(9), 160);
  assert("simple hazard: a fifth", [-7, 0, 7].map((d) => xp(d, { hazard: true })), [2, 8, 32]);

  runHook("onEncounterEnd.js", { tokens: [...party, foe("Ogre", 0), foe("Boss", 8)] });
  const message = ctx.__state.messages.find((m) => `${m}`.includes("Encounter Ended"));
  assertIncludes("a level 0 creature vs a 5th-level party: 14 XP", message, "Ogre (Lvl 0 Creature): 14 XP");
  assertIncludes("+3: 72 XP", message, "Boss (Lvl 8 Creature): 72 XP");
  assertIncludes("86 XP awarded", message, "86 XP awarded");

  settings = {};
  runHook("onEncounterEnd.js", { tokens: [...party, foe("Ogre", 0), foe("Boss", 8)] });
  const standard = ctx.__state.messages.find((m) => `${m}`.includes("Encounter Ended"));
  assertIncludes("without the variant: the -5 creature is trivial", standard, "Ogre (Lvl 0 Trivial Creature): 0 XP");
  assertIncludes("... and +3 is 120", standard, "Boss (Lvl 8 Creature): 120 XP");
}

section("Advancement speed (Q18)");
{
  const character = (data = {}) => ({ data: { level: 3, classes: [{ data: {} }], ...data }, fields: {} });
  settings = {};
  assert("standard by default: 1,000", ctx.getXpToNextLevel(character()), 1000);
  settings = { advancementSpeed: "fast" };
  assert("fast: 800", ctx.getXpToNextLevel(character()), 800);
  settings = { advancementSpeed: "slow" };
  assert("slow: 1,200", ctx.getXpToNextLevel(character()), 1200);
  const levelZero = character({ classes: [{ data: { isLevelZero: true } }] });
  assert("a Level 0 character: 800 at any XP speed", ctx.getXpToNextLevel(levelZero), 800);
  assert("the XP bar fills to 1,200", ctx.getXpBarValues(character()), { "data.xpToNextLevel": 1200 });
  assert("... nothing written when it already does", ctx.getXpBarValues(character({ xpToNextLevel: 1200 })), {});
  settings = { advancementSpeed: "milestone" };
  assert("story milestones: 0 (Level Up always shows)", ctx.getXpToNextLevel(character()), 0);
  assert("... and the XP bar hides", ctx.getXpBarValues(character({ xpToNextLevel: 1000 })), { "fields.nextLevelProgress.hidden": true });
  settings = { advancementSpeed: "nonsense" };
  assert("an unknown value: standard", ctx.getXpToNextLevel(character()), 1000);
  settings = {};
}

section("Initiative: hazards roll Stealth (Q13)");
{
  const hazard = foe("Spinning Blade Pillar", 4, { type: "hazard", isComplex: true, stealth: { value: 21 } });
  assert("a hazard rolls Stealth", ctx.getInitiativeSkill(hazard), "Stealth");
  assert("... even when its sheet says Perception", ctx.getInitiativeSkill({ data: { ...hazard.data, initiativeSkill: "Perception" } }), "Stealth");
  assert("a creature rolls what its sheet picks", ctx.getInitiativeSkill(foe("Rogue", 2, { initiativeSkill: "Stealth" })), "Stealth");
  assert("Perception by default", ctx.getInitiativeSkill(pc("a", 1)), "Perception");
  assert("Stealth DC 21: +11", ctx.getHazardStealthMod(hazard), 11);
  assert("no DC: +0", ctx.getHazardStealthMod(foe("x", 1, { type: "hazard" })), 0);

  // rollSkill reads the hazard's Stealth from its DC
  let prompted = null;
  ctx.api.promptRollForToken = (record, name, dice, modifiers, metadata) => {
    prompted = { modifiers, metadata };
  };
  ctx.api.promptRoll = (name, dice, modifiers, metadata) => {
    prompted = { modifiers, metadata };
  };
  runHook("onRollInitiative.js", { token: { ...hazard, recordType: "tokens" } });
  assert("the hazard's initiative roll: Stealth +11", [prompted.metadata.initiativeSkill, prompted.modifiers.reduce((sum, m) => sum + m.value, 0)], ["Stealth", 11]);
  assert("... marked as an adversary", prompted.metadata.initiativeAdversary, true);
}

section("Initiative: an adversary wins a tie (Q13)");
{
  assert("an enemy: a tenth more", ctx.getInitiativeValue(18, foe("x", 1)), 18.1);
  assert("a PC: the roll", ctx.getInitiativeValue(18, pc("a", 1)), 18);
  assert("an enemy who tied stays behind a PC who rolled higher", ctx.getInitiativeValue(18, foe("x", 1)) < 19, true);
  assert("an NPC record without a token: an adversary", ctx.isInitiativeAdversary({ recordType: "npcs" }), true);
  assert("an allied NPC token: not one", ctx.isInitiativeAdversary({ recordType: "npcs", faction: "friendly" }), false);

  let set = null;
  ctx.api.setValues = (values) => {
    set = values;
  };
  runHook("initiative.js", { roll: { total: 17, metadata: { initiativeSkill: "Perception", initiativeAdversary: true } } });
  assert("an enemy's roll of 17 is stored as 17.1", set["data.initiative"], 17.1);
  runHook("initiative.js", { roll: { total: 17, metadata: { initiativeSkill: "Perception", initiativeAdversary: false } } });
  assert("a PC's roll of 17 stays 17", set["data.initiative"], 17);

  const byToken = {};
  ctx.api.setValuesOnTokenById = (id, type, values) => {
    byToken[id] = values["data.initiative"];
  };
  runHook("initiative.js", { roll: { total: 12, metadata: { initiativeSkill: "Perception", group: ["g1", "g2"], initiativeAdversaries: ["g1"] } } });
  assert("group initiative: the enemy 12.1, the ally 12", [byToken.g1, byToken.g2], [12.1, 12]);
}

section("DC helper (Q27)");
{
  assert("simple DCs: 10, 15, 20, 30, 40", [0, 1, 2, 3, 4].map((r) => ctx.getSimpleDC(r)), [10, 15, 20, 30, 40]);
  assert("by name", ctx.getSimpleDC("Master"), 30);
  assert("adjustments", ["easy", "hard", "very hard", "incredibly easy"].map((d) => ctx.getDCAdjustment(d)), [-2, 2, 5, -10]);
  assert("rarity: uncommon +2, rare +5, unique +10", ["uncommon", "rare", "unique"].map((d) => ctx.getDCAdjustment(d)), [2, 5, 10]);
  assert("expert, hard: 22", ctx.getDCFromChoice("simple:2", "hard"), 22);
  assert("level 5, rare: 25", ctx.getDCFromChoice("level:5", "rare"), 25);
  const options = ctx.getDCHelperOptions(5).map((o) => o.value);
  assert("options: 5 simple DCs, then levels 4 to 7", options, ["simple:0", "simple:1", "simple:2", "simple:3", "simple:4", "level:4", "level:5", "level:6", "level:7"]);
  const message = ctx.getCallForCheckMessage("Athletics", 22, "Expert, hard");
  assertIncludes("the DC is shown to the GM only", message, "[gm]DC 22 (Expert, hard)[/gm]");
  assertIncludes("a button rolls it for the selected tokens", message, "rollSkillCheck('athletics', 22);");

  // The prompt: skill, DC, adjustment, then the message
  const answers = ["Athletics", "simple:2", "hard"];
  ctx.api.showPrompt = (title, text, placeholder, opts, query, callback) => callback([answers.shift()]);
  ctx.__state.messages.length = 0;
  ctx.api.getOtherTokens = () => party;
  ctx.showDCHelper();
  assertIncludes("the helper posts Athletics DC 22", ctx.__state.messages[0], "[gm]DC 22 (Expert (simple DC 20), hard)[/gm]");
}

summary();
