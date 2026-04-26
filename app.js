document.addEventListener('DOMContentLoaded', () => {
    // Pywebview fires an event when the api is ready
    window.addEventListener('pywebviewready', function() {
        loadWords();
    });

    const form = document.getElementById('wordForm');
    const filterBtns = document.querySelectorAll('.filter-btn');
    const searchInput = document.getElementById('searchInput');
    const submitBtn = document.getElementById('submitBtn');
    const cancelEditBtn = document.getElementById('cancelEditBtn');
    
    let currentFilter = 'all';
    let allWords = [];
    let searchQuery = '';

    searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.toLowerCase();
        renderWords();
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const english = document.getElementById('english').value;
        const translation = document.getElementById('translation').value;
        const example = document.getElementById('example').value;
        
        const isEditMode = form.dataset.mode === 'edit';
        
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Kaydediliyor...';
        submitBtn.disabled = true;

        try {
            if (isEditMode) {
                await pywebview.api.update_word(parseInt(form.dataset.editId), english, translation, example);
                window.cancelEdit();
                showToast('Kelime başarıyla güncellendi!');
            } else {
                await pywebview.api.add_word(english, translation, example);
                form.reset();
                showToast('Kelime başarıyla eklendi!');
            }
            await loadWords();
        } catch (error) {
            console.error('Error saving word:', error);
            showToast('Bir hata oluştu!', 'error');
        } finally {
            if (form.dataset.mode !== 'edit') {
                submitBtn.innerHTML = '<i class="fas fa-plus"></i> Kelimeyi Kaydet';
            } else {
                submitBtn.innerHTML = '<i class="fas fa-save"></i> Değişiklikleri Kaydet';
            }
            submitBtn.disabled = false;
        }
    });

    window.cancelEdit = function() {
        form.reset();
        form.dataset.mode = 'add';
        delete form.dataset.editId;
        submitBtn.innerHTML = '<i class="fas fa-plus"></i> Kelimeyi Kaydet';
        cancelEditBtn.style.display = 'none';
        document.querySelector('.form-header h2').textContent = 'Yeni Kelime Ekle';
    };

    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.filter;
            renderWords();
        });
    });

    async function loadWords() {
        try {
            allWords = await pywebview.api.get_words();
            // Sort by needs_review first, then by newest ID
            allWords.sort((a, b) => {
                if (a.needs_review === b.needs_review) {
                    return b.id - a.id;
                }
                return a.needs_review ? -1 : 1;
            });
            renderWords();
        } catch (error) {
            console.error('Error loading words:', error);
        }
    }

    function renderWords() {
        const grid = document.getElementById('wordsGrid');
        grid.innerHTML = '';

        const totalCount = allWords.length;
        const reviewCount = allWords.filter(w => w.needs_review).length;
        document.getElementById('totalCount').textContent = totalCount;
        document.getElementById('reviewCount').textContent = reviewCount;

        let wordsToRender = allWords;
        
        if (currentFilter === 'review') {
            wordsToRender = allWords.filter(w => w.needs_review);
        }

        if (searchQuery) {
            wordsToRender = wordsToRender.filter(w => 
                w.english.toLowerCase().includes(searchQuery) || 
                w.translation.toLowerCase().includes(searchQuery) ||
                w.example.toLowerCase().includes(searchQuery)
            );
        }

        if (wordsToRender.length === 0) {
            grid.innerHTML = `
                <div class="empty-state">
                    <i class="fas ${currentFilter === 'review' ? 'fa-check-circle' : (searchQuery ? 'fa-search' : 'fa-book-open')}"></i>
                    <p>${searchQuery ? 'Aramanıza uygun kelime bulunamadı.' : (currentFilter === 'review' ? 'Harika! Tekrar edilecek kelimeniz yok.' : 'Henüz kelime eklemediniz.')}</p>
                </div>
            `;
            return;
        }

        wordsToRender.forEach(word => {
            const card = document.createElement('div');
            card.className = `word-card glass ${word.needs_review ? 'needs-review' : ''}`;
            
            let formattedDate = 'Henüz öğrenilmedi';
            let badgeHtml = '<span class="badge badge-learned">Öğrenildi</span>';
            
            if (word.needs_review) {
                if (word.learned_at) {
                    badgeHtml = '<span class="badge badge-review">Tekrar Vakti</span>';
                } else {
                    badgeHtml = '<span class="badge badge-learning" style="background: linear-gradient(135deg, #f6d365 0%, #fda085 100%); color: #fff; border: none;">Öğreniliyor</span>';
                }
            }
            
            if (word.learned_at) {
                const learnedDate = new Date(word.learned_at);
                formattedDate = learnedDate.toLocaleString('tr-TR', { 
                    day: 'numeric', month: 'short', hour: '2-digit', minute:'2-digit' 
                });
            }

            card.innerHTML = `
                ${badgeHtml}
                
                <div class="word-card-header">
                    <div>
                        <h3 class="word-title">${escapeHtml(word.english)}</h3>
                        <p class="word-translation">${escapeHtml(word.translation)}</p>
                    </div>
                </div>
                
                <div class="word-example">
                    "${escapeHtml(word.example)}"
                </div>
                
                <div class="word-footer">
                    <div class="time-info">
                        <span><i class="far fa-clock"></i> Öğrenme: ${formattedDate}</span>
                    </div>
                    <div class="card-actions">
                        <button class="icon-btn btn-edit" onclick="editWord(${word.id})" title="Düzenle">
                            <i class="fas fa-edit"></i>
                        </button>
                        ${word.needs_review ? `
                            <button class="icon-btn btn-review" onclick="reviewWord(${word.id})" title="Tekrar Ettim">
                                <i class="fas fa-check"></i>
                            </button>
                        ` : ''}
                        <button class="icon-btn btn-delete" onclick="deleteWord(${word.id})" title="Sil">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            `;
            grid.appendChild(card);
        });
    }

    window.editWord = function(id) {
        const word = allWords.find(w => w.id === id);
        if (word) {
            document.getElementById('english').value = word.english;
            document.getElementById('translation').value = word.translation;
            document.getElementById('example').value = word.example;
            
            form.dataset.mode = 'edit';
            form.dataset.editId = id;
            
            document.querySelector('.form-header h2').textContent = 'Kelimeyi Düzenle';
            submitBtn.innerHTML = '<i class="fas fa-save"></i> Değişiklikleri Kaydet';
            cancelEditBtn.style.display = 'block';
            
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    };

    window.reviewWord = async function(id) {
        try {
            await pywebview.api.review_word(id);
            showToast('Kelime tekrar edildi.');
            await loadWords();
        } catch (error) {
            console.error('Error reviewing word:', error);
            showToast('Hata oluştu!', 'error');
        }
    };

    let wordIdToDelete = null;
    const deleteModal = document.getElementById('deleteModal');
    const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
    const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');

    window.deleteWord = function(id) {
        wordIdToDelete = id;
        deleteModal.style.display = 'flex';
    };

    cancelDeleteBtn.addEventListener('click', () => {
        deleteModal.style.display = 'none';
        wordIdToDelete = null;
    });

    confirmDeleteBtn.addEventListener('click', async () => {
        if (wordIdToDelete !== null) {
            try {
                await pywebview.api.delete_word(wordIdToDelete);
                showToast('Kelime silindi.');
                await loadWords();
            } catch (error) {
                console.error('Error deleting word:', error);
                showToast('Hata oluştu!', 'error');
            } finally {
                deleteModal.style.display = 'none';
                wordIdToDelete = null;
            }
        }
    });

    function escapeHtml(unsafe) {
        return unsafe
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
    }

    // TOAST NOTIFICATIONS
    window.showToast = function(message, type = 'success') {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `<i class="fas ${type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'}"></i> ${escapeHtml(message)}`;
        container.appendChild(toast);
        
        setTimeout(() => {
            toast.style.animation = 'fadeOutRight 0.3s ease forwards';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    };

    // QUIZ MODE LOGIC
    let quizWords = [];
    let currentQuizIndex = 0;

    const mainContent = document.getElementById('mainContent');
    const quizSection = document.getElementById('quizSection');
    const toggleQuizBtn = document.getElementById('toggleQuizBtn');
    const exitQuizBtn = document.getElementById('exitQuizBtn');
    
    const quizContent = document.getElementById('quizContent');
    const quizEmpty = document.getElementById('quizEmpty');
    const quizCard = document.getElementById('quizCard');
    const quizHiddenPart = document.getElementById('quizHiddenPart');
    const quizActions = document.getElementById('quizActions');
    const quizHint = document.getElementById('quizHint');

    toggleQuizBtn.addEventListener('click', () => {
        mainContent.style.display = 'none';
        quizSection.style.display = 'flex';
        startQuiz();
    });

    exitQuizBtn.addEventListener('click', () => {
        quizSection.style.display = 'none';
        mainContent.style.display = 'block';
        loadWords();
    });

    function startQuiz() {
        quizWords = allWords.filter(w => w.needs_review);
        currentQuizIndex = 0;
        
        if (quizWords.length === 0) {
            quizContent.style.display = 'none';
            quizEmpty.style.display = 'block';
        } else {
            quizContent.style.display = 'block';
            quizEmpty.style.display = 'none';
            showQuizCard();
        }
    }

    function showQuizCard() {
        if (currentQuizIndex >= quizWords.length) {
            quizContent.style.display = 'none';
            quizEmpty.style.display = 'block';
            showToast('Tüm quiz kelimelerini bitirdiniz!');
            return;
        }

        const word = quizWords[currentQuizIndex];
        document.getElementById('quizProgress').textContent = `(${currentQuizIndex + 1}/${quizWords.length})`;
        document.getElementById('quizEnglish').textContent = word.english;
        document.getElementById('quizTranslation').textContent = word.translation;
        document.getElementById('quizExample').textContent = `"${word.example}"`;

        quizHiddenPart.style.display = 'none';
        quizActions.style.display = 'none';
        quizHint.style.display = 'block';
    }

    quizCard.addEventListener('click', () => {
        if (quizHiddenPart.style.display === 'none') {
            quizHiddenPart.style.display = 'block';
            quizActions.style.display = 'flex';
            quizHint.style.display = 'none';
        }
    });

    window.handleQuizAnswer = async function(knewIt) {
        const word = quizWords[currentQuizIndex];
        if (knewIt) {
            try {
                await pywebview.api.review_word(word.id);
                showToast(`"${word.english}" kelimesi tekrar edildi.`);
            } catch (error) {
                console.error('Quiz review error:', error);
            }
        }
        currentQuizIndex++;
        showQuizCard();
    };

});
