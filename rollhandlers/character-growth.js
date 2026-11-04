// Character growth: what an Intelligence increase and Multilingual teach, and
// retraining.
//
//   - Intelligence (Player Core, Leveling Up): when a level-up boost raises
//     your Intelligence modifier, you become trained in one more skill and
//     learn one more language. The level up's boost step offers both
//   - Multilingual (Player Core): taking it offers two new languages, one more
//     at master in Society and one more at legendary
//   - Retraining (Player Core, Downtime): a feat or a skill increase is
//     swapped over a week of downtime. A feat row's Retrain button re-picks the
//     slot; the Skills tab's Retrain a Skill Increase lowers one skill and
//     raises another, up to the level's rank cap. The card notes what the GM may want
//     to check (lineage feats, feats that list the old one or the skill as a
//     prerequisite); nothing is blocked
//   - Feat prerequisites (Player Core, Feats): picking a feat warns about the
//     dedication rule, a second lineage feat or one above 1st level, and the
//     prerequisites the character doesn't seem to meet. Prerequisites are
//     text, so only the common forms are checked; nothing is blocked
//   - Adopted Ancestry (Player Core): its choice picks an ancestry, whose
//     ancestry feats the feat picker then offers too
//   - Starting wealth (GM Core pg. 61, Character Wealth): the Inventory tab's
//     Starting Wealth button gives a character made above 1st level its
//     items-and-currency or lump sum
//
// Languages are rows of data.languagesList, built as the wizard builds them
// (buildLanguagesList).

const RETRAIN_DOWNTIME = "1 week of downtime";

// ---------------------------------------------------------------- Languages

// The languages a character knows, by name
function getKnownLanguages(record) {
  return (record?.data?.languagesList || []).map((language) => cleanLanguageName(language?.name)).filter(Boolean);
}

// The languages a character can learn: the ancestry's choices, then every
// common language, without the ones already known
function getNewLanguageOptions(record) {
  const known = getKnownLanguages(record);
  const ancestry = record?.data?.ancestries?.[0]?.data || {};
  const ancestryChoices = (ancestry.additionalLanguages?.value || []).map(cleanLanguageName);
  const commonChoices = getLanguageOptions()
    .filter((option) => /\(Common\)$/.test(option.label))
    .map((option) => option.value);
  return [...new Set([...ancestryChoices, ...commonChoices])]
    .filter((language) => language && !known.includes(language))
    .map((language) => ({ label: language, value: language }));
}

// The languagesList with the new languages added (one write)
function getAddLanguagesValues(record, languages) {
  const known = getKnownLanguages(record);
  const added = [...new Set(languages.map(cleanLanguageName))].filter((language) => language && !known.includes(language));
  if (added.length === 0) return null;
  return { "data.languagesList": [...(record?.data?.languagesList || []), ...buildLanguagesList(added)] };
}

// Asks for `count` new languages, adds them, then next()
function promptNewLanguages(record, count, title, text, next = () => {}) {
  const options = getNewLanguageOptions(record);
  if (count <= 0 || options.length === 0) {
    next();
    return;
  }
  api.showPrompt(
    title,
    text,
    `Choose ${count === 1 ? "a Language" : `${count} Languages`}...`,
    options,
    null,
    (selected) => {
      const values = getAddLanguagesValues(record, getPromptSelections(selected).slice(0, count));
      if (!values) {
        next();
        return;
      }
      api.setValuesOnRecord(record, values, () => next());
    },
    "OK",
    "Skip",
    count,
  );
}

// ---------------------------------------------------------------- Intelligence

// How much a change raised the Intelligence modifier (0 if it didn't)
function getIntModGain(before, after) {
  return Math.max(0, (getWizardIntMod(after) || 0) - (getWizardIntMod(before) || 0));
}

function getUntrainedSkillOptions(record) {
  return Object.keys(getPathfinderSkills())
    .filter((skill) => (parseInt(record?.data?.[skill] || "0", 10) || 0) < 1)
    .map((skill) => ({ label: capitalize(skill), value: skill }));
}

