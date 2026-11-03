// Tests for the engine fixes from the spell and spell effect audits: interval
// and fixed heightening, heightened tags and areas, spells whose defense is
// empty, the cast animation's range, long casting times on the spell sheet,
// damage button formulas, effect rules' resistance exceptions and degree of
// success adjustments, healing from spells, fast healing from effects, AC
// against ranged attacks, and spell damage rows that apply only against some
// targets (data.predicate). Fixtures follow the converted Foundry spells.
// Run: node tests/test-spell-audit-fixes.js   (or via tests/run-all.js)

const fs = require("fs");
const vm = require("vm");
const { createSandbox } = require("./sandbox");
const { assert, assertIncludes, assertNotIncludes, section, summary } = require("./test-helpers");

const ctx = createSandbox();
new vm.Script(fs.readFileSync(`${__dirname}/../rollhandlers/spells.js`, "utf8"), { filename: "spells.js" }).runInContext(ctx);

// --- helpers ----------------------------------------------------------------

ctx.api.richTextToMarkdown = (text) => `${text || ""}`;
ctx.api.getValueOnRecord = (target, path) => `${path}`.split(".").reduce((value, key) => value?.[key], target);
ctx.getNearestParentDataPath = (path) => `${path}`.replace(/\.data\.[^.]+\.\d+$/, "");
let cards = [];
ctx.api.sendMessage = (message, roll, macros, tags) => cards.push({ message, tags: tags || [] });
let prompts = [];
ctx.api.promptRoll = (name, dice, modifiers, metadata, type) => prompts.push({ name, dice, modifiers: modifiers || [], metadata: metadata || {}, type });

// A damage or healing row as the converter writes it
const row = (formula, type, extra = {}) => ({
  name: "Damage",
  recordType: "records",
  data: { formula, type, category: "", applyMod: false, kinds: ["damage"], ...extra },
});
const interval = (interval, formulas) => ({ data: { type: "interval", interval, damage: formulas.map((formula) => ({ data: { formula } })) } });
const spell = (name, data) => ({ _id: `spell-${name}`, name, recordType: "spells", data: { traits: [], description: "", ...data } });

// A prepared caster with the spell in the given rank's list
function caster(spells, rank) {
  return {
    _id: "pc",
    name: "Kyra",
    recordType: "characters",
    fields: {},
    effects: [],
    effectIds: [],
    data: { level: 9, traits: [], spells: [{ data: { type: "prepared", tradition: "divine", attribute: "wis", mod: 15, dc: 25, [`spells${rank}`]: spells } }] },
  };
}

// The spell's damage at a rank
const damageAt = (s, rank) => ctx.calculateSpellDamage(caster([s], rank), { ...s, castRank: rank }, `data.spells.0.data.spells${rank}.0`);

// Casts the spell and returns its card
function cast(s, rank = s.data.level, path = `data.spells.0.data.spells${rank}.0`, isOverlay = false, record = null) {
  cards = [];
  ctx.castSpell(record || caster([s], rank), { ...s, castRank: rank }, path, isOverlay);
  return cards[0] || { message: "", tags: [] };
}

// Runs a chat button's code from a card, as a click would
function runMacro(message, label, record, targets = []) {
  const match = new RegExp("```" + label + "\\n([\\s\\S]*?)```").exec(message);
  if (!match) return null;
  prompts = [];
  const savedRecord = ctx.api.getRecord;
  const savedTargets = ctx.api.getTargets;
  ctx.api.getRecord = (type, id, cb) => cb(record);
  ctx.api.getTargets = () => targets;
  try {
    new vm.Script(`(function () {\n${match[1]}\n})();`).runInContext(ctx);
  } finally {
    ctx.api.getRecord = savedRecord;
    ctx.api.getTargets = savedTargets;
  }
  return prompts;
}

// A target for api.getTargets
const target = (traits = [], extra = {}) => ({
  token: { _id: `t-${traits.join("-") || "none"}`, name: "Target", recordType: "npcs", record: { name: "Target" }, effects: [], effectIds: [], data: { ac: 20, level: 5, traits, ...extra } },
  distance: 30,
});

// --- 1. interval heightening keeps each row's category ----------------------

