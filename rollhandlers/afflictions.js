// Afflictions (roadmap B4, Player Core pg. 430): poisons, diseases and
// curses, as Sean laid them out on #64.
//
//   - The source: the record that delivers it (a poison item, a weapon, a
//     creature ability, a spell) has data.affliction, filled once by
//     tools/afflictions/fill-afflictions.mjs from its description: the save,
//     the DC ("spell" for the caster's), onset, maximum duration, and each
//     stage's damage, conditions and interval. Nothing is parsed during play;
//     a record without data.affliction has no Expose button.
//   - On a creature the affliction is its own stackable effect, named after
//     it (the script creates one per affliction): the stacks are the stage,
//     its duration is the maximum duration, so Realm counts it down, and
//     removing it from the effects strip ends it.
//   - What an effect can't hold is in data.afflictionState on the token, with
//     no sheet UI: the affliction, the stage whose conditions are on the
//     creature (appliedStage), the onset and interval left in rounds, the
//     virulent successes, and the round last counted.
//   - Save results (save.js, getAfflictionSaveLines) say what the degree does
//     and have the button that does it, on the saver's token.
//   - The creature's turn end counts down onsets and intervals kept in rounds
//     or minutes, posting the Apply or Save button; longer ones are the GM's.
//     An affliction whose effect is gone (removed, or its duration over) gets
//     a button that clears its stage's conditions.
//   - A stage change swaps the stage's conditions: the old stage's go, unless
//     they end by their own rule (drained, doomed, frightened, sickened,
//     fatigued, wounded, stunned), and the new stage's damage gets a button.
//   - Treat Poison and Treat Disease apply the Player Core effects (their
//     save bonus has the poison or disease predicate), removed after the save
//     they apply to.
//
// The affliction effect's stacks are added one api.addEffect at a time with
// the remaining duration: api.addEffects ignores durations, and adding a
// stack without one drops the duration's unit (checked live).

// Rounds in each unit; rounds and minutes are counted at turn ends
const AFFLICTION_UNIT_ROUNDS = { round: 1, minute: 10 };

// The effect duration units for a maximum duration
const AFFLICTION_DURATION_UNITS = { round: "rounds", minute: "minutes", hour: "hours", day: "days" };

// Conditions with their own ending, kept when the stage changes (Player
// Core pg. 430: they last their normal duration, and one that changes or
// ends on its own still does, as stunned counts down)
const AFFLICTION_LASTING_CONDITIONS = new Set(["drained", "doomed", "frightened", "sickened", "fatigued", "wounded", "stunned"]);

// The Player Core effects Treat Poison and Treat Disease apply
const AFFLICTION_TREATMENT_EFFECTS = { poison: "Treat Poison", disease: "Treat Disease" };

// ---------------------------------------------------------------- Times

// A time from data.affliction: { value, unit } or { dice, unit }
function describeAfflictionTime(time) {
  if (!time) return "";
  if (time.dice) return `${time.dice} ${time.unit}s`;
  return `${time.value} ${time.unit}${time.value === 1 ? "" : "s"}`;
}

// The rounds a time is counted for at turn ends, or 0 (hours and longer, and
// dice, are the GM's)
function getAfflictionRounds(time) {
  if (!time || time.dice || !AFFLICTION_UNIT_ROUNDS[time.unit]) return 0;
  return (parseInt(time.value, 10) || 0) * AFFLICTION_UNIT_ROUNDS[time.unit];
}

// The effect duration for a maximum duration, or undefined (none, or dice)
function getAfflictionEffectDuration(time) {
  if (!time || time.dice) return undefined;
  if (time.unit === "week") return { value: (parseInt(time.value, 10) || 0) * 7, unit: "days" };
  const unit = AFFLICTION_DURATION_UNITS[time.unit];
  return unit ? { value: parseInt(time.value, 10) || 0, unit } : undefined;
}

// ---------------------------------------------------------------- The source

// The effect's name: the affliction's, without a monster ability's
// "(Graveknight) " prefix (as the script names it)
function getAfflictionEffectName(name) {
  return `${name || ""}`.replace(/^\([^)]*\)\s*/, "").trim();
}

