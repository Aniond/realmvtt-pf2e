// Tests for afflictions (afflictions.js, roadmap B4): parsing a poison or
// ability, exposure, stage saves, conditions per stage, the turn end's
// countdown, and treatment.

const fs = require("fs");
const { createSandbox } = require("./sandbox");
const { assert, assertIncludes, section, summary } = require("./test-helpers");

const ctx = createSandbox();

const link = (value, text, type = "macro") =>
  `<record-link recordlink="${JSON.stringify({ value, tooltip: text, type }).replace(/"/g, "&quot;")}">${text}</record-link>`;
const save = (type, dc) => link({ type: "macro", code: `rollSavingThrow('${type}', ${dc});`, name: `${type} Save (DC ${dc})` }, `Fortitude Save (DC ${dc})`);
const dmg = (formula) => link({ type: "macro", code: `executeDamageMacro('${formula}', 'standard', '${formula} Damage')` }, `${formula} Damage`);
const effect = (name) => link({ _id: `e-${name}`, name, recordType: "effects" }, name, "effects");

// Black Adder Venom (GM Core), as the module prints it
const BLACK_ADDER = [
  "<p>Adder venom is a simple but effective way to enhance a weapon.</p>",
  `<p><strong>Saving Throw</strong> ${save("fortitude", 18)}</p>`,
  "<p><strong>Maximum Duration</strong> 3 rounds</p>",
  `<p><strong>Stage 1</strong> ${dmg("1d4 poison")} damage (1 round)</p>`,
  `<p><strong>Stage 2</strong> ${dmg("1d6 poison")} damage (1 round)</p>`,
  `<p><strong>Stage 3</strong> ${dmg("1d8 poison")} damage (1 round)</p>`,
].join("\n");

// Giant Centipede Venom (Monster Core): conditions as effect links
const CENTIPEDE = [
  `<p><strong>Saving Throw</strong> ${save("fortitude", 14)}</p>`,
  "<hr />",
  "<p><strong>Maximum Duration</strong> 6 rounds</p>",
  `<p><strong>Stage 1</strong> ${dmg("1d4 poison")} damage (1 round)</p>`,
  `<p><strong>Stage 2</strong> ${dmg("1d4 poison")} damage and ${effect("Off-Guard")} (1 round)</p>`,
  `<p><strong>Stage 3</strong> ${dmg("1d4 poison")} damage, ${effect("Clumsy 1")}, and ${effect("Fatigued")} (1 round)</p>`,
].join("\n");

// A disease written as plain text, with an onset in days
const DISEASE = [
  "<p><strong>Saving Throw</strong> DC 20 Fortitude</p>",
  "<p><strong>Onset</strong> 1 day</p>",
  "<p><strong>Stage 1</strong> carrier with no ill effect (1 day)</p>",
  "<p><strong>Stage 2</strong> enfeebled 1 (1 day)</p>",
  "<p><strong>Stage 3</strong> enfeebled 2 and drained 1 (1 day)</p>",
].join("\n");

section("Parsing: a poison item");
{
  const a = ctx.parseAffliction(BLACK_ADDER, { name: "Black Adder Venom", traits: ["Alchemical", "Injury", "Poison"], level: 2 });
  assert("the save", [a.save, a.dc], ["fortitude", 18]);
  assert("a poison", [a.kind, a.virulent, a.traits], ["poison", false, ["poison"]]);
  assert("maximum duration in rounds", [a.maxDuration.rounds, a.maxDuration.counted], [3, true]);
  assert("three stages", a.stages.length, 3);
  assert("damage from the links", a.stages.map((s) => s.damage), [["1d4 poison"], ["1d6 poison"], ["1d8 poison"]]);
  assert("the interval", [a.stages[0].interval.value, a.stages[0].interval.unit, a.stages[0].interval.rounds], [1, "round", 1]);
  assert("no onset", a.onset, null);
  assert("not an affliction", ctx.parseAffliction("<p>A potion.</p>", { name: "Potion" }), null);
}

section("Parsing: an ability's conditions");
{
  const a = ctx.parseAffliction(CENTIPEDE, { name: "Giant Centipede Venom", traits: ["Common", "Poison"] });
  assert("stage 2: off-guard", a.stages[1].conditions, [{ name: "Off-Guard", value: 1 }]);
  assert("stage 3: clumsy 1 and fatigued", a.stages[2].conditions, [{ name: "Clumsy", value: 1 }, { name: "Fatigued", value: 1 }]);
  assertIncludes("the stage's text", a.stages[2].text, "Clumsy 1, and Fatigued (1 round)");
}

