"""Veri klasörü taşıma ve yedekleme testleri. Çalıştırma: python -m unittest discover tests"""
import datetime
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import main

DAY = datetime.date(2026, 10, 15)


def write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f)


def read(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


class TempDirTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = self.tmp.name

    def path(self, *parts):
        return os.path.join(self.root, *parts)


class DataDirTests(unittest.TestCase):
    def test_env_override(self):
        with mock.patch.dict(os.environ, {'LINGUA_DATA_DIR': r'C:\ozel'}):
            self.assertEqual(main.get_data_dir(), r'C:\ozel')

    def test_frozen_uses_appdata(self):
        with mock.patch.dict(os.environ, {'APPDATA': r'C:\Users\x\AppData\Roaming'}, clear=False), \
             mock.patch.object(sys, 'frozen', True, create=True):
            os.environ.pop('LINGUA_DATA_DIR', None)
            self.assertEqual(main.get_data_dir(), os.path.join(r'C:\Users\x\AppData\Roaming', 'Lingua'))


class MigrationTests(TempDirTest):
    def test_copies_and_renames_old_files(self):
        write(self.path('exe', 'words.json'), [{'id': 1}])
        write(self.path('exe', 'words.json.bak'), [])
        write(self.path('exe', 'stats.json'), {'streak': 3})

        moved = main.migrate_legacy_data(self.path('appdata'), self.path('exe'))

        self.assertEqual(moved, ['words.json', 'stats.json'])
        self.assertEqual(read(self.path('appdata', 'words.json')), [{'id': 1}])
        self.assertEqual(read(self.path('appdata', 'stats.json')), {'streak': 3})
        self.assertTrue(os.path.exists(self.path('appdata', 'words.json.bak')))
        # eski dosyalar silinmez, yeniden adlandırılır
        self.assertFalse(os.path.exists(self.path('exe', 'words.json')))
        self.assertEqual(read(self.path('exe', 'words.json.tasindi')), [{'id': 1}])

    def test_never_overwrites_existing_new_data(self):
        write(self.path('exe', 'words.json'), [{'id': 'eski'}])
        write(self.path('appdata', 'words.json'), [{'id': 'yeni'}])
        self.assertEqual(main.migrate_legacy_data(self.path('appdata'), self.path('exe')), [])
        self.assertEqual(read(self.path('appdata', 'words.json')), [{'id': 'yeni'}])
        self.assertTrue(os.path.exists(self.path('exe', 'words.json')))   # dokunulmadı

    def test_replaces_empty_new_data_and_keeps_it(self):
        """Uygulama taşımadan önce açılıp boş liste oluşturduysa yine taşınır."""
        write(self.path('exe', 'words.json'), [{'id': 1}])
        write(self.path('exe', 'stats.json'), {'streak': 3})
        write(self.path('appdata', 'words.json'), [])
        write(self.path('appdata', 'stats.json'), {'streak': 0})

        moved = main.migrate_legacy_data(self.path('appdata'), self.path('exe'))

        self.assertEqual(moved, ['words.json', 'stats.json'])
        self.assertEqual(read(self.path('appdata', 'words.json')), [{'id': 1}])
        self.assertEqual(read(self.path('appdata', 'stats.json')), {'streak': 3})
        self.assertEqual(read(self.path('appdata', 'words.json.onceki')), [])
        self.assertEqual(read(self.path('appdata', 'stats.json.onceki')), {'streak': 0})

    def test_unreadable_new_data_is_never_replaced(self):
        write(self.path('exe', 'words.json'), [{'id': 1}])
        os.makedirs(self.path('appdata'))
        with open(self.path('appdata', 'words.json'), 'w', encoding='utf-8') as f:
            f.write('{bozuk')
        self.assertEqual(main.migrate_legacy_data(self.path('appdata'), self.path('exe')), [])
        self.assertTrue(os.path.exists(self.path('exe', 'words.json')))

    def test_same_folder_is_noop(self):
        write(self.path('words.json'), [])
        self.assertEqual(main.migrate_legacy_data(self.root, self.root), [])
        self.assertTrue(os.path.exists(self.path('words.json')))


class BackupTests(TempDirTest):
    def setUp(self):
        super().setUp()
        write(self.path('words.json'), [{'id': 1}])
        write(self.path('stats.json'), {})

    def test_first_backup_and_weekly_interval(self):
        self.assertIsNotNone(main.weekly_backup(self.root, DAY))
        self.assertEqual(read(self.path('backups', DAY.isoformat(), 'words.json')), [{'id': 1}])
        self.assertIsNone(main.weekly_backup(self.root, DAY + datetime.timedelta(days=6)))
        self.assertIsNotNone(main.weekly_backup(self.root, DAY + datetime.timedelta(days=7)))
        self.assertEqual(len(main.list_backups(self.root)), 2)

    def test_keeps_only_latest_backups(self):
        for week in range(main.BACKUPS_KEPT + 3):
            main.make_backup(self.root, DAY + datetime.timedelta(weeks=week))
        backups = main.list_backups(self.root)
        self.assertEqual(len(backups), main.BACKUPS_KEPT)
        self.assertEqual(backups[-1], (DAY + datetime.timedelta(weeks=main.BACKUPS_KEPT + 2)).isoformat())

    def test_ignores_foreign_folders(self):
        os.makedirs(self.path('backups', 'benim-notlarim'))
        main.make_backup(self.root, DAY)
        self.assertEqual(main.list_backups(self.root), [DAY.isoformat()])
        self.assertTrue(os.path.isdir(self.path('backups', 'benim-notlarim')))

    def test_nothing_to_back_up(self):
        empty = self.path('bos')
        os.makedirs(empty)
        self.assertIsNone(main.make_backup(empty, DAY))

    def test_api_backs_up_before_loading(self):
        """Uygulama açılırken yedek, SRS taşıması dosyayı değiştirmeden önce alınır."""
        orig = (main.DB_FILE, main.STATS_FILE)
        self.addCleanup(lambda: setattr(main, 'DB_FILE', orig[0]) or setattr(main, 'STATS_FILE', orig[1]))
        main.DB_FILE, main.STATS_FILE = self.path('words.json'), self.path('stats.json')

        api = main.Api()
        backups = main.list_backups(self.root)
        self.assertEqual(len(backups), 1)
        saved = read(self.path('backups', backups[0], 'words.json'))
        self.assertNotIn('srs', saved[0])          # yedek taşımadan önceki hal
        self.assertIn('srs', read(self.path('words.json'))[0])

        info = api.get_data_info()
        self.assertEqual((info['backup_count'], info['last_backup']), (1, backups[0]))
        self.assertEqual(api.backup_now(), datetime.date.today().isoformat())


if __name__ == '__main__':
    unittest.main()
