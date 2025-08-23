#!/bin/bash

echo "🚀 Proje paylaşıma hazırlanıyor..."

# Geçici dosyaları temizle
echo "📂 Geçici dosyalar temizleniyor..."
rm -rf uploads/*
rm -rf temp/*
rm -rf logs/*

# Node modules'ı kontrol et
if [ -d "node_modules" ]; then
    echo "❓ node_modules klasörünü silmek ister misiniz? (Dosya boyutunu küçültür) [E/h]"
    read -r response
    if [[ "$response" =~ ^[Ee]$ ]]; then
        rm -rf node_modules
        echo "✅ node_modules silindi"
    fi
fi

# Proje bilgilerini göster
echo ""
echo "📊 Proje Bilgileri:"
echo "- Dosya sayısı: $(find . -type f -not -path "./node_modules/*" | wc -l)"
echo "- Toplam boyut: $(du -sh . | cut -f1)"

# ZIP dosyası oluştur
cd ..
timestamp=$(date +%Y%m%d_%H%M%S)
zip_name="fiyat-karsilastirma-${timestamp}.zip"

echo ""
echo "📦 ZIP dosyası oluşturuluyor..."
zip -r "$zip_name" proje/ \
    -x "proje/node_modules/*" \
    -x "proje/.git/*" \
    -x "proje/uploads/*" \
    -x "proje/.DS_Store" \
    -x "proje/npm-debug.log*"

echo ""
echo "✅ Hazır! Dosya: $zip_name"
echo "📍 Konum: $(pwd)/$zip_name"
echo ""
echo "📋 Alıcıya gönderilecek talimatlar:"
echo "1. ZIP dosyasını açın"
echo "2. Terminal açıp proje klasörüne gidin"
echo "3. 'npm run setup' komutunu çalıştırın"
echo "4. 'npm run dev' ile uygulamayı başlatın"