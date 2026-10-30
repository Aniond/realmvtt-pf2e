// Check tools: Assurance, incapacitation, signature spells, counteract
// checks, and the flat checks and riders of stupefied, grabbed, deafened,
// sickened and confused.
//
//   - Assurance (Player Core pg. 252): instead of rolling a skill it's taken
//     for, a result of 10 + the proficiency bonus. The skill comes from the
//     feat's choice or its name ("Assurance (Athletics)"); an Assurance with
//     neither asks once which skill it's for and keeps it in the feat's
//     choice. Effects that change the degree of success still apply (Paizo's
//     clarification). Untrained Improvisation needs no code: the module
//     feat's skillBonus modifier (proficiency:untrained) already adds it to
//     untrained rolls
//   - Incapacitation (Player Core pg. 457): a creature whose level is more
//     than twice the spell's rank treats its save as one degree better, and
//     a spell attack against it as one degree worse
//   - Signature spells (Player Core pg. 300): a spontaneous caster casts one
//     at any rank from its own up to the highest with a slot left
//   - Counteracting (Player Core pg. 431): the counteract rank against the
//     target's, by the check's degree of success
//   - Stupefied, grabbed and deafened (Player Core pg. 444-447): a flat
//     check to cast, rolled with the spell (DC 5 + stupefied, DC 5 for a
//     manipulate spell while grabbed, DC 5 for an auditory one while
//     deafened). A failure is reported; nothing is undone, the GM decides
//   - Sickened: Retch, a Fortitude save that lowers it by 1 (2 on a critical
//     success), and a reminder on drinking a potion or elixir. Confused: a
//     DC 11 flat check button when an attack or spell damages the creature

// ---------------------------------------------------------------- Assurance

// A character's Assurance rows: { skills: [slugs], unassigned: [{ path,
// feat }] }, unassigned being the rows with no skill recorded yet
function getAssuranceSkills(record) {
  const result = { skills: [], unassigned: [] };
  if (record?.recordType === "npcs") return result;
  for (const list of ["feats", "bonusFeats"]) {
    (record?.data?.[list] || []).forEach((feat, index) => {
      if (feat?.data?.type === "slot") return;
      const name = `${feat?.name || ""}`.trim();
      if (!/^assurance\b/i.test(name)) return;
      const named = name.match(/\(([^)]+)\)\s*$/);
      const chosen = named ? named[1] : getFeatChoiceName(feat);
      if (chosen) {
        result.skills.push(toSlug(chosen));
      } else {
        result.unassigned.push({ path: `data.${list}.${index}`, feat });
      }
    });
  }
  return result;
}

// The option picked in a feat's first choice (stored as JSON on the feat)
function getFeatChoiceName(feat) {
  for (const choice of feat?.data?.choices || []) {
    const picked = (choice?.data?.choices || [])[0];
    if (!picked) continue;
    try {
      const data = typeof picked === "string" ? JSON.parse(picked) : picked;
      const name = data?.slug || data?.name;
      if (name) return `${name}`;
    } catch (e) {
      // not JSON: the name itself
      return `${picked}`;
    }
  }
  return "";
}

// Whether Assurance is recorded for this skill and can be used at this rank
// (trained or better)
function hasAssurance(record, skillSlug, rank) {
  if (!(parseInt(rank, 10) >= 1)) return false;
  return getAssuranceSkills(record).skills.includes(toSlug(skillSlug));
}

// Assurance's result: 10 + the proficiency bonus, nothing else
function getAssuranceResult(record, rank) {
  return 10 + getProficiencyBonusForRank(rank, record?.data?.level);
}

// Before a skill check: roll it, or take Assurance's result. With
// Assurance the fixed result goes to the skill handler, so the DC, its notes
// and the degree adjustments still apply. An Assurance with no skill yet
// asks which one first (options.label: the skill's name).
function offerAssurance(record, skillSlug, rank, roll, metadata, options = {}) {
  const slug = toSlug(skillSlug);
  if (!(parseInt(rank, 10) >= 1)) {
    roll();
    return;
  }
  const { skills, unassigned } = getAssuranceSkills(record);
  if (skills.includes(slug)) {
    promptAssurance(record, rank, roll, metadata);
  } else if (unassigned.length > 0) {
    askAssuranceSkill(record, unassigned[0], slug, options.label, (chosen) =>
      chosen === slug ? promptAssurance(record, rank, roll, metadata) : roll(),
    );
  } else {
    roll();
  }
}

