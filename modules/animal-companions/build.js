// Builds the Animal Companions module's records (roadmap H14 phase 2), the
// way Foundry's PF2e Companion Compendia models companions: each companion
// type is an ancestry, "Animal Companion" is a class, and the stages and
// specializations are feats. The ruleset's support is
// rollhandlers/animal-companions.js.
//
// Source: source/player-core-types.json, Player Core's 16 companion types
// from Archives of Nethys (ORC). Icons: icons.json (Realm's icon catalog).
// Run: node modules/animal-companions/build.js  ->  records.json

const fs = require("fs");
const path = require("path");

const here = __dirname;
const TYPES = JSON.parse(fs.readFileSync(path.join(here, "source", "player-core-types.json"), "utf8"));
const ICONS = fs.existsSync(path.join(here, "icons.json"))
  ? JSON.parse(fs.readFileSync(path.join(here, "icons.json"), "utf8"))
  : {};
// Optional creature art, for whoever holds a license for it: art.json maps a
// companion type to { "portrait": "/images/...", "token": "/images/..." }
// (see the README). It isn't part of the module as shared.
const ART = fs.existsSync(path.join(here, "art.json"))
  ? JSON.parse(fs.readFileSync(path.join(here, "art.json"), "utf8"))
  : {};

const PUBLICATION = { license: "ORC", remaster: true, title: "Pathfinder Player Core" };
const UNARMED = '["item:category:unarmed"]';

