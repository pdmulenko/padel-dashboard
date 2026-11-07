import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreFromTarget, computeTable, americanoKeys, pairsKeys, isValidScore, podium, podiumTiebreaks } from '../scoring.js';

const players = ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id.toUpperCase(), active: true }));
const match = (score) => ({ sides: [['a', 'b'], ['c', 'd']], pairs: ['t1', 't2'], score });

test('свободный счёт 6:4 даёт ±2; ничья 3:3 — Н обоим', () => {
    const table = computeTable(players, [match([6, 4]), match([3, 3])], americanoKeys);
    const row = Object.fromEntries(table.map((r) => [r.id, r]));
    assert.equal(row.a.diff, 2);
    assert.equal(row.c.diff, -2);
    assert.deepEqual([row.a.w, row.a.d, row.a.l], [1, 1, 0]);
    assert.deepEqual([row.d.w, row.d.d, row.d.l], [0, 1, 1]);
    assert.equal(row.b.matches, 2);
    assert.equal(row.b.gf, 9);
    assert.equal(row.b.ga, 7);
});

test('сумма очков 24: ввод 15 даёт 15:9', () => {
    assert.deepEqual(scoreFromTarget(15, 24), [15, 9]);
    assert.deepEqual(scoreFromTarget(12, 24), [12, 12]);
});

test('сортировка: разница ↓, затем забито ↓, затем ник', () => {
    const ps = ['z', 'y', 'x', 'w', 'v', 'u', 't', 's'].map((id) => ({ id, name: id, active: true }));
    const ms = [
        { sides: [['z', 'y'], ['x', 'w']], score: [10, 8] }, // z,y +2 (10)
        { sides: [['v', 'u'], ['t', 's']], score: [5, 3] }, // v,u +2 (5)
    ];
    const order = computeTable(ps, ms, americanoKeys).map((r) => r.id);
    assert.deepEqual(order, ['y', 'z', 'u', 'v', 'w', 'x', 's', 't']);
});

test('таблица пар считает по парам', () => {
    const pairs = [
        { id: 't1', name: 'A + B', active: true },
        { id: 't2', name: 'C + D', active: false },
    ];
    const table = computeTable(pairs, [match([2, 1])], pairsKeys);
    assert.equal(table[0].id, 't1');
    assert.equal(table[0].diff, 1);
    assert.equal(table[1].l, 1);
});

test('проверка счёта', () => {
    assert.ok(isValidScore([0, 0]));
    assert.ok(!isValidScore([1, -1]));
    assert.ok(!isValidScore([1.5, 2]));
    assert.ok(!isValidScore(null));
});

test('при равной разнице мячей выше тот, у кого лучше разница побед и поражений', () => {
    const row = (name, w, l, gf, ga) => ({ id: name, name, active: true, matches: w + l, w, d: 0, l, gf, ga, diff: gf - ga });
    // как на скриншоте: Буба 3-0-1 и Дима 2-0-2, оба +10
    const ps = [{ id: 'Дима', name: 'Дима', active: true }, { id: 'Буба', name: 'Буба', active: true }, { id: 'Паша', name: 'Паша', active: true }];
    const ms = [
        { sides: [['Буба'], ['Паша']], score: [11, 0] },
        { sides: [['Буба'], ['Паша']], score: [1, 0] },
        { sides: [['Буба'], ['Паша']], score: [1, 0] },
        { sides: [['Буба'], ['Паша']], score: [0, 3] },
        { sides: [['Дима'], ['Паша']], score: [7, 0] },
        { sides: [['Дима'], ['Паша']], score: [7, 0] },
        { sides: [['Дима'], ['Паша']], score: [0, 2] },
        { sides: [['Дима'], ['Паша']], score: [0, 2] },
    ];
    const table = computeTable(ps, ms, americanoKeys);
    assert.deepEqual(table.map((r) => r.name), ['Буба', 'Дима', 'Паша']);
    assert.equal(table[0].diff, table[1].diff);
    const groups = podium(table);
    assert.equal(groups[0].length, 1);
    assert.deepEqual(podiumTiebreaks(table), { wins: true, goals: false });
    // без равенства разницы комментарий не нужен
    assert.deepEqual(podiumTiebreaks([row('A', 2, 0, 10, 2), row('B', 1, 1, 6, 6), row('C', 0, 2, 2, 10)]), { wins: false, goals: false });
    // равны разница мячей и побед — решают забитые
    assert.deepEqual(podiumTiebreaks([row('A', 1, 1, 12, 10), row('B', 1, 1, 8, 6), row('C', 0, 2, 2, 10)]), { wins: false, goals: true });
});