section("Parsing: plain text, onset, days, virulent");
{
  const a = ctx.parseAffliction(DISEASE, { name: "Filth Fever", traits: ["Disease", "Virulent"] });
  assert("the save from text", [a.save, a.dc], ["fortitude", 20]);
  assert("a disease, virulent", [a.kind, a.virulent], ["disease", true]);
  assert("onset in days: not counted", [a.onset.unit, a.onset.counted], ["day", false]);
  assert("conditions from text", a.stages[2].conditions, [{ name: "Drained", value: 1 }, { name: "Enfeebled", value: 2 }]);
  assert("the time", [ctx.parseAfflictionTime("10 minutes").rounds, ctx.parseAfflictionTime("1d4 hours")], [100, null]);
}

section("Expose: the item's and ability's button");
{
  const button = ctx.getAfflictionExposeButton({ name: "Black Adder Venom", data: { description: BLACK_ADDER, traits: ["Poison"], level: 2 } });
  assertIncludes("a button", button, "```Expose_to_Black_Adder_Venom\nexposeToAffliction(");
  assert("none without one", ctx.getAfflictionExposeButton({ name: "Rope", data: { description: "<p>Rope.</p>" } }), "");
}

const adder = ctx.parseAffliction(BLACK_ADDER, { name: "Black Adder Venom", traits: ["Poison"], level: 2 });
const centipede = ctx.parseAffliction(CENTIPEDE, { name: "Giant Centipede Venom", traits: ["Poison"] });
const fever = ctx.parseAffliction(DISEASE, { name: "Filth Fever", traits: ["Disease", "Virulent"] });

section("The initial save's result");
{
  const meta = (degree) => ctx.getAfflictionSaveLines({ saverTokenId: "pc", affliction: { mode: "initial", affliction: adder, tokenName: "Valeros" } }, degree);
  assert("success: unaffected, no button", meta(1), ["**Black Adder Venom:** unaffected."]);
  assertIncludes("failure: stage 1", meta(0)[0], "stage 1.");
  assertIncludes("... its button on the saver's token", meta(0)[1], 'withChatButtonToken("pc", "Valeros"');
  assertIncludes("critical failure: stage 2", meta(-1)[0], "stage 2.");
  assertIncludes("onset: after it", ctx.getAfflictionSaveLines({ saverTokenId: "pc", affliction: { mode: "initial", affliction: fever } }, 0)[0], "stage 1 after its onset (1 day)");
  assert("no affliction: nothing", ctx.getAfflictionSaveLines({ saverTokenId: "pc" }, 0), []);
}

section("Exposure: new, again, and a disease again");
{
  const first = ctx.getAfflictionExposure([], adder, 1);
  assert("a new entry, applied", [first.list.length, first.entry.data.stage, first.apply], [1, 1, true]);
  const applied = first.list.map((e) => ({ ...e, data: { ...e.data, appliedStage: 1, elapsed: 2 } }));
  const again = ctx.getAfflictionExposure(applied, adder, 2);
  assert("a poison again: +2 stages, capped, duration kept", [again.entry.data.stage, again.entry.data.elapsed, again.apply], [3, 2, true]);
  const sick = ctx.getAfflictionExposure([], fever, 1);
  assert("onset: not applied yet", [sick.apply, sick.entry.data.onsetLeft], [false, 0]);
  const sickAgain = ctx.getAfflictionExposure(sick.list, fever, 2);
  assert("a disease again: no effect", [sickAgain.apply, sickAgain.line], [false, "Already has Filth Fever: no effect."]);
  const timed = ctx.getAfflictionExposure([], { ...adder, onset: ctx.parseAfflictionTime("1 minute") }, 1);
  assert("onset in minutes: counted in rounds", timed.entry.data.onsetLeft, 10);
}