function promptAssurance(record, rank, roll, metadata) {
  const result = getAssuranceResult(record, rank);
  api.showPrompt(
    "Assurance",
    `Roll the check, or take a result of ${result} (10 + proficiency bonus, no other modifiers)?`,
    "Select...",
    [
      { label: "Roll the check", value: "roll" },
      { label: `Use Assurance (${result})`, value: "assurance" },
    ],
    null,
    (choice) => {
      const value = Array.isArray(choice) ? choice[0] : choice;
      if (value === "assurance") {
        api.roll(`${result}`, getAssuranceMetadata(metadata, result), "skill");
      } else if (value) {
        roll();
      }
    },
    "OK",
    "Cancel",
    1,
  );
}

function getAssuranceMetadata(metadata, result) {
  return {
    ...metadata,
    rollName: `${metadata?.rollName || "Skill"} (Assurance)`,
    tooltip: `Assurance: a result of ${result}`,
    assurance: true,
  };
}

// The trained skills an unassigned Assurance can be for, this one first
function getAssuranceSkillOptions(record, skillSlug, label) {
  const assured = getAssuranceSkills(record).skills;
  const options = [];
  const add = (slug, name) => {
    if (assured.includes(slug) || options.some((o) => o.value === slug)) return;
    options.push({ label: name, value: slug });
  };
  add(skillSlug, label || capitalize(skillSlug));
  Object.keys(getPathfinderSkills()).forEach((skill) => {
    if ((parseInt(record?.data?.[skill], 10) || 0) >= 1) add(skill, capitalize(skill));
  });
  return options;
}

// The values that record the skill in the feat's choice, as the feat
// choice prompt stores it
function getAssuranceSkillValues(entry, slug, name) {
  const picked = [JSON.stringify({ name, slug })];
  if ((entry?.feat?.data?.choices || []).length > 0) {
    return { [`${entry.path}.data.choices.0.data.choices`]: picked };
  }
  return { [`${entry.path}.data.choices`]: [{ name: "Assurance Skill", data: { choices: picked } }] };
}

// Asks once which skill an Assurance is for, keeps it, then callback(slug).
// "Not now" rolls and asks again next time.
function askAssuranceSkill(record, entry, skillSlug, label, callback) {
  const options = getAssuranceSkillOptions(record, skillSlug, label);
  api.showPrompt(
    "Assurance",
    "Which skill is your Assurance for? You're asked once.",
    "Select...",
    [...options, { label: "Not now", value: "later" }],
    null,
    (choice) => {
      const value = Array.isArray(choice) ? choice[0] : choice;
      if (!value) return;
      if (value === "later") {
        callback(null);
        return;
      }
      const name = options.find((o) => o.value === value)?.label || value;
      api.setValuesOnRecord(record, getAssuranceSkillValues(entry, value, name));
      api.showNotification(`Assurance is now for ${name}.`, "green", "Assurance");
      callback(value);
    },
    "OK",
    "Cancel",
    1,
  );
}

// ---------------------------------------------------------------- Incapacitation

// Whether the creature's level makes an incapacitation effect weaker
// against it: more than twice the spell's rank, or (not a spell) higher
// than the effect's level
function isIncapacitationResisted(record, options = {}) {
  const traits = (Array.isArray(options.traits) ? options.traits : []).map((t) => `${t}`.toLowerCase());
  if (!traits.includes("incapacitation")) return false;
  const level = parseInt(record?.data?.level, 10);
  if (isNaN(level)) return false;
  const rank = parseInt(options.rank, 10);
  if (rank > 0) return level > rank * 2;
  const effectLevel = parseInt(options.level, 10);
  return !isNaN(effectLevel) && level > effectLevel;
}

// The save handler's degree after incapacitation: one better
function applyIncapacitation(degree, metadata) {
  if (!metadata?.incapacitation) return { degree, name: null };
  return { degree: Math.min(2, degree + 1), name: "Incapacitation" };
}

// The attack handler's: a spell attack one degree worse
function applyIncapacitationToAttack(degree, metadata) {
  if (!metadata?.incapacitation) return { degree, name: null };
  return { degree: Math.max(-1, degree - 1), name: "Incapacitation" };
}

// ---------------------------------------------------------------- Signature spells