// A record's affliction (data.affliction), or null: it needs a save, a DC
// (a number, or "spell") and a stage
function getRecordAffliction(source) {
  const affliction = source?.data?.affliction;
  if (!affliction?.save || affliction.dc === null || affliction.dc === undefined || !affliction.stages?.length) return null;
  return { ...affliction, name: getAfflictionEffectName(affliction.name || source.name) };
}

function getAfflictionTraits(affliction) {
  return [affliction.kind, affliction.virulent && "virulent"].filter(Boolean);
}

// ---------------------------------------------------------------- Exposure

// The Expose button for an item's, ability's or spell's card ("" without
// one). A spell's DC is the caster's (options.dc).
function getAfflictionExposeButton(source, { dc } = {}) {
  const affliction = getRecordAffliction(source);
  if (!affliction) return "";
  const saveDC = affliction.dc === "spell" ? dc : affliction.dc;
  if (!saveDC) return "";
  const label = `Expose_to_${affliction.name.replace(/[^\w]+/g, "_").replace(/^_+|_+$/g, "")}`;
  return `\n\`\`\`${label}\nexposeToAffliction(${JSON.stringify(affliction)}, ${saveDC});\n\`\`\``;
}

// The initial save, for the selected tokens
function exposeToAffliction(affliction, dc) {
  rollSavingThrow(affliction.save, dc, {
    traits: getAfflictionTraits(affliction),
    affliction: { mode: "initial", affliction },
  });
}

// ---------------------------------------------------------------- State

// The token's affliction state: [{ name, affliction, appliedStage,
// onsetLeft, roundsLeft, successes, tickRound }]
function getAfflictionStates(creature) {
  const list = creature?.data?.afflictionState || creature?.record?.data?.afflictionState;
  return Array.isArray(list) ? list : [];
}

function writeAfflictionStates(creature, list) {
  api.setValuesOnTokenById(creature._id, creature.recordType || "tokens", { "data.afflictionState": list });
}

// The stage: the affliction effect's stacks
function getAfflictionStage(creature, name) {
  return getTokenCondition(creature, name)?.value || 0;
}

function newAfflictionState(affliction) {
  return {
    name: affliction.name,
    affliction,
    appliedStage: 0,
    onsetLeft: getAfflictionRounds(affliction.onset),
    roundsLeft: 0,
    successes: 0,
    tickRound: null,
  };
}

// What a failed initial save does: a new affliction, a poison's stage raised
// (re-exposure keeps its maximum duration and onset), or nothing for a curse
// or disease it already has. Pure: { states, state, stage, apply, line }.
function getAfflictionExposure(states, currentStage, affliction, startStage) {
  const max = affliction.stages.length;
  const existing = states.find((s) => s.name === affliction.name);
  if (existing || currentStage > 0) {
    if (affliction.kind !== "poison") {
      return { states, state: existing, stage: currentStage, apply: false, line: `Already has ${affliction.name}: no effect.` };
    }
    const state = existing || newAfflictionState(affliction);
    const stage = Math.min(max, currentStage + startStage);
    const pending = state.onsetLeft > 0 || (state.affliction.onset && state.appliedStage === 0);
    return {
      states: existing ? states : [...states, state],
      state,
      stage,
      apply: !pending,
      line: `${affliction.name} again: stage ${stage}${pending ? " after its onset" : ""}.`,
    };
  }
  const state = newAfflictionState(affliction);
  const onset = !!affliction.onset;
  const stage = Math.min(max, startStage);
  return {
    states: [...states, state],
    state,
    stage,
    apply: !onset,
    line: onset
      ? `${affliction.name}: stage ${stage} after its onset (${describeAfflictionTime(affliction.onset)}).`
      : `${affliction.name}: stage ${stage}.`,
  };
}

// ---------------------------------------------------------------- Effects

// The affliction effect's stacks to a stage, keeping its duration: the
// first application takes the maximum duration
function getAfflictionStackDuration(creature, name, affliction) {
  const condition = getTokenCondition(creature, name);
  const id = condition?.effect?._id;
  const left = id ? creature?.effectDurations?.[id] : undefined;
  const unit = id ? creature?.effectDurationUnits?.[id] : undefined;
  if (left !== undefined && unit) return { value: left, unit };
  if (condition) return undefined;
  return getAfflictionEffectDuration(affliction.maxDuration);
}