section("Interval heightening adds to the row it heightens");
{
  const bloodVendetta = spell("Blood Vendetta", {
    level: 2,
    defense: { passive: { statistic: "" }, save: { statistic: "will", basic: false } },
    damage: [row("2d6", "bleed", { category: "persistent" })],
    heightening: [interval(2, ["2d6"])],
  });
  assert("Blood Vendetta at 2nd: 2d6 persistent bleed", [damageAt(bloodVendetta, 2).damageString, damageAt(bloodVendetta, 2).persistentDamage], ["", "2d6 bleed"]);
  assert("at 4th: 4d6 persistent bleed, no direct damage", [damageAt(bloodVendetta, 4).damageString, damageAt(bloodVendetta, 4).persistentDamage], ["", "4d6 bleed"]);
  assert("at 6th: 6d6", damageAt(bloodVendetta, 6).persistentDamage, "6d6 bleed");

  const blistering = spell("Blistering Invective", { level: 2, damage: [row("2d6", "fire", { category: "persistent" })], heightening: [interval(2, ["2d6"])] });
  assert("Blistering Invective at 4th: 4d6 persistent fire", [damageAt(blistering, 4).damageString, damageAt(blistering, 4).persistentDamage], ["", "4d6 fire"]);

  const gougingClaw = spell("Gouging Claw", {
    level: 1,
    damage: [row("2d6", "untyped"), row("2", "bleed", { category: "persistent" })],
    heightening: [interval(1, ["1d6", "1"])],
  });
  const claw = damageAt(gougingClaw, 2);
  assert("Gouging Claw at 2nd: 3d6 and 3 persistent bleed", [claw.damageString, claw.persistentDamage], ["3d6 untyped", "3 bleed"]);

  // A persistent row before the direct one: each step goes to its own row
  const mixed = spell("Mixed", { level: 1, damage: [row("1d6", "fire", { category: "persistent" }), row("2d6", "fire")], heightening: [interval(1, ["1d6", "2d6"])] });
  const both = damageAt(mixed, 2);
  assert("persistent first: 2d6 persistent and 4d6 direct", [both.damageString, both.persistentDamage], ["4d6 fire", "2d6 fire"]);

  // Another die or type is its own term, as before
  const other = spell("Other", { level: 1, damage: [row("2d6", "fire")], heightening: [{ data: { type: "interval", interval: 1, damage: [{ data: { formula: "1d8", type: "cold" } }] } }] });
  assert("a step of another type: its own term", damageAt(other, 3).damageString, "2d6 fire + 2d8 cold");
  const heal = spell("Heal", { level: 1, damage: [row("1d8", "vitality", { kinds: ["damage", "healing"] })], heightening: [interval(1, ["1d8"])] });
  assert("healing heightens too", damageAt(heal, 3).healingString, "3d8 vitality");

  // A step that isn't plain dice or a number is added once per step, each
  // with its type, as before (Force Bolt's 1d4+1, Heal's 1d8+8)
  const forceBolt = spell("Force Bolt", { level: 1, damage: [row("1d4+1", "force")], heightening: [interval(2, ["1d4+1"])] });
  assert("Force Bolt at 5th: three typed missiles", damageAt(forceBolt, 5).damageString, "1d4+1 force + 1d4+1 force + 1d4+1 force");
  const healLiving = spell("Heal (vs. Living)", { level: 1, damage: [row("1d8+8", "vitality", { kinds: ["healing"] })], heightening: [interval(1, ["1d8+8"])] });
  assert("Heal (vs. Living) at 3rd: each step typed", damageAt(healLiving, 3).healingString, "1d8+8 vitality + 1d8+8 vitality + 1d8+8 vitality");
}

// --- 2. every fixed rank up to the casting rank ----------------------------

const telekineticHand = spell("Telekinetic Hand", {
  level: 1,
  range: "30 feet",
  target: "1 unattended object of light Bulk or less",
  heightening: [
    {
      data: {
        type: "fixed",
        levels: [
          { data: { rank: 3, target: { value: "1 unattended object with a Bulk of 1 or less" } } },
          { data: { rank: 5, range: { value: "60 feet" } } },
          { data: { rank: 7, target: { value: "1 unattended object with a Bulk of 2 or less" } } },
        ],
      },
    },
  ],
});

