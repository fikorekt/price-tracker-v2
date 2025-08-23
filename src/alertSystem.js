class AlertSystem {
  constructor() {
    this.alerts = new Map(); // productId -> alert configs
    this.notifications = [];
    this.webhooks = [];
  }

  // Fiyat uyarısı oluştur
  createPriceAlert(productId, productName, config) {
    const alertConfig = {
      productId,
      productName,
      type: config.type || 'price_drop', // price_drop, price_rise, target_price
      targetPrice: config.targetPrice,
      percentage: config.percentage, // % düşüş/artış için
      enabled: true,
      createdAt: new Date(),
      triggeredCount: 0,
      lastTriggered: null
    };

    this.alerts.set(productId, alertConfig);
    console.log(`🔔 Uyarı oluşturuldu: ${productName} - ${config.type}`);
    
    return alertConfig;
  }

  // Fiyat kontrolü ve uyarı tetikleme
  checkPriceAlerts(productId, currentPrice, previousPrice) {
    const alert = this.alerts.get(productId);
    if (!alert || !alert.enabled) return null;

    let shouldTrigger = false;
    let message = '';

    switch (alert.type) {
      case 'price_drop':
        if (alert.targetPrice && currentPrice <= alert.targetPrice) {
          shouldTrigger = true;
          message = `${alert.productName} hedef fiyata düştü! ${currentPrice} ₺ (Hedef: ${alert.targetPrice} ₺)`;
        } else if (alert.percentage && previousPrice) {
          const dropPercentage = ((previousPrice - currentPrice) / previousPrice) * 100;
          if (dropPercentage >= alert.percentage) {
            shouldTrigger = true;
            message = `${alert.productName} %${dropPercentage.toFixed(1)} düştü! ${currentPrice} ₺`;
          }
        }
        break;

      case 'price_rise':
        if (alert.targetPrice && currentPrice >= alert.targetPrice) {
          shouldTrigger = true;
          message = `${alert.productName} hedef fiyata yükseldi! ${currentPrice} ₺ (Hedef: ${alert.targetPrice} ₺)`;
        } else if (alert.percentage && previousPrice) {
          const risePercentage = ((currentPrice - previousPrice) / previousPrice) * 100;
          if (risePercentage >= alert.percentage) {
            shouldTrigger = true;
            message = `${alert.productName} %${risePercentage.toFixed(1)} yükseldi! ${currentPrice} ₺`;
          }
        }
        break;

      case 'target_price':
        if (currentPrice === alert.targetPrice) {
          shouldTrigger = true;
          message = `${alert.productName} tam hedef fiyata ulaştı! ${currentPrice} ₺`;
        }
        break;
    }

    if (shouldTrigger) {
      return this.triggerAlert(productId, message, currentPrice);
    }

    return null;
  }

  // Uyarı tetikleme
  triggerAlert(productId, message, price) {
    const alert = this.alerts.get(productId);
    if (!alert) return null;

    const notification = {
      id: Date.now(),
      productId,
      productName: alert.productName,
      message,
      price,
      type: alert.type,
      timestamp: new Date(),
      read: false
    };

    this.notifications.unshift(notification);
    alert.triggeredCount++;
    alert.lastTriggered = new Date();

    // Maksimum 100 bildirim tut
    if (this.notifications.length > 100) {
      this.notifications = this.notifications.slice(0, 100);
    }

    console.log(`🚨 UYARI TETİKLENDİ: ${message}`);
    
    // Webhook'ları tetikle
    this.sendWebhookNotifications(notification);
    
    return notification;
  }

  // Webhook bildirimleri
  async sendWebhookNotifications(notification) {
    for (const webhook of this.webhooks) {
      try {
        const payload = {
          productName: notification.productName,
          message: notification.message,
          price: notification.price,
          timestamp: notification.timestamp,
          type: notification.type
        };

        await fetch(webhook.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...webhook.headers
          },
          body: JSON.stringify(payload)
        });

        console.log(`📤 Webhook gönderildi: ${webhook.name}`);
      } catch (error) {
        console.error(`❌ Webhook hatası (${webhook.name}):`, error.message);
      }
    }
  }

  // Webhook ekle
  addWebhook(name, url, headers = {}) {
    const webhook = {
      id: Date.now(),
      name,
      url,
      headers,
      createdAt: new Date(),
      enabled: true
    };

    this.webhooks.push(webhook);
    console.log(`🔗 Webhook eklendi: ${name}`);
    
    return webhook;
  }

  // Discord webhook için özel method
  addDiscordWebhook(webhookUrl, username = 'PriceTracker Pro') {
    return this.addWebhook('Discord', webhookUrl, {
      'User-Agent': 'PriceTracker Pro'
    });
  }

  // Slack webhook için özel method
  addSlackWebhook(webhookUrl) {
    return this.addWebhook('Slack', webhookUrl, {
      'Content-Type': 'application/json'
    });
  }

  // Bildirimleri getir
  getNotifications(limit = 50, unreadOnly = false) {
    let notifications = this.notifications;
    
    if (unreadOnly) {
      notifications = notifications.filter(n => !n.read);
    }
    
    return notifications.slice(0, limit);
  }

  // Bildirimi okundu olarak işaretle
  markAsRead(notificationId) {
    const notification = this.notifications.find(n => n.id === notificationId);
    if (notification) {
      notification.read = true;
      return true;
    }
    return false;
  }

  // Tüm bildirimleri okundu olarak işaretle
  markAllAsRead() {
    this.notifications.forEach(n => n.read = true);
    return this.notifications.length;
  }

  // Uyarı durumunu değiştir
  toggleAlert(productId, enabled = null) {
    const alert = this.alerts.get(productId);
    if (!alert) return false;

    alert.enabled = enabled !== null ? enabled : !alert.enabled;
    console.log(`🔔 Uyarı ${alert.enabled ? 'etkinleştirildi' : 'devre dışı bırakıldı'}: ${alert.productName}`);
    
    return alert.enabled;
  }

  // Uyarı sil
  deleteAlert(productId) {
    const deleted = this.alerts.delete(productId);
    if (deleted) {
      console.log(`🗑️ Uyarı silindi: ${productId}`);
    }
    return deleted;
  }

  // Tüm uyarıları getir
  getAllAlerts() {
    const alerts = {};
    this.alerts.forEach((value, key) => {
      alerts[key] = value;
    });
    return alerts;
  }

  // İstatistikler
  getStatistics() {
    const totalAlerts = this.alerts.size;
    const activeAlerts = Array.from(this.alerts.values()).filter(a => a.enabled).length;
    const totalNotifications = this.notifications.length;
    const unreadNotifications = this.notifications.filter(n => !n.read).length;
    
    let totalTriggers = 0;
    this.alerts.forEach(alert => {
      totalTriggers += alert.triggeredCount;
    });

    return {
      totalAlerts,
      activeAlerts,
      inactiveAlerts: totalAlerts - activeAlerts,
      totalNotifications,
      unreadNotifications,
      readNotifications: totalNotifications - unreadNotifications,
      totalTriggers,
      webhooksCount: this.webhooks.length
    };
  }

  // Toplu uyarı oluşturma
  createBulkAlerts(products, alertConfig) {
    const createdAlerts = [];
    
    products.forEach(product => {
      const alert = this.createPriceAlert(product.id, product.productName, alertConfig);
      createdAlerts.push(alert);
    });

    console.log(`📦 ${createdAlerts.length} adet toplu uyarı oluşturuldu`);
    return createdAlerts;
  }

  // Akıllı uyarı önerileri
  suggestAlerts(priceHistory) {
    const suggestions = [];

    Object.entries(priceHistory).forEach(([productId, history]) => {
      if (history.records.length < 5) return; // Yeterli veri yok

      const prices = history.records.map(r => r.price);
      const currentPrice = prices[prices.length - 1];
      const avgPrice = prices.reduce((sum, p) => sum + p, 0) / prices.length;
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);

      // Ortalamadan %10 düşük fiyat için uyarı öner
      if (currentPrice > avgPrice * 0.9) {
        suggestions.push({
          productId,
          productName: history.productName,
          type: 'price_drop',
          targetPrice: Math.round(avgPrice * 0.9),
          reason: 'Ortalama fiyatın %10 altı',
          priority: 'medium'
        });
      }

      // En düşük fiyata yakın uyarı öner
      if (currentPrice > minPrice * 1.05) {
        suggestions.push({
          productId,
          productName: history.productName,
          type: 'price_drop',
          targetPrice: Math.round(minPrice * 1.05),
          reason: 'En düşük fiyata yakın',
          priority: 'high'
        });
      }

      // Volatilite yüksekse %5 düşüş uyarısı öner
      const volatility = (maxPrice - minPrice) / avgPrice;
      if (volatility > 0.2) {
        suggestions.push({
          productId,
          productName: history.productName,
          type: 'price_drop',
          percentage: 5,
          reason: 'Yüksek fiyat volatilitesi',
          priority: 'low'
        });
      }
    });

    return suggestions;
  }

  // Uyarı verilerini dışa aktar
  exportAlerts() {
    return {
      alerts: this.getAllAlerts(),
      notifications: this.notifications,
      webhooks: this.webhooks.map(w => ({
        ...w,
        url: w.url.substring(0, 20) + '...' // Güvenlik için URL'yi kısalt
      })),
      statistics: this.getStatistics(),
      exportDate: new Date()
    };
  }

  // Uyarı verilerini içe aktar
  importAlerts(data) {
    try {
      if (data.alerts) {
        this.alerts.clear();
        Object.entries(data.alerts).forEach(([key, value]) => {
          this.alerts.set(key, value);
        });
      }

      if (data.notifications) {
        this.notifications = data.notifications;
      }

      if (data.webhooks) {
        this.webhooks = data.webhooks;
      }

      console.log('📥 Uyarı verileri başarıyla içe aktarıldı');
      return true;
    } catch (error) {
      console.error('❌ Uyarı verilerini içe aktarma hatası:', error);
      return false;
    }
  }
}

module.exports = AlertSystem;