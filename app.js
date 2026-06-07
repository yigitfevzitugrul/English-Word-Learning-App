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
    let quizMode       = 'classic'; // 'classic' | 'multi'
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

    // ── AUTO TRANSLATE ───────────────────────────────────────────
    document.getElementById('autoTranslateBtn').addEventListener('click', async () => {
        const eng = document.getElementById('english').value.trim();
        if (!eng) { showToast('Önce İngilizce kelimeyi girin.', 'error'); return; }
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
                (w.notes||'').toLowerCase().includes(searchQuery)
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

        let badge;
        if (isPermanent) {
            badge = '<span class="badge badge-permanent"><i class="fas fa-trophy"></i> Kalıcı Öğrenildi</span>';
        } else if (word.needs_review) {
            badge = word.learned_at
                ? '<span class="badge badge-review">Tekrar Vakti</span>'
                : '<span class="badge badge-learning">Yeni</span>';
        } else {
            badge = '<span class="badge badge-learned">Öğrenildi</span>';
        }

        const count = word.quiz_correct_count || 0;
        let dotsHtml = '';
        if (!isPermanent) {
            const dots = Array.from({length:4}, (_,i) =>
                `<span class="dot ${i<count?'filled':''}"></span>`
            ).join('');
            dotsHtml = `<div class="card-quiz-dots" title="${count}/4 doğru">${dots}</div>`;
        }

        let dateStr = 'Henüz öğrenilmedi';
        if (word.learned_at) {
            dateStr = new Date(word.learned_at).toLocaleString('tr-TR', {
                day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'
            });
        }

        const hasTr = word.example_turkish && word.example_turkish.trim();
        const trSection = hasTr ? `
            <div class="tr-wrap">
                <button class="btn-show-tr" onclick="toggleTurkish(this,'${escapeJs(word.example_turkish)}')">
                    <i class="fas fa-eye"></i> Türkçeyi Göster
                </button>
                <div class="tr-text" style="display:none;"></div>
            </div>` : '';

        const notesHtml = word.notes ? `<div class="word-notes"><i class="fas fa-sticky-note"></i> ${escapeHtml(word.notes)}</div>` : '';

        const reviewBtn = (word.needs_review && !isPermanent)
            ? `<button class="icon-btn btn-review" onclick="reviewWord(${word.id})" title="Öğrendim"><i class="fas fa-check"></i></button>`
            : '';

        card.innerHTML = `
            <div class="card-head">
                <div class="card-badges">${badge}</div>
                <div class="card-actions">
                    <button class="icon-btn btn-speak" onclick="speakWord('${escapeJs(word.english)}')" title="Sesli oku"><i class="fas fa-volume-up"></i></button>
                    <button class="icon-btn btn-edit"   onclick="editWord(${word.id})"   title="Düzenle"><i class="fas fa-pencil"></i></button>
                    ${reviewBtn}
                    <button class="icon-btn btn-delete" onclick="deleteWord(${word.id})" title="Sil"><i class="fas fa-trash"></i></button>
                </div>
            </div>
            <div class="card-body">
                <div class="word-english">${escapeHtml(word.english)}</div>
                <div class="word-turkish">${escapeHtml(word.translation)}</div>
            </div>
            <div class="word-example">"${escapeHtml(word.example)}"</div>
            ${trSection}
            ${notesHtml}
            <div class="card-foot">
                ${dotsHtml}
                <span class="date-info"><i class="far fa-clock"></i> ${dateStr}</span>
            </div>`;
        return card;
    }

    // ── BUILD LIST ITEM ──────────────────────────────────────────
    function buildListItem(word) {
        const item = document.createElement('div');
        const isPermanent = word.permanently_learned;
        item.className = `list-item${word.needs_review ? ' needs-review':''}${isPermanent ? ' permanently-learned':''}`;

        const reviewBtn = (word.needs_review && !isPermanent)
            ? `<button class="icon-btn btn-review" onclick="reviewWord(${word.id})" title="Öğrendim"><i class="fas fa-check"></i></button>`
            : '';

        item.innerHTML = `
            <div class="list-item-left">
                <div class="word-english" style="font-size:15px;">${escapeHtml(word.english)}</div>
                <div class="word-turkish" style="font-size:13px;">${escapeHtml(word.translation)}</div>
            </div>
            <div class="list-item-right">
                <button class="icon-btn btn-speak" onclick="speakWord('${escapeJs(word.english)}')" title="Sesli oku"><i class="fas fa-volume-up"></i></button>
                <button class="icon-btn btn-edit"   onclick="editWord(${word.id})"   title="Düzenle"><i class="fas fa-pencil"></i></button>
                ${reviewBtn}
                <button class="icon-btn btn-delete" onclick="deleteWord(${word.id})" title="Sil"><i class="fas fa-trash"></i></button>
            </div>`;
        return item;
    }

    // ── SPEECH ───────────────────────────────────────────────────
    window.speakWord = function(text) {
        if (!window.speechSynthesis) return;
        window.speechSynthesis.cancel();
        const utt = new SpeechSynthesisUtterance(text);
        utt.lang = 'en-US';
        utt.rate = 0.9;
        window.speechSynthesis.speak(utt);
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
                await pywebview.api.update_word(parseInt(form.dataset.editId), english, translation, example, exampleTurkish, notes);
                cancelEdit();
                showToast('Kelime güncellendi.');
            } else {
                await pywebview.api.add_word(english, translation, example, exampleTurkish, notes);
                form.reset();
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
            await loadCategories();
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
    function escapeJs(str) {
        return String(str)
            .replace(/\\/g,'\\\\').replace(/'/g,"\\'")
            .replace(/"/g,'\\"').replace(/\n/g,'\\n');
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

    window.setQuizMode = function(mode) {
        quizMode = mode;
        document.getElementById('quizModeClassic').classList.toggle('active', mode==='classic');
        document.getElementById('quizModeMulti').classList.toggle('active', mode==='multi');
        currentQuizIndex = 0;
        showQuizCard();
    };

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
            const header = ['id','english','translation','example','example_turkish','category','difficulty','notes','learned_at','quiz_correct_count','quiz_wrong_count','permanently_learned'];
            const rows   = words.map(w => header.map(k => `"${String(w[k]||'').replace(/"/g,'""')}"`).join(','));
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
            await loadCategories();
        } catch { showToast('İçe aktarma hatası. Geçerli bir JSON dosyası seçin.','error'); }
        e.target.value = '';
    });

    // ── QUIZ LOGIC ───────────────────────────────────────────────
    async function startQuiz() {
        try {
            const info = await pywebview.api.get_quiz_info();
            document.getElementById('quizDayName').textContent    = info.day_name;
            document.getElementById('quizGroupNum').textContent   = info.group_number;
            document.getElementById('quizGroupCount').textContent = `${info.remaining} kelime`;

            quizWords        = await pywebview.api.get_quiz_words(quizDailyLimit);
            allQuizWords     = await pywebview.api.get_all_words_for_quiz();
            currentQuizIndex = 0;

            if (quizWords.length === 0) {
                quizContent.style.display = 'none';
                quizEmpty.style.display   = 'flex';
                const emptyMsg = document.getElementById('quizEmptyMsg');
                emptyMsg.textContent = info.words_in_group === 0
                    ? 'Bu gruba henüz kelime atanmadı.'
                    : `Bugünkü ${info.group_number}. grup kelimelerini tamamladınız! 🎉`;
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

    function renderCorrectDots(containerId, count) {
        const container = document.getElementById(containerId);
        container.innerHTML = '';
        for (let i=0; i<4; i++) {
            const dot = document.createElement('span');
            dot.className = `quiz-dot${i<count?' filled':''}`;
            dot.title = `${count}/4 doğru`;
            container.appendChild(dot);
        }
    }

    function showQuizCard() {
        if (currentQuizIndex >= quizWords.length) {
            quizContent.style.display = 'none';
            quizEmpty.style.display   = 'flex';
            document.getElementById('quizEmptyMsg').textContent = 'Bugünkü tüm kelimeleri tamamladınız! 🎉';
            showToast('Bugünkü quiz tamamlandı!');
            return;
        }
        const word = quizWords[currentQuizIndex];
        document.getElementById('quizProgress').textContent = `${currentQuizIndex+1} / ${quizWords.length}`;

        if (quizMode === 'multi') {
            showMultiChoiceCard(word);
        } else {
            showClassicCard(word);
        }
    }

    function showClassicCard(word) {
        quizCard.style.display      = 'flex';
        quizMultiCard.style.display = 'none';
        quizActions.style.display   = 'none';

        document.getElementById('quizEnglish').textContent     = word.english;
        document.getElementById('quizTranslation').textContent = word.translation;
        document.getElementById('quizExample').textContent     = `"${word.example}"`;

        const trEl = document.getElementById('quizExampleTurkish');
        if (word.example_turkish && word.example_turkish.trim()) {
            trEl.textContent   = `"${word.example_turkish}"`;
            trEl.style.display = 'block';
        } else {
            trEl.textContent   = '';
            trEl.style.display = 'none';
        }

        renderCorrectDots('quizCorrectDots', word.quiz_correct_count||0);
        quizHiddenPart.style.display = 'none';
        quizActions.style.display    = 'none';
        quizHint.style.display       = 'block';
    }

    function showMultiChoiceCard(word) {
        quizCard.style.display      = 'none';
        quizMultiCard.style.display = 'flex';
        quizActions.style.display   = 'none';

        document.getElementById('quizMultiEnglish').textContent = word.english;
        renderCorrectDots('quizMultiCorrectDots', word.quiz_correct_count||0);

        // Build 4 choices: correct + 3 random wrong
        const choices = buildChoices(word);
        const choicesEl = document.getElementById('quizMultiChoices');
        choicesEl.innerHTML = '';
        choices.forEach(choice => {
            const btn = document.createElement('button');
            btn.className = 'quiz-choice-btn';
            btn.textContent = choice.translation;
            btn.addEventListener('click', () => handleMultiChoice(choice.isCorrect, choicesEl, btn));
            choicesEl.appendChild(btn);
        });
    }

    function buildChoices(currentWord) {
        const others = allQuizWords
            .filter(w => w.id !== currentWord.id)
            .sort(() => Math.random() - 0.5)
            .slice(0, 3);
        const choices = [
            {translation: currentWord.translation, isCorrect: true},
            ...others.map(w => ({translation: w.translation, isCorrect: false}))
        ].sort(() => Math.random() - 0.5);
        return choices;
    }

    async function handleMultiChoice(isCorrect, choicesEl, clickedBtn) {
        // Disable all buttons
        choicesEl.querySelectorAll('.quiz-choice-btn').forEach(b => b.disabled = true);
        clickedBtn.classList.add(isCorrect ? 'correct' : 'wrong');

        // Show correct answer if wrong
        if (!isCorrect) {
            const word = quizWords[currentQuizIndex];
            choicesEl.querySelectorAll('.quiz-choice-btn').forEach(b => {
                if (b.textContent === word.translation) b.classList.add('correct');
            });
        }

        await handleQuizAnswer(isCorrect, true);
        setTimeout(() => {
            currentQuizIndex++;
            showQuizCard();
        }, 900);
    }

    quizCard.addEventListener('click', () => {
        if (quizHiddenPart.style.display === 'none') {
            quizHiddenPart.style.display = 'flex';
            quizActions.style.display    = 'flex';
            quizHint.style.display       = 'none';
        }
    });

    window.handleQuizAnswer = async function(knewIt, skipAdvance=false) {
        const word = quizWords[currentQuizIndex];
        try {
            const result = await pywebview.api.record_quiz_answer(word.id, knewIt);
            if (result.permanently_learned) {
                showToast(`🏆 "${word.english}" kalıcı olarak öğrenildi!`, 'gold');
            } else if (knewIt) {
                const remaining = 4 - result.quiz_correct_count;
                if (remaining > 0) {
                    showToast(`"${word.english}" – ${result.quiz_correct_count}/4 doğru. ${remaining} kez daha!`);
                }
            }
            document.getElementById('streakCount').textContent = (await pywebview.api.get_streak()).streak;
        } catch(err) {
            console.error(err);
        }
        if (!skipAdvance) {
            currentQuizIndex++;
            showQuizCard();
        }
    };
});
