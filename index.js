const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const PriceScraper = require('./src/scraper');
const PriceComparator = require('./src/comparator');
const ExcelProcessor = require('./src/excelProcessor');
const PriceHistory = require('./src/priceHistory');
const AlertSystem = require('./src/alertSystem');

const app = express();
const port = process.env.PORT || 3000;

// Server timeout configuration
app.use((req, res, next) => {
  req.setTimeout(300000); // 5 minutes for requests
  res.setTimeout(300000); // 5 minutes for responses
  next();
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// Multer yapılandırması
const upload = multer({
  dest: 'uploads/',
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.xlsx', '.xls'];
    const fileExt = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(fileExt)) {
      cb(null, true);
    } else {
      cb(new Error('Sadece Excel dosyaları (.xlsx, .xls) kabul edilir'));
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

const scraper = new PriceScraper();
const comparator = new PriceComparator();
const excelProcessor = new ExcelProcessor();
const priceHistory = new PriceHistory();
const alertSystem = new AlertSystem();

// Excel dosyası yükleme ve işleme
app.post('/api/upload-excel', upload.single('excelFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Excel dosyası yüklenmedi' });
    }

    console.log('📊 Excel dosyası yüklendi:', req.file.originalname);
    
    const result = excelProcessor.processExcelFile(req.file.path);
    
    // Geçici dosyayı sil
    fs.unlinkSync(req.file.path);
    
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      success: true,
      message: `${result.totalProducts} ürün başarıyla yüklendi`,
      products: result.data
    });

  } catch (error) {
    console.error('Excel yükleme hatası:', error);
    res.status(500).json({ error: 'Excel dosyası işlenirken hata oluştu' });
  }
});

// Toplu fiyat karşılaştırması - GET for SSE
app.get('/api/batch-compare', async (req, res) => {
  try {
    const productsParam = req.query.products;
    if (!productsParam) {
      return res.status(400).json({ error: 'Products parameter gereklidir' });
    }
    
    const products = JSON.parse(productsParam);
    
    if (!products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ error: 'Ürün listesi gereklidir' });
    }

    console.log(`🚀 ${products.length} ürün için toplu karşılaştırma başlatılıyor... (SSE)`);
    
    // Set up Server-Sent Events
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });
    
    const sendUpdate = (data) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    
    sendUpdate({
      type: 'start',
      total: products.length,
      message: 'Karşılaştırma başlatıldı'
    });
    
    const results = [];
    
    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      console.log(`\n📦 ${i + 1}/${products.length} - ${product.productName}`);
      
      sendUpdate({
        type: 'progress',
        current: i + 1,
        total: products.length,
        productName: product.productName,
        message: `İşleniyor: ${product.productName}`
      });
      
      try {
        const allUrls = [product.mainSiteUrl, ...product.competitorUrls];
        const scrapedProducts = await scraper.scrapeMultipleProducts(allUrls);
        
        // Fiyat geçmişine kaydet
        scrapedProducts.forEach(scrapedProduct => {
          if (scrapedProduct.success && scrapedProduct.price) {
            const productKey = `${product.id}_${scrapedProduct.url}`;
            priceHistory.addPriceRecord(
              productKey,
              `${product.productName} - ${new URL(scrapedProduct.url).hostname}`,
              scrapedProduct.url,
              scrapedProduct.price
            );
            
            // Uyarı kontrolü
            const previousRecord = priceHistory.getProductHistory(productKey);
            if (previousRecord && previousRecord.records.length > 1) {
              const previousPrice = previousRecord.records[previousRecord.records.length - 2].price;
              const alert = alertSystem.checkPriceAlerts(productKey, scrapedProduct.price, previousPrice);
              if (alert) {
                console.log(`🚨 Uyarı tetiklendi: ${alert.message}`);
              }
            }
          }
        });
        
        const comparison = comparator.compareProducts(scrapedProducts, product.mainSiteUrl);
        
        const result = {
          id: product.id,
          productName: product.productName,
          comparison,
          scrapedProducts,
          success: true
        };
        
        results.push(result);
        
        sendUpdate({
          type: 'product_complete',
          current: i + 1,
          total: products.length,
          productName: product.productName,
          result: result,
          message: `Tamamlandı: ${product.productName}`
        });
        
        console.log(`✅ ${product.productName} tamamlandı`);
        
      } catch (error) {
        console.error(`❌ ${product.productName} hatası:`, error.message);
        
        const result = {
          id: product.id,
          productName: product.productName,
          error: error.message,
          success: false
        };
        
        results.push(result);
        
        sendUpdate({
          type: 'product_error',
          current: i + 1,
          total: products.length,
          productName: product.productName,
          error: error.message,
          message: `Hata: ${product.productName}`
        });
      }
      
      // API'yi yormamak için kısa bekleme
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log(`🎉 Toplu karşılaştırma tamamlandı! ${results.length} ürün işlendi`);
    
    sendUpdate({
      type: 'complete',
      results,
      totalProcessed: results.length,
      successCount: results.filter(r => r.success).length,
      errorCount: results.filter(r => !r.success).length,
      message: 'Tüm ürünler işlendi'
    });
    
    res.end();

  } catch (error) {
    console.error('Toplu karşılaştırma hatası:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Toplu karşılaştırma sırasında hata oluştu' });
    } else {
      res.write(`data: ${JSON.stringify({
        type: 'error',
        error: 'Toplu karşılaştırma sırasında hata oluştu',
        message: error.message
      })}\n\n`);
      res.end();
    }
  }
});

