// Tests for the campaign variant rules (GM Core and Gamemastery Guide).

const { createSandbox } = require("./sandbox");
const {
  assert,
  assertIncludes,
  assertNotIncludes,
  section,
  summary,
} = require("./test-helpers");

const ctx = createSandbox();

// Turn variant rules on through the campaign settings the sheet reads
let settings = {};
ctx.api.getSetting = (key) => settings[key] ?? null;
const useVariants = (...keys) => {
  settings = {};
  for (const key of keys) settings[key] = "yes";
};

const evens = ["2", "4", "6", "8", "10", "12", "14", "16", "18", "20"];
const fighter = {
  name: "Fighter",
  data: {
    hp: 10,
    ancestryFeatLevels: ["1", "5", "9", "13", "17"],
    classFeatLevels: ["1", ...evens],
    skillFeatLevels: evens,
    generalFeatLevels: ["3", "7", "11", "15", "19"],
    skillIncreaseLevels: ["3", "5", "7", "9", "11", "13", "15", "17", "19"],
  },
};

function character(level, data = {}) {
  return {
    _id: "pc",
    data: { level, conMod: 1, classes: [fighter], feats: [], ...data },
    fields: {},
  };
}

function slotsOf(record) {
  const values = {};
  ctx.setFeatSlots(record, values);
  return values["data.feats"] || record.data.feats;
}
const count = (feats, type, level) =>
  feats.filter(
    (f) => f.data.featSlotType === type && (level === undefined || f.data.level === level),
  ).length;

section("getVariantRules");
{
  useVariants();
  const off = ctx.getVariantRules();
  assert("all off by default", Object.values(off).some((v) => v), false);

  useVariants("freeArchetype", "gradualAbilityBoosts");
  const on = ctx.getVariantRules();
  assert("free archetype on", on.freeArchetype, true);
  assert("gradual boosts on", on.gradualBoosts, true);
  assert("others stay off", on.ancestryParagon, false);
}

section("Free Archetype feat slots");
{
  useVariants("freeArchetype");
  const feats = slotsOf(character(6));
  assert("archetype slots at 2, 4, 6", count(feats, "archetype"), 3);
  assert("archetype slot at 4", count(feats, "archetype", 4), 1);
  assert("class slots unchanged", count(feats, "class"), 4);
  assert("slot name", feats.find((f) => f.data.featSlotType === "archetype").name, "Archetype Feat Slot");

  const gains = ctx.getLevelUpGains(character(3), 4);
  assertIncludes("level 4 grants an archetype feat", gains.featTypes, "archetype");
  assert("summary lists it", ctx.getLevelUpSummary(gains).includes("Archetype feat"), true);

  const values = {};
  ctx.setFeatSlots(character(6), values);
  assert("archetype section shown", values["fields.archetypeFeatsBox.hidden"], false);

  // Turning Free Archetype off drops empty archetype slots but keeps chosen feats
  const filled = {
    _id: "f1",
    name: "Medic Dedication",
    data: { type: "class", featSlotType: "archetype", level: 2, traits: ["Archetype", "Dedication"] },
  };
  useVariants();
  const after = slotsOf(character(6, { feats: [...feats.filter((f) => !(f.data.featSlotType === "archetype" && f.data.level === 2)), filled] }));
  assert("empty archetype slots removed", after.filter((f) => f.data.featSlotType === "archetype" && f.data.type === "slot").length, 0);
  assert("chosen archetype feat kept", after.some((f) => f.name === "Medic Dedication"), true);
}

section("Ancestry Paragon feat slots");
{
  useVariants("ancestryParagon");
  const feats = slotsOf(character(5));
  assert("two ancestry slots at 1st level", count(feats, "ancestry", 1), 2);
  assert("ancestry slot at 3rd", count(feats, "ancestry", 3), 1);
  assert("ancestry slots through 5th", count(feats, "ancestry"), 4);

  const atOne = ctx.getLevelUpGains(character(0), 1);
  assert("two ancestry feats at 1st", atOne.featTypes.filter((t) => t === "ancestry").length, 2);
  assert("summary counts them", ctx.getLevelUpSummary(atOne).includes("2 Ancestry feats"), true);

  // Slots aren't duplicated when the feats are recalculated again
  const again = slotsOf(character(5, { feats }));
  assert("stable on recalculation", again.length, feats.length);
}