section("Fixed heightening applies every rank up to the casting rank");
{
  const at = (rank) => {
    const info = ctx.getSpellHeighteningInfo(telekineticHand, rank);
    return [info.target, info.range];
  };
  assert("1st: nothing changes", at(1), [null, null]);
  assert("3rd: 3rd's target", at(3), ["1 unattended object with a Bulk of 1 or less", null]);
  assert("5th: 3rd's target and 5th's range", at(5), ["1 unattended object with a Bulk of 1 or less", "60 feet"]);
  assert("7th: 7th's target over 3rd's, 5th's range", at(7), ["1 unattended object with a Bulk of 2 or less", "60 feet"]);
  const damage = spell("Fixed", {
    level: 1,
    damage: [row("1d6", "fire")],
    heightening: [{ data: { type: "fixed", levels: [{ data: { rank: 2, damage: [row("2d6", "fire")] } }, { data: { rank: 4, range: "60 feet", damage: [] } }] } }],
  });
  assert("a later rank without damage keeps the earlier rank's", damageAt(damage, 4).damageString, "2d6 fire");
}

// --- 3 and 4. heightened tags ----------------------------------------------

section("Heightened target, range and area on the card");
{
  const names = cast(telekineticHand, 5).tags.map((tag) => tag.name);
  assertIncludes("the range from { value }", names, "60 feet");
  assertIncludes("the target from { value }", names, "1 unattended object with a Bulk of 1 or less");
  assertNotIncludes("no [object Object]", names, "[object Object]");

  const burst = spell("Burst", { level: 1, area: { type: "burst", value: "10" }, heightening: [{ data: { type: "interval", interval: 1, area: 5, damage: [] } }] });
  assertIncludes("an area stored as text grows: 10 + 5", cast(burst, 2).tags.map((tag) => tag.name), "Burst 15 ft");
  assertIncludes("by 10 two ranks up", cast(burst, 3).tags.map((tag) => tag.name), "Burst 20 ft");
  const textStep = spell("Cone", { level: 1, area: { type: "cone", value: 15 }, heightening: [{ data: { type: "interval", interval: 1, area: "5", damage: [] } }] });
  assertIncludes("a step stored as text: 15 + 5", cast(textStep, 2).tags.map((tag) => tag.name), "Cone 20 ft");
}

// --- 5. an empty defense is none -------------------------------------------

section("A spell whose defense is empty still rolls damage");
{
  const armament = spell("Spiritual Armament", {
    level: 2,
    defense: { passive: { statistic: "ac" } },
    damage: [row("2d8", "untyped")],
    overlays: [
      {
        name: "Spiritual Armament (Slashing)",
        recordType: "spells",
        data: { level: 2, traits: [], description: "", defense: { passive: { statistic: "" }, save: { statistic: "", basic: false } }, damage: [row("2d8", "slashing")] },
      },
    ],
  });
  const record = caster([armament], 2);
  const overlayPath = "data.spells.0.data.spells2.0.data.overlays.0";
  const card = cast(armament.data.overlays[0], 2, overlayPath, true, record);
  assertIncludes("the overlay gets its damage button", card.message, "```Roll_Slashing_Damage");
}

// --- 6. the cast animation's range -----------------------------------------

section("The cast animation knows a touch spell isn't ranged");
{
  const saved = ctx.getAnimationFor;
  let options = null;
  ctx.getAnimationFor = (o) => {
    options = o;
    return null;
  };
  const isRanged = (range) => {
    cast(spell("Zap", { level: 1, range }), 1);
    return options?.isRanged;
  };
  assert("Touch: not ranged", isRanged("Touch"), false);
  assert("touch: not ranged", isRanged("touch"), false);
  assert("Self: not ranged", isRanged("Self"), false);
  assert("30 feet: ranged", isRanged("30 feet"), true);
  ctx.getAnimationFor = saved;
}

// --- 7. long casting times on the spell sheet -------------------------------