// Toplu fiyat karşılaştırması with streaming (POST fallback)
app.post('/api/batch-compare', async (req, res) => {
  try {
    const { products } = req.body;
    
    if (!products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ error: 'Ürün listesi gereklidir' });
    }

    console.log(`🚀 ${products.length} ürün için toplu karşılaştırma başlatılıyor...`);
    
    // Set up Server-Sent Events
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });
    
    const sendUpdate = (data) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    
    sendUpdate({
      type: 'start',
      total: products.length,
      message: 'Karşılaştırma başlatıldı'
    });
    
    const results = [];
    
    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      console.log(`\n📦 ${i + 1}/${products.length} - ${product.productName}`);
      
      sendUpdate({
        type: 'progress',
        current: i + 1,
        total: products.length,
        productName: product.productName,
        message: `İşleniyor: ${product.productName}`
      });
      
      try {
        const allUrls = [product.mainSiteUrl, ...product.competitorUrls];
        const scrapedProducts = await scraper.scrapeMultipleProducts(allUrls);
        
        // Fiyat geçmişine kaydet
        scrapedProducts.forEach(scrapedProduct => {
          if (scrapedProduct.success && scrapedProduct.price) {
            const productKey = `${product.id}_${scrapedProduct.url}`;
            priceHistory.addPriceRecord(
              productKey,
              `${product.productName} - ${new URL(scrapedProduct.url).hostname}`,
              scrapedProduct.url,
              scrapedProduct.price
            );
            
            // Uyarı kontrolü
            const previousRecord = priceHistory.getProductHistory(productKey);
            if (previousRecord && previousRecord.records.length > 1) {
              const previousPrice = previousRecord.records[previousRecord.records.length - 2].price;
              const alert = alertSystem.checkPriceAlerts(productKey, scrapedProduct.price, previousPrice);
              if (alert) {
                console.log(`🚨 Uyarı tetiklendi: ${alert.message}`);
              }
            }
          }
        });
        
        const comparison = comparator.compareProducts(scrapedProducts, product.mainSiteUrl);
        
        const result = {
          id: product.id,
          productName: product.productName,
          comparison,
          scrapedProducts,
          success: true
        };
        
        results.push(result);
        
        sendUpdate({
          type: 'product_complete',
          current: i + 1,
          total: products.length,
          productName: product.productName,
          result: result,
          message: `Tamamlandı: ${product.productName}`
        });
        
        console.log(`✅ ${product.productName} tamamlandı`);
        
      } catch (error) {
        console.error(`❌ ${product.productName} hatası:`, error.message);
        
        const result = {
          id: product.id,
          productName: product.productName,
          error: error.message,
          success: false
        };
        
        results.push(result);
        
        sendUpdate({
          type: 'product_error',
          current: i + 1,
          total: products.length,
          productName: product.productName,
          error: error.message,
          message: `Hata: ${product.productName}`
        });
      }
      
      // API'yi yormamak için kısa bekleme
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log(`🎉 Toplu karşılaştırma tamamlandı! ${results.length} ürün işlendi`);
    
    sendUpdate({
      type: 'complete',
      results,
      totalProcessed: results.length,
      successCount: results.filter(r => r.success).length,
      errorCount: results.filter(r => !r.success).length,
      message: 'Tüm ürünler işlendi'
    });
    
    res.end();

  } catch (error) {
    console.error('Toplu karşılaştırma hatası:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Toplu karşılaştırma sırasında hata oluştu' });
    } else {
      res.write(`data: ${JSON.stringify({
        type: 'error',
        error: 'Toplu karşılaştırma sırasında hata oluştu',
        message: error.message
      })}\n\n`);
      res.end();
    }
  }
});

// Fiyat geçmişi API'leri
app.get('/api/price-history/:productId', (req, res) => {
  try {
    const { productId } = req.params;
    const history = priceHistory.getProductHistory(productId);
    
    if (!history) {
      return res.status(404).json({ error: 'Ürün geçmişi bulunamadı' });
    }
    
    res.json({
      success: true,
      history,
      report: priceHistory.generatePriceReport(productId)
    });
  } catch (error) {
    console.error('Fiyat geçmişi hatası:', error);
    res.status(500).json({ error: 'Fiyat geçmişi alınırken hata oluştu' });
  }
});

