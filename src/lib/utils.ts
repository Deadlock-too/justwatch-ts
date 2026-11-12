import type { JustWatchOffer, MonetizationType, PresentationType } from './types'

export { getSimilarity, getMatchScore, normalize } from '@deadlock-too/scrape-kit'

/** Where JustWatch serves its posters and icons. */
export const IMAGE_HOST = 'https://images.justwatch.com'

/** Where a title's page on JustWatch lives. */
export const SITE_HOST = 'https://www.justwatch.com'

/**
 * A poster's or an icon's address at a size. JustWatch hands out templates
 * such as `/poster/334284871/{profile}/name.{format}`; `profile` is a size
 * (`s100`, `s166`, `s332`, `s592`, `s718` for posters, `s100` for icons) and
 * `format` is `webp`, `jpg` or `png`.
 */
export function imageUrl(template: string, profile: string, format: 'webp' | 'jpg' | 'png' = 'webp'): string {
  return IMAGE_HOST + template.replace('{profile}', profile).replace('{format}', format)
}

const QUALITY: Record<string, number> = { '4K': 3, HD: 2, SD: 1 }

const quality = (type: PresentationType) => QUALITY[type] ?? 0

/** The order offers are told apart in: what is included before what is paid for. */
const MONETIZATION_ORDER: MonetizationType[] = ['FLATRATE', 'FREE', 'ADS', 'FAST', 'RENT', 'BUY', 'CINEMA']

const rank = (type: MonetizationType) => {
  const at = MONETIZATION_ORDER.indexOf(type)
  return at === -1 ? MONETIZATION_ORDER.length : at
}

/**
 * One offer per service and way of paying, the best quality kept, in the order
 * a person usually wants them: included in a subscription, free, with ads,
 * then rented and bought, cheapest first. JustWatch lists the same service
 * once per quality, so a title on Prime Video comes back three times.
 */
export function bestOffers(offers: JustWatchOffer[]): JustWatchOffer[] {
  const best = new Map<string, JustWatchOffer>()
  for (const offer of offers) {
    const key = `${offer.package.id}:${offer.monetizationType}`
    const kept = best.get(key)
    if (
      !kept ||
      quality(offer.presentationType) > quality(kept.presentationType) ||
      (quality(offer.presentationType) === quality(kept.presentationType) &&
        (offer.price ?? Infinity) < (kept.price ?? Infinity))
    ) {
      best.set(key, offer)
    }
  }
  return [...best.values()].sort(
    (a, b) => rank(a.monetizationType) - rank(b.monetizationType) || (a.price ?? 0) - (b.price ?? 0),
  )
}