section("Gradual Ability Boosts");
{
  useVariants("gradualAbilityBoosts");
  assert("level 2 grants 1 boost", ctx.getAttributeBoostGain(2).count, 1);
  assert("stored in the level 5 set", ctx.getAttributeBoostGain(2).setLevel, 5);
  assert("level 6 grants none", ctx.getAttributeBoostGain(6).count, 0);
  assert("level 7 starts the level 10 set", ctx.getAttributeBoostGain(7).setLevel, 10);
  assert("summary says 1 boost", ctx.getLevelUpSummary(ctx.getLevelUpGains(character(1), 2)).includes("1 attribute boost"), true);

  const pc = character(3, { freeBoostsLevel5: ["str", "dex", "con"] });
  const fields = ctx.getFreeBoostFieldsForLevel(pc, 3);
  assert("set 5 shown at level 3", fields["fields.freeBoostsLevel5.hidden"], false);
  assert("trimmed to 2 boosts at level 3", fields["data.freeBoostsLevel5"].join(","), "str,dex");
  assert("set 10 hidden", fields["fields.freeBoostsLevel10.hidden"], true);

  useVariants();
  assert("normal: 4 boosts at 5th", ctx.getAttributeBoostGain(5).count, 4);
  assert("normal: none at 2nd", ctx.getAttributeBoostGain(2).count, 0);
  const normal = ctx.getFreeBoostFieldsForLevel(character(4, { freeBoostsLevel5: ["str"] }), 4);
  assert("normal: set 5 hidden below 5th", normal["fields.freeBoostsLevel5.hidden"], true);
  assert("normal: set 5 cleared below 5th", normal["data.freeBoostsLevel5"].length, 0);
}

section("Proficiency without Level");
{
  useVariants();
  assert("normal trained at 5", ctx.getProficiencyBonusForRank(1, 5), 7);
  assert("normal untrained", ctx.getProficiencyBonusForRank(0, 5), 0);
  assert("record-based helper", ctx.calculateProficiencyBonus({ data: { level: 3 } }, 2), 7);

  useVariants("proficiencyWithoutLevel");
  assert("untrained -2", ctx.getProficiencyBonusForRank(0, 5), -2);
  assert("trained +2", ctx.getProficiencyBonusForRank(1, 5), 2);
  assert("expert +4", ctx.getProficiencyBonusForRank(2, 12), 4);
  assert("master +6", ctx.getProficiencyBonusForRank(3, 12), 6);
  assert("legendary +8", ctx.getProficiencyBonusForRank("4", 20), 8);
  assert("record-based helper", ctx.calculateProficiencyBonus({ data: { level: 3 } }, 2), 4);
  assert("bad rank is 0", ctx.getProficiencyBonusForRank(undefined, 3), 0);
}

section("Archetype feat queries and the dedication rule");
{
  useVariants("freeArchetype");
  const pc = character(4);
  const archetypeQuery = ctx.getFeatSlotQuery(pc, "archetype", 4).query;
  assert("archetype slot needs the Archetype trait", archetypeQuery["data.traits"].$elemMatch.$regex, "^Archetype$");
  assert("archetype slot takes class or skill feats", archetypeQuery["data.type"].$in.join(","), "class,skill");

  const dedication = (name) => ({
    name: `${name} Dedication`,
    data: { type: "class", traits: ["Archetype", "Dedication"] },
  });
  const followUp = (name, prereq) => ({
    name,
    data: { type: "class", traits: ["Archetype"], prerequisites: prereq },
  });

  const one = character(6, { feats: [dedication("Medic"), followUp("Doctor's Visitation", "Medic Dedication")] });
  assert(
    "warns before two follow-up feats",
    ctx.getDedicationWarning(one, dedication("Sentinel")).startsWith("You can't take another dedication feat"),
    true,
  );
  const two = character(8, {
    feats: [dedication("Medic"), followUp("Doctor's Visitation", "Medic Dedication"), followUp("Treat Condition", "Medic Dedication")],
  });
  assert("fine after two follow-ups", ctx.getDedicationWarning(two, dedication("Sentinel")), "");
  assert("non-dedication feats never warn", ctx.getDedicationWarning(one, followUp("Basic Maneuver", "Fighter Dedication")), "");
}

