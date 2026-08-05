"use strict";

const assert = require("node:assert/strict");
const replay_kaggle = require("./replay_kaggle");

const ITEMS = ["WHEAT", "CARROT", "TOMATO", "STRAWBERRY", "MELON", "EGG", "MILK", "WOOL", "FERTILIZER"];

function observation(money, shed = {}, seeds = {}) {
	let inventory = Object.fromEntries(ITEMS.map(item => [item, 10000]));
	let prices = {WHEAT: 25, CARROT: 35, TOMATO: 60, STRAWBERRY: 120, MELON: 250,
		EGG: 50, MILK: 160, WOOL: 200, FERTILIZER: 100};
	return {
		day: 0,
		hour: 0,
		market: {inventory, prices},
		farms: [{
			money,
			farmer: [4, 4],
			hands: [],
			hires_today: 0,
			unlocked_quadrants: ["NW"],
			tiles: Array.from({length: 10}, () => Array(10).fill(null)),
		}],
		private: {shed, seeds, inventories: [{}]},
		town: {unlocked_shops: []},
	};
}

let source = {
	configuration: {boardSize: 10, shedCapacity: 100},
	steps: [
		[{observation: observation(0, {WHEAT: 1}), action: {}}],
		[{observation: observation(25), action: {market: [["SELL", "WHEAT", 1]]}}],
	],
};

let replay = replay_kaggle.load(source);
let cached = replay.next_market_results(0);
assert.deepEqual(cached, [[{requested: 1, fulfilled: 1, money: 25, status: "success"}]]);
assert.strictEqual(replay.next_market_results(0), cached, "turn results are reused after load");

source.steps[1][0].action.market[0][2] = 2;
assert.strictEqual(replay.next_market_results(0), cached, "later replay mutations do not rerun the market");
assert.deepEqual(replay.next_market_results(1), [[]]);

let sales_source = {
	configuration: {boardSize: 10, shedCapacity: 100},
	steps: [
		[{observation: observation(0, {WHEAT: 2, CARROT: 1}), action: {}}],
		[{observation: observation(49, {WHEAT: 1, CARROT: 1}), action: {market: [["SELL", "WHEAT", 2]]}}],
		[{observation: observation(99), action: {market: [
			["SELL", "WHEAT", 2],
			["SELL", "CARROT", 1],
			["BUY_SEED", "WHEAT", 1],
		]}}],
	],
};

let sales_replay = replay_kaggle.load(sales_source);
assert.deepEqual(sales_replay.sales_summary(0, 0), {}, "the initial state has no completed sales");
assert.deepEqual(sales_replay.sales_summary(1, 0), {
	WHEAT: {sold: 2, money: 49},
});
assert.deepEqual(sales_replay.sales_summary(2, 0), {
	WHEAT: {sold: 3, money: 74},
	CARROT: {sold: 1, money: 35},
}, "sales use fulfilled quantities, include proceeds, and ignore purchases");

let purchase_source = {
	configuration: {boardSize: 10, shedCapacity: 100},
	steps: [
		[{observation: observation(10000), action: {}}],
		[{observation: observation(5499,
				{FERTILIZER: 2, WHEAT: 3, GOOSE: 1, COW: 2}, {TOMATO: 2, CARROT: 1}), action: {market: [
			["BUY_PRODUCT", "FERTILIZER", 2],
			["BUY_PRODUCT", "WHEAT", 3],
			["BUY_SEED", "TOMATO", 2],
			["BUY_SEED", "CARROT", 1],
			["BUY_ANIMAL", "GOOSE", 1],
			["BUY_ANIMAL", "COW", 2],
			["HIRE"],
			["HIRE"],
			["BUY_LAND"],
			["BUY_LAND"],
		]}}],
	],
};

let purchase_replay = replay_kaggle.load(purchase_source);
assert.deepEqual(purchase_replay.purchase_summary(0, 0), {}, "the initial state has no completed purchases");
assert.deepEqual(purchase_replay.purchase_summary(1, 0), {
	FERTILIZER: {bought: 2, money: -200},
	WHEAT: {bought: 3, money: -79},
	SEEDS: {bought: 3, money: -120},
	ANIMALS: {bought: 3, money: -1100},
	HIRES: {bought: 2, money: -2},
	LAND: {bought: 2, money: -3000},
}, "purchases use fulfilled quantities, group categories, and retain their negative costs");

let destruction_source = {
	configuration: {boardSize: 10, shedCapacity: 1},
	steps: [
		[{observation: observation(0, {CARROT: 1}), action: {}}],
		[{observation: observation(0, {CARROT: 1}), action: {farmer: ["DROP"]}}],
		[{observation: observation(0, {CARROT: 1}), action: {farmer: ["DROP"]}}],
	],
};
destruction_source.steps[0][0].observation.private.inventories[0] = {WHEAT: 2};
destruction_source.steps[1][0].observation.private.inventories[0] = {MILK: 1};
let destruction_replay = replay_kaggle.load(destruction_source);
assert.deepEqual(destruction_replay.destruction_summary(0, 0), {}, "the initial state has no destruction");
assert.deepEqual(destruction_replay.destruction_summary(1, 0), {WHEAT: 2},
	"destruction uses the action leading to the observed step");
assert.deepEqual(destruction_replay.destruction_summary(2, 0), {WHEAT: 2, MILK: 1},
	"destruction summaries are cumulative at every replay step");

console.log("replay kaggle tests passed");
