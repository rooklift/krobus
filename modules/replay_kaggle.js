"use strict";

function load(o) {					// Where o is an object already decoded from JSON.
	if (!Array.isArray(o.steps) || o.steps.length === 0 || !Array.isArray(o.steps[0])) {
		throw new Error("This does not appear to be a Kaggle replay (no steps).");
	}
	if (typeof o.configuration !== "object" || o.configuration === null) {
		throw new Error("This does not appear to be a Kaggle replay (no configuration).");
	}
	let ret = {r: o};
	Object.assign(ret, kaggle_replay_props);
	return ret;
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

	shops: function(i) {				// Array of unlocked shop names.
		return this.r.steps[i][0].observation.town.unlocked_shops;
	},

	// Private data is per-player, on that player's own observation...

	shed: function(i, pl) {				// Object of item --> count.
		return this.r.steps[i][pl].observation.private.shed;
	},

	shed_capacity: function() {
		let cap = this.r.configuration.shedCapacity;
		return (typeof cap === "number") ? cap : 100;
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
