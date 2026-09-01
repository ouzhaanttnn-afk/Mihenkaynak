import { describe, expect, it } from 'vitest';
import { MARKET_BASE, MARKET_MEAN_REVERSION } from './balance';
import { createMarketForDay, meanReversionNudge } from './market';
import { liquidationEstimate } from './settlement';
import type { InventoryPosition, MarketState } from './types';

function simulate(days: number, seed = 159_360): {
  days: number;
  final: number;
  minimum: number;
  maximum: number;
  finalVsReference: number;
} {
  let market: MarketState = createMarketForDay(seed, 1);
  const prices = [market.goldSpot];
  for (let day = 2; day <= days; day += 1) {
    market = createMarketForDay(seed, day, market);
    prices.push(market.goldSpot);
  }
  return {
    days,
    final: Math.round(market.goldSpot),
    minimum: Math.round(Math.min(...prices)),
    maximum: Math.round(Math.max(...prices)),
    finalVsReference: Math.round((market.goldSpot / MARKET_BASE.goldGram) * 1000) / 1000,
  };
}

describe('uzun dönem ekonomi snapshotları', () => {
  it.each([30, 120, 365])('%i günlük fiyat zinciri kontrollü kalır', (days) => {
    const snapshot = simulate(days);
    expect(snapshot).toMatchSnapshot();
    expect(snapshot.minimum).toBeGreaterThan(MARKET_BASE.goldGram * 0.45);
    expect(snapshot.maximum).toBeLessThan(MARKET_BASE.goldGram * 2.2);
  });

  it('denge kuvveti yalnız serbest bandın dışında ve tavanlı çalışır', () => {
    expect(meanReversionNudge(MARKET_BASE.goldGram, MARKET_BASE.goldGram)).toBe(0);
    expect(meanReversionNudge(MARKET_BASE.goldGram * 1.05, MARKET_BASE.goldGram)).toBe(0);
    expect(meanReversionNudge(MARKET_BASE.goldGram * 2, MARKET_BASE.goldGram)).toBe(
      -MARKET_MEAN_REVERSION.dailyCap,
    );
    expect(meanReversionNudge(MARKET_BASE.goldGram * 0.3, MARKET_BASE.goldGram)).toBe(
      MARKET_MEAN_REVERSION.dailyCap,
    );
  });
});

describe('erişilebilir stok değeri', () => {
  const position: InventoryPosition = {
    itemId: 'item_1',
    quantity: 2,
    costBasis: 18_000,
    currentValue: 30_000,
    age: 2,
    demand: 'steady',
    thesis: 'retail',
    location: 'display',
    expectedExitValues: { retail: 15_000, wholesale: 11_000 },
  };

  it('en yüksek teorik kanal yerine hızlı erişilebilir kanalı kullanır', () => {
    expect(liquidationEstimate(position)).toEqual({
      value: 22_000,
      channel: 'Toptancı',
      time: '1–2 gün',
    });
  });

  it('eski kayıtta boş kanal tablosunu güvenli iskonto ile açar', () => {
    expect(liquidationEstimate({ ...position, expectedExitValues: {} }).value).toBe(26_400);
  });
});
