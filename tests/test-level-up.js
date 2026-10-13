// Tests for the guided Level Up helpers (Player Core: Leveling Up).

const { createSandbox } = require("./sandbox");
const {
  assert,
  assertIncludes,
  assertNotIncludes,
  section,
  summary,
} = require("./test-helpers");

const ctx = createSandbox();

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
    features: [
      { name: "Bravery", data: { level: 3 } },
      { name: "Fighter Weapon Mastery", data: { level: 5 } },
    ],
  },
};

function character(level, data = {}) {
  return {
    _id: "pc",
    name: "Valeros",
    data: { level, conMod: 2, classes: [fighter], ...data },
  };
}

section("getLevelUpGains");
{
  const at2 = ctx.getLevelUpGains(character(1), 2);
  assert("level 2 HP is class HP + Con", at2.hp, 12);
  assert("level 2 has no boosts", at2.attributeBoosts, false);
  assert("level 2 has no skill increase", at2.skillIncrease, false);
  assert("level 2 feats", at2.featTypes.join(","), "class,skill");

  const at3 = ctx.getLevelUpGains(character(2), 3);
  assert("level 3 skill increase", at3.skillIncrease, true);
  assert("level 3 feats", at3.featTypes.join(","), "general");
  assert("level 3 class feature", at3.classFeatures.join(","), "Bravery");

  const at5 = ctx.getLevelUpGains(character(4), 5);
  assert("level 5 boosts", at5.attributeBoosts, true);
  assert("level 5 feats", at5.featTypes.join(","), "ancestry");

  const at10 = ctx.getLevelUpGains(character(9), 10);
  assert("level 10 boosts", at10.attributeBoosts, true);

  const noClass = ctx.getLevelUpGains({ data: { level: 1 } }, 2);
  assert("no class gives no feats", noClass.featTypes.length, 0);
  assert("no class gives 0 HP", noClass.hp, 0);
}

section("getLevelUpSummary");
{
  const text = ctx.getLevelUpSummary(ctx.getLevelUpGains(character(4), 5));
  assert("summary lists HP", text.includes("+12 maximum Hit Points"), true);
  assert("summary lists boosts", text.includes("4 attribute boosts"), true);
  assert("summary lists feature", text.includes("Fighter Weapon Mastery"), true);
  assert("summary lists ancestry feat", text.includes("Ancestry feat"), true);
}

section("getSkillIncreaseOptions");
{
  const pc = character(2, { athletics: "2", acrobatics: "1", stealth: "3" });
  const at3 = ctx.getSkillIncreaseOptions(pc, 3).map((o) => o.value);
  assertNotIncludes("expert cannot become master before 7", at3, "athletics");
  assertIncludes("trained can become expert", at3, "acrobatics");
  assertIncludes("untrained can become trained", at3, "arcana");
  assertNotIncludes("master already above cap", at3, "stealth");

  const at7 = ctx.getSkillIncreaseOptions(pc, 7).map((o) => o.value);
  assertIncludes("expert can become master at 7", at7, "athletics");
  assertNotIncludes("master cannot become legendary before 15", at7, "stealth");

  const at15 = ctx.getSkillIncreaseOptions(pc, 15).map((o) => o.value);
  assertIncludes("master can become legendary at 15", at15, "stealth");

  const label = ctx
    .getSkillIncreaseOptions(pc, 3)
    .find((o) => o.value === "acrobatics").label;
  assert("option label", label, "Acrobatics: Trained to Expert");
}

section("getLevelUpBoostOptions");
{
  const options = ctx.getLevelUpBoostOptions(
    character(4, { strMod: 4, dexMod: -1 }),
  );
  assert("six options", options.length, 6);
  assert("partial boost note at +4", options[0].label, "Strength (+4, partial boost)");
  assert("negative modifier", options[1].label, "Dexterity (-1)");
}

section("getFeatSlotQuery");
{
  const pc = character(2, {
    ancestries: [{ name: "Human" }],
    heritages: [{ name: "Skilled Human" }],
    traits: ["human", "Humanoid"],
  });
  const classQuery = ctx.getFeatSlotQuery(pc, "class", 2).query;
  assert("class feat type", classQuery["data.type"], "class");
  assert(
    "class feat trait",
    classQuery["data.traits"].$elemMatch.$regex,
    "^Fighter$",
  );

  const generalQuery = ctx.getFeatSlotQuery(pc, "general", 3).query;
  assert(
    "general slot allows skill feats",
    generalQuery["data.type"].$in.join(","),
    "general,skill",
  );

  const ancestryQuery = ctx.getFeatSlotQuery(pc, "ancestry", 5).query;
  assert(
    "ancestry traits deduplicated",
    ancestryQuery["data.traits"].$elemMatch.$regex,
    "^(Human|Skilled Human|Humanoid)$",
  );
}

section("buildFilledFeatSlot and getPromptSelections");
{
  const slot = {
    _id: "slot-1",
    data: { type: "slot", level: 4, featSlotType: "class", slotOrder: 3 },
  };
  const feat = { _id: "feat-1", name: "Power Attack", data: { level: 1, type: "class" } };
  const filled = ctx.buildFilledFeatSlot(slot, feat);
  assert("keeps slot id", filled._id, "slot-1");
  assert("keeps slot level", filled.data.level, 4);
  assert("keeps slot type", filled.data.featSlotType, "class");
  assert("shows feat details", filled.fields.featDetails.hidden, false);

  assert("array of values", ctx.getPromptSelections(["str", "dex"]).join(","), "str,dex");
  assert("single value", ctx.getPromptSelections("con").join(","), "con");
  assert("option objects", ctx.getPromptSelections([{ label: "Wis", value: "wis" }]).join(","), "wis");
  assert("records pass through", ctx.getPromptSelections([feat])[0].name, "Power Attack");
  assert("cancel gives empty", ctx.getPromptSelections(null).length, 0);
}

summary();
