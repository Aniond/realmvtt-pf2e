// Tests for the shield gaps (armor-traits.js, applyDamage, the attack card)
// and shield Strikes (getShieldWeapon).
// Run: node tests/test-shields.js   (or via tests/run-all.js)

const { createSandbox } = require("./sandbox");
const { assert, assertIncludes, assertNotIncludes, section, summary } = require("./test-helpers");

const ctx = createSandbox();

const steelShield = (hp = 20, traits = ["Common"]) => ({
  _id: "sh1",
  name: "Steel Shield",
  data: { type: "shield", carried: "equipped", acBonus: 2, hardness: 5, hp: { value: hp, max: 20 }, traits },
});
const shieldBlockFeat = { name: "Shield Block", data: { type: "feat" } };
const pc = (data) => ({ _id: "tok-pc", recordType: "characters", name: "Valeros", identified: true, record: { name: "Valeros" }, effects: [], data: { curhp: 40, hitpoints: 40, feats: [shieldBlockFeat], ...data } });
const npc = (data) => ({ _id: "tok-npc", recordType: "npcs", name: "Guard", identified: true, record: { name: "Guard" }, effects: [], data: { curhp: 30, hitpoints: 30, ...data } });

section("Shield Block: who can");
{
  assert("a character with the feat", ctx.hasShieldBlock(pc({})), true);
  assert("... without it", ctx.hasShieldBlock(pc({ feats: [] })), false);
  assert("an NPC with the ability", ctx.hasShieldBlock(npc({ actions: [{ name: "Shield Block" }] })), true);
  assert("... without it", ctx.hasShieldBlock(npc({ actions: [{ name: "Attack of Opportunity" }] })), false);
  const raised = { inventory: [steelShield()], shieldRaised: "true" };
  assert("raised, not broken, with Shield Block", ctx.canShieldBlock(pc(raised)), true);
  assert("not raised", ctx.canShieldBlock(pc({ ...raised, shieldRaised: "false" })), false);
  assert("broken: can't (a broken item can't be used)", ctx.canShieldBlock(pc({ ...raised, shieldBroken: true })), false);
  assert("no Shield Block", ctx.canShieldBlock(pc({ ...raised, feats: [] })), false);
  assert("no creature", ctx.canShieldBlock(null), false);
}

section("Hefty");
{
  assert("the number", [ctx.getShieldHefty(["Common", "Hefty-2"]), ctx.getShieldHefty(["Hefty 3"]), ctx.getShieldHefty(["Common"])], [2, 3, null]);
  const fortress = { inventory: [steelShield(20, ["Common", "Hefty-2"])] };
  assert("Strength under it: 2 actions", ctx.getRaiseShieldNote(pc({ ...fortress, str: 1 })), "Hefty 2: raising it takes 2 actions (Strength +1, under +2).");
  assert("Strength meets it: nothing", ctx.getRaiseShieldNote(pc({ ...fortress, str: 2 })), "");
  assert("not hefty: nothing", ctx.getRaiseShieldNote(pc({ inventory: [steelShield()], str: 0 })), "");
}

section("Broken follows the equipped shield");
{
  // What the sheet's recalculation writes
  const recalc = (data) => {
    const saved = ctx.api.setValuesOnRecord;
    const written = {};
    ctx.api.setValuesOnRecord = (rec, values) => Object.assign(written, values);
    try {
      ctx.updateAllAttributes(pc(data));
    } finally {
      ctx.api.setValuesOnRecord = saved;
    }
    return written;
  };
  assert("at the Broken Threshold: broken", recalc({ inventory: [steelShield(10)] })["data.shieldBroken"], true);
  const fresh = recalc({ inventory: [steelShield(20)], shieldBroken: true, shieldRaised: "true" });
  assert("a fresh shield in place of a broken one: not broken", fresh["data.shieldBroken"], false);
  const lowered = recalc({ inventory: [steelShield(20)], shieldBroken: true, shieldRaised: "false" });
  assert("... and raising it gives its AC", fresh["data.ac"] - lowered["data.ac"], 2);
  assert("no shield: not broken", recalc({ inventory: [], shieldBroken: true })["data.shieldBroken"], false);
  const noHp = { _id: "sh2", name: "Homebrew Shield", data: { type: "shield", carried: "equipped", acBonus: 2 } };
  assert("a shield with no Hit Points filled in: not broken", recalc({ inventory: [noHp], shieldBroken: true })["data.shieldBroken"], false);
  assert("unchanged: not written", "data.shieldBroken" in recalc({ inventory: [steelShield(20)] }), false);
}