// The condition changes from one stage's conditions to another's: { gain,
// add, remove, kept }. Conditions that end by their own rule are gained
// (the higher value wins) and never removed; the rest follow the stage.
function getAfflictionConditionChanges(fromConditions, toConditions) {
  const values = (conditions) => {
    const map = new Map();
    (conditions || []).forEach(({ name, value }) => {
      const key = `${name}`.toLowerCase();
      map.set(key, { name, value: Math.max(map.get(key)?.value || 0, parseInt(value, 10) || 1) });
    });
    return map;
  };
  const from = values(fromConditions);
  const to = values(toConditions);
  const changes = { gain: [], add: [], remove: [], kept: [] };
  new Set([...from.keys(), ...to.keys()]).forEach((key) => {
    const oldValue = from.get(key)?.value || 0;
    const newValue = to.get(key)?.value || 0;
    const name = (to.get(key) || from.get(key)).name;
    if (AFFLICTION_LASTING_CONDITIONS.has(key)) {
      if (newValue > 0) changes.gain.push({ name, value: newValue });
      else if (oldValue > 0) changes.kept.push(name);
      return;
    }
    if (oldValue === 0 && newValue > 0) changes.gain.push({ name, value: newValue });
    else if (newValue > oldValue) changes.add.push({ name, value: newValue - oldValue });
    else if (newValue < oldValue) changes.remove.push({ name, value: oldValue - newValue });
  });
  return changes;
}

// The effect writes for a stage change, in one chain: removals first (the
// affliction's stacks, then conditions), then the conditions added in one
// api.addEffects, then the affliction's stacks one api.addEffect at a time.
// stacks: { name, from, to, duration }; removing it all when to is 0.
function applyAfflictionEffects(token, changes, stacks) {
  const conditionNames = [];
  let sent = false;
  const addStacks = (name) => (count) => {
    const list = Array(Math.max(0, count)).fill(name);
    if (!list.length) return;
    // A gain confirmed after the chain (immunity's Apply Anyway) adds alone
    if (sent) api.addEffects(list, token);
    else conditionNames.push(...list);
  };
  const removals = changes.remove
    .map(({ name, value }) => ({ condition: getTokenCondition(token, name), value }))
    .filter(({ condition }) => condition);
  const affliction = stacks ? getTokenCondition(token, stacks.name) : null;
  if (affliction && stacks.to < stacks.from) {
    removals.unshift({ condition: affliction, value: stacks.to < 1 ? affliction.value : stacks.from - stacks.to });
  }
  const finish = () => {
    changes.add.forEach(({ name, value }) => conditionNames.push(...Array(value).fill(name)));
    changes.gain.forEach(({ name, value }) => addConditionGain(token, name, value, addStacks(name)));
    sent = true;
    if (conditionNames.length) api.addEffects(conditionNames, token);
    if (stacks && stacks.to > stacks.from) {
      for (let i = stacks.from; i < stacks.to; i++) api.addEffect(stacks.name, token, stacks.duration);
    }
  };
  const next = (index) => {
    if (index >= removals.length) {
      finish();
      return;
    }
    const { condition, value } = removals[index];
    deductEffectStacks(condition.effect._id, token, Math.min(value, condition.value), () => next(index + 1));
  };
  next(0);
}

function getAfflictionDamageButtons(name, stage) {
  return (stage?.damage || []).map((formula) => {
    const label = `Roll_${formula.replace(/[^\w]+/g, "_").replace(/^_+|_+$/g, "")}`;
    return `\`\`\`${label}\nexecuteDamageMacro(${JSON.stringify(formula)}, "standard", ${JSON.stringify(`${name}: ${formula}`)});\n\`\`\``;
  });
}