const slug = (text) =>
  String(text || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
// Stable ids, so a rebuild matches the records already uploaded
const idFor = (...parts) => `ac-${parts.map(slug).join("-")}`;
const traitsList = (traits) => traits.map((name) => ({ _id: idFor("trait", name), name, identified: true, data: {} }));
const icon = (key, fallback) => ICONS[key] || fallback;
const p = (text) => `<p>${text}</p>`;

const modifier = (name, data) => ({
  _id: idFor("mod", name, data.type, data.field || "", data.value, data.predicate || ""),
  name,
  unidentifiedName: "Modifier",
  recordType: "records",
  identified: true,
  data: { modifierType: "none", valueType: "number", active: true, field: "", ...data },
});
const attribute = (name, field, value) =>
  value >= 0
    ? modifier(name, { type: "attributeBonus", field, value: String(value) })
    : modifier(name, { type: "attributePenalty", field, value: String(-value) });
const attributes = (name, values) =>
  Object.entries(values)
    .filter(([, value]) => value !== 0)
    .map(([field, value]) => attribute(name, field, value));
const proficiency = (name, rank, predicate = "") => ({
  _id: idFor("prof", name, rank, predicate),
  name: "Proficiency",
  recordType: "records",
  identified: true,
  data: { name, rank: String(rank), field: "", ...(predicate ? { predicate } : {}) },
});

const ACTION_COSTS = { "Single Action": "oneAction", "Two Actions": "twoActions", "Three Actions": "threeActions", Reaction: "reaction", "Free Action": "free" };
const ACTION_PORTRAITS = { oneAction: "/icons/fantasy/actions/OneAction.webp", twoActions: "/icons/fantasy/actions/TwoActions.webp", threeActions: "/icons/fantasy/actions/ThreeActions.webp", reaction: "/icons/fantasy/actions/Reaction.webp", free: "/icons/fantasy/actions/FreeAction.webp" };
const action = (id, name, cost, description, traits, extra = {}) => {
  const actions = ACTION_COSTS[cost] || cost || "";
  return {
    _id: id,
    name,
    recordType: "actions",
    identified: true,
    unidentifiedName: "Unidentified Action",
    portrait: icon(`actions|${name}`, ACTION_PORTRAITS[actions] || "/icons/fantasy/actions/Passive.webp"),
    data: {
      type: actions ? "action" : "passive",
      actions,
      actionType: actions ? "action" : "passive",
      actionCategory: "offensive",
      description,
      traits,
      traitsList: traitsList(traits),
      publication: PUBLICATION,
      ...extra,
    },
    fields: { actions: { hidden: !actions } },
  };
};

// --- the class -----------------------------------------------------------

function buildClass() {
  return {
    _id: idFor("class", "animal-companion"),
    name: "Animal Companion",
    recordType: "class",
    identified: true,
    portrait: icon("class|Animal Companion", "/icons/fantasy/default-icons/alternatives/ancestries/animal.svg"),
    data: {
      // Matched by name or by this flag (isAnimalCompanionCharacter)
      animalCompanion: true,
      hp: 6,
      keyAbility: [],
      perception: "1",
      classDC: "0",
      spellcasting: "0",
      savingThrows: { fortitude: "1", reflex: "1", will: "1" },
      attacks: { unarmed: "1", simple: "0", martial: "0", advanced: "0", other: { name: "", rank: "0" } },
      // Barding is light or heavy armor in Realm's data
      defenses: { unarmored: "1", light: "1", medium: "0", heavy: "1" },
      trainedSkills: ["Acrobatics", "Athletics"],
      trainedSkillsAdditional: 0,
      ancestryFeatLevels: [],
      classFeatLevels: [],
      generalFeatLevels: [],
      skillFeatLevels: [],
      skillIncreaseLevels: [],
      description:
        p("An animal companion is a loyal comrade who follows your orders. It has the animal and minion traits, and it gains 2 actions during your turn if you use the Command an Animal action to command it. Its level is equal to yours (set its master on the Notes tab).") +
        p("It is trained in its unarmed attacks, unarmored defense, barding, all saving throws, Perception, Acrobatics and Athletics. Its Hit Points are its type's ancestry Hit Points plus 6 plus its Constitution modifier for each level. The only item bonuses it can benefit from are to Speed and AC, and its maximum item bonus to AC is +3. It doesn't gain attribute boosts, skill increases or feats from leveling up; advance it with the Mature, Nimble, Savage and Specialized Animal Companion feats when you take the matching feats.") +
        p("<em>Player Core pg. 206.</em>"),
      traits: ["Animal Companion"],
      traitsList: traitsList(["Animal Companion"]),
      features: [
        {
          _id: idFor("feature", "animal-companion"),
          name: "Animal Companion",
          recordType: "features",
          identified: true,
          data: {
            level: 1,
            type: "classfeature",
            description: p("Your companion has the animal and minion traits."),
            modifiers: [
              modifier("Animal Companion", { type: "trait", valueType: "string", value: "Minion" }),
              modifier("Animal Companion", { type: "trait", valueType: "string", value: "Animal" }),
            ],
          },
        },
      ],
      publication: PUBLICATION,
    },
  };
}

// --- the stage and specialization feats ------------------------------------

const MATURE = "feat:mature-animal-companion";
const NIMBLE = "feat:nimble-animal-companion";
const SAVAGE = "feat:savage-animal-companion";
const SPECIALIZATIONS = {
  Ambusher: {
    text: "In your companion's natural environment, it can use a Sneak action even if it's currently observed. Its proficiency rank in Stealth increases to expert (or master if it was already an expert from its type), and its Dexterity modifier increases by 1. Its proficiency rank for unarmored defense increases to expert.",
    attributes: { dex: 1 },
    proficiencies: [["stealth", 2], ["unarmored", 2]],
    typeSkill: "stealth",
  },
  Bully: {
    text: "Your companion terrorizes foes with dominance displays and pushes them around the battlefield. Its proficiency ranks for Athletics and Intimidation increase to expert (or master if it was already expert from its type), its Strength modifier increases by 1, and its Charisma modifier increases by 3.",
    attributes: { str: 1, cha: 3 },
    proficiencies: [["athletics", 2], ["intimidation", 2]],
    typeSkill: "intimidation",
  },
  Daredevil: {
    text: "Your companion joins the fray with graceful leaps and dives. It gains the deny advantage ability, so it isn't off-guard to hidden, undetected, or flanking creatures unless such a creature's level is greater than yours. Its proficiency rank in Acrobatics increases to master, and its Dexterity modifier increases by 1. Its proficiency rank in unarmored defense increases to expert.",
    attributes: { dex: 1 },
    proficiencies: [["acrobatics", 3], ["unarmored", 2]],
  },
  Racer: {
    text: "Your companion races. It gains a +10-foot status bonus to its Speed, swim Speed, or fly Speed (your choice). Its proficiency in Fortitude saves increases to legendary, and its Constitution modifier increases by 1.",
    attributes: { con: 1 },
    proficiencies: [["fortitude", 4]],
    modifiers: [{ type: "speedBonus", modifierType: "status", value: "10" }],
  },
  Tracker: {
    text: "Your companion is an incredible tracker. It can move at full Speed while following tracks. Its proficiency rank in Survival increases to expert (or master if it was already an expert from its type), and its Wisdom modifier increases by 1.",
    attributes: { wis: 1 },
    proficiencies: [["survival", 2]],
    typeSkill: "survival",
  },
  Wrecker: {
    text: "Your companion smashes things. Its unarmed attacks ignore half an object's Hardness. Its Athletics proficiency increases to master, and its Strength modifier increases by 1.",
    attributes: { str: 1 },
    proficiencies: [["athletics", 3]],
  },
};

// A feat for the companion itself, added when its master takes the matching
// feat (masterLevel: the master's feat level, for the text). It's level 1:
// Realm counts a feat's proficiencies only from its level on, and the
// companion's level is its master's.
function feat(name, masterLevel, description, { modifiers = [], proficiencies = [], traits = ["Animal Companion"] } = {}) {
  const level = 1;
  return {
    _id: idFor("feat", name),
    name,
    recordType: "feats",
    identified: true,
    unidentifiedName: "Unidentified Feat",
    portrait: icon(`feats|${name}`, "/icons/fantasy/sundries/books/book-red-exclamation.webp"),
    data: {
      level,
      levelLabel: "Companion",
      type: "bonus",
      actionType: "passive",
      actions: "",
      prerequisites: "Animal Companion",
      description: description + p(`<em>Add this feat to your animal companion when you take the matching feat (feat ${masterLevel} or higher for you). Player Core pg. 211.</em>`),
      traits,
      traitsList: traitsList(traits),
      modifiers,
      proficiencies: proficiencies.map(([skill, rank, predicate]) => proficiency(skill, rank, predicate)),
      publication: PUBLICATION,
    },
    fields: { actions: { hidden: true }, keyOptions: { hidden: true }, levelLabel: { hidden: false } },
  };
}

function buildFeats() {
  const feats = [
    feat(
      "Mature Animal Companion",
      4,
      p("Your companion grows up. If it is Medium or smaller, it grows by one size. Increase its Strength, Dexterity, Constitution, and Wisdom modifiers by 1. Increase its proficiency rank for Perception and all saving throws to expert. Increase its proficiency ranks in Intimidation, Stealth, and Survival to trained, and if it was already trained in one of those skills from its type, increase its proficiency rank in that skill to expert. Increase its unarmed attack damage from one die to two dice."),
      {
        modifiers: [
          modifier("Mature Animal Companion", { type: "creatureSize", valueType: "string", value: "+1" }),
          ...attributes("Mature Animal Companion", { str: 1, dex: 1, con: 1, wis: 1 }),
          modifier("Mature Animal Companion", { type: "weaponDiceCount", value: "2", predicate: UNARMED }),
        ],
        proficiencies: [["perception", 2], ["fortitude", 2], ["reflex", 2], ["will", 2], ["intimidation", 1], ["stealth", 1], ["survival", 1]],
      },
    ),
    feat(
      "Nimble Animal Companion",
      6,
      p("Your mature companion becomes nimble. Increase its Dexterity modifier by 2 and its Strength, Constitution, and Wisdom modifiers by 1. Increase its proficiency rank in Acrobatics to expert. It deals 2 additional damage with its unarmed attacks. Its attacks become magical for the purpose of ignoring resistances. It learns the advanced maneuver for its type."),
      {
        modifiers: [
          ...attributes("Nimble Animal Companion", { dex: 2, str: 1, con: 1, wis: 1 }),
          modifier("Nimble Animal Companion", { type: "damageBonus", field: "all", value: "2", predicate: UNARMED }),
          modifier("Nimble Animal Companion", { type: "weaponTrait", valueType: "string", value: "Magical", predicate: UNARMED }),
        ],
        proficiencies: [["acrobatics", 2]],
      },
    ),
    feat(
      "Savage Animal Companion",
      6,
      p("Your mature companion becomes savage. If it is Medium or smaller, it grows by one size. Increase its Strength modifier by 2 and its Dexterity, Constitution, and Wisdom modifiers by 1. Increase its proficiency rank in Athletics to expert. It deals 3 additional damage with its unarmed attacks. Its attacks become magical for the purpose of ignoring resistances. It learns the advanced maneuver for its type."),
      {
        modifiers: [
          modifier("Savage Animal Companion", { type: "creatureSize", valueType: "string", value: "+1" }),
          ...attributes("Savage Animal Companion", { str: 2, dex: 1, con: 1, wis: 1 }),
          modifier("Savage Animal Companion", { type: "damageBonus", field: "all", value: "3", predicate: UNARMED }),
          modifier("Savage Animal Companion", { type: "weaponTrait", valueType: "string", value: "Magical", predicate: UNARMED }),
        ],
        proficiencies: [["athletics", 2]],
      },
    ),
    feat(
      "Specialized Animal Companion",
      14,
      p("Your nimble or savage companion becomes specialized; pick one specialization below and add it too. Its proficiency rank for unarmed attacks increases to expert. Its proficiency ranks for saving throws and Perception increase to master. Increase its Dexterity modifier by 1 and its Intelligence modifier by 2. Its unarmed attack damage increases from two dice to three dice, and it increases its additional damage with unarmed attacks from 2 to 4 or from 3 to 6."),
      {
        modifiers: [
          ...attributes("Specialized Animal Companion", { dex: 1, int: 2 }),
          modifier("Specialized Animal Companion", { type: "weaponDiceCount", value: "3", predicate: UNARMED }),
          // The additional damage doubles: 2 more for a nimble one, 3 for a savage one
          modifier("Specialized Animal Companion", { type: "damageBonus", field: "all", value: "2", predicate: JSON.stringify(["item:category:unarmed", NIMBLE]) }),
          modifier("Specialized Animal Companion", { type: "damageBonus", field: "all", value: "3", predicate: JSON.stringify(["item:category:unarmed", SAVAGE]) }),
        ],
        proficiencies: [["unarmed", 2], ["perception", 3], ["fortitude", 3], ["reflex", 3], ["will", 3]],
      },
    ),
  ];
  Object.entries(SPECIALIZATIONS).forEach(([name, spec]) => {
    feats.push(
      feat(name, 14, p(spec.text), {
        modifiers: [
          ...attributes(name, spec.attributes),
          ...(spec.modifiers || []).map((data) => modifier(name, data)),
        ],
        proficiencies: spec.proficiencies,
        traits: ["Animal Companion", "Specialization"],
      }),
    );
  });
  return feats;
}

// --- the ancestries ----------------------------------------------------------

// The companion's senses as Realm's vision and sense modifiers
function senses(type, name) {
  const text = String(type.senses || "").toLowerCase();
  const vision = text.includes("darkvision") ? "Darkvision" : text.includes("low-light") ? "Low-Light Vision" : "";
  const extra = String(type.senses || "")
    .split(/,(?![^(]*\))/)
    .map((sense) => sense.trim())
    .filter((sense) => sense && !/^(low-light vision|darkvision)$/i.test(sense));
  return { vision, modifiers: extra.map((sense) => modifier(name, { type: "sense", valueType: "string", value: sense })) };
}

function weapon(type, attack) {
  const name = attack.name;
  const traits = [...new Set([...(attack.traits || []), "Unarmed"])];
  const extra = attack.extra ? ` It deals its listed damage ${attack.extra}.` : "";
  return {
    _id: idFor("item", type.name, name),
    name,
    recordType: "items",
    identified: true,
    unidentifiedName: name,
    portrait: icon(`items|${name}`, "/icons/fantasy/default-icons/melee.svg"),
    data: {
      type: "weapon",
      level: 0,
      itemCategory: "Unarmed",
      group: "Brawling",
      range: attack.ranged ? "30" : "",
      traits,
      traitsList: traitsList(traits),
      damage: { dice: 1, die: `d${attack.die}`, damageType: attack.type },
      description: p(`Your ${type.name.toLowerCase()} companion's ${name.toLowerCase()}.${extra}`),
      publication: PUBLICATION,
    },
  };
}

function buildAncestry(type) {
  const name = type.name;
  const featureName = `${name} Companion`;
  const typeSkill = String(type.skill || "").toLowerCase();
  const { vision, modifiers: senseModifiers } = senses(type, featureName);
  const otherSpeeds = Object.entries(type.speed || {})
    .filter(([kind]) => kind !== "land")
    .map(([kind, feet]) => modifier(featureName, { type: "speed", field: kind, value: String(feet) }));

  const support = action(idFor("action", name, "support"), "Support", "Single Action", p(`<strong>Support Benefit</strong> ${type.support}`) + p("<em>Command your animal companion to Support you (Player Core pg. 206). If it Supports, the only other actions it can use this turn are basic move actions to get into position for the benefit.</em>"), ["Animal Companion"]);
  const maneuver = action(idFor("action", name, type.maneuver.name), type.maneuver.name, type.maneuver.actions, p(type.maneuver.text) + p("<em>Advanced maneuver: your companion learns it when it becomes nimble or savage.</em>"), ["Animal Companion"], {
    predicate: JSON.stringify([{ or: [NIMBLE, SAVAGE] }]),
  });

  // Its type's skill: trained, expert when mature (Mature raises Intimidation,
  // Stealth and Survival a rank), master with a specialization that raises it
  const proficiencies = [proficiency(typeSkill, 1), proficiency(typeSkill, 2, JSON.stringify([MATURE]))];
  Object.entries(SPECIALIZATIONS).forEach(([specName, spec]) => {
    if (spec.typeSkill === typeSkill) proficiencies.push(proficiency(typeSkill, 3, JSON.stringify([`feat:${slug(specName)}`])));
  });

  const special = type.special
    ? type.special === "mount"
      ? p("<strong>Mount</strong> Your companion is especially suited for riding: a rider doesn't keep it from using its other Speeds or from moving and Supporting you on the same turn.")
      : p(`<strong>Special</strong> ${type.special}`)
    : "";

  return {
    _id: idFor("ancestry", name),
    name,
    recordType: "ancestry",
    identified: true,
    unidentifiedName: "Unidentified Ancestries",
    portrait: ART[name]?.portrait || icon(`ancestry|${name}`, "/icons/fantasy/default-icons/npc.svg"),
    data: {
      // A companion type: dropping it asks for no heritage
      // (isAnimalCompanionAncestry)
      animalCompanion: true,
      // Its token picture, when the art has one (getCompanionImageValues)
      ...(ART[name]?.token ? { tokenImage: ART[name].token } : {}),
      hp: type.hp,
      size: type.sizes[0],
      speed: `${type.speed?.land || 0} feet`,
      reach: 5,
      vision,
      // Companions have no boosts or flaws: their attributes are fixed by
      // their type (the feature's attribute modifiers)
      boosts: {},
      flaws: {},
      langauges: [],
      additionalLanguages: { value: [], count: 0 },
      description:
        p(`An animal companion type (Player Core ${type.page}). Use it as the ancestry of an animal companion character, with the Animal Companion class.`) +
        (type.sizes.length > 1 ? p(`It can start ${type.sizes.map((s) => s[0].toUpperCase() + s.slice(1)).join(" or ")}; change the character's size if you pick another.`) : "") +
        special,
      traits: ["Animal"],
      traitsList: traitsList(["Animal"]),
      features: [
        {
          _id: idFor("feature", name, "companion"),
          name: featureName,
          recordType: "features",
          identified: true,
          data: {
            level: 1,
            type: "ancestryfeature",
            description:
              p(`<strong>Attributes</strong> Str ${signed(type.str)}, Dex ${signed(type.dex)}, Con ${signed(type.con)}, Int ${signed(type.int)}, Wis ${signed(type.wis)}, Cha ${signed(type.cha)}. <strong>Skill</strong> ${type.skill}. <strong>Senses</strong> ${type.senses}.`) +
              p(`<strong>Support Benefit</strong> ${type.support}`) +
              special,
            modifiers: [
              ...attributes(featureName, { str: type.str, dex: type.dex, con: type.con, int: type.int, wis: type.wis, cha: type.cha }),
              ...senseModifiers,
              ...otherSpeeds,
            ],
            proficiencies,
            providesItems: [...type.attacks.map((attack) => weapon(type, attack)), support, maneuver],
          },
        },
      ],
      publication: PUBLICATION,
    },
  };
}
const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);

function build() {
  return {
    ancestry: TYPES.map(buildAncestry),
    class: [buildClass()],
    feats: buildFeats(),
  };
}

module.exports = { build, SPECIALIZATIONS };

if (require.main === module) {
  const records = build();
  fs.writeFileSync(path.join(here, "records.json"), JSON.stringify(records, null, 1) + "\n");
  console.log(Object.entries(records).map(([type, list]) => `${list.length} ${type}`).join(", "));
}
