"use strict";

// Replays do not record losses directly. Reproduce the relevant unit actions
// and turn phases so discarded inventory, dead plants, and escaped animals can
// be counted, using already resolved market orders for the day-end shed space.

const CROPS = {
	WHEAT:      {first_yield_day: 2,  max_yield_day: 4,  max_yield: 6, ongoing: false},
	CARROT:     {first_yield_day: 2,  max_yield_day: 3,  max_yield: 4, ongoing: false},
	TOMATO:     {first_yield_day: 8,  max_yield_day: 8,  max_yield: 4, ongoing: true},
	STRAWBERRY: {first_yield_day: 10, max_yield_day: 10, max_yield: 4, ongoing: true},
	MELON:      {first_yield_day: 10, max_yield_day: 12, max_yield: 6, ongoing: false},
};

const ANIMALS = {
	GOOSE: {structure: "COOP", product: "EGG"},
	COW:   {structure: "PASTURE", product: "MILK"},
	SHEEP: {structure: "PASTURE", product: "WOOL"},
};

function clone(value) {
	return JSON.parse(JSON.stringify(value));
}

function python_int(value) {
	if (typeof value === "boolean") return value ? 1 : 0;
	if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : null;
	if (typeof value === "string" && /^\s*[+-]?\d+\s*$/.test(value)) return Number.parseInt(value, 10);
	return null;
}

function config_int(configuration, key, fallback) {
	let value = configuration && Object.prototype.hasOwnProperty.call(configuration, key) ? configuration[key] : fallback;
	let parsed = python_int(value);
	return parsed === null ? fallback : parsed;
}

function shed_count(shed) {
	return Object.values(shed).reduce((total, n) => total + n, 0);
}

function is_shed_adjacent(position, board_size) {
	let half = Math.floor(board_size / 2);
	let [x, y] = position;
	return (x === half - 1 || x === half) && (y === half - 1 || y === half);
}

function inventory(private_state, index) {
	while (private_state.inventories.length <= index) private_state.inventories.push({});
	return private_state.inventories[index];
}

function position(farm, index) {
	if (index === 0) return farm.farmer;
	return Array.isArray(farm.hands) && index - 1 < farm.hands.length ? farm.hands[index - 1] : null;
}

function add(inv, item, n = 1) {
	inv[item] = (inv[item] || 0) + n;
}

function take(inv, item, n = 1) {
	if ((inv[item] || 0) < n) return false;
	inv[item] -= n;
	if (inv[item] === 0) delete inv[item];
	return true;
}

function note_destroyed(destroyed, item, n) {
	if (n > 0) destroyed[item] = (destroyed[item] || 0) + n;
}

function drop_inventory(inv, shed, capacity, destroyed) {
	for (let [item, n] of Object.entries(inv)) {
		if (n <= 0) {
			delete inv[item];
			continue;
		}
		let room = Math.max(0, capacity - shed_count(shed));
		let stored = Math.min(n, room);
		if (stored > 0) shed[item] = (shed[item] || 0) + stored;
		note_destroyed(destroyed, item, n - stored);
		delete inv[item];
	}
}

function decay_plants(farm, step, destroyed) {
	for (let row of farm.tiles) {
		for (let index = 0; index < row.length; index++) {
			let tile = row[index];
			if (!tile || typeof tile !== "object" || tile.kind !== "PLANT") continue;
			let lifespan = tile.max_lifespan_step;
			if (typeof lifespan !== "number" || lifespan < 0 || step < lifespan || (step - lifespan) % 2 !== 0) continue;
			if (tile.yield_units > 0) note_destroyed(destroyed, tile.crop, 1);
			tile.yield_units -= 1;
			if (tile.yield_units <= 0) {
				row[index] = {kind: "WEED"};
			}
		}
	}
}

function end_of_day_losses(farm, destroyed) {
	for (let row of farm.tiles) {
		for (let index = 0; index < row.length; index++) {
			let tile = row[index];
			if (!tile || typeof tile !== "object") continue;
			if (tile.kind === "PLANT") {
				let unwatered = tile.watered_today ? 0 : (tile.consecutive_unwatered || 0) + 1;
				if (unwatered >= 2) {
					note_destroyed(destroyed, tile.crop, tile.yield_units || 0);
					row[index] = {kind: "WEED"};
				}
				continue;
			}
			if (Object.prototype.hasOwnProperty.call(tile, "animal")) {
				let unfed = tile.fed_today ? 0 : (tile.consecutive_unfed || 0) + 1;
				if (unfed >= 2) {
					note_destroyed(destroyed, tile.animal, 1);
					let animal = ANIMALS[tile.animal];
					if (animal) note_destroyed(destroyed, animal.product, tile.yield_units || 0);
					row[index] = {kind: ANIMALS[tile.animal].structure};
				}
			}
		}
	}
}