section("The spell sheet keeps long casting times");
{
  const sheet = fs.readFileSync(`${__dirname}/../spells-main.html`, "utf8");
  for (const match of sheet.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    new vm.Script(match[1], { filename: "spells-main.html" }).runInContext(ctx);
  }
  const open = (data, fields = {}) => {
    let written = {};
    const savedRecord = ctx.record;
    const savedSet = ctx.api.setValues;
    ctx.record = { data: { traitsList: [], level: 1, levelLabel: "Spell 1", ...data }, fields };
    ctx.api.setValues = (values) => (written = values);
    try {
      ctx.showHideFields();
    } finally {
      ctx.record = savedRecord;
      ctx.api.setValues = savedSet;
    }
    return written;
  };
  const alarm = open({ time: "10 minutes", actions: "oneAction" });
  assert("10 minutes stays", alarm["data.time"], undefined);
  assert("no action icon: actions cleared and hidden", [alarm["data.actions"], alarm["fields.actions.hidden"]], ["", true]);
  assert("2 to 3 actions: twoToThreeActions", open({ time: "2 to 3", actions: "" })["data.actions"], "twoToThreeActions");
  assert("1 to 3 actions: oneToThreeActions", open({ time: "1 to 3", actions: "" })["data.actions"], "oneToThreeActions");
  // Foundry's "1 or 2" (Heal Animal, Untamed Shift) isn't a long casting time
  const healAnimal = open({ time: "1 or 2", actions: "oneAction" });
  assert("1 or 2 actions: oneToTwoActions, icon shown", [healAnimal["data.actions"], healAnimal["fields.actions.hidden"]], ["oneToTwoActions", false]);
  assert("Free: free", open({ time: "Free", actions: "" })["data.actions"], "free");
  assert("no casting time: one action", [open({ time: "" })["data.time"], open({ time: "" })["data.actions"]], ["1", "oneAction"]);
  assertIncludes("the card shows a long casting time", cast(spell("Alarm", { level: 1, time: "10 minutes" }), 1).tags.map((tag) => tag.name), "10 minutes");
}

// --- 8. damage button formulas ----------------------------------------------

section("Damage buttons work out their dice before rolling");
{
  const rolled = (formula, context) => {
    prompts = [];
    ctx.executeDamageMacro(formula, "standard", null, context);
    return prompts[0]?.dice;
  };
  assert("(@item.level -3)d6 at 5: 2d6", rolled("(@item.level -3)d6 fire", { level: 5 }), "2d6 fire");
  assert("(floor(@item.level/2))d10 at 5: 2d10", rolled("(floor(@item.level/2))d10", { level: 5 }), "2d10");
  assert("nested: (max(4,(@item.rank)-1))d6 at 7: 6d6", rolled("(max(4,(@item.rank)-1))d6 fire", { level: 7 }), "6d6 fire");
  assert("((@item.level*2)-2)d6 at 4: 6d6", rolled("((@item.level*2)-2)d6 spirit", { level: 4 }), "6d6 spirit");
  assert("(1+(ceil((@item.level-4)/2)))d6 at 7: 3d6", rolled("(1+(ceil((@item.level-4)/2)))d6", { level: 7 }), "3d6");
  assert("(1d6+max(0,floor(@item.rank/2) -3)) at 8: 1d6+1", rolled("(1d6+max(0,floor(@item.rank/2) -3)) bludgeoning", { level: 8 }), "1d6+1 bludgeoning");
  assert("ternary: 2d4 at 18", rolled("ternary(gte(@item.level,18),2,1)d4 fire", { level: 18 }), "2d4 fire");
  assert("5*@item.level at 8: 40", rolled("5*@item.level void", { level: 8 }), "40 void");
  assert("ceil(7/2+1) rounds once, at the end", rolled("ceil(@item.level/2+1)d4 fire", { level: 7 }), "5d4 fire");
  assert("(floor(@item.rank/2)*2)d8 at 6: 6d8", rolled("(floor(@item.rank/2)*2)d8 void", { level: 6 }), "6d8 void");
  assert("a plain formula is left as it is", rolled("2d6+3 fire", { level: 1 }), "2d6+3 fire");
}

// --- 9. effect rules keep their resistance exceptions -----------------------

const START_HP = 1000;
function npc(effects = [], data = {}) {
  return { _id: "foe", recordType: "npcs", name: "Foe", record: { name: "Foe" }, identified: true, effects, effectIds: effects.map((e) => e._id), data: { curhp: START_HP, hitpoints: START_HP, traits: [], ...data } };
}
function damageDealt(token, type, value, metadata = {}) {
  ctx.__state.lastSet = null;
  ctx.applyDamage(token, { types: [{ die: 6, value, type }], dice: [{ type: 6, value }], total: value, metadata: { traits: [], damageCategories: [], damageType: type, ...metadata } }, false, null, false);
  const set = ctx.__state.lastSet || {};
  return START_HP - ("data.curhp" in set ? set["data.curhp"] : START_HP);
}

