# Fiyat Karşılaştırma Aracı

Bu uygulama, e-ticaret sitelerindeki ürün fiyatlarını otomatik olarak karşılaştırmanızı sağlar. Excel dosyası yükleyerek toplu fiyat karşılaştırması yapabilirsiniz.

## Özellikler

- 📊 Excel dosyası ile toplu ürün yükleme
- 🔍 Otomatik fiyat çekme (web scraping)
- 📈 Fiyat sıralaması ve karşılaştırma
- 🎯 Ana ürün ve rakip fiyat analizi
- ⚡ Gerçek zamanlı ilerleme takibi
- 🚫 404 ve hatalı ürünleri otomatik tespit

## Desteklenen Siteler

- 3dcim.com
- robolinkmarket.com
- robo90.com
- robotistan.com

## Gereksinimler

- Node.js (v14 veya üzeri)
- npm veya yarn

## Kurulum

1. Projeyi bilgisayarınıza indirin veya klonlayın:
```bash
git clone <proje-url>
cd proje
```

2. Gerekli paketleri yükleyin:
```bash
npm install
```

## Kullanım

1. Uygulamayı başlatın:
```bash
npm run dev
```

2. Tarayıcınızda http://localhost:3000 adresine gidin

3. Excel dosyası hazırlayın:
   - İlk sütun: Ürün Adı
   - İkinci sütun: Ana Site URL'si
   - Üçüncü ve sonraki sütunlar: Rakip URL'leri

4. Excel dosyasını yükleyin ve "Toplu Karşılaştırma Başlat" butonuna tıklayın

## Excel Dosya Formatı

| Ürün Adı | Ana Site URL | Rakip URL 1 | Rakip URL 2 | Rakip URL 3 |
|----------|--------------|-------------|-------------|-------------|
| Ürün 1   | https://... | https://... | https://... | https://... |
| Ürün 2   | https://... | https://... | https://... | https://... |

## Örnek Excel Dosyası

Uygulamadan örnek Excel dosyası indirebilirsiniz.

## Sorun Giderme

### Port kullanımda hatası
Eğer 3000 portu kullanımdaysa, `index.js` dosyasında port numarasını değiştirebilirsiniz:
```javascript
const port = process.env.PORT || 3001; // 3001 veya başka bir port
```

### Puppeteer kurulum hatası
Puppeteer kurulumunda sorun yaşarsanız:
```bash
npm install puppeteer --no-optional
```

### Chrome/Chromium hatası
Eğer Puppeteer Chrome bulamazsa:
```bash
npm install puppeteer-core chrome-aws-lambda
```

## Notlar

- İlk çalıştırmada Puppeteer, Chromium tarayıcısını indirdiği için kurulum biraz uzun sürebilir
- Bazı siteler bot koruması kullanıyor olabilir, bu durumda fiyat çekilemeyebilir
- 404 hatası veren veya ulaşılamayan ürünler listenin sonunda gösterilir

## Lisans

Bu proje özel kullanım içindir.