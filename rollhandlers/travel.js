// Travel and the environment (roadmap B5, B6) on the GM Tools panel
// (gm-tools-panel.html):
//
//   - Hexploration (GM Core pg. 207): the day, the activities left from the
//     party's slowest Speed, Travel and Reconnoiter by terrain (progress
//     carries over to the next activity or day), a forced march, and the
//     day's random encounter flat check by region
//   - Travel time (Player Core pg. 438): days and hours for a distance at
//     the party's Speed, by terrain
//   - Weather (GM Core pg. 95): the GM's pick of temperature, precipitation,
//     fog and wind, and what they do (fatigue during travel, temperature
//     damage, circumstance penalties of -1 to -4 by severity)
//   - Environmental damage (GM Core pg. 90) and falling (Player Core
//     pg. 421): the damage, with roll buttons
//
// The panel's values are campaign variables, as the encounter builder's:
// each action writes its state and the meter the labels read. Nothing is
// applied to a creature without a click: the GM decides.

// ---------------------------------------------------------------- Hexploration

// A prompt's answer: one value, or the first of a list
const pick = (choice) => (Array.isArray(choice) ? choice[0] : choice);

const HEX_VARS = { state: "hexState", meter: "hexMeter" };

// Random encounter flat check DCs by region (GM Core Table 3-7)
const HEX_REGIONS = {
  aquatic: { label: "Aquatic", dc: 17 },
  arctic: { label: "Arctic", dc: 17 },
  desert: { label: "Desert", dc: 17 },
  forest: { label: "Forest", dc: 14 },
  mountain: { label: "Mountain", dc: 16 },
  plains: { label: "Plains", dc: 12 },
  swamp: { label: "Swamp", dc: 14 },
};

// Activities to Travel into or Reconnoiter a hex (GM Core pg. 207); a road
// makes Travel one step better
const HEX_TERRAIN = {
  open: { label: "Open", cost: 1 },
  difficult: { label: "Difficult", cost: 2 },
  greater: { label: "Greater difficult", cost: 3 },
};

// Random encounter type (Table 3-8), by 1d10
function getHexEncounterType(d10) {
  return d10 <= 5 ? "Harmless" : d10 <= 7 ? "Hazard" : "Creature";
}

// Activities per day by the slowest Speed (Table 3-6)
function getHexActivitiesPerDay(speed) {
  const s = parseInt(speed, 10) || 0;
  if (s <= 10) return 0.5;
  if (s <= 25) return 1;
  if (s <= 40) return 2;
  if (s <= 55) return 3;
  return 4;
}

function getCreatureSpeed(creature) {
  const speed = creature?.data?.speed;
  return parseInt(speed?.value ?? speed, 10) || 0;
}

// "2", "½", "1½"
function formatAmount(n) {
  const whole = Math.floor(n);
  const half = n - whole >= 0.5;
  return `${whole || (half ? "" : "0")}${half ? "½" : ""}`;
}

// "2 activities", "½ activity", "1½ activities"
function formatActivities(n) {
  return `${formatAmount(n)} activit${n > 0 && n <= 1 ? "y" : "ies"}`;
}

function getHexState() {
  const state = api.getCampaignVariable?.(HEX_VARS.state);
  return {
    day: 0,
    speed: 25,
    left: 0,
    region: "plains",
    road: false,
    flying: false,
    forcedMarch: false,
    task: null,
    last: "",
    ...(state && typeof state === "object" ? state : {}),
  };
}

// The panel's labels
function getHexMeter(state) {
  const perDay = getHexActivitiesPerDay(state.speed);
  const region = HEX_REGIONS[state.region] || HEX_REGIONS.plains;
  const extras = [state.road && "road or river", state.flying && "flying"].filter(Boolean);
  const task = state.task
    ? `${state.task.kind === "travel" ? "Travel" : "Reconnoiter"} (${HEX_TERRAIN[state.task.terrain]?.label.toLowerCase() || ""}${state.task.road ? ", road" : ""}): ${formatAmount(state.task.spent)} of ${formatActivities(state.task.cost)}`
    : "";
  return {
    dayLabel: state.day ? `Day ${state.day}` : "No day started",
    activitiesLabel: state.day ? `${formatActivities(state.left)} left` : "",
    detail: `Speed ${state.speed} ft (${formatActivities(perDay)} a day) · ${region.label}${extras.length ? `, ${extras.join(", ")}` : ""}${state.forcedMarch ? " · forced march" : ""}`,
    task,
    last: state.last || "",
  };
}