section("Stage saves");
{
  const change = (state, degree) => ctx.getAfflictionSaveChange({ max: 3, successes: 0, virulent: false, ...state }, degree);
  assert("success: -1", change({ stage: 2 }, 1).stage, 1);
  assert("critical success: -2, cured below 1", change({ stage: 1 }, 2).stage, -1);
  assert("failure: +1", change({ stage: 1 }, 0).stage, 2);
  assert("critical failure: +2, capped", [change({ stage: 2 }, -1).stage, change({ stage: 2 }, -1).over], [3, true]);
  assert("virulent: one success stays", [change({ stage: 2, virulent: true }, 1).stage, change({ stage: 2, virulent: true }, 1).successes], [2, 1]);
  assert("virulent: the second success -1", [change({ stage: 2, virulent: true, successes: 1 }, 1).stage, change({ stage: 2, virulent: true, successes: 1 }, 1).successes], [1, 0]);
  assert("virulent: a critical success only -1", change({ stage: 2, virulent: true }, 2).stage, 1);
  assert("virulent: a failure resets", change({ stage: 2, virulent: true, successes: 1 }, 0).successes, 0);

  const lines = ctx.getAfflictionSaveLines({ saverTokenId: "pc", affliction: { mode: "stage", entryId: "a1", name: "Filth Fever", stage: 2, max: 3, virulent: true, successes: 0, tokenName: "Valeros" } }, 1);
  assertIncludes("virulent: what's left", lines[0], "stays at stage 2 (virulent: 1 of 2 successes)");
  assertIncludes("the Apply button", lines[1], 'resolveAfflictionSave(token, "a1", 1)');
}

section("Conditions per stage");
{
  const changes = ctx.getAfflictionConditionChanges(centipede.stages[1].conditions, centipede.stages[2].conditions);
  assert("off-guard goes", changes.remove, [{ name: "Off-Guard", value: 1 }]);
  assert("clumsy and fatigued come", changes.gain, [{ name: "Clumsy", value: 1 }, { name: "Fatigued", value: 1 }]);
  const down = ctx.getAfflictionConditionChanges(centipede.stages[2].conditions, centipede.stages[1].conditions);
  assert("going down: clumsy goes, fatigued stays (it ends on its own)", [down.remove, down.kept], [[{ name: "Clumsy", value: 1 }], ["Fatigued"]]);
  const up = ctx.getAfflictionConditionChanges([{ name: "Enfeebled", value: 1 }], [{ name: "Enfeebled", value: 2 }, { name: "Drained", value: 1 }]);
  assert("enfeebled 1 to 2: one more", [up.add, up.gain], [[{ name: "Enfeebled", value: 1 }], [{ name: "Drained", value: 1 }]]);
  const cured = ctx.getAfflictionConditionChanges(fever.stages[2].conditions, []);
  assert("cured: enfeebled goes, drained stays", [cured.remove, cured.kept], [[{ name: "Enfeebled", value: 2 }], ["Drained"]]);
}

section("Moving to a stage");
{
  const pc = { _id: "pc", name: "Valeros", recordType: "characters" };
  const { list } = ctx.getAfflictionExposure([], centipede, 2);
  const id = list[0]._id;
  const two = ctx.getAfflictionStageValues(pc, list, id, 2);
  assert("stage 2, applied, its interval", [two.list[0].data.stage, two.list[0].data.appliedStage, two.list[0].data.roundsLeft], [2, 2, 1]);
  assertIncludes("the card", two.message, "**Valeros: Giant Centipede Venom, stage 2**");
  assertIncludes("its damage button", two.message, 'executeDamageMacro("1d4 poison", "standard", "Giant Centipede Venom: 1d4 poison")');
  assert("off-guard gained", two.changes.gain, [{ name: "Off-Guard", value: 1 }]);
  const over = ctx.getAfflictionStageValues(pc, two.list, id, 5);
  assertIncludes("past the highest: the highest again", over.message, "stage 3 (the highest, again)");
  const gone = ctx.getAfflictionStageValues(pc, two.list, id, 0);
  assert("cured: removed", gone.list, []);
  assertIncludes("... posted", gone.message, "**Valeros** recovers from **Giant Centipede Venom**.");
  assert("... its conditions go", gone.changes.remove, [{ name: "Off-Guard", value: 1 }]);
  const values = ctx.getAfflictionListValues(two.list);
  assert("token data only, no sheet field", Object.keys(values), ["data.afflictions"]);
}