// The state, effect stacks and card for moving an affliction to a stage
// (below 1: it ends). Pure: { states, changes, stacks, message }.
function getAfflictionStageValues(creature, states, name, currentStage, stage, line = "") {
  const state = states.find((s) => s.name === name);
  if (!state) return null;
  const stages = state.affliction.stages;
  const max = stages.length;
  const target = Math.min(max, stage);
  const fromConditions = state.appliedStage > 0 ? stages[state.appliedStage - 1]?.conditions : [];
  const who = getCreatureName(creature);
  const lines = line ? [line] : [];
  if (target < 1) {
    const changes = getAfflictionConditionChanges(fromConditions, []);
    lines.unshift(`**${who}** recovers from **${name}**.`);
    if (changes.kept.length) lines.push(`[gm]Kept: ${changes.kept.join(", ")} (they end on their own).[/gm]`);
    return {
      states: states.filter((s) => s.name !== name),
      changes,
      stacks: { name, from: currentStage, to: 0 },
      message: lines.join("\n"),
    };
  }
  const stageData = stages[target - 1];
  const changes = getAfflictionConditionChanges(fromConditions, stageData.conditions);
  const updated = { ...state, appliedStage: target, onsetLeft: 0, roundsLeft: getAfflictionRounds(stageData.interval) };
  lines.unshift(`**${who}: ${name}, stage ${target}${stage > max ? " (the highest, again)" : ""}**`, stageData.text);
  if (stageData.note) lines.push(`[gm]${stageData.note}[/gm]`);
  if (changes.kept.length) lines.push(`[gm]Kept: ${changes.kept.join(", ")} (they end on their own).[/gm]`);
  lines.push(...getAfflictionDamageButtons(name, stageData));
  return {
    states: states.map((s) => (s.name === name ? updated : s)),
    changes,
    stacks: { name, from: currentStage, to: target },
    message: lines.join("\n"),
  };
}

// Moves an affliction to a stage: one write of the state, the effects in one
// chain, and the stage's card with its damage
function setAfflictionStage(creature, name, stage, { states, line } = {}) {
  const list = states || getAfflictionStates(creature);
  const current = getAfflictionStage(creature, name);
  const values = getAfflictionStageValues(creature, list, name, current, stage, line);
  if (!values) return;
  const state = list.find((s) => s.name === name);
  writeAfflictionStates(creature, values.states);
  applyAfflictionEffects(creature, values.changes, { ...values.stacks, duration: getAfflictionStackDuration(creature, name, state.affliction) });
  api.sendMessage(values.message, undefined, [], [], creature);
}

// The Apply button of a failed initial save
function afflictCreature(token, affliction, startStage) {
  const fresh = findSceneToken(token._id) || token;
  const current = getAfflictionStage(fresh, affliction.name);
  const result = getAfflictionExposure(getAfflictionStates(fresh), current, affliction, startStage);
  if (!result.state) {
    api.sendMessage(`**${getCreatureName(fresh)}:** ${result.line}`, undefined, [], [], fresh);
    return;
  }
  if (result.apply) {
    setAfflictionStage(fresh, affliction.name, result.stage, { states: result.states, line: result.line });
    return;
  }
  // The onset: the stage shows on the effect, its conditions wait
  writeAfflictionStates(fresh, result.states);
  if (result.stage > current) {
    applyAfflictionEffects(fresh, { gain: [], add: [], remove: [], kept: [] }, {
      name: affliction.name,
      from: current,
      to: result.stage,
      duration: getAfflictionStackDuration(fresh, affliction.name, affliction),
    });
  }
  api.sendMessage(`**${getCreatureName(fresh)}:** ${result.line}`, undefined, [], [], fresh);
}

// ---------------------------------------------------------------- Saves

// A stage's save (an interval's end). A Treat Poison or Treat Disease effect
// on the creature adds its bonus through its own rule; it's removed when the
// result is applied, so a cancelled roll keeps it.
function rollAfflictionSave(creature, name) {
  const state = getAfflictionStates(creature).find((s) => s.name === name);
  if (!state) return;
  const affliction = state.affliction;
  const stage = getAfflictionStage(creature, name) || state.appliedStage;
  // A spell's affliction keeps the caster's DC from the initial save
  const dc = affliction.dc === "spell" ? affliction.castDC : affliction.dc;
  rollSave(creature, affliction.save, dc, false, true, {
    traits: getAfflictionTraits(affliction),
    affliction: { mode: "stage", name, stage, max: affliction.stages.length, virulent: !!affliction.virulent, successes: state.successes || 0 },
  });
}

// What a stage save's degree does: { stage, successes } (stage below 1:
// cured). Virulent: two successes in a row for 1 stage; a critical success
// counts as 1 stage.
function getAfflictionSaveChange(state, degree) {
  const d = parseInt(degree, 10);
  let stage = state.stage;
  let successes = 0;
  if (d === 2) stage -= state.virulent ? 1 : 2;
  else if (d === 1) {
    if (state.virulent) {
      successes = (state.successes || 0) + 1;
      if (successes >= 2) {
        stage -= 1;
        successes = 0;
      }
    } else stage -= 1;
  } else if (d === 0) stage += 1;
  else stage += 2;
  return { stage: Math.min(state.max, stage), successes, over: stage > state.max };
}