// The level up's boost step (characters-main.html): when the boosts raised
// the Intelligence modifier, one more trained skill and one more language for
// each point, then next()
function promptIntIncreaseGains(before, after, next = () => {}) {
  const gain = getIntModGain(before, after);
  if (gain <= 0) {
    next();
    return;
  }
  const plural = gain === 1 ? "" : "s";
  const skills = getUntrainedSkillOptions(after);
  const askLanguages = (latest) =>
    promptNewLanguages(
      latest,
      gain,
      "Intelligence Increase: Language",
      `Your Intelligence modifier went up, so you learn ${gain === 1 ? "a new language" : `${gain} new languages`}.`,
      next,
    );
  if (skills.length === 0) {
    askLanguages(after);
    return;
  }
  api.showPrompt(
    "Intelligence Increase: Skill",
    `Your Intelligence modifier went up, so you become trained in ${gain === 1 ? "one more skill" : `${gain} more skills`}.`,
    `Choose ${gain === 1 ? "a Skill" : `${gain} Skills`}...`,
    skills,
    null,
    (selected) => {
      const picked = getPromptSelections(selected).slice(0, gain);
      if (picked.length === 0) {
        askLanguages(after);
        return;
      }
      const values = {};
      picked.forEach((skill) => {
        values[`data.${skill}`] = "1";
      });
      api.setValuesOnRecord(after, values, (updated) => askLanguages(updated || after));
    },
    "OK",
    "Skip",
    gain,
  );
}

// ---------------------------------------------------------------- Multilingual

// Multilingual's languages: two, one more at master in Society, one more at
// legendary
function getMultilingualCount(record) {
  const society = parseInt(record?.data?.society || "0", 10) || 0;
  return 2 + (society >= 3 ? 1 : 0) + (society >= 4 ? 1 : 0);
}

// After a feat is placed (the feat row, the level up): Multilingual asks for
// its languages, then next()
function promptFeatLanguages(record, feat, next = () => {}) {
  if (`${feat?.name || ""}`.trim().toLowerCase() !== "multilingual") {
    next();
    return;
  }
  const count = getMultilingualCount(record);
  promptNewLanguages(
    record,
    count,
    "Multilingual",
    `You learn ${count} new languages. You learn another one if you become a master in Society, and again at legendary.`,
    next,
  );
}

// ---------------------------------------------------------------- Retraining

const hasFeatTrait = (feat, trait) => getTraitNameList(feat?.data?.traits).includes(trait);

// The chosen feats (not empty slots)
function getChosenFeats(record) {
  return [...(record?.data?.feats || []), ...(record?.data?.bonusFeats || [])].filter(
    (feat) => feat?.data?.type !== "slot" && feat?.name,
  );
}

// The other feats that list this name in their prerequisites
function getFeatsRequiring(record, name, except = null) {
  const wanted = `${name || ""}`.trim().toLowerCase();
  if (!wanted) return [];
  return getChosenFeats(record).filter(
    (feat) => feat !== except && feat.name !== except?.name && `${feat.data?.prerequisites || ""}`.toLowerCase().includes(wanted),
  );
}

// What the GM may want to check before a feat is retrained (GM-only lines)
function getRetrainFeatNotes(record, oldFeat, newFeat = null) {
  const notes = [];
  if (hasFeatTrait(oldFeat, "lineage") || hasFeatTrait(newFeat, "lineage")) {
    notes.push("Lineage feats can't be retrained into or out of.");
  }
  const dependents = getFeatsRequiring(record, oldFeat?.name, oldFeat);
  if (dependents.length > 0) {
    notes.push(`${dependents.map((feat) => feat.name).join(", ")} list${dependents.length === 1 ? "s" : ""} ${oldFeat.name} as a prerequisite.`);
  }
  if (hasFeatTrait(oldFeat, "dedication") && dependents.length > 0) {
    notes.push("A dedication feat can't be retrained while you have other feats from its archetype.");
  }
  // The languages it gave stay on the sheet
  if (`${oldFeat?.name || ""}`.trim().toLowerCase() === "multilingual") {
    notes.push("Remove the languages Multilingual gave from the Languages list.");
  }
  return notes;
}

