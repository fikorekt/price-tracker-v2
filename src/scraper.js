const puppeteer = require('puppeteer');
const axios = require('axios');
const cheerio = require('cheerio');

class PriceScraper {
  constructor() {
    this.browser = null;
    this.browserPool = [];
    this.maxBrowsers = 3;
    this.isClosing = false;
    
    // Site-specific selectors based on analysis
    this.siteSpecificSelectors = {
      '3dcim.com': {
        primary: ['#indirimliFiyat .spanFiyat', '.indirimliFiyat .spanFiyat'],
        alternative: ['.IndirimliFiyatContent .spanFiyat', '.spanFiyat'],
        hiddenInputs: [],
        dataAttributes: []
      },
      'porima3d.com': {
        primary: [
          '.price-item--sale .money', 
          '.price__sale .money', 
          '.price-item .money',
          '.price .money',
          '.money'
        ],
        alternative: [
          '.price__container .money', 
          '[data-price] .money', 
          '.price-item--regular', 
          '.price-item--last',
          '.price-wrapper .money',
          '.product-price .money',
          'span[data-product-price]',
          '.price-current',
          '.current-price'
        ],
        hiddenInputs: [],
        dataAttributes: ['data-product-price', 'data-price']
      },
      'store.metatechtr.com': {
        primary: ['.product-price', '.product-current-price .product-price'],
        alternative: ['.product-price-not-vat'],
        hiddenInputs: [],
        dataAttributes: [] // data-price değeri yanlış, sadece text'i kullan
      },
      '3dteknomarket.com': {
        primary: ['#indirimliFiyat .spanFiyat', '.IndirimliFiyatContent .spanFiyat'],
        alternative: ['.spanFiyat'],
        hiddenInputs: [],
        dataAttributes: [],
        jsVariables: ['productDetailModel.productPriceStr', 'productDetailModel.productPriceKDVIncluded']
      },
      'robo90.com': {
        primary: ['.d-discountPrice .product-price', '.product-price'],
        alternative: [],
        hiddenInputs: ['#urun-fiyat-kdvli'],
        dataAttributes: []
      },
      'robolinkmarket.com': {
        primary: ['.d-discountPrice .product-price', '.product-price'],
        alternative: [],
        hiddenInputs: ['#product-price-vat-include'],
        dataAttributes: []
      },
      'robotistan.com': {
        primary: ['.product-price'],
        alternative: [],
        hiddenInputs: ['#product-price-vat-include'],
        dataAttributes: []
      }
    };
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

  getSiteConfig(url) {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      
      // Exact match first
      if (this.siteSpecificSelectors[hostname]) {
        return this.siteSpecificSelectors[hostname];
      }
      
      // Partial match for subdomains
      for (const [domain, config] of Object.entries(this.siteSpecificSelectors)) {
        if (hostname.includes(domain) || domain.includes(hostname.replace('www.', ''))) {
          return config;
        }
      }
      
      return null;
    } catch (error) {
      console.error('Error getting site config:', error.message);
      return null;
    }
  }

