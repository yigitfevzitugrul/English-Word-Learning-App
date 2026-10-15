document.addEventListener('DOMContentLoaded', () => {
    window.addEventListener('pywebviewready', init);

    const form          = document.getElementById('wordForm');
    const submitBtn     = document.getElementById('submitBtn');
    const cancelEditBtn = document.getElementById('cancelEditBtn');
    const searchInput   = document.getElementById('searchInput');
    const filterBtns    = document.querySelectorAll('.filter-btn');

    let currentFilter  = 'all';
    let allWords       = [];
    let searchQuery    = '';
    let currentSort    = 'default';
    let currentView    = 'grid';   // 'grid' | 'list'
    let quizMode       = readPref('lingua-quiz-mode', ['classic', 'multi', 'type'], 'classic');
    let quizDir        = readPref('lingua-quiz-dir', ['en-tr', 'tr-en'], 'en-tr');
    let quizDailyLimit = 10; // will be loaded from backend in init()

    // ── INIT ──────────────────────────────────────────────────────────
    async function init() {
        await loadWords();
        await loadStreak();
        // Load persisted quiz limit from backend
        try {
            quizDailyLimit = await pywebview.api.get_quiz_limit();
        } catch { quizDailyLimit = 10; }
        applyQuizLimitUI();
        // Load persisted pronunciation settings
        const savedAccent = localStorage.getItem('lingua-accent') || 'us';
        const savedSpeed  = parseFloat(localStorage.getItem('lingua-speed') || '1.0');
        applyAccentUI(savedAccent);
        applySpeedUI(savedSpeed);
    }

    // ── THEME ────────────────────────────────────────────────────
    const savedTheme = localStorage.getItem('lingua-theme') || 'dark';
    applyTheme(savedTheme);

    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : '');
        document.getElementById('themeDark').classList.toggle('active', theme === 'dark');
        document.getElementById('themeLight').classList.toggle('active', theme === 'light');
    }

    window.setTheme = function (theme) {
        localStorage.setItem('lingua-theme', theme);
        applyTheme(theme);
    };

    // ── FORM PRONUNCIATION BUTTON ────────────────────────────────
    const speakFormBtn = document.getElementById('speakFormBtn');
    if (speakFormBtn) {
        speakFormBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const eng = document.getElementById('english').value.trim();
            if (eng) {
                speakWord(eng, speakFormBtn);
            } else {
                showToast('Lütfen önce bir İngilizce kelime girin.', 'error');
            }
        });
    }

    // ── AUTO-CAPITALIZE TRANSLATION ──────────────────────────────
    const translationInput = document.getElementById('translation');
    translationInput.addEventListener('input', () => {
        const val = translationInput.value;
        if (val.length > 0) {
            const cap = val.charAt(0).toUpperCase() + val.slice(1);
            if (cap !== val) {
                const pos = translationInput.selectionStart;
                translationInput.value = cap;
                translationInput.setSelectionRange(pos, pos);
            }
        }
    });

    // ── DICTIONARY LOOKUP ────────────────────────────────────────
    // formDetails: null = dokunulmadı (düzenlemede mevcut bilgi korunur), {} = silindi
    let formDetails      = null;
    let lastLookupWord   = '';
    let lookupSeq        = 0;
    const englishInput   = document.getElementById('english');
    const exampleInput   = document.getElementById('example');
    const dictStatus     = document.getElementById('dictStatus');
    const exampleSuggest = document.getElementById('exampleSuggestion');

    function hasDetails(d) {
        return !!(d && (d.phonetic || d.definition || (d.synonyms && d.synonyms.length)));
    }

    function renderDictInfo(d) {
        const box = document.getElementById('dictInfo');
        if (!hasDetails(d)) { box.style.display = 'none'; return; }
        document.getElementById('dictInfoMain').textContent =
            [d.phonetic, posLabel(d.part_of_speech)].filter(Boolean).join(' · ');
        document.getElementById('dictInfoDef').textContent = d.definition || '';
        document.getElementById('dictInfoSyn').textContent =
            d.synonyms && d.synonyms.length ? `Eş anlamlı: ${d.synonyms.join(', ')}` : '';
        box.style.display = 'flex';
    }

    function resetDictUI(details = null) {
        formDetails    = details;
        lastLookupWord = '';
        lookupSeq++;
        renderDictInfo(details);
        dictStatus.style.display     = 'none';
        exampleSuggest.style.display = 'none';
    }

    async function lookupDictionary(word) {
        const q = word.trim();
        if (!q || q.toLowerCase() === lastLookupWord) return;
        lastLookupWord = q.toLowerCase();
        const seq = ++lookupSeq;

        dictStatus.textContent   = 'Sözlükte aranıyor...';
        dictStatus.style.display = 'block';
        const result = await LinguaDictionary.lookup(q);
        if (seq !== lookupSeq) return;   // bu arada başka kelime yazıldı

        if (!result) {
            dictStatus.textContent = 'Sözlükte bulunamadı (ya da internet bağlantısı yok).';
            lastLookupWord = '';       // sonra yeniden denenebilsin
            return;
        }
        dictStatus.style.display = 'none';
        formDetails = result;
        renderDictInfo(result);

        if (result.example && !exampleInput.value.trim()) {
            exampleSuggest.textContent   = `Örnek cümle önerisi: ${result.example}`;
            exampleSuggest.style.display = 'block';
            exampleSuggest.onclick = () => {
                exampleInput.value = result.example;
                exampleSuggest.style.display = 'none';
            };
        }
    }

    // Kelime yazılıp alandan çıkılınca sözlük bilgisi kendiliğinden gelir
    englishInput.addEventListener('change', () => lookupDictionary(englishInput.value));

    document.getElementById('dictClearBtn').addEventListener('click', () => {
        resetDictUI({});
        lastLookupWord = englishInput.value.trim().toLowerCase();   // hemen yeniden getirmesin
    });

    // ── AUTO TRANSLATE ───────────────────────────────────────────
    document.getElementById('autoTranslateBtn').addEventListener('click', async () => {
        const eng = document.getElementById('english').value.trim();
        if (!eng) { showToast('Önce İngilizce kelimeyi girin.', 'error'); return; }
        lookupDictionary(eng);
        const btn = document.getElementById('autoTranslateBtn');
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        btn.disabled = true;
        try {
            const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(eng)}&langpair=en|tr`;
            const resp = await fetch(url);
            const data = await resp.json();
            const suggestion = data.responseData?.translatedText || '';
            if (suggestion) {
                const box = document.getElementById('translateSuggestion');
                box.textContent = `Öneri: ${suggestion}`;
                box.style.display = 'block';
                box.onclick = () => {
                    translationInput.value = suggestion.charAt(0).toUpperCase() + suggestion.slice(1);
                    box.style.display = 'none';
                };
            } else {
                showToast('Çeviri bulunamadı.', 'error');
            }
        } catch {
            showToast('Çeviri servisi erişilemiyor.', 'error');
        } finally {
            btn.innerHTML = '<i class="fas fa-magic"></i>';
            btn.disabled = false;
        }
    });

    // ── SEARCH ───────────────────────────────────────────────────
    searchInput.addEventListener('input', e => {
        searchQuery = e.target.value.toLowerCase();
        renderWords();
    });

    // ── FILTER ───────────────────────────────────────────────────
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.filter;
            renderWords();
        });
    });




    // ── SORT ─────────────────────────────────────────────────────
    const sortBtn      = document.getElementById('sortBtn');
    const sortDropdown = document.getElementById('sortDropdown');

    sortBtn.addEventListener('click', e => {
        e.stopPropagation();
        sortDropdown.classList.toggle('open');
    });

    document.addEventListener('click', () => sortDropdown.classList.remove('open'));

    sortDropdown.querySelectorAll('.sort-option').forEach(opt => {
        opt.addEventListener('click', () => {
            sortDropdown.querySelectorAll('.sort-option').forEach(o => o.classList.remove('active'));
            opt.classList.add('active');
            currentSort = opt.dataset.sort;
            sortDropdown.classList.remove('open');
            renderWords();
        });
    });

    // ── VIEW TOGGLE ──────────────────────────────────────────────
    document.getElementById('viewGridBtn').addEventListener('click', () => {
        currentView = 'grid';
        document.getElementById('viewGridBtn').classList.add('active');
        document.getElementById('viewListBtn').classList.remove('active');
        renderWords();
    });

    document.getElementById('viewListBtn').addEventListener('click', () => {
        currentView = 'list';
        document.getElementById('viewListBtn').classList.add('active');
        document.getElementById('viewGridBtn').classList.remove('active');
        renderWords();
    });

    // ── LOAD WORDS ───────────────────────────────────────────────
    async function loadWords() {
        try {
            allWords = await pywebview.api.get_words();
            renderWords();
        } catch (err) {
            console.error(err);
        }
    }

    async function loadStreak() {
        try {
            const s = await pywebview.api.get_streak();
            document.getElementById('streakCount').textContent = s.streak;
        } catch {}
    }


    // ── SORT HELPER ──────────────────────────────────────────────
    function sortWords(words) {
        const arr = [...words];
        switch (currentSort) {
            case 'alpha':      return arr.sort((a,b) => a.english.localeCompare(b.english));
            case 'alpha-desc': return arr.sort((a,b) => b.english.localeCompare(a.english));
            case 'wrong':   return arr.sort((a,b) => (b.quiz_wrong_count||0)-(a.quiz_wrong_count||0));
            case 'correct': return arr.sort((a,b) => (b.quiz_correct_count||0)-(a.quiz_correct_count||0));
            default:
                return arr.sort((a,b) => {
                    if (a.needs_review === b.needs_review) return b.id - a.id;
                    return a.needs_review ? -1 : 1;
                });
        }
    }

    // ── RENDER WORDS ─────────────────────────────────────────────
    function renderWords() {
        const grid = document.getElementById('wordsGrid');
        grid.innerHTML = '';

        document.getElementById('totalCount').textContent   = allWords.length;
        document.getElementById('reviewCount').textContent  = allWords.filter(w => w.needs_review).length;
        document.getElementById('learnedCount').textContent = allWords.filter(w => w.permanently_learned).length;

        let words = allWords;
        if (currentFilter === 'review')  words = words.filter(w => w.needs_review);
        if (currentFilter === 'learned') words = words.filter(w => w.permanently_learned);
        if (searchQuery) {
            words = words.filter(w =>
                w.english.toLowerCase().includes(searchQuery) ||
                w.translation.toLowerCase().includes(searchQuery) ||
                (w.example||'').toLowerCase().includes(searchQuery) ||
                (w.example_turkish||'').toLowerCase().includes(searchQuery) ||
                (w.notes||'').toLowerCase().includes(searchQuery) ||
                (w.definition||'').toLowerCase().includes(searchQuery)
            );
        }

        words = sortWords(words);

        if (words.length === 0) {
            const icon = currentFilter === 'review' ? 'fa-check-circle'
                       : currentFilter === 'learned' ? 'fa-trophy'
                       : (searchQuery ? 'fa-search' : 'fa-book-open');
            const msg = searchQuery ? 'Aramanıza uygun kelime bulunamadı.'
                      : currentFilter === 'review'  ? 'Tekrar edilecek kelime yok.'
                      : currentFilter === 'learned' ? 'Henüz kalıcı öğrenilen kelime yok.'
                      : 'Henüz kelime eklemediniz.';
            grid.innerHTML = `<div class="empty-state"><i class="fas ${icon}"></i><p>${msg}</p></div>`;
            return;
        }

        grid.className = currentView === 'list' ? 'words-list' : 'words-grid';

        words.forEach(word => {
            if (currentView === 'list') {
                grid.appendChild(buildListItem(word));
            } else {
                grid.appendChild(buildCard(word));
            }
        });
    }

    // ── BUILD GRID CARD ──────────────────────────────────────────
    function buildCard(word) {
        const card = document.createElement('div');
        const isPermanent = word.permanently_learned;
        card.className = `word-card${word.needs_review ? ' needs-review':''}${isPermanent ? ' permanently-learned':''}`;
        card.dataset.id = word.id;

        const s = word.srs;
        const isNew = s.due === null;
        let badge = '';
        if (isPermanent) {
            badge += '<span class="badge badge-permanent"><i class="fas fa-trophy"></i> Kalıcı</span>';
        }
        if (word.needs_review) {
            badge += isNew
                ? '<span class="badge badge-learning">Yeni</span>'
                : '<span class="badge badge-review">Tekrar Vakti</span>';
        } else if (!isPermanent) {
            badge += '<span class="badge badge-learned">Öğreniliyor</span>';
        }

        const intervalHtml = s.interval > 0
            ? `<span class="srs-interval" title="Son tekrar aralığı">${formatInterval(s.interval)}</span>`
            : '';
        const nextStr = isNew ? 'Henüz çalışılmadı' : `Sonraki tekrar ${formatDue(s.due)}`;

        const hasTr = word.example_turkish && word.example_turkish.trim();
        const trSection = hasTr ? `
            <div class="tr-wrap">
                <button class="btn-show-tr" data-action="toggle-tr">
                    <i class="fas fa-eye"></i> Türkçeyi Göster
                </button>
                <div class="tr-text" style="display:none;"></div>
            </div>` : '';

        const notesHtml = word.notes ? `<div class="word-notes"><i class="fas fa-sticky-note"></i> ${escapeHtml(word.notes)}</div>` : '';

        const reviewBtn = word.needs_review
            ? `<button class="icon-btn btn-review" data-action="review" title="Öğrendim"><i class="fas fa-check"></i></button>`
            : '';

        const exampleHtml = word.example ? `
            <div class="word-example-row">
                <div class="word-example">"${escapeHtml(word.example)}"</div>
                <button class="icon-btn btn-speak-sm" data-action="speak-example" title="Örnek cümleyi dinle">
                    <i class="fas fa-volume-up"></i>
                </button>
            </div>` : '';

        const phoneticText = [word.phonetic, posLabel(word.part_of_speech)].filter(Boolean).join(' · ');
        const phoneticHtml = phoneticText
            ? `<div class="word-phonetic" title="${escapeHtml(word.definition || '')}">${escapeHtml(phoneticText)}</div>`
            : '';

        card.innerHTML = `
            <div class="card-head">
                <div class="card-badges">${badge}</div>
                <div class="card-actions">
                    <button class="icon-btn btn-speak"  data-action="speak"  title="Sesli oku"><i class="fas fa-volume-up"></i></button>
                    <button class="icon-btn btn-edit"   data-action="edit"   title="Düzenle"><i class="fas fa-pencil"></i></button>
                    ${reviewBtn}
                    <button class="icon-btn btn-delete" data-action="delete" title="Sil"><i class="fas fa-trash"></i></button>
                </div>
            </div>
            <div class="card-body">
                <div class="word-english">${escapeHtml(word.english)}</div>
                ${phoneticHtml}
                <div class="word-turkish">${escapeHtml(word.translation)}</div>
            </div>
            ${exampleHtml}
            ${trSection}
            ${notesHtml}
            <div class="card-foot">
                ${intervalHtml}
                <span class="date-info"><i class="far fa-calendar"></i> ${nextStr}</span>
            </div>`;
        return card;
    }

    // ── BUILD LIST ITEM ──────────────────────────────────────────
    function buildListItem(word) {
        const item = document.createElement('div');
        const isPermanent = word.permanently_learned;
        item.className = `list-item${word.needs_review ? ' needs-review':''}${isPermanent ? ' permanently-learned':''}`;
        item.dataset.id = word.id;

        const reviewBtn = word.needs_review
            ? `<button class="icon-btn btn-review" data-action="review" title="Öğrendim"><i class="fas fa-check"></i></button>`
            : '';

        item.innerHTML = `
            <div class="list-item-left">
                <div class="word-english" style="font-size:15px;">${escapeHtml(word.english)}</div>
                <div class="word-turkish" style="font-size:13px;">${escapeHtml(word.translation)}</div>
            </div>
            <div class="list-item-right">
                <button class="icon-btn btn-speak"  data-action="speak"  title="Sesli oku"><i class="fas fa-volume-up"></i></button>
                <button class="icon-btn btn-edit"   data-action="edit"   title="Düzenle"><i class="fas fa-pencil"></i></button>
                ${reviewBtn}
                <button class="icon-btn btn-delete" data-action="delete" title="Sil"><i class="fas fa-trash"></i></button>
            </div>`;
        return item;
    }

    // ── CARD ACTIONS (event delegation) ──────────────────────────
    // Kelime verisi HTML'e gömülmez; id üzerinden allWords'ten okunur.
    document.getElementById('wordsGrid').addEventListener('click', e => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const item = btn.closest('[data-id]');
        const word = item && allWords.find(w => w.id === Number(item.dataset.id));
        if (!word) return;

        switch (btn.dataset.action) {
            case 'speak':         speakWord(word.english, btn); break;
            case 'speak-example': speakWord(word.example, btn); break;
            case 'toggle-tr':     toggleTurkish(btn, word.example_turkish); break;
            case 'edit':          editWord(word.id); break;
            case 'review':        reviewWord(word.id); break;
            case 'delete':        deleteWord(word.id); break;
        }
    });

    // ── SPEECH & PRONUNCIATION ENGINE ─────────────────────────────
    let activeAudio = null;
    let activeResetFn = null;

    window.getSpeechAccent = function() {
        return localStorage.getItem('lingua-accent') || 'us';
    };

    window.getSpeechSpeed = function() {
        return parseFloat(localStorage.getItem('lingua-speed') || '1.0');
    };

    function applyAccentUI(accent) {
        document.querySelectorAll('#accentGroup .speech-chip').forEach(btn => {
            btn.classList.toggle('active', btn.id === (accent === 'uk' ? 'accentUK' : 'accentUS'));
        });
    }

    function applySpeedUI(speed) {
        document.querySelectorAll('#speedGroup .speech-chip').forEach(btn => {
            btn.classList.toggle('active', parseFloat(btn.dataset.speed) === speed);
        });
    }

    window.setAccent = function(accent) {
        localStorage.setItem('lingua-accent', accent);
        applyAccentUI(accent);
    };

    window.setSpeed = function(speed) {
        localStorage.setItem('lingua-speed', speed.toString());
        applySpeedUI(speed);
    };

    window.testVoice = function() {
        const testBtn = document.getElementById('testVoiceBtn');
        const accent = window.getSpeechAccent();
        const sampleText = accent === 'uk' ? 'Brilliant English vocabulary!' : 'Welcome to native English pronunciation!';
        speakWord(sampleText, testBtn);
    };

    function getEnglishSpeechVoice(accent) {
        if (!window.speechSynthesis) return null;
        const voices = window.speechSynthesis.getVoices() || [];
        if (!voices || voices.length === 0) return null;

        const isUk = accent === 'uk';
        const pref = isUk ? ['en-gb', 'en_gb', 'united kingdom', 'hazel', 'george', 'susan']
                          : ['en-us', 'en_us', 'united states', 'zira', 'david', 'jenny', 'guy', 'aria', 'mark'];

        // 1. Try preferred accent voice
        let matched = voices.find(v => {
            const lang = (v.lang || '').toLowerCase();
            const name = (v.name || '').toLowerCase();
            return pref.some(p => lang.includes(p) || name.includes(p));
        });

        // 2. Try any English voice
        if (!matched) {
            matched = voices.find(v => {
                const lang = (v.lang || '').toLowerCase();
                const name = (v.name || '').toLowerCase();
                return lang.startsWith('en') || name.includes('english');
            });
        }

        // Return matched ONLY if it's truly an English voice
        return matched || null;
    }

    function playAudioUrl(url, speed) {
        return new Promise((resolve, reject) => {
            const audio = new Audio();
            audio.crossOrigin = 'anonymous';
            audio.src = url;
            audio.playbackRate = speed;
            activeAudio = audio;

            let finished = false;
            const done = (err) => {
                if (finished) return;
                finished = true;
                if (activeAudio === audio) activeAudio = null;
                if (err) reject(err);
                else resolve();
            };

            audio.onended = () => done(null);
            audio.onerror = (e) => done(e || new Error('Audio load error'));

            // Safety timeout
            const timer = setTimeout(() => {
                if (!finished && audio.paused && audio.currentTime === 0) {
                    done(new Error('Audio timeout'));
                }
            }, 6000);

            audio.play().catch(err => {
                clearTimeout(timer);
                done(err);
            });
        });
    }

    async function playAudioPipeline(cleanText, accent, speed) {
        const words = cleanText.split(/\s+/).filter(Boolean);
        const isShort = words.length <= 6 && cleanText.length <= 60;
        const youdaoType = accent === 'uk' ? 1 : 2;
        const youdaoUrl = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(cleanText)}&type=${youdaoType}`;
        const googleLang = accent === 'uk' ? 'en-GB' : 'en-US';
        const googleUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${googleLang}&client=tw-ob&q=${encodeURIComponent(cleanText)}`;

        // Determine URL order based on length
        const onlineUrls = isShort ? [youdaoUrl, googleUrl] : [googleUrl, youdaoUrl];

        // 1. Try Online Native Audio
        for (const url of onlineUrls) {
            try {
                await playAudioUrl(url, speed);
                return;
            } catch (e) {
                // Try next url
            }
        }

        // 2. Fallback to Web SpeechSynthesis (Strictly English Voice Only!)
        const englishVoice = getEnglishSpeechVoice(accent);
        if (englishVoice) {
            return new Promise((resolve, reject) => {
                try {
                    window.speechSynthesis.cancel();
                    const utt = new SpeechSynthesisUtterance(cleanText);
                    utt.voice = englishVoice;
                    utt.lang = englishVoice.lang || (accent === 'uk' ? 'en-GB' : 'en-US');
                    utt.rate = Math.max(0.6, Math.min(1.4, speed * 0.95));
                    utt.onend = () => resolve();
                    utt.onerror = () => reject();
                    window.speechSynthesis.speak(utt);
                } catch (e) {
                    reject(e);
                }
            });
        }

        // 3. Fallback to Python Backend Native SAPI (Desktop English Voice)
        // If web SpeechSynthesis only has Turkish (like Tolga), we NEVER pass English to it!
        if (window.pywebview && window.pywebview.api && window.pywebview.api.speak_offline) {
            try {
                await pywebview.api.speak_offline(cleanText, accent);
                return;
            } catch (e) {
                console.warn('speak_offline failed:', e);
            }
        }

        throw new Error('No English speech engine available');
    }

    window.speakWord = function(text, triggerEl) {
        if (!text || typeof text !== 'string') return;
        const cleanText = text.replace(/^["']|["']$/g, '').trim();
        if (!cleanText) return;

        // Reset previous playing button/audio
        if (activeResetFn) {
            activeResetFn();
            activeResetFn = null;
        }
        if (activeAudio) {
            try {
                activeAudio.pause();
                activeAudio.removeAttribute('src');
                activeAudio.load();
            } catch (e) {}
            activeAudio = null;
        }
        if (window.speechSynthesis) {
            try { window.speechSynthesis.cancel(); } catch (e) {}
        }

        // Button visual feedback
        let btn = triggerEl;
        if (!btn && window.event && window.event.currentTarget) {
            btn = window.event.currentTarget;
        }

        let resetBtn = () => {};
        if (btn && btn.classList) {
            btn.classList.add('speaking');
            const icon = btn.querySelector('i');
            const originalIconClass = icon ? icon.className : '';
            if (icon) icon.className = 'fas fa-volume-high';

            resetBtn = () => {
                btn.classList.remove('speaking');
                if (icon) icon.className = originalIconClass;
                if (activeResetFn === resetBtn) activeResetFn = null;
            };
            activeResetFn = resetBtn;
        }

        const accent = window.getSpeechAccent();
        const speed = window.getSpeechSpeed();

        playAudioPipeline(cleanText, accent, speed)
            .then(() => resetBtn())
            .catch(() => {
                resetBtn();
                showToast('Telaffuz sesi çalınamadı. İnternet bağlantınızı kontrol edin.', 'error');
            });
    };

    // ── TOGGLE TURKISH ───────────────────────────────────────────
    window.toggleTurkish = function(btn, text) {
        const wrap    = btn.parentElement;
        const textDiv = wrap.querySelector('.tr-text');
        const visible = textDiv.style.display !== 'none';
        if (visible) {
            textDiv.style.display = 'none';
            btn.innerHTML = '<i class="fas fa-eye"></i> Türkçeyi Göster';
        } else {
            textDiv.textContent   = text;
            textDiv.style.display = 'block';
            btn.innerHTML = '<i class="fas fa-eye-slash"></i> Türkçeyi Gizle';
        }
    };

    // ── FORM SUBMIT ──────────────────────────────────────────────
    form.addEventListener('submit', async e => {
        e.preventDefault();
        const english        = document.getElementById('english').value.trim();
        const translation    = document.getElementById('translation').value.trim();
        const example        = document.getElementById('example').value.trim();
        const exampleTurkish = document.getElementById('exampleTurkish').value.trim();
        const notes          = document.getElementById('wordNotes').value.trim();
        const isEditMode     = form.dataset.mode === 'edit';

        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Kaydediliyor...';
        submitBtn.disabled  = true;

        try {
            if (isEditMode) {
                await pywebview.api.update_word(parseInt(form.dataset.editId), english, translation,
                                                example, exampleTurkish, notes, formDetails);
                cancelEdit();
                showToast('Kelime güncellendi.');
            } else {
                await pywebview.api.add_word(english, translation, example, exampleTurkish, notes,
                                             formDetails || {});
                form.reset();
                resetDictUI();
                document.getElementById('translateSuggestion').style.display = 'none';
                showToast('Kelime eklendi.');
            }
            await loadWords();
        } catch (err) {
            console.error(err);
            showToast('Hata oluştu!', 'error');
        } finally {
            submitBtn.innerHTML = isEditMode
                ? '<i class="fas fa-save"></i> Değişiklikleri Kaydet'
                : '<i class="fas fa-plus"></i> Kelimeyi Kaydet';
            submitBtn.disabled = false;
        }
    });

    // ── CANCEL EDIT ──────────────────────────────────────────────
    window.cancelEdit = function() {
        form.reset();
        delete form.dataset.mode;
        delete form.dataset.editId;
        submitBtn.innerHTML = '<i class="fas fa-plus"></i> Kelimeyi Kaydet';
        cancelEditBtn.style.display = 'none';
        document.getElementById('formTitle').textContent = 'Yeni Kelime Ekle';
        document.getElementById('translateSuggestion').style.display = 'none';
        resetDictUI();
    };

    // ── EDIT WORD ────────────────────────────────────────────────
    window.editWord = function(id) {
        const word = allWords.find(w => w.id === id);
        if (!word) return;
        document.getElementById('english').value        = word.english;
        document.getElementById('translation').value    = word.translation;
        document.getElementById('example').value        = word.example;
        document.getElementById('exampleTurkish').value = word.example_turkish || '';
        document.getElementById('wordNotes').value      = word.notes || '';

        // Mevcut sözlük bilgisini göster; kelime değişmedikçe yeniden aranmaz
        resetDictUI(null);
        renderDictInfo(word);
        lastLookupWord = word.english.trim().toLowerCase();

        form.dataset.mode   = 'edit';
        form.dataset.editId = id;
        document.getElementById('formTitle').textContent = 'Kelimeyi Düzenle';
        submitBtn.innerHTML = '<i class="fas fa-save"></i> Değişiklikleri Kaydet';
        cancelEditBtn.style.display = 'flex';
        window.scrollTo({ top:0, behavior:'smooth' });
    };

    // ── REVIEW WORD ──────────────────────────────────────────────
    window.reviewWord = async function(id) {
        try {
            await pywebview.api.review_word(id);
            showToast('Kelime öğrenildi olarak işaretlendi.');
            await loadWords();
            await loadStreak();
        } catch (err) {
            console.error(err);
            showToast('Hata oluştu!', 'error');
        }
    };

    // ── DELETE WORD ──────────────────────────────────────────────
    let wordIdToDelete = null;
    const deleteModal      = document.getElementById('deleteModal');
    const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
    const cancelDeleteBtn  = document.getElementById('cancelDeleteBtn');

    window.deleteWord = function(id) {
        wordIdToDelete = id;
        deleteModal.style.display = 'flex';
    };

    cancelDeleteBtn.addEventListener('click', () => {
        deleteModal.style.display = 'none';
        wordIdToDelete = null;
    });

    confirmDeleteBtn.addEventListener('click', async () => {
        if (wordIdToDelete === null) return;
        try {
            await pywebview.api.delete_word(wordIdToDelete);
            showToast('Kelime silindi.');
            await loadWords();
        } catch (err) {
            console.error(err);
            showToast('Hata oluştu!', 'error');
        } finally {
            deleteModal.style.display = 'none';
            wordIdToDelete = null;
        }
    });

    // ── TOAST ────────────────────────────────────────────────────
    window.showToast = function(message, type = 'success') {
        const container = document.getElementById('toastContainer');
        const toast     = document.createElement('div');
        toast.className = `toast${type==='error'?' error':type==='gold'?' gold':''}`;
        const icon = type==='error' ? 'fa-exclamation-circle'
                   : type==='gold'  ? 'fa-trophy'
                   : 'fa-check-circle';
        toast.innerHTML = `<i class="fas ${icon}"></i> ${escapeHtml(message)}`;
        container.appendChild(toast);
        setTimeout(() => {
            toast.style.animation = 'toastOut 0.2s ease forwards';
            setTimeout(() => toast.remove(), 200);
        }, 3500);
    };

    // ── HELPERS ──────────────────────────────────────────────────
    function escapeHtml(str) {
        return String(str)
            .replace(/&/g,'&amp;').replace(/</g,'&lt;')
            .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
            .replace(/'/g,'&#039;');
    }

    // localStorage gizli pencerede ya da engelliyken hata verebilir
    function readPref(key, allowed, fallback) {
        try {
            const v = localStorage.getItem(key);
            return allowed.includes(v) ? v : fallback;
        } catch { return fallback; }
    }
    function savePref(key, value) {
        try { localStorage.setItem(key, value); } catch {}
    }

    const POS_LABELS = {
        noun: 'isim', verb: 'fiil', adjective: 'sıfat', adverb: 'zarf', pronoun: 'zamir',
        preposition: 'edat', conjunction: 'bağlaç', interjection: 'ünlem', determiner: 'belirleyici',
    };
    function posLabel(pos) {
        return POS_LABELS[pos] || pos;
    }

    // ── SRS FORMAT HELPERS ───────────────────────────────────────
    function formatInterval(days) {
        if (days <= 0)  return 'Bugün';
        if (days < 30)  return `${days} gün`;
        if (days < 365) return `${Math.round(days / 30)} ay`;
        return `${Math.round(days / 365)} yıl`;
    }

    // "YYYY-MM-DD" → "bugün", "yarın", "5 gün sonra", "12 Kas"
    function formatDue(due) {
        if (!due) return '';
        const [y, m, d] = due.split('-').map(Number);
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const diff = Math.round((new Date(y, m - 1, d) - today) / 86400000);
        if (diff <= 0) return 'bugün';
        if (diff === 1) return 'yarın';
        if (diff < 30)  return `${diff} gün sonra`;
        return new Date(y, m - 1, d).toLocaleDateString('tr-TR', {day: 'numeric', month: 'short'});
    }

    // ── QUIZ ─────────────────────────────────────────────────────
    let quizWords        = [];
    let allQuizWords     = [];   // for multiple-choice options
    let currentQuizIndex = 0;

    const mainContent    = document.getElementById('mainContent');
    const quizSection    = document.getElementById('quizSection');
    const quizContent    = document.getElementById('quizContent');
    const quizEmpty      = document.getElementById('quizEmpty');
    const quizCard       = document.getElementById('quizCard');
    const quizMultiCard  = document.getElementById('quizMultiCard');
    const quizHiddenPart = document.getElementById('quizHiddenPart');
    const quizActions    = document.getElementById('quizActions');
    const quizHint       = document.getElementById('quizHint');
    const quizTypeCard   = document.getElementById('quizTypeCard');

    function applyQuizToggleUI() {
        document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === quizMode));
        document.querySelectorAll('[data-dir]').forEach(b => b.classList.toggle('active', b.dataset.dir === quizDir));
    }
    applyQuizToggleUI();

    // Kaldığı karttan devam eder; cevaplanmış kartlar yeniden sorulmaz
    function rerenderCurrentCard() {
        if (quizContent.style.display !== 'none') showQuizCard();
    }

    window.setQuizMode = function(mode) {
        quizMode = mode;
        savePref('lingua-quiz-mode', mode);
        applyQuizToggleUI();
        rerenderCurrentCard();
    };

    window.setQuizDirection = function(dir) {
        quizDir = dir;
        savePref('lingua-quiz-dir', dir);
        applyQuizToggleUI();
        rerenderCurrentCard();
    };

    document.querySelector('.quiz-toggles').addEventListener('click', e => {
        const btn = e.target.closest('[data-mode], [data-dir]');
        if (!btn) return;
        btn.blur();   // Space/Enter kısayolları butona tekrar basmasın
        if (btn.dataset.mode) setQuizMode(btn.dataset.mode);
        else setQuizDirection(btn.dataset.dir);
    });

    document.getElementById('toggleQuizBtn').addEventListener('click', () => {
        mainContent.style.display  = 'none';
        document.getElementById('settingsPage').style.display = 'none';
        document.getElementById('statsPage').style.display    = 'none';
        quizSection.style.display  = 'flex';
        startQuiz();
    });

    document.getElementById('exitQuizBtn').addEventListener('click', () => {
        quizSection.style.display = 'none';
        mainContent.style.display = 'flex';
        loadWords();
        loadStreak();
    });

    // ── SETTINGS PAGE NAV ────────────────────────────────────────
    const settingsPage     = document.getElementById('settingsPage');
    const openSettingsBtn  = document.getElementById('openSettingsBtn');
    const closeSettingsBtn = document.getElementById('closeSettingsBtn');

    // ── QUIZ LIMIT CHIPS ─────────────────────────────────────────
    function applyQuizLimitUI() {
        document.querySelectorAll('.quiz-limit-chip').forEach(btn => {
            const val = parseInt(btn.dataset.limit, 10);
            btn.classList.toggle('active', val === quizDailyLimit);
        });
    }
    applyQuizLimitUI();

    document.getElementById('quizLimitGroup').addEventListener('click', e => {
        const btn = e.target.closest('.quiz-limit-chip');
        if (!btn) return;
        quizDailyLimit = parseInt(btn.dataset.limit, 10);
        // Persist to backend (stats.json) instead of localStorage
        pywebview.api.set_quiz_limit(quizDailyLimit).catch(err => console.error('set_quiz_limit error:', err));
        applyQuizLimitUI();
        showToast(quizDailyLimit === 0
            ? 'Quiz limiti kaldırıldı (sınırsız).'
            : `Günlük quiz limiti ${quizDailyLimit} kelime olarak ayarlandı.`);
    });

    openSettingsBtn.addEventListener('click', () => {
        mainContent.style.display  = 'none';
        quizSection.style.display  = 'none';
        document.getElementById('statsPage').style.display = 'none';
        settingsPage.style.display = 'flex';
    });

    closeSettingsBtn.addEventListener('click', () => {
        settingsPage.style.display = 'none';
        mainContent.style.display  = 'flex';
    });

    // ── STATS PAGE NAV ───────────────────────────────────────────
    const statsPage     = document.getElementById('statsPage');
    const openStatsBtn  = document.getElementById('openStatsBtn');
    const closeStatsBtn = document.getElementById('closeStatsBtn');

    openStatsBtn.addEventListener('click', async () => {
        mainContent.style.display  = 'none';
        quizSection.style.display  = 'none';
        settingsPage.style.display = 'none';
        statsPage.style.display    = 'flex';
        await renderStats();
    });

    closeStatsBtn.addEventListener('click', () => {
        statsPage.style.display = 'none';
        mainContent.style.display = 'flex';
    });

    // ── RENDER STATS ─────────────────────────────────────────────
    async function renderStats() {
        try {
            const s = await pywebview.api.get_statistics();

            document.getElementById('statTotal').textContent    = s.total;
            document.getElementById('statLearned').textContent  = s.learned;
            document.getElementById('statPermanent').textContent= s.permanent;
            document.getElementById('statReview').textContent   = s.review;
            document.getElementById('statStreak').textContent   = s.streak;

            // Bar chart (last 7 days)
            const chart = document.getElementById('statsBarChart');
            chart.innerHTML = '';
            const max = Math.max(...s.daily.map(d => d.count), 1);
            s.daily.forEach(d => {
                const date = new Date(d.date);
                const label = date.toLocaleDateString('tr-TR', {weekday:'short', day:'numeric'});
                const pct   = Math.round((d.count / max) * 100);
                chart.innerHTML += `
                    <div class="bar-col">
                        <div class="bar-count">${d.count}</div>
                        <div class="bar-wrap">
                            <div class="bar-fill" style="height:${pct}%"></div>
                        </div>
                        <div class="bar-label">${label}</div>
                    </div>`;
            });

            // Most wrong
            const wrongEl = document.getElementById('statsMostWrong');
            wrongEl.innerHTML = '';
            if (s.most_wrong.length === 0) {
                wrongEl.innerHTML = '<div class="stats-empty">Henüz yanlış yapılmadı 🎉</div>';
            } else {
                s.most_wrong.forEach(w => {
                    wrongEl.innerHTML += `
                        <div class="stats-list-item">
                            <div>
                                <span class="stats-word">${escapeHtml(w.english)}</span>
                                <span class="stats-word-tr">${escapeHtml(w.translation)}</span>
                            </div>
                            <span class="stats-wrong-badge">${w.wrong}×</span>
                        </div>`;
                });
            }

            // Category dist — removed
            // Difficulty dist — removed
        } catch(err) {
            console.error(err);
        }
    }

    function renderDistList(elId, dist) {
        const el = document.getElementById(elId);
        el.innerHTML = '';
        const entries = Object.entries(dist).sort((a,b) => b[1]-a[1]);
        const total   = entries.reduce((s,[,v]) => s+v, 0);
        if (entries.length === 0) {
            el.innerHTML = '<div class="stats-empty">Veri yok</div>';
            return;
        }
        entries.forEach(([key, val]) => {
            const pct = total > 0 ? Math.round(val/total*100) : 0;
            el.innerHTML += `
                <div class="dist-item">
                    <div class="dist-item-top">
                        <span class="dist-key">${escapeHtml(key)}</span>
                        <span class="dist-val">${val} (${pct}%)</span>
                    </div>
                    <div class="dist-bar-track">
                        <div class="dist-bar-fill" style="width:${pct}%"></div>
                    </div>
                </div>`;
        });
    }

    // ── EXPORT / IMPORT ──────────────────────────────────────────
    document.getElementById('exportJsonBtn').addEventListener('click', async () => {
        try {
            const words = await pywebview.api.export_words();
            const blob  = new Blob([JSON.stringify(words, null, 2)], {type:'application/json'});
            downloadBlob(blob, 'lingua_kelimeler.json');
            showToast('JSON olarak indirildi.');
        } catch { showToast('Dışa aktarma hatası.','error'); }
    });

    document.getElementById('exportCsvBtn').addEventListener('click', async () => {
        try {
            const words = await pywebview.api.export_words();
            const header = ['id','english','translation','example','example_turkish','notes',
                            'phonetic','part_of_speech','definition','synonyms',
                            'learned_at','quiz_correct_count','quiz_wrong_count','permanently_learned'];
            const cell   = v => Array.isArray(v) ? v.join('; ') : (v ?? '');
            const rows   = words.map(w => header.map(k => `"${String(cell(w[k])).replace(/"/g,'""')}"`).join(','));
            const csv    = [header.join(','), ...rows].join('\n');
            const blob   = new Blob(['\uFEFF'+csv], {type:'text/csv;charset=utf-8'});
            downloadBlob(blob, 'lingua_kelimeler.csv');
            showToast('CSV olarak indirildi.');
        } catch { showToast('Dışa aktarma hatası.','error'); }
    });

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a   = document.createElement('a');
        a.href    = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    document.getElementById('importFileInput').addEventListener('change', async e => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            if (!Array.isArray(data)) throw new Error('Geçersiz format');
            const result = await pywebview.api.import_words(data);
            showToast(`${result.imported} kelime içe aktarıldı, ${result.skipped} atlandı.`);
            await loadWords();
        } catch { showToast('İçe aktarma hatası. Geçerli bir JSON dosyası seçin.','error'); }
        e.target.value = '';
    });

    // ── FILL MISSING DICTIONARY DETAILS ──────────────────────────
    document.getElementById('fillDetailsBtn').addEventListener('click', async e => {
        const btn = e.currentTarget;
        const words = (await pywebview.api.get_words()).filter(w => !hasDetails(w));
        if (words.length === 0) {
            showToast('Tüm kelimelerin sözlük bilgisi zaten var.');
            return;
        }
        const original = btn.innerHTML;
        btn.disabled = true;
        let found = 0;
        try {
            for (let i = 0; i < words.length; i++) {
                btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${i + 1}/${words.length}`;
                const details = await LinguaDictionary.lookup(words[i].english);
                if (details) {
                    await pywebview.api.set_word_details(words[i].id, details);
                    found++;
                }
            }
            const missing = words.length - found;
            showToast(`${found} kelimenin sözlük bilgisi eklendi` +
                      (missing ? `, ${missing} kelime bulunamadı.` : '.'));
            await loadWords();
        } catch (err) {
            console.error(err);
            showToast('Sözlük bilgileri doldurulurken hata oluştu.', 'error');
        } finally {
            btn.innerHTML = original;
            btn.disabled = false;
        }
    });

    // ── QUIZ LOGIC ───────────────────────────────────────────────
    function queueText(info) {
        return `${info.reviews} tekrar · ${info.new} yeni`;
    }

    function showQuizEmpty(message) {
        quizContent.style.display = 'none';
        quizEmpty.style.display   = 'flex';
        document.getElementById('quizEmptyMsg').textContent = message;
    }

    function nextDueText(info) {
        return info.next_due ? ` Sonraki tekrar ${formatDue(info.next_due)}.` : '';
    }

    async function startQuiz() {
        try {
            const info = await pywebview.api.get_quiz_info();
            document.getElementById('quizQueueInfo').textContent = queueText(info);

            quizWords        = await pywebview.api.get_quiz_words(quizDailyLimit);
            allQuizWords     = await pywebview.api.get_all_words_for_quiz();
            currentQuizIndex = 0;

            if (quizWords.length === 0) {
                showQuizEmpty(info.total_words === 0
                    ? 'Henüz kelime eklemediniz.'
                    : 'Bugün tekrar edilecek kelime yok.' + nextDueText(info));
            } else {
                quizContent.style.display = 'flex';
                quizEmpty.style.display   = 'none';
                showQuizCard();
            }
        } catch(err) {
            console.error(err);
            showToast('Quiz yüklenirken hata oluştu!', 'error');
        }
    }

    async function finishQuiz() {
        showToast('Quiz tamamlandı!');
        try {
            const info = await pywebview.api.get_quiz_info();
            document.getElementById('quizQueueInfo').textContent = queueText(info);
            const left = info.reviews + info.new;
            showQuizEmpty(left > 0
                ? `Bu quiz bitti. Bugün ${left} kart daha bekliyor; devam etmek için quize yeniden gir.`
                : 'Bugünkü tüm tekrarları tamamladınız! 🎉' + nextDueText(info));
        } catch {
            showQuizEmpty('Bugünkü tüm tekrarları tamamladınız! 🎉');
        }
    }

    function renderSrsInfo(containerId, word) {
        const s = word.srs;
        let text;
        if (s.due === null)      text = 'Yeni kelime';
        else if (s.reps === 0)   text = 'Yeniden öğreniliyor';
        else                     text = `Son aralık: ${formatInterval(s.interval)} · ${s.reps}. doğru`;
        document.getElementById(containerId).textContent = text;
    }

    // Soru yönüne göre kartın soru ve cevap tarafı
    function sides(word) {
        return quizDir === 'tr-en'
            ? { prompt: word.translation, answer: word.english,     answerLang: 'en' }
            : { prompt: word.english,     answer: word.translation, answerLang: 'tr' };
    }

    // Sözlük bilgisi: "/ˈreə.li/ · zarf · tanım — eş anlamlı: seldom, hardly"
    function detailsText(word) {
        const parts = [];
        if (word.phonetic)       parts.push(word.phonetic);
        if (word.part_of_speech) parts.push(posLabel(word.part_of_speech));
        if (word.definition)     parts.push(word.definition);
        let text = parts.join(' · ');
        if (word.synonyms && word.synonyms.length) {
            text += `${text ? ' — ' : ''}eş anlamlı: ${word.synonyms.join(', ')}`;
        }
        return text;
    }

    function showExample(elId, word) {
        const el = document.getElementById(elId);
        el.textContent   = word.example ? `"${word.example}"` : '';
        el.style.display = word.example ? 'block' : 'none';
    }

    // Telaffuz butonu her zaman İngilizceyi okur. Tr → İng yönünde
    // cevap görünene kadar gizlenir, yoksa cevabı söylemiş olur.
    function bindSpeak(btnId, word, visible) {
        const btn = document.getElementById(btnId);
        btn.style.visibility = visible ? 'visible' : 'hidden';
        btn.onclick = e => { e.stopPropagation(); speakWord(word.english, btn); };
    }
    function revealSpeak(btnId) {
        document.getElementById(btnId).style.visibility = 'visible';
    }

    const SHORTCUTS = {
        classic: '<kbd>Space</kbd> çevir · <kbd>1</kbd> Bilmedim · <kbd>2</kbd> Zor · <kbd>3</kbd> Bildim · <kbd>Esc</kbd> çık',
        multi:   '<kbd>1</kbd>–<kbd>4</kbd> şık seç · <kbd>Esc</kbd> çık',
        type:    '<kbd>Enter</kbd> kontrol et / devam · <kbd>Esc</kbd> çık',
    };

    function showQuizCard() {
        if (currentQuizIndex >= quizWords.length) {
            finishQuiz();
            return;
        }
        const word = quizWords[currentQuizIndex];
        document.getElementById('quizProgress').textContent = `${currentQuizIndex+1} / ${quizWords.length}`;
        document.getElementById('quizShortcuts').innerHTML = SHORTCUTS[quizMode];

        quizCard.style.display      = quizMode === 'classic' ? 'flex' : 'none';
        quizMultiCard.style.display = quizMode === 'multi'   ? 'flex' : 'none';
        quizTypeCard.style.display  = quizMode === 'type'    ? 'flex' : 'none';
        quizActions.style.display   = 'none';

        if (quizMode === 'multi')     showMultiChoiceCard(word);
        else if (quizMode === 'type') showTypeCard(word);
        else                          showClassicCard(word);
    }

    // ── Klasik ──
    function showClassicCard(word) {
        const { prompt, answer } = sides(word);
        const trEn = quizDir === 'tr-en';

        document.getElementById('quizClassicLabel').textContent = trEn ? 'Türkçe anlam' : 'İngilizce kelime';
        document.getElementById('quizEnglish').textContent      = prompt;
        document.getElementById('quizTranslation').textContent  = answer;
        document.getElementById('quizDetails').textContent      = detailsText(word);
        showExample('quizExample', word);
        bindSpeak('quizClassicSpeakBtn', word, !trEn);

        const trEl = document.getElementById('quizExampleTurkish');
        if (word.example_turkish && word.example_turkish.trim()) {
            trEl.textContent   = `"${word.example_turkish}"`;
            trEl.style.display = 'block';
        } else {
            trEl.textContent   = '';
            trEl.style.display = 'none';
        }

        // Her cevabın bir sonraki tekrarı ne zamana atacağını göster
        quizActions.querySelectorAll('[data-hint]').forEach(el => {
            el.textContent = formatInterval(word.preview[el.dataset.hint]);
        });

        renderSrsInfo('quizSrsInfo', word);
        quizHiddenPart.style.display = 'none';
        quizHint.style.display       = 'block';
    }

    function revealClassic() {
        if (quizHiddenPart.style.display !== 'none') return;
        quizHiddenPart.style.display = 'flex';
        quizActions.style.display    = 'flex';
        quizHint.style.display       = 'none';
        revealSpeak('quizClassicSpeakBtn');
    }

    quizCard.addEventListener('click', revealClassic);

    quizActions.addEventListener('click', e => {
        const btn = e.target.closest('[data-grade]');
        if (btn) handleQuizAnswer(btn.dataset.grade);
    });

    // ── Çoktan seçmeli ──
    function showMultiChoiceCard(word) {
        const { prompt } = sides(word);
        const trEn = quizDir === 'tr-en';

        document.getElementById('quizMultiLabel').textContent = trEn
            ? 'Bu anlamın İngilizcesi hangisi?'
            : 'Bu kelimenin Türkçe anlamı nedir?';
        document.getElementById('quizMultiEnglish').textContent = prompt;
        bindSpeak('quizMultiSpeakBtn', word, !trEn);
        renderSrsInfo('quizMultiSrsInfo', word);

        const choicesEl = document.getElementById('quizMultiChoices');
        choicesEl.innerHTML = '';
        buildChoices(word).forEach((choice, i) => {
            const btn = document.createElement('button');
            btn.className = 'quiz-choice-btn';
            btn.textContent = `${i + 1}. ${choice.text}`;
            btn.dataset.correct = choice.isCorrect ? '1' : '';
            btn.addEventListener('click', () => handleMultiChoice(choice.isCorrect, choicesEl, btn));
            choicesEl.appendChild(btn);
        });
    }

    function buildChoices(currentWord) {
        const field = quizDir === 'tr-en' ? 'english' : 'translation';
        // Aynı anlamı taşıyan şıklar tekrar etmesin
        const norm = s => (s || '').trim().toLocaleLowerCase('tr-TR');
        const seen = new Set([norm(currentWord[field])]);
        const others = allQuizWords
            .filter(w => w.id !== currentWord.id)
            .sort(() => Math.random() - 0.5)
            .filter(w => {
                const key = norm(w[field]);
                if (!key || seen.has(key)) return false;
                seen.add(key);
                return true;
            })
            .slice(0, 3);
        return [
            {text: currentWord[field], isCorrect: true},
            ...others.map(w => ({text: w[field], isCorrect: false}))
        ].sort(() => Math.random() - 0.5);
    }

    async function handleMultiChoice(isCorrect, choicesEl, clickedBtn) {
        if (clickedBtn.disabled) return;
        choicesEl.querySelectorAll('.quiz-choice-btn').forEach(b => b.disabled = true);
        clickedBtn.classList.add(isCorrect ? 'correct' : 'wrong');
        revealSpeak('quizMultiSpeakBtn');

        if (!isCorrect) {
            choicesEl.querySelectorAll('.quiz-choice-btn[data-correct="1"]')
                .forEach(b => b.classList.add('correct'));
        }

        await handleQuizAnswer(isCorrect ? 'good' : 'again', true);
        setTimeout(() => {
            currentQuizIndex++;
            showQuizCard();
        }, 900);
    }

    // ── Yazarak ──
    let typeState = null;   // kontrol edildikten sonra { grade } olur

    function showTypeCard(word) {
        const { prompt } = sides(word);
        const trEn = quizDir === 'tr-en';
        typeState = null;

        document.getElementById('quizTypeLabel').textContent  = trEn ? 'İngilizcesini yaz' : 'Türkçe anlamını yaz';
        document.getElementById('quizTypePrompt').textContent = prompt;
        bindSpeak('quizTypeSpeakBtn', word, !trEn);
        renderSrsInfo('quizTypeSrsInfo', word);

        const input = document.getElementById('quizTypeInput');
        input.value       = '';
        input.readOnly    = false;
        input.className   = 'quiz-type-input';
        input.placeholder = trEn ? 'İngilizce kelimeyi yaz...' : 'Türkçe anlamını yaz...';
        document.getElementById('quizTypeCheckBtn').style.display = '';
        document.getElementById('quizTypeResult').style.display   = 'none';
        setTimeout(() => input.focus(), 0);
    }

    function checkTyped() {
        if (typeState) return;
        const word  = quizWords[currentQuizIndex];
        const input = document.getElementById('quizTypeInput');
        const { answer, answerLang } = sides(word);
        const { result, accentOnly } = LinguaAnswer.checkAnswer(input.value, answer, answerLang);
        typeState = { grade: { correct: 'good', close: 'hard', wrong: 'again' }[result] };

        // disabled yerine readOnly: odak kutuda kalır, ikinci Enter "Devam" olur
        input.readOnly = true;
        input.classList.add(result);
        document.getElementById('quizTypeCheckBtn').style.display = 'none';

        const answerHtml = `<strong>${escapeHtml(answer)}</strong>`;
        const verdict = document.getElementById('quizTypeVerdict');
        verdict.className = `quiz-type-verdict ${result}`;
        verdict.innerHTML =
              result === 'correct' ? (accentOnly ? `✓ Doğru! Yazımı: ${answerHtml}` : '✓ Doğru!')
            : result === 'close'   ? `≈ Neredeyse! Doğru yazımı: ${answerHtml}`
            :                        `✗ Doğrusu: ${answerHtml}`;

        document.getElementById('quizTypeDetails').textContent = detailsText(word);
        showExample('quizTypeExample', word);
        // Eş anlamlı bir cevap yazdıysan doğru sayabilirsin
        document.getElementById('quizTypeOverrideBtn').style.display = result === 'correct' ? 'none' : '';
        document.getElementById('quizTypeResult').style.display = 'flex';
        revealSpeak('quizTypeSpeakBtn');
    }

    function continueTyped(grade) {
        if (!typeState) return;
        const g = grade || typeState.grade;
        typeState = null;   // çift basmayı engeller
        handleQuizAnswer(g);
    }

    // Enter: önce kontrol eder, sonucu gösterdikten sonra bir sonraki karta geçer
    document.getElementById('quizTypeForm').addEventListener('submit', e => {
        e.preventDefault();
        if (typeState) continueTyped();
        else checkTyped();
    });
    document.getElementById('quizTypeNextBtn').addEventListener('click', () => continueTyped());
    document.getElementById('quizTypeOverrideBtn').addEventListener('click', () => continueTyped('good'));

    // ── Klavye kısayolları ──
    document.addEventListener('keydown', e => {
        if (quizSection.style.display === 'none') return;
        if (e.ctrlKey || e.altKey || e.metaKey) return;

        if (e.key === 'Escape') {
            e.preventDefault();
            document.getElementById('exitQuizBtn').click();
            return;
        }
        if (quizContent.style.display === 'none') return;
        if (e.target.matches('input, textarea')) return;   // yazma alanında Enter formu gönderir

        let handled = true;
        if (quizMode === 'classic') {
            if (e.key === ' ' || e.key === 'Enter') revealClassic();
            else if (/^[123]$/.test(e.key) && quizHiddenPart.style.display !== 'none') {
                handleQuizAnswer(['again', 'hard', 'good'][Number(e.key) - 1]);
            } else handled = false;
        } else if (quizMode === 'multi') {
            const btn = document.querySelectorAll('#quizMultiChoices .quiz-choice-btn')[Number(e.key) - 1];
            if (/^[1-4]$/.test(e.key) && btn) btn.click();
            else handled = false;
        } else if (quizMode === 'type') {
            // Odak yazı kutusunun dışındaysa (ör. butona tıklandıysa) Enter yine devam eder
            if (e.key === 'Enter' && typeState) continueTyped();
            else handled = false;
        }
        if (handled) e.preventDefault();
    });

    let answering = false;

    async function handleQuizAnswer(grade, skipAdvance=false) {
        if (answering) return;
        answering = true;
        quizActions.querySelectorAll('button').forEach(b => b.disabled = true);

        const word = quizWords[currentQuizIndex];
        try {
            const result = await pywebview.api.record_quiz_answer(word.id, grade);
            if (result) {
                if (grade === 'again') {
                    // Bilinmeyen kelime bu quizin sonunda tekrar sorulur
                    quizWords.push({...word, srs: result.srs, preview: result.preview});
                } else if (result.mastered_now) {
                    showToast(`🏆 "${word.english}" kalıcı olarak öğrenildi!`, 'gold');
                } else {
                    showToast(`"${word.english}" – sonraki tekrar ${formatDue(result.srs.due)}.`);
                }
            }
            document.getElementById('streakCount').textContent = (await pywebview.api.get_streak()).streak;
        } catch(err) {
            console.error(err);
            showToast('Cevap kaydedilemedi!', 'error');
        } finally {
            answering = false;
            quizActions.querySelectorAll('button').forEach(b => b.disabled = false);
        }
        if (!skipAdvance) {
            currentQuizIndex++;
            showQuizCard();
        }
    }
});
