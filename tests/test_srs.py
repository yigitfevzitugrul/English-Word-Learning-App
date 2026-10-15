"""Çalıştırma: python -m unittest discover tests"""
import datetime
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import srs

TODAY = datetime.date(2026, 10, 15)


def days(n):
    return (TODAY + datetime.timedelta(days=n)).isoformat()


class ScheduleTests(unittest.TestCase):
    def test_new_word_is_due(self):
        s = srs.new_state()
        self.assertTrue(srs.is_new(s))
        self.assertTrue(srs.is_due(s, TODAY))

    def test_good_answers_grow_interval(self):
        s = srs.new_state()
        intervals = []
        for _ in range(5):
            s = srs.schedule(s, 'good', TODAY)
            intervals.append(s['interval'])
        self.assertEqual(intervals[:2], [1, 3])
        self.assertEqual(intervals, sorted(intervals))
        self.assertGreaterEqual(intervals[-1], srs.MATURE_DAYS)
        self.assertTrue(srs.is_mature(s))

    def test_not_due_until_interval_passes(self):
        s = srs.schedule(srs.new_state(), 'good', TODAY)   # 1 gün
        self.assertEqual(s['due'], days(1))
        self.assertFalse(srs.is_due(s, TODAY))
        self.assertTrue(srs.is_due(s, TODAY + datetime.timedelta(days=1)))

    def test_again_resets_progress_and_counts_lapse(self):
        s = srs.new_state()
        for _ in range(4):
            s = srs.schedule(s, 'good', TODAY)
        ease_before = s['ease']
        s = srs.schedule(s, 'again', TODAY)
        self.assertEqual((s['reps'], s['interval'], s['lapses']), (0, 0, 1))
        self.assertLess(s['ease'], ease_before)
        self.assertEqual(s['due'], TODAY.isoformat())
        self.assertTrue(srs.is_due(s, TODAY))
        self.assertFalse(srs.is_mature(s))

    def test_again_on_new_word_is_not_a_lapse(self):
        s = srs.schedule(srs.new_state(), 'again', TODAY)
        self.assertEqual((s['lapses'], s['ease']), (0, srs.DEFAULT_EASE))
        self.assertFalse(srs.is_new(s))

    def test_hard_grows_slower_than_good(self):
        base = srs.new_state()
        for _ in range(3):
            base = srs.schedule(base, 'good', TODAY)
        p = srs.preview(base, TODAY)
        self.assertEqual(p['again'], 0)
        self.assertLess(p['hard'], p['good'])
        self.assertGreater(p['hard'], base['interval'])

    def test_ease_never_below_minimum(self):
        s = srs.new_state()
        for _ in range(30):
            s = srs.schedule(s, 'hard', TODAY)
            s = srs.schedule(s, 'again', TODAY)
        self.assertGreaterEqual(s['ease'], srs.MIN_EASE)

    def test_interval_capped(self):
        s = dict(srs.new_state(), reps=10, interval=300, ease=2.5, due=TODAY.isoformat())
        self.assertEqual(srs.schedule(s, 'good', TODAY)['interval'], srs.MAX_INTERVAL)

    def test_schedule_does_not_mutate_input(self):
        s = srs.new_state()
        srs.schedule(s, 'good', TODAY)
        self.assertEqual(s, srs.new_state())

    def test_invalid_grade(self):
        with self.assertRaises(ValueError):
            srs.schedule(srs.new_state(), 'easy', TODAY)


class MigrationTests(unittest.TestCase):
    def test_untouched_word_stays_new(self):
        s = srs.migrate_legacy({'learned_at': None, 'quiz_correct_count': 0}, TODAY)
        self.assertTrue(srs.is_new(s))

    def test_permanent_word_becomes_mature_and_still_reviewed(self):
        w = {'learned_at': '2026-09-01T10:00:00', 'quiz_correct_count': 4,
             'permanently_learned': True}
        s = srs.migrate_legacy(w, TODAY)
        self.assertTrue(srs.is_mature(s))
        self.assertEqual(s['due'], '2026-09-22')
        self.assertTrue(srs.is_due(s, TODAY))   # vadesi geçti → sorulur

    def test_partial_progress_keeps_interval(self):
        w = {'learned_at': '2026-10-14T09:00:00', 'quiz_correct_count': 2,
             'quiz_wrong_count': 4}
        s = srs.migrate_legacy(w, TODAY)
        self.assertEqual((s['reps'], s['interval'], s['due']), (2, 3, '2026-10-17'))
        self.assertLess(s['ease'], srs.DEFAULT_EASE)

    def test_manual_review_only(self):
        s = srs.migrate_legacy({'learned_at': '2026-10-15T08:00:00'}, TODAY)
        self.assertEqual((s['reps'], s['interval'], s['due']), (1, 1, '2026-10-16'))


