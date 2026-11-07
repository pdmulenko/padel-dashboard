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
    fullPlay,
    roundsSummary,
    partnerSpread,
    finishNow,
    podiumOf,
    syncArchive,
    loadArchive,
    isStaleFinished,
    restartSameRoster,
    defaultEndRounds,
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

test('туров по умолчанию: n − 1, если никто не отдыхает, иначе n', () => {
    assert.equal(targetRounds(createSession({ mode: 'americano', endMode: 'rounds' }, names(7), [], 1)), 7);
    assert.equal(targetRounds(createSession({ mode: 'americano', endMode: 'rounds', courts: 2 }, names(8), [], 1)), 7);
    assert.equal(targetRounds(createSession({ mode: 'americano', endMode: 'rounds', courts: 1 }, names(4), [], 1)), 3);
    assert.equal(targetRounds(createSession({ mode: 'americano', endMode: 'rounds', courts: 1 }, names(8), [], 1)), 8);
    assert.equal(defaultEndRounds(12, 3), 11);
    assert.equal(defaultEndRounds(12, 2), 12);
});

test('полная игра: n(n−1)/НОД(4c, n(n−1)) туров, каждый с каждым 4c/НОД раз', () => {
    assert.deepEqual(fullPlay(4, 1), { rounds: 3, times: 1, matches: 3, courts: 1 });
    assert.deepEqual(fullPlay(8, 2), { rounds: 7, times: 1, matches: 7, courts: 2 });
    assert.deepEqual(fullPlay(8, 1), { rounds: 14, times: 1, matches: 7, courts: 1 });
    assert.deepEqual(fullPlay(6, 1), { rounds: 15, times: 2, matches: 10, courts: 1 });
    assert.deepEqual(fullPlay(9, 2), { rounds: 9, times: 1, matches: 8, courts: 2 });
    assert.deepEqual(fullPlay(5, 3), { rounds: 5, times: 1, matches: 4, courts: 1 }); // кортов больше, чем нужно
    assert.equal(fullPlay(3, 1), null);
});

test('сводка по числу туров', () => {
    // 6 игроков, 1 корт, 6 туров: поровну по 4 игры, но не каждый с каждым
    assert.deepEqual(
        { ...roundsSummary(6, 1, 6), full: undefined },
        { equal: true, perPlayer: 4, pairTimes: null, full: undefined },
    );
    assert.equal(roundsSummary(8, 2, 7).pairTimes, 1);
    assert.equal(roundsSummary(8, 2, 14).pairTimes, 2);
    assert.equal(roundsSummary(7, 1, 5).equal, false);
});

test('в режиме кругов: туров в круге по формуле, можно задать вручную', () => {
    const s = createSession({ mode: 'americano', endMode: 'circles', endCircles: 2 }, names(8), [], 1);
    assert.equal(targetRounds(s), 28);
    const t = createSession({ mode: 'americano', endMode: 'circles', endCircles: 1, circleRounds: 10 }, names(8), [], 1);
    assert.equal(targetRounds(t), 10);
});

test('при известном числе туров расписание даёт полную игру', () => {
    for (const [n, courts] of [
        [5, 1],
        [8, 2],
        [9, 2],
        [9, 1],
    ]) {
        for (const seed of [1, 2, 3]) {
            const s = createSession({ mode: 'americano', courts, endMode: 'circles', endCircles: 1 }, names(n), [], seed);
            while (s.current) playRound(s);
            assert.equal(partnerSpread(s.players.map((p) => p.id), s.rounds), 0, `n=${n}, корты=${courts}, seed=${seed}`);
        }
    }
});

test('досрочное завершение: сохранённые матчи засчитываются, «Отменить» возвращает турнир', () => {
    const s = createSession({ mode: 'americano', courts: 2 }, names(8), [], 4);
    playRound(s);
    saveScore(s, 0, [5, 3]);
    finishNow(s);
    assert.ok(isFinished(s));
    assert.equal(s.current, null);
    assert.equal(table(s).reduce((sum, r) => sum + r.matches, 0), 12); // 2 матча + 1 матч по 4 игрока
    undo(s);
    assert.ok(!isFinished(s));
    assert.equal(s.current.matches.length, 2);
    assert.ok(s.current.matches.every((m) => m.score === null));
});

test('подиум: три места с дележом', () => {
    const s = createSession({ mode: 'americano' }, names(5), [], 2);
    playRound(s, [6, 4]);
    const p = podiumOf(s);
    assert.equal(p[0].length, 2); // двое победителей делят первое место
    assert.equal(p[1][0].diff, 0); // отдыхавший
    assert.equal(p[2].length, 2);
});

test('архив: завершённый турнир попадает в архив, отмена завершения убирает его', () => {
    const storage = memoryStorage();
    const s = createSession({ mode: 'americano', endMode: 'rounds', endRounds: 1 }, names(4), [], 3);
    syncArchive(storage, s);
    assert.equal(loadArchive(storage).length, 0);
    playRound(s, [6, 2]);
    syncArchive(storage, s, '2026-11-08T10:00:00Z');
    const [entry] = loadArchive(storage);
    assert.equal(entry.id, s.id);
    assert.equal(entry.rounds.length, 1);
    assert.equal(entry.rows[0].diff, 4);
    editScore(s, 0, 0, [6, 4]);
    syncArchive(storage, s, '2026-11-09T10:00:00Z');
    assert.equal(loadArchive(storage)[0].rows[0].diff, 2);
    assert.equal(loadArchive(storage)[0].finishedAt, '2026-11-08T10:00:00Z');
    undo(s);
    syncArchive(storage, s);
    assert.equal(loadArchive(storage).length, 0);
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

test('доигранный турнир считается «старым» через 12 часов после завершения', () => {
    const storage = memoryStorage();
    const s = createSession({ mode: 'americano', endMode: 'rounds', endRounds: 1 }, names(4), [], 5);
    assert.ok(!isStaleFinished(storage, s));
    playRound(s);
    syncArchive(storage, s, '2026-11-08T10:00:00Z');
    const at = (iso) => Date.parse(iso);
    assert.ok(!isStaleFinished(storage, s, at('2026-11-08T21:59:00Z')));
    assert.ok(isStaleFinished(storage, s, at('2026-11-08T22:01:00Z')));
});
