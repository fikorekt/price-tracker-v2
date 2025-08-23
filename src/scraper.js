const puppeteer = require('puppeteer');
const axios = require('axios');
const cheerio = require('cheerio');

class PriceScraper {
  constructor() {
    this.browser = null;
    this.browserPool = [];
    this.maxBrowsers = 3;
    this.isClosing = false;
  }

  async init() {
    if (this.isClosing) {
      throw new Error('Scraper is being closed');
    }
    
    if (!this.browser || !this.browser.connected) {
      if (this.browser) {
        try {
          await this.browser.close();
        } catch (error) {
          console.log('Browser close error:', error.message);
        }
      }
      
      this.browser = await puppeteer.launch({
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-extensions',
          '--disable-gpu',
          '--disable-web-security',
          '--no-first-run',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding'
        ]
      });
      
      this.browser.on('disconnected', () => {
        console.log('Browser disconnected');
        this.browser = null;
      });
    }
  }

  async scrapeProductWithAxios(url) {
    const startTime = Date.now();
    
    try {
      console.log(`HTTP scraping: ${url}`);
      
      const response = await Promise.race([
        axios.get(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
          },
          timeout: 20000,
          maxRedirects: 3,
          validateStatus: function (status) {
            return status >= 200 && status < 300; // 404'leri reject et
          }
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('HTTP request timeout')), 25000)
        )
      ]);

      const $ = cheerio.load(response.data);
      
      // Site-specific selector'lar
      const hostname = new URL(url).hostname;
      
      // 404 veya ürün bulunamadı kontrolü
      const pageTitle = $('title').text();
      const bodyText = $('body').text();
      const pageTitleLower = pageTitle.toLowerCase();
      const bodyTextLower = bodyText.toLowerCase();
      
      if (pageTitleLower.includes('404') || 
          pageTitleLower.includes('not found') || 
          pageTitleLower.includes('bulunamadı') ||
          pageTitle.includes('Aradığınız içeriğe şu an ulaşılamıyor') ||
          bodyTextLower.includes('ürün bulunamadı') || 
          bodyTextLower.includes('sayfa bulunamadı') ||
          bodyText.includes('Aradığınız içeriğe şu an ulaşılamıyor')) {
        return {
          url,
          title: 'Ürün Bulunamadı',
          price: null,
          currency: 'TL',
          success: false,
          error: 'Product not found (404)',
          method: 'HTTP',
          notFound: true
        };
      }
      
      // Robotistan stok durumu kontrolü
      if (hostname.includes('robotistan.com')) {
        const outOfStockText = $('body').text();
        if (outOfStockText.includes('Out Of Stock') || outOfStockText.includes('Stokta Yok')) {
          console.log('⚠️ Robotistan - Ürün stokta yok');
          // Stokta olmasa bile fiyatı çekmeye devam et
        }
      }
      let siteSpecificSelectors = [];
      
      if (hostname.includes('dokuzkimya.com')) {
        siteSpecificSelectors = [
          '[itemprop="price"]',
          '.product-price__price',
          '.product-price .money',
          '.price .money',
          '.product-form__cart-submit .money',
          '[data-price]',
          '.price-item--sale .money',
          '.money'
        ];
      } else if (hostname.includes('3dteknomarket.com')) {
        siteSpecificSelectors = [
          '.Formline.IndirimliFiyatContent .spanFiyat',
          '.Formline.PiyasafiyatiContent .spanFiyat',
          '.spanFiyat'
        ];
      } else if (hostname.includes('3dcim.com')) {
        siteSpecificSelectors = [
          '.price-current',
          '.product-price',
          '.price'
        ];
      } else if (hostname.includes('robotistan.com')) {
        siteSpecificSelectors = [
          '.product-price', // KDV dahil fiyat
          '.product-price-not-vat', // KDV hariç fiyat
          '.total_sale_price',
          '.total_base_price',
          '.sale_price'
        ];
      }

      // Fiyat bulma
      let price = null;
      const priceSelectors = [
        ...siteSpecificSelectors, // Site-specific önce
        '.Formline.IndirimliFiyatContent .spanFiyat',
        '.Formline.PiyasafiyatiContent .spanFiyat',
        '.spanFiyat',
        '.price', '.product-price', '.current-price', '.sale-price',
        '.fiyat', '.tutar', '.amount', '.cost', '.value',
        '.money', '.currency', '[data-price]'
      ];
      
      // Robotistan için özel fiyat çekme
      if (hostname.includes('robotistan.com')) {
        // Önce KDV dahil fiyatı dene
        const productPriceElement = $('.product-price').first();
        if (productPriceElement.length) {
          const priceText = productPriceElement.text().trim();
          price = this.extractPrice(priceText);
          if (price) {
            console.log(`HTTP - Robotistan KDV dahil fiyat bulundu: ${price}`);
          }
        }
        
        // Bulamazsa JavaScript değişkeninden dene
        if (!price) {
          price = this.extractRobotistanPrice($, response.data);
          if (price) {
            console.log(`HTTP - Robotistan JavaScript ile fiyat bulundu: ${price}`);
          }
        }
      }
      
      if (!price) {
        for (const selector of priceSelectors) {
          const element = $(selector).first();
          if (element.length) {
            let text = element.text().trim();
            
            // Dokuzkimya için özel işlem
            if (hostname.includes('dokuzkimya.com') && selector === '[itemprop="price"]') {
              const contentAttr = element.attr('content');
              if (contentAttr) {
                price = parseFloat(contentAttr);
                if (price && price > 0) {
                  console.log(`HTTP - Fiyat bulundu (content attribute): ${price}`);
                  break;
                }
              }
            }
            
            price = this.extractPrice(text);
            if (price) {
              console.log(`HTTP - Fiyat bulundu (${selector}): ${price}`);
              break;
            }
          }
        }
      }
      
      // Akıllı fiyat bulma sistemi  
      if (!price) {
        price = this.findSmartPrice($);
      }
      
      // Başlık
      const title = $('title').text() || $('h1').first().text() || 'Ürün başlığı bulunamadı';
      
      return {
        url,
        title: title.trim(),
        price: price,
        currency: 'TL',
        success: !!price,
        method: 'HTTP'
      };
      
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`HTTP scraping error for ${url} (${duration}ms):`, error.message);
      
      // 404 veya ürün bulunamadı durumu
      if (error.response && error.response.status === 404) {
        return {
          url,
          title: 'Ürün Bulunamadı',
          price: null,
          currency: 'TL',
          success: false,
          error: 'Product not found (404)',
          method: 'HTTP',
          notFound: true,
          duration
        };
      }
      
      return {
        url,
        title: 'HTTP Hatası',
        price: null,
        currency: 'TL',
        success: false,
        error: error.message,
        method: 'HTTP',
        duration
      };
    }
  }
  
  findSmartPrice($) {
    console.log('🔍 Akıllı fiyat arama başlatılıyor...');
    
    const allPrices = [];
    const excludePatterns = [
      /kargo.*bedava/i, /ücretsiz.*kargo/i, /free.*shipping/i,
      /kazanmanıza.*kaldı/i, /kazan/i, /earn/i,
      /kupon.*kod/i, /coupon.*code/i,
      /puan.*kazan/i, /bonus.*point/i,
      /taksit.*sayısı/i, /aylık.*ödeme/i,
      /kdv.*dahil/i, /vat.*included/i,
      /komisyon.*oranı/i, /fee.*rate/i,
      /window\./i, /function/i, /script/i, /style/i, // JavaScript/CSS içeriği
      /\.css/i, /\.js/i, /src=/i, /href=/i, // HTML attributes
      /@media/i, /font-family/i, /color:/i, // CSS properties
      /performance.*mark/i, /console\./i, // Debug kodları
      /googletagmanager/i, /analytics/i, /tracking/i // Analytics kodları
    ];

    // Önce özel selector'larla ara
    const specialSelectors = [
      '[itemprop="price"]', // Dokuzkimya için content attribute
      '.product-price__price', // Dokuzkimya için özel
      '.price', '.product-price', '.current-price', '.sale-price',
      '.fiyat', '.tutar', '.amount', '.cost', '.value',
      '[data-price]', '.money', '.currency',
      '.product-amount', '.final-price', '.selling-price'
    ];

    specialSelectors.forEach(selector => {
      $(selector).each((index, element) => {
        const $elem = $(element);
        const text = $elem.text().trim();
        let priceValue = null;
        
        // İtemprop price için content attribute kontrol et
        if (selector === '[itemprop="price"]') {
          const contentAttr = $elem.attr('content');
          if (contentAttr) {
            priceValue = parseFloat(contentAttr);
            if (priceValue && priceValue >= 1) {
              allPrices.push({
                price: priceValue,
                text: `content="${contentAttr}"`,
                className: $elem.attr('class') || '',
                tagName: element.tagName.toLowerCase(),
                context: text,
                priority: 'high',
                selector: selector + ' (content)'
              });
              return; // Bu elemandan başka fiyat aramaya gerek yok
            }
          }
        }
        
        // Gelişmiş fiyat pattern'leri
        const pricePatterns = [
          /(\d{1,3}(?:\.\d{3})+,\d{1,2})\s*(?:TL|₺|tl|Tl)/gi, // 16.000,50 TL
          /(\d{1,4},\d{1,2})\s*(?:TL|₺|tl|Tl)/gi, // 483,12 TL
          /(\d{1,3}(?:,\d{3})+\.\d{1,2})\s*(?:TL|₺|tl|Tl)/gi, // 16,000.50 TL
          /(\d{1,3}(?:[\.,]\d{3})*)\s*(?:TL|₺|tl|Tl)/gi, // 16.000 TL veya 16,000 TL
          /(\d+)\s*(?:TL|₺|tl|Tl)/gi // 1234 TL
        ];
        
        let priceMatches = [];
        pricePatterns.forEach(pattern => {
          const matches = text.match(pattern);
          if (matches) {
            priceMatches = priceMatches.concat(matches);
          }
        });
        
        if (priceMatches) {
          priceMatches.forEach(match => {
            const extractedPrice = this.extractPrice(match);
            if (extractedPrice && extractedPrice >= 1) {
              allPrices.push({
                price: extractedPrice,
                text: text.substring(0, 100),
                className: $elem.attr('class') || '',
                tagName: element.tagName.toLowerCase(),
                context: text,
                priority: 'high',
                selector: selector
              });
            }
          });
        }
      });
    });

    // Eğer özel selector'lardan bulamazsak genel arama yap
    if (allPrices.length === 0) {
      $('*').each((index, element) => {
        const $elem = $(element);
        const text = $elem.text().trim();
        const html = $elem.html() || '';
        
        // Skip if text is too long (probably contains lots of content)
        if (text.length > 200) return;
        
        // Gelişmiş fiyat pattern'i - daha esnek
        // Gelişmiş fiyat pattern'leri
        const pricePatterns = [
          /(\d{1,3}(?:\.\d{3})+,\d{1,2})\s*(?:TL|₺|tl|Tl)/gi, // 16.000,50 TL
          /(\d{1,4},\d{1,2})\s*(?:TL|₺|tl|Tl)/gi, // 483,12 TL
          /(\d{1,3}(?:,\d{3})+\.\d{1,2})\s*(?:TL|₺|tl|Tl)/gi, // 16,000.50 TL
          /(\d{1,3}(?:[\.,]\d{3})*)\s*(?:TL|₺|tl|Tl)/gi, // 16.000 TL veya 16,000 TL
          /(\d+)\s*(?:TL|₺|tl|Tl)/gi // 1234 TL
        ];
        
        let priceMatches = [];
        pricePatterns.forEach(pattern => {
          const matches = text.match(pattern);
          if (matches) {
            priceMatches = priceMatches.concat(matches);
          }
        });
        
        if (priceMatches) {
          priceMatches.forEach(match => {
            const priceValue = this.extractPrice(match);
            if (priceValue && priceValue >= 1) {
              
              // Daha akıllı dışlama - sadece kesin dışlanması gerekenleri dışla
              const shouldExclude = excludePatterns.some(pattern => {
                const textMatch = text.match(pattern);
                const htmlMatch = html.match(pattern);
                return textMatch || htmlMatch;
              });
              
              if (!shouldExclude) {
                allPrices.push({
                  price: priceValue,
                  text: text.substring(0, 100),
                  className: $elem.attr('class') || '',
                  tagName: element.tagName.toLowerCase(),
                  context: text,
                  priority: 'normal'
                });
              } else {
                console.log(`❌ Dışlandı: ${priceValue} TL - "${text.substring(0, 50)}..."`);
              }
            }
          });
        }
      });
    }

    if (allPrices.length === 0) {
      console.log('❌ Hiç geçerli fiyat bulunamadı');
      return null;
    }

    console.log(`🔍 ${allPrices.length} adet fiyat bulundu${allPrices.length > 5 ? ' (ilk 5 gösteriliyor)' : ''}:`);
    allPrices.slice(0, 5).forEach(p => {
      console.log(`  💰 ${p.price} TL - ${p.className} - "${p.text.substring(0, 30)}..." (${p.priority || 'normal'})`);
    });

    // Fiyat filtreleme ve seçimi - daha esnek
    let filteredPrices = allPrices.filter(p => {
      // Çok düşük fiyatları dışla (muhtemelen hata) - limiti düşürdük
      if (p.price < 1) return false;
      
      // Çok yüksek fiyatları dışla (muhtemelen hata)
      if (p.price > 1000000) return false;
      
      return true;
    });

    if (filteredPrices.length === 0) {
      console.log('❌ Filtreleme sonrası hiç fiyat kalmadı');
      return allPrices.length > 0 ? allPrices[0].price : null;
    }

    // Önce yüksek öncelikli fiyatları kontrol et
    const highPriorityPrices = filteredPrices.filter(p => p.priority === 'high');
    if (highPriorityPrices.length > 0) {
      console.log(`✅ Özel selector ile bulundu: ${highPriorityPrices[0].price} TL (${highPriorityPrices[0].selector})`);
      return highPriorityPrices[0].price;
    }

    // Sonra öncelik sırası: product, price, fiyat class'ları
    const priorityClasses = ['product', 'price', 'fiyat', 'cost', 'amount', 'value', 'money'];
    
    for (const priorityClass of priorityClasses) {
      const priorityPrice = filteredPrices.find(p => 
        p.className.toLowerCase().includes(priorityClass)
      );
      if (priorityPrice) {
        console.log(`✅ Öncelikli class ile bulundu: ${priorityPrice.price} TL (${priorityClass})`);
        return priorityPrice.price;
      }
    }

    // En sık geçen fiyatı bul (aynı fiyat birden fazla yerde varsa)
    const priceFreq = {};
    filteredPrices.forEach(p => {
      priceFreq[p.price] = (priceFreq[p.price] || 0) + 1;
    });
    
    const mostFrequentPrice = Object.entries(priceFreq)
      .sort((a, b) => b[1] - a[1])[0];
    
    if (mostFrequentPrice && mostFrequentPrice[1] > 1) {
      console.log(`✅ En sık geçen fiyat: ${mostFrequentPrice[0]} TL (${mostFrequentPrice[1]} kez)`);
      return parseFloat(mostFrequentPrice[0]);
    }

    // Son çare: En büyük fiyatı al (genellikle ürün fiyatı en yüksektir)
    const highestPrice = Math.max(...filteredPrices.map(p => p.price));
    console.log(`✅ En yüksek fiyat seçildi: ${highestPrice} TL`);
    return highestPrice;
  }

  extractRobotistanPrice($, html) {
    console.log('🤖 Robotistan fiyat çekme başlatılıyor...');
    
    try {
      // PRODUCT_DATA JavaScript değişkenini bul
      const productDataMatch = html.match(/var\s+PRODUCT_DATA\s*=\s*(\[.*?\]);/s);
      if (productDataMatch) {
        const productData = JSON.parse(productDataMatch[1]);
        if (productData && productData[0]) {
          const product = productData[0];
          
          // Öncelik sırası: total_sale_price > total_base_price > sale_price
          if (product.total_sale_price) {
            console.log('✅ Robotistan - total_sale_price bulundu:', product.total_sale_price);
            return parseFloat(product.total_sale_price);
          } else if (product.total_base_price) {
            console.log('✅ Robotistan - total_base_price bulundu:', product.total_base_price);
            return parseFloat(product.total_base_price);
          } else if (product.sale_price) {
            // sale_price KDV'siz fiyat, %20 KDV ekle
            const priceWithVat = parseFloat(product.sale_price) * 1.20;
            console.log('✅ Robotistan - sale_price + KDV:', priceWithVat);
            return priceWithVat;
          }
        }
      }
      
      // Alternatif: HTML içinde "İndirimli Fiyat:" ara
      const discountPriceMatch = html.match(/İndirimli\s*Fiyat:\s*([\d,\.]+)\s*TL/i);
      if (discountPriceMatch) {
        const price = this.extractPrice(discountPriceMatch[0]);
        if (price) {
          console.log('✅ Robotistan - İndirimli fiyat bulundu:', price);
          return price;
        }
      }
      
      // Son çare: Genel fiyat pattern'leri
      const pricePatterns = [
        /İndirimli\s*Fiyat:\s*([\d,\.]+)\s*TL/gi, // İndirimli Fiyat: 133,685.68 TL
        /([\d,\.]+)\s*TL(?!\s*\+\s*(?:VAT|KDV))/gi, // TL (KDV dahil)
        /Fiyat:\s*([\d,\.]+)\s*TL/gi
      ];
      
      let allPrices = [];
      for (const pattern of pricePatterns) {
        const matches = html.match(pattern);
        if (matches) {
          for (const match of matches) {
            const price = this.extractPrice(match);
            if (price && price > 100) { // Robotistan'da çok düşük fiyatlı ürün yok
              allPrices.push(price);
            }
          }
        }
      }
      
      // En yüksek fiyatı al (genellikle KDV dahil fiyat)
      if (allPrices.length > 0) {
        const maxPrice = Math.max(...allPrices);
        console.log(`✅ Robotistan - Bulunan fiyatlar: ${allPrices.join(', ')} - En yüksek: ${maxPrice}`);
        return maxPrice;
      }
    } catch (error) {
      console.error('❌ Robotistan fiyat çekme hatası:', error.message);
    }
    
    return null;
  }
  
  extractPrice(text) {
    if (!text) return null;
    
    // Önce sadece sayı ve TL/₺ olan kısımları ayıkla
    const cleanText = text.replace(/[^\d.,₺TLtl\s]/g, '').trim();
    
    const patterns = [
      // Türkçe format binlik noktalı: 16.000,50 TL veya 16.000 TL
      /(\d{1,3}(?:\.\d{3})+,\d{1,2})\s*(?:TL|₺|tl|Tl)/i,
      /(\d{1,3}(?:\.\d{3})+)\s*(?:TL|₺|tl|Tl)/i,
      // Basit ondalık: 483,12 TL
      /(\d{1,4},\d{1,2})\s*(?:TL|₺|tl|Tl)/i,
      // International format: 16,000.50 TL veya 16,000 TL  
      /(\d{1,3}(?:,\d{3})+\.\d{1,2})\s*(?:TL|₺|tl|Tl)/i,
      /(\d{1,3}(?:,\d{3})+)\s*(?:TL|₺|tl|Tl)/i,
      // Robotistan format: 133,685.68 TL
      /(\d{1,3},\d{3}\.\d{1,2})\s*(?:TL|₺|tl|Tl)/i,
      // Dokuzkimya format: 16,000.00TL (boşluksuz)
      /(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)(?:TL|₺|tl|Tl)/i,
      // Basit sayı: 1234 TL
      /(\d+)\s*(?:TL|₺|tl|Tl)/i,
      // Sadece sayı kısmı (son çare)
      /(\d{1,3}(?:[\.,]\d{3})*(?:[,\.]\d{1,2})?)/
    ];
    
    for (let pattern of patterns) {
      const match = text.match(pattern) || cleanText.match(pattern);
      if (match) {
        let price = match[1];
        
        // Fiyat formatını normalize et - daha akıllı yaklaşım
        if (price.includes('.') && price.includes(',')) {
          // Hangisi son konumda ise o ondalık ayırıcıdır
          const lastDotIndex = price.lastIndexOf('.');
          const lastCommaIndex = price.lastIndexOf(',');
          
          if (lastCommaIndex > lastDotIndex) {
            // Türkçe format: 16.000,50 -> 16000.50
            const afterComma = price.substring(lastCommaIndex + 1);
            if (afterComma.length <= 2) {
              const beforeComma = price.substring(0, lastCommaIndex);
              price = beforeComma.replace(/\./g, '') + '.' + afterComma;
            }
          } else {
            // International format: 16,000.50 -> 16000.50
            const afterDot = price.substring(lastDotIndex + 1);
            if (afterDot.length <= 2) {
              const beforeDot = price.substring(0, lastDotIndex);
              price = beforeDot.replace(/,/g, '') + '.' + afterDot;
            }
          }
        } else if (price.includes(',') && !price.includes('.')) {
          const parts = price.split(',');
          if (parts.length === 2 && parts[1].length <= 2 && parts[0].length <= 4) {
            // Basit ondalık: 483,12 -> 483.12
            price = parts[0] + '.' + parts[1];
          } else {
            // Binlik ayırıcı: 16,000 -> 16000
            price = price.replace(/,/g, '');
          }
        } else if (price.includes('.')) {
          const parts = price.split('.');
          const lastPart = parts[parts.length - 1];
          if (parts.length === 2 && lastPart.length <= 2 && parts[0].length <= 4) {
            // Basit ondalık: 483.12
            price = price;
          } else {
            // Binlik ayırıcı: 16.000 -> 16000
            price = price.replace(/\./g, '');
          }
        }
        
        const numPrice = parseFloat(price);
        if (!isNaN(numPrice) && numPrice > 0) {
          // Mantıklı fiyat aralığında mı kontrol et
          if (numPrice >= 0.01 && numPrice <= 10000000) {
            return numPrice;
          }
        }
      }
    }
    return null;
  }

  async scrapeProduct(url) {
    console.log(`\n=== SCRAPING: ${url} ===`);
    
    // Önce HTTP/Cheerio ile dene (daha hızlı ve stabil)
    console.log('1. HTTP/Cheerio yöntemi deneniyor...');
    const httpResult = await this.scrapeProductWithAxios(url);
    
    if (httpResult.success) {
      console.log('✅ HTTP yöntemi başarılı!');
      return httpResult;
    }
    
    console.log('❌ HTTP yöntemi başarısız, Puppeteer deneniyor...');
    
    // HTTP başarısızsa Puppeteer ile dene
    return await this.scrapeProductWithPuppeteer(url);
  }
  
  async scrapeProductWithPuppeteer(url) {
    let page = null;
    const startTime = Date.now();
    
    try {
      await this.init();
      
      if (this.isClosing) {
        throw new Error('Scraper is being closed');
      }
      
      page = await this.browser.newPage();
      
      // Page error handling
      page.on('error', (error) => {
        console.error('Page error:', error.message);
      });
      
      page.on('pageerror', (error) => {
        console.error('Page JavaScript error:', error.message);
      });
      
      // Daha gelişmiş bot koruma atlatma
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      await page.setViewport({ width: 1920, height: 1080 });
      
      // JavaScript etkinleştir
      await page.setJavaScriptEnabled(true);
      
      // Sayfayı yükle - timeout ve retry logic
      let retries = 3;
      let lastError;
      
      while (retries > 0) {
        try {
          await page.goto(url, { 
            waitUntil: 'domcontentloaded', 
            timeout: 20000 
          });
          break;
        } catch (error) {
          retries--;
          lastError = error;
          if (retries > 0) {
            console.log(`Retry ${3 - retries}/3 for ${url}`);
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
      }
      
      if (retries === 0) {
        throw lastError;
      }
      
      // JavaScript'in çalışması için bekle - timeout kontrollü
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Sayfanın hala aktif olduğunu kontrol et
      if (page.isClosed()) {
        throw new Error('Sayfa kapatıldı');
      }
      
      // Timeout kontrolü
      if (Date.now() - startTime > 25000) {
        throw new Error('Scraping timeout reached');
      }
      
      // Debug: Sayfa içeriğini kontrol et
      const pageContent = await page.content();
      console.log(`Sayfa boyutu: ${pageContent.length} karakter`);
      
      const productData = await page.evaluate(() => {
        console.log('=== PUPPETEER FIYAT ARAMA ===');
        console.log('Sayfa URL:', window.location.href);
        console.log('Sayfa başlığı:', document.title);
        
        // 404 kontrolü
        const pageTitle = document.title;
        const bodyText = document.body.innerText || document.body.textContent || '';
        
        if (pageTitle.includes('404') || 
            pageTitle.includes('Not Found') || 
            pageTitle.includes('Bulunamadı') ||
            pageTitle.includes('Aradığınız içeriğe şu an ulaşılamıyor') ||
            bodyText.includes('Aradığınız içeriğe şu an ulaşılamıyor') ||
            bodyText.includes('ürün bulunamadı') || 
            bodyText.includes('sayfa bulunamadı')) {
          return {
            title: 'Ürün Bulunamadı',
            price: null,
            currency: 'TL',
            notFound: true,
            error: 'Product not found (404)'
          };
        }
        const selectors = {
          price: [
            // Özel site için öncelikli selector'lar
            '.Formline.IndirimliFiyatContent .spanFiyat',
            '.Formline.PiyasafiyatiContent .spanFiyat',
            '.IndirimliFiyatContent .spanFiyat',
            '.PiyasafiyatiContent .spanFiyat',
            '.spanFiyat',
            
            // Genel selector'lar
            '.price',
            '.product-price',
            '.current-price',
            '.sale-price',
            '.price-current',
            '[data-price]',
            '.amount',
            '.cost',
            '.value',
            '.price-tag',
            '.product-price-value',
            '.sale-price-value',
            '.current-price-value',
            '.price-amount',
            '.product-amount',
            '.final-price',
            '.selling-price',
            '.discount-price',
            '.regular-price',
            '.list-price',
            '.unit-price',
            '.product-cost',
            '.item-price',
            '.offer-price',
            '.special-price',
            '.now-price',
            '.current-amount',
            '.product-value',
            '.price-display',
            '.price-info',
            '.price-wrapper',
            '.money',
            '.currency',
            '.tl',
            '.lira',
            '.fiyat',
            '.tutar',
            '.ucret',
            '.bedel',
            '.miktar',
            '.deger',
            '.para',
            '.ödeme',
            '.satis-fiyati',
            '.guncel-fiyat',
            '.indirimi-fiyat',
            '.kampanya-fiyati',
            '.ozel-fiyat',
            '.normal-fiyat',
            '.liste-fiyati',
            '.birim-fiyat',
            '.son-fiyat',
            '.net-fiyat',
            '.brüt-fiyat',
            '.kdv-dahil',
            '.kdv-hariç'
          ],
          title: [
            'h1',
            '.product-title',
            '.product-name',
            '.title',
            '[data-title]',
            '.product-heading',
            '.item-title',
            '.product-info h1',
            '.product-info h2',
            '.product-detail h1',
            '.product-detail h2',
            '.urun-adi',
            '.urun-baslik',
            '.product-ad',
            '.item-name',
            '.product-label'
          ]
        };

        function findElement(selectorArray) {
          for (let selector of selectorArray) {
            const element = document.querySelector(selector);
            if (element) return element;
          }
          return null;
        }

        function extractPrice(text) {
          if (!text) return null;
          
          // Türkçe fiyat formatları için regex
          const patterns = [
            /(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*(?:TL|₺|tl|Tl)/i,
            /(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)/,
            /(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/,
            /(\d+(?:[.,]\d{2})?)/
          ];
          
          for (let pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
              let price = match[1];
              // Türkçe format: 1.234,56 -> 1234.56
              if (price.includes('.') && price.includes(',')) {
                price = price.replace(/\./g, '').replace(',', '.');
              }
              // Sadece virgül varsa: 1234,56 -> 1234.56
              else if (price.includes(',') && !price.includes('.')) {
                price = price.replace(',', '.');
              }
              // Sadece nokta varsa ve 3 haneli gruplar halinde: 1.234 -> 1234
              else if (price.includes('.') && price.length > 4) {
                price = price.replace(/\./g, '');
              }
              
              const numPrice = parseFloat(price);
              if (!isNaN(numPrice) && numPrice > 0) {
                return numPrice;
              }
            }
          }
          return null;
        }

        const titleElement = findElement(selectors.title);
        
        let price = null;
        
        // Akıllı fiyat bulma sistemi
        function findAllPrices() {
          const allPrices = [];
          const allElements = document.querySelectorAll('*');
          
          for (let element of allElements) {
            const text = element.textContent;
            if (text && (text.includes('₺') || text.includes('TL') || text.includes('tl'))) {
              const extractedPrice = extractPrice(text);
              if (extractedPrice && extractedPrice > 0) {
                allPrices.push({
                  price: extractedPrice,
                  element: element,
                  text: text.trim(),
                  className: element.className,
                  tagName: element.tagName
                });
              }
            }
          }
          
          return allPrices;
        }
        
        // Önce özel site kontrolü
        const discountedElement = document.querySelector('.Formline.IndirimliFiyatContent .spanFiyat');
        if (discountedElement) {
          price = extractPrice(discountedElement.textContent);
          console.log('Özel site - İndirimli fiyat:', price);
        }
        
        if (!price) {
          const normalElement = document.querySelector('.Formline.PiyasafiyatiContent .spanFiyat');
          if (normalElement) {
            price = extractPrice(normalElement.textContent);
            console.log('Özel site - Normal fiyat:', price);
          }
        }
        
        // Genel yaklaşım - tüm fiyatları bul
        if (!price) {
          const priceElement = findElement(selectors.price);
          if (priceElement) {
            price = extractPrice(priceElement.textContent);
            console.log('Selector ile fiyat:', price);
          }
        }
        
        // Akıllı fiyat bulma
        if (!price) {
          const allPrices = findAllPrices();
          console.log('Bulunan tüm fiyatlar:', allPrices.map(p => `${p.price} TL (${p.className})`));
          
          if (allPrices.length > 0) {
            // Fiyatları filtrele (1 TL - 1,000,000 TL arası)
            const validPrices = allPrices.filter(p => p.price >= 1 && p.price <= 1000000);
            console.log('Geçerli fiyatlar:', validPrices.map(p => p.price));
            
            if (validPrices.length > 0) {
              // En düşük fiyatı seç (genellikle indirimli fiyat)
              validPrices.sort((a, b) => a.price - b.price);
              price = validPrices[0].price;
              console.log('Akıllı sistem - En düşük fiyat:', price);
            }
          } else {
            console.log('Hiçbir fiyat bulunamadı! Sayfa içeriği kontrol edilmeli.');
            // Sayfadaki tüm sayıları bul
            const allNumbers = document.body.textContent.match(/\d+[.,]\d+/g);
            console.log('Sayfadaki tüm sayılar:', allNumbers);
          }
        }
        
        if (!price) {
          // Tüm elementleri tara ve fiyat içeren metinleri bul
          const allElements = document.querySelectorAll('*');
          let foundPrices = [];
          
          for (let element of allElements) {
            const text = element.textContent;
            if (text && (text.includes('₺') || text.includes('TL') || text.includes('tl') || /\d+[.,]\d{2}/.test(text))) {
              const extractedPrice = extractPrice(text);
              if (extractedPrice && extractedPrice > 0 && extractedPrice < 1000000) {
                foundPrices.push({
                  price: extractedPrice,
                  element: element,
                  text: text.trim()
                });
              }
            }
          }
          
          // En büyük fiyatı al (genellikle ana fiyat)
          if (foundPrices.length > 0) {
            foundPrices.sort((a, b) => b.price - a.price);
            price = foundPrices[0].price;
          }
        }
        
        // Eğer hala fiyat bulunamadıysa, farklı yaklaşım dene
        if (!price) {
          const priceTexts = document.evaluate(
            "//text()[contains(., '₺') or contains(., 'TL') or contains(., 'tl')]",
            document,
            null,
            XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE,
            null
          );
          
          for (let i = 0; i < priceTexts.snapshotLength; i++) {
            const textNode = priceTexts.snapshotItem(i);
            const extractedPrice = extractPrice(textNode.textContent);
            if (extractedPrice && extractedPrice > 0) {
              price = extractedPrice;
              break;
            }
          }
        }

        return {
          title: titleElement ? titleElement.textContent.trim() : 'Ürün başlığı bulunamadı',
          price: price,
          currency: 'TL'
        };
      });

      return {
        url,
        ...productData,
        success: !productData.notFound && !!productData.price,
        method: 'Puppeteer'
      };
      
    } catch (error) {
      console.error(`${url} için hata:`, error.message);
      return {
        url,
        title: 'Puppeteer Hatası',
        price: null,
        currency: 'TL',
        success: false,
        error: error.message,
        method: 'Puppeteer'
      };
    } finally {
      if (page && !page.isClosed()) {
        try {
          await Promise.race([
            page.close(),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Page close timeout')), 5000)
            )
          ]);
        } catch (closeError) {
          console.log('Page close error:', closeError.message);
          try {
            await page.close();
          } catch (forceCloseError) {
            console.log('Force close error:', forceCloseError.message);
          }
        }
      }
    }
  }

  async scrapeMultipleProducts(urls) {
    const results = [];
    const maxConcurrent = 2; // Limit concurrent requests
    
    for (let i = 0; i < urls.length; i += maxConcurrent) {
      const batch = urls.slice(i, i + maxConcurrent);
      
      const batchResults = await Promise.allSettled(
        batch.map(async (url) => {
          console.log(`Scraping: ${url}`);
          return await this.scrapeProduct(url);
        })
      );
      
      batchResults.forEach((result) => {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          console.error('Batch scraping error:', result.reason);
          results.push({
            url: 'unknown',
            title: 'Batch Error',
            price: null,
            currency: 'TL',
            success: false,
            error: result.reason.message,
            method: 'Batch'
          });
        }
      });
      
      // Rate limiting between batches
      if (i + maxConcurrent < urls.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    return results;
  }

  async close() {
    this.isClosing = true;
    
    if (this.browser) {
      try {
        const pages = await this.browser.pages();
        await Promise.all(pages.map(page => 
          page.close().catch(err => console.log('Page close error:', err.message))
        ));
        
        await Promise.race([
          this.browser.close(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Browser close timeout')), 10000)
          )
        ]);
      } catch (error) {
        console.log('Browser close error:', error.message);
      } finally {
        this.browser = null;
        this.isClosing = false;
      }
    }
  }
}

module.exports = PriceScraper;