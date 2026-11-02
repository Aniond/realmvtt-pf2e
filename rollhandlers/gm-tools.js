// GM tools: encounter XP, advancement speed, initiative order and DCs.
//
//   - Encounter XP, and under Proficiency without Level its
//     own creature table from -7 to +7 levels (GM Core pg. 85);
//     onEncounterEnd.js
//   - Threat (GM Core, roadmap H21): the budgets by party size, and an
//     encounter builder on the GM Tools panel (gm-tools-panel.html) with a
//     meter and templates that spend a threat's budget exactly
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

// ---------------------------------------------------------------- Threat

// The encounter budget (GM Core, Table 10-1): the XP for four characters, and
// how much each character more or fewer adds or takes away
const ENCOUNTER_THREATS = [
  { name: "Trivial", budget: 40, adjustment: 10 },
  { name: "Low", budget: 60, adjustment: 20 },
  { name: "Moderate", budget: 80, adjustment: 20 },
  { name: "Severe", budget: 120, adjustment: 30 },
  { name: "Extreme", budget: 160, adjustment: 40 },
];

// Each threat's budget for the party's size
function getEncounterBudgets(partySize = 4) {
  const size = parseInt(partySize, 10) || 4;
  return ENCOUNTER_THREATS.map(({ name, budget, adjustment }) => ({
    name,
    budget: Math.max(0, budget + (size - 4) * adjustment),
  }));
}

// The threat for an XP total: the highest budget it reaches (Trivial below
// Low), "Beyond Extreme" past Extreme's
function getEncounterThreat(totalXp, partySize = 4) {
  const budgets = getEncounterBudgets(partySize);
  const extreme = budgets[budgets.length - 1];
  if (totalXp > extreme.budget) return "Beyond Extreme";
  const reached = budgets.filter((b) => b.name !== "Trivial" && totalXp >= b.budget);
  return reached.length ? reached[reached.length - 1].name : "Trivial";
}

// The party in an encounter: its characters' average level and how many
function getEncounterParty(tokens) {
  const characters = (tokens || []).filter((t) => t?.faction !== "enemy" && t?.recordType === "characters");
  if (!characters.length) return null;
  const levels = characters.map((t) => parseInt(t.data?.level, 10) || 1);
  return {
    level: Math.round(levels.reduce((sum, level) => sum + level, 0) / levels.length),
    size: characters.length,
  };
}

// Each enemy's XP against the party's level: creatures and complex hazards by
// the creature table, simple hazards by theirs. Takes tokens, or the
// builder's creatures ({ name, level, type, complex }).
function getEncounterBreakdown(enemies, partyLevel) {
  return (enemies || []).map((enemy) => {
    const level = parseInt(enemy?.data?.level ?? enemy?.level, 10) || 0;
    const hazard = (enemy?.data?.type ?? enemy?.type) === "hazard";
    const complex = !!(enemy?.data?.isComplex ?? enemy?.complex);
    const xp = getEncounterXp(level - partyLevel, { hazard, complex });
    let type = hazard ? (complex ? "Complex Hazard" : "Simple Hazard") : "Creature";
    if (xp === 0) type = hazard ? "Trivial Hazard" : "Trivial Creature";
    return { name: enemy?.name || "Unknown", level, type, xp };
  });
}

// An encounter's threat from its tokens (characters against enemies), or null
// without both
function getEncounterThreatSummary(tokens) {
  const party = getEncounterParty(tokens);
  const enemies = (tokens || []).filter((t) => t?.faction === "enemy");
  if (!party || !enemies.length) return null;
  const breakdown = getEncounterBreakdown(enemies, party.level);
  const totalXp = breakdown.reduce((sum, e) => sum + e.xp, 0);
  return {
    partyLevel: party.level,
    partySize: party.size,
    breakdown,
    totalXp,
    threat: getEncounterThreat(totalXp, party.size),
    budgets: getEncounterBudgets(party.size),
  };
}

// The budgets as one line: "Trivial 40, Low 60, ..."
function getEncounterBudgetLine(budgets) {
  return budgets.map((b) => `${b.name} ${b.budget}`).join(", ");
}

