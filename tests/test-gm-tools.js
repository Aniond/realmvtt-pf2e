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
  assert("simple hazard: 2 to 32", [-4, 0, 4].map((d) => xp(d, { hazard: true })), [2, 8, 32]);
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
  assert("simple hazard: the standard table still", [-4, 1, 4, 7].map((d) => xp(d, { hazard: true })), [2, 12, 32, 32]);
  assert("... nothing 5 or more below", [-5, -7].map((d) => xp(d, { hazard: true })), [0, 0]);
  assert("complex hazard: the variant creature table", xp(4, { hazard: true, complex: true }), 90);

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

section("Level 0 to 1st level: the next threshold is the campaign's");
{
  const sheet = fs.readFileSync(`${__dirname}/../characters-main.html`, "utf8");
  for (const match of sheet.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    new vm.Script(match[1], { filename: "characters-main.html" }).runInContext(ctx);
  }
  const written = [];
  const setValues = ctx.api.setValues;
  ctx.api.setValues = (values) => written.push(values);
  const takeClass = (xp) => {
    written.length = 0;
    ctx.record = { _id: "pc", data: { level: 0, xp, classes: [{ data: { isLevelZero: true } }], traits: [], traitsList: [] }, fields: {} };
    ctx.applyClassAtFirstLevel({ _id: "fighter", name: "Fighter", data: { traits: [], keyAbility: ["str"] } });
    return written[0];
  };
  settings = {};
  const first = takeClass(1700);
  assert("1,700 XP at level 0: 900 left, below 1,000, so no Level Up yet", [first["data.xp"], first["fields.levelUpBtn.hidden"]], [900, true]);
  assert("... and the XP bar is 1,000 long at once", first["data.xpToNextLevel"], 1000);
  settings = { advancementSpeed: "fast" };
  assert("fast: Level Up shows at 900 (of 800)", takeClass(1700)["fields.levelUpBtn.hidden"], false);
  settings = { advancementSpeed: "milestone" };
  const milestone = takeClass(0);
  assert("milestones: Level Up shows, no XP bar length written", [milestone["fields.levelUpBtn.hidden"], "data.xpToNextLevel" in milestone], [false, false]);
  settings = {};
  ctx.api.setValues = setValues;
}

