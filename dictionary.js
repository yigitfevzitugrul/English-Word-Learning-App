// ── SÖZLÜK BİLGİSİ ───────────────────────────────────────────────
// Telaffuz (IPA), kelime türü, İngilizce tanım, eş anlamlılar ve örnek cümle.
// Önce Free Dictionary API denenir (örnek cümle de verir); yanıt vermezse
// Datamuse'a geçilir. Hem tarayıcıda (window.LinguaDictionary) hem Node
// testlerinde kullanılır.
(function (root) {
    const FREE_URL     = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
    const DATAMUSE_URL = 'https://api.datamuse.com/words';
    const TIMEOUT_MS   = 5000;
    const MAX_SYNONYMS = 5;
    const RETRY_FREE_AFTER_MS = 10 * 60 * 1000;

    // Free Dictionary yanıt vermezse bir süre hiç denenmez; yoksa her arama
    // (ör. 59 kelimelik toplu doldurma) 5 sn zaman aşımı bekler.
    let freeDownUntil = 0;

    const DATAMUSE_POS = { n: 'noun', v: 'verb', adj: 'adjective', adv: 'adverb' };

    function slashed(ipa) {
        const t = String(ipa || '').trim();
        if (!t) return '';
        return /^[\/\[]/.test(t) ? t : `/${t}/`;
    }

    function unique(list, exclude) {
        const seen = new Set([String(exclude || '').toLowerCase()]);
        const out = [];
        for (const s of list) {
            const key = String(s || '').trim().toLowerCase();
            if (!key || seen.has(key)) continue;
            seen.add(key);
            out.push(String(s).trim());
        }
        return out;
    }

    // dictionaryapi.dev yanıtı → ortak biçim (bulunamazsa null)
    function parseFreeDictionary(data) {
        if (!Array.isArray(data) || !data.length) return null;
        const entry = data[0];
        const meanings = entry.meanings || [];
        const first = meanings[0];
        const definition = first && first.definitions && first.definitions[0]
            ? first.definitions[0].definition : '';

        let example = '';
        for (const m of meanings) {
            const d = (m.definitions || []).find(x => x.example);
            if (d) { example = d.example; break; }
        }

        const synonyms = unique(meanings.flatMap(m => [
            ...(m.synonyms || []),
            ...(m.definitions || []).flatMap(d => d.synonyms || []),
        ]), entry.word).slice(0, MAX_SYNONYMS);

        const phonetic = entry.phonetic
            || ((entry.phonetics || []).find(p => p.text) || {}).text || '';

        const result = {
            phonetic:       slashed(phonetic),
            part_of_speech: first ? first.partOfSpeech || '' : '',
            definition:     definition || '',
            synonyms,
            example,
        };
        return result.definition || result.phonetic ? result : null;
    }

    // Datamuse yanıtı (+ eş anlamlı listesi) → ortak biçim (bulunamazsa null)
    function parseDatamuse(entries, synEntries, query) {
        const q = String(query || '').trim().toLowerCase();
        const entry = (entries || []).find(e => String(e.word).toLowerCase() === q);
        if (!entry) return null;

        const tags = entry.tags || [];
        const ipaTag = tags.find(t => t.startsWith('ipa_pron:'));
        const [posTag = '', defText = ''] = ((entry.defs || [])[0] || '').split('\t');
        const pos = DATAMUSE_POS[posTag] || DATAMUSE_POS[tags.find(t => DATAMUSE_POS[t])] || '';

        const result = {
            phonetic:       ipaTag ? slashed(ipaTag.slice('ipa_pron:'.length)) : '',
            part_of_speech: pos,
            definition:     defText.trim(),
            synonyms:       unique((synEntries || []).map(s => s.word), entry.word).slice(0, MAX_SYNONYMS),
            example:        '',
        };
        return result.definition || result.phonetic ? result : null;
    }

    async function fetchJson(url, fetchImpl) {
        const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null;
        try {
            const resp = await fetchImpl(url, ctrl ? { signal: ctrl.signal } : undefined);
            if (!resp.ok) return null;
            return await resp.json();
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    /** Kelimenin sözlük bilgisini döndürür; bulunamazsa ya da internet yoksa null. */
    async function lookup(word, fetchImpl) {
        const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
        const q = String(word || '').trim();
        if (!q || !doFetch) return null;

        if (Date.now() >= freeDownUntil) {
            try {
                const free = parseFreeDictionary(await fetchJson(FREE_URL + encodeURIComponent(q), doFetch));
                if (free) return free;
            } catch {
                // servis kapalı ya da zaman aşımı (404 değil): bir süre Datamuse kullan
                freeDownUntil = Date.now() + RETRY_FREE_AFTER_MS;
            }
        }

        try {
            const enc = encodeURIComponent(q);
            const [entries, syns] = await Promise.all([
                fetchJson(`${DATAMUSE_URL}?sp=${enc}&md=dpr&ipa=1&max=1`, doFetch),
                fetchJson(`${DATAMUSE_URL}?rel_syn=${enc}&max=${MAX_SYNONYMS}`, doFetch).catch(() => []),
            ]);
            return parseDatamuse(entries, syns, q);
        } catch {
            return null;
        }
    }

    function resetServiceState() { freeDownUntil = 0; }   // testler için

    const api = { lookup, parseFreeDictionary, parseDatamuse, resetServiceState };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.LinguaDictionary = api;
})(typeof window !== 'undefined' ? window : globalThis);
