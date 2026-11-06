// Afflictions (roadmap B4, Player Core pg. 430): poisons, diseases and
// curses with a save, an onset, stages and their intervals.
//
//   - The source: a poison item's or a creature's ability description, as
//     the data prints it (parseAffliction): "Saving Throw" with its save
//     macro, "Onset", "Maximum Duration", and "Stage N" lines whose damage
//     links and condition links are the stage's effects, with the interval
//     in parentheses. Using the item or ability adds an Expose button
//     (getAfflictionExposeButton), which rolls the initial save.
//   - The creature keeps its afflictions in data.afflictions, token data
//     with no sheet UI: the stage, the stage the conditions are for
//     (appliedStage), the onset and interval left in rounds, and the rounds
//     of its maximum duration gone.
//   - Save results (save.js, getAfflictionSaveLines) say what the degree does
//     and have the button that does it, on the saver's token.
//   - The creature's turn end counts down onsets, intervals and maximum
//     durations kept in rounds or minutes, and posts the Save, onset or End
//     button; longer ones are left to the GM.
//   - A stage change swaps the stage's conditions: the old stage's go, unless
//     they end by their own rule (drained, doomed, frightened, sickened,
//     fatigued, wounded, stunned), and the new stage's damage gets a button.
//
// Applying a poison to a weapon isn't tracked: the GM posts Expose when the
// Strike hits.

// Rounds in each unit; rounds and minutes are counted at turn ends
const AFFLICTION_UNIT_ROUNDS = { round: 1, minute: 10, hour: 600, day: 14400, week: 100800 };
const AFFLICTION_COUNTED_UNITS = new Set(["round", "minute"]);

// Conditions with their own ending, kept when the stage changes (Player
// Core pg. 430: they last their normal duration, and one that changes or
// ends on its own still does, as stunned counts down)
const AFFLICTION_LASTING_CONDITIONS = new Set(["drained", "doomed", "frightened", "sickened", "fatigued", "wounded", "stunned"]);

// Condition names read from a stage's text when it has no effect links
const AFFLICTION_TEXT_CONDITIONS = [
  "blinded", "clumsy", "confused", "dazzled", "deafened", "doomed", "drained",
  "enfeebled", "fascinated", "fatigued", "fleeing", "frightened", "immobilized",
  "off-guard", "paralyzed", "petrified", "prone", "sickened", "slowed",
  "stunned", "stupefied", "unconscious",
];

// ---------------------------------------------------------------- Parsing

// "1 round", "2 rounds", "10 minutes", "1 day": { value, unit, rounds,
// counted }, or null (dice, "varies")
function parseAfflictionTime(text) {
  // Not a dice duration ("1d4 hours"): the GM rolls that
  const match = `${text || ""}`.toLowerCase().match(/(^|[^d\d])(\d+)\s*(round|minute|hour|day|week)s?/);
  if (!match) return null;
  const value = parseInt(match[2], 10);
  const unit = match[3];
  return { value, unit, rounds: value * AFFLICTION_UNIT_ROUNDS[unit], counted: AFFLICTION_COUNTED_UNITS.has(unit) };
}

function describeAfflictionTime(time) {
  if (!time) return "";
  return `${time.value} ${time.unit}${time.value === 1 ? "" : "s"}`;
}

function unescapeAfflictionHtml(text) {
  return `${text || ""}`
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

// The record links in a paragraph: { link, text }
function getAfflictionLinks(html) {
  const links = [];
  const re = /<record-link\s+recordlink="([^"]*)"[^>]*>([\s\S]*?)<\/record-link>/g;
  let match;
  while ((match = re.exec(html))) {
    try {
      links.push({ link: JSON.parse(unescapeAfflictionHtml(match[1])), text: match[2] });
    } catch (e) {
      // A link that isn't JSON is only text
    }
  }
  return links;
}

