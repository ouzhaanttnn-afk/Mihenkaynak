/**
 * DÜKKAN — ana aktif müşteri ekranı
 * Kaynak: GDD 23.9.3 wireframe, 23.10 "Dükkan Ekranı – Durumlar",
 *         23.11 Araç Rayı, 23.12 Karar Dock'u.
 *
 * BAĞLAYICI KURALLAR (GDD 23.24 "Claude / Uygulama Ajanı İçin"):
 *  ✔ Tek baskın İşlem Masası — dashboard kartları yığını yok.
 *  ✔ Aktif müşteride dikey scroll yok; CTA scroll altında kalmaz.
 *  ✔ Test araçları tek Bağlamsal Araç Rayı'nda; sayfalara dağılmaz.
 *  ✔ İncele/Değerle/Tez/Pazarlık ayrı tam ekran değil, aynı Workbench state'i.
 *  ✔ Karşı teklif yeni modal/sayfa açmaz.
 *  ✔ Rutin işlemde confirmation popup yok.
 *  ✔ İkon tek başına anlam taşımaz; her araçta metin etiketi var.
 */

import { TERM } from '@ui/terms';
import { useEffect, useMemo, useState } from 'react';

import { DAY, NEGOTIATION } from '@domain/balance';
import { effectiveCeiling, suggestedChannel } from '@domain/thesis';
import { isTerminal } from '@domain/negotiation';
import { liquidityRatio } from '@domain/settlement';
import { toolsForLevel } from '@data/tools';
import { getServiceType } from '@data/service-types';
import { expectedCompletionDay, findQuote } from '@domain/service';
import { activeLine, canEnterStage, selectors, useGame } from '@state/gameStore';
import { offerableStock } from '@domain/purchase';
import { bullionUnitValue, marketReferenceBuy, unitPriceView } from '@domain/channels';
import { isBullion } from '@data/bullion';
import { CLASS_LABEL, flowPolicy, isToolRelevant } from '@domain/transaction-class';

import { CustomerStrip } from '@ui/shell/CustomerStrip';
import { DecisionDock } from '@ui/shell/DecisionDock';
import { MarketStrip } from '@ui/shell/MarketStrip';
import { StageStrip } from '@ui/shell/StageStrip';
import { StatusStrip } from '@ui/shell/StatusStrip';
import { ToolRail, type RailItem } from '@ui/shell/ToolRail';

import { AppraiseStage } from '@ui/workbench/AppraiseStage';
import { InspectStage } from '@ui/workbench/InspectStage';
import { NegotiateStage } from '@ui/workbench/NegotiateStage';
import { ResultStage } from '@ui/workbench/ResultStage';
import { ThesisStage } from '@ui/workbench/ThesisStage';
import {
  DiagnoseStage,
  JobQueueStage,
  PromiseStage,
  QuoteStage,
} from '@ui/workbench/ServiceStages';
import { PackageStage, StockPickStage } from '@ui/workbench/PurchaseStages';
import { OfferControl, liquidityImpact, type OfferImpact } from '@ui/workbench/OfferControl';

import {
  IconClock,
  IconCollection,
  IconCounter,
  IconDensity,
  IconGesture,
  IconLiquidity,
  IconLoupe,
  IconMagnet,
  IconMelt,
  IconPackage,
  IconReason,
  IconReject,
  IconRetail,
  IconScale,
  IconSend,
  IconServiceResale,
  IconSpectrometer,
  IconTouchstone,
  IconVideo,
  IconWarning,
  IconWholesale,
  IconWorkshop,
} from '@ui/icons';
import { clock, pct, tl, tlSigned, tonWord } from '@ui/format';
import type {
  DealLine,
  ExitChannel,
  InfoField,
  ItemInstance,
  MarketState,
  Money,
  WorkbenchStage,
} from '@domain/types';

const TOOL_ICON: Record<string, typeof IconScale> = {
  scale: IconScale,
  magnet: IconMagnet,
  touchstone: IconTouchstone,
  density: IconDensity,
  loupe: IconLoupe,
  spectrometer: IconSpectrometer,
};