// The ranks a signature spell can be cast at: from its own rank up, where
// the spontaneous entry has a slot left. [] when it isn't one.
function getSignatureRanks(record, spell, dataPathToSpell) {
  if (!(spell?.data?.signature === true || spell?.data?.signature === "true")) return [];
  const isCantrip = (spell?.data?.traits || []).some((t) => `${t}`.toLowerCase() === "cantrip");
  if (isCantrip || /\.cantrips\.\d+$/.test(`${dataPathToSpell || ""}`)) return [];
  const entry = api.getValueOnRecord(record, getNearestParentDataPath(dataPathToSpell));
  if (entry?.data?.type !== "spontaneous") return [];
  const base = Math.max(1, parseInt(spell?.data?.level, 10) || 1);
  const ranks = [];
  for (let rank = base; rank <= 10; rank++) {
    if ((parseInt(entry?.data?.[`usedSpells${rank}`], 10) || 0) > 0) ranks.push(rank);
  }
  return ranks;
}

// Asks which rank to cast a signature spell at, the list's own rank first,
// then casts it there. Also when the only rank left isn't the list's own.
// Returns false when there's no choice to make.
function promptSignatureRank(record, spell, dataPathToSpell, isOverlay) {
  if (isOverlay || spell?.castRank) return false;
  const ranks = getSignatureRanks(record, spell, dataPathToSpell);
  const listRank = getCastingRank(record, spell, dataPathToSpell);
  if (ranks.length === 0 || (ranks.length === 1 && ranks[0] === listRank)) return false;
  const ordered = ranks.includes(listRank) ? [listRank, ...ranks.filter((r) => r !== listRank)] : ranks;
  api.showPrompt(
    "Signature Spell",
    `Cast ${spell?.name || "the spell"} at which rank?`,
    "Select...",
    ordered.map((rank) => ({ label: `Rank ${rank}`, value: `${rank}` })),
    null,
    (choice) => {
      const rank = parseInt(Array.isArray(choice) ? choice[0] : choice, 10);
      if (rank > 0) castSpell(record, { ...spell, castRank: rank }, dataPathToSpell, isOverlay);
    },
    "Cast",
    "Cancel",
    1,
  );
  return true;
}

// The Signature box: shown only on spontaneous entries' spell rows, not
// cantrips. The values that differ, for the spells list's onload.
function getSignatureBoxValues(record) {
  const valuesToSet = {};
  (record?.data?.spells || []).forEach((entry, entryIndex) => {
    const spontaneous = entry?.data?.type === "spontaneous";
    Object.keys(entry?.data || {}).forEach((key) => {
      if (key !== "cantrips" && !/^spells\d+$/.test(key)) return;
      const rows = entry.data[key];
      if (!Array.isArray(rows)) return;
      rows.forEach((row, rowIndex) => {
        if (row?.data?.type !== "spell") return;
        const isCantrip =
          key === "cantrips" || (row.data.traits || []).some((t) => `${t}`.toLowerCase() === "cantrip");
        const hidden = !spontaneous || isCantrip;
        if (row?.fields?.signatureBox?.hidden !== hidden) {
          valuesToSet[`data.spells.${entryIndex}.data.${key}.${rowIndex}.fields.signatureBox.hidden`] = hidden;
        }
      });
    });
  });
  return valuesToSet;
}

// ---------------------------------------------------------------- Counteract

// Whether a spell's text talks about counteracting
function mentionsCounteract(spell) {
  return /counteract/i.test(`${spell?.data?.description || ""}`);
}

// A creature's counteract rank: half its level, rounded up (minimum 0)
function getCounteractRankForLevel(level) {
  return Math.max(0, Math.ceil((parseInt(level, 10) || 0) / 2));
}

// The outcome of a counteract check (Player Core pg. 431), by degree:
// critical success up to 3 ranks higher, success up to 1 higher, failure
// only a lower rank, critical failure nothing
function getCounteractOutcome(degree, counteractRank, targetRank) {
  const own = parseInt(counteractRank, 10) || 0;
  const target = parseInt(targetRank, 10) || 0;
  if (degree >= 2) return target <= own + 3;
  if (degree === 1) return target <= own + 1;
  if (degree === 0) return target < own;
  return false;
}

