// Tests for the Character Creation Wizard step files: the Level 1 Feats step
// script (run against common.js) and the labels that show long text.
// Class shapes mirror the Player Core module data (Rogue, Wizard).

const fs = require("fs");
const vm = require("vm");
const { createSandbox } = require("./sandbox");
const { assert, section, summary } = require("./test-helpers");

const readStep = (file) =>
  fs.readFileSync(`${__dirname}/../wizards/characters/${file}`, "utf8");

const ctx = createSandbox();

// The step's script shares common.js's scope, as in the wizard
const step6 = readStep("step6.html");
new vm.Script(step6.match(/<script>([\s\S]*?)<\/script>/)[1], {
  filename: "step6.html",
}).runInContext(ctx);
const featRows = new vm.Script("wizardFeatRows").runInContext(ctx);

const evenLevels = ["2", "4", "6", "8", "10", "12", "14", "16", "18", "20"];
const ancestryFeatLevels = ["1", "5", "9", "13", "17"];
const generalFeatLevels = ["3", "7", "11", "15", "19"];
const rogue = {
  name: "Rogue",
  data: {
    ancestryFeatLevels,
    classFeatLevels: ["1", ...evenLevels],
    skillFeatLevels: Array.from({ length: 20 }, (_, i) => `${i + 1}`),
    generalFeatLevels,
  },
};
const wizard = {
  name: "Wizard",
  data: { ancestryFeatLevels, classFeatLevels: evenLevels, skillFeatLevels: evenLevels, generalFeatLevels },
};

// A level 1 character with the feat slots the sheet makes on the Class drop
function character(classObj, extraFeats = []) {
  const record = { _id: "pc", data: { level: 1, classes: [classObj], feats: [] } };
  const valuesToSet = {};
  ctx.setFeatSlots(record, valuesToSet);
  record.data.feats = [...valuesToSet["data.feats"], ...extraFeats];
  return record;
}

const secondAncestrySlot = {
  _id: "paragon",
  name: "Ancestry Feat Slot",
  data: { type: "slot", featSlotType: "ancestry", level: 1, slotOrder: 9 },
};

// Runs the step's onload and returns the values it sets
function loadStep(record) {
  let values = {};
  ctx.record = record;
  ctx.api.setValues = (valuesToSet) => {
    values = valuesToSet;
  };
  ctx.wizardOnFeatsStepLoad();
  return values;
}

const shownRows = (values) =>
  featRows
    .filter((row) => values[`fields.${row.field}Row.hidden`] === false)
    .map((row) => row.field)
    .join(",");

section("Level 1 Feats rows");
{
  assert("rogue", shownRows(loadStep(character(rogue))), "ancestryFeat,classFeat,skillFeat");
  assert("wizard", shownRows(loadStep(character(wizard))), "ancestryFeat");

  const generalAtOne = { ...wizard, data: { ...wizard.data, generalFeatLevels: ["1", ...generalFeatLevels] } };
  assert("general feat at level 1", shownRows(loadStep(character(generalAtOne))), "ancestryFeat,generalFeat");

  const paragon = loadStep(character(wizard, [secondAncestrySlot]));
  assert("second ancestry slot", shownRows(paragon), "ancestryFeat,ancestryFeat2");

  const values = loadStep(character(rogue));
  assert("every row toggled", featRows.every((row) => `fields.${row.field}Row.hidden` in values), true);
  assert("empty slot has no name", values["data.wizard.skillFeatName"], "");

  const filled = character(rogue);
  const skillIndex = ctx.findFeatSlotIndex(filled.data.feats, "skill", 1);
  filled.data.feats[skillIndex] = ctx.buildFilledFeatSlot(filled.data.feats[skillIndex], {
    _id: "feat",
    name: "Trick Magic Item",
    data: { type: "skill", level: 1 },
  });
  assert("chosen feat shown", loadStep(filled)["data.wizard.skillFeatName"], "Trick Magic Item");

  // The background's skill feat is a bonus feat, not a slot
  const withBackgroundFeat = character(wizard);
  withBackgroundFeat.data.bonusFeats = [{ name: "Assurance", data: { type: "skill", level: 1 } }];
  assert("background feat adds no row", shownRows(loadStep(withBackgroundFeat)), "ancestryFeat");
}

