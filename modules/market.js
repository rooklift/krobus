"use strict";

// This is a deliberately small port of the market resolver in kaggriculture.py.
// Replays contain submitted orders, but not their individual results. Resolving
// all players together is necessary because orders at the same queue position are
// fulfilled one unit at a time, with both players quoted before either unit commits.

const PRODUCTS = ["WHEAT", "CARROT", "TOMATO", "STRAWBERRY", "MELON", "EGG", "MILK", "WOOL", "FERTILIZER"];

const CROPS = {
	WHEAT:      {seed: 10},
	CARROT:     {seed: 20},
	TOMATO:     {seed: 50},
	STRAWBERRY: {seed: 100},
	MELON:      {seed: 80},
};

const ANIMALS = {
	GOOSE: {cost: 300, structure: "COOP"},
	COW:   {cost: 400, structure: "PASTURE"},
	SHEEP: {cost: 500, structure: "PASTURE"},
};

const MARKET_PARAMS = {
	WHEAT:      {base:  25, I0: 10000, T: 400, below_func: "sqrt",   below_target: 0.80, above_func: "log",    above_target: 0.20},
	CARROT:     {base:  35, I0: 10000, T: 450, below_func: "log",    below_target: 0.20, above_func: "sqrt",   above_target: 0.70},
	TOMATO:     {base:  60, I0: 10000, T: 200, below_func: "linear", below_target: 0.40, above_func: "sqrt",   above_target: 0.60},
	STRAWBERRY: {base: 120, I0: 10000, T: 100, below_func: "sqrt",   below_target: 0.70, above_func: "linear", above_target: 1.60},
	MELON:      {base: 250, I0: 10000, T: 300, below_func: "log",    below_target: 0.20, above_func: "sq",     above_target: 3.60},
	EGG:        {base:  50, I0: 10000, T: 332, below_func: "linear", below_target: 0.40, above_func: "log",    above_target: 0.20},
	MILK:       {base: 160, I0: 10000, T: 122, below_func: "sqrt",   below_target: 0.60, above_func: "linear", above_target: 1.60},
	WOOL:       {base: 200, I0: 10000, T: 105, below_func: "log",    below_target: 0.20, above_func: "sq",     above_target: 3.20},
	FERTILIZER: {base: 100, I0: 10000, T: 200, below_func: "linear", below_target: 0.40, above_func: "linear", above_target: 0.40},
};

const LAND_ORDER = ["NE", "SW", "SE"];
const LAND_PRICES = [1000, 2000, 4000];

function clone(value) {
	return JSON.parse(JSON.stringify(value));
}

function shape(func, x) {
	x = Math.max(0, x);
	if (func === "linear") return x;
	if (func === "sq") return x * x;
	if (func === "sqrt") return Math.sqrt(x);
	if (func === "log") return Math.log(1 + x);
	if (func === "log10") return Math.log10(1 + x);
	return x;
}

function python_round(x) {
	// Python rounds exact ties to even; JavaScript rounds them toward +infinity.
	let lower = Math.floor(x);
	let fraction = x - lower;
	if (fraction < 0.5) return lower;
	if (fraction > 0.5) return lower + 1;
	return lower % 2 === 0 ? lower : lower + 1;
}

function market_price(item, inventory, params = MARKET_PARAMS) {
	let p = params[item];
	let price;
	if (inventory < p.I0) {
		let amp = p.below_target * p.base / shape(p.below_func, p.T);
		price = p.base + amp * shape(p.below_func, p.I0 - inventory);
	} else {
		let amp = p.above_target * p.base / shape(p.above_func, p.T);
		price = p.base - amp * shape(p.above_func, inventory - p.I0);
	}
	return Math.max(1, python_round(price));
}