section("Applying: one write, removals before additions");
{
  const calls = [];
  ctx.api.setValuesOnTokenById = (id, type, values) => calls.push(["write", id, Object.keys(values)]);
  ctx.api.deductEffectById = (effectId, token, cb) => {
    calls.push(["deduct", effectId]);
    cb();
  };
  ctx.api.addEffects = (names) => calls.push(["add", names]);
  ctx.__state.messages.length = 0;
  const { list } = ctx.getAfflictionExposure([], centipede, 2);
  const id = list[0]._id;
  const pc = {
    _id: "pc", name: "Valeros", recordType: "characters",
    effects: [{ _id: "og", name: "Off-Guard" }], effectIds: ["og"], effectValues: {},
    data: { afflictions: list.map((e) => ({ ...e, data: { ...e.data, appliedStage: 2 } })) },
  };
  ctx.setAfflictionStage(pc, id, 3);
  assert("the list once, off-guard off, then clumsy and fatigued on", calls, [
    ["write", "pc", ["data.afflictions"]],
    ["deduct", "og"],
    ["add", ["Clumsy", "Fatigued"]],
  ]);
  assertIncludes("the card posted", ctx.__state.messages[0], "stage 3");
}

section("Turn end: the countdown, once a round");
{
  const pc = { _id: "pc", name: "Valeros", recordType: "characters" };
  const { list } = ctx.getAfflictionExposure([], adder, 1);
  const applied = ctx.getAfflictionStageValues(pc, list, list[0]._id, 1).list;
  const r1 = ctx.getAfflictionTurnEnd(pc, applied, 1);
  assert("the interval's over", [r1.list[0].data.roundsLeft, r1.list[0].data.elapsed], [0, 1]);
  assertIncludes("a Save button", r1.messages[0], 'rollAfflictionSave(token, "' + list[0]._id + '")');
  const again = ctx.getAfflictionTurnEnd(pc, r1.list, 1);
  assert("the same round again: nothing", [again.changed, again.messages], [false, []]);
  let state = r1.list;
  state = ctx.getAfflictionTurnEnd(pc, state, 2).list;
  const r3 = ctx.getAfflictionTurnEnd(pc, state, 3);
  assertIncludes("the maximum duration: End", r3.messages[0], "reaches its maximum duration (3 rounds) and ends.");
  assertIncludes("... its button", r3.messages[0], "setAfflictionStage(token");
  assert("... once", ctx.getAfflictionTurnEnd(pc, r3.list, 4).messages, []);

  const timed = ctx.getAfflictionExposure([], { ...adder, onset: ctx.parseAfflictionTime("2 rounds") }, 1).list;
  const o1 = ctx.getAfflictionTurnEnd(pc, timed, 1);
  assert("onset counting", [o1.list[0].data.onsetLeft, o1.messages], [1, []]);
  assertIncludes("onset over: Apply", ctx.getAfflictionTurnEnd(pc, o1.list, 2).messages[0], "onset is over: stage 1.");
  const days = ctx.getAfflictionExposure([], fever, 1).list;
  assert("a day's onset: not counted", ctx.getAfflictionTurnEnd(pc, days, 1).messages, []);
}

section("The stage save's Apply: from the affliction as it is now");
{
  const writes = [];
  ctx.api.setValuesOnTokenById = (id, type, values) => writes.push(values);
  ctx.api.addEffects = () => {};
  const pc = { _id: "pc", name: "Valeros", recordType: "characters", effects: [], effectIds: [] };
  const { list } = ctx.getAfflictionExposure([], adder, 1);
  pc.data = { afflictions: ctx.getAfflictionStageValues(pc, list, list[0]._id, 1).list };
  ctx.api.getToken = () => pc;
  ctx.__state.messages.length = 0;
  ctx.resolveAfflictionSave(pc, list[0]._id, 0);
  assert("failure: stage 2", writes[0]["data.afflictions"][0].data.stage, 2);
  writes.length = 0;
  ctx.resolveAfflictionSave(pc, list[0]._id, 2);
  assert("critical success from 1: recovered", writes[0]["data.afflictions"], []);
}

