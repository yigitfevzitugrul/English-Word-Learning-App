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

    def get_words(self):
        now = datetime.datetime.now()
        for word in self.words:
            # Ensure old words have the new field
            if 'example_turkish' not in word:
                word['example_turkish'] = ''
            if not word.get('learned_at'):
                word['needs_review'] = True
                continue
            learned_time = datetime.datetime.fromisoformat(word['learned_at'])
            if now >= learned_time + datetime.timedelta(hours=24):
                word['needs_review'] = True
            else:
                word['needs_review'] = False
        return self.words

    def add_word(self, english_word, translation, example_sentence, example_turkish=''):
        new_word = {
            'id': len(self.words) + 1 if len(self.words) == 0 else max(w['id'] for w in self.words) + 1,
            'english': english_word,
            'translation': translation,
            'example': example_sentence,
            'example_turkish': example_turkish,
            'learned_at': None,
            'needs_review': True
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