// ---------------------------------------------------------------- Builder

// The encounter builder (the GM Tools panel, gm-tools-panel.html) keeps its
// party and creatures in campaign variables, so the panel shows them and
// they're there next time. Campaign variables reach every client, so the
// creatures are only { level, type, complex }: no names.
const ENCOUNTER_BUILDER_VARS = {
  level: "encounterPartyLevel",
  size: "encounterPartySize",
  creatures: "encounterCreatures",
  summary: "encounterSummary",
};

function getEncounterBuilderState() {
  const read = (name) => api.getCampaignVariable?.(name);
  const creatures = read(ENCOUNTER_BUILDER_VARS.creatures);
  return {
    level: parseInt(read(ENCOUNTER_BUILDER_VARS.level), 10) || 1,
    size: parseInt(read(ENCOUNTER_BUILDER_VARS.size), 10) || 4,
    creatures: Array.isArray(creatures) ? creatures : [],
  };
}

// The level differences the creature table covers: -4 to +4, or -7 to +7
// under Proficiency without Level
function getEncounterLevelRange() {
  return getVariantRules().proficiencyWithoutLevel ? 7 : 4;
}

// The builder's meter: the XP so far, its threat, the next threat's budget,
// and a line for each creature
function getEncounterBuilderSummary({ level, size, creatures }) {
  const breakdown = getEncounterBreakdown(creatures, level);
  const totalXp = breakdown.reduce((sum, e) => sum + e.xp, 0);
  const threat = getEncounterThreat(totalXp, size);
  const next = getEncounterBudgets(size).find((b) => b.name !== "Trivial" && b.budget > totalXp);
  const lines = [
    `${totalXp} XP: ${threat}${next ? ` (${next.name} at ${next.budget})` : ""}`,
    `Party: ${size} of level ${level}. Budgets: ${getEncounterBudgetLine(getEncounterBudgets(size))}`,
  ];
  breakdown.forEach((e) => lines.push(`Lvl ${e.level} ${e.type}: ${e.xp} XP`));
  return lines.join("\n");
}

// Ways to spend a threat's budget exactly: some creatures of one level, or a
// leader above the party's level with others below it
function getEncounterTemplates(partyLevel, partySize, threatName) {
  const budget = getEncounterBudgets(partySize).find((b) => b.name === threatName)?.budget;
  if (!budget) return [];
  const range = getEncounterLevelRange();
  const xpFor = (diff) => getEncounterXp(diff);
  const diffs = [];
  for (let diff = range; diff >= -range; diff--) {
    if (partyLevel + diff >= -1) diffs.push(diff);
  }
  const level = (diff) => partyLevel + diff;
  const templates = [];
  diffs.forEach((diff) => {
    const count = budget / xpFor(diff);
    if (Number.isInteger(count) && count >= 1 && count <= 8) {
      templates.push(`${count} × level ${level(diff)} (${xpFor(diff)} XP each)`);
    }
  });
  diffs
    .filter((leader) => leader > 0)
    .forEach((leader) => {
      diffs
        .filter((other) => other < 0)
        .forEach((other) => {
          const rest = budget - xpFor(leader);
          const count = rest / xpFor(other);
          if (rest > 0 && Number.isInteger(count) && count >= 1 && count <= 6) {
            templates.push(`1 × level ${level(leader)} and ${count} × level ${level(other)}`);
          }
        });
    });
  return templates;
}

// The builder's writes: only what changed, and the meter. Each
// setCampaignVariable sends the whole variables map to every client.
function writeEncounterSummary(state) {
  api.setCampaignVariable(ENCOUNTER_BUILDER_VARS.summary, getEncounterBuilderSummary(state));
}

function writeEncounterCreatures(state) {
  api.setCampaignVariable(ENCOUNTER_BUILDER_VARS.creatures, state.creatures);
  writeEncounterSummary(state);
}

