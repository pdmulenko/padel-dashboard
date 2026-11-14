import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Фигуры Font Awesome бывают чуть шире своей области (viewBox): без overflow="visible"
// у <symbol> край иконки обрезается
test('icons.svg: у каждой иконки снята обрезка по краю', () => {
    const svg = readFileSync('icons.svg', 'utf8');
    const symbols = svg.match(/<symbol\b[^>]*>/g);
    assert.ok(symbols.length > 0);
    for (const tag of symbols) assert.match(tag, /overflow="visible"/, tag.slice(0, 60));
});