function writeHexState(state) {
  api.setCampaignVariable(HEX_VARS.state, state);
  api.setCampaignVariable(HEX_VARS.meter, getHexMeter(state));
}

// The day's encounter check: a flat check against the region's DC (-2 on a
// road or river, +3 flying). Critical success on 10 over or a natural 20
// (two encounters), failure on a natural 1 at best.
function getHexEncounterCheck(state, d20, d10s = []) {
  const region = HEX_REGIONS[state.region] || HEX_REGIONS.plains;
  const dc = region.dc - (state.road ? 2 : 0) + (state.flying ? 3 : 0);
  let degree = d20 >= dc + 10 ? 2 : d20 >= dc ? 1 : d20 <= dc - 10 ? -1 : 0;
  if (d20 === 20) degree = Math.min(2, degree + 1);
  if (d20 === 1) degree = Math.max(-1, degree - 1);
  const count = degree === 2 ? 2 : degree === 1 ? 1 : 0;
  const types = d10s.slice(0, count).map((d10) => `${getHexEncounterType(d10)} (${d10})`);
  return {
    dc,
    count,
    line: `Encounter check DC ${dc}: ${d20}. ${count === 0 ? "No random encounter." : `${count === 2 ? "Two random encounters" : "A random encounter"}: ${types.join(", ")}.`}`,
  };
}

// Start Day: the activities for the day (a forced march adds one Travel, or
// gives a full one at Speed 10 or less, and is the only activity), and its
// encounter check. A Speed of 10 or less has ½ an activity a day, which
// carries over in the task. A forced march's days aren't counted: the GM
// line gives each PC's safe days and the rule, and the GM applies fatigue.
// { state, gmLines, line }
function getStartDayValues(state, { forced = false, d20, d10s = [], party = [] } = {}) {
  const perDay = getHexActivitiesPerDay(state.speed);
  const day = state.day + 1;
  const left = forced ? (perDay < 1 ? 1 : perDay + 1) : perDay;
  const check = getHexEncounterCheck(state, d20, d10s);
  const gmLines = [check.line];
  if (forced) {
    // GM Core pg. 207: safe for days equal to the Constitution modifier
    // (minimum 1)
    const safe = party.map((member) => `${getCreatureName(member)} ${Math.max(1, parseInt(member?.data?.con, 10) || 0)}`);
    gmLines.push(`Forced march: only Travel today.${safe.length ? ` Safe days (Con modifier, minimum 1): ${safe.join(", ")}.` : ""} Each forced march day past that makes the character fatigued until an entire day of downtime resting, and there's no forced march while anyone is fatigued.`);
  }
  const next = { ...state, day, left, forcedMarch: forced, last: check.line };
  return {
    state: next,
    gmLines,
    line: `**Day ${day}** of travel: ${formatActivities(left)}${forced ? " (forced march)" : ""}.`,
  };
}

function startHexDay(forced = false) {
  const roll = (sides) => 1 + Math.floor(Math.random() * sides);
  const finish = (party) => {
    const values = getStartDayValues(getHexState(), { forced, d20: roll(20), d10s: [roll(10), roll(10)], party });
    writeHexState(values.state);
    api.sendMessage([values.line, ...values.gmLines.map((line) => `[gm]${line}[/gm]`)].join("\n"));
  };
  if (forced && typeof api.getParty === "function") {
    api.getParty((party) => finish((party || []).filter((m) => m?.recordType === "characters")));
  } else finish([]);
}

