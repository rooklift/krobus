"use strict";

const assert = require("node:assert/strict");
const destruction = require("./destruction");

function state(shed = {}, inventories = [{}], farm_extras = {}) {
	return {
		farm: Object.assign({
			farmer: [4, 4],
			hands: [],
			tiles: Array.from({length: 10}, () => Array(10).fill(null)),
		}, farm_extras),
		private_state: {shed, seeds: {}, inventories},
	};
}

function analyze(game_state, action, extras = {}) {
	return destruction.analyze_turn(Object.assign({
		configuration: {boardSize: 10, shedCapacity: 100, turnsPerDay: 24},
		farm: game_state.farm,
		private_state: game_state.private_state,
		action,
		market_results: [],
		day: 0,
		hour: 0,
	}, extras));
}

{
	let game_state = state({CARROT: 2}, [{WHEAT: 2, MILK: 1}]);
	assert.deepEqual(analyze(game_state, {farmer: ["DROP"]}, {
		configuration: {boardSize: 10, shedCapacity: 3, turnsPerDay: 24},
	}), {WHEAT: 1, MILK: 1}, "DROP records each item that does not fit");
}

{
	let game_state = state({CARROT: 1}, [{WHEAT: 2}]);
	game_state.farm.tiles[4][4] = "LOCKED";
	assert.deepEqual(analyze(game_state, {farmer: ["DROP"]}, {
		configuration: {boardSize: 10, shedCapacity: 1, turnsPerDay: 24},
	}), {}, "DROP on a locked shed-access tile is a no-op");
}

{
	let game_state = state({CARROT: 2}, [{}, {WHEAT: 2}], {hands: [[5, 4]]});
	assert.deepEqual(analyze(game_state, {
		farmer: ["PICKUP", "CARROT", 1],
		hands: [["DROP"]],
	}, {
		configuration: {boardSize: 10, shedCapacity: 2, turnsPerDay: 24},
	}), {WHEAT: 1}, "unit actions share shed capacity in execution order");
}

{
	let game_state = state({CARROT: 1}, [{MILK: 1}]);
	game_state.farm.tiles[4][4] = {
		kind: "PLANT",
		crop: "WHEAT",
		planted_day: 0,
		yield_units: 2,
	};
	assert.deepEqual(analyze(game_state, {farmer: ["HARVEST"]}, {
		configuration: {boardSize: 10, shedCapacity: 1, turnsPerDay: 2},
		day: 2,
		hour: 1,
	}), {MILK: 1, WHEAT: 2}, "day-end overflow includes items harvested that turn");
}

{
	let game_state = state({WHEAT: 1}, [{CARROT: 2}]);
	assert.deepEqual(analyze(game_state, {
		farmer: ["PASS"],
		market: [["SELL", "WHEAT", 1]],
	}, {
		configuration: {boardSize: 10, shedCapacity: 1, turnsPerDay: 2},
		market_results: [{requested: 1, fulfilled: 1, money: 25, status: "success"}],
		hour: 1,
	}), {CARROT: 1}, "market sales free capacity before the day-end drop");
}

{
	let game_state = state({CARROT: 1}, [{WHEAT: 1}]);
	game_state.farm.tiles[4][4] = {
		kind: "COOP",
		animal: "GOOSE",
		fed_today: false,
		consecutive_unfed: 1,
		yield_units: 2,
	};
	assert.deepEqual(analyze(game_state, {farmer: ["FEED"]}, {
		configuration: {boardSize: 10, shedCapacity: 1, turnsPerDay: 2},
		hour: 1,
	}), {}, "consumed feed is not counted as destroyed");
}

{
	let game_state = state();
	game_state.farm.tiles[0][0] = {
		kind: "PLANT",
		crop: "WHEAT",
		yield_units: 1,
		max_lifespan_step: 0,
	};
	assert.deepEqual(analyze(game_state, {farmer: ["PASS"]}), {WHEAT: 1},
		"an unharvested product that decays is counted");
}

{
	let game_state = state();
	game_state.farm.tiles[0][0] = {
		kind: "PLANT",
		crop: "TOMATO",
		yield_units: 0,
		max_lifespan_step: 0,
	};
	assert.deepEqual(analyze(game_state, {farmer: ["PASS"]}), {},
		"a spent plant naturally reaching the end of its lifespan is not a product loss");
}

{
	let game_state = state();
	game_state.farm.tiles[0][0] = {
		kind: "PLANT",
		crop: "TOMATO",
		watered_today: false,
		consecutive_unwatered: 1,
		yield_units: 3,
		max_lifespan_step: -1,
	};
	assert.deepEqual(analyze(game_state, {farmer: ["PASS"]}, {
		configuration: {boardSize: 10, shedCapacity: 100, turnsPerDay: 2},
		hour: 1,
	}), {TOMATO: 3}, "yield held by an unwatered plant dying at day end is counted");
}

{
	let game_state = state();
	game_state.farm.tiles[4][4] = {
		kind: "PLANT",
		crop: "TOMATO",
		planted_day: 0,
		watered_today: false,
		consecutive_unwatered: 1,
		yield_units: 3,
		max_lifespan_step: -1,
	};
	assert.deepEqual(analyze(game_state, {farmer: ["WATER"]}, {
		configuration: {boardSize: 10, shedCapacity: 100, turnsPerDay: 2},
		hour: 1,
	}), {}, "watering prevents the pending plant loss");
}

{
	let game_state = state();
	game_state.farm.tiles[0][0] = {
		kind: "COOP",
		animal: "GOOSE",
		fed_today: false,
		consecutive_unfed: 1,
		yield_units: 2,
	};
	assert.deepEqual(analyze(game_state, {farmer: ["PASS"]}, {
		configuration: {boardSize: 10, shedCapacity: 100, turnsPerDay: 2},
		hour: 1,
	}), {GOOSE: 1, EGG: 2}, "an escaped animal and its uncollected product are counted");
}

{
	let game_state = state();
	game_state.farm.tiles[4][4] = {kind: "PLANT", crop: "MELON", yield_units: 4};
	assert.deepEqual(analyze(game_state, {farmer: ["DIG"]}), {MELON: 4},
		"digging up a plant counts only the product it was holding");
}

console.log("destruction tests passed");
