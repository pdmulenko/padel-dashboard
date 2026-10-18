import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    createSession,
    saveScore,
    undo,
    editScore,
    table,
    addPlayer,
    setActive,
    setCourts,
    substitute,
    restingIds,
    loadSession,
    saveSession,
    SESSION_KEY,
    isFinished,
    winners,
    targetRounds,
    roundsForCircles,
    restartSameRoster,
} from '../state.js';

function memoryStorage() {
    const data = new Map();
    return {
        getItem: (k) => (data.has(k) ? data.get(k) : null),
        setItem: (k, v) => data.set(k, String(v)),
        removeItem: (k) => data.delete(k),
    };
}

const names = (n) => Array.from({ length: n }, (_, i) => `Игрок ${i + 1}`);

function playRound(s, score = [6, 4]) {
    s.current.matches.forEach((m, i) => {
        if (!m.score) saveScore(s, i, score);
    });
}

test('заранее показанный следующий тур совпадает со сыгранным', () => {
    const s = createSession({ mode: 'americano' }, names(7), [], 5);
    for (let t = 0; t < 10; t++) {
        const forecast = JSON.stringify(s.next.matches.map((m) => m.sides));
        playRound(s);
        assert.equal(JSON.stringify(s.current.matches.map((m) => m.sides)), forecast, `тур ${t + 2}`);
    }
});

test('исправление счёта и «Отменить» пересчитывают таблицу', () => {
    const s = createSession({ mode: 'americano' }, names(4), [], 1);
    playRound(s, [6, 4]);
    playRound(s, [5, 5]);
    const total = () => table(s).reduce((sum, r) => sum + Math.abs(r.diff), 0);
    assert.equal(total(), 8); // 4 игрока × |±2|
    editScore(s, 0, 0, [6, 0]);
    assert.equal(total(), 24);
    const before = JSON.stringify(s.rounds[1].matches[0].sides);
    assert.ok(undo(s));
    assert.equal(s.rounds.length, 1);
    assert.equal(s.current.matches[0].score, null);
    assert.equal(JSON.stringify(s.current.matches[0].sides), before);
    assert.equal(table(s).reduce((sum, r) => sum + r.matches, 0), 4);
});

test('«Отменить» на нескольких кортах снимает последний сохранённый матч', () => {
    const s = createSession({ mode: 'americano', courts: 2 }, names(8), [], 3);
    saveScore(s, 1, [3, 1]);
    saveScore(s, 0, [2, 2]);
    assert.equal(s.rounds.length, 1);
    undo(s);
    assert.equal(s.rounds.length, 0);
    assert.deepEqual(s.current.matches[1].score, [3, 1]);
    assert.equal(s.current.matches[0].score, null);
});

test('перезагрузка ничего не теряет; битые данные не роняют', () => {
    const storage = memoryStorage();
    const s = createSession({ mode: 'americano' }, names(6), [], 9);
    playRound(s);
    saveSession(storage, s);
    const { session } = loadSession(storage);
    assert.deepEqual(session, JSON.parse(JSON.stringify(s)));

    storage.setItem(SESSION_KEY, '{not json');
    assert.deepEqual(loadSession(storage), { corrupt: true });
    storage.setItem(SESSION_KEY, '{"version": 999}');
    assert.deepEqual(loadSession(storage), { corrupt: true });
    assert.deepEqual(loadSession(memoryStorage()), { session: null });
    const broken = { getItem: () => { throw new Error('denied'); } };
    assert.deepEqual(loadSession(broken), { session: null });
});

test('выбывший из текущего тура заменяется отдыхающим; опоздавший попадает в прогноз', () => {
    const s = createSession({ mode: 'americano' }, names(6), [], 2);
    const out = s.current.matches[0].sides[0][0];
    setActive(s, out, false);
    const ids = s.current.matches[0].sides.flat();
    assert.ok(!ids.includes(out));
    assert.equal(new Set(ids).size, 4);
    const late = addPlayer(s, 'Опоздавший');
    assert.ok(s.next.matches[0].sides.flat().includes(late.id));
});

test('замена вручную и смена числа кортов', () => {
    const s = createSession({ mode: 'americano', courts: 1 }, names(8), [], 4);
    const outId = s.current.matches[0].sides[1][1];
    const inId = restingIds(s)[0];
    substitute(s, 0, outId, inId);
    assert.ok(s.current.matches[0].sides.flat().includes(inId));
    setCourts(s, 2);
    assert.equal(s.current.matches.length, 2);
});

test('победитель остаётся: тур строится из очереди, отмена восстанавливает очередь', () => {
    const pairNames = [['A1', 'A2'], ['B1', 'B2'], ['C1', 'C2']];
    const s = createSession({ mode: 'pairs', rotation: 'winnerstays' }, [], pairNames, 1);
    const [a, b] = s.current.matches[0].pairs;
    saveScore(s, 0, [6, 2]);
    assert.ok(s.current.matches[0].pairs.includes(a));
    assert.ok(!s.current.matches[0].pairs.includes(b));
    assert.equal(s.next, null);
    undo(s);
    assert.deepEqual(s.current.matches[0].pairs, [a, b]);
    assert.deepEqual(s.ws.queue.length, 1);
});

test('турнир по числу туров завершается сам; «Отменить» возвращает последний тур', () => {
    const s = createSession({ mode: 'americano', endMode: 'rounds', endRounds: 3 }, names(5), [], 11);
    playRound(s);
    playRound(s);
    assert.ok(s.current);
    assert.equal(s.next, null); // после последнего тура прогноза нет
    playRound(s);
    assert.ok(isFinished(s));
    assert.equal(s.current, null);
    assert.ok(winners(s).length >= 1);
    undo(s);
    assert.ok(!isFinished(s));
    assert.equal(s.rounds.length, 2);
    assert.ok(s.current);
});

test('по умолчанию туров столько же, сколько игроков', () => {
    const s = createSession({ mode: 'americano', endMode: 'rounds' }, names(7), [], 1);
    assert.equal(targetRounds(s), 7);
});

test('круги «каждый с каждым в паре» пересчитываются в туры', () => {
    assert.equal(roundsForCircles(8, 1, 1), 14);
    assert.equal(roundsForCircles(8, 2, 1), 7);
    assert.equal(roundsForCircles(8, 1, 2), 28);
    assert.equal(roundsForCircles(6, 1, 1), 9); // 7.5 → 8 → до равного числа игр (кратно 3)
    assert.equal(roundsForCircles(4, 1, 1), 3);
});

test('новый турнир тем же составом: активные игроки и те же настройки, история пустая', () => {
    const s = createSession({ mode: 'americano', courts: 1, targetSum: 24 }, names(6), [], 3);
    playRound(s, [15, 9]);
    setActive(s, s.players[0].id, false);
    const r = restartSameRoster(s, 5);
    assert.equal(r.players.length, 5);
    assert.equal(r.rounds.length, 0);
    assert.equal(r.settings.targetSum, 24);
    assert.ok(r.current);
    const pairs = createSession({ mode: 'pairs' }, [], [['A', 'B'], ['C', 'D']], 1);
    assert.equal(restartSameRoster(pairs, 2).pairs.length, 2);
});
