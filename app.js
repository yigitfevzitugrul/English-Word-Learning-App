document.addEventListener('DOMContentLoaded', () => {
    window.addEventListener('pywebviewready', loadWords);

    const form          = document.getElementById('wordForm');
    const submitBtn     = document.getElementById('submitBtn');
    const cancelEditBtn = document.getElementById('cancelEditBtn');
    const searchInput   = document.getElementById('searchInput');
    const filterBtns    = document.querySelectorAll('.filter-btn');

    let currentFilter = 'all';
    let allWords      = [];
    let searchQuery   = '';

    // ── SEARCH ──────────────────────────────────────────────────
    searchInput.addEventListener('input', e => {
        searchQuery = e.target.value.toLowerCase();
        renderWords();
    });

    // ── FILTER ──────────────────────────────────────────────────
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.filter;
            renderWords();
        });
    });

    // ── FORM SUBMIT ──────────────────────────────────────────────
    form.addEventListener('submit', async e => {
        e.preventDefault();
        const english        = document.getElementById('english').value.trim();
        const translation    = document.getElementById('translation').value.trim();
        const example        = document.getElementById('example').value.trim();
        const exampleTurkish = document.getElementById('exampleTurkish').value.trim();
        const isEditMode     = form.dataset.mode === 'edit';

        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Kaydediliyor...';
        submitBtn.disabled  = true;

        try {
            if (isEditMode) {
                await pywebview.api.update_word(parseInt(form.dataset.editId), english, translation, example, exampleTurkish);
                cancelEdit();
                showToast('Kelime güncellendi.');
            } else {
                await pywebview.api.add_word(english, translation, example, exampleTurkish);
                form.reset();
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
    window.cancelEdit = function () {
        form.reset();
        delete form.dataset.mode;
        delete form.dataset.editId;
        submitBtn.innerHTML = '<i class="fas fa-plus"></i> Kelimeyi Kaydet';
        cancelEditBtn.style.display = 'none';
        document.getElementById('formTitle').textContent = 'Yeni Kelime Ekle';
    };

    // ── LOAD WORDS ───────────────────────────────────────────────
    async function loadWords() {
        try {
            allWords = await pywebview.api.get_words();
            allWords.sort((a, b) => {
                if (a.needs_review === b.needs_review) return b.id - a.id;
                return a.needs_review ? -1 : 1;
            });
            renderWords();
        } catch (err) {
            console.error(err);
        }
    }

    // ── RENDER WORDS ─────────────────────────────────────────────
    function renderWords() {
        const grid = document.getElementById('wordsGrid');
        grid.innerHTML = '';

        document.getElementById('totalCount').textContent  = allWords.length;
        document.getElementById('reviewCount').textContent = allWords.filter(w => w.needs_review).length;

        let words = allWords;
        if (currentFilter === 'review') words = words.filter(w => w.needs_review);
        if (searchQuery) {
            words = words.filter(w =>
                w.english.toLowerCase().includes(searchQuery) ||
                w.translation.toLowerCase().includes(searchQuery) ||
                (w.example || '').toLowerCase().includes(searchQuery) ||
                (w.example_turkish || '').toLowerCase().includes(searchQuery)
            );
        }

        if (words.length === 0) {
            const icon = currentFilter === 'review' ? 'fa-check-circle' : (searchQuery ? 'fa-search' : 'fa-book-open');
            const msg  = searchQuery
                ? 'Aramanıza uygun kelime bulunamadı.'
                : (currentFilter === 'review' ? 'Tekrar edilecek kelime yok.' : 'Henüz kelime eklemediniz.');
            grid.innerHTML = `<div class="empty-state"><i class="fas ${icon}"></i><p>${msg}</p></div>`;
            return;
        }

        words.forEach(word => {
            const card = document.createElement('div');
            card.className = `word-card${word.needs_review ? ' needs-review' : ''}`;

            // Badge
            let badge = '<span class="badge badge-learned">Öğrenildi</span>';
            if (word.needs_review) {
                badge = word.learned_at
                    ? '<span class="badge badge-review">Tekrar Vakti</span>'
                    : '<span class="badge badge-learning">Yeni</span>';
            }

            // Date
            let dateStr = 'Henüz öğrenilmedi';
            if (word.learned_at) {
                dateStr = new Date(word.learned_at).toLocaleString('tr-TR', {
                    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                });
            }

            // Turkish sentence
            const hasTr = word.example_turkish && word.example_turkish.trim();
            const trSection = hasTr ? `
                <div class="tr-wrap">
                    <button class="btn-show-tr" onclick="toggleTurkish(this, '${escapeJs(word.example_turkish)}')">
                        <i class="fas fa-eye"></i> Türkçeyi Göster
                    </button>
                    <div class="tr-text" style="display:none;"></div>
                </div>` : '';

            // Review button
            const reviewBtn = word.needs_review
                ? `<button class="icon-btn btn-review" onclick="reviewWord(${word.id})" title="Öğrendim"><i class="fas fa-check"></i></button>`
                : '';

            card.innerHTML = `
                <div class="card-head">
                    ${badge}
                    <div class="card-actions">
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
                <div class="card-foot">
                    <span class="date-info"><i class="far fa-clock"></i> ${dateStr}</span>
                </div>`;

            grid.appendChild(card);
        });
    }

    // ── TOGGLE TURKISH ───────────────────────────────────────────
    window.toggleTurkish = function (btn, text) {
        const wrap    = btn.parentElement;
        const textDiv = wrap.querySelector('.tr-text');
        const visible = textDiv.style.display !== 'none';

        if (visible) {
            textDiv.style.display = 'none';
            btn.innerHTML = '<i class="fas fa-eye"></i> Türkçeyi Göster';
        } else {
            textDiv.textContent    = text;
            textDiv.style.display  = 'block';
            btn.innerHTML = '<i class="fas fa-eye-slash"></i> Türkçeyi Gizle';
        }
    };

    // ── EDIT WORD ────────────────────────────────────────────────
    window.editWord = function (id) {
        const word = allWords.find(w => w.id === id);
        if (!word) return;
        document.getElementById('english').value        = word.english;
        document.getElementById('translation').value    = word.translation;
        document.getElementById('example').value        = word.example;
        document.getElementById('exampleTurkish').value = word.example_turkish || '';

        form.dataset.mode   = 'edit';
        form.dataset.editId = id;
        document.getElementById('formTitle').textContent = 'Kelimeyi Düzenle';
        submitBtn.innerHTML = '<i class="fas fa-save"></i> Değişiklikleri Kaydet';
        cancelEditBtn.style.display = 'flex';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    // ── REVIEW WORD ──────────────────────────────────────────────
    window.reviewWord = async function (id) {
        try {
            await pywebview.api.review_word(id);
            showToast('Kelime öğrenildi olarak işaretlendi.');
            await loadWords();
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

    window.deleteWord = function (id) {
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
    window.showToast = function (message, type = 'success') {
        const container = document.getElementById('toastContainer');
        const toast     = document.createElement('div');
        toast.className = `toast${type === 'error' ? ' error' : ''}`;
        toast.innerHTML = `<i class="fas ${type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'}"></i> ${escapeHtml(message)}`;
        container.appendChild(toast);
        setTimeout(() => {
            toast.style.animation = 'toastOut 0.2s ease forwards';
            setTimeout(() => toast.remove(), 200);
        }, 3000);
    };

    // ── HELPERS ──────────────────────────────────────────────────
    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function escapeJs(str) {
        return String(str)
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/"/g, '\\"')
            .replace(/\n/g, '\\n');
    }

    // ── QUIZ ─────────────────────────────────────────────────────
    let quizWords        = [];
    let currentQuizIndex = 0;

    const mainContent    = document.getElementById('mainContent');
    const quizSection    = document.getElementById('quizSection');
    const quizContent    = document.getElementById('quizContent');
    const quizEmpty      = document.getElementById('quizEmpty');
    const quizCard       = document.getElementById('quizCard');
    const quizHiddenPart = document.getElementById('quizHiddenPart');
    const quizActions    = document.getElementById('quizActions');
    const quizHint       = document.getElementById('quizHint');

    document.getElementById('toggleQuizBtn').addEventListener('click', () => {
        mainContent.style.display = 'none';
        quizSection.style.display = 'flex';
        startQuiz();
    });

    document.getElementById('exitQuizBtn').addEventListener('click', () => {
        quizSection.style.display = 'none';
        mainContent.style.display = 'flex';
        loadWords();
    });

    function startQuiz() {
        quizWords        = allWords.filter(w => w.needs_review);
        currentQuizIndex = 0;
        if (quizWords.length === 0) {
            quizContent.style.display = 'none';
            quizEmpty.style.display   = 'flex';
        } else {
            quizContent.style.display = 'flex';
            quizEmpty.style.display   = 'none';
            showQuizCard();
        }
    }

    function showQuizCard() {
        if (currentQuizIndex >= quizWords.length) {
            quizContent.style.display = 'none';
            quizEmpty.style.display   = 'flex';
            showToast('Tüm quiz kelimelerini tamamladınız!');
            return;
        }
        const word = quizWords[currentQuizIndex];
        document.getElementById('quizProgress').textContent    = `${currentQuizIndex + 1} / ${quizWords.length}`;
        document.getElementById('quizEnglish').textContent     = word.english;
        document.getElementById('quizTranslation').textContent = word.translation;
        document.getElementById('quizExample').textContent     = `"${word.example}"`;
        quizHiddenPart.style.display = 'none';
        quizActions.style.display    = 'none';
        quizHint.style.display       = 'block';
    }

    quizCard.addEventListener('click', () => {
        if (quizHiddenPart.style.display === 'none') {
            quizHiddenPart.style.display = 'flex';
            quizActions.style.display    = 'flex';
            quizHint.style.display       = 'none';
        }
    });

    window.handleQuizAnswer = async function (knewIt) {
        if (knewIt) {
            try {
                await pywebview.api.review_word(quizWords[currentQuizIndex].id);
                showToast(`"${quizWords[currentQuizIndex].english}" öğrenildi olarak işaretlendi.`);
            } catch (err) {
                console.error(err);
            }
        }
        currentQuizIndex++;
        showQuizCard();
    };
});
