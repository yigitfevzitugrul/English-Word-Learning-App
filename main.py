import webview
import json
import os
import datetime
import sys

def get_base_path():
    if getattr(sys, 'frozen', False):
        return sys._MEIPASS
    return os.path.dirname(os.path.abspath(__file__))

def get_db_path():
    if getattr(sys, 'frozen', False):
        return os.path.join(os.path.dirname(sys.executable), 'words.json')
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), 'words.json')

DB_FILE = get_db_path()
INDEX_HTML = os.path.join(get_base_path(), 'index.html')

class Api:
    def __init__(self):
        self._load_db()

    def _load_db(self):
        if not os.path.exists(DB_FILE):
            with open(DB_FILE, 'w', encoding='utf-8') as f:
                json.dump([], f)
            self.words = []
        else:
            with open(DB_FILE, 'r', encoding='utf-8') as f:
                self.words = json.load(f)

    def _save_db(self):
        with open(DB_FILE, 'w', encoding='utf-8') as f:
            json.dump(self.words, f, indent=4, ensure_ascii=False)

    def _ensure_fields(self, word):
        """Ensure backward-compatible fields exist on a word dict."""
        word.setdefault('example_turkish', '')
        word.setdefault('quiz_correct_count', 0)
        word.setdefault('permanently_learned', False)

    def _build_groups(self):
        """Split all word IDs into 7 roughly equal groups (0–6)."""
        all_ids = sorted(w['id'] for w in self.words)
        n = len(all_ids)
        groups = [[] for _ in range(7)]
        for i, wid in enumerate(all_ids):
            group_idx = min(int(i * 7 / n), 6) if n > 0 else 0
            groups[group_idx].append(wid)
        return groups

    def get_words(self):
        now = datetime.datetime.now()
        for word in self.words:
            self._ensure_fields(word)
            if not word.get('learned_at'):
                word['needs_review'] = True
                continue
            learned_time = datetime.datetime.fromisoformat(word['learned_at'])
            if now >= learned_time + datetime.timedelta(hours=24):
                word['needs_review'] = True
            else:
                word['needs_review'] = False
        return self.words

    def get_quiz_info(self):
        """Returns today's group number (1-7), day name and word counts."""
        today_group = datetime.date.today().weekday()  # 0=Pazartesi … 6=Pazar
        day_names = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar']
        groups = self._build_groups()
        today_ids = set(groups[today_group])
        total_in_group = len(today_ids)
        remaining = sum(
            1 for w in self.words
            if w['id'] in today_ids and not w.get('permanently_learned', False)
        )
        return {
            'group_number': today_group + 1,
            'day_name': day_names[today_group],
            'total_words': len(self.words),
            'words_in_group': total_in_group,
            'remaining': remaining,
        }

    def get_quiz_words(self):
        """Returns today's group words that are not permanently learned."""
        self._load_db()
        today_group = datetime.date.today().weekday()
        groups = self._build_groups()
        today_ids = set(groups[today_group])
        result = []
        for word in self.words:
            if word['id'] in today_ids and not word.get('permanently_learned', False):
                self._ensure_fields(word)
                result.append(word)
        return result

    def record_quiz_answer(self, word_id, knew_it):
        """
        Records a quiz answer.
        If knew_it=True increments quiz_correct_count.
        When count reaches 4, permanently_learned is set to True.
        Returns {'permanently_learned': bool, 'quiz_correct_count': int}
        """
        permanently_learned_now = False
        new_count = 0
        for word in self.words:
            if word['id'] == word_id:
                self._ensure_fields(word)
                if knew_it:
                    word['quiz_correct_count'] += 1
                    word['learned_at'] = datetime.datetime.now().isoformat()
                    word['needs_review'] = False
                    if word['quiz_correct_count'] >= 4:
                        word['permanently_learned'] = True
                        permanently_learned_now = True
                new_count = word['quiz_correct_count']
                break
        self._save_db()
        return {
            'permanently_learned': permanently_learned_now,
            'quiz_correct_count': new_count,
        }

    def add_word(self, english_word, translation, example_sentence, example_turkish=''):
        new_word = {
            'id': len(self.words) + 1 if len(self.words) == 0 else max(w['id'] for w in self.words) + 1,
            'english': english_word,
            'translation': translation,
            'example': example_sentence,
            'example_turkish': example_turkish,
            'learned_at': None,
            'needs_review': True,
            'quiz_correct_count': 0,
            'permanently_learned': False,
        }
        self.words.append(new_word)
        self._save_db()
        return new_word

    def review_word(self, word_id):
        for word in self.words:
            if word['id'] == word_id:
                word['learned_at'] = datetime.datetime.now().isoformat()
                word['needs_review'] = False
                break
        self._save_db()
        return True

    def delete_word(self, word_id):
        self.words = [w for w in self.words if w['id'] != word_id]
        self._save_db()
        return True

    def update_word(self, word_id, english_word, translation, example_sentence, example_turkish=''):
        for word in self.words:
            if word['id'] == word_id:
                word['english'] = english_word
                word['translation'] = translation
                word['example'] = example_sentence
                word['example_turkish'] = example_turkish
                break
        self._save_db()
        return True

if __name__ == '__main__':
    api = Api()
    window = webview.create_window(
        'Lingua - Kelime Öğrenme',
        INDEX_HTML,
        js_api=api,
        width=1200,
        height=860,
        min_size=(900, 650),
        background_color='#0d0d1a'
    )
    webview.start(debug=False)
