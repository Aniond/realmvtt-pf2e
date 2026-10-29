// GM tools: encounter XP, advancement speed, initiative order and DCs.
//
//   - Encounter XP, and under Proficiency without Level its
//     own creature table from -7 to +7 levels (GM Core pg. 85);
//     onEncounterEnd.js
//   - Advancement speed (GM Core): fast 800, standard 1,000 or slow
//     1,200 XP a level, or story milestones (Level Up always shows);
//     getXpToNextLevel in common.js and characters-main.html
//   - Initiative: a complex hazard rolls its Stealth, and an adversary that
//     ties a PC goes first (Player Core); initiative.js
//   - DCs (GM Core): simple DCs by proficiency, level-based DCs,
//     the difficulty and rarity adjustments, and a GM prompt that posts a
//     check for the selected tokens (showDCHelper, run from a chat macro)

// ---------------------------------------------------------------- XP

// XP for a creature by its level minus the party's (GM Core)
const CREATURE_XP = { "-4": 10, "-3": 15, "-2": 20, "-1": 30, 0: 40, 1: 60, 2: 80, 3: 120, 4: 160 };

// Proficiency without Level (GM Core pg. 85), as Foundry's
// xpVariantCreatureDifferences
const CREATURE_XP_WITHOUT_LEVEL = {
  "-7": 9, "-6": 12, "-5": 14, "-4": 18, "-3": 21, "-2": 26, "-1": 32, 0: 40,
  1: 48, 2: 60, 3: 72, 4: 90, 5: 108, 6: 135, 7: 160,
};

// Simple hazards (GM Core), with or without Proficiency without Level: the
// variant has only a creature table, and Foundry's getHazardXp keeps this one
const SIMPLE_HAZARD_XP = { "-4": 2, "-3": 3, "-2": 4, "-1": 6, 0: 8, 1: 12, 2: 16, 3: 24, 4: 32 };

// XP for one enemy: a creature or complex hazard by the creature table, a
// simple hazard by its own. Below the table it grants nothing; above it,
// the table's highest.
function getEncounterXp(levelDiff, { hazard = false, complex = false } = {}, variants = getVariantRules()) {
  const simpleHazard = hazard && !complex;
  const withoutLevel = variants.proficiencyWithoutLevel && !simpleHazard;
  const table = simpleHazard ? SIMPLE_HAZARD_XP : withoutLevel ? CREATURE_XP_WITHOUT_LEVEL : CREATURE_XP;
  const range = withoutLevel ? 7 : 4;
  const diff = parseInt(levelDiff, 10) || 0;
  if (diff < -range) return 0;
  return table[String(Math.min(range, diff))];
}

// ---------------------------------------------------------------- Advancement

const ADVANCEMENT_XP = { fast: 800, standard: 1000, slow: 1200 };

// The campaign's advancement speed: fast, standard, slow or milestone
function getAdvancementSpeed() {
  let value = null;
  try {
    value = typeof api?.getSetting === "function" ? api.getSetting("advancementSpeed") : null;
  } catch (e) {
    value = null;
  }
  return (ADVANCEMENT_XP[value] || value === "milestone") ? value : "standard";
}

// XP a level at the campaign's speed (0 for story milestones)
function getAdvancementXp(speed = getAdvancementSpeed()) {
  return speed === "milestone" ? 0 : ADVANCEMENT_XP[speed] || 1000;
}

// ---------------------------------------------------------------- Initiative

// A creature's initiative statistic: what its sheet picks, Perception by
// default. A hazard has no Perception: a complex hazard rolls its Stealth
// (GM Core).
function getInitiativeSkill(creature) {
  const data = creature?.data ?? creature?.record?.data;
  if (data?.type === "hazard") return "Stealth";
  return data?.initiativeSkill || "Perception";
}

// A hazard's Stealth modifier: data.stealth.value, as the converter copies
// Foundry's system.attributes.stealth.value (Hidden Pit: 8, DC 18)
function getHazardStealthMod(record) {
  const mod = parseInt(record?.data?.stealth?.value, 10);
  return Number.isFinite(mod) ? mod : 0;
}

// Ties (Player Core): "If your result is tied with a foe's result,
// the adversary goes first". The combat tracker sorts on the initiative alone,
// so an enemy's initiative gets a tenth more than its roll: it goes ahead of
// a PC or ally who rolled the same, and stays behind anyone who rolled
// higher. Ties on the same side are left to the table.
const ADVERSARY_INITIATIVE_TIEBREAK = 0.1;

function isInitiativeAdversary(token) {
  if (token?.faction) return token.faction === "enemy";
  return token?.recordType !== "characters";
}

function getInitiativeValue(total, token) {
  const value = parseFloat(total) || 0;
  return isInitiativeAdversary(token) ? Math.round((value + ADVERSARY_INITIATIVE_TIEBREAK) * 10) / 10 : value;
}

// ---------------------------------------------------------------- DCs

// Simple DCs (GM Core), by proficiency rank (0 untrained to 4
// legendary)
const SIMPLE_DCS = [10, 15, 20, 30, 40];

function getSimpleDC(rank) {
  const index = typeof rank === "string" && isNaN(parseInt(rank, 10))
    ? PROFICIENCY_RANK_NAMES.findIndex((name) => name.toLowerCase() === rank.toLowerCase())
    : parseInt(rank, 10);
  return SIMPLE_DCS[index] ?? SIMPLE_DCS[1];
}