function stripAfflictionHtml(html) {
  return unescapeAfflictionHtml(`${html || ""}`.replace(/<record-link[^>]*>([\s\S]*?)<\/record-link>/g, "$1").replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

// "Clumsy 1" -> { name: "Clumsy", value: 1 }; "Off-Guard" -> value 1
function splitConditionValue(text) {
  const match = `${text || ""}`.trim().match(/^(.*?)\s+(\d+)$/);
  return match ? { name: match[1].trim(), value: parseInt(match[2], 10) } : { name: `${text || ""}`.trim(), value: 1 };
}

function capitalizeCondition(name) {
  return `${name}`.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("-");
}

// A stage's effects: damage from its damage macros, conditions from its
// effect links, or from the text when it has none
function parseAfflictionStage(html) {
  const links = getAfflictionLinks(html);
  const damage = [];
  const conditions = [];
  links.forEach(({ link }) => {
    const code = link?.value?.code || "";
    const damageMatch = code.match(/executeDamageMacro\(\s*'([^']+)'/);
    if (damageMatch) damage.push(damageMatch[1]);
    if (link?.type === "effects" && link?.value?.name) {
      conditions.push(splitConditionValue(link.value.name));
    }
  });
  const text = stripAfflictionHtml(html).replace(/^Stage \d+\s*/i, "");
  if (!conditions.length) {
    const lower = text.toLowerCase().replace(/flat-footed/g, "off-guard");
    AFFLICTION_TEXT_CONDITIONS.forEach((name) => {
      const match = lower.match(new RegExp(`\\b${name}(?:\\s+(\\d+))?\\b`));
      if (match) conditions.push({ name: capitalizeCondition(name), value: match[1] ? parseInt(match[1], 10) : 1 });
    });
  }
  if (!damage.length) {
    const re = /(\d+d\d+(?:\s*[+-]\s*\d+)?)\s+(persistent\s+)?([a-z]+)\s+damage/gi;
    let match;
    while ((match = re.exec(text))) damage.push(`${match[1].replace(/\s+/g, "")} ${match[2] ? "persistent " : ""}${match[3].toLowerCase()}`);
  }
  const intervals = text.match(/\(([^()]*)\)\s*\.?\s*$/);
  return { text, damage, conditions, interval: parseAfflictionTime(intervals ? intervals[1] : "") };
}

// The affliction in a description, or null: { name, kind, level, traits,
// virulent, save, dc, onset, maxDuration, stages }
function parseAffliction(html, { name = "", traits = [], level = 0 } = {}) {
  const paragraphs = `${html || ""}`.split(/<\/p>|<br\s*\/?>|\n/i);
  const affliction = { name, level: parseInt(level, 10) || 0, save: null, dc: null, onset: null, maxDuration: null, stages: [] };
  paragraphs.forEach((paragraph) => {
    const text = stripAfflictionHtml(paragraph);
    if (/^Saving Throw/i.test(text)) {
      const code = getAfflictionLinks(paragraph).map(({ link }) => link?.value?.code || "").find((c) => /rollSavingThrow/.test(c)) || "";
      const fromCode = code.match(/rollSavingThrow\(\s*'(\w+)'\s*,\s*(\d+)/);
      const fromText = text.match(/DC\s*(\d+)\s*(Fortitude|Reflex|Will)|(Fortitude|Reflex|Will)\D*DC\s*(\d+)/i);
      if (fromCode) {
        affliction.save = fromCode[1].toLowerCase();
        affliction.dc = parseInt(fromCode[2], 10);
      } else if (fromText) {
        affliction.save = (fromText[2] || fromText[3]).toLowerCase();
        affliction.dc = parseInt(fromText[1] || fromText[4], 10);
      }
    } else if (/^Onset/i.test(text)) {
      affliction.onset = parseAfflictionTime(text.replace(/^Onset/i, ""));
    } else if (/^Maximum Duration/i.test(text)) {
      affliction.maxDuration = parseAfflictionTime(text.replace(/^Maximum Duration/i, ""));
    } else if (/^Stage \d+/i.test(text)) {
      affliction.stages.push(parseAfflictionStage(paragraph));
    }
  });
  if (!affliction.save || !affliction.dc || !affliction.stages.length) return null;
  const lowerTraits = (traits || []).map((t) => `${t}`.toLowerCase());
  affliction.kind = ["poison", "disease", "curse"].find((k) => lowerTraits.includes(k)) || "affliction";
  affliction.virulent = lowerTraits.includes("virulent");
  affliction.traits = lowerTraits.filter((t) => ["poison", "disease", "curse", "virulent", "magical"].includes(t));
  return affliction;
}

// An item's or an ability's affliction
function getRecordAffliction(source) {
  const data = source?.data || {};
  return parseAffliction(data.description, { name: source?.name || "", traits: data.traits || [], level: data.level });
}

// ---------------------------------------------------------------- Exposure

// The Expose button for an item's or ability's card ("" without one)
function getAfflictionExposeButton(source) {
  const affliction = getRecordAffliction(source);
  if (!affliction) return "";
  const label = `Expose_to_${affliction.name.replace(/[^\w]+/g, "_")}`;
  return `\n\`\`\`${label}\nexposeToAffliction(${JSON.stringify(affliction)});\n\`\`\``;
}

// The initial save, for the selected tokens
function exposeToAffliction(affliction) {
  rollSavingThrow(affliction.save, affliction.dc, {
    traits: affliction.traits,
    affliction: { mode: "initial", affliction },
  });
}

// The creature's afflictions (list rows: { _id, name, data })
function getCreatureAfflictions(creature) {
  const list = creature?.data?.afflictions || creature?.record?.data?.afflictions;
  return Array.isArray(list) ? list : [];
}

// The values that write the list
function getAfflictionListValues(list) {
  return { "data.afflictions": list };
}

function writeAfflictions(creature, list) {
  api.setValuesOnTokenById(creature._id, creature.recordType || "tokens", getAfflictionListValues(list));
}

function newAfflictionEntry(affliction, stage) {
  const onsetLeft = affliction.onset?.counted ? affliction.onset.rounds : 0;
  return {
    _id: `aff-${toSlug(affliction.name)}-${Date.now().toString(36)}`,
    name: affliction.name,
    recordType: "records",
    identified: true,
    data: {
      ...affliction,
      stage,
      appliedStage: 0,
      onsetLeft,
      roundsLeft: 0,
      elapsed: 0,
      successes: 0,
      treatBonus: 0,
      tickRound: null,
    },
  };
}

function findAfflictionEntry(list, affliction) {
  const name = `${affliction?.name || ""}`.toLowerCase();
  return list.find((entry) => `${entry.name || ""}`.toLowerCase() === name) || null;
}

// What a failed initial save does to the creature: a new affliction, a
// poison's stage raised (re-exposure keeps its maximum duration and onset),
// or nothing for a curse or disease it already has. { list, entry, apply,
// line }
function getAfflictionExposure(list, affliction, startStage) {
  const existing = findAfflictionEntry(list, affliction);
  if (existing) {
    if (affliction.kind !== "poison") {
      return { list, entry: existing, apply: false, line: `Already has ${affliction.name}: no effect.` };
    }
    const max = existing.data.stages.length;
    const stage = Math.min(max, existing.data.stage + startStage);
    const entry = { ...existing, data: { ...existing.data, stage } };
    const pending = existing.data.onsetLeft > 0 || (existing.data.onset && existing.data.appliedStage === 0);
    return {
      list: list.map((e) => (e._id === existing._id ? entry : e)),
      entry,
      apply: !pending,
      line: `${affliction.name} again: stage ${stage}${pending ? " after its onset" : ""}.`,
    };
  }
  const entry = newAfflictionEntry(affliction, startStage);
  const onset = !!affliction.onset;
  return {
    list: [...list, entry],
    entry,
    apply: !onset,
    line: onset
      ? `${affliction.name}: stage ${startStage} after its onset (${describeAfflictionTime(affliction.onset)}).`
      : `${affliction.name}: stage ${startStage}.`,
  };
}

// The Apply button of a failed initial save
function afflictCreature(token, affliction, startStage) {
  const fresh = findSceneToken(token._id) || token;
  const { list, entry, apply, line } = getAfflictionExposure(getCreatureAfflictions(fresh), affliction, startStage);
  if (!apply) {
    writeAfflictions(fresh, list);
    api.sendMessage(`**${getCreatureName(fresh)}:** ${line}`, undefined, [], [], fresh);
    return;
  }
  setAfflictionStage(fresh, entry._id, entry.data.stage, { list, line });
}

// ---------------------------------------------------------------- Stages

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

// Removes, then adds, in one chain, so the effect writes don't overlap
function applyAfflictionConditions(token, changes) {
  const names = [];
  let sent = false;
  const addStacks = (name) => (stacks) => {
    const list = Array(Math.max(0, stacks)).fill(name);
    if (!list.length) return;
    // A gain confirmed after the chain (immunity's Apply Anyway) adds alone
    if (sent) api.addEffects(list, token);
    else names.push(...list);
  };
  const removals = changes.remove
    .map(({ name, value }) => ({ condition: getTokenCondition(token, name), value }))
    .filter(({ condition }) => condition);
  const finish = () => {
    changes.add.forEach(({ name, value }) => names.push(...Array(value).fill(name)));
    changes.gain.forEach(({ name, value }) => addConditionGain(token, name, value, addStacks(name)));
    sent = true;
    if (names.length) api.addEffects(names, token);
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
    const label = `Roll_${formula.replace(/[^\w]+/g, "_")}`;
    return `\`\`\`${label}\nexecuteDamageMacro(${JSON.stringify(formula)}, "standard", ${JSON.stringify(`${name}: ${formula}`)});\n\`\`\``;
  });
}

// The values and message for moving an affliction to a stage (below 1:
// cured). Pure: { list, changes, message }.
function getAfflictionStageValues(creature, list, entryId, stage, line = "") {
  const entry = list.find((e) => e._id === entryId);
  if (!entry) return null;
  const data = entry.data;
  const max = data.stages.length;
  const target = Math.min(max, stage);
  const fromConditions = data.appliedStage > 0 ? data.stages[data.appliedStage - 1]?.conditions : [];
  const who = getCreatureName(creature);
  const lines = [];
  if (line) lines.push(line);
  if (target < 1) {
    const changes = getAfflictionConditionChanges(fromConditions, []);
    lines.unshift(`**${who}** recovers from **${entry.name}**.`);
    if (changes.kept.length) lines.push(`[gm]Kept: ${changes.kept.join(", ")} (they end on their own).[/gm]`);
    return { list: list.filter((e) => e._id !== entryId), changes, message: lines.join("\n") };
  }
  const stageData = data.stages[target - 1];
  const changes = getAfflictionConditionChanges(fromConditions, stageData.conditions);
  const interval = stageData.interval;
  const updated = {
    ...entry,
    data: {
      ...data,
      stage: target,
      appliedStage: target,
      onsetLeft: 0,
      roundsLeft: interval?.counted ? interval.rounds : 0,
    },
  };
  lines.unshift(`**${who}: ${entry.name}, stage ${target}${stage > max ? " (the highest, again)" : ""}**`, stageData.text);
  if (changes.kept.length) lines.push(`[gm]Kept: ${changes.kept.join(", ")} (they end on their own).[/gm]`);
  lines.push(...getAfflictionDamageButtons(entry.name, stageData));
  return { list: list.map((e) => (e._id === entryId ? updated : e)), changes, message: lines.join("\n") };
}

// Moves an affliction to a stage: one write of the list, the conditions
// swapped, and the stage's card with its damage
function setAfflictionStage(creature, entryId, stage, { list, line } = {}) {
  const values = getAfflictionStageValues(creature, list || getCreatureAfflictions(creature), entryId, stage, line);
  if (!values) return;
  writeAfflictions(creature, values.list);
  applyAfflictionConditions(creature, values.changes);
  api.sendMessage(values.message, undefined, [], [], creature);
}

// ---------------------------------------------------------------- Saves

// A stage's save (an interval's end): its treatment bonus goes on this
// save, and is cleared when the result is applied (resolveAfflictionSave),
// so a cancelled roll keeps it
function rollAfflictionSave(creature, entryId) {
  const list = getCreatureAfflictions(creature);
  const entry = list.find((e) => e._id === entryId);
  if (!entry) return;
  const data = entry.data;
  const bonus = parseInt(data.treatBonus, 10) || 0;
  rollSave(creature, data.save, data.dc, false, true, {
    traits: data.traits,
    affliction: { mode: "stage", entryId, name: entry.name, stage: data.stage, max: data.stages.length, virulent: !!data.virulent, successes: data.successes || 0 },
    extraModifiers: bonus
      ? [{ name: bonus > 0 ? "Treated (circumstance)" : "Treatment failed (circumstance)", type: "circumstance", value: bonus, active: true }]
      : [],
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
    if (degree >= 1) return [`**${affliction.name}:** unaffected.`];
    const stage = Math.min(affliction.stages.length, degree === -1 ? 2 : 1);
    return [
      `**${affliction.name}:** stage ${stage}${affliction.onset ? ` after its onset (${describeAfflictionTime(affliction.onset)})` : ""}.`,
      getChatButton(`Apply_${affliction.name.replace(/[^\w]+/g, "_")}`, saver, `afflictCreature(token, ${JSON.stringify(affliction)}, ${stage})`),
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
    getChatButton(`Apply_${info.name.replace(/[^\w]+/g, "_")}`, saver, `resolveAfflictionSave(token, ${JSON.stringify(info.entryId)}, ${degree})`),
  ];
}

// The stage save's Apply button: from the affliction as it is now
function resolveAfflictionSave(token, entryId, degree) {
  const fresh = findSceneToken(token._id) || token;
  const list = getCreatureAfflictions(fresh);
  const entry = list.find((e) => e._id === entryId);
  if (!entry) {
    api.showNotification("That affliction is gone.", "yellow", "Afflictions");
    return;
  }
  const change = getAfflictionSaveChange({ ...entry.data, max: entry.data.stages.length }, degree);
  // The save's treatment bonus is used up now
  const withSuccesses = list.map((e) => (e._id === entryId ? { ...e, data: { ...e.data, successes: change.successes, treatBonus: 0 } } : e));
  if (change.stage === entry.data.stage && !change.over) {
    // A virulent success that doesn't reach a stage: the count and the next
    // interval only, no stage card (damage comes on reaching a stage)
    const interval = entry.data.stages[entry.data.stage - 1]?.interval;
    writeAfflictions(fresh, withSuccesses.map((e) => (e._id === entryId ? { ...e, data: { ...e.data, roundsLeft: interval?.counted ? interval.rounds : 0 } } : e)));
    api.sendMessage(`**${getCreatureName(fresh)}: ${entry.name}** stays at stage ${entry.data.stage} (virulent: ${change.successes} of 2 successes).`, undefined, [], [], fresh);
    return;
  }
  setAfflictionStage(fresh, entryId, change.stage, { list: withSuccesses });
}

// ---------------------------------------------------------------- Turn end

// The turn end's countdown, once a round: onsets, intervals and maximum
// durations kept in rounds. Pure: { list, changed, messages }.
function getAfflictionTurnEnd(creature, list, round) {
  const messages = [];
  let changed = false;
  const next = list.map((entry) => {
    const data = { ...entry.data };
    if (round !== null && round !== undefined && data.tickRound === round) return entry;
    // Over its maximum duration: the End button was posted once
    if (data.maxDuration?.counted && (data.elapsed || 0) >= data.maxDuration.rounds) return entry;
    data.tickRound = round ?? null;
    changed = true;
    if (data.maxDuration?.counted) {
      data.elapsed = (data.elapsed || 0) + 1;
      if (data.elapsed >= data.maxDuration.rounds) {
        messages.push([
          `**${getCreatureName(creature)}: ${entry.name}** reaches its maximum duration (${describeAfflictionTime(data.maxDuration)}) and ends.`,
          getChatButton(`End_${entry.name.replace(/[^\w]+/g, "_")}`, creature, `setAfflictionStage(token, ${JSON.stringify(entry._id)}, 0)`),
        ].join("\n"));
        return { ...entry, data };
      }
    }
    if (data.onsetLeft > 0) {
      data.onsetLeft -= 1;
      if (data.onsetLeft === 0) {
        messages.push([
          `**${getCreatureName(creature)}: ${entry.name}**'s onset is over: stage ${data.stage}.`,
          getChatButton(`Apply_Stage_${data.stage}`, creature, `setAfflictionStage(token, ${JSON.stringify(entry._id)}, ${data.stage})`),
        ].join("\n"));
      }
    } else if (data.roundsLeft > 0) {
      data.roundsLeft -= 1;
      if (data.roundsLeft === 0) {
        messages.push([
          `**${getCreatureName(creature)}: ${entry.name}**, stage ${data.stage}: the interval is over.`,
          getChatButton(`Roll_${capitalize(data.save)}`, creature, `rollAfflictionSave(token, ${JSON.stringify(entry._id)})`),
        ].join("\n"));
      }
    }
    return { ...entry, data };
  });
  return { list: next, changed, messages };
}

function runAfflictionTurnEnd(creature, round) {
  const list = getCreatureAfflictions(creature);
  if (!list.length) return;
  const result = getAfflictionTurnEnd(creature, list, round);
  if (result.changed) writeAfflictions(creature, result.list);
  result.messages.forEach((message) => api.sendMessage(message, undefined, [], [], creature));
}

// ---------------------------------------------------------------- Treatment

// Treat Poison and Treat Disease (Medicine): the bonus to the
// patient's next save against them. Critical success +4, success +2,
// critical failure -2.
const AFFLICTION_TREATMENTS = { "treat poison": "poison", "treat disease": "disease" };

function getAfflictionTreatmentBonus(degree) {
  return { 2: 4, 1: 2, 0: 0, "-1": -2 }[degree] || 0;
}

// The result line of a Treat Poison or Treat Disease check (skill.js)
function getAfflictionTreatmentLines(metadata, degree) {
  const kind = AFFLICTION_TREATMENTS[`${metadata?.action || ""}`.toLowerCase()];
  if (!kind || degree === null || degree === undefined) return [];
  const bonus = getAfflictionTreatmentBonus(degree);
  if (!bonus) return [`**${metadata.action}:** no bonus.`];
  return [
    `**${metadata.action}:** ${bonus > 0 ? "+" : ""}${bonus} circumstance ${bonus > 0 ? "bonus" : "penalty"} to the patient's next save against its ${kind}.`,
    `\`\`\`Apply_Treatment\napplyAfflictionTreatment(${JSON.stringify(kind)}, ${bonus});\n\`\`\``,
  ];
}

// The Apply_Treatment button: the patient's afflictions of that kind, on
// the selected or dropped token
function applyAfflictionTreatment(kind, bonus) {
  const tokens = (api.getSelectedOrDroppedToken() || []).map((t) => t?.token || t);
  if (!tokens.length) {
    api.showNotification("Select the patient's token.", "yellow", "Afflictions");
    return;
  }
  tokens.forEach((token) => {
    const list = getCreatureAfflictions(token);
    if (!list.some((e) => e.data?.kind === kind)) {
      api.showNotification(`${getCreatureName(token)} has no ${kind}.`, "yellow", "Afflictions");
      return;
    }
    writeAfflictions(token, list.map((e) => (e.data?.kind === kind ? { ...e, data: { ...e.data, treatBonus: bonus } } : e)));
  });
}
