"use strict";

const market = require("./market");

const FARMER_MOVES = {			// Copied from the runner. y grows downward.
	NORTH: [0, -1],
	SOUTH: [0, 1],
	EAST:  [1, 0],
	WEST:  [-1, 0],
};

function load(o) {					// Where o is an object already decoded from JSON.
	if (!Array.isArray(o.steps) || o.steps.length === 0 || !Array.isArray(o.steps[0])) {
		throw new Error("This does not appear to be a Kaggle replay (no steps).");
	}
	if (typeof o.configuration !== "object" || o.configuration === null) {
		throw new Error("This does not appear to be a Kaggle replay (no configuration).");
	}
	let ret = {r: o};
	Object.assign(ret, kaggle_replay_props);
	ret.market_results = precompute_market_results(ret);
	return ret;
}

function precompute_market_results(replay) {
	// Resolve every turn at load time, then make next_market_results() a simple
	// indexed lookup.
	let results = new Array(replay.length());
	for (let i = 0; i + 1 < replay.length(); i++) {
		results[i] = market.resolve_turn({
			configuration: replay.r.configuration,
			market: replay.r.steps[i][0].observation.market,
			farms: replay.r.steps[i][0].observation.farms,
			privates: replay.r.steps[i].map(step => step.observation.private),
			actions: replay.r.steps[i + 1].map(step => step.action),
		});
	}
	results[replay.length() - 1] = Array.from({length: replay.num_players()}, () => []);
	return results;
}

const kaggle_replay_props = {

	// Note that the full game state at each step lives on player 0's observation;
	// only the "private" object is per-player.

	length: function() {
		return this.r.steps.length;
	},

	num_players: function() {
		return this.r.steps[0].length;
	},

	board_size: function() {
		return this.r.configuration.boardSize;
	},

	team_name: function(pl) {
		let names = (this.r.info && Array.isArray(this.r.info.TeamNames)) ? this.r.info.TeamNames : [];
		return (typeof names[pl] === "string" && names[pl] !== "") ? names[pl] : `Player ${pl}`;
	},

	day: function(i) {
		return this.r.steps[i][0].observation.day;
	},

	hour: function(i) {
		return this.r.steps[i][0].observation.hour;
	},

	money: function(i, pl) {
		return this.r.steps[i][0].observation.farms[pl].money;
	},

	tiles: function(i, pl) {			// 2d array, indexed [y][x]. Each tile is null, "LOCKED", or an object.
		return this.r.steps[i][0].observation.farms[pl].tiles;
	},

	units: function(i, pl) {			// Positions as [x, y]. Index 0 is the main farmer, the rest are hands.
		let farm = this.r.steps[i][0].observation.farms[pl];
		return [farm.farmer].concat(farm.hands);
	},

	prices: function(i) {				// Object of item --> price.
		return this.r.steps[i][0].observation.market.prices;
	},

	market_inventory: function(i) {		// Object of item --> units the market holds. Prices rise as this falls below equilibrium.
		return this.r.steps[i][0].observation.market.inventory;
	},

	equilibrium: function(item) {		// The market initialises each item's inventory to its I0 equilibrium,
		return this.r.steps[0][0].observation.market.inventory[item];		// so step 0 has it (even with marketParams overrides).
	},

	shops: function(i) {				// Array of unlocked shop names.
		return this.r.steps[i][0].observation.town.unlocked_shops;
	},

	next_unit_actions: function(i, pl) {

		// The action each unit takes between step i and the next, aligned with units(i, pl)
		// (main farmer first). Empty array at the final step or if the action is malformed.

		if (i + 1 >= this.length()) {
			return [];
		}
		let action = this.r.steps[i + 1][pl].action;
		if (typeof action !== "object" || action === null) {
			return [];
		}
		return [action.farmer].concat(Array.isArray(action.hands) ? action.hands : []);
	},

	unit_moves: function(i, pl) {

		// For each unit at step i (main farmer first, matching units()), the [dx, dy] it
		// is about to move -- i.e. its move order between this step and the next -- or
		// null if it isn't moving. Move orders that will fail (board edge, locked tile)
		// are null too, as is everything at the final step.

		let units = this.units(i, pl);
		let ret = units.map(() => null);

		let unit_actions = this.next_unit_actions(i, pl);
		let tiles = this.tiles(i, pl);
		let bs = this.board_size();

		for (let n = 0; n < ret.length && n < unit_actions.length; n++) {
			let a = unit_actions[n];
			if (!Array.isArray(a) || !FARMER_MOVES.hasOwnProperty(a[0])) {
				continue;
			}
			let [dx, dy] = FARMER_MOVES[a[0]];
			let nx = units[n][0] + dx;
			let ny = units[n][1] + dy;
			if (nx < 0 || nx >= bs || ny < 0 || ny >= bs || tiles[ny][nx] === "LOCKED") {
				continue;
			}
			ret[n] = [dx, dy];
		}

		return ret;
	},

	next_market_orders: function(i, pl) {	// Array of order arrays, e.g. ["SELL", "WHEAT", 20] or ["HIRE"]. Like
											// next_unit_actions, these are the orders made in response to step i,
		if (i + 1 >= this.length()) {		// with effects visible at the next step. Empty array at the final step.
			return [];
		}
		let action = this.r.steps[i + 1][pl].action;
		if (typeof action !== "object" || action === null || !Array.isArray(action.market)) {
			return [];
		}
		return action.market;
	},

	next_market_results: function(i) {
		return this.market_results[i];
	},

	// Private data is per-player, on that player's own observation...

	shed: function(i, pl) {				// Object of item --> count.
		return this.r.steps[i][pl].observation.private.shed;
	},

	shed_capacity: function() {
		let cap = this.r.configuration.shedCapacity;
		return (typeof cap === "number") ? cap : 100;
	},

	turns_per_day: function() {
		let n = this.r.configuration.turnsPerDay;
		return (typeof n === "number") ? n : 24;
	},

	shop_sell_interval: function() {	// Unlocked shops consume from the market every this many steps.
		let n = this.r.configuration.townShopSellInterval;
		return (typeof n === "number") ? n : 4;
	},

	town_center_sell_interval: function() {		// The town center consumes from the market every this many steps.
		let n = this.r.configuration.townCenterSellInterval;
		return (typeof n === "number") ? n : 12;
	},

	seeds: function(i, pl) {			// Object of crop --> count.
		return this.r.steps[i][pl].observation.private.seeds;
	},

	inventories: function(i, pl) {		// Array of item --> count objects, index 0 is the main farmer, the rest are hands.
		return this.r.steps[i][pl].observation.private.inventories;
	},

};



module.exports = {
	load
};