function new_plant(crop, day, turns_per_day) {
	let data = CROPS[crop];
	return {
		kind: "PLANT",
		crop,
		planted_day: day,
		watered_today: false,
		consecutive_unwatered: 1,
		yield_units: data.ongoing ? 0 : 1,
		max_lifespan_step: data.ongoing ? -1 : (day + data.max_yield_day + 1) * turns_per_day,
		fertilized_until_day: -1,
	};
}

function new_animal(animal, day) {
	return {
		kind: ANIMALS[animal].structure,
		animal,
		placed_day: day,
		yield_units: 0,
		consecutive_unfed: 0,
		fed_today: false,
		cared_today: false,
		fertilizer_available: false,
		pending_care_bonus: 0,
	};
}

function apply_unit_action(farm, private_state, index, action, context, destroyed) {
	if (!Array.isArray(action) || action.length === 0) return;
	let pos = position(farm, index);
	if (!Array.isArray(pos)) return;
	let [x, y] = pos;
	let inv = inventory(private_state, index);
	let op = action[0];

	// Movement and PASS cannot change this turn's carried items or shared shed.
	if (["NORTH", "SOUTH", "EAST", "WEST", "PASS"].includes(op)) return;

	let tile = farm.tiles[y][x];
	if (tile === "LOCKED") return;

	if (op === "DROP") {
		if (is_shed_adjacent(pos, context.board_size)) {
			drop_inventory(inv, private_state.shed, context.shed_capacity, destroyed);
		}
		return;
	}

	if (op === "PICKUP") {
		if (!is_shed_adjacent(pos, context.board_size) || action.length < 2) return;
		let n = action.length >= 3 ? python_int(action[2]) : 1;
		if (n === null || n <= 0) return;
		let item = action[1];
		n = Math.min(n, private_state.shed[item] || 0);
		if (n <= 0) return;
		private_state.shed[item] -= n;
		add(inv, item, n);
		return;
	}

	if (op === "PLANT") {
		if (action.length < 2 || !Object.prototype.hasOwnProperty.call(CROPS, action[1]) || tile !== null) return;
		let crop = action[1];
		if ((private_state.seeds[crop] || 0) <= 0) return;
		private_state.seeds[crop] -= 1;
		farm.tiles[y][x] = new_plant(crop, context.day, context.turns_per_day);
		return;
	}

	if (op === "WATER") {
		if (!tile || typeof tile !== "object" || tile.kind !== "PLANT" || tile.watered_today) return;
		tile.watered_today = true;
		let crop = CROPS[tile.crop];
		if (crop && !crop.ongoing) {
			let age = context.day - tile.planted_day;
			let window_start = Math.floor((crop.max_yield_day + 1) / 2);
			if (window_start <= age && age <= crop.max_yield_day) {
				let bonus = tile.fertilized_until_day >= context.day ? 2 : 1;
				tile.yield_units = Math.min(crop.max_yield, (tile.yield_units || 0) + bonus);
			}
		}
		return;
	}

	if (op === "HARVEST") {
		if (!tile || typeof tile !== "object" || (tile.yield_units || 0) <= 0) return;
		if (tile.kind === "PLANT") {
			let crop = CROPS[tile.crop];
			if (!crop || context.day - tile.planted_day < crop.first_yield_day) return;
			add(inv, tile.crop, tile.yield_units);
			tile.yield_units = 0;
			if (!crop.ongoing) farm.tiles[y][x] = null;
		} else if (Object.prototype.hasOwnProperty.call(tile, "animal") && ANIMALS[tile.animal]) {
			add(inv, ANIMALS[tile.animal].product, tile.yield_units);
			tile.yield_units = 0;
		}
		return;
	}

	if (op === "FERTILIZE") {
		if (!tile || typeof tile !== "object" || tile.kind !== "PLANT" || !take(inv, "FERTILIZER")) return;
		tile.fertilized_until_day = Math.max(tile.fertilized_until_day ?? -1, context.day + 2);
		return;
	}

	if (op === "DIG") {
		if (tile !== null && !(tile && typeof tile === "object" && Object.prototype.hasOwnProperty.call(tile, "animal"))) {
			if (tile && typeof tile === "object" && tile.kind === "PLANT") {
				note_destroyed(destroyed, tile.crop, tile.yield_units || 0);
			}
			farm.tiles[y][x] = null;
		}
		return;
	}

	if (op === "BUILD_COOP" || op === "BUILD_PASTURE") {
		if (tile === null) farm.tiles[y][x] = {kind: op === "BUILD_COOP" ? "COOP" : "PASTURE"};
		return;
	}

	if (op === "PLACE") {
		if (action.length < 2) return;
		let item = action[1];
		if (ANIMALS[item] && tile && typeof tile === "object" && tile.kind === ANIMALS[item].structure &&
				!Object.prototype.hasOwnProperty.call(tile, "animal")) {
			if (take(inv, item)) farm.tiles[y][x] = new_animal(item, context.day);
			return;
		}
		if (!is_shed_adjacent(pos, context.board_size)) return;
		let n = action.length >= 3 ? python_int(action[2]) : 1;
		if (n === null || n <= 0) return;
		n = Math.min(n, inv[item] || 0, Math.max(0, context.shed_capacity - shed_count(private_state.shed)));
		if (n <= 0) return;
		take(inv, item, n);
		private_state.shed[item] = (private_state.shed[item] || 0) + n;
		return;
	}

	if (op === "FEED") {
		if (tile && typeof tile === "object" && Object.prototype.hasOwnProperty.call(tile, "animal") && !tile.fed_today && take(inv, "WHEAT")) {
			tile.fed_today = true;
		}
		return;
	}

	if (op === "COLLECT_FERTILIZER") {
		if (tile && typeof tile === "object" && Object.prototype.hasOwnProperty.call(tile, "animal") && tile.fertilizer_available) {
			tile.fertilizer_available = false;
			add(inv, "FERTILIZER");
		}
		return;
	}

	if (op === "CARE" && tile && typeof tile === "object" && Object.prototype.hasOwnProperty.call(tile, "animal") && !tile.cared_today) {
		tile.cared_today = true;
	}
}

