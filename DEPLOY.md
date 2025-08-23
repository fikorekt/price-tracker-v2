# Uygulama Paylaşım ve Kurulum Kılavuzu

Bu kılavuz, uygulamayı başka birine nasıl göndereceğinizi ve kurulumunu açıklar.

## 1. Projeyi Hazırlama

### Gerekli Dosyaları Kontrol Edin
Şu dosyaların mevcut olduğundan emin olun:
- `index.js`
- `package.json`
- `package-lock.json`
- `src/` klasörü ve içindeki dosyalar
- `public/` klasörü ve içindeki dosyalar
- `README.md`
- `.gitignore`

### Gereksiz Dosyaları Temizleyin
```bash
# node_modules klasörünü silmeyin, .gitignore otomatik hariç tutar
# Geçici dosyaları temizleyin
rm -rf uploads/*
```

## 2. Paylaşım Yöntemleri

### Yöntem 1: ZIP Dosyası Olarak
```bash
# Proje klasöründeyken
cd ..
zip -r fiyat-karsilastirma-tool.zip proje/ -x "proje/node_modules/*" "proje/uploads/*"
```

### Yöntem 2: GitHub ile Paylaşım
1. GitHub'da yeni bir repository oluşturun
2. Projeyi GitHub'a yükleyin:
```bash
git init
git add .
git commit -m "İlk commit"
git branch -M main
git remote add origin https://github.com/kullaniciadi/proje-adi.git
git push -u origin main
```

### Yöntem 3: Google Drive / Dropbox
- Proje klasörünü sıkıştırın (node_modules hariç)
- Cloud servisine yükleyin
- Paylaşım linkini gönderin

## 3. Alıcı Tarafında Kurulum

### Ön Gereksinimler
Alıcının bilgisayarında olması gerekenler:
- Node.js (v14 veya üzeri)
- npm (Node.js ile birlikte gelir)

### Node.js Kurulumu
Windows/Mac/Linux için: https://nodejs.org/

### Proje Kurulumu

1. **Projeyi İndirin ve Açın**
```bash
# ZIP dosyasını açın veya git clone yapın
cd fiyat-karsilastirma-tool
```

2. **Otomatik Kurulum (Önerilen)**
```bash
npm run setup
```

3. **Manuel Kurulum (Alternatif)**
```bash
# Bağımlılıkları yükle
npm install

# Uploads klasörünü oluştur
mkdir -p uploads

# Uygulamayı başlat
npm run dev
```

## 4. Hızlı Başlangıç

1. Terminal/Command Prompt açın
2. Proje klasörüne gidin: `cd /yol/proje-klasoru`
3. Kurulum: `npm run setup`
4. Başlatma: `npm run dev`
5. Tarayıcıda açın: http://localhost:3000

## 5. Sorun Giderme

### "npm: command not found" hatası
- Node.js'in kurulu olmadığını gösterir
- https://nodejs.org adresinden indirip kurun

### Port 3000 kullanımda hatası
- Başka bir uygulama 3000 portunu kullanıyor
- `index.js` dosyasında portu değiştirin veya diğer uygulamayı kapatın

### Puppeteer kurulum hatası
```bash
# Windows için
npm install puppeteer --no-optional

# Mac/Linux için
sudo npm install puppeteer --unsafe-perm=true
```

## 6. Kolay Paylaşım Scripti

Projeyi paylaşmak için hazır script:

**prepare-for-sharing.sh** (Mac/Linux):
```bash
#!/bin/bash
echo "Proje paylaşıma hazırlanıyor..."
rm -rf node_modules
rm -rf uploads/*
cd ..
zip -r fiyat-karsilastirma-$(date +%Y%m%d).zip proje/
echo "Hazır! Dosya: fiyat-karsilastirma-$(date +%Y%m%d).zip"
```

**prepare-for-sharing.bat** (Windows):
```batch
@echo off
echo Proje paylasima hazirlaniyor...
rmdir /s /q node_modules
del /q uploads\*
cd ..
powershell Compress-Archive -Path proje -DestinationPath fiyat-karsilastirma.zip
echo Hazir! Dosya: fiyat-karsilastirma.zip
```

## 7. Tek Komutla Kurulum

Alıcıya şu komutları verebilirsiniz:

**Windows:**
```batch
npm run setup && npm run dev
```

**Mac/Linux:**
```bash
npm run setup && npm run dev
```

## 8. Docker ile Paylaşım (İleri Seviye)

Dockerfile oluşturarak daha kolay kurulum sağlayabilirsiniz:

```dockerfile
FROM node:18
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN mkdir -p uploads
EXPOSE 3000
CMD ["npm", "start"]
```

## İletişim

Kurulum sırasında sorun yaşarsanız, README.md dosyasındaki sorun giderme bölümüne bakın.