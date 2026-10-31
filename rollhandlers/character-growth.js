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
//     slot; the sheet's Retrain Skill Increase lowers one skill and raises
//     another, up to the level's rank cap. The card notes what the GM may want
//     to check (lineage feats, feats that list the old one or the skill as a
//     prerequisite); nothing is blocked
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

// The sheet's Retrain Skill Increase (characters-main.html): the skill to
// lower, then the one to raise
function retrainSkillIncrease(record) {
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
          api.setValuesOnRecord(record, values, () => {
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