section("choosing a feat");
{
  const feat = { _id: "feat", name: "Trick Magic Item", data: { type: "skill", level: 1 } };

  // Picks the given feat in the prompt and returns what was asked and set
  function choose(record, rowField) {
    const result = { prompt: null, values: null, notification: null };
    ctx.api.getRecord = (type, id, callback) => callback(record);
    ctx.api.showPrompt = (...args) => {
      result.prompt = args;
      args[5]([feat]);
    };
    ctx.api.showNotification = (message) => {
      result.notification = message;
    };
    ctx.api.setValues = (values) => {
      result.values = values;
    };
    ctx.wizardChooseFeat(rowField);
    return result;
  }

  const rogueRecord = character(rogue);
  const skillIndex = ctx.findFeatSlotIndex(rogueRecord.data.feats, "skill", 1);
  const skill = choose(rogueRecord, "skillFeat");
  assert("skill prompt title", skill.prompt[0], "Select a Skill Feat for Level 1");
  assert("skill feat query", skill.prompt[4].query["data.type"], "skill");
  const filledSlot = skill.values[`data.feats.${skillIndex}`];
  assert("skill slot filled", filledSlot?.name, "Trick Magic Item");
  assert("slot id kept", filledSlot?._id, rogueRecord.data.feats[skillIndex]._id);
  assert("slot type kept", filledSlot?.data.featSlotType, "skill");
  assert("name shown", skill.values["data.wizard.skillFeatName"], "Trick Magic Item");

  const paragonRecord = character(wizard, [secondAncestrySlot]);
  const paragonIndex = paragonRecord.data.feats.indexOf(secondAncestrySlot);
  const second = choose(paragonRecord, "ancestryFeat2");
  assert("ancestry prompt title", second.prompt[0], "Select an Ancestry Feat for Level 1");
  assert("second ancestry slot filled", second.values[`data.feats.${paragonIndex}`]?._id, "paragon");
  assert("first ancestry slot untouched", "data.feats.0" in second.values, false);
  assert("second name shown", second.values["data.wizard.ancestryFeat2Name"], "Trick Magic Item");

  const none = choose(character(wizard), "classFeat");
  assert("no slot: no prompt", none.prompt, null);
  assert("no slot: notified", none.notification, "Your character has no level 1 Class feat slot.");
}

section("Level 1 Feats markup");
{
  for (const row of featRows) {
    const box = step6.match(new RegExp(`<box field="${row.field}Row"([^>]*)>`));
    assert(`${row.field} row box`, !!box, true);
    assert(`${row.field} name field`, step6.includes(`field="${row.field}Name"`), true);
    assert(`${row.field} choose button`, step6.includes(`onclick="wizardChooseFeat('${row.field}')"`), true);
    // The first row runs the step's onload, so it must start visible
    const startsHidden = !!box && box[1].includes('hidden="true"');
    assert(`${row.field} starts ${row.field === "ancestryFeat" ? "visible" : "hidden"}`, startsHidden, row.field !== "ancestryFeat");
  }
}

section("long text uses wrapping labels");
{
  // A label's label attribute replaces its field value, so bound labels have none
  for (const [file, field, isError] of [
    ["step4.html", "ancestryInfo", false],
    ["step4.html", "boostError", true],
    ["step5.html", "skillInfo", false],
    ["step5.html", "languageInfo", false],
    ["step5.html", "skillsError", true],
    ["step7.html", "classKitInfo", false],
  ]) {
    const tag = readStep(file).match(new RegExp(`<(\\w+)\\b([^>]*)\\bfield="${field}"([^>]*)>`));
    const attributes = tag ? `${tag[2]} ${tag[3]}` : "";
    assert(`${field} is a label`, tag?.[1], "label");
    assert(`${field} has no label text`, /\blabel="/.test(attributes), false);
    if (isError) {
      assert(`${field} is red`, attributes.includes('color="red"'), true);
      assert(`${field} starts hidden`, attributes.includes('hidden="true"'), true);
    }
  }
}

process.exitCode = summary();