section("Effect rules keep resistance exceptions and doubleVs");
{
  const ghostlyShift = { _id: "ghostly", name: "Spell Effect: Ghostly Shift", rules: [{ type: "resistance", field: "", valueType: "string", value: "all-damage 5", data: { exceptions: ["force"] } }] };
  const shifted = npc([ghostlyShift]);
  assert("the exception reaches the IWR", ctx.getIWR(shifted).resistances["all-damage"]?.exceptions, ["force"]);
  assert("fire 10: resisted to 5", damageDealt(shifted, "fire", 10), 5);
  assert("force 10: the exception, 10", damageDealt(shifted, "force", 10), 10);
  const asText = npc([{ ...ghostlyShift, _id: "g2", rules: [{ ...ghostlyShift.rules[0], data: { exceptions: "force, ghost-touch" } }] }]);
  assert("exceptions as text", damageDealt(asText, "force", 10), 10);
  const byDefinition = npc([{ ...ghostlyShift, _id: "g3", rules: [{ ...ghostlyShift.rules[0], data: { exceptions: [{ definition: ["item:type:spell"] }] } }] }]);
  assert("an exception by definition: spell damage isn't resisted", damageDealt(byDefinition, "fire", 10, { isSpell: true, damageSource: { type: "spell" } }), 10);
  assert("... other damage is", damageDealt(byDefinition, "fire", 10, { damageSource: { type: "weapon" } }), 5);
  const doubled = npc([{ _id: "d", name: "Doubled", rules: [{ type: "resistance", field: "", valueType: "string", value: "fire 5", data: { doubleVs: ["non-magical"] } }] }]);
  assert("doubleVs: double against non-magical fire", damageDealt(doubled, "fire", 20, { damageCategories: ["non-magical"] }), 10);
  assert("... single otherwise", damageDealt(doubled, "fire", 20), 15);
  const weak = npc([{ _id: "w", name: "Weak", rules: [{ type: "weakness", field: "", valueType: "string", value: "fire 5", data: { exceptions: ["magical"] } }] }]);
  assert("a weakness's exception", ctx.getIWR(weak).weaknesses.fire?.exceptions, ["magical"]);
}

// --- 10. effect rules adjust the degree of success --------------------------

section("Effect rules adjust the degree of success");
{
  const pc = (rules) => ({ _id: "pc", recordType: "characters", effects: [{ _id: "e", name: "Spell Effect: Tempt Fate", rules }], effectIds: ["e"], data: { level: 5, traits: [], features: [] } });
  const adjusted = (rules, fields = ["will"]) => ctx.getDegreeOfSuccessAdjustments(pc(rules), fields);
  assert("value as an object", adjusted([{ type: "adjustDegreeOfSuccess", field: "will", valueType: "object", value: { success: "one-degree-better" } }]).success.value, "one-degree-better");
  assert("the rule's data.adjustment, as a feature modifier's", adjusted([{ type: "adjustDegreeOfSuccess", field: "will", data: { adjustment: { failure: "to-success" } } }]).failure.value, "to-success");
  assert("JSON text", adjusted([{ type: "adjustDegreeOfSuccess", field: "all", valueType: "string", value: '{"criticalFailure":"one-degree-better"}' }]).criticalFailure.value, "one-degree-better");
  assert("another save's field: none", adjusted([{ type: "adjustDegreeOfSuccess", field: "reflex", value: { success: "one-degree-better" } }]).success.value, "none");
  assert("a failed predicate: none", adjusted([{ type: "adjustDegreeOfSuccess", field: "will", value: { success: "one-degree-better" }, data: { predicate: ["self:condition:never"] } }]).success.value, "none");
  const result = ctx.applyDegreeOfSuccessAdjustment(1, adjusted([{ type: "adjustDegreeOfSuccess", field: "will", value: { success: "one-degree-better" } }]));
  assert("a success becomes a critical success, named for the effect", [result.degree, result.modifierName], [2, "Spell Effect: Tempt Fate"]);
}

// --- 11. healing from spells carries the spell and rank ----------------------