// The line and button a save result adds (save.js); [] without an
// affliction
function getAfflictionSaveLines(metadata, degree) {
  const info = metadata?.affliction;
  if (!info || degree === null || degree === undefined || !metadata?.saverTokenId) return [];
  const saver = { _id: metadata.saverTokenId, name: info.tokenName || "the creature" };
  if (info.mode === "initial") {
    const affliction = info.affliction;
    // A spell's own results say what a success does (Goblin Pox: sickened)
    if (degree >= 1) return [`**${affliction.name}:** not afflicted${affliction.dc === "spell" ? " (the spell says what a success does)" : ""}.`];
    const stage = Math.min(affliction.stages.length, degree === -1 ? 2 : 1);
    const stored = affliction.dc === "spell" ? { ...affliction, castDC: metadata.dc } : affliction;
    return [
      `**${affliction.name}:** stage ${stage}${affliction.onset ? ` after its onset (${describeAfflictionTime(affliction.onset)})` : ""}.`,
      getChatButton(`Apply_${affliction.name.replace(/[^\w]+/g, "_").replace(/^_+|_+$/g, "")}`, saver, `afflictCreature(token, ${JSON.stringify(stored)}, ${stage})`),
    ];
  }
  const change = getAfflictionSaveChange(info, degree);
  const text = change.stage < 1
    ? "recovers"
    : change.stage === info.stage
      ? info.virulent && degree === 1 ? `stays at stage ${info.stage} (virulent: ${change.successes} of 2 successes)` : `stays at stage ${info.stage}`
      : `stage ${change.stage}${change.over ? " (the highest, again)" : ""}`;
  return [
    `**${info.name}:** ${text}.`,
    getChatButton(`Apply_${info.name.replace(/[^\w]+/g, "_").replace(/^_+|_+$/g, "")}`, saver, `resolveAfflictionSave(token, ${JSON.stringify(info.name)}, ${degree})`),
  ];
}

// The treatment effect used up by a save, then the callback: each effect
// call writes the token's whole effect list, so the stage change waits
function removeAfflictionTreatment(token, kind, callback) {
  const effect = AFFLICTION_TREATMENT_EFFECTS[kind];
  const treatment = effect ? getTokenCondition(token, effect) : null;
  if (!treatment) {
    callback();
    return;
  }
  api.removeEffectById(treatment.effect._id, token, () => callback());
}

// The stage save's Apply button: the treatment it used comes off first, then
// the affliction as it is now (the GM may have changed the effect's stacks)
function resolveAfflictionSave(token, name, degree) {
  const first = findSceneToken(token._id) || token;
  const found = getAfflictionStates(first).find((s) => s.name === name);
  if (!found) {
    api.showNotification("That affliction is gone.", "yellow", "Afflictions");
    return;
  }
  removeAfflictionTreatment(first, found.affliction.kind, () => applyAfflictionSave(token, name, degree));
}

function applyAfflictionSave(token, name, degree) {
  const fresh = findSceneToken(token._id) || token;
  const states = getAfflictionStates(fresh);
  const state = states.find((s) => s.name === name);
  if (!state) return;
  const current = getAfflictionStage(fresh, name) || state.appliedStage;
  const affliction = state.affliction;
  const change = getAfflictionSaveChange({ stage: current, max: affliction.stages.length, virulent: affliction.virulent, successes: state.successes }, degree);
  const withSuccesses = states.map((s) => (s.name === name ? { ...s, successes: change.successes } : s));
  if (change.stage === current && !change.over) {
    // A virulent success that doesn't reach a stage: the count and the next
    // interval only, no stage card (damage comes on reaching a stage)
    const interval = affliction.stages[current - 1]?.interval;
    writeAfflictionStates(fresh, withSuccesses.map((s) => (s.name === name ? { ...s, roundsLeft: getAfflictionRounds(interval) } : s)));
    api.sendMessage(`**${getCreatureName(fresh)}: ${name}** stays at stage ${current} (virulent: ${change.successes} of 2 successes).`, undefined, [], [], fresh);
  } else {
    setAfflictionStage(fresh, name, change.stage, { states: withSuccesses });
  }
}

