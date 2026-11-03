// Tests for Drained's Hit Points (rollhandlers/dying.js, onEffectsChanged.js):
// lose level × drained HP when it goes up, the maximum follows the drained
// value, and a Constitution recompute keeps the maximum lowered.
// Run: node tests/test-drained.js   (or via tests/run-all.js)

(async () => {
  const fs = await import("node:fs");
  const vm = await import("node:vm");
  const { createSandbox } = await import("./sandbox.js");
  const { assert, section, summary } = await import("./test-helpers.js");

  const ctx = createSandbox();
  const DRAINED = { _id: "eDrained", name: "Drained" };

  const creature = (level, hitpoints, curhp, drained = 0) => ({
    _id: "c1",
    data: { level, hitpoints, curhp },
    effects: drained > 0 ? [DRAINED] : [],
    effectIds: Array(drained).fill(DRAINED._id),
  });
  const change = (oldCount, newCount) => [
    { effectId: DRAINED._id, name: "Drained", oldCount, newCount, effect: DRAINED },
  ];
  const updates = (record, changes) =>
    JSON.parse(JSON.stringify(ctx.getDrainedHitPointUpdates(record, changes)));

  section("Gaining drained");
  assert(
    "drained 3 at level 3 loses 9 HP and 9 maximum",
    updates(creature(3, 45, 45, 3), change(0, 3)),
    { "data.hitpoints": 36, "data.curhp": 36 },
  );
  assert(
    "drained 1 → 2 at level 5 loses 5 more",
    updates(creature(5, 70, 40, 2), change(1, 2)),
    { "data.hitpoints": 65, "data.curhp": 35 },
  );
  assert(
    "level 0 and below count as level 1",
    updates(creature(-1, 10, 10, 1), change(0, 1)),
    { "data.hitpoints": 9, "data.curhp": 9 },
  );
  assert(
    "Hit Points stop at 0",
    updates(creature(4, 50, 3, 2), change(0, 2)),
    { "data.hitpoints": 42, "data.curhp": 0 },
  );

  section("Losing drained");
  assert(
    "a night's rest (drained 2 → 1) raises the maximum but not current HP",
    updates(creature(3, 39, 20, 1), change(2, 1)),
    { "data.hitpoints": 42 },
  );
  assert(
    "removing drained 1 restores the maximum only",
    updates(creature(3, 42, 30, 0), change(1, 0)),
    { "data.hitpoints": 45 },
  );

  section("Other effects");
  assert(
    "a change that isn't drained writes nothing",
    updates(creature(3, 45, 45), [{ effectId: "x", name: "Frightened", oldCount: 0, newCount: 1 }]),
    {},
  );

  section("Effect names");
  const named = (name) => [{ effectId: "eX", name, oldCount: 0, newCount: 1 }];
  for (const name of ["Drained", "Drained 2", "Drained (Vampire Bite)", "drained"]) {
    assert(
      `"${name}" counts as drained`,
      updates(creature(3, 45, 45), named(name)),
      { "data.hitpoints": 42, "data.curhp": 42 },
    );
  }
  assert(
    "a name that only contains drained doesn't count",
    updates(creature(3, 45, 45), named("Life Drained")),
    {},
  );
  const drainedTwo = { _id: "eD2", name: "Drained 2" };
  assert(
    "a \"Drained 2\" effect stacked twice lowers the maximum by 2 × level",
    ctx.getDrainedMaxHpReduction({
      data: { level: 3 },
      effects: [drainedTwo],
      effectIds: [drainedTwo._id, drainedTwo._id],
    }),
    6,
  );

  section("onEffectsChanged script");
  const script = fs.readFileSync(__dirname + "/../rollhandlers/onEffectsChanged.js", "utf8");
  ctx.__hookRecord = creature(3, 45, 45, 1);
  ctx.__hookData = { before: creature(3, 45, 45), changes: change(0, 1) };
  const result = new vm.Script(
    `(function (record, data) {\n${script}\n})(__hookRecord, __hookData)`,
  ).runInContext(ctx);
  assert("returns the drained writes", JSON.parse(JSON.stringify(result)), {
    "data.hitpoints": 42,
    "data.curhp": 42,
  });

  section("Constitution recompute");
  assert(
    "drained 2 at level 3 lowers the maximum by 6",
    ctx.getDrainedMaxHpReduction(creature(3, 0, 0, 2)),
    6,
  );
  const character = {
    ...creature(3, 0, 30, 2),
    data: {
      level: 3,
      curhp: 30,
      ancestries: [{ data: { hp: 8 } }],
      classes: [{ data: { hp: 10 } }],
    },
  };
  const values = {};
  ctx.updateAttribute({ record: character, attribute: "con", value: 2, moreValuesToSet: values });
  assert("maximum is 8 + (2 + 10) × 3 − 6", values["data.hitpoints"], 38);

  process.exitCode = summary();
})();