const angelicHalo = { _id: "halo", name: "Spell Effect: Angelic Halo", rules: [{ type: "healingReceivedBonus-status", field: "", valueType: "string", value: "@spell.rank * 2", data: { predicate: ["item:type:spell", "item:slug:heal"] } }] };

section("Healing from a spell knows the spell and its rank");
{
  const heal = spell("Heal", {
    level: 1,
    traits: ["Healing", "Vitality"],
    defense: { passive: { statistic: "" }, save: { statistic: "fortitude", basic: true } },
    damage: [row("1d8", "vitality", { kinds: ["damage", "healing"] })],
    heightening: [interval(1, ["1d8"])],
    overlays: [
      {
        name: "Heal (vs. Living)",
        recordType: "spells",
        data: { level: 1, traits: ["Healing", "Vitality"], description: "", defense: { passive: { statistic: "" }, save: { statistic: "", basic: false } }, damage: [row("1d8+8", "vitality", { kinds: ["healing"] })] },
      },
    ],
  });
  const record = caster([heal], 3);
  const card = cast(heal.data.overlays[0], 3, "data.spells.0.data.spells3.0.data.overlays.0", true, record);
  const healing = runMacro(card.message, "Roll_Healing", record)?.[0];
  assert("the healing card's source: heal at 3rd", [healing?.metadata.damageSource?.type, healing?.metadata.damageSource?.slug, healing?.metadata.damageSource?.castRank], ["spell", "heal", 3]);

  const ally = { ...npc([angelicHalo], { curhp: 10, hitpoints: 100 }), recordType: "characters" };
  const received = ctx.getHealingReceivedAdjustment(ally, { isSpell: true, damageSource: healing?.metadata.damageSource });
  assert("Angelic Halo: +6 from a 3rd-rank heal", received.amount, 6);
  assert("not from another spell", ctx.getHealingReceivedAdjustment(ally, { isSpell: true, damageSource: { type: "spell", slug: "soothe", castRank: 3 } }).amount, 0);

  // Heal's own damage-or-healing card heals through applyDamage
  const dual = runMacro(cast(heal, 3, "data.spells.0.data.spells3.0", false, record).message, "Roll_Damage_or_Healing", record)?.[0];
  assert("the damage-or-healing card's source too", [dual?.metadata.damageSource?.slug, dual?.metadata.damageSource?.castRank], ["heal", 3]);
  ctx.__state.lastSet = null;
  ctx.applyDamage(ally, { types: [{ die: 8, value: 10, type: "vitality" }], dice: [{ type: 8, value: 10 }], total: 10, metadata: { traits: ["healing", "vitality"], damageCategories: [], damageType: "vitality", isSpell: true, isVitalityDual: true, damageSource: dual?.metadata.damageSource } }, false, null, false);
  assert("applied to a living ally: 10 + 6", ctx.__state.lastSet?.["data.curhp"], 26);
}

// --- 12. fast healing from effects -----------------------------------------

section("Fast healing from an effect, characters too");
{
  const regenerate = { _id: "fh", name: "Spell Effect: Regenerate", rules: [{ type: "fastHealing", field: "", valueType: "number", value: "15" }] };
  const pc = { _id: "pc-token", name: "Kyra", recordType: "characters", record: { name: "Kyra" }, effects: [regenerate], effectIds: ["fh"], data: { level: 7, curhp: 20, hitpoints: 80, traits: [], hpDetails: "fast healing 5" } };
  assert("a character's fast healing effect", ctx.getSelfHealing(pc).fastHealing, 15);
  const formula = { ...pc, effects: [{ ...regenerate, rules: [{ type: "fastHealing", field: "", valueType: "string", value: "{2*3}" }] }] };
  assert("a formula", ctx.getSelfHealing(formula).fastHealing, 6);
  const troll = { ...pc, recordType: "npcs", data: { ...pc.data, hpDetails: "fast healing 20" } };
  assert("a monster's own and an effect: the higher", ctx.getSelfHealing(troll).fastHealing, 20);
  cards = [];
  ctx.runTurnStartSelfHealing(pc, 2);
  assertIncludes("the turn-start card", cards[0]?.message || "", "Fast healing 15.");
  assertIncludes("with an Apply Healing button", cards[0]?.message || "", "applyHealingToToken(token, 15");
  cards = [];
  ctx.runTurnStartSelfHealing({ ...pc, data: { ...pc.data, curhp: 80 } }, 2);
  assert("none at full Hit Points", cards.length, 0);
  const turnStart = fs.readFileSync(`${__dirname}/../rollhandlers/onTurnStart.js`, "utf8");
  assertNotIncludes("onTurnStart checks every creature, not only NPCs", turnStart, 'if (token && token.recordType === "npcs") {\n  const selfHealing');
}