// The button: the caster (its token, else its record) and the spell, read
// again when it's clicked
function getCounteractButton(record, token, spellName, counteractRank, mod, dataPathToSpell, attribute) {
  const caster = {
    ...(token?._id ? { tokenId: token._id } : {}),
    recordType: record?.recordType,
    recordId: record?._id,
    dataPath: dataPathToSpell,
    attribute,
  };
  const fence = "```";
  return `${fence}Counteract\ncounteract(${JSON.stringify(spellName)}, ${parseInt(counteractRank, 10) || 0}, ${parseInt(mod, 10) || 0}, ${JSON.stringify(caster)});\n${fence}`;
}

// The check's modifiers, as Foundry's counteract statistic: the casting
// attribute and proficiency (the entry's modifier), then bonuses and
// penalties to checks of that attribute (frightened, stupefied) and to
// counteract checks (field "counteract"). Nothing that applies only to
// spell attack rolls: it's a check, not an attack.
function getCounteractModifiers(caster, spell, attribute, mod) {
  const base = mod ? [{ name: "Spell Attack Modifier", type: "", value: mod, active: true }] : [];
  if (!caster) return base;
  const checks = getEffectsAndModifiersForToken(
    caster,
    ["allBonus", "allPenalty"],
    [attribute || "int", "counteract"],
    undefined,
    undefined,
    { spell },
  );
  return [...base, ...keepStrongestPerType(checks)];
}

// The caster's token by id, when it's on the scene
function findCasterToken(tokenId) {
  if (!tokenId) return null;
  const current = api.getToken();
  if (current?._id === tokenId) return current;
  return (api.getOtherTokens() || []).map((t) => t?.token || t).find((t) => t?._id === tokenId) || null;
}

// The Counteract button: the DC of the effect to counteract, then its rank
// (a targeted creature's half level first), then the check
function counteract(spellName, counteractRank, mod, caster = null) {
  api.showValuePrompt("Counteract", "The DC of the effect you're trying to counteract", (value) => {
    const dc = parseInt(value, 10);
    if (!(dc > 0)) return;
    const target = (api.getTargets() || []).map((t) => t?.token || t)[0];
    const options = [];
    if (target?.data?.level !== undefined) {
      const rank = getCounteractRankForLevel(target.data.level);
      options.push({ label: `Rank ${rank} (${getCreatureName(target)}, half its level)`, value: `${rank}` });
    }
    for (let rank = 0; rank <= 10; rank++) {
      options.push({ label: `Rank ${rank}`, value: `${rank}` });
    }
    // The token carries an unlinked NPC's conditions; the record is the
    // fallback when the token isn't on the scene
    const roll = (targetRank, creature) => {
      const spell = creature && caster?.dataPath ? api.getValueOnRecord(creature, caster.dataPath) : null;
      api.promptRoll(
        `${spellName}: Counteract`,
        "1d20",
        getCounteractModifiers(creature, spell, caster?.attribute, mod),
        {
          rollName: `${spellName}: Counteract`,
          tooltip: "Counteract Check",
          dc,
          counteractRank,
          targetRank,
        },
        "counteract",
      );
    };
    api.showPrompt(
      "Counteract",
      "The rank of the effect you're trying to counteract (a creature: half its level, rounded up)",
      "Select...",
      options,
      null,
      (choice) => {
        const targetRank = parseInt(Array.isArray(choice) ? choice[0] : choice, 10);
        if (isNaN(targetRank)) return;
        const token = findCasterToken(caster?.tokenId);
        if (token) {
          roll(targetRank, token);
        } else if (caster?.recordType && caster?.recordId) {
          api.getRecord(caster.recordType, caster.recordId, (record) => roll(targetRank, record));
        } else {
          roll(targetRank, null);
        }
      },
      "Roll",
      "Cancel",
      1,
    );
  });
}

// ---------------------------------------------------------------- Stupefied, grabbed, deafened

// The creature whose conditions count: the sheet's own token when it has
// one, else the record
function getCastingCreature(record, token) {
  if (token && (!record || token.record?._id === record._id || token._id === record._id)) {
    return token;
  }
  return record || token || null;
}