class ApiTests(unittest.TestCase):
    """main.Api'yi geçici bir klasördeki veriyle çalıştırır."""

    def setUp(self):
        import main
        self.main = main
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self._orig = (main.DB_FILE, main.STATS_FILE)
        main.DB_FILE    = os.path.join(self.tmp.name, 'words.json')
        main.STATS_FILE = os.path.join(self.tmp.name, 'stats.json')
        self.addCleanup(self._restore)

    def _restore(self):
        self.main.DB_FILE, self.main.STATS_FILE = self._orig

    def write_words(self, words):
        with open(self.main.DB_FILE, 'w', encoding='utf-8') as f:
            json.dump(words, f)

    def test_legacy_file_is_migrated_and_saved(self):
        self.write_words([
            {'id': 1, 'english': 'a', 'translation': 'x', 'example': '',
             'learned_at': None, 'quiz_correct_count': 0},
            {'id': 2, 'english': 'b', 'translation': 'y', 'example': '',
             'learned_at': '2026-01-01T10:00:00', 'quiz_correct_count': 4,
             'permanently_learned': True},
        ])
        self.main.Api()
        with open(self.main.DB_FILE, encoding='utf-8') as f:
            saved = json.load(f)
        self.assertTrue(all('srs' in w for w in saved))
        # taşıma öncesi hal .bak olarak duruyor
        with open(self.main.DB_FILE + '.bak', encoding='utf-8') as f:
            self.assertTrue(all('srs' not in w for w in json.load(f)))

    def test_quiz_only_returns_due_words(self):
        api = self.main.Api()
        for i in range(3):
            api.add_word(f'w{i}', 't', 'e')
        self.assertEqual(len(api.get_quiz_words(0)), 3)

        res = api.record_quiz_answer(1, 'good')
        self.assertFalse(res['needs_review'])
        ids = [w['id'] for w in api.get_quiz_words(0)]
        self.assertEqual(ids, [2, 3])   # 1 yarına ertelendi, tekrar sorulmaz

        info = api.get_quiz_info()
        self.assertEqual((info['new'], info['reviews']), (2, 0))
        self.assertIsNotNone(info['next_due'])

    def test_reviews_come_before_new_and_limit_applies(self):
        api = self.main.Api()
        for i in range(4):
            api.add_word(f'w{i}', 't', 'e')
        api.record_quiz_answer(4, 'again')   # 4 artık bugün tekrar
        ids = [w['id'] for w in api.get_quiz_words(2)]
        self.assertEqual(ids, [4, 1])

    def test_quiz_words_include_preview_but_db_does_not(self):
        api = self.main.Api()
        api.add_word('w', 't', 'e')
        q = api.get_quiz_words(0)[0]
        self.assertEqual(q['preview'], {'again': 0, 'hard': 1, 'good': 1})
        self.assertNotIn('preview', api.get_words()[0])

    def test_cannot_master_word_in_one_day(self):
        api = self.main.Api()
        api.add_word('w', 't', 'e')
        for _ in range(10):
            if api.get_quiz_words(0):
                api.record_quiz_answer(1, 'good')
        w = api.get_words()[0]
        self.assertEqual(w['quiz_correct_count'], 1)
        self.assertFalse(w['permanently_learned'])

    def test_bool_grades_still_accepted(self):
        api = self.main.Api()
        api.add_word('w', 't', 'e')
        self.assertEqual(api.record_quiz_answer(1, True)['srs']['interval'], 1)
        self.assertIsNone(api.record_quiz_answer(99, True))


if __name__ == '__main__':
    unittest.main()