// ---------------------------------------------------------------- Turn end

// The turn end's countdown, once a round: onsets and intervals kept in
// rounds. An affliction whose effect is gone (removed, or its duration over)
// gets one Clear button. Pure: { states, changed, messages }.
function getAfflictionTurnEnd(creature, states, round) {
  const messages = [];
  let changed = false;
  const who = getCreatureName(creature);
  const next = states.map((entry) => {
    const state = { ...entry };
    if (round !== null && round !== undefined && state.tickRound === round) return entry;
    if (state.ended) return entry;
    state.tickRound = round ?? null;
    changed = true;
    const stage = getAfflictionStage(creature, state.name);
    if (stage < 1) {
      state.ended = true;
      messages.push([
        `**${who}: ${state.name}** has ended (its effect is gone).`,
        getChatButton(`Clear_${state.name.replace(/[^\w]+/g, "_").replace(/^_+|_+$/g, "")}`, creature, `clearAfflictionState(token, ${JSON.stringify(state.name)})`),
      ].join("\n"));
      return state;
    }
    if (state.onsetLeft > 0) {
      state.onsetLeft -= 1;
      if (state.onsetLeft === 0) {
        messages.push([
          `**${who}: ${state.name}**'s onset is over: stage ${stage}.`,
          getChatButton(`Apply_Stage_${stage}`, creature, `setAfflictionStage(token, ${JSON.stringify(state.name)}, ${stage})`),
        ].join("\n"));
      }
    } else if (state.roundsLeft > 0) {
      state.roundsLeft -= 1;
      if (state.roundsLeft === 0) {
        messages.push([
          `**${who}: ${state.name}**, stage ${stage}: the interval is over.`,
          getChatButton(`Roll_${capitalize(state.affliction.save)}`, creature, `rollAfflictionSave(token, ${JSON.stringify(state.name)})`),
        ].join("\n"));
      }
    }
    return state;
  });
  return { states: next, changed, messages };
}

function runAfflictionTurnEnd(creature, round) {
  const states = getAfflictionStates(creature);
  if (!states.length) return;
  const result = getAfflictionTurnEnd(creature, states, round);
  if (result.changed) writeAfflictionStates(creature, result.states);
  result.messages.forEach((message) => api.sendMessage(message, undefined, [], [], creature));
}

// The Clear button: the stage's conditions off (not the lasting ones) and
// the state gone, after the effect was removed or ran out
function clearAfflictionState(token, name) {
  const fresh = findSceneToken(token._id) || token;
  const states = getAfflictionStates(fresh);
  const state = states.find((s) => s.name === name);
  if (!state) return;
  const fromConditions = state.appliedStage > 0 ? state.affliction.stages[state.appliedStage - 1]?.conditions : [];
  const changes = getAfflictionConditionChanges(fromConditions, []);
  writeAfflictionStates(fresh, states.filter((s) => s.name !== name));
  applyAfflictionEffects(fresh, changes, null);
  api.sendMessage(`**${getCreatureName(fresh)}:** ${name}'s conditions cleared${changes.kept.length ? ` (kept: ${changes.kept.join(", ")})` : ""}.`, undefined, [], [], fresh);
}

// ---------------------------------------------------------------- Treatment

const AFFLICTION_TREATMENTS = { "treat poison": "poison", "treat disease": "disease" };

// The result line of a Treat Poison or Treat Disease check (skill.js): the
// Player Core effect for the patient, which asks for the degree and gives
// the bonus to the next save against that kind
function getAfflictionTreatmentLines(metadata, degree) {
  const kind = AFFLICTION_TREATMENTS[`${metadata?.action || ""}`.toLowerCase()];
  if (!kind || degree === null || degree === undefined) return [];
  if (degree === 0) return [`**${metadata.action}:** no bonus.`];
  const effect = AFFLICTION_TREATMENT_EFFECTS[kind];
  return [
    `**${metadata.action}:** ${degree === 2 ? "+4" : degree === 1 ? "+2" : "-2"} to the patient's next save against its ${kind}.`,
    `\`\`\`Apply_${effect.replace(/\s+/g, "_")}\napplyEffect(${JSON.stringify(effect)}, 1);\n\`\`\``,
  ];
}
