// Tests for the Character Creation Wizard helpers (skills and languages).
// Record shapes mirror the Player Core module data (Elf, Fighter, Acolyte).

const { createSandbox } = require("./sandbox");
const {
  assert,
  assertIncludes,
  assertNotIncludes,
  section,
  summary,
} = require("./test-helpers");

const ctx = createSandbox();

const elf = {
  name: "Elf",
  data: {
    hp: 6,
    boosts: { 0: ["dex"], 1: ["int"], 2: ["str", "dex", "con", "int", "wis", "cha"] },
    flaws: { 0: ["con"] },
    langauges: ["Taldane (Common)", "Elven"],
    additionalLanguages: { value: ["Draconic", "Empyrean", "Fey (Common)"], count: 0 },
  },
};
const fighter = {
  name: "Fighter",
  data: { hp: 10, keyAbility: ["dex", "str"], trainedSkillsAdditional: 3, trainedSkills: [] },
};

function elfFighter(data = {}) {
  return {
    _id: "pc",
    data: {
      ancestries: [elf],
      classes: [fighter],
      ancestryBoost1: "wis",
      backgroundBoost1: "int",
      backgroundBoost2: "str",
      keyAbility: "str",
      freeBoosts: ["str", "con", "int", "wis"],
      religion: "1",
      ...data,
    },
  };
}

section("getWizardIntMod");
{
  // Elf int boost + background int + free int = +3
  assert("Int from boosts", ctx.getWizardIntMod(elfFighter()), 3);
  assert(
    "alternate boosts drop the fixed Int boost",
    ctx.getWizardIntMod(elfFighter({ alternateAncestryBoosts: true })),
    2,
  );
}

section("getWizardSkillPicks");
{
  const picks = ctx.getWizardSkillPicks(elfFighter());
  assert("3 class skills + Int 3", picks.count, 6);
  assertIncludes("background skill is trained", picks.trained, "religion");
  const values = picks.options.map((option) => option.value);
  assertNotIncludes("trained skill not offered", values, "religion");
  assertIncludes("untrained skill offered", values, "athletics");
  assert("15 skills offered", values.length, 15);

  const lowInt = ctx.getWizardSkillPicks(
    elfFighter({ alternateAncestryBoosts: true, backgroundBoost1: "wis", freeBoosts: ["str", "con", "dex", "wis"] }),
  );
  assert("never below 0 picks", lowInt.count >= 0, true);
}

section("getWizardLanguages");
{
  const languages = ctx.getWizardLanguages(elfFighter());
  assert("ancestry languages cleaned", languages.known.join(","), "Taldane,Elven");
  assert("extra languages from Int", languages.extraCount, 3);
  const values = languages.options.map((option) => option.value);
  assertIncludes("ancestry choice offered", values, "Empyrean");
  assertIncludes("common language offered", values, "Dwarven");
  assertNotIncludes("known language not offered", values, "Elven");
  assert("no duplicates", new Set(values).size, values.length);

  const list = ctx.buildLanguagesList(["Taldane", "Elven"]);
  assert("list entries", list.map((l) => l.name).join(","), "Taldane,Elven");
  assert("list has ids", typeof list[0]._id, "string");
}

section("level 1 feat slots from the class");
{
  const gains = ctx.getLevelUpGains(
    elfFighter({
      classes: [
        {
          ...fighter,
          data: { ...fighter.data, ancestryFeatLevels: ["1", "5"], classFeatLevels: ["1", "2"] },
        },
      ],
    }),
    1,
  );
  assert("level 1 ancestry and class feats", gains.featTypes.join(","), "ancestry,class");
}

section("findFeatSlotIndex");
{
  // Feat levels as on the Player Core class records
  const evenLevels = ["2", "4", "6", "8", "10", "12", "14", "16", "18", "20"];
  const ancestryFeatLevels = ["1", "5", "9", "13", "17"];
  const generalFeatLevels = ["3", "7", "11", "15", "19"];
  const rogue = {
    name: "Rogue",
    data: {
      ancestryFeatLevels,
      classFeatLevels: ["1", ...evenLevels],
      skillFeatLevels: Array.from({ length: 20 }, (_, i) => `${i + 1}`),
      generalFeatLevels,
    },
  };
  const wizard = {
    name: "Wizard",
    data: { ancestryFeatLevels, classFeatLevels: evenLevels, skillFeatLevels: evenLevels, generalFeatLevels },
  };
  // Slots as the sheet makes them when the Class is dropped
  const slotsFor = (classObj, level = 1) => {
    const valuesToSet = {};
    ctx.setFeatSlots({ data: { level, classes: [classObj], feats: [] } }, valuesToSet);
    return valuesToSet["data.feats"];
  };

  const rogueFeats = slotsFor(rogue);
  const skillIndex = ctx.findFeatSlotIndex(rogueFeats, "skill", 1);
  assert("rogue has 3 level 1 slots", rogueFeats.length, 3);
  assert("rogue skill slot found", rogueFeats[skillIndex]?.data.featSlotType, "skill");
  assert("rogue class slot found", ctx.findFeatSlotIndex(rogueFeats, "class", 1) !== -1, true);
  assert("rogue has no general slot", ctx.findFeatSlotIndex(rogueFeats, "general", 1), -1);
  assert("rogue has one ancestry slot", ctx.findFeatSlotIndex(rogueFeats, "ancestry", 1, 1), -1);

  const wizardFeats = slotsFor(wizard);
  assert("wizard ancestry slot found", ctx.findFeatSlotIndex(wizardFeats, "ancestry", 1), 0);
  assert("wizard has no level 1 class slot", ctx.findFeatSlotIndex(wizardFeats, "class", 1), -1);
  assert("wizard has no level 1 skill slot", ctx.findFeatSlotIndex(wizardFeats, "skill", 1), -1);

  const filled = [...rogueFeats];
  filled[skillIndex] = ctx.buildFilledFeatSlot(rogueFeats[skillIndex], {
    _id: "feat",
    name: "Trick Magic Item",
    data: { type: "skill", level: 1 },
  });
  assert("filled slot still found", ctx.findFeatSlotIndex(filled, "skill", 1), skillIndex);

  // A variant (such as Ancestral Paragon) can add a second slot of a type
  const secondAncestry = { _id: "extra", data: { type: "slot", featSlotType: "ancestry", level: "1" } };
  const paragon = [...rogueFeats, secondAncestry];
  assert("first ancestry slot", ctx.findFeatSlotIndex(paragon, "ancestry", 1, 0), 0);
  assert("second ancestry slot (string level)", ctx.findFeatSlotIndex(paragon, "ancestry", 1, 1), 3);
  assert("no third ancestry slot", ctx.findFeatSlotIndex(paragon, "ancestry", 1, 2), -1);

  const levelTwo = slotsFor(rogue, 2);
  assert("level 2 skill slot not counted at level 1", ctx.findFeatSlotIndex(levelTwo, "skill", 1, 1), -1);
  assert("level 2 skill slot found at level 2", levelTwo[ctx.findFeatSlotIndex(levelTwo, "skill", 2)]?.data.level, 2);
  assert("no feats", ctx.findFeatSlotIndex(undefined, "skill", 1), -1);
}

process.exitCode = summary();
