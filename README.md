# Lingua - Kelime Öğrenme Uygulaması 📚

Lingua, Python (PyWebView) ve modern web teknolojileri (HTML, CSS, JS) kullanılarak geliştirilmiş, şık ve kullanıcı dostu bir masaüstü kelime öğrenme uygulamasıdır. İngilizce kelimeleri ekleyebilir, çevirilerini ve örnek cümlelerini kaydedebilir, akıllı tekrar sistemi ile kelimeleri hafızanıza kazıyabilirsiniz.

## 🌟 Özellikler

- **Modern ve Şık Arayüz (Glassmorphism):** Göz yormayan, cam efekti detaylarına sahip animasyonlu modern tasarım.
- **Akıllı Tekrar Sistemi:** Yeni eklediğiniz kelimeler "Öğreniliyor" statüsünde başlar. Quiz'de doğru bildiğiniz kelimeler 24 saat sonra tekrar edilmek üzere otomatik olarak karşınıza çıkar.
- **🎮 Quiz (Flashcard) Modu:** Öğrenmeniz gereken kelimelere odaklanmanız için tasarlanmış özel çalışma ekranı. Kartı çevirerek kelimenin anlamını görün ve bilip bilmediğinizi işaretleyin.
- **Canlı Arama ve Filtreleme:** Aradığınız bir kelimeyi, çeviriyi veya örnek cümleyi anında bularak filtreleyebilirsiniz.
- **Gelişmiş Bildirimler:** Sıkıcı tarayıcı uyarıları yerine modern Toast (Açılır Baloncuk) bildirimleri ve özel silme onay pencereleri (Modal).
- **Hızlı Düzenleme:** Önceden eklediğiniz kelimelerde değişiklik yapma ve güncelleme imkanı.

## 🛠️ Kullanılan Teknolojiler

- **Backend:** Python, PyWebView, JSON (Veritabanı olarak)
- **Frontend:** Vanilla JavaScript, HTML5, CSS3 (Custom Animations)
- **İkonlar:** FontAwesome 6

## 🚀 Kurulum ve Çalıştırma

Projeyi bilgisayarınızda çalıştırmak için sisteminizde **Python** yüklü olmalıdır.

1. Depoyu (repository) bilgisayarınıza indirin veya klonlayın:
   ```bash
   git clone https://github.com/kullaniciadiniz/Lingua.git
   cd Lingua
   ```

2. Gerekli kütüphaneleri (PyWebView) yükleyin:
   ```bash
   pip install -r requirements.txt
   ```
   *(Eğer ortamda sorun yaşarsanız `pip install pywebview` komutunu kullanabilirsiniz.)*

3. Uygulamayı Başlatın:
   Proje dizinindeki `baslat.bat` dosyasına çift tıklayarak veya terminal üzerinden aşağıdaki komutu girerek uygulamayı başlatabilirsiniz:
   ```bash
   python main.py
   ```

## 📂 Proje Yapısı

```
Lingua/
├── main.py            # Python (PyWebView) arka planı ve API metodları
├── words.json         # Kelimelerin kaydedildiği yerel veritabanı
├── index.html         # Uygulamanın ana arayüz dosyası
├── style.css          # Animasyonlar ve tasarım detayları
├── app.js             # Form işleme, Quiz mantığı ve DOM manipülasyonu
├── baslat.bat         # Windows için hızlı başlatma kısayolu
└── requirements.txt   # Gerekli Python kütüphaneleri
```

## 🤝 Katkıda Bulunma

Geliştirmelere her zaman açığız! Katkıda bulunmak isterseniz lütfen bir "Pull Request" oluşturun veya önerilerinizi "Issues" sekmesinden iletin.