// Travel or Reconnoiter: spends the day's activities on the hex's cost;
// what isn't finished carries over. { state, line }
function getHexActivityValues(state, kind, terrain, road = false) {
  if (!(state.left > 0)) {
    return { state, line: "No activities left today: start the next day." };
  }
  // GM Core pg. 207: on a forced march, Travel is the only activity
  if (kind === "reconnoiter" && state.forcedMarch) {
    return { state, line: "Forced march: Travel is the only activity today." };
  }
  const continuing = state.task && state.task.kind === kind;
  // A task of the other kind is dropped, and the card says so
  const dropped = state.task && !continuing
    ? `The unfinished ${state.task.kind === "travel" ? "Travel" : "Reconnoiter"} (${formatAmount(state.task.spent)} of ${formatActivities(state.task.cost)}) is dropped. `
    : "";
  const base = HEX_TERRAIN[terrain] || HEX_TERRAIN.open;
  const cost = kind === "travel" && road ? Math.max(1, base.cost - 1) : base.cost;
  const task = continuing ? { ...state.task } : { kind, terrain, road: kind === "travel" && !!road, cost, spent: 0 };
  const spend = Math.min(state.left, task.cost - task.spent);
  task.spent += spend;
  const left = state.left - spend;
  const name = kind === "travel" ? "Travel" : "Reconnoiter";
  let line;
  let nextTask = task;
  if (task.spent >= task.cost) {
    nextTask = null;
    line = kind === "travel" ? "The party Travels into the next hex." : "The party Reconnoiters the hex: they can Map the Area.";
  } else {
    line = `${name}: ${formatAmount(task.spent)} of ${formatActivities(task.cost)}; it continues with the next activity.`;
  }
  line = `${dropped}${line}`;
  return { state: { ...state, left, task: nextTask, last: line }, line: `**Hexploration:** ${line} ${formatActivities(left)} left today.` };
}

function promptHexActivity(kind) {
  const state = getHexState();
  if (kind === "reconnoiter" && state.forcedMarch) {
    api.showNotification("Forced march: Travel is the only activity today.", "yellow", "Hexploration");
    return;
  }
  const run = (terrain, road) => {
    const values = getHexActivityValues(getHexState(), kind, terrain, road);
    writeHexState(values.state);
    api.sendMessage(values.line);
  };
  // A task of the same kind carries on without asking
  if (state.task && state.task.kind === kind) {
    run(state.task.terrain, state.task.road);
    return;
  }
  const options = Object.entries(HEX_TERRAIN).flatMap(([value, t]) => [
    { label: `${t.label} (${t.cost})`, value },
    ...(kind === "travel" && t.cost > 1 ? [{ label: `${t.label}, on a road (${t.cost - 1})`, value: `${value}:road` }] : []),
  ]);
  api.showPrompt("Hexploration", `${kind === "travel" ? "Travel into" : "Reconnoiter"} which terrain?`, "Select...", options, null, (choice) => {
    const [terrain, road] = `${pick(choice) || ""}`.split(":");
    if (terrain) run(terrain, road === "road");
  }, "OK", "Cancel", 1);
}

// The region (its encounter DC) and whether the party is on a road or
// river, or flying
function promptHexRegion() {
  const options = Object.entries(HEX_REGIONS).flatMap(([value, r]) => [
    { label: `${r.label} (DC ${r.dc})`, value },
    { label: `${r.label}, road or river (DC ${r.dc - 2})`, value: `${value}:road` },
    { label: `${r.label}, flying (DC ${r.dc + 3})`, value: `${value}:flying` },
  ]);
  api.showPrompt("Hexploration", "Which region?", "Select...", options, null, (choice) => {
    const [region, extra] = `${pick(choice) || ""}`.split(":");
    if (!region) return;
    writeHexState({ ...getHexState(), region, road: extra === "road", flying: extra === "flying" });
  }, "OK", "Cancel", 1);
}

// The slowest Speed on the Party Sheet
function setHexSpeedFromParty() {
  api.getParty((party) => {
    const members = (party || []).filter((member) => getCreatureSpeed(member) > 0);
    if (!members.length) {
      api.showNotification("Open the Party Sheet from the View menu and drag the characters onto it.", "yellow", "Hexploration");
      return;
    }
    const slowest = members.reduce((a, b) => (getCreatureSpeed(b) < getCreatureSpeed(a) ? b : a));
    const speed = getCreatureSpeed(slowest);
    writeHexState({ ...getHexState(), speed });
    api.showNotification(`Party Speed ${speed} ft (slowest: ${getCreatureName(slowest)}): ${formatActivities(getHexActivitiesPerDay(speed))} a day.`, "green", "Hexploration");
  });
}

