import webview
import json
import os
import datetime
import sys
import csv
import io

def get_base_path():
    if getattr(sys, 'frozen', False):
        return sys._MEIPASS
    return os.path.dirname(os.path.abspath(__file__))

def get_db_path():
    if getattr(sys, 'frozen', False):
        return os.path.join(os.path.dirname(sys.executable), 'words.json')
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), 'words.json')

def get_stats_path():
    if getattr(sys, 'frozen', False):
        return os.path.join(os.path.dirname(sys.executable), 'stats.json')
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), 'stats.json')

DB_FILE    = get_db_path()
STATS_FILE = get_stats_path()
INDEX_HTML = os.path.join(get_base_path(), 'index.html')


class Api:
    def __init__(self):
        self._load_db()
        self._load_stats()

    # ── DB ──────────────────────────────────────────────────────
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

    # ── STATS / STREAK ──────────────────────────────────────────
    def _load_stats(self):
        if not os.path.exists(STATS_FILE):
            self.stats = {
                'streak': 0,
                'last_active_date': None,
                'daily_learned': {},   # "YYYY-MM-DD": count
            }
            self._save_stats()
        else:
            with open(STATS_FILE, 'r', encoding='utf-8') as f:
                self.stats = json.load(f)

    def _save_stats(self):
        with open(STATS_FILE, 'w', encoding='utf-8') as f:
            json.dump(self.stats, f, indent=4, ensure_ascii=False)

    def _ensure_fields(self, word):
        """Ensure backward-compatible fields exist on a word dict."""
        word.setdefault('example_turkish', '')
        word.setdefault('quiz_correct_count', 0)
        word.setdefault('quiz_wrong_count', 0)
        word.setdefault('permanently_learned', False)
        word.setdefault('notes', '')

    # ── STREAK ──────────────────────────────────────────────────
    def get_streak(self):
        today = datetime.date.today().isoformat()
        last  = self.stats.get('last_active_date')
        streak = self.stats.get('streak', 0)

        if last is None:
            streak = 0
        elif last == today:
            pass  # already counted today
        else:
            yesterday = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
            if last == yesterday:
                pass  # streak continues, will increment on quiz/review
            else:
                # streak broken
                streak = 0
                self.stats['streak'] = 0
                self._save_stats()

        return {
            'streak': streak,
            'last_active_date': last,
        }

    def _touch_streak(self):
        """Call whenever user completes a quiz answer or manually reviews."""
        today = datetime.date.today().isoformat()
        last  = self.stats.get('last_active_date')
        yesterday = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()

        if last == today:
            pass  # already active today
        elif last == yesterday:
            self.stats['streak'] = self.stats.get('streak', 0) + 1
            self.stats['last_active_date'] = today
        else:
            self.stats['streak'] = 1
            self.stats['last_active_date'] = today

        # daily_learned counter
        dl = self.stats.setdefault('daily_learned', {})
        dl[today] = dl.get(today, 0) + 1
        self._save_stats()

    # ── WORDS ────────────────────────────────────────────────────
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

    def add_word(self, english_word, translation, example_sentence,
                 example_turkish='', notes=''):
        new_word = {
            'id': max((w['id'] for w in self.words), default=0) + 1,
            'english':          english_word,
            'translation':      translation,
            'example':          example_sentence,
            'example_turkish':  example_turkish,
            'notes':            notes,
            'learned_at':       None,
            'needs_review':     True,
            'quiz_correct_count': 0,
            'quiz_wrong_count':   0,
            'permanently_learned': False,
        }
        self.words.append(new_word)
        self._save_db()
        return new_word

    def update_word(self, word_id, english_word, translation, example_sentence,
                    example_turkish='', notes=''):
        for word in self.words:
            if word['id'] == word_id:
                word['english']         = english_word
                word['translation']     = translation
                word['example']         = example_sentence
                word['example_turkish'] = example_turkish
                word['notes']           = notes
                break
        self._save_db()
        return True

    def review_word(self, word_id):
        for word in self.words:
            if word['id'] == word_id:
                word['learned_at']  = datetime.datetime.now().isoformat()
                word['needs_review'] = False
                break
        self._touch_streak()
        self._save_db()
        return True

    def delete_word(self, word_id):
        self.words = [w for w in self.words if w['id'] != word_id]
        self._save_db()
        return True

    # ── QUIZ ─────────────────────────────────────────────────────
    def _build_groups(self):
        all_ids = sorted(w['id'] for w in self.words)
        n = len(all_ids)
        groups = [[] for _ in range(7)]
        for i, wid in enumerate(all_ids):
            group_idx = min(int(i * 7 / n), 6) if n > 0 else 0
            groups[group_idx].append(wid)
        return groups

    def get_quiz_info(self):
        today_group = datetime.date.today().weekday()
        day_names = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar']
        groups = self._build_groups()
        today_ids = set(groups[today_group])
        total_in_group = len(today_ids)
        remaining = sum(
            1 for w in self.words
            if w['id'] in today_ids and not w.get('permanently_learned', False)
        )
        return {
            'group_number':  today_group + 1,
            'day_name':      day_names[today_group],
            'total_words':   len(self.words),
            'words_in_group': total_in_group,
            'remaining':     remaining,
        }

    def get_quiz_words(self):
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

    def get_all_words_for_quiz(self):
        """Return all non-permanently-learned words for multiple-choice options."""
        self._load_db()
        result = []
        for word in self.words:
            if not word.get('permanently_learned', False):
                self._ensure_fields(word)
                result.append(word)
        return result

    def record_quiz_answer(self, word_id, knew_it):
        permanently_learned_now = False
        new_count = 0
        for word in self.words:
            if word['id'] == word_id:
                self._ensure_fields(word)
                if knew_it:
                    word['quiz_correct_count'] += 1
                    word['learned_at']  = datetime.datetime.now().isoformat()
                    word['needs_review'] = False
                    if word['quiz_correct_count'] >= 4:
                        word['permanently_learned'] = True
                        permanently_learned_now = True
                else:
                    word['quiz_wrong_count'] = word.get('quiz_wrong_count', 0) + 1
                new_count = word['quiz_correct_count']
                break
        self._touch_streak()
        self._save_db()
        return {
            'permanently_learned': permanently_learned_now,
            'quiz_correct_count':  new_count,
        }

    # ── STATISTICS ───────────────────────────────────────────────
    def get_statistics(self):
        total      = len(self.words)
        learned    = sum(1 for w in self.words if not w.get('needs_review', True) or w.get('permanently_learned'))
        permanent  = sum(1 for w in self.words if w.get('permanently_learned'))
        review     = sum(1 for w in self.words if w.get('needs_review') and not w.get('permanently_learned'))

        # Most wrong words (top 5)
        sorted_wrong = sorted(
            [w for w in self.words if w.get('quiz_wrong_count', 0) > 0],
            key=lambda x: x.get('quiz_wrong_count', 0),
            reverse=True
        )[:5]
        most_wrong = [{'english': w['english'], 'translation': w['translation'],
                       'wrong': w.get('quiz_wrong_count', 0)} for w in sorted_wrong]

        # Daily learned (last 7 days)
        dl = self.stats.get('daily_learned', {})
        today = datetime.date.today()
        daily = []
        for i in range(6, -1, -1):
            d = (today - datetime.timedelta(days=i)).isoformat()
            daily.append({'date': d, 'count': dl.get(d, 0)})

        return {
            'total':       total,
            'learned':     learned,
            'permanent':   permanent,
            'review':      review,
            'most_wrong':  most_wrong,
            'daily':       daily,
            'streak':      self.stats.get('streak', 0),
        }

    # ── IMPORT / EXPORT ────────────────────────────────────────────
    def export_words(self):
        """Return all words as a list for JSON export."""
        return self.words

    def import_words(self, words_list):
        """
        Import a list of word dicts. Skips duplicates by english name (case-insensitive).
        Returns {'imported': n, 'skipped': m}
        """
        existing = {w['english'].lower() for w in self.words}
        max_id   = max((w['id'] for w in self.words), default=0)
        imported = 0
        skipped  = 0
        for item in words_list:
            eng = str(item.get('english', '')).strip()
            if not eng or eng.lower() in existing:
                skipped += 1
                continue
            max_id += 1
            new_word = {
                'id':               max_id,
                'english':          eng,
                'translation':      str(item.get('translation', '')).strip(),
                'example':          str(item.get('example', '')).strip(),
                'example_turkish':  str(item.get('example_turkish', '')).strip(),
                'notes':            str(item.get('notes', '')).strip(),
                'learned_at':       None,
                'needs_review':     True,
                'quiz_correct_count': 0,
                'quiz_wrong_count':   0,
                'permanently_learned': False,
            }
            self.words.append(new_word)
            existing.add(eng.lower())
            imported += 1
        self._save_db()
        return {'imported': imported, 'skipped': skipped}


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