app.get('/api/price-history', (req, res) => {
  try {
    const allHistory = priceHistory.getAllHistory();
    const statistics = priceHistory.getStatistics();
    
    res.json({
      success: true,
      history: allHistory,
      statistics
    });
  } catch (error) {
    console.error('Tüm fiyat geçmişi hatası:', error);
    res.status(500).json({ error: 'Fiyat geçmişi alınırken hata oluştu' });
  }
});

// Uyarı sistemi API'leri
app.post('/api/alerts', (req, res) => {
  try {
    const { productId, productName, type, targetPrice, percentage } = req.body;
    
    if (!productId || !productName || !type) {
      return res.status(400).json({ error: 'Gerekli alanlar eksik' });
    }
    
    const alert = alertSystem.createPriceAlert(productId, productName, {
      type,
      targetPrice,
      percentage
    });
    
    res.json({
      success: true,
      alert
    });
  } catch (error) {
    console.error('Uyarı oluşturma hatası:', error);
    res.status(500).json({ error: 'Uyarı oluşturulurken hata oluştu' });
  }
});

app.get('/api/alerts', (req, res) => {
  try {
    const alerts = alertSystem.getAllAlerts();
    const statistics = alertSystem.getStatistics();
    
    res.json({
      success: true,
      alerts,
      statistics
    });
  } catch (error) {
    console.error('Uyarılar alınırken hata:', error);
    res.status(500).json({ error: 'Uyarılar alınırken hata oluştu' });
  }
});

app.get('/api/notifications', (req, res) => {
  try {
    const { limit = 50, unreadOnly = false } = req.query;
    const notifications = alertSystem.getNotifications(
      parseInt(limit), 
      unreadOnly === 'true'
    );
    
    res.json({
      success: true,
      notifications
    });
  } catch (error) {
    console.error('Bildirimler alınırken hata:', error);
    res.status(500).json({ error: 'Bildirimler alınırken hata oluştu' });
  }
});

app.post('/api/notifications/:id/read', (req, res) => {
  try {
    const { id } = req.params;
    const success = alertSystem.markAsRead(parseInt(id));
    
    res.json({
      success,
      message: success ? 'Bildirim okundu olarak işaretlendi' : 'Bildirim bulunamadı'
    });
  } catch (error) {
    console.error('Bildirim işaretleme hatası:', error);
    res.status(500).json({ error: 'Bildirim işaretlenirken hata oluştu' });
  }
});

app.post('/api/webhooks', (req, res) => {
  try {
    const { name, url, type = 'generic' } = req.body;
    
    if (!name || !url) {
      return res.status(400).json({ error: 'İsim ve URL gereklidir' });
    }
    
    let webhook;
    if (type === 'discord') {
      webhook = alertSystem.addDiscordWebhook(url, name);
    } else if (type === 'slack') {
      webhook = alertSystem.addSlackWebhook(url);
    } else {
      webhook = alertSystem.addWebhook(name, url);
    }
    
    res.json({
      success: true,
      webhook
    });
  } catch (error) {
    console.error('Webhook ekleme hatası:', error);
    res.status(500).json({ error: 'Webhook eklenirken hata oluştu' });
  }
});

// Örnek Excel dosyası indirme
app.get('/api/sample-excel', (req, res) => {
  try {
    const samplePath = path.join(__dirname, 'sample_products.xlsx');
    excelProcessor.generateSampleExcel(samplePath);
    
    res.download(samplePath, 'ornek_urunler.xlsx', (err) => {
      if (err) {
        console.error('Dosya indirme hatası:', err);
      }
      // İndirmeden sonra dosyayı sil
      fs.unlinkSync(samplePath);
    });
  } catch (error) {
    console.error('Örnek dosya oluşturma hatası:', error);
    res.status(500).json({ error: 'Örnek dosya oluşturulamadı' });
  }
});

// Tek ürün karşılaştırması (eski sistem)
app.post('/api/compare', async (req, res) => {
  try {
    const { mainProductUrl, competitorUrls } = req.body;
    
    if (!mainProductUrl || !competitorUrls || competitorUrls.length === 0) {
      return res.status(400).json({ error: 'Ana ürün URL\'si ve rakip URL\'leri gereklidir' });
    }

    console.log('Fiyat karşılaştırması başlatılıyor...');
    
    const allUrls = [mainProductUrl, ...competitorUrls];
    const products = await scraper.scrapeMultipleProducts(allUrls);
    
    const comparison = comparator.compareProducts(products, mainProductUrl);
    
    res.json({
      success: true,
      comparison,
      products
    });
  } catch (error) {
    console.error('Hata:', error);
    res.status(500).json({ error: 'Fiyat karşılaştırması sırasında hata oluştu' });
  }
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Sunucu kapatılıyor...');
  await scraper.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Sunucu kapatılıyor...');
  await scraper.close();
  process.exit(0);
});

const server = app.listen(port, () => {
  console.log(`Server http://localhost:${port} adresinde çalışıyor`);
});

// Server timeout configuration
server.timeout = 300000; // 5 minutes
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;