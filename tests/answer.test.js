// Çalıştırma: node --test "tests/*.test.js"
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkAnswer, variants, levenshtein } = require('../answer.js');

const res = (input, expected, lang) => checkAnswer(input, expected, lang).result;

test('birebir doğru cevap', () => {
    assert.equal(res('rarely', 'Rarely', 'en'), 'correct');
    assert.equal(res('  Nadiren ', 'Nadiren', 'tr'), 'correct');
});

test('büyük/küçük harf ve noktalama önemsiz', () => {
    assert.equal(res('SIK SIK!', 'Sık Sık', 'tr'), 'correct');
    assert.equal(res('as usual.', 'As usual', 'en'), 'correct');
});

test('Türkçe karakter olmadan yazılan cevap doğru sayılır', () => {
    const r = checkAnswer('sik sik', 'Sık Sık', 'tr');
    assert.equal(r.result, 'correct');
    assert.equal(r.accentOnly, true);
    assert.equal(res('cocuk', 'çocuk', 'tr'), 'correct');
});

test('birden fazla anlamdan biri yeterli', () => {
    assert.equal(res('genellikle', 'Sık sık, genellikle', 'tr'), 'correct');
    assert.equal(res('çoğu zaman', 'sık sık / çoğu zaman', 'tr'), 'correct');
    assert.equal(res('tesadüf', 'tesadüf (şans)', 'tr'), 'correct');
});

test('İngilizcede to/a/the öneki önemsiz', () => {
    assert.equal(res('to suffer', 'suffer', 'en'), 'correct');
    assert.equal(res('suffer', 'to suffer', 'en'), 'correct');
    assert.equal(res('the journey', 'journey', 'en'), 'correct');
});

test('küçük yazım hatası "neredeyse"', () => {
    assert.equal(res('recieve', 'receive', 'en'), 'close');
    assert.equal(res('mischevious', 'mischievous', 'en'), 'close');
    assert.equal(res('nadren', 'Nadiren', 'tr'), 'close');
});

test('kısa kelimelerde hata toleransı yok', () => {
    assert.equal(res('tje', 'the', 'en'), 'wrong');
    assert.equal(res('wam', 'warm', 'en'), 'close');   // 4 harf → 1 hata
});

test('yanlış ve boş cevaplar', () => {
    assert.equal(res('often', 'rarely', 'en'), 'wrong');
    assert.equal(res('', 'rarely', 'en'), 'wrong');
    assert.equal(res('   ', 'Nadiren', 'tr'), 'wrong');
});

test('Türkçe büyük İ/I doğru küçülür', () => {
    assert.equal(res('IŞIK', 'ışık', 'tr'), 'correct');
    assert.equal(res('İYİ', 'iyi', 'tr'), 'correct');
});

test('yardımcılar', () => {
    assert.equal(levenshtein('kitten', 'sitting'), 3);
    assert.equal(levenshtein('recieve', 'receive'), 1);
    const v = variants('a, b / c', 'tr');
    for (const part of ['a', 'b', 'c']) assert.ok(v.includes(part), part);
});
