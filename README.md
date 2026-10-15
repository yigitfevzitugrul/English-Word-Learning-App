# Lingua — İngilizce Kelime Öğrenme Uygulaması

Lingua, İngilizce kelimeleri **aralıklı tekrar (SRS)** yöntemiyle kalıcı olarak öğrenmek için geliştirilmiş bir Windows masaüstü uygulamasıdır. Kelimeleri kendin eklersin; uygulama her kelimeyi unutmak üzere olduğun anda tekrar sorar.

Python ([pywebview](https://pywebview.flowrl.com/)) arka ucu ve HTML / CSS / vanilla JavaScript arayüzüyle yazılmıştır; veriler yerel JSON dosyalarında tutulur, hesap veya sunucu gerektirmez.

---

## Özellikler

### Aralıklı tekrar (SM-2 tabanlı)
- Her kelime için ayrı bir tekrar takvimi tutulur. Cevabına göre bir sonraki tekrar ertelenir:

  | Cevap | Etkisi |
  |---|---|
  | **Bilmedim** | İlerleme sıfırlanır, kelime aynı quizin sonunda tekrar sorulur |
  | **Zor** | Aralık az büyür, kelimenin "kolaylık" katsayısı düşer |
  | **Bildim** | Aralık büyür: 1 gün → 3 gün → 8 → 20 → 50 gün… |

- Quiz yalnızca **tekrar zamanı gelmiş** kelimeleri sorar: önce gecikmiş tekrarlar, sonra yeni kelimeler.
- Aralığı 21 günü geçen kelimeler **Kalıcı** sayılır ama zamanı gelince yine sorulur.
- Her cevap butonunun altında bir sonraki tekrarın ne zaman olacağı gösterilir.

### Üç quiz modu, iki yön
- **Klasik:** Kartı çevir, kendini değerlendir.
- **Çoktan seçmeli:** Dört şıktan doğru anlamı seç.
- **Yazarak:** Cevabı yaz. Küçük yazım hataları ("recieve") *neredeyse doğru*, Türkçe karakter eksikliği ("sik sik") doğru sayılır; birden fazla anlamdan herhangi biri kabul edilir.
- Her mod **İngilizce → Türkçe** ve **Türkçe → İngilizce** yönünde çalışır.

### Otomatik sözlük bilgisi
- Kelimeyi yazınca telaffuz (IPA), kelime türü, İngilizce tanım ve eş anlamlılar otomatik gelir; örnek cümle alanı boşsa sözlükteki örnek önerilir.
- Kaynak: [Free Dictionary API](https://dictionaryapi.dev/), erişilemezse [Datamuse](https://www.datamuse.com/api/).
- Ayarlardaki **Eksik Sözlük Bilgilerini Doldur** ile mevcut kelimeler tek tıkla tamamlanır.

### Diğer
- **Klavye kısayolları:** `Space` kartı çevir · `1` `2` `3` cevapla · `1`–`4` şık seç · `Enter` kontrol et / devam · `Esc` quizden çık
- Telaffuz (Amerikan / İngiliz aksanı, hız ayarı), otomatik Türkçe çeviri önerisi
- İstatistikler: günlük aktivite, seri, en çok zorlanılan kelimeler
- JSON / CSV dışa aktarma, JSON içe aktarma
- Açık ve koyu tema

---

## Verileriniz nerede?

| Çalıştırma şekli | Veri klasörü |
|---|---|
| `Lingua.exe` | `%APPDATA%\Lingua` |
| `python main.py` (geliştirme) | Proje klasörü |
| Her ikisi de | `LINGUA_DATA_DIR` ortam değişkeniyle değiştirilebilir |

- Kayıtlar **atomik** yazılır: yazma yarıda kesilse bile dosya bozulmaz. Her açılışta son sağlam hal `words.json.bak` olarak saklanır; dosya bozulursa otomatik olarak yedekten kurtarılır.
- **Haftalık otomatik yedek** `backups/YYYY-MM-DD/` altına alınır, son 8 yedek saklanır. Ayarlardan **Şimdi Yedekle** ile elle de alınabilir.
- Eski sürümlerden geçişte, exe'nin yanındaki veri ilk açılışta `%APPDATA%\Lingua`'ya kopyalanır; eski dosyalar silinmez, `*.tasindi` adıyla yerinde kalır.

---

## Kurulum

**Gereksinimler:** Windows 10/11, Python 3.10+ ve [Microsoft Edge WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) (Windows 11'de yüklü gelir).

```bash
git clone https://github.com/yigitfevzitugrul/English-Word-Learning-App.git
cd English-Word-Learning-App
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

Windows'ta `baslat.bat` dosyasına çift tıklayarak da başlatabilirsiniz.

> Sözlük bilgisi, otomatik çeviri ve çevrimiçi telaffuz internet bağlantısı gerektirir; kelime ekleme ve quiz internetsiz çalışır.

### Exe olarak derleme

```bash
pip install -r requirements-dev.txt
pyinstaller --noconfirm Lingua.spec
```

Çıktı: `dist\Lingua.exe` (tek dosya, konsolsuz). Derlenen exe'nin yanında veri tutulmaz; exe istenen yere taşınabilir.

---

## Testler

```bash
python -m unittest discover tests     # Python: SRS, veri taşıma, yedekleme, API
node --test "tests/*.test.js"         # JavaScript: cevap kontrolü, sözlük ayrıştırma
```

---

## Proje yapısı

```
├── main.py              # pywebview penceresi ve JS'e açılan API (kayıt, quiz, yedekleme)
├── srs.py               # Aralıklı tekrar zamanlaması ve eski ilerlemenin taşınması
├── index.html           # Arayüz
├── style.css            # Tema ve bileşen stilleri
├── app.js               # Arayüz mantığı: kelime listesi, form, quiz, ayarlar
├── answer.js            # Yazılı cevap kontrolü (yazım hatası toleransı)
├── dictionary.js        # Sözlük bilgisi (Free Dictionary + Datamuse)
├── vendor/              # Uygulamayla gelen Inter yazı tipi ve Font Awesome ikonları (lisanslarıyla)
├── tests/               # Python (unittest) ve JavaScript (node:test) testleri
├── Lingua.spec          # PyInstaller yapılandırması
├── requirements.txt     # Çalıştırma bağımlılıkları
└── requirements-dev.txt # Derleme bağımlılıkları
```

---

## Katkıda bulunma

Öneri ve hata bildirimleri için [Issues](https://github.com/yigitfevzitugrul/English-Word-Learning-App/issues) sekmesini kullanabilir, geliştirmeler için Pull Request açabilirsiniz. Lütfen değişikliklerden önce testleri çalıştırın.