// The chat card for a retraining: what changed, the downtime, the GM notes
function getRetrainCard(name, change, notes = []) {
  const lines = [`**${name} retrains:** ${change} (${RETRAIN_DOWNTIME}).`];
  if (notes.length > 0) lines.push(`[gm]${notes.join(" ")}[/gm]`);
  return lines.join("\n");
}

// A feat row's Retrain (feats-list.html): re-pick the slot from the same
// query, swap it in one write, then the card
function retrainFeatAt(record, featPath) {
  const oldFeat = api.getValueOnRecord(record, featPath);
  if (!oldFeat?.name || oldFeat.data?.type === "slot") return;
  // A feat placed before slots kept their type: its own type
  const slotType = oldFeat.data?.featSlotType || oldFeat.data?.type;
  const slotLevel = parseInt(oldFeat.data?.level || "0", 10) || 0;
  const before = getRetrainFeatNotes(record, oldFeat);
  api.showPrompt(
    `Retrain ${oldFeat.name}`,
    `Choose the feat that replaces it (${RETRAIN_DOWNTIME}).${before.length > 0 ? ` ${before.join(" ")}` : ""}`,
    "Select a Feat...",
    null,
    getFeatSlotQuery(record, slotType, slotLevel),
    (selected) => {
      const feat = getPromptSelections(selected)[0];
      if (!feat || typeof feat !== "object" || feat.name === oldFeat.name) return;
      const notes = getRetrainFeatNotes(record, oldFeat, feat);
      api.setValuesOnRecord(record, { [featPath]: buildFilledFeatSlot(oldFeat, feat) }, (updated) => {
        onAddEditFeature(updated || record);
        api.sendMessage(getRetrainCard(getCreatureName(record), `${oldFeat.name} into ${feat.name}`, notes), undefined, [], [], record);
        promptFeatLanguages(updated || record, feat);
      });
    },
    "OK",
    "Cancel",
    1,
  );
}

// Skills a skill increase could be taken back from (trained or better)
function getRetrainSkillLowerOptions(record) {
  return Object.keys(getPathfinderSkills())
    .map((skill) => ({ skill, rank: parseInt(record?.data?.[skill] || "0", 10) || 0 }))
    .filter(({ rank }) => rank >= 1)
    .map(({ skill, rank }) => ({
      label: `${capitalize(skill)}: ${PROFICIENCY_RANK_NAMES[rank]} to ${PROFICIENCY_RANK_NAMES[rank - 1]}`,
      value: skill,
    }));
}

// The two rank changes of a skill increase retraining, in one write
function getRetrainSkillValues(record, lower, raise) {
  const rankOf = (skill) => parseInt(record?.data?.[skill] || "0", 10) || 0;
  if (!lower || !raise || lower === raise || rankOf(lower) < 1) return null;
  const level = parseInt(record?.data?.level || "1", 10) || 1;
  if (rankOf(raise) >= getMaxSkillIncreaseRank(level)) return null;
  return {
    [`data.${lower}`]: `${rankOf(lower) - 1}`,
    [`data.${raise}`]: `${rankOf(raise) + 1}`,
  };
}

// Feats that may need the skill at its old rank
function getSkillRetrainNotes(record, skill) {
  const dependents = getFeatsRequiring(record, skill);
  return dependents.length > 0
    ? [`${dependents.map((feat) => feat.name).join(", ")} list${dependents.length === 1 ? "s" : ""} ${capitalize(skill)} as a prerequisite.`]
    : [];
}

// The Skills tab's Retrain a Skill Increase (characters-skills.html): the
// skill to lower, then the one to raise, on a fresh read of the character
function retrainSkillIncrease(sheetRecord) {
  api.getRecord(sheetRecord.recordType || "characters", sheetRecord._id, (record) => promptSkillRetraining(record || sheetRecord));
}

