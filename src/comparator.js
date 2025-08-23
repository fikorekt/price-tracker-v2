class PriceComparator {
  compareProducts(products, mainProductUrl) {
    // Ürünleri başarılı ve başarısız olarak ayır
    const validProducts = products.filter(product => 
      product.success && product.price !== null && product.price > 0
    );
    
    const failedProducts = products.filter(product => 
      !product.success || product.price === null || product.price <= 0
    );
    
    // 404 veya bulunamayan ürünleri ayır
    const notFoundProducts = failedProducts.filter(product => 
      product.notFound === true || 
      (product.error && product.error.toLowerCase().includes('not found')) ||
      (product.error && product.error.includes('404'))
    );

    if (validProducts.length === 0) {
      return {
        error: 'Hiçbir üründen fiyat bilgisi çekilemedi',
        ranking: [],
        failedProducts: failedProducts,
        notFoundProducts: notFoundProducts,
        mainProductRank: null,
        bestPrice: null,
        worstPrice: null
      };
    }

    const sortedProducts = validProducts.sort((a, b) => a.price - b.price);
    
    const mainProduct = validProducts.find(product => product.url === mainProductUrl);
    let mainProductRank = null;
    
    if (mainProduct) {
      mainProductRank = sortedProducts.findIndex(product => product.url === mainProductUrl) + 1;
    }

    const bestPrice = sortedProducts[0];
    const worstPrice = sortedProducts[sortedProducts.length - 1];

    const ranking = sortedProducts.map((product, index) => ({
      rank: index + 1,
      url: product.url,
      title: product.title,
      price: parseFloat(product.price.toFixed(2)),
      currency: product.currency,
      isMainProduct: product.url === mainProductUrl,
      priceDifference: parseFloat((product.price - bestPrice.price).toFixed(2)),
      percentageDifference: parseFloat(((product.price - bestPrice.price) / bestPrice.price * 100).toFixed(2))
    }));
    
    // Başarısız ürünleri sıralama sonuna ekle (404'ler en sonda)
    const failedRanking = failedProducts.map((product, index) => ({
      rank: sortedProducts.length + index + 1,
      url: product.url,
      title: product.title || product.error || 'Hata',
      price: null,
      currency: product.currency || 'TL',
      isMainProduct: product.url === mainProductUrl,
      priceDifference: null,
      percentageDifference: null,
      error: product.error,
      notFound: product.notFound || false
    }));
    
    // 404 ürünlerini en sona taşı
    const allRanking = [
      ...ranking,
      ...failedRanking.filter(p => !p.notFound),
      ...failedRanking.filter(p => p.notFound)
    ];

    return {
      ranking: allRanking,
      validProductsCount: validProducts.length,
      failedProductsCount: failedProducts.length,
      notFoundProductsCount: notFoundProducts.length,
      mainProductRank,
      bestPrice: {
        price: parseFloat(bestPrice.price.toFixed(2)),
        title: bestPrice.title,
        url: bestPrice.url
      },
      worstPrice: {
        price: parseFloat(worstPrice.price.toFixed(2)),
        title: worstPrice.title,
        url: worstPrice.url
      },
      totalProducts: products.length,
      summary: {
        yourRank: mainProductRank,
        totalCompetitors: validProducts.length,
        cheapestPrice: parseFloat(bestPrice.price.toFixed(2)),
        mostExpensivePrice: parseFloat(worstPrice.price.toFixed(2)),
        yourPrice: mainProduct ? parseFloat(mainProduct.price.toFixed(2)) : null,
        yourAdvantage: mainProduct ? parseFloat((mainProduct.price - bestPrice.price).toFixed(2)) : null
      }
    };
  }
}

module.exports = PriceComparator;