section("Shield Block damage: broken, destroyed");
{
  let sets = [];
  ctx.api.setValuesOnTokenById = (id, type, values, cb) => {
    sets.push(values);
    if (cb) cb();
  };
  const hit = (amount) => ({ total: amount, types: [{ type: "bludgeoning", value: amount }], metadata: { damageType: "bludgeoning" } });
  const block = (shieldHp, amount) => {
    sets = [];
    ctx.__state.messages = [];
    const target = pc({ inventory: [steelShield(shieldHp)], shieldRaised: "true", shieldHp });
    ctx.applyDamage(target, hit(amount), false, null, true);
    return { message: ctx.__state.messages.join("\n"), values: Object.assign({}, ...sets) };
  };

  const broken = block(20, 15);
  assert("15 against Hardness 5: the shield takes 10, broken", [broken.values["data.inventory.0.data.hp.value"], broken.values["data.shieldBroken"]], [10, true]);
  assertIncludes("... the card says so", broken.message, "Shield is now BROKEN!");
  assert("... still raised", broken.values["data.shieldRaised"], undefined);

  const destroyed = block(8, 20);
  assert("to 0: destroyed, and lowered", [destroyed.values["data.inventory.0.data.hp.value"], destroyed.values["data.shieldRaised"]], [0, "false"]);
  assertIncludes("... the card says so", destroyed.message, "Shield is DESTROYED!");
  assertNotIncludes("... not also broken", destroyed.message, "now BROKEN");
}

