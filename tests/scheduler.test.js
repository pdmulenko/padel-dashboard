import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    makeRng,
    pairKey,
    nextAmericanoRound,
    nextRoundRobinRound,
    roundsToEqual,
    unitStats,
    initWinnerStays,
    applyWinnerStays,
    wsRound,
} from '../scheduler.js';

const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);

const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));

function makePlayers(n) {
    return Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, active: true, joinedRound: 0 }));
}

function makePairs(k) {
    return Array.from({ length: k }, (_, i) => ({
        id: `t${i + 1}`,
        players: [`p${2 * i + 1}`, `p${2 * i + 2}`],
        active: true,
        joinedRound: 0,
    }));
}

function counts(players, rounds) {
    const { played } = unitStats(players, rounds, (m) => m.sides.flat());
    return players.filter((p) => p.active).map((p) => played.get(p.id));
}

function simulateAmericano(n, courts, numRounds, seed) {
    const players = makePlayers(n);
    const rng = makeRng(seed);
    const rounds = [];
    for (let t = 0; t < numRounds; t++) rounds.push(nextAmericanoRound(players, rounds, courts, rng));
    return { players, rounds };
}

test('американо, 4 игрока: за 3 тура все 3 разбивки по разу', () => {
    for (const seed of SEEDS) {
        const { rounds } = simulateAmericano(4, 1, 3, seed);
        const partners = new Set();
        for (const r of rounds) for (const side of r.matches[0].sides) partners.add(pairKey(...side));
        assert.equal(partners.size, 6, `seed ${seed}`);
    }
});

for (const n of [5, 6, 7, 8]) {
    test(`американо, 1 корт, ${n} игроков: разница ≤ 1, через n/НОД(n,4) туров поровну`, () => {
        const period = n / gcd(n, 4);
        for (const seed of SEEDS) {
            const { players, rounds } = simulateAmericano(n, 1, 3 * n, seed);
            for (let t = 1; t <= rounds.length; t++) {
                const c = counts(players, rounds.slice(0, t));
                assert.ok(Math.max(...c) - Math.min(...c) <= 1, `seed ${seed}, тур ${t}`);
                if (t % period === 0) assert.equal(Math.max(...c), Math.min(...c), `seed ${seed}, тур ${t}`);
            }
        }
    });
}

test('американо, 1 корт, 8 игроков, 7 туров: повторов напарников нет', () => {
    for (const seed of SEEDS) {
        const { rounds } = simulateAmericano(8, 1, 7, seed);
        const seen = new Set();
        for (const r of rounds) {
            for (const side of r.matches[0].sides) {
                const key = pairKey(...side);
                assert.ok(!seen.has(key), `seed ${seed}: повтор ${key}`);
                seen.add(key);
            }
        }
    }
});

for (const n of [8, 9, 10, 11, 12]) {
    test(`американо, 2 корта, ${n} игроков: разница ≤ 1, периодически поровну, никто не на двух кортах`, () => {
        const period = n / gcd(n, 8);
        for (const seed of SEEDS.slice(0, 10)) {
            const { players, rounds } = simulateAmericano(n, 2, 2 * period, seed);
            for (let t = 1; t <= rounds.length; t++) {
                const ids = rounds[t - 1].matches.flatMap((m) => m.sides.flat());
                assert.equal(ids.length, 8);
                assert.equal(new Set(ids).size, 8, `seed ${seed}, тур ${t}`);
                const c = counts(players, rounds.slice(0, t));
                assert.ok(Math.max(...c) - Math.min(...c) <= 1, `seed ${seed}, тур ${t}`);
                if (t % period === 0) assert.equal(Math.max(...c), Math.min(...c), `seed ${seed}, тур ${t}`);
            }
        }
    });
}

test('подсказка «до равного числа игр» совпадает с фактом', () => {
    const cases = [
        ...[5, 6, 7, 8, 9].map((n) => [n, 1]),
        ...[9, 10, 11, 12].map((n) => [n, 2]),
    ];
    for (const [n, courts] of cases) {
        const { players, rounds } = simulateAmericano(n, courts, 2 * n, 7);
        for (let t = 0; t < n; t++) {
            const hint = roundsToEqual(counts(players, rounds.slice(0, t)), 4 * courts);
            let actual = 0;
            while (true) {
                const c = counts(players, rounds.slice(0, t + actual));
                if (Math.max(...c) === Math.min(...c)) break;
                actual++;
            }
            assert.equal(hint, actual, `n=${n}, корты=${courts}, тур ${t}`);
        }
    }
});

test('опоздавший играет в ближайшем туре и подряд, пока не догонит; выбывший не появляется', () => {
    for (const seed of SEEDS) {
        const players = makePlayers(6);
        const rng = makeRng(seed);
        const rounds = [];
        for (let t = 0; t < 4; t++) rounds.push(nextAmericanoRound(players, rounds, 1, rng));
        players.push({ id: 'late', name: 'Late', active: true, joinedRound: rounds.length });
        players[0].active = false;
        for (let t = 0; t < 12; t++) {
            const r = nextAmericanoRound(players, rounds, 1, rng);
            const ids = r.matches[0].sides.flat();
            assert.ok(!ids.includes('p1'), `seed ${seed}: выбывший в туре`);
            const c = counts(players, rounds);
            const lateCount = c[c.length - 1];
            const othersMin = Math.min(...c.slice(0, -1));
            if (lateCount < othersMin) assert.ok(ids.includes('late'), `seed ${seed}: опоздавший пропустил тур`);
            rounds.push(r);
        }
    }
});