// The sections' onload: writes a meter only when it's missing or out of
// date, so opening the panel usually writes nothing
function loadTravelMeters() {
  const write = (name, meter) => {
    if (JSON.stringify(api.getCampaignVariable?.(name)) !== JSON.stringify(meter)) api.setCampaignVariable(name, meter);
  };
  write(HEX_VARS.meter, getHexMeter(getHexState()));
  write(WEATHER_VARS.meter, getWeatherMeter(getWeatherState()));
}

// ---------------------------------------------------------------- Travel time

// Days and hours for a distance at a Speed (Player Core pg. 438: a Speed's
// tenth in miles per hour, 8 hours a day), in open, difficult (½) and
// greater difficult (⅓) terrain
function getTravelTime(miles, speed) {
  const mph = (parseInt(speed, 10) || 0) / 10;
  if (!(mph > 0) || !(miles > 0)) return null;
  const row = (divisor, label) => {
    const hours = (miles * divisor) / mph;
    const days = Math.floor(hours / 8);
    const rest = Math.round((hours - days * 8) * 10) / 10;
    const parts = [days && `${days} day${days === 1 ? "" : "s"}`, rest && `${rest} hour${rest === 1 ? "" : "s"}`].filter(Boolean);
    return `${label}: ${parts.join(" ") || "under an hour"}`;
  };
  return {
    perDay: mph * 8,
    lines: [row(1, "Open"), row(2, "Difficult"), row(3, "Greater difficult")],
  };
}

function promptTravelTime() {
  api.showValuePrompt("Travel Time", "Miles", (value) => {
    const miles = parseFloat(value);
    const speed = getHexState().speed;
    const time = getTravelTime(miles, speed);
    if (!time) return;
    api.sendMessage(`**Travel time:** ${miles} miles at Speed ${speed} ft (${time.perDay} miles a day)\n${time.lines.join("\n")}`);
  });
}

// ---------------------------------------------------------------- Weather

const WEATHER_VARS = { state: "weatherState", meter: "weatherMeter" };

// Temperature (GM Core pg. 95): hours of travel before fatigue, and damage
const TEMPERATURES = {
  "incredible-cold": { label: "Incredible cold", range: "-80°F or colder", fatigue: 2, damage: { category: "moderate", type: "cold", every: "minute" } },
  "extreme-cold": { label: "Extreme cold", range: "-79°F to -20°F", fatigue: 4, damage: { category: "minor", type: "cold", every: "10 minutes" }, gear: "cold-weather gear makes it severe cold's" },
  "severe-cold": { label: "Severe cold", range: "-21°F to 12°F", fatigue: 4, damage: { category: "minor", type: "cold", every: "hour" }, gear: "cold-weather gear negates it" },
  "mild-cold": { label: "Mild cold", range: "13°F to 32°F", fatigue: 4 },
  normal: { label: "Normal", range: "33°F to 94°F", fatigue: 8 },
  "mild-heat": { label: "Mild heat", range: "95°F to 104°F", fatigue: 4 },
  "severe-heat": { label: "Severe heat", range: "105°F to 114°F", fatigue: 4, damage: { category: "minor", type: "fire", every: "hour" } },
  "extreme-heat": { label: "Extreme heat", range: "115°F to 139°F", fatigue: 4, damage: { category: "minor", type: "fire", every: "10 minutes" } },
  "incredible-heat": { label: "Incredible heat", range: "140°F or warmer", fatigue: 2, damage: { category: "moderate", type: "fire", every: "minute" } },
};
const TEMPERATURE_ORDER = Object.keys(TEMPERATURES);

// Precipitation, fog and wind by severity: the circumstance penalty (GM
// Core pg. 95: -1 to -4)
const WEATHER_LEVELS = ["none", "light", "moderate", "heavy", "severe"];