function apply_market_results(private_state, action, results) {
	let orders = action && Array.isArray(action.market) ? action.market : [];
	for (let index = 0; index < orders.length; index++) {
		let order = orders[index];
		let result = results[index];
		if (!Array.isArray(order) || !result || result.fulfilled <= 0) continue;
		let [op, item] = order;
		if (op === "SELL") {
			private_state.shed[item] = (private_state.shed[item] || 0) - result.fulfilled;
		} else if (op === "BUY_PRODUCT" || op === "BUY_ANIMAL") {
			private_state.shed[item] = (private_state.shed[item] || 0) + result.fulfilled;
		}
	}
}

function analyze_turn(input) {
	let configuration = input.configuration || {};
	let farm = clone(input.farm);
	let private_state = clone(input.private_state);
	let action = input.action && typeof input.action === "object" && !Array.isArray(input.action) ? input.action : {};
	let context = {
		board_size: config_int(configuration, "boardSize", 10),
		shed_capacity: config_int(configuration, "shedCapacity", 100),
		turns_per_day: Math.max(1, config_int(configuration, "turnsPerDay", 24)),
		day: input.day,
	};
	let destroyed = {};
	let farmer_action = action.farmer ?? ["PASS"];
	let hand_actions = Array.isArray(action.hands) ? action.hands : [];
	let unit_actions = [farmer_action].concat(hand_actions);

	// The runner atomically rejects every PLANT for a crop when this turn asks
	// for more seeds than the player owns.
	let plant_demand = {};
	for (let unit_action of unit_actions) {
		if (Array.isArray(unit_action) && unit_action.length >= 2 && unit_action[0] === "PLANT") {
			plant_demand[unit_action[1]] = (plant_demand[unit_action[1]] || 0) + 1;
		}
	}
	let blocked = new Set(Object.entries(plant_demand)
		.filter(([crop, n]) => n > (private_state.seeds[crop] || 0)).map(([crop]) => crop));

	for (let index = 0; index < unit_actions.length; index++) {
		let unit_action = unit_actions[index];
		if (Array.isArray(unit_action) && unit_action[0] === "PLANT" && blocked.has(unit_action[1])) unit_action = ["PASS"];
		apply_unit_action(farm, private_state, index, unit_action, context, destroyed);
	}

	apply_market_results(private_state, action, input.market_results || []);
	let step = input.day * context.turns_per_day + input.hour;
	decay_plants(farm, step, destroyed);

	if (input.hour + 1 === context.turns_per_day) {
		end_of_day_losses(farm, destroyed);
		for (let inv of private_state.inventories) {
			drop_inventory(inv, private_state.shed, context.shed_capacity, destroyed);
		}
	}

	return destroyed;
}

function precompute(replay) {
	let summaries = new Array(replay.length());
	let running = Array.from({length: replay.num_players()}, () => ({}));

	for (let i = 0; i < replay.length(); i++) {
		if (i > 0) {
			for (let pl = 0; pl < replay.num_players(); pl++) {
				let destroyed = analyze_turn({
					configuration: replay.r.configuration,
					farm: replay.r.steps[i - 1][0].observation.farms[pl],
					private_state: replay.r.steps[i - 1][pl].observation.private,
					action: replay.r.steps[i][pl].action,
					market_results: replay.next_market_results(i - 1)[pl] || [],
					day: replay.day(i - 1),
					hour: replay.hour(i - 1),
				});
				for (let [item, n] of Object.entries(destroyed)) {
					running[pl][item] = (running[pl][item] || 0) + n;
				}
			}
		}
		summaries[i] = running.map(items => Object.assign({}, items));
	}

	return summaries;
}

module.exports = {
	analyze_turn,
	precompute,
};
