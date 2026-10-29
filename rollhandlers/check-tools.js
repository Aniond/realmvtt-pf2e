// Check tools: Assurance, incapacitation, signature spells, counteract
// checks, and the flat checks and riders of stupefied, grabbed, deafened,
// sickened and confused.
//
//   - Assurance (Player Core pg. 252): instead of rolling a skill it's taken
//     for, a result of 10 + the proficiency bonus. The skill comes from the
//     feat's choice or its name ("Assurance (Athletics)"); an Assurance with
//     neither is offered on every trained skill. Effects that change the
//     degree of success still apply (Paizo's clarification). Untrained
//     Improvisation needs no code: the module feat's skillBonus modifier
//     (proficiency:untrained) already adds it to untrained rolls
//   - Incapacitation (Player Core pg. 457): a creature whose level is more
//     than twice the spell's rank treats its save as one degree better
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
//     DC 11 flat check button when the creature takes damage

// ---------------------------------------------------------------- Assurance

// The skills a character has Assurance in: { skills: [slugs], any } where
// any is an Assurance whose skill isn't recorded
function getAssuranceSkills(record) {
  const result = { skills: [], any: false };
  if (record?.recordType === "npcs") return result;
  const feats = [...(record?.data?.feats || []), ...(record?.data?.bonusFeats || [])];
  for (const feat of feats) {
    if (feat?.data?.type === "slot") continue;
    const name = `${feat?.name || ""}`.trim();
    if (!/^assurance\b/i.test(name)) continue;
    const named = name.match(/\(([^)]+)\)\s*$/);
    const chosen = named ? named[1] : getFeatChoiceName(feat);
    if (chosen) {
      result.skills.push(toSlug(chosen));
    } else {
      result.any = true;
    }
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

// Whether Assurance can be used for this skill at this rank (trained or better)
function hasAssurance(record, skillSlug, rank) {
  if (!(parseInt(rank, 10) >= 1)) return false;
  const { skills, any } = getAssuranceSkills(record);
  return any || skills.includes(toSlug(skillSlug));
}

// Assurance's result: 10 + the proficiency bonus, nothing else
function getAssuranceResult(record, rank) {
  return 10 + getProficiencyBonusForRank(rank, record?.data?.level);
}

// Before a skill check: roll it, or take Assurance's result. callback(false)
// rolls; with Assurance the fixed result goes to the skill handler, so the
// DC, its notes and the degree adjustments still apply.
function offerAssurance(record, skillSlug, rank, roll, metadata, rollType = "skill") {
  if (!hasAssurance(record, skillSlug, rank)) {
    roll();
    return;
  }
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
        api.roll(`${result}`, getAssuranceMetadata(metadata, result), rollType);
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

// ---------------------------------------------------------------- Incapacitation

// Whether the saver's level makes an incapacitation effect one degree
// better: more than twice the spell's rank, or (not a spell) higher than the
// effect's level
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

// The save handler's degree after incapacitation
function applyIncapacitation(degree, metadata) {
  if (!metadata?.incapacitation) return { degree, name: null };
  return { degree: Math.min(2, degree + 1), name: "Incapacitation" };
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
// then casts it there. Returns false when there's no choice to make.
function promptSignatureRank(record, spell, dataPathToSpell, isOverlay) {
  if (isOverlay || spell?.castRank) return false;
  const ranks = getSignatureRanks(record, spell, dataPathToSpell);
  if (ranks.length < 2) return false;
  const listRank = getCastingRank(record, spell, dataPathToSpell);
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

function getCounteractButton(spellName, counteractRank, mod) {
  const fence = "```";
  return `${fence}Counteract\ncounteract(${JSON.stringify(spellName)}, ${parseInt(counteractRank, 10) || 0}, ${parseInt(mod, 10) || 0});\n${fence}`;
}

// The Counteract button: the DC of the effect to counteract, then its rank
// (a targeted creature's half level first), then the check
function counteract(spellName, counteractRank, mod) {
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
    api.showPrompt(
      "Counteract",
      "The rank of the effect you're trying to counteract (a creature: half its level, rounded up)",
      "Select...",
      options,
      null,
      (choice) => {
        const targetRank = parseInt(Array.isArray(choice) ? choice[0] : choice, 10);
        if (isNaN(targetRank)) return;
        const modifiers = mod ? [{ name: "Spell Attack Modifier", type: "", value: mod, active: true }] : [];
        api.promptRoll(
          `${spellName}: Counteract`,
          "1d20",
          modifiers,
          {
            rollName: `${spellName}: Counteract`,
            tooltip: "Counteract Check",
            dc,
            counteractRank,
            targetRank,
          },
          "counteract",
        );
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

// When a confused creature takes damage: the DC 11 flat check to recover
function getConfusedRecoveryButton(target) {
  if (!getTokenCondition(target, "confused")) return "";
  const metadata = {
    dc: 11,
    rollName: "Confused: Recovery Flat Check",
    tooltip: "DC 11 flat check to end confused after taking damage",
    tokenId: target._id,
    endsCondition: "confused",
  };
  const fence = "```";
  return `${fence}Recover_from_Confused_(DC_11)\napi.promptRoll("Recover from Confused", "1d20", [], ${JSON.stringify(metadata)}, "flatCheck");\n${fence}`;
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