test('один и тот же seed даёт одинаковый тур', () => {
    const players = makePlayers(7);
    const a = nextAmericanoRound(players, [], 1, makeRng(42));
    const b = nextAmericanoRound(players, [], 1, makeRng(42));
    assert.deepEqual(a, b);
});

function simulateRoundRobin(k, courts, numRounds, seed) {
    const pairs = makePairs(k);
    const rng = makeRng(seed);
    const rounds = [];
    for (let t = 0; t < numRounds; t++) rounds.push(nextRoundRobinRound(pairs, rounds, courts, rng));
    return rounds;
}

test('пары по кругу, 1 корт, 3 пары: за 3 матча каждая с каждой', () => {
    for (const seed of SEEDS) {
        const rounds = simulateRoundRobin(3, 1, 3, seed);
        const keys = new Set(rounds.map((r) => pairKey(...r.matches[0].pairs)));
        assert.equal(keys.size, 3, `seed ${seed}`);
    }
});

for (const k of [4, 5, 6]) {
    test(`пары по кругу, 1 корт, ${k} пар: никто не играет 3 раза подряд`, () => {
        for (const seed of SEEDS) {
            const rounds = simulateRoundRobin(k, 1, 4 * k, seed);
            for (let t = 2; t < rounds.length; t++) {
                const last3 = rounds.slice(t - 2, t + 1).map((r) => r.matches[0].pairs);
                for (const id of last3[2]) {
                    assert.ok(!(last3[0].includes(id) && last3[1].includes(id)), `seed ${seed}, тур ${t + 1}, ${id}`);
                }
            }
            // каждый цикл — все сочетания по разу
            const cycle = (k * (k - 1)) / 2;
            const keys = new Set(rounds.slice(0, cycle).map((r) => pairKey(...r.matches[0].pairs)));
            assert.equal(keys.size, cycle, `seed ${seed}`);
        }
    });
}

test('пары по кругу, 2 корта, 4 пары: за 3 тура каждая с каждой', () => {
    for (const seed of SEEDS) {
        const rounds = simulateRoundRobin(4, 2, 3, seed);
        const keys = new Set();
        for (const r of rounds) {
            assert.equal(r.matches.length, 2);
            for (const m of r.matches) keys.add(pairKey(...m.pairs));
        }
        assert.equal(keys.size, 6, `seed ${seed}`);
    }
});

test('победитель остаётся: проигравший в конец очереди', () => {
    let ws = initWinnerStays(['A', 'B', 'C', 'D']);
    assert.deepEqual(ws.court, ['A', 'B']);
    ws = applyWinnerStays(ws, [6, 4], 3);
    assert.deepEqual(ws.court, ['A', 'C']);
    assert.deepEqual(ws.queue, ['D', 'B']);
    ws = applyWinnerStays(ws, [2, 6], 3);
    assert.deepEqual(ws.court, ['C', 'D']);
    assert.deepEqual(ws.queue, ['B', 'A']);
});

test('победитель остаётся: лимит матчей подряд', () => {
    let ws = initWinnerStays(['A', 'B', 'C']);
    ws = applyWinnerStays(ws, [6, 1], 3); // A–B, A 1-й матч
    ws = applyWinnerStays(ws, [6, 1], 3); // A–C, A 2-й матч
    assert.deepEqual(ws.court, ['A', 'B']);
    ws = applyWinnerStays(ws, [6, 1], 3); // A–B, A 3-й матч → уходит
    assert.deepEqual(ws.court, ['C', 'B']);
    assert.deepEqual(ws.queue, ['A']);
    // без лимита пара остаётся
    let free = initWinnerStays(['A', 'B', 'C']);
    for (let i = 0; i < 5; i++) free = applyWinnerStays(free, [6, 1], null);
    assert.ok(free.court.includes('A'));
});

test('победитель остаётся: ничья', () => {
    // уходит та, что дольше на корте
    let ws = initWinnerStays(['A', 'B', 'C']);
    ws = applyWinnerStays(ws, [6, 1], 3); // A остаётся, выходит C
    ws = applyWinnerStays(ws, [3, 3], 3); // ничья A–C: A дольше
    assert.deepEqual(ws.court, ['C', 'B']);
    // обе вышли одновременно — уходит вышедшая второй
    let s = initWinnerStays(['A', 'B', 'C']);
    s = applyWinnerStays(s, [3, 3], 3);
    assert.deepEqual(s.court, ['A', 'C']);
    assert.deepEqual(s.queue, ['B']);
});

test('победитель остаётся: 2 пары всегда играют друг с другом', () => {
    const pairs = makePairs(2);
    let ws = initWinnerStays(['t1', 't2']);
    for (let i = 0; i < 5; i++) {
        const r = wsRound(ws, pairs);
        assert.deepEqual(new Set(r.matches[0].pairs), new Set(['t1', 't2']));
        ws = applyWinnerStays(ws, [6, 2], 3);
    }
});
