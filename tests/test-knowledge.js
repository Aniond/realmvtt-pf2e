// Tests for Recall Knowledge and Identify Magic (knowledge.js).
// Run: node tests/test-knowledge.js   (or via tests/run-all.js)

const fs = require("fs");
const vm = require("vm");
const { createSandbox } = require("./sandbox");
const { assert, assertIncludes, assertNotIncludes, section, summary } = require("./test-helpers");

const ctx = createSandbox();

let settings = {};
ctx.api.getSetting = (key) => settings[key] ?? null;

function runHandler(file, data) {
  ctx.__state.messages.length = 0;
  ctx.data = data;
  const code = fs.readFileSync(`${__dirname}/../rollhandlers/${file}`, "utf8");
  new vm.Script(`(function () {\n${code}\n})();`, { filename: file }).runInContext(ctx);
  return ctx.__state.messages.join("\n");
}

const npc = (name, data) => ({ _id: `t-${name}`, name, recordType: "npcs", faction: "enemy", effects: [], effectIds: [], data });
const ghoul = npc("Ghoul", {
  level: 1,
  traits: ["Undead", "Ghoul"],
  fortitudeMod: 4,
  reflexMod: 9,
  willMod: 5,
  weaknesses: [{ data: { type: "Vitality", value: 5 } }],
});
const unicorn = npc("Unicorn", { level: 3, traits: ["Uncommon", "Beast", "Celestial"] });

section("Recall Knowledge: the skills by trait, the DC");
{
  assert("undead: Religion", ctx.getRecallKnowledgeSkills(ghoul), { religion: "undead" });
  assert("beast and celestial: Arcana, Nature, Religion", Object.keys(ctx.getRecallKnowledgeSkills(unicorn)), ["arcana", "nature", "religion"]);
  assert("level 1: DC 15", ctx.getKnowledgeDC(ghoul), 15);
  assert("level 3, uncommon: DC 18 + 2", ctx.getKnowledgeDC(unicorn), 20);
  settings = { proficiencyWithoutLevel: "yes" };
  assert("Proficiency without Level: the level comes off", ctx.getKnowledgeDC(unicorn), 17);
  settings = {};
}

section("Recall Knowledge: the GM's note");
{
  const note = ctx.getRecallKnowledgeNote(ghoul, "religion", 15);
  assertIncludes("the DC", note, "**Recall Knowledge, Ghoul** (level 1): DC 15.");
  assertIncludes("the skills that fit", note, "Skills: Religion (undead).");
  assertIncludes("Lore: easy and very easy", note, "Lore: DC 13 (specific) or 10 (very specific).");
  assertIncludes("later attempts, common: hard, very hard, incredibly hard", note, "Later attempts: DC 17, 20, 25; none after a failure or the incredibly hard one.");
  // Uncommon starts at hard, so later attempts go on from there (Sean's
  // level 5 example: 22, then 25, 30)
  const uncommon5 = npc("Naga", { level: 5, traits: ["Uncommon", "Aberration"] });
  assert("uncommon level 5: DC 22", ctx.getKnowledgeDC(uncommon5), 22);
  assertIncludes("... later attempts: very hard, incredibly hard", ctx.getRecallKnowledgeNote(uncommon5, "occultism", 22), "Later attempts: DC 25, 30;");
  assertIncludes("rare: only incredibly hard after", ctx.getRecallKnowledgeNote(npc("Rare", { level: 5, traits: ["Rare", "Fey"] }), "nature", 25), "Later attempts: DC 30;");
  assertIncludes("unique: none", ctx.getRecallKnowledgeNote(npc("Boss", { level: 5, traits: ["Unique", "Humanoid"] }), "society", 30), "No later attempts: it's already incredibly hard.");
  assertIncludes("cheat sheet: the lowest save and weaknesses", note, "Cheat sheet: lowest save Fortitude +4; weaknesses Vitality 5.");
  assertNotIncludes("a skill that fits: no stretch line", note, "isn't one");
  assertIncludes("a skill that doesn't: harder", ctx.getRecallKnowledgeNote(ghoul, "arcana", 15), "Arcana isn't one: a stretch is harder (DC 17 or 20).");
  assertIncludes("rarity in the heading", ctx.getRecallKnowledgeNote(unicorn, "nature", 20), "(level 3, uncommon)");
  assertIncludes("no trait names a skill: the GM's call", ctx.getRecallKnowledgeNote(npc("Trap", { level: 2, traits: ["Trap"] }), "thievery", 16), "your call");
  assert("only NPCs", [ctx.getRecallKnowledgeCheck({ recordType: "characters", data: { level: 1 } }, "society"), ctx.getRecallKnowledgeCheck(null, "society")], [null, null]);
}

section("Recall Knowledge: rolled against the target");
{
  let rolled = null;
  ctx.api.promptRollForToken = (who, name, formula, modifiers, metadata) => (rolled = metadata);
  ctx.api.getTargets = () => [{ token: ghoul }];
  const ezren = { _id: "ezren", recordId: "ezren-rec", recordType: "characters", name: "Ezren", data: { religion: 7 } };
  ctx.performSkillAction(ezren, "religion", "Recall Knowledge", true);
  assert("the DC and its name", [rolled?.dc, rolled?.dcName], [15, "Recall Knowledge DC"]);
  assertIncludes("the GM's note goes with it", rolled?.gmNote, "Skills: Religion (undead).");
  ctx.api.getTargets = () => [];
  ctx.performSkillAction(ezren, "religion", "Recall Knowledge", true);
  assert("no target: no DC, no note", [rolled?.dc, rolled?.gmNote], [undefined, undefined]);

  const card = runHandler("skill.js", {
    roll: { dice: [{ type: 20, value: 12 }], total: 19, metadata: { dc: 15, rollName: "Religion: Recall Knowledge", gmNote: "line one\nline two" } },
  });
  assertIncludes("the card: every note line hidden", card, "[gm]line one[/gm]\n[gm]line two[/gm]");
}