section("Rolling a stage save: the treatment bonus once");
{
  const writes = [];
  let meta = null;
  let mods = null;
  ctx.api.setValuesOnTokenById = (id, type, values) => writes.push(values);
  ctx.api.promptRollForToken = (rec, name, dice, modifiers, metadata) => {
    mods = modifiers;
    meta = metadata;
  };
  const pc = { _id: "pc", name: "Valeros", recordType: "characters", data: { fortitudeMod: 7 } };
  const { list } = ctx.getAfflictionExposure([], adder, 2);
  pc.data.afflictions = list.map((e) => ({ ...e, data: { ...e.data, treatBonus: 2 } }));
  ctx.rollAfflictionSave(pc, list[0]._id);
  assert("the save's affliction", [meta.affliction.mode, meta.affliction.stage, meta.dc], ["stage", 2, 18]);
  assert("the bonus as a modifier", mods.some((m) => m.type === "circumstance" && m.value === 2), true);
  assert("... kept until the result is applied (a cancelled roll keeps it)", writes, []);

  ctx.api.addEffects = () => {};
  ctx.api.getToken = () => pc;
  ctx.resolveAfflictionSave(pc, list[0]._id, 1);
  assert("... cleared when it is", writes[0]["data.afflictions"][0].data.treatBonus, 0);
}

section("A virulent success that doesn't reach a stage");
{
  const writes = [];
  ctx.api.setValuesOnTokenById = (id, type, values) => writes.push(values);
  const pc = { _id: "pc", name: "Valeros", recordType: "characters", effects: [], effectIds: [] };
  const virulentAdder = { ...adder, virulent: true };
  const { list } = ctx.getAfflictionExposure([], virulentAdder, 2);
  pc.data = { afflictions: ctx.getAfflictionStageValues(pc, list, list[0]._id, 2).list.map((e) => ({ ...e, data: { ...e.data, roundsLeft: 0 } })) };
  ctx.api.getToken = () => pc;
  ctx.__state.messages.length = 0;
  ctx.resolveAfflictionSave(pc, list[0]._id, 1);
  const entry = writes[0]["data.afflictions"][0].data;
  assert("the count and the next interval", [entry.stage, entry.successes, entry.roundsLeft], [2, 1, 1]);
  assert("no stage card or damage", ctx.__state.messages.some((m) => m.includes("executeDamageMacro")), false);
  assertIncludes("a short line", ctx.__state.messages[0], "stays at stage 2 (virulent: 1 of 2 successes)");
}

section("Stunned is kept on a stage change");
{
  const changes = ctx.getAfflictionConditionChanges([{ name: "Stunned", value: 1 }], []);
  assert("kept", [changes.remove, changes.kept], [[], ["Stunned"]]);
}

section("Treat Poison and Treat Disease");
{
  const lines = ctx.getAfflictionTreatmentLines({ action: "Treat Poison" }, 2);
  assertIncludes("critical success: +4", lines[0], "+4 circumstance bonus to the patient's next save against its poison");
  assertIncludes("the button", lines[1], 'applyAfflictionTreatment("poison", 4)');
  assertIncludes("critical failure: -2", ctx.getAfflictionTreatmentLines({ action: "Treat Disease" }, -1)[0], "-2 circumstance penalty");
  assert("failure: no bonus", ctx.getAfflictionTreatmentLines({ action: "Treat Disease" }, 0), ["**Treat Disease:** no bonus."]);
  assert("another action: nothing", ctx.getAfflictionTreatmentLines({ action: "Treat Wounds" }, 1), []);

  const writes = [];
  ctx.api.setValuesOnTokenById = (id, type, values) => writes.push(values);
  const { list } = ctx.getAfflictionExposure([], adder, 1);
  const fevered = ctx.getAfflictionExposure(list, fever, 1).list;
  ctx.api.getSelectedOrDroppedToken = () => [{ _id: "pc", name: "Valeros", recordType: "characters", data: { afflictions: fevered } }];
  ctx.applyAfflictionTreatment("poison", 2);
  assert("only the poison", writes[0]["data.afflictions"].map((e) => e.data.treatBonus), [2, 0]);
  ctx.api.getSelectedOrDroppedToken = () => [];
}

section("The hooks");
{
  const read = (f) => fs.readFileSync(`${__dirname}/../rollhandlers/${f}`, "utf8");
  assertIncludes("save.js", read("save.js"), "getAfflictionSaveLines(data?.roll?.metadata, noteDegree)");
  assertIncludes("skill.js", read("skill.js"), "getAfflictionTreatmentLines(data?.roll?.metadata, noteDegree)");
  assertIncludes("onTurnEnd.js", read("onTurnEnd.js"), "runAfflictionTurnEnd(token");
  assertIncludes("useInventoryItem", read("common.js"), "markdownDescription += getAfflictionExposeButton(item);");
  assertIncludes("useAction", read("common.js"), "${getAfflictionExposeButton(action)}");
}

summary();
