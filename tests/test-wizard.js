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

summary();