function refresh_prices(market) {
	let params = market.params || MARKET_PARAMS;
	for (let item of PRODUCTS) {
		market.prices[item] = market_price(item, market.inventory[item], params);
	}
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

function sum_values(object) {
	return Object.values(object).reduce((total, value) => total + value, 0);
}

function is_shed_adjacent(position, boardSize) {
	let half = Math.floor(boardSize / 2);
	let [x, y] = position;
	return (x === half - 1 || x === half) && (y === half - 1 || y === half);
}

function take(inventory, item, n) {
	if ((inventory[item] || 0) < n) return false;
	inventory[item] -= n;
	if (inventory[item] === 0) delete inventory[item];
	return true;
}

function apply_pre_market_unit_actions(farm, privateState, action, configuration) {
	// Unit actions run before the market. Only PICKUP/DROP/PLACE can alter the shed
	// contents seen by market orders (stock for SELL, room for buys), so only those
	// effects need reproducing here.
	let boardSize = config_int(configuration, "boardSize", 10);
	let shedCapacity = config_int(configuration, "shedCapacity", 100);
	let unitActions = [action.farmer].concat(Array.isArray(action.hands) ? action.hands : []);
	let positions = [farm.farmer].concat(Array.isArray(farm.hands) ? farm.hands : []);
	let inventories = privateState.inventories;

	for (let idx = 0; idx < unitActions.length && idx < positions.length; idx++) {
		let order = unitActions[idx];
		if (!Array.isArray(order) || order.length === 0 || !Array.isArray(positions[idx])) continue;
		let inv = inventories[idx] || (inventories[idx] = {});
		let position = positions[idx];
		let tile = farm.tiles && farm.tiles[position[1]] && farm.tiles[position[1]][position[0]];
		if (tile === "LOCKED") continue;

		if (order[0] === "DROP" && is_shed_adjacent(position, boardSize)) {
			for (let [item, n] of Object.entries(inv)) {
				if (n <= 0) {
					delete inv[item];
					continue;
				}
				let room = Math.max(0, shedCapacity - sum_values(privateState.shed));
				let amount = Math.min(n, room);
				if (amount > 0) privateState.shed[item] = (privateState.shed[item] || 0) + amount;
				delete inv[item];
			}
			continue;
		}

		if (order[0] === "PICKUP" && is_shed_adjacent(position, boardSize) && order.length >= 2) {
			let n = order.length >= 3 ? python_int(order[2]) : 1;
			if (n === null || n <= 0) continue;
			let item = order[1];
			n = Math.min(n, privateState.shed[item] || 0);
			if (n <= 0) continue;
			privateState.shed[item] -= n;
			inv[item] = (inv[item] || 0) + n;
			continue;
		}

		if (order[0] === "PLACE" && order.length >= 2) {
			let item = order[1];
			if (ANIMALS[item] && tile && typeof tile === "object" &&
					tile.kind === ANIMALS[item].structure && !Object.prototype.hasOwnProperty.call(tile, "animal")) {
				take(inv, item, 1);
				continue;
			}
			if (!is_shed_adjacent(position, boardSize)) continue;
			let n = order.length >= 3 ? python_int(order[2]) : 1;
			if (n === null || n <= 0) continue;
			n = Math.min(n, inv[item] || 0);
			let room = Math.max(0, shedCapacity - sum_values(privateState.shed));
			n = Math.min(n, room);
			if (n <= 0) continue;
			inv[item] -= n;
			if (inv[item] === 0) delete inv[item];
			privateState.shed[item] = (privateState.shed[item] || 0) + n;
		}
	}
}

function requested_units(order) {
	if (!Array.isArray(order) || order.length === 0) return 1;
	if (order[0] === "HIRE" || order[0] === "BUY_LAND") return 1;
	let n = order.length >= 3 ? python_int(order[2]) : null;
	return n !== null && n > 0 ? n : 1;
}

function parse_order(order, result) {
	if (!Array.isArray(order) || order.length === 0) return null;
	let op = order[0];
	if (op === "HIRE" || op === "BUY_LAND") return {type: op, result};
	if (!["BUY_SEED", "BUY_PRODUCT", "BUY_ANIMAL", "SELL"].includes(op) || order.length < 3) return null;
	let n = python_int(order[2]);
	if (n === null || n <= 0) return null;
	result.requested = n;
	return {type: op, item: order[1], remaining: n, result};
}

function fib(n) {
	let a = 1;
	let b = 1;
	for (let i = 0; i < n; i++) [a, b] = [b, a + b];
	return a;
}

function do_hire(farm, privateState, multiplier) {
	let cost = multiplier * fib(farm.hires_today);
	if (farm.money < cost) return false;
	farm.money -= cost;
	farm.hires_today += 1;
	farm.hands.push(null);
	privateState.inventories.push({});
	return true;
}

function do_buy_land(farm) {
	let nUnlockedExtra = farm.unlocked_quadrants.length - 1;
	if (nUnlockedExtra >= LAND_ORDER.length) return false;
	let cost = LAND_PRICES[nUnlockedExtra];
	if (farm.money < cost) return false;
	farm.money -= cost;
	farm.unlocked_quadrants.push(LAND_ORDER[nUnlockedExtra]);
	return true;
}

function commit_unit(op, item, price, farm, privateState, market, shedCapacity) {
	if (op === "SELL") {
		if ((privateState.shed[item] || 0) <= 0) return false;
		privateState.shed[item] -= 1;
		farm.money += price;
		if (price > 1) market.inventory[item] += 1;
		return true;
	}
	if (op === "BUY_PRODUCT") {
		if (farm.money < price) return false;
		if (sum_values(privateState.shed) >= shedCapacity) return false;
		farm.money -= price;
		privateState.shed[item] = (privateState.shed[item] || 0) + 1;
		market.inventory[item] -= 1;
		return true;
	}
	if (op === "BUY_SEED") {
		if (farm.money < price) return false;
		farm.money -= price;
		privateState.seeds[item] = (privateState.seeds[item] || 0) + 1;
		return true;
	}
	if (op === "BUY_ANIMAL") {
		if (farm.money < price) return false;
		if (sum_values(privateState.shed) >= shedCapacity) return false;
		farm.money -= price;
		privateState.shed[item] = (privateState.shed[item] || 0) + 1;
		return true;
	}
	return false;
}

function resolve_turn(input) {
	let configuration = input.configuration || {};
	let market = clone(input.market);
	let farms = clone(input.farms);
	let privates = clone(input.privates);
	let actions = input.actions.map(action => action && typeof action === "object" && !Array.isArray(action) ? action : {});
	let maxOrders = Math.max(1, config_int(configuration, "maxMarketOrdersPerTurn", 10));
	let hireMultiplier = config_int(configuration, "farmHandCostMult", 1);
	// Runners predating the capacity check on market purchases let buys overfill
	// the shed; replays from them must be resolved with that behaviour intact.
	let buyCapacity = input.shed_capacity_bug ? Infinity : config_int(configuration, "shedCapacity", 100);

	for (let player = 0; player < farms.length; player++) {
		apply_pre_market_unit_actions(farms[player], privates[player], actions[player] || {}, configuration);
	}

	let orders = actions.map(action => Array.isArray(action.market) ? action.market : []);
	let results = orders.map(playerOrders => playerOrders.map(order => ({
		requested: requested_units(order),
		fulfilled: 0,
		money: 0,		// Player balance delta: negative for a purchase, positive for a sale.
		status: "failure",
	})));
	let queues = orders.map(playerOrders => playerOrders.slice(0, maxOrders));
	let maxLength = Math.max(0, ...queues.map(queue => queue.length));

	for (let orderIndex = 0; orderIndex < maxLength; orderIndex++) {
		let states = queues.map((queue, player) => orderIndex < queue.length ?
				parse_order(queue[orderIndex], results[player][orderIndex]) : null);

		for (let player = 0; player < states.length; player++) {
			let state = states[player];
			if (!state) continue;
			if (state.type === "HIRE") {
				let money_before = farms[player].money;
				if (do_hire(farms[player], privates[player], hireMultiplier)) {
					state.result.fulfilled = 1;
					state.result.money = farms[player].money - money_before;
				}
				states[player] = null;
			} else if (state.type === "BUY_LAND") {
				let money_before = farms[player].money;
				if (do_buy_land(farms[player])) {
					state.result.fulfilled = 1;
					state.result.money = farms[player].money - money_before;
				}
				states[player] = null;
			}
		}

		for (let loop = 1; loop < 100000; loop++) {
			let quoted = states.map((state, player) => {
				if (!state || state.remaining <= 0) return null;
				let item = state.item;
				if (state.type === "SELL" && PRODUCTS.includes(item)) {
					return {
						op: "SELL",
						item,
						price: market_price(item, market.inventory[item], market.params || MARKET_PARAMS), state, player
					};
				}
				if (state.type === "BUY_PRODUCT" && (item === "WHEAT" || item === "FERTILIZER")) {
					return {
						op: "BUY_PRODUCT",
						item,
						price: market_price(item, market.inventory[item] - 1, market.params || MARKET_PARAMS), state, player
					};
				}
				if (state.type === "BUY_SEED" && Object.prototype.hasOwnProperty.call(CROPS, item)) {
					return {
						op: "BUY_SEED",
						item,
						price: CROPS[item].seed, state, player
					};
				}
				if (state.type === "BUY_ANIMAL" && Object.prototype.hasOwnProperty.call(ANIMALS, item)) {
					return {
						op: "BUY_ANIMAL",
						item,
						price: ANIMALS[item].cost, state, player
					};
				}
				states[player] = null;
				return null;
			});

			if (quoted.every(quote => quote === null)) break;
			let committedAny = false;
			for (let quote of quoted) {
				if (!quote) continue;
				if (commit_unit(quote.op, quote.item, quote.price, farms[quote.player], privates[quote.player], market, buyCapacity)) {
					quote.state.remaining -= 1;
					quote.state.result.fulfilled += 1;
					quote.state.result.money += quote.op === "SELL" ? quote.price : -quote.price;
					committedAny = true;
				} else {
					states[quote.player] = null;
				}
			}
			if (!committedAny) break;
		}

		refresh_prices(market);
	}

	for (let playerResults of results) {
		for (let result of playerResults) {
			result.status = result.fulfilled === 0 ? "failure" :
					(result.fulfilled === result.requested ? "success" : "partial");
		}
	}
	return results;
}

module.exports = {
	market_price,
	resolve_turn,
};