section("Identify Magic");
{
  const wand = { _id: "w1", name: "Wand of Fireball", unidentifiedName: "Carved Wand", identified: false, data: { level: 5, traits: ["Arcane", "Wand"] } };
  const cursedRing = { _id: "r1", name: "Ring of Lies", unidentifiedName: "Silver Ring", identified: false, data: { level: 4, traits: ["Cursed", "Divine", "Rare"] } };
  const elixir = { _id: "e1", name: "Elixir of Life", unidentifiedName: "Red Vial", identified: false, data: { level: 1, traits: ["Alchemical", "Elixir"] } };
  const known = { _id: "k1", name: "Rope", identified: true, data: { level: 0 } };
  assert("the tradition's skill: no change", ctx.getIdentifyDC(wand, "arcana"), { dc: 20, notes: [] });
  assert("another tradition's: very hard", ctx.getIdentifyDC(wand, "occultism").dc, 25);
  assert("cursed and rare: incredibly hard in place of rare", ctx.getIdentifyDC(cursedRing, "religion"), { dc: 19 + 10, notes: ["cursed: incredibly hard in place of its rarity; only a critical success reveals the curse"] });
  assert("... outside its tradition: +5 on top", ctx.getIdentifyDC(cursedRing, "arcana").dc, 19 + 10 + 5);
  assert("alchemy: Crafting", [ctx.getIdentifySkills(elixir), ctx.getIdentifyDC(elixir, "crafting").dc], [["crafting"], 15]);
  assert("no tradition: any of the four", ctx.getIdentifySkills({ data: { traits: ["Magical"] } }), ["arcana", "religion", "occultism", "nature"]);

  const record = { _id: "pc", recordType: "characters", name: "Ezren", data: { arcana: 9, inventory: [wand, known, elixir] } };
  assert("Identify Magic: the unidentified magic items, as the player sees them", ctx.getUnidentifiedItems(record, "Identify Magic").map((i) => i.label), ["Carved Wand"]);
  assert("Identify Alchemy: the alchemical ones", ctx.getUnidentifiedItems(record, "Identify Alchemy").map((i) => i.label), ["Red Vial"]);

  // From the sheet: pick the item, then the roll
  let options = null;
  let rolled = null;
  ctx.api.showPrompt = (title, text, placeholder, opts, query, callback) => {
    options = opts;
    callback(["w1"]);
  };
  ctx.api.promptRollForToken = (who, name, formula, modifiers, metadata) => (rolled = metadata);
  ctx.performSkillAction(record, "arcana", "Identify Magic", true);
  assert("the prompt: unidentified names only, and something else", options.map((o) => o.label), ["Carved Wand", "Something else (no DC)"]);
  assert("rolled against the item's DC", [rolled?.dc, rolled?.dcName], [20, "Identify Magic DC"]);
  assertIncludes("the GM's note names the item", rolled?.gmNote, "**Identify Magic, Wand of Fireball** (level 5): DC 20.");
  assertIncludes("the GM's button identifies it by id", rolled?.gmMacro, 'if (isGM) identifyInventoryItem("characters", "pc", "w1");');
  assertNotIncludes("... without the real name", rolled?.gmMacro, "Fireball");

  ctx.api.showPrompt = (title, text, placeholder, opts, query, callback) => callback(["none"]);
  ctx.performSkillAction(record, "arcana", "Identify Magic", true);
  assert("something else: no DC, no note", [rolled?.dc, rolled?.gmNote], [undefined, undefined]);

  const card = runHandler("skill.js", {
    roll: { dice: [{ type: 20, value: 12 }], total: 21, metadata: { dc: 20, rollName: "Arcana: Identify Magic", gmNote: "note", gmMacro: "```Identify_Item\nx\n```" } },
  });
  assertIncludes("the card has the GM's button", card, "```Identify_Item");

  // The GM's button: one write on the character
  const writes = [];
  ctx.api.getRecord = (type, id, cb) => cb({ _id: id, recordType: type, data: { inventory: [known, wand] } });
  ctx.api.setValuesOnRecord = (rec, values) => writes.push(values);
  const notes = [];
  ctx.api.showNotification = (text, color) => notes.push([color, text]);
  ctx.identifyInventoryItem("characters", "pc", "w1");
  assert("identified: one write on the row", writes, [{ "data.inventory.1.identified": true }]);
  assert("... and a green notification", notes[0][0], "green");
  ctx.identifyInventoryItem("characters", "pc", "k1");
  ctx.identifyInventoryItem("characters", "pc", "gone");
  assert("already identified, or gone: no write", writes.length, 1);
  assert("... a yellow notification each", notes.slice(1).map(([color]) => color), ["yellow", "yellow"]);
}

process.exitCode = summary() > 0 ? 1 : 0;