// --- 13. AC against ranged attacks ------------------------------------------

section("AC knows whether the attack is ranged");
{
  const windStance = { _id: "wind", name: "Stance: Wild Winds Stance", rules: [{ type: "armorClassBonus-circumstance", field: "", valueType: "number", value: "2", data: { predicate: ["origin:item:ranged"] } }] };
  const monk = npc([windStance], { ac: 22 });
  const attacker = { _id: "archer", recordType: "npcs", effects: [], data: { level: 5, traits: [] } };
  assert("against a ranged attack: +2", ctx.getArmorClassForToken(monk, false, attacker, [], { attackRange: "ranged" }), 24);
  assert("against a melee attack: none", ctx.getArmorClassForToken(monk, false, attacker, [], { attackRange: "melee" }), 22);
  assert("not known: none", ctx.getArmorClassForToken(monk, false, attacker), 22);
  assert("without the attacker's token, still by range", ctx.getArmorClassForToken(monk, false, null, [], { attackRange: "ranged" }), 24);

  // A ranged spell attack against it
  const ray = spell("Ray", { level: 1, range: "60 feet", defense: { passive: { statistic: "ac" } }, damage: [row("2d6", "fire")] });
  const record = caster([ray], 1);
  const attack = runMacro(cast(ray, 1, "data.spells.0.data.spells1.0", false, record).message, "Roll_Attack", record, [{ token: monk, distance: 60 }])?.[0];
  assert("a ranged spell attack's DC: AC 24", attack?.metadata.dc, 24);
  const touch = spell("Shocking Touch", { level: 1, range: "touch", defense: { passive: { statistic: "ac" } }, damage: [row("2d6", "electricity")] });
  const melee = runMacro(cast(touch, 1, "data.spells.0.data.spells1.0", false, caster([touch], 1)).message, "Roll_Attack", caster([touch], 1), [{ token: monk, distance: 5 }])?.[0];
  assert("a touch spell attack's DC: AC 22", melee?.metadata.dc, 22);
}

// --- predicated spell damage rows -------------------------------------------

const chillingDarkness = spell("Chilling Darkness", {
  level: 3,
  range: "120 feet",
  traits: ["Attack", "Cold", "Darkness"],
  defense: { passive: { statistic: "ac" } },
  damage: [row("5d6", "cold"), row("5d6", "spirit", { predicate: '["target:trait:holy"]' })],
  heightening: [interval(1, ["2d6", "2d6"])],
});

