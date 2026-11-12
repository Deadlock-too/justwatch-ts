export { JustWatchService } from './lib/service'
export type { JustWatchLocale, JustWatchOptions, JustWatchSearchOptions, JustWatchTitleOptions } from './lib/service'
export {
  ObjectType,
  type JustWatchOffer,
  type JustWatchPackage,
  type JustWatchTitle,
  type MonetizationType,
  type PresentationType,
  type SearchEntryResult,
  type SearchResult,
  type TitleResult,
} from './lib/types'
export { bestOffers, imageUrl, getSimilarity, getMatchScore } from './lib/utils'

export type { Result, Success, Failure, FailureKind } from '@deadlock-too/scrape-kit'
export type { ScraperOptions } from '@deadlock-too/scrape-kit'
export type { HttpClientOptions, FetchLike } from '@deadlock-too/scrape-kit'
export type { Logger } from '@deadlock-too/scrape-kit'
export { consoleLogger, silentLogger } from '@deadlock-too/scrape-kit'
export { ScraperError, HttpError } from '@deadlock-too/scrape-kit'