section("Automatic Bonus Progression");
{
  useVariants();
  assert("off: no bonuses", ctx.getAbpBonuses(character(10)), null);
  assert("off: striking rune counts", ctx.getStrikingRuneForRecord(character(10), { data: { runes: { striking: "2" } } }), 2);

  useVariants("automaticBonusProgression");
  const at1 = ctx.getAbpBonuses(character(1));
  assert("level 1: nothing yet", at1.attack + at1.defense + at1.save + at1.perception, 0);

  const at10 = ctx.getAbpBonuses(character(10));
  assert("attack +2 at 10", at10.attack, 2);
  assert("defense +1 at 10", at10.defense, 1);
  assert("perception +1 at 10", at10.perception, 1);
  assert("saves +1 at 10", at10.save, 1);
  assert("two weapon dice at 10", at10.devastatingDice, 2);

  const at20 = ctx.getAbpBonuses(character(20, { abpSkillPotency: { stealth: 3, athletics: 1 }, abpApex: "dex" }));
  assert("attack +3 at 20", at20.attack, 3);
  assert("defense +3 at 20", at20.defense, 3);
  assert("saves +3 at 20", at20.save, 3);
  assert("four weapon dice at 20", at20.devastatingDice, 4);
  assert("apex chosen", at20.apex, "dex");
  assert("skill potency kept", at20.skills.stealth, 3);

  assert("npcs don't get ABP", ctx.getAbpBonuses({ recordType: "npcs", data: { level: 10 } }), null);

  // Devastating attacks replace striking runes
  const weapon = { data: { runes: { striking: "1" } } };
  assert("no extra dice before 4th", ctx.getStrikingRuneForRecord(character(3), { data: {} }), 0);
  assert("striking equivalent at 12th", ctx.getStrikingRuneForRecord(character(12), weapon), 2);

  // Potency becomes item-bonus modifiers
  const mods = ctx.getAbpModifiers(character(14, { abpSkillPotency: { stealth: 2 } }));
  const find = (type) => mods.find((m) => m.modifierType === type);
  assert("AC item bonus", find("armorClassBonus").value, 2);
  assert("potency stacks with item bonuses (untyped)", find("armorClassBonus").type, "");
  assert("save bonus", find("saveBonus").value, 2);
  assert("perception bonus", find("perceptionBonus").value, 2);
  assert("skill bonus scoped to the skill", find("skillBonus").field, "stealth");

  // Skill potency schedule (GM Core): every level's picks lead to the table's spread
  const spread = (level) => {
    const potency = {};
    const skills = ["acrobatics", "arcana", "athletics", "crafting", "deception", "diplomacy"];
    for (const pick of ctx.getAbpSkillPicksUpToLevel(level)) {
      const skill = skills.find((s) => (potency[s] || 0) === pick.to - 1);
      potency[skill] = pick.to;
    }
    return Object.values(potency).sort().reverse().join(",");
  };
  assert("skill potency at 3", spread(3), "1");
  assert("skill potency at 9", spread(9), "2,1");
  assert("skill potency at 13", spread(13), "2,2,1");
  assert("skill potency at 17", spread(17), "3,2,2,1,1");
  assert("skill potency at 20", spread(20), "3,3,2,2,1,1");
  assert("level 9 has one upgrade pick", JSON.stringify(ctx.getLevelUpGains(character(8), 9).abp.skillPicks), '[{"to":2}]');
  const options = ctx.getAbpSkillPotencyOptions(character(9, { abpSkillPotency: { stealth: 1 } }), 2);
  assert("upgrade options only +1 skills", options.map((o) => o.value).join(","), "stealth");

  // Bombs keep their own dice; a leftover striking rune never stacks
  assert("bombs get no devastating dice", ctx.getStrikingRuneForRecord(character(12), { data: { group: "Bomb" } }), 0);
  assert("leftover rune doesn't stack", ctx.getStrikingRuneForRecord(character(4), { data: { runes: { striking: "2" } } }), 2);

  // Resilient runes give nothing under ABP; potency comes from the modifiers
  const armor = { _id: "a1", data: { type: "armor", runes: { resilient: 2, potency: 2 }, acBonus: 4 } };
  assert("armor potency rune ignored", ctx.getACForArmor(armor), 4);

  // Attribute apex at 17th: +1, or to +4 if higher
  const apexPc = character(17, {
    abpApex: "int",
    freeBoosts: ["str", "dex", "con", "int"],
  });
  assert("apex raises +1 to +4", ctx.calculateAbilityBoosts(apexPc).int.modifier, 4);
  const lowPc = character(16, { abpApex: "int", freeBoosts: ["str", "dex", "con", "int"] });
  assert("no apex before 17th", ctx.calculateAbilityBoosts(lowPc).int.modifier, 1);

  // Level up summary lists the new ABP bonuses
  const gains = ctx.getLevelUpGains(character(9), 10);
  const summary = ctx.getLevelUpSummary(gains);
  assert("summary: attack potency", summary.includes("Attack potency +2"), true);
  assert("summary: no defense change at 10", summary.includes("Defense potency"), false);
  assert("apex prompt at 17", ctx.getLevelUpGains(character(16), 17).abp.apex, true);
}