// The party's level and size from the Party Sheet
function setEncounterBuilderFromParty() {
  api.getParty((party) => {
    const members = (party || []).filter((member) => member?.recordType === "characters");
    if (!members.length) {
      api.showNotification("Open the Party Sheet from the View menu and drag the characters onto it.", "yellow", "Encounter Builder");
      return;
    }
    const levels = members.map((member) => parseInt(member.data?.level, 10) || 1);
    const level = Math.round(levels.reduce((sum, l) => sum + l, 0) / levels.length);
    const state = { ...getEncounterBuilderState(), level, size: members.length };
    api.setCampaignVariable(ENCOUNTER_BUILDER_VARS.level, state.level);
    api.setCampaignVariable(ENCOUNTER_BUILDER_VARS.size, state.size);
    writeEncounterSummary(state);
  });
}

// The party's level or size typed in the panel ("level" or "size"): the field
// saved it, so only the meter, from the value passed
function setEncounterBuilderParty(key, value) {
  const number = parseInt(value, 10);
  if (!Number.isFinite(number)) return;
  writeEncounterSummary({ ...getEncounterBuilderState(), [key]: number });
}

// The selected NPC and hazard tokens join the encounter
function addSelectedToEncounterBuilder() {
  const added = (api.getSelectedTokens?.() || [])
    .map((t) => t?.token || t)
    .filter((t) => t?.recordType === "npcs")
    .map((t) => ({
      level: parseInt(t.data?.level, 10) || 0,
      type: t.data?.type || "",
      complex: !!t.data?.isComplex,
    }));
  if (!added.length) {
    api.showNotification("Select NPC or hazard tokens on the scene first.", "yellow", "Encounter Builder");
    return;
  }
  const state = getEncounterBuilderState();
  writeEncounterCreatures({ ...state, creatures: [...state.creatures, ...added] });
}

// A creature by its level against the party's, for planning before the stat
// blocks are picked
function addLevelToEncounterBuilder() {
  const { level } = getEncounterBuilderState();
  const range = getEncounterLevelRange();
  const options = [];
  for (let diff = range; diff >= -range; diff--) {
    options.push({
      label: `Level ${level + diff} (party ${diff >= 0 ? "+" : ""}${diff}): ${getEncounterXp(diff)} XP`,
      value: String(diff),
    });
  }
  api.showPrompt(
    "Encounter Builder",
    "Add a creature of which level?",
    "Select...",
    options,
    null,
    (choice) => {
      const diff = parseInt(Array.isArray(choice) ? choice[0] : choice, 10);
      if (!Number.isFinite(diff)) return;
      const latest = getEncounterBuilderState();
      writeEncounterCreatures({ ...latest, creatures: [...latest.creatures, { level: latest.level + diff, type: "", complex: false }] });
    },
    "Add",
    "Cancel",
    1,
  );
}

// The last creature added comes out, to fix a wrong pick
function removeLastFromEncounterBuilder() {
  const state = getEncounterBuilderState();
  if (!state.creatures.length) return;
  writeEncounterCreatures({ ...state, creatures: state.creatures.slice(0, -1) });
}

function clearEncounterBuilder() {
  writeEncounterCreatures({ ...getEncounterBuilderState(), creatures: [] });
}

// The Templates button: pick a threat, and its templates are posted for the GM
function promptEncounterTemplates() {
  api.showPrompt(
    "Encounter Templates",
    "Templates for which threat?",
    "Select...",
    ENCOUNTER_THREATS.map(({ name }) => ({ label: name, value: name })),
    null,
    (choice) => {
      const name = Array.isArray(choice) ? choice[0] : choice;
      if (name) postEncounterTemplates(name);
    },
    "Post",
    "Cancel",
    1,
  );
}

function postEncounterTemplates(threatName) {
  const { level, size } = getEncounterBuilderState();
  const budget = getEncounterBudgets(size).find((b) => b.name === threatName)?.budget;
  if (budget === undefined) return;
  const templates = getEncounterTemplates(level, size, threatName);
  api.sendMessage(
    [
      `[gm]**[center]${threatName} Encounter Templates[/center]**[/gm]`,
      `[gm][center]${budget} XP for ${size} of level ${level}[/center][/gm]`,
      ...(templates.length ? templates.map((t) => `[gm]- ${t}[/gm]`) : ["[gm]No exact fit; mix levels to come close.[/gm]"]),
    ].join("\n"),
  );
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