// DC adjustments (GM Core). Rarity uses the same steps: uncommon is
// hard, rare very hard, unique incredibly hard.
const DC_ADJUSTMENTS = [
  { value: "incredibly easy", label: "Incredibly easy (-10)", adjustment: -10 },
  { value: "very easy", label: "Very easy (-5)", adjustment: -5 },
  { value: "easy", label: "Easy (-2)", adjustment: -2 },
  { value: "normal", label: "Normal (+0)", adjustment: 0 },
  { value: "hard", label: "Hard or uncommon (+2)", adjustment: 2 },
  { value: "very hard", label: "Very hard or rare (+5)", adjustment: 5 },
  { value: "incredibly hard", label: "Incredibly hard or unique (+10)", adjustment: 10 },
];

function getDCAdjustment(difficulty) {
  const key = `${difficulty || ""}`.toLowerCase();
  const rarity = { uncommon: "hard", rare: "very hard", unique: "incredibly hard" }[key] || key;
  return DC_ADJUSTMENTS.find((a) => a.value === rarity)?.adjustment || 0;
}

const DC_HELPER_SKILLS = [
  "Perception", "Acrobatics", "Arcana", "Athletics", "Crafting", "Deception",
  "Diplomacy", "Intimidation", "Medicine", "Nature", "Occultism", "Performance",
  "Religion", "Society", "Stealth", "Survival", "Thievery",
];

// The party's level: the average of the characters on the scene (1 when
// there are none)
function getSceneCharacterLevel() {
  let tokens = [];
  try {
    tokens = [...(api.getOtherTokens?.() || []), api.getToken?.()].filter(Boolean);
  } catch (e) {
    tokens = [];
  }
  const levels = tokens
    .filter((t) => t.recordType === "characters" && t.faction !== "enemy")
    .map((t) => parseInt(t.data?.level ?? t.record?.data?.level, 10))
    .filter(Number.isFinite);
  if (levels.length === 0) return 1;
  return Math.round(levels.reduce((sum, level) => sum + level, 0) / levels.length);
}

// The DC choices: the five simple DCs, then level-based DCs around the party's
// level
function getDCHelperOptions(partyLevel = getSceneCharacterLevel()) {
  const simple = PROFICIENCY_RANK_NAMES.map((name, rank) => ({
    label: `${name} (simple DC ${SIMPLE_DCS[rank]})`,
    value: `simple:${rank}`,
  }));
  const levels = [-1, 0, 1, 2]
    .map((offset) => partyLevel + offset)
    .filter((level) => level >= -1 && level <= 25)
    .map((level) => ({
      label: `Level ${level}${level === partyLevel ? " (the party's)" : ""} (DC ${getDCForLevel(level)})`,
      value: `level:${level}`,
    }));
  return [...simple, ...levels];
}

// A DC from a choice ("simple:2", "level:5") and an adjustment
function getDCFromChoice(choice, difficulty = "normal") {
  const [kind, number] = `${choice || ""}`.split(":");
  const base = kind === "level" ? getDCForLevel(parseInt(number, 10)) : getSimpleDC(number);
  return base + getDCAdjustment(difficulty);
}

// The chat message calling for a check: a button that rolls it for the
// selected tokens, with the DC shown to the GM only
function getCallForCheckMessage(skill, dc, note = "") {
  const escaped = `${skill}`.toLowerCase().replace(/'/g, "\\'");
  const label = `Roll_${capitalize(skill).replace(/\s+/g, "_")}`;
  return `**[center]${capitalize(skill)} check[/center]**
[center][gm]DC ${dc}${note ? ` (${note})` : ""}[/gm][/center]

\`\`\`${label}
rollSkillCheck('${escaped}', ${dc});
\`\`\``;
}

// The GM's DC prompt: the skill, the DC, then the adjustment. Posts the check.
// Run it from a chat macro: showDCHelper()
function showDCHelper() {
  const pick = (choice) => (Array.isArray(choice) ? choice[0] : choice);
  const toOptions = (values) => values.map((value) => ({ label: value, value }));
  api.showPrompt(
    "Call for a Check",
    "Which check?",
    "Select...",
    toOptions(DC_HELPER_SKILLS),
    null,
    (skillChoice) => {
      const skill = pick(skillChoice);
      if (!skill) return;
      const options = getDCHelperOptions();
      api.showPrompt(
        "Call for a Check",
        `${skill}: a simple DC for the proficiency the task needs, or a level-based DC.`,
        "Select...",
        options,
        null,
        (dcChoice) => {
          const choice = pick(dcChoice);
          if (!choice) return;
          api.showPrompt(
            "Call for a Check",
            `${skill}: how hard, or how rare?`,
            "Select...",
            DC_ADJUSTMENTS.map(({ label, value }) => ({ label, value })),
            null,
            (difficultyChoice) => {
              const difficulty = pick(difficultyChoice) || "normal";
              const dc = getDCFromChoice(choice, difficulty);
              const base = options.find((o) => o.value === choice)?.label || "";
              const note = difficulty === "normal" ? base : `${base}, ${difficulty}`;
              api.sendMessage(getCallForCheckMessage(skill, dc, note));
            },
            "OK",
            "Cancel",
            1,
          );
        },
        "OK",
        "Cancel",
        1,
      );
    },
    "OK",
    "Cancel",
    1,
  );
}
