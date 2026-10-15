// ── YAZILI CEVAP KONTROLÜ ────────────────────────────────────────
// Küçük yazım hatalarını ve Türkçe karakter eksikliğini tolere eder.
// Hem tarayıcıda (window.LinguaAnswer) hem Node testlerinde kullanılır.
(function (root) {
    const TR_FOLD = { 'ı': 'i', 'ş': 's', 'ğ': 'g', 'ü': 'u', 'ö': 'o', 'ç': 'c', 'â': 'a', 'î': 'i', 'û': 'u' };

    function normalize(text, lang) {
        let t = String(text || '').toLocaleLowerCase(lang === 'tr' ? 'tr-TR' : 'en-US');
        t = t.replace(/[’`]/g, "'")
             .replace(/[.,!?;:"()\[\]{}]/g, ' ')
             .replace(/\s+/g, ' ')
             .trim();
        if (lang === 'en') t = t.replace(/^(to|a|an|the) /, '');
        return t;
    }

    // Türkçe karakterleri ASCII karşılığına indirir (ş → s, ı → i ...)
    function fold(text) {
        return text.replace(/[ışğüöçâîû]/g, c => TR_FOLD[c]);
    }

    // "Sık sık, genellikle / çoğu zaman (gayri resmi)" → kabul edilen tüm yazımlar
    function variants(expected, lang) {
        const raw = String(expected || '');
        const withoutParens = raw.replace(/\([^)]*\)/g, ' ');
        const parts = [raw, withoutParens, ...withoutParens.split(/[,;/]|\bveya\b|\bor\b/i)];
        return [...new Set(parts.map(p => normalize(p, lang)).filter(Boolean))];
    }

    // Düzenleme mesafesi; yan yana iki harfin yer değiştirmesi ("recieve") tek hata sayılır
    function levenshtein(a, b) {
        if (a === b) return 0;
        const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
        for (let j = 1; j <= b.length; j++) d[0][j] = j;
        for (let i = 1; i <= a.length; i++) {
            for (let j = 1; j <= b.length; j++) {
                const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
                if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                    d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
                }
            }
        }
        return d[a.length][b.length];
    }

    // Kaç harf hatasına "neredeyse doğru" denir
    function allowedTypos(length) {
        if (length >= 8) return 2;
        if (length >= 4) return 1;
        return 0;
    }

    /**
     * @returns {{result: 'correct'|'close'|'wrong', accentOnly?: boolean}}
     *   correct: birebir ya da yalnızca Türkçe karakter farkı (accentOnly)
     *   close:   küçük yazım hatası
     *   wrong:   yanlış ya da boş
     */
    function checkAnswer(input, expected, lang) {
        const given = normalize(input, lang);
        if (!given) return { result: 'wrong' };

        let close = false;
        for (const v of variants(expected, lang)) {
            if (given === v) return { result: 'correct' };
            if (fold(given) === fold(v)) return { result: 'correct', accentOnly: true };
            if (levenshtein(fold(given), fold(v)) <= allowedTypos(v.length)) close = true;
        }
        return { result: close ? 'close' : 'wrong' };
    }

    const api = { normalize, variants, levenshtein, checkAnswer };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.LinguaAnswer = api;
})(typeof window !== 'undefined' ? window : globalThis);