// Environmental damage (GM Core Table 10-11)
const ENVIRONMENTAL_DAMAGE = {
  minor: { label: "Minor", low: "1d6", high: "2d6" },
  moderate: { label: "Moderate", low: "4d6", high: "6d6" },
  major: { label: "Major", low: "8d6", high: "12d6" },
  massive: { label: "Massive", low: "16d6", high: "24d6" },
};

function getWeatherState() {
  const state = api.getCampaignVariable?.(WEATHER_VARS.state);
  return { temperature: "normal", precipitation: "none", fog: "none", wind: "none", ...(state && typeof state === "object" ? state : {}) };
}

function getWeatherPenalty(level) {
  return Math.max(0, WEATHER_LEVELS.indexOf(level));
}

// What the weather does: the panel's lines and the announcement
function getWeatherMeter(state) {
  const temperature = TEMPERATURES[state.temperature] || TEMPERATURES.normal;
  const precipitation = getWeatherPenalty(state.precipitation);
  const fog = getWeatherPenalty(state.fog);
  const wind = getWeatherPenalty(state.wind);
  const cold = state.temperature.endsWith("cold");
  const parts = [`${temperature.label} (${temperature.range})`];
  if (precipitation) parts.push(`${state.precipitation} precipitation`);
  if (fog) parts.push(`${state.fog} fog`);
  if (wind) parts.push(`${state.wind} wind`);
  // Heavier than drizzle or light snow: fatigue after 4 hours (GM Core
  // pg. 95)
  const fatigue = Math.min(temperature.fatigue, precipitation > 1 ? 4 : 8);
  const hurt = temperature.damage;
  const row = hurt && ENVIRONMENTAL_DAMAGE[hurt.category];
  const damage = hurt
    ? `${capitalize(hurt.category)} ${hurt.type} damage (${row.low}–${row.high}) every ${hurt.every}${temperature.gear ? `; ${temperature.gear}` : ""}.`
    : "";
  const effects = [];
  if (precipitation) {
    effects.push(`Precipitation: -${precipitation} circumstance penalty to visual Perception; rain douses flames${precipitation >= 3 ? "; distant creatures can be concealed" : ""}${cold && precipitation > 1 ? "; soaked characters treat the cold as one step colder" : ""}.`);
  }
  if (fog) {
    effects.push(`Fog: -${fog} circumstance penalty to visual Perception; it can conceal creatures seen through it.`);
  }
  if (wind) {
    effects.push(`Wind: -${wind} circumstance penalty to auditory Perception and physical ranged attacks; handheld flames go out; flying in it can be difficult or greater difficult terrain, and strong winds can call for Athletics to move.`);
  }
  return {
    summary: parts.join(", "),
    fatigue: `Overland travel: fatigued after ${fatigue} hours.`,
    damage,
    effects: [0, 1, 2].map((i) => effects[i] || ""),
  };
}

function writeWeather(state) {
  api.setCampaignVariable(WEATHER_VARS.state, state);
  api.setCampaignVariable(WEATHER_VARS.meter, getWeatherMeter(state));
}

// Set Weather: the temperature, then precipitation, fog and wind
function promptWeather() {
  const levels = WEATHER_LEVELS.map((level, i) => ({ label: i ? `${capitalize(level)} (-${i})` : "None", value: level }));
  const ask = (title, options, cb) =>
    api.showPrompt("Weather", title, "Select...", options, null, (choice) => {
      const value = pick(choice);
      if (value) cb(value);
    }, "OK", "Cancel", 1);
  ask("Temperature?", TEMPERATURE_ORDER.map((key) => ({ label: `${TEMPERATURES[key].label} (${TEMPERATURES[key].range})`, value: key })), (temperature) =>
    ask("Precipitation?", levels, (precipitation) =>
      ask("Fog?", levels, (fog) =>
        ask("Wind?", levels, (wind) => writeWeather({ temperature, precipitation, fog, wind })),
      ),
    ),
  );
}

// Announce: the weather for everyone
function announceWeather() {
  const meter = getWeatherMeter(getWeatherState());
  api.sendMessage([`**Weather:** ${meter.summary}.`, meter.fatigue, meter.damage, ...meter.effects].filter(Boolean).join("\n"));
}