section("Level 0 Characters");
{
  useVariants("levelZeroCharacters");
  const stand = ctx.buildLevelZeroClass("Club");
  const pc0 = {
    _id: "pc0",
    data: { level: 0, conMod: 2, classes: [stand], feats: [], ancestries: [{ data: { hp: 8 } }] },
    fields: {},
  };
  assert("stand-in class is Level 0", ctx.isLevelZeroCharacter(pc0), true);
  assert("real class isn't", ctx.isLevelZeroCharacter(character(1)), false);
  assert("trained Perception", stand.data.perception, "1");
  assert("trained saves", stand.data.savingThrows.will, "1");
  assert("trained unarmed", stand.data.attacks.unarmed, "1");
  assert("trained in the chosen simple weapon", JSON.stringify(stand.data.attacks.other), '{"name":"Club","rank":"1"}');
  assert("trained unarmored only", stand.data.defenses.light + stand.data.defenses.unarmored, "01");
  assert("800 XP to reach 1st", ctx.getXpToNextLevel(pc0), 800);
  assert("1000 XP after that", ctx.getXpToNextLevel(character(3)), 1000);
  assert("5 gp to spend", ctx.getWizardStartingWealthCp(pc0), 500);

  // The 1st-level ancestry feat is chosen at level 0; no class feats
  const feats = slotsOf(pc0);
  assert("ancestry slot at level 0", count(feats, "ancestry", 1), 1);
  assert("no class slots", count(feats, "class"), 0);

  // Skills: 2 + Int at level 0, counted toward the class's total at 1st
  assert("2 + Int skills", ctx.getWizardSkillPicks({ data: { classes: [stand], freeBoosts: ["int"] } }).count, 3);
  assert("fighter adds 1 more at 1st", ctx.getLevelZeroClassSkillPicks({ data: { trainedSkillsAdditional: 3 } }), 1);
  assert("never negative", ctx.getLevelZeroClassSkillPicks({ data: { trainedSkillsAdditional: 1 } }), 0);

  // Hit Points: ancestry HP + Con modifier
  const hpFor = (record) => {
    const saved = {};
    ctx.updateAttribute({ record, attribute: "con", value: 2, moreValuesToSet: saved });
    return saved["data.hitpoints"];
  };
  assert("level 0 HP", hpFor(pc0), 10);
  assert("normal HP unchanged", hpFor(character(2, { ancestries: [{ data: { hp: 8 } }] })), 8 + (10 + 2) * 2);
  useVariants();
}