export function ShopScreen() {
  const s = useGame();
  const deal = s.activeDeal;
  const line = deal ? activeLine(deal) : undefined;
  const item = line ? s.items[line.itemId] : undefined;

  const liquidity = liquidityRatio(s.store.cash, s.inventory);

  // Teklif tutarı — aşama değiştikçe alış tavanına göre yeniden konumlanır.
  const ceiling = line ? effectiveCeiling(line.thesisOptions, line.selectedThesis) : 0;
  const [offer, setOffer] = useState<Money>(0);

  const offerBounds = useMemo(() => {
    if (!line?.band) return { min: 0, max: 0, step: 100 };
    // Slider aralığı: bandın altından tavanın üstüne. Oyuncu tavanı aşabilir —
    // sistem "bu fiyattan al" emri vermez (GDD 6.6), yalnız etkisini gösterir.
    const min = Math.max(0, Math.round(line.band.min * 0.55));
    const max = Math.max(min + 1000, Math.round(Math.max(ceiling, line.band.max) * 1.15));
    const span = max - min;
    const step = span > 200_000 ? 500 : span > 40_000 ? 100 : 50;
    return { min, max, step };
  }, [line?.band, ceiling]);

  // Pazarlığa girildiğinde teklifi tavana yakın makul bir yerden başlat.
  useEffect(() => {
    if (deal?.stage === 'negotiate' && offer === 0 && ceiling > 0) {
      setOffer(Math.round(ceiling * 0.9));
    }
  }, [deal?.stage, ceiling, offer]);

  // Yeni kalem / yeni müşteri → teklif sıfırlanır.
  useEffect(() => {
    setOffer(0);
  }, [deal?.dealId, deal?.activeLineId]);

  // Gün akışı: aktif pazarlık yokken saat ilerler (store.tick bunu denetler).
  useEffect(() => {
    const id = window.setInterval(() => useGame.getState().tick(0.5), 500);
    return () => window.clearInterval(id);
  }, []);

  const stage: WorkbenchStage = deal?.stage ?? 'inspect';

  return (
    <>
      <StatusStrip
        store={s.store}
        market={s.market}
        speed={s.speed}
        speed4xUnlocked={s.speed4xUnlocked}
        onSpeed={s.setSpeed}
        onUnlock4x={s.unlock4x}
      />

      <MarketStrip market={s.market} onOpenMarket={() => s.setTab('business')} />

      <CustomerStrip
        customer={s.activeCustomer}
        queueLength={s.queue.length}
        lineCount={deal?.lines.length ?? 0}
      />

      {deal && (
        <StageStrip
          flow={deal.flow}
          current={stage}
          canEnter={(target) => canEnterStage(useGame.getState(), target)}
          onSelect={s.setStage}
        />
      )}

      <main className="workbench">
        <div className="wb">
          {/* Çoklu ürün kalem şeridi — dikey scroll yerine yatay pill (GDD 23.13) */}
          {deal && deal.lines.length > 1 && (
            <div className="lineStrip" role="tablist" aria-label="Müşterinin ürünleri">
              {deal.lines.map((l, i) => (
                <button
                  key={l.lineId}
                  type="button"
                  role="tab"
                  aria-selected={l.lineId === deal.activeLineId}
                  className={`linePill ${l.lineId === deal.activeLineId ? 'linePill--active' : ''}`}
                  onClick={() => s.setActiveLine(l.lineId)}
                >
                  <span className={`linePill__dot linePill__dot--${l.status}`} />
                  Ürün {i + 1}
                </button>
              ))}
            </div>
          )}

          {!deal || !line ? (
            <IdleWorkbench />
          ) : /* --- Müşteri alış akışı (GDD 23.23) --- */
          deal.flow === 'purchase' && deal.purchase ? (
            stage === 'package' ? (
              <PackageStage purchase={deal.purchase} items={s.items} />
            ) : stage === 'negotiate' ? (
              <NegotiateStage
                session={line.negotiation}
                message={s.customerMessage}
                selectedThesis={null}
                thesisOptions={[]}
                band={null}
                verifiedFields={0}
                totalFields={0}
                liquidityAfter={salePreview(
                  s,
                  line.negotiation.finalOffer ?? offer,
                  deal.purchase.packageCost,
                )}
              />
            ) : stage === 'result' && s.lastReview ? (
              <ResultStage review={s.lastReview} accepted={line.negotiation.state === 'ACCEPTED'} />
            ) : (
              <StockPickStage
                purchase={deal.purchase}
                rows={offerableStock(deal.purchase.demand, s.inventory, s.items)}
                onToggle={s.togglePackageItem}
                onQuantity={s.setPackageQuantity}
              />
            )
          ) : !item ? (
            <IdleWorkbench />
          ) : /* --- Servis Kabul akışı (GDD 23.14) --- */
          deal.flow === 'service' && deal.service ? (
            stage === 'diagnose' ? (
              <DiagnoseStage item={item} service={deal.service} />
            ) : stage === 'quote' ? (
              <QuoteStage
                item={item}
                market={s.market}
                service={deal.service}
                onSelectVenue={s.selectServiceVenue}
              />
            ) : stage === 'promise' ? (
              <PromiseStage
                service={deal.service}
                today={s.market.day}
                onSetBuffer={s.setPromiseBuffer}
              />
            ) : (
              <JobQueueStage
                service={deal.service}
                job={s.jobs.find((j) => j.jobId === deal.service?.createdJobId)}
              />
            )
          ) : stage === 'inspect' ? (
            <InspectStage
              item={item}
              knowledge={line.knowledge}
              testResults={line.testResults}
              market={s.market}
            />
          ) : stage === 'appraise' && line.band ? (
            <AppraiseStage band={line.band} />
          ) : stage === 'thesis' ? (
            <ThesisStage
              options={line.thesisOptions}
              selected={line.selectedThesis}
              suggested={suggestedChannel(line.thesisOptions)}
              onSelect={s.selectThesis}
            />
          ) : stage === 'negotiate' ? (
            <NegotiateStage
              session={line.negotiation}
              message={s.customerMessage}
              selectedThesis={line.selectedThesis}
              thesisOptions={line.thesisOptions}
              band={line.band}
              verifiedFields={line.knowledge.filter((k) => k.status === 'verified').length}
              totalFields={line.knowledge.length}
              liquidityAfter={liquidityPreview(s, line.negotiation.finalOffer ?? offer)}
              reference={buildReference(item, s.market, line.negotiation.finalOffer ?? offer)}
            />
          ) : stage === 'result' && s.lastReview ? (
            <ResultStage
              review={s.lastReview}
              accepted={line.negotiation.state === 'ACCEPTED'}
            />
          ) : null}
        </div>
      </main>

      <ContextualToolRail liquidity={liquidity} />

      <ShopDock offer={offer} setOffer={setOffer} bounds={offerBounds} liquidity={liquidity} />
    </>
  );
}

// ---------------------------------------------------------------------------
// IDLE — müşteri yok (GDD 23.10.1)
// ---------------------------------------------------------------------------

/**
 * GDD 23.10.1: "İşlem Masası, günün tek kritik bağlamını gösterir: aktif event,
 * yaklaşan servis teslimi veya düşük likidite gibi. EN FAZLA 3 kompakt uyarı
 * satırı bulunur; ayrı büyük kartlar kullanılmaz."
 */
