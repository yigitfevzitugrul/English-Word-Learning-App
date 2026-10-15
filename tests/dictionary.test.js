// Çalıştırma: node --test "tests/*.test.js"
const test = require('node:test');
const assert = require('node:assert/strict');
const { lookup, parseFreeDictionary, parseDatamuse, resetServiceState } = require('../dictionary.js');

test.beforeEach(() => resetServiceState());

// dictionaryapi.dev yanıt biçimi
const FREE_RARELY = [{
    word: 'rarely',
    phonetic: '/ˈɹɛəli/',
    phonetics: [{ text: '/ˈɹɛəli/', audio: '' }],
    meanings: [{
        partOfSpeech: 'adverb',
        definitions: [
            { definition: 'Not occurring at a regular interval; seldom; not often.', synonyms: ['seldom'] },
            { definition: 'To a rare degree; very.', example: 'He was rarely skilled.', synonyms: [] },
        ],
        synonyms: ['infrequently', 'seldom'],
        antonyms: ['often'],
    }],
}];

// Datamuse yanıt biçimi
const DM_RARELY = [{
    word: 'rarely', score: 148063,
    tags: ['adv', 'pron:R EH1 R L IY0 ', 'ipa_pron:rˈɛrɫi'],
    defs: ['adv\tNot occurring at a regular interval; seldom; not often. ', 'adv\tTo a rare degree; very. '],
}];
const DM_SYN = [{ word: 'seldom', score: 1 }, { word: 'rarely', score: 1 }];

test('Free Dictionary yanıtı', () => {
    const d = parseFreeDictionary(FREE_RARELY);
    assert.equal(d.phonetic, '/ˈɹɛəli/');
    assert.equal(d.part_of_speech, 'adverb');
    assert.match(d.definition, /^Not occurring/);
    assert.equal(d.example, 'He was rarely skilled.');
    assert.deepEqual(d.synonyms, ['infrequently', 'seldom']);   // tekrarsız
});

test('Free Dictionary: phonetic yoksa phonetics listesinden, eğik çizgisiz IPA tamamlanır', () => {
    const d = parseFreeDictionary([{ word: 'x', phonetics: [{}, { text: 'ɛks' }],
        meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A letter.' }] }] }]);
    assert.equal(d.phonetic, '/ɛks/');
});

test('Free Dictionary: bulunamadı yanıtı', () => {
    assert.equal(parseFreeDictionary({ title: 'No Definitions Found' }), null);
    assert.equal(parseFreeDictionary([]), null);
});

test('Datamuse yanıtı', () => {
    const d = parseDatamuse(DM_RARELY, DM_SYN, 'Rarely');
    assert.equal(d.phonetic, '/rˈɛrɫi/');
    assert.equal(d.part_of_speech, 'adverb');
    assert.equal(d.definition, 'Not occurring at a regular interval; seldom; not often.');
    assert.deepEqual(d.synonyms, ['seldom']);   // kelimenin kendisi çıkarıldı
    assert.equal(d.example, '');
});

test('Datamuse: farklı kelime dönerse kabul edilmez', () => {
    assert.equal(parseDatamuse([{ word: 'rarity', defs: ['n\tx'] }], [], 'rarely'), null);
    assert.equal(parseDatamuse([], [], 'rarely'), null);
});

function fakeFetch(routes) {
    return async url => {
        for (const [prefix, handler] of routes) {
            if (url.startsWith(prefix)) return handler();
        }
        throw new Error('beklenmeyen istek: ' + url);
    };
}
const ok = body => ({ ok: true, json: async () => body });

test('lookup: Free Dictionary çalışıyorsa onu kullanır', async () => {
    const d = await lookup('rarely', fakeFetch([
        ['https://api.dictionaryapi.dev/', () => ok(FREE_RARELY)],
    ]));
    assert.equal(d.example, 'He was rarely skilled.');
});

test('lookup: Free Dictionary kapalıysa Datamuse\'a geçer', async () => {
    const d = await lookup('rarely', fakeFetch([
        ['https://api.dictionaryapi.dev/', () => { throw new Error('522'); }],
        ['https://api.datamuse.com/words?sp=', () => ok(DM_RARELY)],
        ['https://api.datamuse.com/words?rel_syn=', () => ok(DM_SYN)],
    ]));
    assert.equal(d.phonetic, '/rˈɛrɫi/');
    assert.deepEqual(d.synonyms, ['seldom']);
});

test('lookup: Free Dictionary bir kez çökünce sonraki aramalarda beklenmez', async () => {
    let freeCalls = 0;
    const fetchImpl = fakeFetch([
        ['https://api.dictionaryapi.dev/', () => { freeCalls++; throw new Error('timeout'); }],
        ['https://api.datamuse.com/words?sp=', () => ok(DM_RARELY)],
        ['https://api.datamuse.com/words?rel_syn=', () => ok(DM_SYN)],
    ]);
    await lookup('rarely', fetchImpl);
    await lookup('rarely', fetchImpl);
    assert.equal(freeCalls, 1);
});

test('lookup: 404 servis çöktü sayılmaz', async () => {
    let freeCalls = 0;
    const fetchImpl = fakeFetch([
        ['https://api.dictionaryapi.dev/', () => { freeCalls++; return { ok: false, json: async () => ({}) }; }],
        ['https://api.datamuse.com/', () => ok([])],
    ]);
    await lookup('a', fetchImpl);
    await lookup('b', fetchImpl);
    assert.equal(freeCalls, 2);
});

test('lookup: kelime bulunamazsa (404) Datamuse denenir, o da yoksa null', async () => {
    const d = await lookup('asdfqwer', fakeFetch([
        ['https://api.dictionaryapi.dev/', () => ({ ok: false, json: async () => ({}) })],
        ['https://api.datamuse.com/', () => ok([])],
    ]));
    assert.equal(d, null);
});

test('lookup: internet yoksa null, boş kelime için istek atılmaz', async () => {
    const offline = async () => { throw new Error('offline'); };
    assert.equal(await lookup('rarely', offline), null);
    assert.equal(await lookup('   ', () => { throw new Error('çağrılmamalı'); }), null);
});
