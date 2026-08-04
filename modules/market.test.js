"use strict";

const assert = require("node:assert/strict");
const market = require("./market");

const ITEMS = ["WHEAT", "CARROT", "TOMATO", "STRAWBERRY", "MELON", "EGG", "MILK", "WOOL", "FERTILIZER"];

{
	let cache = new Map();
	assert.equal(market.market_price("WHEAT", 10000, undefined, cache), 25);
	assert.equal(market.market_price("WHEAT", 10000, undefined, cache), 25);
	assert.equal(cache.size, 1, "identical price calculations share a cached result");
	let custom = {WHEAT: {base: 30, I0: 10000, T: 400, below_func: "sqrt", below_target: 0.8,
		above_func: "log", above_target: 0.2}};
	assert.equal(market.market_price("WHEAT", 10000, custom, cache), 30);
	assert.equal(cache.size, 2, "custom parameters cannot collide with default prices");
}

function player(money, shed = {}, extras = {}) {
	return {
		farm: Object.assign({
			money,
			farmer: [4, 4],
			hands: [],
			hires_today: 0,
			unlocked_quadrants: ["NW"],
			tiles: Array.from({length: 10}, () => Array(10).fill(null)),
		}, extras.farm),
		privateState: Object.assign({shed, seeds: {}, inventories: [{}]}, extras.privateState),
	};
}

function resolve(players, actions, configuration = {}) {
	let inventory = Object.fromEntries(ITEMS.map(item => [item, 10000]));
	let prices = Object.fromEntries(ITEMS.map(item => [item, market.market_price(item, inventory[item])]));
	return market.resolve_turn({
		configuration: Object.assign({boardSize: 10, shedCapacity: 100}, configuration),
		market: {inventory, prices},
		farms: players.map(p => p.farm),
		privates: players.map(p => p.privateState),
		actions,
	});
}

{
	let results = resolve([player(25), player(0)], [
		{market: [["BUY_SEED", "WHEAT", 3]]},
		{market: [["BUY_SEED", "WHEAT", 1]]},
	]);
	assert.deepEqual(results.map(r => r[0]), [
		{requested: 3, fulfilled: 2, money: -20, status: "partial"},
		{requested: 1, fulfilled: 0, money: 0, status: "failure"},
	]);
}

{
	let results = resolve([player(1000, {WHEAT: 1}), player(1000, {WHEAT: 2})], [
		{market: [["SELL", "WHEAT", 2]]},
		{market: [["SELL", "WHEAT", 2]]},
	]);
	assert.equal(results[0][0].status, "partial");
	assert.equal(results[0][0].fulfilled, 1);
	assert.equal(results[0][0].money, 25);
	assert.equal(results[1][0].status, "success");
	assert.equal(results[1][0].money, 49);
}

{
	// Cross-player quotes are taken in lockstep. Player 1 can afford only two of
	// four wheat units, then sells those two units in the next queue position.
	let results = resolve([player(100, {WHEAT: 4}), player(60)], [
		{market: [["SELL", "WHEAT", 3], ["BUY_SEED", "TOMATO", 2]]},
		{market: [["BUY_PRODUCT", "WHEAT", 4], ["SELL", "WHEAT", 2]]},
	]);
	assert.deepEqual(results, [
		[
			{requested: 3, fulfilled: 3, money: 75, status: "success"},
			{requested: 2, fulfilled: 2, money: -100, status: "success"},
		],
		[
			{requested: 4, fulfilled: 2, money: -52, status: "partial"},
			{requested: 2, fulfilled: 2, money: 48, status: "success"},
		],
	]);
}

{
	let p0 = player(0, {WHEAT: 2}, {privateState: {inventories: [{}]}});
	let results = resolve([p0, player(0)], [
		{farmer: ["PICKUP", "WHEAT", 2], market: [["SELL", "WHEAT", 2]]},
		{market: []},
	]);
	assert.equal(results[0][0].status, "failure", "PICKUP runs before the market sale");
}

{
	let p0 = player(1000, {}, {privateState: {inventories: [{WHEAT: 2}]}});
	let results = resolve([p0, player(0)], [
		{farmer: ["DROP"], market: [["SELL", "WHEAT", 2]]},
		{market: []},
	]);
	assert.equal(results[0][0].status, "success", "DROP runs before the market sale");
}

{
	let results = resolve([player(1), player(0)], [
		{market: [["HIRE"], ["HIRE"], ["BUY_LAND"]]},
		{market: []},
	], {maxMarketOrdersPerTurn: 2});
	assert.deepEqual(results[0].map(r => r.status), ["success", "failure", "failure"]);
	assert.deepEqual(results[0].map(r => r.money), [-1, 0, 0]);
}

{
	// The referenced runner does not apply shedCapacity to market purchases; this
	// guards fidelity even though unit DROP/PLACE operations do use the capacity.
	let results = resolve([player(1000, {WHEAT: 100}), player(0)], [
		{market: [["BUY_PRODUCT", "WHEAT", 1]]},
		{market: []},
	]);
	assert.equal(results[0][0].status, "success");
}

console.log("market tests passed");
