import { Result } from '@deadlock-too/scrape-kit'

/** What JustWatch calls a film and a series. */
export enum ObjectType {
  Movie = 'MOVIE',
  Show = 'SHOW',
}

/**
 * How an offer is paid for. JustWatch adds kinds from time to time, so any
 * other string is passed through untouched rather than dropped.
 */
export type MonetizationType = 'FLATRATE' | 'FREE' | 'ADS' | 'RENT' | 'BUY' | 'CINEMA' | 'FAST' | (string & {})

/** The quality of an offer. JustWatch's `_4K` is reported as `4K`. */
export type PresentationType = 'SD' | 'HD' | '4K' | 'CANVAS' | (string & {})

/** A streaming service, a store or a cinema. */
export type JustWatchPackage = {
  /** JustWatch's numeric id of the service. */
  id: number
  /** Its name as shown to people, e.g. `Netflix`. */
  name: string
  /** A stable machine name, e.g. `netflix`. */
  technicalName: string
  /** A three-letter code, e.g. `nfx`. */
  shortName: string
  /** The service's square icon as PNG, 100px wide; see {@link imageUrl} for other sizes. */
  iconUrl: string | null
  /** The icon's address template, with `{profile}` and `{format}` still in it. */
  iconTemplate: string | null
}

/** One way to watch a title on one service, at one quality. */
export type JustWatchOffer = {
  monetizationType: MonetizationType
  presentationType: PresentationType
  /** The service's own page for the title, the link to give a person. */
  url: string
  /** The address that opens the title in the service's app, when JustWatch has one. */
  deeplinkUrl: string | null
  /** The price as a number, for a rental or a purchase. */
  price: number | null
  /** The price as JustWatch formats it in the requested language, e.g. `3,99 €`. */
  priceText: string | null
  /** ISO 4217, e.g. `EUR`. */
  currency: string | null
  /** ISO 8601: when the title leaves the service, when JustWatch knows. */
  availableTo: string | null
  /** For a series, how many seasons the offer covers; 0 when JustWatch does not say. */
  elementCount: number
  package: JustWatchPackage
}

export type JustWatchTitle = {
  /** JustWatch's node id, e.g. `tm44313` for a film and `ts320458` for a series. */
  id: string
  /** The numeric half of {@link id}. */
  objectId: number
  objectType: ObjectType
  title: string
  originalTitle: string | null
  originalReleaseYear: number | null
  /** The title's page on justwatch.com. */
  url: string | null
  /** The poster at 332px as WebP; see {@link imageUrl} for other sizes. */
  posterUrl: string | null
  /** The poster's address template, with `{profile}` and `{format}` still in it. */
  posterTemplate: string | null
  /** The same title on TMDB and IMDb. A TMDB id is only unique together with the kind. */
  externalIds: { tmdbId: number | null; imdbId: string | null }
  /** Every offer in the requested country, as JustWatch lists them. See {@link bestOffers}. */
  offers: JustWatchOffer[]
  /** How closely the title matches the search key, 0 to 1; 1 for a title looked up by id. */
  similarity: number
}

/** Result of {@link JustWatchService.search}. */
export type SearchResult = Result<JustWatchTitle[]>

/** Result of {@link JustWatchService.searchOne}. */
export type SearchEntryResult = Result<JustWatchTitle | null>

/** Result of {@link JustWatchService.getTitle} and {@link JustWatchService.getTitleById}. */
export type TitleResult = Result<JustWatchTitle>

// ---------------------------------------------------------------------------
// Shapes of the raw JustWatch GraphQL responses, used by the parser.
// ---------------------------------------------------------------------------

export type GraphQLResponse<T> = {
  data?: T | null
  errors?: { message?: string; extensions?: { code?: string } }[]
}

export type RawPackage = {
  packageId: number
  clearName: string
  technicalName: string
  shortName: string
  icon: string | null
}

export type RawOffer = {
  monetizationType: string
  presentationType: string
  standardWebURL: string | null
  deeplinkURL: string | null
  retailPrice: string | null
  retailPriceValue: number | null
  currency: string | null
  availableToTime: string | null
  elementCount: number | null
  package: RawPackage | null
}

export type RawTitle = {
  id: string
  objectId: number
  objectType: string
  content: {
    title: string
    originalTitle: string | null
    originalReleaseYear: number | null
    fullPath: string | null
    posterUrl: string | null
    externalIds: { tmdbId: string | null; imdbId: string | null } | null
  } | null
  offers: RawOffer[] | null
}

export type RawSearchData = { popularTitles: { edges: { node: RawTitle }[] } | null }

export type RawNodeData = { node: RawTitle | null }
