class PriceHistory {
  constructor() {
    this.history = new Map(); // productId -> price history array
    this.maxHistoryLength = 100; // Son 100 fiyat kaydını tut
  }

  addPriceRecord(productId, productName, url, price, timestamp = new Date()) {
    if (!this.history.has(productId)) {
      this.history.set(productId, {
        productName,
        url,
        records: []
      });
    }

    const productHistory = this.history.get(productId);
    productHistory.records.push({
      price,
      timestamp,
      change: this.calculatePriceChange(productHistory.records, price)
    });

    // Maksimum kayıt sayısını aş
    if (productHistory.records.length > this.maxHistoryLength) {
      productHistory.records.shift();
    }

    console.log(`📈 Fiyat geçmişi kaydedildi: ${productName} - ${price} TL`);
  }

  calculatePriceChange(records, newPrice) {
    if (records.length === 0) return { amount: 0, percentage: 0, trend: 'stable' };

    const lastPrice = records[records.length - 1].price;
    const amount = newPrice - lastPrice;
    const percentage = ((amount / lastPrice) * 100);

    let trend = 'stable';
    if (amount > 0) trend = 'up';
    else if (amount < 0) trend = 'down';

    return {
      amount: parseFloat(amount.toFixed(2)),
      percentage: parseFloat(percentage.toFixed(2)),
      trend
    };
  }

  getProductHistory(productId) {
    return this.history.get(productId) || null;
  }

  getAllHistory() {
    const result = {};
    this.history.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }

  getLowestPrice(productId) {
    const productHistory = this.history.get(productId);
    if (!productHistory || productHistory.records.length === 0) return null;

    return Math.min(...productHistory.records.map(r => r.price));
  }

  getHighestPrice(productId) {
    const productHistory = this.history.get(productId);
    if (!productHistory || productHistory.records.length === 0) return null;

    return Math.max(...productHistory.records.map(r => r.price));
  }

  getPriceAlert(productId, targetPrice, alertType = 'below') {
    const productHistory = this.history.get(productId);
    if (!productHistory || productHistory.records.length === 0) return null;

    const currentPrice = productHistory.records[productHistory.records.length - 1].price;
    
    if (alertType === 'below' && currentPrice <= targetPrice) {
      return {
        triggered: true,
        message: `${productHistory.productName} hedef fiyatın altına düştü! Mevcut: ${currentPrice} TL, Hedef: ${targetPrice} TL`
      };
    }

    if (alertType === 'above' && currentPrice >= targetPrice) {
      return {
        triggered: true,
        message: `${productHistory.productName} hedef fiyatın üzerine çıktı! Mevcut: ${currentPrice} TL, Hedef: ${targetPrice} TL`
      };
    }

    return { triggered: false };
  }

  generatePriceReport(productId) {
    const productHistory = this.history.get(productId);
    if (!productHistory || productHistory.records.length === 0) {
      return { error: 'Ürün geçmişi bulunamadı' };
    }

    const records = productHistory.records;
    const currentPrice = records[records.length - 1].price;
    const firstPrice = records[0].price;
    const lowestPrice = this.getLowestPrice(productId);
    const highestPrice = this.getHighestPrice(productId);

    // Son 7 günlük ortalama
    const last7Days = records.filter(r => {
      const daysDiff = (new Date() - new Date(r.timestamp)) / (1000 * 60 * 60 * 24);
      return daysDiff <= 7;
    });
    const avg7Days = last7Days.length > 0 
      ? last7Days.reduce((sum, r) => sum + r.price, 0) / last7Days.length 
      : currentPrice;

    // Trend analizi
    const recentRecords = records.slice(-10); // Son 10 kayıt
    let trendDirection = 'stable';
    if (recentRecords.length >= 2) {
      const trendSum = recentRecords.reduce((sum, record, index) => {
        if (index === 0) return 0;
        return sum + (record.price - recentRecords[index - 1].price);
      }, 0);
      
      if (trendSum > 0) trendDirection = 'increasing';
      else if (trendSum < 0) trendDirection = 'decreasing';
    }

    return {
      productName: productHistory.productName,
      url: productHistory.url,
      currentPrice: parseFloat(currentPrice.toFixed(2)),
      firstPrice: parseFloat(firstPrice.toFixed(2)),
      lowestPrice: parseFloat(lowestPrice.toFixed(2)),
      highestPrice: parseFloat(highestPrice.toFixed(2)),
      priceChange: {
        amount: parseFloat((currentPrice - firstPrice).toFixed(2)),
        percentage: parseFloat(((currentPrice - firstPrice) / firstPrice * 100).toFixed(2))
      },
      average7Days: parseFloat(avg7Days.toFixed(2)),
      totalRecords: records.length,
      trendDirection,
      lastUpdate: records[records.length - 1].timestamp,
      savingsFromHighest: parseFloat((highestPrice - currentPrice).toFixed(2)),
      premiumFromLowest: parseFloat((currentPrice - lowestPrice).toFixed(2))
    };
  }

  exportHistory(format = 'json') {
    const data = this.getAllHistory();
    
    if (format === 'json') {
      return JSON.stringify(data, null, 2);
    }
    
    if (format === 'csv') {
      let csv = 'Product Name,URL,Date,Price,Change Amount,Change Percentage,Trend\n';
      
      Object.values(data).forEach(product => {
        product.records.forEach(record => {
          csv += `"${product.productName}","${product.url}","${record.timestamp}",${record.price},${record.change.amount},${record.change.percentage},"${record.change.trend}"\n`;
        });
      });
      
      return csv;
    }
    
    return data;
  }

  clearHistory(productId = null) {
    if (productId) {
      this.history.delete(productId);
      console.log(`🗑️ ${productId} ürününün geçmişi silindi`);
    } else {
      this.history.clear();
      console.log('🗑️ Tüm fiyat geçmişi silindi');
    }
  }

  getStatistics() {
    const totalProducts = this.history.size;
    let totalRecords = 0;
    let oldestRecord = null;
    let newestRecord = null;

    this.history.forEach(product => {
      totalRecords += product.records.length;
      
      product.records.forEach(record => {
        const recordDate = new Date(record.timestamp);
        if (!oldestRecord || recordDate < new Date(oldestRecord)) {
          oldestRecord = record.timestamp;
        }
        if (!newestRecord || recordDate > new Date(newestRecord)) {
          newestRecord = record.timestamp;
        }
      });
    });

    return {
      totalProducts,
      totalRecords,
      averageRecordsPerProduct: totalProducts > 0 ? Math.round(totalRecords / totalProducts) : 0,
      oldestRecord,
      newestRecord,
      trackingPeriod: oldestRecord && newestRecord 
        ? Math.ceil((new Date(newestRecord) - new Date(oldestRecord)) / (1000 * 60 * 60 * 24))
        : 0
    };
  }
}

module.exports = PriceHistory;