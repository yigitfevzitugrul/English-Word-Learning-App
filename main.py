import webview
import json
import os
import datetime
import sys
import csv
import io
import threading
import shutil
import tempfile
import functools

import srs

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


# ── SAFE JSON I/O ────────────────────────────────────────────────
def write_json_atomic(path, data):
    """Önce geçici dosyaya yazar, sonra tek adımda yerine koyar.
    Yazma yarıda kesilirse eski dosya sağlam kalır."""
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix='.tmp-', suffix='.json')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=4, ensure_ascii=False)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise


def read_json_safe(path, default):
    """Dosyayı okur. Bozuksa kenara kaydeder ve .bak yedeğinden kurtarır.
    Başarılı okumada son sağlam hali .bak olarak saklar."""
    backup = path + '.bak'
    if os.path.exists(path):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            shutil.copy2(path, backup)
            return data
        except (json.JSONDecodeError, UnicodeDecodeError) as e:
            stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
            corrupt = f'{path}.corrupt-{stamp}'
            os.replace(path, corrupt)
            print(f'{os.path.basename(path)} bozuk ({e}); {corrupt} olarak saklandı.')
    if os.path.exists(backup):
        try:
            with open(backup, 'r', encoding='utf-8') as f:
                data = json.load(f)
            write_json_atomic(path, data)
            print(f'{os.path.basename(path)} yedekten geri yüklendi.')
            return data
        except (json.JSONDecodeError, UnicodeDecodeError):
            pass
    write_json_atomic(path, default)
    return default


def locked(method):
    """pywebview API çağrılarını ayrı thread'lerde çalıştırır;
    veriye aynı anda tek çağrının dokunmasını sağlar."""
    @functools.wraps(method)
    def wrapper(self, *args, **kwargs):
        with self._lock:
            return method(self, *args, **kwargs)
    return wrapper


