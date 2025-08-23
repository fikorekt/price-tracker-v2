const XLSX = require('xlsx');

class ExcelProcessor {
  constructor() {
    this.requiredColumns = ['Ürün Adı', 'Benim Site', 'Rakip 1', 'Rakip 2', 'Rakip 3'];
  }

  processExcelFile(filePath) {
    try {
      console.log('📊 Excel dosyası işleniyor:', filePath);
      
      // Excel dosyasını oku
      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      
      // JSON'a çevir
      const jsonData = XLSX.utils.sheet_to_json(worksheet);
      
      if (jsonData.length === 0) {
        throw new Error('Excel dosyası boş');
      }

      console.log(`📈 ${jsonData.length} ürün bulundu`);
      
      // Veriyi işle ve doğrula
      const processedData = this.validateAndProcessData(jsonData);
      
      return {
        success: true,
        data: processedData,
        totalProducts: processedData.length
      };
      
    } catch (error) {
      console.error('Excel işleme hatası:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  validateAndProcessData(data) {
    const processedProducts = [];
    
    data.forEach((row, index) => {
      try {
        // Gerekli alanları kontrol et
        const productName = row['Ürün Adı'] || row['Urun Adi'] || row['Product Name'];
        const mainSiteUrl = row['Benim Site'] || row['Ana Site'] || row['Main Site'];
        
        if (!productName || !mainSiteUrl) {
          console.warn(`❌ Satır ${index + 1}: Ürün adı veya ana site linki eksik`);
          return;
        }

        // Rakip linkleri topla
        const competitorUrls = [];
        for (let i = 1; i <= 10; i++) {
          const competitorUrl = row[`Rakip ${i}`] || row[`Competitor ${i}`] || row[`Rakip${i}`];
          if (competitorUrl && this.isValidUrl(competitorUrl)) {
            competitorUrls.push(competitorUrl.trim());
          }
        }

        if (competitorUrls.length === 0) {
          console.warn(`❌ Satır ${index + 1}: Hiç rakip link bulunamadı`);
          return;
        }

        processedProducts.push({
          id: index + 1,
          productName: productName.trim(),
          mainSiteUrl: mainSiteUrl.trim(),
          competitorUrls: competitorUrls,
          totalCompetitors: competitorUrls.length
        });

        console.log(`✅ ${productName}: ${competitorUrls.length} rakip ile karşılaştırılacak`);
        
      } catch (error) {
        console.error(`Satır ${index + 1} işlenirken hata:`, error.message);
      }
    });

    console.log(`📊 Toplam ${processedProducts.length} ürün işleme hazır`);
    return processedProducts;
  }

  isValidUrl(string) {
    try {
      const url = new URL(string);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) {
      return false;
    }
  }

  generateSampleExcel(filePath) {
    const sampleData = [
      {
        'Ürün Adı': 'Bambu Lab A1 Combo 3D Yazıcı',
        'Benim Site': 'https://3dcim.com/bambulab-a1-combo-721',
        'Rakip 1': 'https://www.3dteknomarket.com/bambu-lab-a1-combo-3d-yazici',
        'Rakip 2': 'https://market.samm.com/bambu-lab-a1-combo-3d-yazici',
        'Rakip 3': 'https://porima3d.com/products/bambu-lab-a1-combo-3d-yazici',
        'Rakip 4': '',
        'Rakip 5': ''
      },
      {
        'Ürün Adı': 'PLA Filament 1.75mm',
        'Benim Site': 'https://3dcim.com/pla-filament-example',
        'Rakip 1': 'https://competitor1.com/pla-filament',
        'Rakip 2': 'https://competitor2.com/pla-filament',
        'Rakip 3': '',
        'Rakip 4': '',
        'Rakip 5': ''
      }
    ];

    const worksheet = XLSX.utils.json_to_sheet(sampleData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Ürünler');
    
    XLSX.writeFile(workbook, filePath);
    console.log('📄 Örnek Excel dosyası oluşturuldu:', filePath);
  }
}

module.exports = ExcelProcessor;