section("Initiative: hazards roll Stealth (Q13)");
{
  const hazard = foe("Spinning Blade Pillar", 4, { type: "hazard", isComplex: true, stealth: { value: 11 } });
  assert("a hazard rolls Stealth", ctx.getInitiativeSkill(hazard), "Stealth");
  assert("... even when its sheet says Perception", ctx.getInitiativeSkill({ data: { ...hazard.data, initiativeSkill: "Perception" } }), "Stealth");
  assert("a creature rolls what its sheet picks", ctx.getInitiativeSkill(foe("Rogue", 2, { initiativeSkill: "Stealth" })), "Stealth");
  assert("Perception by default", ctx.getInitiativeSkill(pc("a", 1)), "Perception");
  assert("the stored value is the modifier: +11", ctx.getHazardStealthMod(hazard), 11);
  assert("Hidden Pit (8, DC 18): +8", ctx.getHazardStealthMod({ data: { stealth: { value: 8 } } }), 8);
  assert("none: +0", ctx.getHazardStealthMod(foe("x", 1, { type: "hazard" })), 0);

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

  // From the sheet: the token's faction when there is one
  ctx.api.getToken = () => ({ recordType: "npcs", faction: "friendly" });
  ctx.performInitiativeRoll({ recordType: "npcs", data: { level: 1 } });
  assert("an allied NPC rolling from its sheet: not an adversary", prompted.metadata.initiativeAdversary, false);
  ctx.api.getToken = () => null;
  ctx.performInitiativeRoll({ recordType: "npcs", data: { level: 1 } });
  assert("... no token: an NPC counts as one", prompted.metadata.initiativeAdversary, true);
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

section("Threat (H21)");
{
  settings = {};
  const budgets = (size) => ctx.getEncounterBudgets(size).map((b) => b.budget);
  assert("4 characters: 40, 60, 80, 120, 160", budgets(4), [40, 60, 80, 120, 160]);
  assert("5: +10, +20, +20, +30, +40", budgets(5), [50, 80, 100, 150, 200]);
  assert("3: one fewer", budgets(3), [30, 40, 60, 90, 120]);
  const threat = (xp, size) => ctx.getEncounterThreat(xp, size);
  assert("the highest budget reached", [threat(50), threat(60), threat(119), threat(120), threat(160), threat(161)], ["Trivial", "Low", "Moderate", "Severe", "Extreme", "Beyond Extreme"]);
  assert("by party size", [threat(80, 5), threat(80, 3)], ["Low", "Moderate"]);

  const summary = ctx.getEncounterThreatSummary([...party, foe("Boss", 7), foe("Pit", 5, { type: "hazard" })]);
  assert("from the tokens: level 5, 4 characters, 80 + 8 XP", [summary.partyLevel, summary.partySize, summary.totalXp, summary.threat], [5, 4, 88, "Moderate"]);
  assert("no party or no enemies: nothing", [ctx.getEncounterThreatSummary([foe("Boss", 7)]), ctx.getEncounterThreatSummary(party)], [null, null]);

  runHook("onEncounterEnd.js", { tokens: [...party, foe("Boss", 7), foe("Pit", 5, { type: "hazard" })] });
  const ended = ctx.__state.messages.find((m) => `${m}`.includes("Encounter Ended")) || "";
  assertIncludes("the end card still: Moderate, 88 XP", ended, "Party Level: 5 | Severity: Moderate");
  assertIncludes("... the award", ended, "api.awardExp(88, 'Encounter with 2 enemies (Moderate).')");
}

section("Encounter builder (H21)");
{
  settings = {};
  const vars = {};
  const written = [];
  ctx.api.getCampaignVariable = (name) => vars[name];
  ctx.api.setCampaignVariable = (name, value) => {
    vars[name] = value;
    written.push(name);
  };
  const writes = (action) => {
    written.length = 0;
    action();
    return [...written];
  };
  ctx.api.getParty = (cb) => cb([pc("a", 3), pc("b", 4), pc("c", 3), { _id: "pet", recordType: "npcs", data: { level: 1 } }]);
  assert("Use the Party: the level, the size and the meter", writes(() => ctx.setEncounterBuilderFromParty()), ["encounterPartyLevel", "encounterPartySize", "encounterMeter"]);
  assert("... level 3, 3 characters", [vars.encounterPartyLevel, vars.encounterPartySize], [3, 3]);

  ctx.api.getSelectedTokens = () => [foe("Ogre", 5), foe("Trap", 3, { type: "hazard" }), pc("e", 3)];
  assert("Add Selected Tokens: the creatures and the meter", writes(() => ctx.addSelectedToEncounterBuilder()), ["encounterCreatures", "encounterMeter"]);
  assert("... NPCs and hazards, no names", vars.encounterCreatures, [{ level: 5, type: "", complex: false }, { level: 3, type: "hazard", complex: false }]);
  const meter = vars.encounterMeter;
  assert("the meter: 80 + 8 XP is Moderate for 3, Severe at 90", [meter.xp, meter.xpLabel, meter.threat, meter.next, meter.max], [88, "88 XP", "Moderate", "Severe at 90 XP", 120]);
  assert("... the budgets for 3", meter.budgets, { Trivial: 30, Low: 40, Moderate: 60, Severe: 90, Extreme: 120 });
  assert("... a row each, no names", meter.rows, [{ name: "Lvl 5 Creature", xp: "80 XP" }, { name: "Lvl 3 Simple Hazard", xp: "8 XP" }]);
  assert("... not empty", meter.empty, "");

  ctx.api.showPrompt = (title, text, placeholder, opts, query, callback) => callback(["-2"]);
  assert("Add by Level: the creatures and the meter", writes(() => ctx.addLevelToEncounterBuilder()), ["encounterCreatures", "encounterMeter"]);
  assert("... party -2", vars.encounterCreatures[2], { level: 1, type: "", complex: false });

  vars.encounterPartySize = 4; // the field saves itself
  assert("a typed size: the meter only", writes(() => ctx.setEncounterBuilderParty("size", "4")), ["encounterMeter"]);
  assert("... the meter again", [vars.encounterMeter.xpLabel, vars.encounterMeter.threat, vars.encounterMeter.next], ["108 XP", "Moderate", "Severe at 120 XP"]);

  assert("Remove Last: the creatures and the meter", writes(() => ctx.removeLastFromEncounterBuilder()), ["encounterCreatures", "encounterMeter"]);
  assert("... the level 1 creature is gone", vars.encounterCreatures.length, 2);

  assert("Clear: the creatures and the meter", writes(() => ctx.clearEncounterBuilder()), ["encounterCreatures", "encounterMeter"]);
  assert("... no creatures, the party stays", [vars.encounterCreatures, vars.encounterPartyLevel, vars.encounterMeter.threat, vars.encounterMeter.next, vars.encounterMeter.empty], [[], 3, "Trivial", "Low at 60 XP", "No creatures yet"]);
  assert("Remove Last with none: no write", writes(() => ctx.removeLastFromEncounterBuilder()), []);

  const meterFor = (creatures) => ctx.getEncounterBuilderMeter({ level: 3, size: 4, creatures });
  const ogre = { level: 5, type: "", complex: false };
  assert("the same creature groups", meterFor([ogre, ogre, { level: 3, type: "", complex: false }]).rows, [{ name: "2 × Lvl 5 Creature", xp: "160 XP" }, { name: "Lvl 3 Creature", xp: "40 XP" }]);
  const many = Array.from({ length: 12 }, (_, i) => ({ level: i - 1, type: "hazard", complex: false }));
  const crowded = meterFor(many).rows;
  assert("past 10 kinds, the last row is the rest", [crowded.length, crowded[8].name, crowded[9].name], [10, "Lvl 7 Simple Hazard", "+3 more"]);
  assert("... with their XP", crowded[9].xp, `${meterFor(many.slice(9)).xp} XP`);
  assert("Beyond Extreme: no next threat", [meterFor([ogre, ogre, ogre]).threat, meterFor([ogre, ogre, ogre]).next], ["Beyond Extreme", ""]);

  let options = [];
  ctx.api.showPrompt = (title, text, placeholder, opts, query, callback) => {
    options = opts;
    callback(["4"]);
  };
  settings = { proficiencyWithoutLevel: "yes" };
  ctx.addLevelToEncounterBuilder();
  assert("Proficiency without Level: Add by Level runs -7 to +7", [options.length, options[0].value, options[14].value], [15, "7", "-7"]);
  assert("... its templates too", ctx.getEncounterTemplates(10, 4, "Extreme").includes("1 × level 17 (160 XP each)"), true);
  settings = {};
  ctx.clearEncounterBuilder();

  const templates = ctx.getEncounterTemplates(5, 4, "Moderate");
  assert("Moderate for 4 at level 5: 2 × level 5, 1 × level 7, 4 × level 3", ["2 × level 5 (40 XP each)", "1 × level 7 (80 XP each)", "4 × level 3 (20 XP each)"].every((t) => templates.includes(t)), true);
  assert("... a leader and others", templates.includes("1 × level 6 and 1 × level 3"), true);
  assert("level 1 party: no creatures below level -1", ctx.getEncounterTemplates(1, 4, "Low").some((t) => /level -[2-9]/.test(t)), false);

  ctx.__state.messages.length = 0;
  ctx.api.showPrompt = (title, text, placeholder, opts, query, callback) => callback(["Severe"]);
  const before = Object.keys(vars).length;
  ctx.promptEncounterTemplates();
  ctx.promptEncounterTemplates();
  assert("Templates: the same threat posts twice, no variable", [ctx.__state.messages.length, Object.keys(vars).length === before], [2, true]);
  assertIncludes("... for the GM", ctx.__state.messages[0], "[gm][center]120 XP for 4 of level 3[/center][/gm]");
}

process.exitCode = summary() > 0 ? 1 : 0;