class Api:
    def __init__(self):
        self._lock = threading.RLock()
        self._load_db()
        self._load_stats()

    # ── DB ──────────────────────────────────────────────────────
    def _load_db(self):
        self.words = read_json_safe(DB_FILE, [])
        migrated = [self._ensure_fields(w) for w in self.words]
        if any(migrated):
            self._save_db()   # eski kayıtlar SRS alanlarıyla diske yazılır

    def _save_db(self):
        write_json_atomic(DB_FILE, self.words)

    # ── STATS / STREAK ──────────────────────────────────────────
    def _load_stats(self):
        self.stats = read_json_safe(STATS_FILE, {
            'streak': 0,
            'last_active_date': None,
            'daily_learned': {},   # "YYYY-MM-DD": count
            'quiz_limit': 10,
        })
        # Backward compatibility: add quiz_limit if missing
        if 'quiz_limit' not in self.stats:
            self.stats['quiz_limit'] = 10
            self._save_stats()

    def _save_stats(self):
        write_json_atomic(STATS_FILE, self.stats)

    def _ensure_fields(self, word):
        """Eksik alanları tamamlar. Eski ilerleme SRS'e taşındıysa True döner."""
        word.setdefault('example_turkish', '')
        word.setdefault('quiz_correct_count', 0)
        word.setdefault('quiz_wrong_count', 0)
        word.setdefault('permanently_learned', False)
        word.setdefault('notes', '')
        if 'srs' not in word:
            word['srs'] = srs.migrate_legacy(word, datetime.date.today())
            self._refresh(word, datetime.date.today())
            return True
        return False

    def _refresh(self, word, today):
        """SRS durumundan türetilen alanları günceller."""
        word['needs_review']        = srs.is_due(word['srs'], today)
        word['permanently_learned'] = srs.is_mature(word['srs'])

    def _new_word(self, word_id, english, translation, example,
                  example_turkish='', notes=''):
        return {
            'id':                  word_id,
            'english':             english,
            'translation':         translation,
            'example':             example,
            'example_turkish':     example_turkish,
            'notes':               notes,
            'learned_at':          None,
            'needs_review':        True,
            'quiz_correct_count':  0,
            'quiz_wrong_count':    0,
            'permanently_learned': False,
            'srs':                 srs.new_state(),
        }

    def _find(self, word_id):
        return next((w for w in self.words if w['id'] == word_id), None)

    def _grade(self, word, grade, today):
        """Cevabı SRS'e işler. Kelime bu cevapla kalıcı olduysa True döner."""
        was_mature = srs.is_mature(word['srs'])
        word['srs'] = srs.schedule(word['srs'], grade, today)
        if grade == 'again':
            word['quiz_wrong_count'] += 1
        else:
            word['quiz_correct_count'] += 1
            word['learned_at'] = datetime.datetime.now().isoformat()
        self._refresh(word, today)
        return word['permanently_learned'] and not was_mature

    # ── STREAK ──────────────────────────────────────────────────
    @locked
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
    @locked
    def get_words(self):
        today = datetime.date.today()
        for word in self.words:
            self._refresh(word, today)
        return self.words

    @locked
    def add_word(self, english_word, translation, example_sentence,
                 example_turkish='', notes=''):
        new_word = self._new_word(
            max((w['id'] for w in self.words), default=0) + 1,
            english_word, translation, example_sentence, example_turkish, notes)
        self.words.append(new_word)
        self._save_db()
        return new_word

    @locked
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

    @locked
    def review_word(self, word_id):
        """Karttaki "Öğrendim" butonu: quizdeki "Bildim" ile aynı işlenir."""
        word = self._find(word_id)
        if word:
            self._grade(word, 'good', datetime.date.today())
            self._touch_streak()
            self._save_db()
        return True

    @locked
    def delete_word(self, word_id):
        self.words = [w for w in self.words if w['id'] != word_id]
        self._save_db()
        return True

    # ── QUIZ ─────────────────────────────────────────────────────
    @locked
    def get_quiz_info(self):
        today = datetime.date.today()
        due      = [w for w in self.words if srs.is_due(w['srs'], today)]
        new      = sum(1 for w in due if srs.is_new(w['srs']))
        upcoming = sorted(w['srs']['due'] for w in self.words
                          if not srs.is_due(w['srs'], today))
        return {
            'total_words': len(self.words),
            'reviews':     len(due) - new,
            'new':         new,
            'next_due':    upcoming[0] if upcoming else None,
        }

    @locked
    def get_quiz_limit(self):
        """Return the persisted quiz daily limit."""
        return self.stats.get('quiz_limit', 10)

    @locked
    def set_quiz_limit(self, limit):
        """Persist the quiz daily limit to stats.json."""
        self.stats['quiz_limit'] = int(limit)
        self._save_stats()
        return True

    @locked
    def get_quiz_words(self, limit=0):
        """Bugün sorulacak kartlar: önce vadesi geçmiş tekrarlar, sonra yeni kelimeler.
        Vadesi gelmemiş kelimeler sorulmaz. limit=0 sınırsız demektir."""
        today = datetime.date.today()
        due = [w for w in self.words if srs.is_due(w['srs'], today)]
        reviews = sorted((w for w in due if not srs.is_new(w['srs'])),
                         key=lambda w: (w['srs']['due'], -w['srs']['lapses'], w['id']))
        new = sorted((w for w in due if srs.is_new(w['srs'])), key=lambda w: w['id'])
        queue = reviews + new
        if limit and limit > 0:
            queue = queue[:limit]
        return [dict(w, preview=srs.preview(w['srs'], today)) for w in queue]

    @locked
    def get_all_words_for_quiz(self):
        """Çoktan seçmeli yanlış şıklar için tüm kelimeler."""
        return self.words

    @locked
    def record_quiz_answer(self, word_id, grade):
        """grade: 'again' | 'hard' | 'good' (eski istemciler için True/False da kabul edilir)."""
        if grade is True:
            grade = 'good'
        elif grade is False:
            grade = 'again'
        word = self._find(word_id)
        if word is None:
            return None
        today = datetime.date.today()
        mastered_now = self._grade(word, grade, today)
        self._touch_streak()
        self._save_db()
        return {
            'mastered_now': mastered_now,
            'needs_review': word['needs_review'],
            'srs':          word['srs'],
            'preview':      srs.preview(word['srs'], today),
        }

    # ── STATISTICS ───────────────────────────────────────────────
    @locked
    def get_statistics(self):
        today      = datetime.date.today()
        total      = len(self.words)
        learned    = sum(1 for w in self.words if w['srs']['reps'] > 0)
        permanent  = sum(1 for w in self.words if srs.is_mature(w['srs']))
        review     = sum(1 for w in self.words
                         if srs.is_due(w['srs'], today) and not srs.is_new(w['srs']))

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
    @locked
    def export_words(self):
        """Return all words as a list for JSON export."""
        return self.words

    @locked
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
            new_word = self._new_word(
                max_id, eng,
                str(item.get('translation', '')).strip(),
                str(item.get('example', '')).strip(),
                str(item.get('example_turkish', '')).strip(),
                str(item.get('notes', '')).strip())
            self.words.append(new_word)
            existing.add(eng.lower())
            imported += 1
        self._save_db()
        return {'imported': imported, 'skipped': skipped}

    # ── SPEECH FALLBACK (OFFLINE) ──────────────────────────────────
    def speak_offline(self, text, accent='us'):
        """Offline speech fallback using Windows SAPI native English voice."""
        def _speak():
            try:
                import pythoncom
                import win32com.client
                pythoncom.CoInitialize()
                speaker = win32com.client.Dispatch("SAPI.SpVoice")
                english_voice = None
                pref = 'uk' if (accent or '').lower() == 'uk' else 'us'

                for v in speaker.GetVoices():
                    desc = v.GetDescription().lower()
                    if pref == 'uk' and any(k in desc for k in ['united kingdom', 'hazel', 'george', 'susan', 'en-gb']):
                        english_voice = v
                        break
                    elif pref == 'us' and any(k in desc for k in ['united states', 'zira', 'david', 'mark', 'eva', 'en-us']):
                        english_voice = v
                        break

                if not english_voice:
                    for v in speaker.GetVoices():
                        desc = v.GetDescription().lower()
                        if any(k in desc for k in ['english', 'zira', 'david', 'united states', 'united kingdom', 'en-']):
                            english_voice = v
                            break

                if english_voice:
                    speaker.Voice = english_voice
                    speaker.Speak(text, 0)
                else:
                    print("Offline SAPI: No English voice found. Skipped to prevent Turkish accent fallback.")
            except Exception as e:
                print(f"speak_offline error: {e}")
            finally:
                try:
                    pythoncom.CoUninitialize()
                except Exception:
                    pass

        threading.Thread(target=_speak, daemon=True).start()
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