function getDamageRollButton(formula, name) {
  return `\`\`\`Roll_${formula.replace(/[^\w]+/g, "_")}\nexecuteDamageMacro(${JSON.stringify(formula)}, "standard", ${JSON.stringify(name)});\n\`\`\``;
}

// The environmental damage of a category, low and high ends, as buttons
function getEnvironmentalDamageMessage(category, type, source) {
  const row = ENVIRONMENTAL_DAMAGE[category];
  if (!row) return "";
  return [
    `**${source}:** ${row.label.toLowerCase()} ${type} damage (${row.low}–${row.high}, GM Core Table 10-11).`,
    getDamageRollButton(`${row.low} ${type}`, `${source}: ${row.low} ${type}`),
    getDamageRollButton(`${row.high} ${type}`, `${source}: ${row.high} ${type}`),
  ].join("\n");
}

// Temperature Damage: the weather's
function postTemperatureDamage() {
  const temperature = TEMPERATURES[getWeatherState().temperature] || TEMPERATURES.normal;
  if (!temperature.damage) {
    api.showNotification(`${temperature.label} deals no damage.`, "yellow", "Weather");
    return;
  }
  api.sendMessage(getEnvironmentalDamageMessage(temperature.damage.category, temperature.damage.type, `${temperature.label}, every ${temperature.damage.every}`));
}

function promptEnvironmentalDamage() {
  const categories = Object.entries(ENVIRONMENTAL_DAMAGE).map(([value, row]) => ({ label: `${row.label} (${row.low}–${row.high})`, value }));
  const types = ["bludgeoning", "cold", "fire", "electricity", "acid", "poison", "sonic", "piercing", "slashing"].map((value) => ({ label: capitalize(value), value }));
  api.showPrompt("Environmental Damage", "How much?", "Select...", categories, null, (category) => {
    if (!pick(category)) return;
    api.showPrompt("Environmental Damage", "What kind?", "Select...", types, null, (type) => {
      if (pick(type)) api.sendMessage(getEnvironmentalDamageMessage(pick(category), pick(type), "Environmental damage"));
    }, "OK", "Cancel", 1);
  }, "OK", "Cancel", 1);
}

// ---------------------------------------------------------------- Falling

// Falling (Player Core pg. 421): half the distance in bludgeoning damage,
// for falls over 5 feet, up to 1,500 feet; water, snow or another soft
// surface counts 20 feet less (30 diving in), no more than its depth
function getFallDamage(distance, { soft = 0 } = {}) {
  const feet = Math.min(1500, Math.max(0, parseInt(distance, 10) || 0));
  const effective = Math.max(0, feet - Math.max(0, parseInt(soft, 10) || 0));
  return effective > 5 ? Math.floor(effective / 2) : 0;
}

function getFallMessage(distance, soft = 0) {
  const damage = getFallDamage(distance, { soft });
  const lines = [`**Falling ${distance} feet${soft ? ` (${soft} feet less for the soft landing, if it's that deep)` : ""}:** ${damage ? `${damage} bludgeoning damage, and lands prone.` : "no damage."}`];
  if (damage) {
    lines.push(getDamageRollButton(`${damage} bludgeoning`, `Falling ${distance} feet`));
    lines.push("```Apply_Prone\napplyEffect('Prone', 1);\n```");
    lines.push(`[gm]Grab an Edge or Arrest a Fall can lessen it. Landing on a creature: DC 15 Reflex (critical success none, success ${Math.floor(damage / 4)}, failure ${Math.floor(damage / 2)}, critical failure ${damage}).[/gm]`);
  }
  return lines.join("\n");
}

function promptFalling() {
  api.showValuePrompt("Falling", "Feet fallen", (value) => {
    const distance = parseInt(value, 10);
    if (!(distance > 0)) return;
    api.showPrompt("Falling", "Where does it land?", "Select...", [
      { label: "Solid ground", value: "0" },
      { label: "Water, snow or soft ground (-20 feet)", value: "20" },
      { label: "Diving into water (-30 feet)", value: "30" },
    ], null, (choice) => {
      api.sendMessage(getFallMessage(distance, parseInt(pick(choice), 10) || 0));
    }, "OK", "Cancel", 1);
  });
}