function IdleWorkbench() {
  const s = useGame();
  const liquidity = selectors.liquidity(s);
  const band = selectors.liquidityBand(s);

  const alerts: { key: string; title: string; detail: string; tone: string; Icon: typeof IconWarning }[] =
    [];

  if (s.market.activeEvent) {
    alerts.push({
      key: 'event',
      title: s.market.activeEvent.label,
      detail: s.market.activeEvent.description,
      tone: 'warning',
      Icon: IconWarning,
    });
  }

  if (band === 'red' || band === 'caution') {
    alerts.push({
      key: 'liquidity',
      title: `${TERM.liquidity} ${pct(liquidity)}`,
      detail:
        band === 'red'
          ? 'Büyük alış öncesi hızlı likidasyon gerekebilir.'
          : 'İşlem yapılabilir ama tedarik ve büyük müşteri riski yükseliyor.',
      tone: band === 'red' ? 'negative' : 'warning',
      Icon: IconLiquidity,
    });
  }

  const nextIn = Math.max(0, Math.round(s.nextCustomerAtMinutes - s.market.clockMinutes));
  if (alerts.length < 3) {
    alerts.push({
      key: 'schedule',
      title:
        s.queue.length > 0
          ? `${s.queue.length} müşteri bekliyor`
          : `Sonraki müşteri ~${nextIn} dk`,
      detail: `Dükkan ${clock(DAY.closeMinutes)}'da kapanıyor.`,
      tone: 'positive',
      Icon: IconClock,
    });
  }

  return (
    <div className="idle">
      <h2 className="idle__title">{s.store.name}</h2>
      <p className="idle__sub">Gün {s.market.day} · Semt itibarı {Math.round(s.store.reputation)}</p>

      <div className="alerts">
        {alerts.slice(0, 3).map(({ key, title, detail, tone, Icon }) => (
          <div key={key} className={`alert alert--${tone}`}>
            <span className="alert__icon">
              <Icon size={16} />
            </span>
            <span className="alert__body">
              <span className="alert__title">{title}</span>
              <span className="alert__detail"> · {detail}</span>
            </span>
          </div>
        ))}
      </div>

      {/*
       * GDD 23.10.1 — "Müşteri yokken Karar Dock'unda ana akışı bozmayan
       * ikincil 'Dükkânı Canlandır' rewarded CTA'sı gösterilebilir."
       * Ayrı banner veya büyük reklam kartı kullanılmaz.
       */}
      {s.queue.length === 0 && (
        <button type="button" className="rewardedLine" onClick={s.triggerCustomerRush}>
          <IconVideo size={13} />
          Dükkânı Canlandır
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bağlamsal Araç Rayı — aşamaya göre içerik (GDD 23.11)
// ---------------------------------------------------------------------------

function ContextualToolRail({ liquidity }: { liquidity: number }) {
  const s = useGame();
  const deal = s.activeDeal;
  const line = deal ? activeLine(deal) : undefined;

  if (!deal || !line) {
    return <ToolRail items={[]} emptyLabel="Müşteri karşılandığında araçlar burada" />;
  }

  const railItem = s.items[line.itemId];

  // --- Müşteri alış akışı (GDD 23.23) ---
  // Ray aynı fiziksel konumda kalır. Alış akışında test aracı YOKTUR: ürün
  // oyuncunun kendi stoğudur, ölçülecek gizli gerçek yok. Rayın işi paketi
  // yönetmektir.
  if (deal.flow === 'purchase' && deal.purchase) {
    const purchase = deal.purchase;
    const locked = line.negotiation.offerHistory.length > 0;

    // Pazarlıkta ray fiyat dışı hamleleri taşır. "Gerekçe" burada YOKTUR:
    // GDD 11.5 gerekçeyi doğrulanmış test verisine bağlar, alış akışında ise
    // test yapılmaz. Elde olmayan bir kanıta dayanan buton koymak, kuralı
    // ekranda varmış gibi göstermek olurdu.
    if (deal.stage === 'negotiate') {
      const session = line.negotiation;
      const terminal = isTerminal(session.state);
      return (
        <ToolRail
          disabled={terminal}
          items={[
            {
              id: 'gesture',
              label: 'Jest',
              icon: <IconGesture size={19} />,
              used: session.gesturesUsed >= NEGOTIATION.maxEffectiveGestures,
              onPress: () => s.negotiationMove({ kind: 'gesture', atRound: session.round }),
            },
            {
              id: 'counter',
              label: 'Karşı Teklif',
              icon: <IconCounter size={19} />,
              onPress: () => s.negotiationMove({ kind: 'requestCounter', atRound: session.round }),
            },
          ]}
        />
      );
    }

    if (deal.stage === 'result') {
      return <ToolRail items={[]} disabled emptyLabel="İşlem kapandı" />;
    }

    return (
      <ToolRail
        items={[
          {
            id: 'clearPackage',
            label: 'Paketi boşalt',
            icon: <IconReject size={19} />,
            onPress: s.clearPackage,
            disabled: purchase.lines.length === 0 || locked,
          },
          {
            id: 'toPackage',
            label: 'Pakete bak',
            icon: <IconPackage size={19} />,
            onPress: () => s.setStage('package'),
            selected: deal.stage === 'package',
            disabled: purchase.lines.length === 0,
          },
        ]}
      />
    );
  }

  // --- Servis Kabul akışı (GDD 23.14) ---
  // Ray aynı fiziksel konumda kalır; içeriği adıma göre değişir (GDD 23.11).
  if (deal.flow === 'service' && deal.service) {
    const service = deal.service;

    switch (deal.stage) {
      // "Tanıla | Servis test/inceleme araçları; Devam."
      // Servis müşterisinde ürünün sorunu beyandan bellidir; ray tanılamayı
      // derinleştiren lup ile sınırlıdır — ticaret testleri burada anlamsızdır.
      case 'diagnose': {
        const loupe = toolsForLevel(s.store.level).find((t) => t.tool.id === 'loupe');
        if (!loupe) return <ToolRail items={[]} emptyLabel="İnceleme aracı yok" />;
        return (
          <ToolRail
            items={[
              {
                id: loupe.tool.id,
                label: loupe.tool.shortLabel,
                icon: <IconLoupe size={19} />,
                onPress: () => s.runTest(loupe.tool.id),
                used: line.testResults.some((r) => r.toolId === loupe.tool.id),
                locked: loupe.locked,
                lockReason: loupe.lockReason,
                onLockedPress: () =>
                  s.notify(`${loupe.tool.name}: ${loupe.lockReason}`, 'info'),
              },
            ]}
          />
        );
      }

      // "Teklif | Servis türleri; fiyat ve teslim tarihi."
      case 'quote': {
        const typeIds = service.diagnosis?.availableTypeIds ?? [];
        const items: RailItem[] = typeIds.map((typeId) => {
          const type = getServiceType(typeId);
          return {
            id: typeId,
            label: type.shortLabel,
            icon: <IconWorkshop size={19} />,
            onPress: () => s.selectServiceType(typeId),
            selected: service.selectedTypeId === typeId,
          };
        });
        return <ToolRail items={items} emptyLabel="Uygulanabilir servis yok" />;
      }

      // "Söz | İşi Kabul Et / Reddet." — bu iki aksiyon Dock'ta yaşar.
      case 'promise':
        return <ToolRail items={[]} disabled emptyLabel="Teslim sözünü Karar Dock'unda ver" />;

      // "Kuyruk | Atölyeye Gönder; sonuç Atölye ekranında takip edilir."
      default:
        return <ToolRail items={[]} disabled emptyLabel="İş emri oluşturuldu" />;
    }
  }

  switch (deal.stage) {
    // İncele → test araçları. İlk 4 görünür; fazlası yatay scroll.
    case 'inspect': {
      // İşlem Akışı Ara Düzeltmesi §3 — "Bir test ürün hakkında ANLAMLI YENİ
      // BİLGİ ÜRETMİYORSA varsayılan akışta gösterilmemeli." Gram altına taş
      // kontrolü, çeyreğe ölçü aracı bu filtreyle rayda hiç belirmez.
      const items: RailItem[] = toolsForLevel(s.store.level)
        .filter(({ tool }) => !railItem || isToolRelevant(railItem, tool))
        .map(({ tool, locked, lockReason }) => {
        const Icon = TOOL_ICON[tool.id] ?? IconScale;
        const used = line.testResults.some((r) => r.toolId === tool.id);
        return {
          id: tool.id,
          label: tool.shortLabel,
          icon: <Icon size={19} />,
          onPress: () => s.runTest(tool.id),
          used,
          locked,
          lockReason,
          // GDD 23.11 — "Locked araç görünüyorsa kilit nedeni kısa metinle
          // açıklanır." Dokunmatikte tooltip yoktur; nedeni toast ile söyle.
          onLockedPress: () => s.notify(`${tool.name}: ${lockReason}`, 'info'),
          disabled: tool.cost > s.store.cash,
          badge: tool.cost > 0 ? `${tool.cost}₺` : undefined,
          };
        });
      return <ToolRail items={items} />;
    }

    // Değerle → maksimum 3 eylem; ana veri zaten Workbench'te.
    case 'appraise': {
      const items: RailItem[] = [
        {
          id: 'more-test',
          label: 'Ek Test',
          icon: <IconTouchstone size={19} />,
          onPress: () => s.setStage('inspect'),
        },
        {
          id: 'market',
          label: 'Piyasa',
          icon: <IconLiquidity size={19} />,
          onPress: () => s.setTab('business'),
        },
        {
          id: 'thesis',
          label: TERM.thesisShort,
          icon: <IconPackage size={19} />,
          onPress: () => s.setStage('thesis'),
        },
      ];
      return <ToolRail items={items} />;
    }

    // Tez → yalnız ürün için rasyonel kanallar (domain filtreler).
    case 'thesis': {
      const items: RailItem[] = line.thesisOptions.map((option) => {
        const ChannelIcon = CHANNEL_RAIL_ICON[option.channel];
        return {
          id: option.channel,
          label: CHANNEL_RAIL_LABEL[option.channel],
          icon: <ChannelIcon size={19} />,
          onPress: () => s.selectThesis(option.channel),
          selected: line.selectedThesis === option.channel,
        };
      });
      return <ToolRail items={items} />;
    }

    // Pazarlık → maks 3 görünür; "Reddet" rayda DEĞİL, Dock'ta (GDD 23.11).
    case 'negotiate': {
      const session = line.negotiation;
      const terminal = isTerminal(session.state);

      // Gerekçe yalnız DOĞRULANMIŞ veriye dayanabilir (GDD 11.5).
      const evidence = findEvidence(line.knowledge, line.testResults);

      const items: RailItem[] = [
        {
          id: 'reason',
          label: 'Gerekçe',
          icon: <IconReason size={19} />,
          disabled: !evidence,
          used: evidence ? session.usedReasons.includes(`${evidence.field}:${evidence.toolId}`) : false,
          lockReason: 'Önce ilgili testi yapın',
          onPress: () =>
            evidence &&
            s.negotiationMove({
              kind: 'reason',
              reasonEvidence: evidence,
              atRound: session.round,
            }),
        },
        {
          id: 'gesture',
          label: 'Jest',
          icon: <IconGesture size={19} />,
          used: session.gesturesUsed >= NEGOTIATION.maxEffectiveGestures,
          onPress: () => s.negotiationMove({ kind: 'gesture', atRound: session.round }),
        },
        {
          id: 'counter',
          label: 'Karşı Teklif',
          icon: <IconCounter size={19} />,
          onPress: () => s.negotiationMove({ kind: 'requestCounter', atRound: session.round }),
        },
      ];

      // Paket teklif yalnız en az 2 kalem yeterince değerlenmişse (GDD 23.13).
      const appraisedLines = deal.lines.filter((l) => l.band !== null).length;
      if (deal.lines.length > 1 && appraisedLines >= 2) {
        items.push({
          id: 'package',
          label: 'Paket',
          icon: <IconPackage size={19} />,
          onPress: () => s.negotiationMove({ kind: 'package', atRound: session.round }),
        });
      }

      return <ToolRail items={items} disabled={terminal} />;
    }

    // Sonuç → ray gizli/disabled (GDD 23.10.2).
    case 'result':
      return <ToolRail items={[]} disabled emptyLabel="İşlem tamamlandı" />;
  }

  void liquidity;
  return <ToolRail items={[]} />;
}

const CHANNEL_RAIL_ICON: Record<ExitChannel, typeof IconRetail> = {
  retail: IconRetail,
  wholesale: IconWholesale,
  melt: IconMelt,
  serviceResale: IconServiceResale,
  collection: IconCollection,
};

const CHANNEL_RAIL_LABEL: Record<ExitChannel, string> = {
  retail: 'Vitrin',
  wholesale: 'Toptan',
  melt: 'Erit',
  serviceResale: 'Servis',
  collection: 'Beklet',
};

/**
 * Pazarlıkta kullanılabilecek gerekçe kanıtı.
 * GDD 11.5 — yalnız gerçekten yapılmış ve yeterince kesinleşmiş test sayılır.
 */
function findEvidence(
  knowledge: { field: InfoField; certainty: number; testsApplied: string[] }[],
  results: { toolId: string; readout: string }[],
): { field: InfoField; toolId: string; claim: string } | null {
  for (const k of knowledge) {
    if (k.certainty < 0.6) continue;
    const toolId = k.testsApplied[k.testsApplied.length - 1];
    if (!toolId) continue;
    const result = results.find((r) => r.toolId === toolId);
    if (!result) continue;
    return { field: k.field, toolId, claim: result.readout };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Karar Dock'u — aşamaya göre etiket ve özet (GDD 23.12)
// ---------------------------------------------------------------------------

function ShopDock({
  offer,
  setOffer,
  bounds,
  liquidity,
}: {
  offer: Money;
  setOffer: (v: Money) => void;
  bounds: { min: Money; max: Money; step: Money };
  liquidity: number;
}) {
  const s = useGame();
  const deal = s.activeDeal;
  const line = deal ? activeLine(deal) : undefined;

  // --- IDLE ---
  if (!deal || !line) {
    const hasQueue = s.queue.length > 0;
    return (
      <DecisionDock
        summaryLabel="Kuyruk"
        summaryValue={hasQueue ? `${s.queue.length} müşteri bekliyor` : 'Müşteri bekleniyor'}
        primary={{
          label: hasQueue ? 'Müşteriyi Karşıla' : 'Müşteri bekleniyor',
          onPress: s.greetCustomer,
          disabled: !hasQueue,
        }}
        secondary={[{ label: 'Günü Bitir', onPress: s.advanceDay }]}
      />
    );
  }

  // --- Servis Kabul akışı Dock'u (GDD 23.14) ---
  if (deal.flow === 'service' && deal.service) {
    return <ServiceDock deal={deal} />;
  }

  // --- Müşteri alış akışı Dock'u (GDD 23.23) ---
  if (deal.flow === 'purchase' && deal.purchase) {
    return (
      <PurchaseDock
        deal={deal}
        line={line}
        offer={offer}
        setOffer={setOffer}
        liquidity={liquidity}
      />
    );
  }

  const ceiling = effectiveCeiling(line.thesisOptions, line.selectedThesis);

  // İşlem Akışı §2 — akış politikası ürünün kendisinden türer.
  const dockItem = s.items[line.itemId];
  const policy = dockItem ? flowPolicy(dockItem) : null;

  switch (deal.stage) {
    // --- İNCELE: doğrulanan alan sayısı + risk ---
    case 'inspect': {
      const verified = line.knowledge.filter((k) => k.status === 'verified').length;
      const conflicting = line.knowledge.some((k) => k.status === 'conflicting');

      // İşlem Akışı §2/§4 — hızlı işlemde birincil eylem doğrudan fiyattır.
      // "Değerlemeye Geç" düğmesini zorunlu adım gibi bırakmak, kaldırılan
      // test zincirini arayüzde diriltmek olurdu.
      const fast = policy?.transactionClass === 'fast';

      return (
        <DecisionDock
          summaryLabel={policy ? CLASS_LABEL[policy.transactionClass] : 'Doğrulanan alan'}
          summaryValue={
            <>
              {verified}/{line.knowledge.length} alan
              {policy && <span style={{ color: 'var(--muted)' }}> · {policy.note}</span>}
              {conflicting && (
                <span style={{ color: 'var(--negative)' }}> · çelişkili sinyal</span>
              )}
            </>
          }
          primary={
            fast
              ? { label: 'Fiyata Geç', onPress: () => s.setStage('negotiate') }
              : { label: 'Değerlemeye Geç', onPress: () => s.setStage('appraise') }
          }
          secondary={
            fast
              ? [{ label: 'Yine de değerle', onPress: () => s.setStage('appraise') }]
              : line.testResults.length === 0
                ? [{ label: 'Test yapmadan ilerle', onPress: () => s.setStage('appraise') }]
                : []
          }
        />
      );
    }

    // --- DEĞERLE: değer bandı + güven ---
    case 'appraise': {
      const band = line.band;
      // GDD 23.10.2 — basit üründe Tez atlanabilir; riskli üründe görünür olmalı.
      const skipThesis = line.thesisOptions.length < 2;

      return (
        <DecisionDock
          summaryLabel="Değer bandı"
          summaryValue={band ? `${tl(band.min)} – ${tl(band.max)}` : '—'}
          primary={{
            label: skipThesis ? 'Pazarlığa Geç' : `${TERM.thesis} Seç`,
            onPress: () => s.setStage(skipThesis ? 'negotiate' : 'thesis'),
          }}
          secondary={[{ label: 'Ek test', onPress: () => s.setStage('inspect') }]}
        />
      );
    }

    // --- TEZ: seçili kanalın net/süre/likidite özeti ---
    case 'thesis': {
      const selected = line.selectedThesis
        ? line.thesisOptions.find((o) => o.channel === line.selectedThesis)
        : null;

      return (
        <DecisionDock
          summaryLabel={selected ? `Seçili ${TERM.thesis.toLocaleLowerCase('tr')}` : `${TERM.thesis} seçilmedi`}
          summaryValue={
            selected
              ? `${selected.label} · net ${tl(selected.expectedNet)}`
              : 'Öneri ile devam edilecek'
          }
          primary={{ label: 'Pazarlığa Geç', onPress: () => s.setStage('negotiate') }}
        />
      );
    }

    // --- PAZARLIK: teklif + tahmini kâr/likidite/ilişki ---
    case 'negotiate': {
      const session = line.negotiation;
      const isFinal = session.state === 'FINAL_OFFER';
      const counter = session.finalOffer ?? session.activeCounter;

      const liquidityAfter = liquidityRatio(
        Math.max(0, s.store.cash - offer),
        [...s.inventory, { costBasis: offer } as never],
      );

      // GDD 23.12 — tahmini sonuçlar kesinlik iddiası taşımaz.
      const estimatedMargin = ceiling - offer;
      const impacts: OfferImpact[] = [
        {
          label: 'Tahmini',
          value: `${tlSigned(estimatedMargin)} ${tonWord(estimatedMargin)}`,
          tone: estimatedMargin >= 0 ? 'positive' : 'negative',
        },
        liquidityImpact(liquidity, liquidityAfter),
        {
          label: 'İlişki',
          value: relationLabel(offer, ceiling),
          tone: offer < ceiling * 0.75 ? 'warning' : 'neutral',
        },
      ];

      const canAfford = offer <= s.store.cash;

      return (
        <DecisionDock
          summaryLabel={isFinal ? 'Son teklif' : 'Teklifiniz'}
          summaryValue={
            isFinal && counter !== null
              ? `Müşteri: ${tl(counter)} — geri dönüş yok`
              : `Alış tavanı ${tl(ceiling)}`
          }
          primary={
            isFinal && counter !== null
              ? {
                  label: 'Kabul Et',
                  onPress: () => s.negotiationMove({ kind: 'acceptCounter', atRound: session.round }),
                  disabled: counter > s.store.cash,
                  icon: <IconSend size={18} />,
                }
              : {
                  label: 'Teklifi Gönder',
                  onPress: () => s.submitOffer(offer),
                  disabled: !canAfford || offer <= 0,
                  icon: <IconSend size={18} />,
                }
          }
          secondary={[
            {
              label: 'Reddet',
              onPress: () => s.negotiationMove({ kind: 'reject', atRound: session.round }),
              danger: true,
              icon: <IconReject size={16} />,
            },
          ]}
        >
          {!isFinal && (
            <OfferControl
              value={offer}
              min={bounds.min}
              max={bounds.max}
              step={bounds.step}
              onChange={setOffer}
              impacts={impacts}
              disabled={isTerminal(session.state)}
            />
          )}
        </DecisionDock>
      );
    }

    // --- SONUÇ: "Devam Et"; uzun rapor İşlem Defteri'ne gider (GDD 23.10.2) ---
    case 'result': {
      const accepted = line.negotiation.state === 'ACCEPTED';
      const price = line.negotiation.settledPrice ?? 0;

      return (
        <DecisionDock
          summaryLabel={accepted ? 'Kapanış' : 'Sonuç'}
          summaryValue={accepted ? tl(price) : 'İşlem yapılmadı'}
          primary={{ label: 'Devam Et', onPress: s.finishDeal }}
        />
      );
    }
  }
}

/**
 * Servis Kabul akışının Karar Dock'u (GDD 23.14 "Araç Rayı / Dock" sütunu).
 *
 * Ana CTA her adımda AYNI fiziksel bölgede kalır; yalnız etiketi ve üstündeki
 * karar özeti değişir (GDD 23.12). Servis müşterisi teklif slider'ına
 * zorlanmaz — ücret tekliften gelir, karar süre/risk/söz üzerinedir.
 */
/**
 * MÜŞTERİ ALIŞ AKIŞI DOCK'U (GDD 23.23)
 *
 * GDD 6.6 — müşterinin ödeme tavanı hiçbir aşamada sayı olarak gösterilmez.
 * Dock'ta görünen tek referans oyuncunun KENDİ maliyeti ve kanal önerisidir;
 * müşterinin nereye kadar çıkacağı pazarlıkta öğrenilir.
 */
function PurchaseDock({
  deal,
  line,
  offer,
  setOffer,
  liquidity,
}: {
  deal: NonNullable<GameStateDeal>;
  line: DealLine;
  offer: Money;
  setOffer: (v: Money) => void;
  liquidity: number;
}) {
  const s = useGame();
  const purchase = deal.purchase;
  if (!purchase) return null;

  switch (deal.stage) {
    // --- STOK SEÇİMİ ---
    case 'stockPick': {
      const count = purchase.units;
      return (
        <DecisionDock
          summaryLabel="Pakette"
          summaryValue={
            count === 0
              ? 'Henüz ürün seçilmedi'
              : `${count} adet · ${tl(purchase.packageFairValue)} adil değer`
          }
          primary={{
            label: 'Paketi Değerle',
            onPress: () => s.setStage('package'),
            disabled: count === 0,
          }}
          secondary={[{ label: 'Müşteriyi Gönder', onPress: s.finishDeal, danger: true }]}
        />
      );
    }

    // --- DEĞER / PAKET ---
    case 'package': {
      // §4.1 — kısmi karşılamayı kabul etmeyen müşteriye eksik paket sunulmaz.
      const ready = purchase.fulfilment !== 'none';
      return (
        <DecisionDock
          summaryLabel="Kanal önerisi"
          summaryValue={
            <>
              {tl(purchase.suggestedPrice)}
              <span style={{ color: 'var(--muted)' }}>
                {' '}· maliyet {tl(purchase.packageCost)}
              </span>
            </>
          }
          primary={{
            label: 'Pazarlığa Geç',
            onPress: () => {
              setOffer(purchase.suggestedPrice);
              s.setStage('negotiate');
            },
            disabled: !ready,
          }}
          secondary={[
            { label: 'Paketi Düzenle', onPress: () => s.setStage('stockPick') },
            { label: 'Müşteriyi Gönder', onPress: s.finishDeal, danger: true },
          ]}
        />
      );
    }

    // --- PAZARLIK ---
    case 'negotiate': {
      const session = line.negotiation;
      const isFinal = session.state === 'FINAL_OFFER';
      const counter = session.finalOffer ?? session.activeCounter;

      // Satışta kâr HEMEN gerçekleşir (GDD 34.5): satış fiyatı eksi maliyet.
      const profit = offer - purchase.packageCost;
      const impacts: OfferImpact[] = [
        {
          label: 'Kâr',
          value: `${tlSigned(profit)} ${tonWord(profit)}`,
          tone: profit >= 0 ? 'positive' : 'negative',
        },
        liquidityImpact(liquidity, liquidity),
        {
          label: 'İlişki',
          value: saleRelationLabel(offer, purchase.packageFairValue),
          tone: offer > purchase.packageFairValue * 1.25 ? 'warning' : 'neutral',
        },
      ];

      const bounds = purchaseBounds(purchase);

      return (
        <DecisionDock
          summaryLabel={isFinal ? 'Son teklif' : 'İstediğiniz fiyat'}
          summaryValue={
            isFinal && counter !== null
              ? `Müşteri: ${tl(counter)} — geri dönüş yok`
              : `Adil değer ${tl(purchase.packageFairValue)}`
          }
          primary={{
            label: isFinal ? 'Son Teklifi Kabul Et' : 'Fiyatı Ver',
            onPress: () =>
              isFinal && counter !== null
                ? s.negotiationMove({ kind: 'acceptCounter', atRound: session.round })
                : s.submitOffer(offer),
            disabled: isTerminal(session.state) || offer <= 0,
            icon: <IconSend size={18} />,
          }}
          secondary={[
            {
              label: 'Vazgeç',
              onPress: () => s.negotiationMove({ kind: 'reject', atRound: session.round }),
              danger: true,
              icon: <IconReject size={16} />,
            },
          ]}
        >
          {!isFinal && (
            <OfferControl
              value={offer}
              onChange={setOffer}
              min={bounds.min}
              max={bounds.max}
              step={bounds.step}
              impacts={impacts}
              disabled={isTerminal(session.state)}
            />
          )}
        </DecisionDock>
      );
    }

    // --- SONUÇ ---
    default:
      return (
        <DecisionDock
          summaryLabel="Sonuç"
          summaryValue={
            line.negotiation.state === 'ACCEPTED'
              ? `Satıldı · ${tl(line.negotiation.settledPrice ?? 0)}`
              : 'Satış olmadı'
          }
          primary={{ label: 'Sonraki Müşteri', onPress: s.finishDeal }}
        />
      );
  }
}

/**
 * Satış slider'ının aralığı: maliyetin altından adil değerin belirgin
 * üstüne. Oyuncu zararına da satabilir — sistem "şu fiyattan sat" demez
 * (GDD 6.6), yalnız sonucunu gösterir.
 */
function purchaseBounds(purchase: NonNullable<GameStateDeal>['purchase']) {
  const fair = purchase?.packageFairValue ?? 0;
  const cost = purchase?.packageCost ?? 0;
  const min = Math.max(0, Math.round(Math.min(cost, fair) * 0.6));
  const max = Math.max(min + 1000, Math.round(fair * 1.6));
  const span = max - min;
  return { min, max, step: span > 200_000 ? 500 : span > 40_000 ? 100 : 50 };
}

/** Satışta ilişki etiketi: fiyat adil değerin ne kadar üstünde (GDD 23.12). */
function saleRelationLabel(price: Money, fair: Money): string {
  if (fair <= 0) return 'nötr';
  const ratio = price / fair;
  if (ratio <= 1.08) return 'olumlu';
  if (ratio <= 1.28) return 'nötr';
  return 'riskli';
}

function ServiceDock({ deal }: { deal: NonNullable<GameStateDeal> }) {
  const s = useGame();
  const service = deal.service;
  if (!service) return null;

  const quote = findQuote(service.quotes, service.selectedTypeId, service.selectedVenue);

  switch (deal.stage) {
    // --- TANILA: sorun + ulaşılabilir kondisyon ---
    case 'diagnose': {
      const count = service.diagnosis?.availableTypeIds.length ?? 0;
      return (
        <DecisionDock
          summaryLabel="Tanı"
          summaryValue={
            count > 0 ? `${count} servis türü uygulanabilir` : 'Uygun servis bulunamadı'
          }
          primary={{
            label: 'Teklif Hazırla',
            onPress: () => s.setStage('quote'),
            disabled: count === 0,
          }}
          secondary={[{ label: 'İşi Reddet', onPress: s.declineServiceJob, danger: true }]}
        />
      );
    }

    // --- TEKLİF: seçili türün ücreti + süresi + riski ---
    case 'quote':
      return (
        <DecisionDock
          summaryLabel={quote ? 'Seçili teklif' : 'Servis türü seçilmedi'}
          summaryValue={
            quote
              ? `${tl(quote.fee)} · ${quote.durationDays} gün · risk ${pct(quote.risk)}`
              : 'Raydan bir tür seçin'
          }
          primary={{
            label: 'Teslim Sözü Ver',
            onPress: () => s.setStage('promise'),
            disabled: !quote || quote.blockedReason !== null,
          }}
          secondary={[{ label: 'İşi Reddet', onPress: s.declineServiceJob, danger: true }]}
        />
      );

    // --- SÖZ: "İşi Kabul Et / Reddet" (GDD 23.14) ---
    case 'promise': {
      if (!quote) return null;
      const promised = expectedCompletionDay(quote, s.market.day) + service.promiseBufferDays;
      const affordable = quote.partsCost <= s.store.cash;

      return (
        <DecisionDock
          summaryLabel="Kabul"
          summaryValue={
            <>
              {promised}. gün teslim · {tl(quote.fee)} ücret
              {quote.partsCost > 0 && (
                <span style={{ color: 'var(--negative)' }}>
                  {' '}· bugün {tl(quote.partsCost)} parça
                </span>
              )}
            </>
          }
          primary={{
            label: 'İşi Kabul Et',
            onPress: s.acceptServiceJob,
            disabled: !affordable,
            icon: <IconWorkshop size={18} />,
          }}
          secondary={[{ label: 'Reddet', onPress: s.declineServiceJob, danger: true }]}
        />
      );
    }

    // --- KUYRUK: "Atölyeye Gönder" ---
    default: {
      const accepted = service.outcome === 'accepted';
      return (
        <DecisionDock
          summaryLabel={accepted ? 'İş emri' : 'Sonuç'}
          summaryValue={accepted ? 'Atölye kuyruğuna eklendi' : 'İş kabul edilmedi'}
          primary={{ label: 'Devam Et', onPress: s.finishDeal }}
          secondary={
            accepted
              ? [
                  {
                    label: 'Atölyeyi Aç',
                    // İşlemi kapat, sonra sekmeyi değiştir: aksi hâlde oyuncu
                    // Dükkan'a döndüğünde kapanmış bir iş emrinde kalırdı.
                    onPress: () => {
                      s.finishDeal();
                      s.setTab('workshop');
                    },
                  },
                ]
              : []
          }
        />
      );
    }
  }
}

type GameStateDeal = ReturnType<typeof useGame.getState>['activeDeal'];

/**
 * §2 — teklif ekranının piyasa referansı.
 *
 * Yalnız SARRAFİYEDE gösterilir: işçilikli üründe "tipik alış fiyatı" diye
 * bir şey yoktur, değer işçilik ve taşla birlikte değişir. Orada referans
 * uydurmak, olmayan bir kesinlik göstermek olurdu.
 */
function buildReference(item: ItemInstance | undefined, market: MarketState, offer: Money) {
  if (!item || !isBullion(item.templateId)) return null;

  const base = bullionUnitValue(item, market);
  const pieceReference = marketReferenceBuy(item, market, base, 1);
  const view = unitPriceView(item, pieceReference);
  const offerView = unitPriceView(item, offer);

  return {
    unitReference: view.unitPrice,
    unitOffer: offerView.unitPrice,
    unit: view.unit,
    quantity: 1,
    totalReference: pieceReference,
    totalOffer: offer,
  };
}

/** Kabul edilirse likidite nereye düşer — "%19 → %12" (GDD 23.12). */
function liquidityPreview(s: ReturnType<typeof useGame.getState>, price: Money): string {
  const before = liquidityRatio(s.store.cash, s.inventory);
  const after = liquidityRatio(
    Math.max(0, s.store.cash - price),
    [...s.inventory, { costBasis: price } as never],
  );
  return `${pct(before)} → ${pct(after)}`;
}

/**
 * Satış tarafında likidite TERS yönde hareket eder: mal çıkar, nakit girer.
 * Alış önizlemesini yeniden kullanmak "%19 → %12" gibi yanlış bir yön
 * gösterirdi — oyuncu kararını bu sayıya bakarak veriyor.
 */
function salePreview(
  s: ReturnType<typeof useGame.getState>,
  price: Money,
  costBasis: Money,
): string {
  const before = liquidityRatio(s.store.cash, s.inventory);
  const after = liquidityRatio(s.store.cash + price, [
    { costBasis: -costBasis } as never,
    ...s.inventory,
  ]);
  return `${pct(before)} → ${pct(after)}`;
}

/** İlişki etkisi etiketi — sayısal skor değil, okunabilir durum (GDD 23.12). */
function relationLabel(offer: Money, ceiling: Money): string {
  if (ceiling <= 0) return 'nötr';
  const ratio = offer / ceiling;
  if (ratio >= 0.95) return 'olumlu';
  if (ratio >= 0.8) return 'nötr';
  return 'riskli';
}