section("Spell damage only against some targets (data.predicate)");
{
  const at4 = damageAt(chillingDarkness, 4);
  assert("the predicated row isn't in the damage", at4.damageString, "7d6 cold");
  assert("it heightens with the spell: (2 x rank - 1)d6", at4.targetDamage, [{ value: "7d6 spirit", category: "", predicate: '["target:trait:holy"]' }]);

  const record = caster([chillingDarkness], 4);
  const card = cast(chillingDarkness, 4, "data.spells.0.data.spells4.0", false, record);
  const extra = (targets) =>
    (runMacro(card.message, "Roll_Attack", record, targets)?.[0]?.metadata.damageModifiers || [])
      .filter((mod) => mod.name.startsWith("Chilling Darkness"))
      .map((mod) => [mod.value, mod.active, mod.situational || false]);
  assert("against a holy target: on", extra([target(["Holy", "Celestial"])]), [["7d6 spirit", true, false]]);
  assert("against another: left out", extra([target(["Fiend", "Unholy"])]), []);
  assert("no target: offered unticked", extra([]), [["7d6 spirit", false, "vs holy"]]);
  const named = (runMacro(card.message, "Roll_Attack", record, [])?.[0]?.metadata.damageModifiers || []).find((mod) => mod.value === "7d6 spirit");
  assert("named for what it's against", named?.name, "Chilling Darkness (vs holy)");

  // A save spell's damage button: one roll for every target
  const holyBurst = spell("Holy Burst", {
    level: 2,
    area: { type: "burst", value: 10 },
    defense: { save: { statistic: "reflex", basic: true } },
    damage: [row("3d6", "fire"), row("3d6", "spirit", { predicate: '["target:trait:unholy"]' }), row("2", "fire", { category: "persistent", predicate: '["target:trait:unholy"]' })],
  });
  const saveRecord = caster([holyBurst], 2);
  const saveCard = cast(holyBurst, 2, "data.spells.0.data.spells2.0", false, saveRecord);
  const roll = (targets) => runMacro(saveCard.message, "Roll_Fire_Damage", saveRecord, targets)?.[0];
  const one = roll([target(["Unholy"])]);
  assert("one unholy target: the spirit damage is on", one?.modifiers.filter((mod) => mod.value === "3d6 spirit").map((mod) => mod.active), [true]);
  assert("and the persistent damage", one?.metadata.persistentDamage, "2 fire");
  const two = roll([target(["Unholy"]), target(["Humanoid"])]);
  assert("several targets: offered unticked", two?.modifiers.filter((mod) => mod.value === "3d6 spirit").map((mod) => [mod.active, mod.situational]), [[false, "vs unholy"]]);
  assert("persistent damage can't be ticked: left out", two?.metadata.persistentDamage, "");
  assert("the base damage as before", one?.dice, "3d6 fire");

  // An overlay's rows work the same
  const overlay = { name: "Chilling Darkness (vs. Holy)", recordType: "spells", data: { ...chillingDarkness.data, heightening: [] } };
  assert("an overlay's predicated row", damageAt(overlay, 3).targetDamage.map((r) => r.value), ["5d6 spirit"]);
  assert("an empty predicate is no predicate", damageAt(spell("Plain", { level: 1, damage: [row("1d6", "fire", { predicate: "" })] }), 1).damageString, "1d6 fire");
}

// --- 15. effect rules offered as opt-ins -------------------------------------

section("An effect rule the roll can't settle is offered as an opt-in");
{
  // Safe Passage: +2 status to saves against hazards; a save doesn't know its
  // source, so the bonus is an unticked choice, as a feature modifier's is
  const safePassage = { _id: "sp", name: "Spell Effect: Safe Passage", rules: [{ type: "saveBonus-status", field: "all", valueType: "number", value: "2", data: { predicate: [{ or: ["environmental", "hazard", "trap"] }] } }] };
  const pc = { _id: "pc-token", name: "Kyra", recordType: "characters", effects: [safePassage], effectIds: ["sp"], data: { level: 5, traits: [] } };
  const [save] = ctx.getEffectsAndModifiersForToken(pc, ["saveBonus"], "reflex");
  assert("not applied on its own", save?.active, false);
  assert("offered as an opt-in", !!save?.situational, true);
  const against = (traits) =>
    ctx.getEffectsAndModifiersForToken(pc, ["saveBonus"], "reflex", undefined, undefined, { origin: { data: { traits } }, originAtoms: traits.map((t) => `origin:trait:${t}`) })[0];
  const trap = against(["trap"]);
  assert("against a trap: applied", [trap?.active, !!trap?.situational], [true, false]);
  const spellSource = against(["fire", "spell"]);
  assert("against a known source that isn't one: neither applied nor offered", [spellSource?.active, !!spellSource?.situational], [false, false]);

  // A rule whose predicate fails on what the roll does know isn't offered
  const fear = { _id: "fe", name: "Self Only", rules: [{ type: "saveBonus-status", field: "all", valueType: "number", value: "1", data: { predicate: ["self:trait:elf"] } }] };
  const [selfOnly] = ctx.getEffectsAndModifiersForToken({ ...pc, effects: [fear], effectIds: ["fe"] }, ["saveBonus"], "reflex");
  assert("a predicate on the creature itself: no opt-in", !!selfOnly?.situational, false);

  // An effect rule that passes is applied, with no opt-in
  const plain = { _id: "pl", name: "Plain", rules: [{ type: "saveBonus-status", field: "all", valueType: "number", value: "1" }] };
  const [applied] = ctx.getEffectsAndModifiersForToken({ ...pc, effects: [plain], effectIds: ["pl"] }, ["saveBonus"], "reflex");
  assert("no predicate: applied", [applied?.active, !!applied?.situational], [true, false]);
}

process.exit(summary() > 0 ? 1 : 0);
