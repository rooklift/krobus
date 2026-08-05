"use strict";

const assert = require("node:assert/strict");
const market = require("./market");

const ITEMS = ["WHEAT", "CARROT", "TOMATO", "STRAWBERRY", "MELON", "EGG", "MILK", "WOOL", "FERTILIZER"];

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

function resolve(players, actions, configuration = {}, extras = {}) {
	let inventory = Object.fromEntries(ITEMS.map(item => [item, 10000]));
	let prices = Object.fromEntries(ITEMS.map(item => [item, market.market_price(item, inventory[item])]));
	return market.resolve_turn(Object.assign({
		configuration: Object.assign({boardSize: 10, shedCapacity: 100}, configuration),
		market: {inventory, prices},
		farms: players.map(p => p.farm),
		privates: players.map(p => p.privateState),
		actions,
	}, extras));
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
	let p0 = player(1000, {}, {
		farm: {tiles: Array.from({length: 10}, (_, y) => Array.from({length: 10}, (_, x) => x === 4 && y === 4 ? "LOCKED" : null))},
		privateState: {inventories: [{WHEAT: 2}]},
	});
	let results = resolve([p0, player(0)], [
		{farmer: ["DROP"], market: [["SELL", "WHEAT", 2]]},
		{market: []},
	]);
	assert.equal(results[0][0].status, "failure", "inventory actions on a locked tile are no-ops");
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
	// Market purchases obey shedCapacity: a full shed blocks product and animal
	// buys, and a buy larger than the remaining room is only partially fulfilled.
	let results = resolve([player(1000, {WHEAT: 100}), player(1000, {WOOL: 100})], [
		{market: [["BUY_PRODUCT", "WHEAT", 1]]},
		{market: [["BUY_ANIMAL", "GOOSE", 1]]},
	]);
	assert.deepEqual(results.map(r => r[0]), [
		{requested: 1, fulfilled: 0, money: 0, status: "failure"},
		{requested: 1, fulfilled: 0, money: 0, status: "failure"},
	]);
}

{
	let results = resolve([player(1000, {WHEAT: 98}), player(0)], [
		{market: [["BUY_PRODUCT", "WHEAT", 5]]},
		{market: []},
	]);
	assert.deepEqual(results[0][0], {requested: 5, fulfilled: 2, money: -52, status: "partial"});
}

{
	// A sale earlier in the queue frees room for a later buy.
	let results = resolve([player(1000, {WHEAT: 99, CARROT: 1}), player(0)], [
		{market: [["SELL", "CARROT", 1], ["BUY_PRODUCT", "FERTILIZER", 2]]},
		{market: []},
	]);
	assert.deepEqual(results[0].map(r => r.status), ["success", "partial"]);
	assert.equal(results[0][1].fulfilled, 1);
}

{
	// Replays from runners predating the capacity check are resolved with the old
	// rules: the shed_capacity_bug flag lets buys overfill the shed.
	let results = resolve([player(1000, {WHEAT: 100}), player(0)], [
		{market: [["BUY_PRODUCT", "WHEAT", 1]]},
		{market: []},
	], {}, {shed_capacity_bug: true});
	assert.equal(results[0][0].status, "success");
}

console.log("market tests passed");