// The flat checks casting this spell takes: [{ name, dc }]
function getCastingFlatChecks(caster, spell) {
  const traits = (spell?.data?.traits || []).map((t) => `${t}`.toLowerCase());
  const checks = [];
  const stupefied = getTokenConditionValue(caster, "stupefied");
  if (stupefied > 0) checks.push({ name: `Stupefied ${stupefied}`, dc: 5 + stupefied });
  if (traits.includes("manipulate") && getTokenCondition(caster, "grabbed")) {
    checks.push({ name: "Grabbed", dc: 5 });
  }
  if (traits.includes("auditory") && getTokenCondition(caster, "deafened")) {
    checks.push({ name: "Deafened", dc: 5 });
  }
  return checks;
}

// Rolls them, each with what a failure means
function rollCastingFlatChecks(caster, spell) {
  getCastingFlatChecks(caster, spell).forEach((check) => {
    api.roll(
      "1d20",
      {
        dc: check.dc,
        rollName: `${check.name}: Flat Check`,
        tooltip: `Flat check to cast ${spell?.name || "the spell"} while ${check.name.toLowerCase()}`,
        failureNote: `${spell?.name || "The spell"} is disrupted.`,
      },
      "flatCheck",
    );
  });
}

// ---------------------------------------------------------------- Sickened, confused

// Retch: a Fortitude save against the DC of what sickened the creature
function retch() {
  const token = (api.getSelectedOrDroppedToken() || []).map((t) => t?.token || t)[0] || api.getToken();
  if (!token) {
    api.showNotification("Select the sickened creature's token first.", "yellow", "Notice");
    return;
  }
  api.showValuePrompt("Retch", "The DC of the effect that made you sickened", (value) => {
    const dc = parseInt(value, 10);
    if (dc > 0) rollSave(token, "fortitude", dc, false, true, { action: "retch", retch: true });
  });
}

// After a Retch save: the button that lowers sickened (1, or 2 on a
// critical success)
function getRetchLine(metadata, degree) {
  if (!metadata?.retch || !(degree >= 1)) return "";
  const by = degree >= 2 ? 2 : 1;
  const id = JSON.stringify(String(metadata.saverTokenId || ""));
  const fence = "```";
  return `${fence}Reduce_Sickened_by_${by}\nwithChatButtonToken(${id}, "the sickened creature", typeof record !== "undefined" ? record : null, (token) => reduceSickened(token, ${by}));\n${fence}`;
}

function reduceSickened(token, by) {
  const sickened = getTokenCondition(token, "sickened");
  if (!sickened) {
    api.showNotification(`${getCreatureName(token)} isn't sickened.`, "yellow", "Notice");
    return;
  }
  deductEffectStacks(sickened.effect._id, token, Math.min(by, sickened.value));
  api.sendMessage(`${getCreatureName(token)} retches: sickened ${Math.max(0, sickened.value - by)}.`, undefined, undefined, undefined, token);
}

// A sickened creature can't willingly drink a potion or an elixir: a
// reminder, the Use goes ahead
function getSickenedDrinkWarning(creature, item) {
  if (!creature || !getTokenCondition(creature, "sickened")) return "";
  const traits = (item?.data?.traits || []).map((t) => `${t}`.toLowerCase());
  if (!traits.some((t) => ["potion", "elixir", "ingested"].includes(t))) return "";
  return `${getCreatureName(creature)} is sickened and can't willingly drink ${item?.name || "this"}.`;
}

// When an attack or spell damages a confused creature: the DC 11 flat check
// to recover. Not for persistent damage.
function getConfusedRecoveryButton(target, roll = null) {
  const metadata = roll?.metadata || {};
  if (metadata.isPersistant === true || metadata.isPersistent === true) return "";
  if (!getTokenCondition(target, "confused")) return "";
  const check = {
    dc: 11,
    rollName: "Confused: Recovery Flat Check",
    tooltip: "DC 11 flat check to end confused after taking damage",
    tokenId: target._id,
    endsCondition: "confused",
  };
  const fence = "```";
  return `${fence}Recover_from_Confused_(DC_11)\napi.promptRoll("Recover from Confused", "1d20", [], ${JSON.stringify(check)}, "flatCheck");\n${fence}`;
}

// A successful recovery flat check ends the condition on its token
function endConditionOnSuccess(metadata) {
  if (!metadata?.endsCondition) return "";
  const token = getPersistentRecoveryToken(metadata.tokenId);
  const condition = getTokenCondition(token, metadata.endsCondition);
  if (!condition) return "";
  api.removeEffectById(condition.effect._id, token);
  return `\n\n**${getCreatureName(token)} is no longer ${metadata.endsCondition}.**`;
}
