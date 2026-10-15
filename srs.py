"""Aralıklı tekrar (SRS) zamanlaması — SM-2 algoritmasının sadeleştirilmiş hali.

Her kelime bir `srs` sözlüğü taşır:
    reps      Art arda doğru cevap sayısı (Bilmedim'de sıfırlanır)
    interval  Son verilen tekrar aralığı (gün)
    ease      Aralığın ne hızla büyüyeceği (kolay kelimelerde yüksek)
    due       Sonraki tekrar tarihi "YYYY-MM-DD"; None = henüz çalışılmamış yeni kelime
    lapses    Öğrenilmişken unutulma sayısı

Cevaplar:
    'again'  Bilmedim  → ilerleme sıfırlanır, kelime bugün tekrar sorulur
    'hard'   Zor       → aralık az büyür, ease düşer
    'good'   Bildim    → 1 gün, 3 gün, sonra aralık × ease
"""
import datetime

GRADES       = ('again', 'hard', 'good')
DEFAULT_EASE = 2.5
MIN_EASE     = 1.3
MAX_INTERVAL = 365
MATURE_DAYS  = 21   # bu aralığa ulaşan kelime "Kalıcı" sayılır


def new_state():
    return {'reps': 0, 'interval': 0, 'ease': DEFAULT_EASE, 'due': None, 'lapses': 0}


def is_new(state):
    return state['due'] is None


def is_due(state, today):
    return state['due'] is None or state['due'] <= today.isoformat()


def is_mature(state):
    return state['interval'] >= MATURE_DAYS


def schedule(state, grade, today):
    """Verilen cevaba göre yeni SRS durumunu döndürür (girdiyi değiştirmez)."""
    if grade not in GRADES:
        raise ValueError(f'Geçersiz cevap: {grade!r}')
    s = dict(state)

    if grade == 'again':
        if s['reps'] > 0:
            s['lapses'] += 1
            s['ease'] = max(MIN_EASE, s['ease'] - 0.2)
        s['reps'] = 0
        s['interval'] = 0
    elif grade == 'hard':
        if s['reps'] == 0:
            s['interval'] = 1
        else:
            s['interval'] = max(s['interval'] + 1, round(s['interval'] * 1.2))
        s['ease'] = max(MIN_EASE, s['ease'] - 0.15)
        s['reps'] += 1
    else:  # good
        if s['reps'] == 0:
            s['interval'] = 1
        elif s['reps'] == 1:
            s['interval'] = 3
        else:
            s['interval'] = max(s['interval'] + 1, round(s['interval'] * s['ease']))
        s['reps'] += 1

    s['interval'] = min(s['interval'], MAX_INTERVAL)
    s['ease'] = round(s['ease'], 2)
    s['due'] = (today + datetime.timedelta(days=s['interval'])).isoformat()
    return s


def preview(state, today):
    """Her cevap için kaç gün sonra tekrar sorulacağını döndürür."""
    return {g: schedule(state, g, today)['interval'] for g in GRADES}


def migrate_legacy(word, today):
    """Eski sistemdeki (4 doğru = kalıcı) ilerlemeyi SRS durumuna çevirir."""
    s = new_state()
    learned_at = word.get('learned_at')
    base = datetime.datetime.fromisoformat(learned_at).date() if learned_at else today
    correct = word.get('quiz_correct_count') or 0
    wrong   = word.get('quiz_wrong_count') or 0

    if word.get('permanently_learned'):
        s['reps'], s['interval'] = 4, MATURE_DAYS
    elif correct > 0:
        s['reps'] = min(correct, 3)
        s['interval'] = {1: 1, 2: 3, 3: 7}[s['reps']]
    elif learned_at:
        s['reps'], s['interval'] = 1, 1
    else:
        return s  # hiç çalışılmamış: yeni kelime

    s['ease'] = round(max(MIN_EASE, DEFAULT_EASE - 0.05 * wrong), 2)
    s['due'] = (base + datetime.timedelta(days=s['interval'])).isoformat()
    return s
