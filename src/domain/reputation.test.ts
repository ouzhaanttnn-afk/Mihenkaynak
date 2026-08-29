/**
 * İTİBAR YÖNÜ — ölçülmüş bir regresyonun bekçisi.
 *
 * Bulunan hata: itibar tek yönlü aşağı iniyordu. 30 günlük simülasyonda
 * itibar 42'den 2 günde 0'a düşüyor ve 2199 müşteri boyunca orada kalıyordu;
 * kademe 2 için gereken 52'ye ticaretle ulaşmak imkânsızdı. İki ayrı sebep
 * vardı ve buradaki testler ikisini de tutar.
 */

import { describe, expect, it } from 'vitest';
import { MEMORY, TRUST } from './balance';
import { arrivalTrust, dealReputationDelta, visitReputationDelta } from './customer-memory';

describe('geliş güveni çıpası', () => {
  it('nötr itibarda nötr güvenle gelinir', () => {
    // Eski formül (itibar * 0.6) burada 30 veriyordu: dönen müşterinin
    // trustFromHistory(MEMORY.baseTrust, ...) yoluyla 20 puan çelişiyordu.
    expect(arrivalTrust(MEMORY.baseTrust, 0)).toBe(MEMORY.baseTrust);
  });

  it('itibar çıpayı değiştirmez, etrafında oynatır', () => {
    const dusuk = arrivalTrust(0, 0);
    const orta = arrivalTrust(50, 0);
    const yuksek = arrivalTrust(100, 0);
    expect(dusuk).toBeLessThan(orta);
    expect(orta).toBeLessThan(yuksek);
    // Yön simetriktir: iyi itibar ne kadar kazandırırsa kötüsü o kadar kaybettirir.
    expect(orta - dusuk).toBe(yuksek - orta);
  });

  it('5–95 bandının dışına çıkmaz', () => {
    expect(arrivalTrust(0, -50)).toBeGreaterThanOrEqual(5);
    expect(arrivalTrust(100, 50)).toBeLessThanOrEqual(95);
  });

  it('başlangıç itibarında gelen müşteri işlemi ilerletebilir', () => {
    /*
     * ASIL REGRESYON: eski formülde itibar 42'de güven ~27 idi ve
     * `dealReputationDelta` negatife düşüyordu — yani oyuncu daha ağzını
     * açmadan her işlem itibarı aşağı çekiyordu. Artık iyi giden bir işlem
     * yukarı, kötü giden aşağı gidebilmeli.
     */
    const gelis = arrivalTrust(42, 0);
    expect(dealReputationDelta(gelis + TRUST.fairDealGain)).toBeGreaterThanOrEqual(0);
    expect(dealReputationDelta(gelis - TRUST.harshDealPenalty)).toBeLessThan(0);
  });
});

describe('ziyaretin itibara yansıması', () => {
  it('kibarca anlaşamamak itibarı konuşturmaz', () => {
    // Fiyatta buluşamamak bu mesleğin normalidir; doğru eleme yapan
    // kuyumcuyu cezalandırmak oyunun ödüllendirmesi gerekeni cezalandırırdı.
    expect(visitReputationDelta(-TRUST.rejectPenalty, 'rejected')).toBe(0);
  });

  it('üst üste aşağılayıcı teklif konuşulur', () => {
    const agir = -TRUST.rejectPenalty - MEMORY.smallGainThreshold * 2;
    expect(visitReputationDelta(agir, 'rejected')).toBeLessThan(0);
  });

  it('çıkıp giden müşteri tam ağırlık taşır', () => {
    // Sabrını tüketmek redden farklıdır: yumuşatma yalnız 'rejected'a özeldir.
    const kayip = -TRUST.rejectPenalty - 6;
    expect(visitReputationDelta(kayip, 'walkedOut')).toBeLessThan(
      visitReputationDelta(kayip, 'rejected'),
    );
  });

  it('kapanan iyi işlem itibarı yükseltir', () => {
    expect(visitReputationDelta(TRUST.fairDealGain, 'accepted')).toBeGreaterThan(0);
  });

  it('tek işlem itibarı uçurmaz (GDD 10.4)', () => {
    for (const d of [-40, -12, 0, 12, 40]) {
      expect(Math.abs(visitReputationDelta(d, 'accepted'))).toBeLessThanOrEqual(5);
    }
  });
});