  // Improved Turkish price format parser
  extractPrice(text) {
    if (!text) return null;
    
    console.log(`🔍 Fiyat çıkarma deneniyor: "${text}"`);
    
    // Clean the text first
    let cleanText = text.toString().trim();
    
    // Remove currency symbols and "TL" text
    cleanText = cleanText.replace(/[₺$€]/g, '').replace(/TL/gi, '').trim();
    
    // store.metatechtr.com için özel kontrol - eğer çok büyük sayı varsa (data-default-price) atla
    if (cleanText.includes('.') && cleanText.split('.').length > 3) {
      console.log(`❌ Çok fazla nokta içeren sayı atlandı: "${cleanText}"`);
      return null;
    }
    
    // Eğer sayı 100000'den büyükse ve virgül yoksa muhtemelen yanlış format
    const tempNum = parseFloat(cleanText.replace(/\./g, ''));
    if (tempNum > 100000 && !cleanText.includes(',')) {
      console.log(`❌ Çok büyük sayı (muhtemelen yanlış format): "${cleanText}"`);
      return null;
    }
    
    // Turkish price format patterns
    const patterns = [
      // Standard Turkish format: 26.145,24 or 26.145,24 ₺
      /(\d{1,3}(?:\.\d{3})+,\d{1,2})/,
      // Simple decimal: 483,12
      /(\d{1,4},\d{1,2})/,
      // International format: 26,145.24
      /(\d{1,3}(?:,\d{3})+\.\d{1,2})/,
      // Thousands without decimal: 26.145 or 26,145
      /(\d{1,3}(?:[\.,]\d{3})+)/,
      // Simple number: 1234.56 or 1234,56
      /(\d+[,\.]\d{1,2})/,
      // Just integer: 1234
      /(\d+)/
    ];
    
    for (const pattern of patterns) {
      const match = cleanText.match(pattern);
      if (match) {
        let priceStr = match[1];
        console.log(`📊 Pattern eşleşti: "${priceStr}"`);
        
        // Convert Turkish format to standard decimal
        if (priceStr.includes('.') && priceStr.includes(',')) {
          // Turkish format: 26.145,24 -> 26145.24
          const lastCommaIndex = priceStr.lastIndexOf(',');
          const afterComma = priceStr.substring(lastCommaIndex + 1);
          if (afterComma.length <= 2) {
            const beforeComma = priceStr.substring(0, lastCommaIndex);
            priceStr = beforeComma.replace(/\./g, '') + '.' + afterComma;
          }
        } else if (priceStr.includes(',') && !priceStr.includes('.')) {
          const parts = priceStr.split(',');
          if (parts.length === 2 && parts[1].length <= 2 && parts[0].length <= 4) {
            // Simple decimal: 483,12 -> 483.12
            priceStr = parts[0] + '.' + parts[1];
          } else {
            // Thousands separator: 26,145 -> 26145
            priceStr = priceStr.replace(/,/g, '');
          }
        } else if (priceStr.includes('.')) {
          const parts = priceStr.split('.');
          const lastPart = parts[parts.length - 1];
          if (parts.length === 2 && lastPart.length <= 2 && parts[0].length <= 4) {
            // Simple decimal: 483.12 -> keep as is
          } else {
            // Thousands separator: 26.145 -> 26145
            priceStr = priceStr.replace(/\./g, '');
          }
        }
        
        const price = parseFloat(priceStr);
        if (!isNaN(price) && price > 0 && price <= 10000000) {
          console.log(`✅ Fiyat başarıyla çıkarıldı: ${price}`);
          return price;
        }
      }
    }
    
    console.log(`❌ Fiyat çıkarılamadı: "${text}"`);
    return null;
  }