section("Turning variants on for existing characters");
{
  useVariants();
  assert("no variants, empty key", ctx.getVariantRulesKey(), "");
  useVariants("freeArchetype", "ancestryParagon");
  assert("key lists the variants", ctx.getVariantRulesKey(), "ancestryParagon,freeArchetype");

  // A level 6 character built before Free Archetype: the sheet notices the change
  const built = character(6, { variantRulesKey: "" });
  const values = {};
  ctx.updateVariantRuleFields(built, values);
  assert("new key saved on recalculation", values["data.variantRulesKey"], "ancestryParagon,freeArchetype");
  const same = {};
  ctx.updateVariantRuleFields(character(6, { variantRulesKey: "ancestryParagon,freeArchetype" }), same);
  assert("unchanged key not rewritten", same["data.variantRulesKey"], undefined);

  // The recalculation adds the slots it was missing, and says so
  const before = slotsOf(character(6));
  const after = slotsOf(character(6, { feats: before }));
  useVariants();
  const plain = slotsOf(character(6));
  useVariants("freeArchetype", "ancestryParagon");
  const upgraded = slotsOf(character(6, { feats: plain }));
  assert("archetype slots added", count(upgraded, "archetype"), 3);
  assert("paragon ancestry slots at 1, 1, 3, 5", count(upgraded, "ancestry"), 4);
  assert(
    "player is told what to fill",
    ctx.describeNewFeatSlots(plain, upgraded),
    "New feat slots to fill on the Feats tab: 2 Ancestry, 3 Archetype.",
  );
  assert("nothing new, no message", ctx.describeNewFeatSlots(after, after), "");

  // Turning Free Archetype off keeps chosen archetype feats visible
  useVariants();
  const chosen = {
    name: "Medic Dedication",
    data: { type: "class", featSlotType: "archetype", level: 2, traits: ["Archetype", "Dedication"] },
  };
  const offValues = {};
  ctx.setFeatSlots(character(6, { feats: [chosen] }), offValues);
  assert("section stays while it holds feats", offValues["fields.archetypeFeatsBox.hidden"], false);
  const emptyValues = {};
  ctx.setFeatSlots(character(6), emptyValues);
  assert("section hidden when empty and off", emptyValues["fields.archetypeFeatsBox.hidden"], true);

  // Boost sets stay visible while they hold boosts
  useVariants();
  const boostValues = {};
  ctx.updateVariantRuleFields(character(3, { freeBoostsLevel5: ["str", "dex"] }), boostValues);
  assert("set with boosts stays visible", boostValues["fields.freeBoostsLevel5.hidden"], false);
  assert("empty set below its level hidden", boostValues["fields.freeBoostsLevel10.hidden"], true);
  useVariants("gradualAbilityBoosts");
  const gradualValues = {};
  ctx.updateVariantRuleFields(character(3), gradualValues);
  assert("gradual: set 5 opens at level 2+", gradualValues["fields.freeBoostsLevel5.hidden"], false);
  useVariants();
}

section("Proficiency without Level for creatures");
{
  const npc = (level, data = {}) => ({
    _id: "npc",
    recordType: "npcs",
    data: { level, fortitudeMod: 12, attributes: { ac: { value: 22 } }, ...data },
  });
  const pcRecord = { _id: "pc", recordType: "characters", data: { level: 5, fortitudeMod: 9, ac: 21 } };

  useVariants();
  assert("off: no change", ctx.getNpcProficiencyWithoutLevelAdjustment(npc(5)), 0);
  assert("off: NPC AC as written", ctx.getArmorClassForToken(npc(5)), 22);

  useVariants("proficiencyWithoutLevel");
  assert("NPC subtracts its level", ctx.getNpcProficiencyWithoutLevelAdjustment(npc(5)), -5);
  assert("characters are already handled", ctx.getNpcProficiencyWithoutLevelAdjustment(pcRecord), 0);
  assert("NPC token reads its record", ctx.getNpcProficiencyWithoutLevelAdjustment({ recordType: "tokens", record: { data: { level: 7 } } }), -7);
  assert("level -1 creature adds 1", ctx.getNpcProficiencyWithoutLevelAdjustment(npc(-1)), 1);
  assert("NPC AC drops by level", ctx.getArmorClassForToken(npc(5)), 17);
  assert("NPC save DC drops by level", ctx.getSaveDCForToken(npc(5), "fortitude"), 10 + 12 - 5);
  assert("character AC unchanged", ctx.getArmorClassForToken(pcRecord), 21);
  assert("character save DC unchanged", ctx.getSaveDCForToken(pcRecord, "fortitude"), 19);

  // Rolls show the adjustment as its own line
  const captured = [];
  const promptRoll = ctx.api.promptRoll;
  ctx.api.promptRoll = (name, dice, modifiers) => captured.push({ name, modifiers });
  ctx.rollSave(npc(5), "fortitude");
  ctx.rollSkill(npc(5, { skills: [{ name: "Athletics", data: { mod: 14 } }] }), "athletics");
  ctx.api.promptRoll = promptRoll;
  const pwlLine = (roll) => (roll?.modifiers || []).find((m) => m.name === "Proficiency without Level");
  assert("save roll shows -level", pwlLine(captured[0])?.value, -5);
  assert("skill roll shows -level", pwlLine(captured[1])?.value, -5);
  useVariants();
}

process.exitCode = summary() > 0 ? 1 : 0;