section("Shield Strikes");
{
  const shieldItem = (name, traits, extra = {}) => ({
    _id: `sh-${name}`,
    name,
    recordType: "items",
    data: { type: "shield", carried: "equipped", acBonus: 2, hardness: 5, hp: { value: 20, max: 20 }, traits, ...extra },
  });
  const steel = shieldItem("Steel Shield", ["Common"]);
  const klar = shieldItem("Klar", ["Common", "Integrated-1d6-S-Versatile-P"]);
  const razorDisc = shieldItem("Razor Disc", ["Common", "Integrated-1d6-S", "Shield-Throw-20"]);
  const meteor = shieldItem("Meteor Shield", ["Common", "Shield-Throw-30"]);
  const fortress = shieldItem("Fortress Shield", ["Common", "Hefty-2"]);

  const bash = ctx.getShieldWeapon(steel);
  assert(
    "a shield: a martial weapon in the shield group, 1d4 bludgeoning, one hand",
    [bash.data.type, bash.data.itemCategory, bash.data.group, bash.data.damage, bash.data.usage],
    ["weapon", "Martial", "Shield", { dice: 1, die: "d4", damageType: "bludgeoning" }, "held-in-one-hand"],
  );
  assert("... the shield's _id and name, nothing new to write", [bash._id, bash.name, bash.data.hp.value], ["sh-Steel Shield", "Steel Shield", 20]);
  assert("integrated: its damage, and versatile", [ctx.getShieldWeapon(klar).data.damage, ctx.getShieldWeapon(klar).data.traits], [{ dice: 1, die: "d6", damageType: "slashing" }, ["Common", "Versatile-P"]]);
  assert("Shield Throw 20 as Thrown 20", ctx.getShieldWeapon(razorDisc).data.traits, ["Common", "Thrown-20"]);
  assert("hefty isn't a weapon trait", ctx.getShieldWeapon(fortress).data.traits, ["Common"]);
  assert("not a shield: null", [ctx.getShieldWeapon({ data: { type: "weapon" } }), ctx.getShieldWeapon(null)], [null, null]);

  const record = (inventory) => ({ _id: "pc", recordType: "characters", name: "Valeros", effects: [], effectIds: [], fields: {}, data: { level: 5, str: 4, dex: 1, ancestries: [], classes: [], feats: [], bonusFeats: [], inventory } });
  const strike = (item, damage = false, data = {}) => {
    const rec = record([item]);
    Object.assign(rec.data, data);
    const saved = { getToken: ctx.api.getToken, promptRoll: ctx.api.promptRoll, setValues: ctx.api.setValues, roll: ctx.api.roll, showNotification: ctx.api.showNotification };
    let captured = null;
    const written = {};
    const notes = [];
    let recalculates = false;
    ctx.api.getToken = () => ({ _id: "tok", recordType: "characters", recordId: "pc", record: rec, data: rec.data });
    ctx.api.promptRoll = (name, dice, modifiers, metadata) => (captured = { name, dice, metadata: metadata || {} });
    ctx.api.roll = (dice, metadata) => (captured = { dice, metadata: metadata || {} });
    ctx.api.setValues = (values, callback) => {
      Object.assign(written, values);
      if (callback) recalculates = true;
    };
    ctx.api.showNotification = (text) => notes.push(text);
    try {
      if (damage) ctx.performDamageRoll(rec, item, "data.inventory.0", false);
      else ctx.performAttackRoll(rec, item, "data.inventory.0", 1);
    } finally {
      Object.assign(ctx.api, saved);
    }
    return { metadata: {}, ...(captured || {}), rolled: !!captured, written, notes, recalculates };
  };
  const attack = strike(steel);
  assert("a shield bash: 1d4 bludgeoning, the shield group, Strength to damage", [attack.metadata.damage, attack.metadata.weaponGroup, attack.metadata.damageModifiers.map((m) => [m.name, m.value])], ["1d4 bludgeoning", "Shield", [["Strength", 4]]]);
  assertIncludes("the damage roll: 1d4", JSON.stringify(strike(steel, true)), "1d4");
  assert("a klar: 1d6 slashing", strike(klar).metadata.damage, "1d6 slashing");
  assert("... piercing when the versatile box is ticked", strike({ ...klar, data: { ...klar.data, versatilePiercing: true } }).metadata.damageType, "piercing");
  const thrown = strike({ ...meteor, data: { ...meteor.data, rangeToggleBtn: "ranged" } }, false, { shieldRaised: "true" });
  assert("a Meteor Shield thrown: ranged, with no ammunition to count", [thrown.rolled, thrown.metadata.isRanged, thrown.notes], [true, true, []]);
  assert(
    "... it's dropped and lowered, not counted down",
    [thrown.written["data.inventory.0.data.carried"], thrown.written["data.shieldRaised"], "data.inventory.0.data.ammo" in thrown.written, "data.inventory.0.data.count" in thrown.written],
    ["dropped", "false", false, false],
  );
  assert("... and the sheet recalculates, so its AC goes", thrown.recalculates, true);
  const melee = strike(meteor, false, { shieldRaised: "true" });
  assert("a bash: the shield stays, raised", [melee.written["data.inventory.0.data.carried"], melee.written["data.shieldRaised"], melee.recalculates], [undefined, undefined, false]);

  const broken = strike({ ...steel, data: { ...steel.data, hp: { value: 10, max: 20 } } });
  assert("a broken shield can't Strike", [broken.rolled, broken.notes], [false, ["Steel Shield is broken: it can't be used to Strike."]]);
  assert("... above the Broken Threshold it can", strike({ ...steel, data: { ...steel.data, hp: { value: 11, max: 20 } } }).rolled, true);
  assert(
    "the threshold: half the max; no max, not broken",
    [ctx.isShieldBroken({ value: 10, max: 20 }), ctx.isShieldBroken({ value: 11, max: 20 }), ctx.isShieldBroken({ value: 0, max: 0 }), ctx.isShieldBroken(undefined)],
    [true, false, false, false],
  );

  const stowed = ctx.getShieldCarriedValues(record([steel]), steel, "data.inventory.0", "carried");
  assert("stowing one from its row: carried", stowed["data.inventory.0.data.carried"], "carried");
  assert("... lowered only if raised", [ctx.getShieldCarriedValues({ data: { shieldRaised: "true", inventory: [steel] } }, steel, "data.inventory.0", "dropped")["data.shieldRaised"], stowed["data.shieldRaised"]], ["false", undefined]);

  const fields = ctx.getItemFields(meteor);
  assert("its row: no hand choice, the thrown toggle, no ammunition", [fields.handBtn.hidden, fields.rangeToggleBtn.hidden, fields.ammoFields.hidden, fields.ammo.hidden], [true, false, true, true]);
  assert("a klar's row: the versatile boxes", [ctx.getItemFields(klar).versatilePiercing.hidden, ctx.getItemFields(klar).versatileSlashing.hidden], [false, false]);
  const values = {};
  ctx.setItemFields({ ...steel, fields: { handBtn: { hidden: false } } }, "data.inventory.0", values);
  assert("equipping one hides the hand choice", values["data.inventory.0.fields.handBtn.hidden"], true);
  const meteorValues = {};
  ctx.setItemFields(meteor, "data.inventory.0", meteorValues);
  assert("... and a thrown one sets up no ammunition", ["data.inventory.0.data.ammo" in meteorValues, "data.inventory.0.fields.ammoFields.hidden" in meteorValues], [false, false]);

  const config = require("../ruleset.config.json");
  const list = config.records.find((r) => r.type === "shield_attack_list");
  assert(
    "the sheet's list: equipped shields, on the attack row",
    [list?.tabs?.[0]?.file, list?.filterCriteria?.map((f) => [f.field, f.operator, f.value])],
    ["attack-list.html", [["type", "equals", "shield"], ["carried", "equals", "equipped"]]],
  );
}

process.exitCode = summary() > 0 ? 1 : 0;