function promptSkillRetraining(record) {
  const lowerOptions = getRetrainSkillLowerOptions(record);
  if (lowerOptions.length === 0) {
    api.showNotification("No trained skills to retrain.", "yellow", "Retraining");
    return;
  }
  const level = parseInt(record?.data?.level || "1", 10) || 1;
  api.showPrompt(
    "Retrain a Skill Increase",
    `Choose the skill that goes down one rank (${RETRAIN_DOWNTIME}).`,
    "Choose a Skill...",
    lowerOptions,
    null,
    (selected) => {
      const lower = getPromptSelections(selected)[0];
      if (!lower) return;
      const raiseOptions = getSkillIncreaseOptions(record, level).filter((option) => option.value !== lower);
      api.showPrompt(
        "Retrain a Skill Increase",
        "Choose the skill that goes up one rank. Master requires level 7 and Legendary requires level 15.",
        "Choose a Skill...",
        raiseOptions,
        null,
        (selectedRaise) => {
          const raise = getPromptSelections(selectedRaise)[0];
          const values = getRetrainSkillValues(record, lower, raise);
          if (!values) return;
          api.setValuesOnRecord(record, values, (updated) => {
            // The skill modifiers follow the ranks
            onAddEditFeature(updated || record);
            const rank = (skill) => PROFICIENCY_RANK_NAMES[parseInt(values[`data.${skill}`], 10)];
            const change = `${capitalize(lower)} to ${rank(lower)}, ${capitalize(raise)} to ${rank(raise)}`;
            api.sendMessage(getRetrainCard(getCreatureName(record), change, getSkillRetrainNotes(record, lower)), undefined, [], [], record);
          });
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

// ---------------------------------------------------------------- Feat prerequisites

const PREREQUISITE_RANKS = { trained: 1, expert: 2, master: 3, legendary: 4 };
const PREREQUISITE_ATTRIBUTES = {
  strength: "str",
  dexterity: "dex",
  constitution: "con",
  intelligence: "int",
  wisdom: "wis",
  charisma: "cha",
};
// Lower-case words a feat or feature name can hold ("Shield of Reckoning")
const PREREQUISITE_NAME_WORDS = new Set(["of", "the", "a", "an", "and", "to", "in", "on", "with", "for", "from"]);

// The reminders for a feat picked into a slot of this level, each
// { title, text }: the dedication rule, lineage feats and prerequisites
function getFeatWarnings(record, feat, slotLevel) {
  return [
    { title: "Dedication Feat", text: getDedicationWarning(record, feat) },
    { title: "Lineage Feat", text: getLineageWarning(record, feat, slotLevel) },
    { title: "Feat Prerequisites", text: getPrerequisiteWarning(record, feat) },
  ].filter((warning) => warning.text);
}

// Lineage feats: only one, and only at 1st level
function getLineageWarning(record, feat, slotLevel) {
  if (!hasFeatTrait(feat, "lineage")) return "";
  const other = getChosenFeats(record).find((chosen) => chosen.name !== feat.name && hasFeatTrait(chosen, "lineage"));
  if (other) {
    return `You already have a lineage feat (${other.name}), and you can have only one. Your GM may waive this.`;
  }
  if ((parseInt(slotLevel, 10) || 1) > 1) {
    return "A lineage feat can be taken only at 1st level. Your GM may waive this.";
  }
  return "";
}

// The prerequisites the character doesn't seem to meet, as a warning ("" when
// none). Only the forms below are checked; anything else is left to the GM.
function getPrerequisiteWarning(record, feat) {
  const unmet = splitPrerequisites(feat?.data?.prerequisites).filter(
    (part) => isPrerequisiteMet(record, part) === false,
  );
  if (unmet.length === 0) return "";
  return `${feat.name} lists prerequisites you don't seem to meet: ${unmet.join("; ")}. Your GM may waive this.`;
}

// A feat's prerequisites text as its parts. A rank or an "or" list keeps its
// commas ("trained in Arcana, Nature, or Religion").
function splitPrerequisites(text) {
  return `${text || ""}`
    .replace(/<[^>]*>/g, " ")
    .split(";")
    .flatMap((piece) =>
      /^\s*(trained|expert|master|legendary) in /i.test(piece) || /\bor\b/i.test(piece) ? [piece] : piece.split(","),
    )
    .map((part) => part.trim().replace(/\.$/, ""))
    .filter((part) => part && !/^none$/i.test(part));
}

// Whether one prerequisite is met: true, false, or null when it can't be told
// ("trained in Athletics", "expert in Arcana or Occultism", "Charisma +3", a
// feat or feature by name, "Reactive Shield or Shield Block")
function isPrerequisiteMet(record, part) {
  const rank = part.match(/^(trained|expert|master|legendary) in (.+)$/i);
  if (rank) {
    const needed = PREREQUISITE_RANKS[rank[1].toLowerCase()];
    const anyOf = /\bor\b/i.test(rank[2]);
    const ranks = rank[2]
      .split(/\s*,\s*(?:or\s+|and\s+)?|\s+or\s+|\s+and\s+/i)
      .map((name) => getPrerequisiteRank(record, name));
    const known = ranks.filter((value) => value !== null);
    if (known.length === 0) return null;
    const allKnown = known.length === ranks.length;
    if (anyOf) return known.some((value) => value >= needed) ? true : allKnown ? false : null;
    return known.some((value) => value < needed) ? false : allKnown ? true : null;
  }
  const attribute = part.match(/^(strength|dexterity|constitution|intelligence|wisdom|charisma) \+(\d+)$/i);
  if (attribute) {
    const modifier = parseInt(record?.data?.[PREREQUISITE_ATTRIBUTES[attribute[1].toLowerCase()]] || "0", 10) || 0;
    return modifier >= parseInt(attribute[2], 10);
  }
  if (/\bor\b/i.test(part)) {
    const results = part.split(/\s*,\s*(?:or\s+)?|\s+or\s+/i).map((alternative) => isPrerequisiteMet(record, alternative));
    if (results.includes(true)) return true;
    return results.every((result) => result === false) ? false : null;
  }
  return isPrerequisiteName(part) ? hasPrerequisiteNamed(record, part) : null;
}

// A character's rank in a skill, Perception, a save or a Lore by name, or
// null when the name isn't one
function getPrerequisiteRank(record, name) {
  const data = record?.data || {};
  const key = `${name || ""}`.trim().toLowerCase().replace(/\s+saves?$/, "");
  const lores = Array.isArray(data.loreSkills) ? data.loreSkills : [];
  const rankOf = (value) => parseInt(value || "0", 10) || 0;
  const skills = Object.keys(getPathfinderSkills());
  if (skills.includes(key) || ["perception", "fortitude", "reflex", "will"].includes(key)) {
    return rankOf(data[key]);
  }
  if (/^(a|at least one) skill$/.test(key)) {
    return Math.max(0, ...skills.map((skill) => rankOf(data[skill])), ...lores.map((lore) => rankOf(lore?.data?.rank)));
  }
  if (/^lore$|^(a|at least one) lore( skill)?$/.test(key)) {
    return Math.max(0, ...lores.map((lore) => rankOf(lore?.data?.rank)));
  }
  if (/ lore$/.test(key)) {
    const lore = lores.find((entry) => {
      const loreName = `${entry?.name || ""}`.trim().toLowerCase();
      return loreName === key || `${loreName} lore` === key;
    });
    return lore ? rankOf(lore.data?.rank) : 0;
  }
  return null;
}

// Whether a prerequisite reads as a feat or feature name: every word
// capitalized but small ones ("Power Attack", "Shield of Reckoning")
function isPrerequisiteName(part) {
  const words = part.split(/\s+/);
  return /^[A-Z]/.test(words[0]) && words.every((word) => /^[A-Z0-9]/.test(word) || PREREQUISITE_NAME_WORDS.has(word));
}

// A feat, a feature, or the character's ancestry, heritage, class or
// background by name
function hasPrerequisiteNamed(record, name) {
  if (hasFeatNamed(record, name)) return true;
  const wanted = name.trim().toLowerCase();
  return [
    ...(record?.data?.ancestries || []),
    ...(record?.data?.heritages || []),
    ...(record?.data?.classes || []),
    ...(record?.data?.backgrounds || []),
  ].some((origin) => `${origin?.name || ""}`.trim().toLowerCase() === wanted);
}

// ---------------------------------------------------------------- Adopted Ancestry

const isAdoptedAncestry = (feat) => `${feat?.name || ""}`.trim().toLowerCase() === "adopted ancestry";

// The ancestries Adopted Ancestry opened (Player Core): their ancestry feats
// can be taken too. Its choice keeps the ancestry's name.
function getAdoptedAncestries(record) {
  return getChosenFeats(record)
    .filter(isAdoptedAncestry)
    .map((feat) => {
      const picked = (feat.data?.choices || []).find((choice) => choice?.data?.flag === "ancestry")?.data?.choices?.[0];
      if (!picked) return "";
      try {
        return JSON.parse(picked)?.name || "";
      } catch (e) {
        return `${picked}`;
      }
    })
    .filter(Boolean);
}

// Adopted Ancestry's choice (flag ancestry) picks an ancestry; the module's
// query lists features. Null for any other choice.
function getAdoptedAncestryQuery(feature, choiceObj) {
  return isAdoptedAncestry(feature) && choiceObj?.data?.flag === "ancestry" ? { type: "ancestry", query: {} } : null;
}

// ---------------------------------------------------------------- Starting wealth

// Character Wealth (GM Core pg. 61), for a character made above 1st level:
// permanent items as [item level, count] and currency in gp, or a lump sum in
// gp for common items up to a level below the character's
const CHARACTER_WEALTH = [
  null,
  { items: [], currency: 15, lumpSum: 15 },
  { items: [[1, 1]], currency: 20, lumpSum: 30 },
  { items: [[2, 1], [1, 2]], currency: 25, lumpSum: 75 },
  { items: [[3, 1], [2, 2], [1, 1]], currency: 30, lumpSum: 140 },
  { items: [[4, 1], [3, 2], [2, 1], [1, 2]], currency: 50, lumpSum: 270 },
  { items: [[5, 1], [4, 2], [3, 1], [2, 2]], currency: 80, lumpSum: 450 },
  { items: [[6, 1], [5, 2], [4, 1], [3, 2]], currency: 125, lumpSum: 720 },
  { items: [[7, 1], [6, 2], [5, 1], [4, 2]], currency: 180, lumpSum: 1100 },
  { items: [[8, 1], [7, 2], [6, 1], [5, 2]], currency: 250, lumpSum: 1600 },
  { items: [[9, 1], [8, 2], [7, 1], [6, 2]], currency: 350, lumpSum: 2300 },
  { items: [[10, 1], [9, 2], [8, 1], [7, 2]], currency: 500, lumpSum: 3200 },
  { items: [[11, 1], [10, 2], [9, 1], [8, 2]], currency: 700, lumpSum: 4500 },
  { items: [[12, 1], [11, 2], [10, 1], [9, 2]], currency: 1000, lumpSum: 6400 },
  { items: [[13, 1], [12, 2], [11, 1], [10, 2]], currency: 1500, lumpSum: 9300 },
  { items: [[14, 1], [13, 2], [12, 1], [11, 2]], currency: 2250, lumpSum: 13500 },
  { items: [[15, 1], [14, 2], [13, 1], [12, 2]], currency: 3250, lumpSum: 20000 },
  { items: [[16, 1], [15, 2], [14, 1], [13, 2]], currency: 5000, lumpSum: 30000 },
  { items: [[17, 1], [16, 2], [15, 1], [14, 2]], currency: 7500, lumpSum: 45000 },
  { items: [[18, 1], [17, 2], [16, 1], [15, 2]], currency: 12000, lumpSum: 69000 },
  { items: [[19, 1], [18, 2], [17, 1], [16, 2]], currency: 20000, lumpSum: 112000 },
];

// The row for a level (1 to 20), or null
function getCharacterWealth(level) {
  return CHARACTER_WEALTH[parseInt(level, 10) || 0] || null;
}

const formatGp = (gp) => `${gp.toLocaleString("en-US")} gp`;

// "one 4th-level item, two 3rd-level items"
function describeWealthItems(items) {
  const counts = { 1: "one", 2: "two" };
  return items
    .map(([level, count]) => `${counts[count] || count} ${getOrdinal(level)}-level item${count === 1 ? "" : "s"}`)
    .join(", ");
}

// The ways to take it, for a prompt: items and currency, or the lump sum
function getStartingWealthOptions(record) {
  const wealth = getCharacterWealth(record?.data?.level);
  if (!wealth) return [];
  const lumpSum = { label: `Lump sum: ${formatGp(wealth.lumpSum)}`, value: "lumpSum" };
  if (wealth.items.length === 0) return [lumpSum];
  return [
    { label: `Items and currency: ${describeWealthItems(wealth.items)}, and ${formatGp(wealth.currency)}`, value: "items" },
    lumpSum,
  ];
}

// The prompt's text, noting when starting wealth was already taken
function getStartingWealthPromptText(record) {
  const level = parseInt(record?.data?.level, 10) || 0;
  const taken = record?.data?.startingWealth;
  return (
    `Character Wealth (GM Core pg. 61) for a new level ${level} character: permanent items by level plus currency, or one lump sum to spend on common items.` +
    (taken?.level ? ` Starting wealth was already taken at level ${taken.level}.` : "")
  );
}

// The coins and the note of what was taken, in one write; null for an
// unknown option or level
function getStartingWealthValues(record, option) {
  const level = parseInt(record?.data?.level, 10) || 0;
  const wealth = getCharacterWealth(level);
  if (!wealth || !["items", "lumpSum"].includes(option)) return null;
  const gp = option === "lumpSum" ? wealth.lumpSum : wealth.currency;
  return {
    "data.gp": (parseInt(record?.data?.gp || "0", 10) || 0) + gp,
    "data.startingWealth": { level, option },
  };
}

// The chat card for what was taken
function getStartingWealthMessage(record, option) {
  const level = parseInt(record?.data?.level, 10) || 0;
  const wealth = getCharacterWealth(level);
  if (!wealth) return "";
  const name = getCreatureName(record);
  if (option === "lumpSum") {
    const limit = level > 1 ? ` of level ${level - 1} or lower` : "";
    return `**${name} takes starting wealth for level ${level}:** ${formatGp(wealth.lumpSum)} to buy common items${limit}.`;
  }
  const items = wealth.items.length > 0 ? ` and permanent items: ${describeWealthItems(wealth.items)}` : "";
  return `**${name} takes starting wealth for level ${level}:** ${formatGp(wealth.currency)}${items}. Each item is a common item of that level or lower; runes and precious materials cost extra, and the GM may allow uncommon items.`;
}

// The Inventory tab's Starting Wealth button
function takeStartingWealth(record) {
  const options = getStartingWealthOptions(record);
  if (options.length === 0) {
    api.showNotification("Starting wealth is for characters of level 1 to 20.", "yellow", "Starting Wealth");
    return;
  }
  api.showPrompt(
    "Starting Wealth",
    getStartingWealthPromptText(record),
    "Choose...",
    options,
    null,
    (selected) => {
      const option = getPromptSelections(selected)[0];
      const values = getStartingWealthValues(record, option);
      if (!values) return;
      api.setValuesOnRecord(record, values, () => {
        api.sendMessage(getStartingWealthMessage(record, option), undefined, [], [], record);
      });
    },
    "Take",
    "Cancel",
    1,
  );
}