  async scrapeProductWithAxios(url) {
    const startTime = Date.now();
    
    try {
      console.log(`\n🌐 HTTP scraping başlatılıyor: ${url}`);
      
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
            return status >= 200 && status < 300;
          }
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('HTTP request timeout')), 25000)
        )
      ]);

      const $ = cheerio.load(response.data);
      const hostname = new URL(url).hostname;
      
      // 404 check
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
      
      // Get site-specific configuration
      const siteConfig = this.getSiteConfig(url);
      let price = null;
      let extractionMethod = 'unknown';
      
      if (siteConfig) {
        console.log(`🎯 Site-specific config bulundu: ${hostname}`);
        
        // 1. Try data attributes first (highest priority)
        if (siteConfig.dataAttributes && siteConfig.dataAttributes.length > 0) {
          console.log('📊 Data attribute\'lar kontrol ediliyor...');
          for (const attr of siteConfig.dataAttributes) {
            const element = $(`[${attr}]`).first();
            if (element.length) {
              const attrValue = element.attr(attr);
              if (attrValue) {
                price = this.extractPrice(attrValue);
                if (price) {
                  extractionMethod = `data-attribute: ${attr}`;
                  console.log(`✅ Data attribute ile fiyat bulundu: ${price} (${attr})`);
                  break;
                }
              }
            }
          }
        }
        
        // 2. Try primary selectors
        if (!price && siteConfig.primary) {
          console.log('🎯 Primary selector\'lar kontrol ediliyor...');
          for (const selector of siteConfig.primary) {
            const element = $(selector).first();
            if (element.length) {
              const text = element.text().trim();
              price = this.extractPrice(text);
              if (price) {
                extractionMethod = `primary-selector: ${selector}`;
                console.log(`✅ Primary selector ile fiyat bulundu: ${price} (${selector})`);
                break;
              }
            }
          }
        }
        
        // 3. Try hidden inputs
        if (!price && siteConfig.hiddenInputs && siteConfig.hiddenInputs.length > 0) {
          console.log('🔒 Hidden input\'lar kontrol ediliyor...');
          for (const inputSelector of siteConfig.hiddenInputs) {
            const input = $(inputSelector).first();
            if (input.length) {
              const value = input.val() || input.attr('value');
              if (value) {
                price = this.extractPrice(value);
                if (price) {
                  extractionMethod = `hidden-input: ${inputSelector}`;
                  console.log(`✅ Hidden input ile fiyat bulundu: ${price} (${inputSelector})`);
                  break;
                }
              }
            }
          }
        }
        
        // 4. Try alternative selectors
        if (!price && siteConfig.alternative) {
          console.log('🔄 Alternative selector\'lar kontrol ediliyor...');
          for (const selector of siteConfig.alternative) {
            const element = $(selector).first();
            if (element.length) {
              const text = element.text().trim();
              price = this.extractPrice(text);
              if (price) {
                extractionMethod = `alternative-selector: ${selector}`;
                console.log(`✅ Alternative selector ile fiyat bulundu: ${price} (${selector})`);
                break;
              }
            }
          }
        }
      }
      
      // 5. Fallback to general smart price finding
      if (!price) {
        console.log('🔍 Genel akıllı fiyat arama başlatılıyor...');
        price = this.findSmartPrice($);
        if (price) {
          extractionMethod = 'smart-price-finder';
          console.log(`✅ Akıllı fiyat bulucu ile fiyat bulundu: ${price}`);
        }
      }
      
      // Get title
      const title = $('title').text() || $('h1').first().text() || 'Ürün başlığı bulunamadı';
      
      const duration = Date.now() - startTime;
      console.log(`⏱️ HTTP scraping tamamlandı (${duration}ms) - Fiyat: ${price || 'bulunamadı'} - Method: ${extractionMethod}`);
      
      return {
        url,
        title: title.trim(),
        price: price,
        currency: 'TL',
        success: !!price,
        method: 'HTTP',
        extractionMethod,
        duration
      };
      
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`❌ HTTP scraping error for ${url} (${duration}ms):`, error.message);
      
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
      /komisyon.*oranı/i, /fee.*rate/i,
      /window\./i, /function/i, /script/i, /style/i,
      /\.css/i, /\.js/i, /src=/i, /href=/i,
      /@media/i, /font-family/i, /color:/i,
      /performance.*mark/i, /console\./i,
      /googletagmanager/i, /analytics/i, /tracking/i
    ];

    // General selectors for fallback
    const generalSelectors = [
      '.price', '.product-price', '.current-price', '.sale-price',
      '.fiyat', '.tutar', '.amount', '.cost', '.value',
      '[data-price]', '.money', '.currency',
      '.product-amount', '.final-price', '.selling-price',
      '.price-current', '.price-item', '.price-wrapper',
      '.price-item--regular', '.price-item--last',
      '.price-item--sale', '.price__sale', '.price__container',
      'span[data-product-price]', '[data-product-price]'
    ];

    // Try general selectors first
    generalSelectors.forEach(selector => {
      $(selector).each((index, element) => {
        const $elem = $(element);
        const text = $elem.text().trim();
        
        if (text.length > 200) return; // Skip long texts
        
        const price = this.extractPrice(text);
        if (price && price >= 1 && price <= 1000000) {
          const shouldExclude = excludePatterns.some(pattern => 
            pattern.test(text) || pattern.test($elem.html() || '')
          );
          
          if (!shouldExclude) {
            allPrices.push({
              price: price,
              text: text.substring(0, 100),
              className: $elem.attr('class') || '',
              tagName: element.tagName.toLowerCase(),
              selector: selector,
              priority: 'high'
            });
          }
        }
      });
    });

    // If no prices found with general selectors, scan all elements
    if (allPrices.length === 0) {
      console.log('🔍 Genel selector\'larla fiyat bulunamadı, tüm elementler taranıyor...');
      
      $('*').each((index, element) => {
        const $elem = $(element);
        const text = $elem.text().trim();
        
        if (text.length > 200) return;
        
        // Look for Turkish Lira indicators
        if (text.includes('₺') || text.includes('TL') || text.includes('tl') || /\d+[.,]\d+/.test(text)) {
          const price = this.extractPrice(text);
          if (price && price >= 1 && price <= 1000000) {
            const shouldExclude = excludePatterns.some(pattern => 
              pattern.test(text) || pattern.test($elem.html() || '')
            );
            
            if (!shouldExclude) {
              allPrices.push({
                price: price,
                text: text.substring(0, 100),
                className: $elem.attr('class') || '',
                tagName: element.tagName.toLowerCase(),
                priority: 'normal'
              });
            }
          }
        }
      });
    }

    if (allPrices.length === 0) {
      console.log('❌ Hiç geçerli fiyat bulunamadı');
      return null;
    }

    console.log(`🔍 ${allPrices.length} adet fiyat bulundu${allPrices.length > 5 ? ' (ilk 5 gösteriliyor)' : ''}:`);
    allPrices.slice(0, 5).forEach(p => {
      console.log(`  💰 ${p.price} TL - ${p.className} - "${p.text.substring(0, 30)}..." (${p.priority})`);
    });

    // Prioritize high priority prices
    const highPriorityPrices = allPrices.filter(p => p.priority === 'high');
    if (highPriorityPrices.length > 0) {
      console.log(`✅ Yüksek öncelikli fiyat seçildi: ${highPriorityPrices[0].price} TL`);
      return highPriorityPrices[0].price;
    }

    // Find most frequent price
    const priceFreq = {};
    allPrices.forEach(p => {
      priceFreq[p.price] = (priceFreq[p.price] || 0) + 1;
    });
    
    const mostFrequentPrice = Object.entries(priceFreq)
      .sort((a, b) => b[1] - a[1])[0];
    
    if (mostFrequentPrice && mostFrequentPrice[1] > 1) {
      console.log(`✅ En sık geçen fiyat: ${mostFrequentPrice[0]} TL (${mostFrequentPrice[1]} kez)`);
      return parseFloat(mostFrequentPrice[0]);
    }

    // Return highest price as last resort
    const highestPrice = Math.max(...allPrices.map(p => p.price));
    console.log(`✅ En yüksek fiyat seçildi: ${highestPrice} TL`);
    return highestPrice;
  }

  async scrapeProduct(url) {
    console.log(`\n=== SCRAPING: ${url} ===`);
    
    // Try HTTP/Cheerio first (faster and more stable)
    console.log('1️⃣ HTTP/Cheerio yöntemi deneniyor...');
    const httpResult = await this.scrapeProductWithAxios(url);
    
    if (httpResult.success) {
      console.log('✅ HTTP yöntemi başarılı!');
      return httpResult;
    }
    
    console.log('❌ HTTP yöntemi başarısız, Puppeteer deneniyor...');
    
    // If HTTP fails, try Puppeteer
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
      
      // Enhanced bot protection bypass
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setJavaScriptEnabled(true);
      
      // Load page with retry logic
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
      
      // Wait for JavaScript to execute
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      if (page.isClosed()) {
        throw new Error('Sayfa kapatıldı');
      }
      
      if (Date.now() - startTime > 25000) {
        throw new Error('Scraping timeout reached');
      }
      
      // Pass site-specific selectors to page context
      const siteConfig = this.getSiteConfig(url);
      
      const productData = await page.evaluate((siteSelectors) => {
        console.log('=== PUPPETEER FIYAT ARAMA ===');
        console.log('Sayfa URL:', window.location.href);
        console.log('Sayfa başlığı:', document.title);
        
        // 404 check
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

        // Enhanced price extraction function
        function extractPrice(text) {
          if (!text) return null;
          
          console.log(`🔍 Fiyat çıkarma deneniyor: "${text}"`);
          
          let cleanText = text.toString().trim();
          cleanText = cleanText.replace(/[₺$€]/g, '').replace(/TL/gi, '').trim();
          
          const patterns = [
            /(\d{1,3}(?:\.\d{3})+,\d{1,2})/,
            /(\d{1,4},\d{1,2})/,
            /(\d{1,3}(?:,\d{3})+\.\d{1,2})/,
            /(\d{1,3}(?:[\.,]\d{3})+)/,
            /(\d+[,\.]\d{1,2})/,
            /(\d+)/
          ];
          
          for (const pattern of patterns) {
            const match = cleanText.match(pattern);
            if (match) {
              let priceStr = match[1];
              
              if (priceStr.includes('.') && priceStr.includes(',')) {
                const lastCommaIndex = priceStr.lastIndexOf(',');
                const afterComma = priceStr.substring(lastCommaIndex + 1);
                if (afterComma.length <= 2) {
                  const beforeComma = priceStr.substring(0, lastCommaIndex);
                  priceStr = beforeComma.replace(/\./g, '') + '.' + afterComma;
                }
              } else if (priceStr.includes(',') && !priceStr.includes('.')) {
                const parts = priceStr.split(',');
                if (parts.length === 2 && parts[1].length <= 2 && parts[0].length <= 4) {
                  priceStr = parts[0] + '.' + parts[1];
                } else {
                  priceStr = priceStr.replace(/,/g, '');
                }
              } else if (priceStr.includes('.')) {
                const parts = priceStr.split('.');
                const lastPart = parts[parts.length - 1];
                if (parts.length === 2 && lastPart.length <= 2 && parts[0].length <= 4) {
                  // Keep as is
                } else {
                  priceStr = priceStr.replace(/\./g, '');
                }
              }
              
              const price = parseFloat(priceStr);
              if (!isNaN(price) && price > 0 && price <= 10000000) {
                console.log(`✅ Fiyat başarıyla çıkarıldı: ${price}`);
                return price;
              }
            }
          }
          
          return null;
        }

        let price = null;
        let extractionMethod = 'unknown';
        
        // Use site-specific selectors if available
        if (siteSelectors) {
          console.log('🎯 Site-specific selectors kullanılıyor');
          
          // Try data attributes first
          if (siteSelectors.dataAttributes && siteSelectors.dataAttributes.length > 0) {
            console.log('📊 Data attribute\'lar kontrol ediliyor...');
            for (const attr of siteSelectors.dataAttributes) {
              const element = document.querySelector(`[${attr}]`);
              if (element) {
                const attrValue = element.getAttribute(attr);
                if (attrValue) {
                  console.log(`🔍 Data attribute bulundu: ${attr} = ${attrValue}`);
                  price = extractPrice(attrValue);
                  if (price) {
                    extractionMethod = `data-attribute: ${attr}`;
                    console.log(`✅ Data attribute ile fiyat bulundu: ${price} (${attr})`);
                    break;
                  }
                }
              }
            }
          }
          
          // Try primary selectors
          if (!price && siteSelectors.primary) {
            for (const selector of siteSelectors.primary) {
              const element = document.querySelector(selector);
              if (element) {
                price = extractPrice(element.textContent);
                if (price) {
                  extractionMethod = `primary-selector: ${selector}`;
                  console.log(`✅ Primary selector ile fiyat bulundu: ${price}`);
                  break;
                }
              }
            }
          }
          
          // Try hidden inputs
          if (!price && siteSelectors.hiddenInputs) {
            for (const inputSelector of siteSelectors.hiddenInputs) {
              const input = document.querySelector(inputSelector);
              if (input) {
                const value = input.value || input.getAttribute('value');
                if (value) {
                  price = extractPrice(value);
                  if (price) {
                    extractionMethod = `hidden-input: ${inputSelector}`;
                    console.log(`✅ Hidden input ile fiyat bulundu: ${price}`);
                    break;
                  }
                }
              }
            }
          }
          
          // Try alternative selectors
          if (!price && siteSelectors.alternative) {
            for (const selector of siteSelectors.alternative) {
              const element = document.querySelector(selector);
              if (element) {
                price = extractPrice(element.textContent);
                if (price) {
                  extractionMethod = `alternative-selector: ${selector}`;
                  console.log(`✅ Alternative selector ile fiyat bulundu: ${price}`);
                  break;
                }
              }
            }
          }
        }
        
        // Fallback to general search
        if (!price) {
          console.log('🔍 Genel fiyat arama başlatılıyor...');
          
          const generalSelectors = [
            '.price', '.product-price', '.current-price', '.sale-price',
            '.fiyat', '.tutar', '.amount', '.cost', '.value', '.money', '.currency',
            '.price-item--regular', '.price-item--last', '.price-item',
            '.price-item--sale', '.price__sale', '.price__container',
            'span[data-product-price]', '[data-product-price]'
          ];
          
          for (const selector of generalSelectors) {
            const element = document.querySelector(selector);
            if (element) {
              price = extractPrice(element.textContent);
              if (price) {
                extractionMethod = `general-selector: ${selector}`;
                console.log(`✅ Genel selector ile fiyat bulundu: ${price}`);
                break;
              }
            }
          }
        }
        
        // Last resort: scan all elements
        if (!price) {
          console.log('🔍 Tüm elementler taranıyor...');
          const allElements = document.querySelectorAll('*');
          
          for (let element of allElements) {
            const text = element.textContent;
            if (text && (text.includes('₺') || text.includes('TL') || text.includes('tl'))) {
              const extractedPrice = extractPrice(text);
              if (extractedPrice && extractedPrice > 0) {
                price = extractedPrice;
                extractionMethod = 'element-scan';
                console.log(`✅ Element tarama ile fiyat bulundu: ${price}`);
                break;
              }
            }
          }
        }

        const titleElement = document.querySelector('h1') || document.querySelector('title');
        
        return {
          title: titleElement ? titleElement.textContent.trim() : 'Ürün başlığı bulunamadı',
          price: price,
          currency: 'TL',
          extractionMethod: extractionMethod
        };
      }, siteConfig);

      const duration = Date.now() - startTime;
      console.log(`⏱️ Puppeteer scraping tamamlandı (${duration}ms) - Fiyat: ${productData.price || 'bulunamadı'}`);

      return {
        url,
        ...productData,
        success: !productData.notFound && !!productData.price,
        method: 'Puppeteer',
        duration
      };
      
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`❌ ${url} için Puppeteer hatası (${duration}ms):`, error.message);
      return {
        url,
        title: 'Puppeteer Hatası',
        price: null,
        currency: 'TL',
        success: false,
        error: error.message,
        method: 'Puppeteer',
        duration
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
    const maxConcurrent = 2;
    
    for (let i = 0; i < urls.length; i += maxConcurrent) {
      const batch = urls.slice(i, i + maxConcurrent);
      
      const batchResults = await Promise.allSettled(
        batch.map(async (url) => {
          console.log(`\n🚀 Scraping başlatılıyor: ${url}`);
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