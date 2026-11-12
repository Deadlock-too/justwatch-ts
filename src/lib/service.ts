import { parseNodeJsonResult, parseSearchCandidates, parseSearchJsonResult } from './parser'
import { NODE_QUERY, SEARCH_QUERY } from './queries'
import { JustWatchTitle, ObjectType, SearchEntryResult, SearchResult, TitleResult } from './types'
import {
  BaseScraperService,
  HttpError,
  ScraperOptions,
  fail,
  failFrom,
  ok,
  type Failure,
  type Result,
} from '@deadlock-too/scrape-kit'

/** Names the remote source in generated failure messages. */
const SUBJECT = 'JustWatch'

/** Where a title is looked for, and in which language its name and prices come back. */
export interface JustWatchLocale {
  /** ISO 3166-1 alpha-2, e.g. `IT`. Offers are always a country's. */
  country?: string
  /** ISO 639-1, e.g. `it`. */
  language?: string
}

export interface JustWatchOptions extends ScraperOptions, JustWatchLocale {}

export interface JustWatchSearchOptions extends JustWatchLocale {
  /** Only films or only series. */
  objectType?: ObjectType
  /** How many titles JustWatch is asked for (1–100, default 10). */
  first?: number
  /** Sort results by similarity to the search key (default: true). */
  sortBySimilarity?: boolean
  signal?: AbortSignal
}

export interface JustWatchTitleOptions extends JustWatchLocale {
  /**
   * The title's TMDB id. When given, the title is the one carrying it, and no
   * other: the search key only finds the candidates, so it may be a translated
   * or an original name. A TMDB id is only unique within a kind, so pass
   * `objectType` with it.
   */
  tmdbId?: number
  /** The title's IMDb id, e.g. `tt0120737`, used the same way as `tmdbId`. */
  imdbId?: string
  /** Only films or only series. */
  objectType?: ObjectType
  /** Without an id, prefer the title released this year (a year either side is accepted). */
  year?: number
  /** How many titles the search looks through (default 10). */
  first?: number
  signal?: AbortSignal
}

export class JustWatchService extends BaseScraperService {
  static GRAPHQL_URL = 'https://apis.justwatch.com/graphql'
  static REFERER_HEADER = 'https://www.justwatch.com/'

  private readonly country: string
  private readonly language: string

  /** `country` defaults to `US` and `language` to `en`; both can be changed for one call. */
  constructor(options: JustWatchOptions = {}) {
    super(options)
    this.country = options.country ?? 'US'
    this.language = options.language ?? 'en'
  }

  /** The titles matching a search key, with their offers in the country asked for. */
  async search(searchKey: string, options: JustWatchSearchOptions = {}): Promise<SearchResult> {
    const locale = this.localeOf(options)
    if (!searchKey) return fail('Search key is required', { kind: 'input' })
    if (!locale.success) return locale

    const body = await this.post(
      'SearchTitles',
      SEARCH_QUERY,
      this.searchVariables(searchKey, locale.data, options.objectType, options.first),
      options.signal,
    )
    if (!body.success) return body
    return this.parsed(() =>
      parseSearchJsonResult(body.data, searchKey, this.minSimilarity, options.sortBySimilarity ?? true),
    )
  }

  /** Convenience wrapper returning only the single best search match (or `null`). */
  async searchOne(searchKey: string, options: JustWatchSearchOptions = {}): Promise<SearchEntryResult> {
    const result = await this.search(searchKey, options)
    if (!result.success) return result
    return ok(result.data.length > 0 ? result.data[0] : null)
  }

  /**
   * One title and its offers. With a `tmdbId` or an `imdbId` the title is the
   * one carrying it among the search's answers, so a well-known namesake can
   * never be taken for it; without, it is the closest name, in the year asked
   * for when one is. Fails with `notFound` when nothing qualifies.
   */
  async getTitle(searchKey: string, options: JustWatchTitleOptions = {}): Promise<TitleResult> {
    const locale = this.localeOf(options)
    if (!searchKey) return fail('Search key is required', { kind: 'input' })
    if (!locale.success) return locale

    const body = await this.post(
      'SearchTitles',
      SEARCH_QUERY,
      this.searchVariables(searchKey, locale.data, options.objectType, options.first),
      options.signal,
    )
    if (!body.success) return body
    const candidates = this.parsed(() => parseSearchCandidates(body.data, searchKey))
    if (!candidates.success) return candidates

    const found = this.choose(candidates.data, options)
    return found ? ok(found) : fail('No matching title found', { kind: 'notFound' })
  }

  /** A title by JustWatch's own id (`tm…` for a film, `ts…` for a series), for a caller that kept it. */
  async getTitleById(id: string, options: JustWatchLocale & { signal?: AbortSignal } = {}): Promise<TitleResult> {
    const locale = this.localeOf(options)
    if (!/^t[ms]\d+$/.test(id ?? '')) return fail('A JustWatch id such as "tm44313" is required', { kind: 'input' })
    if (!locale.success) return locale

    const body = await this.post('GetTitle', NODE_QUERY, { id, ...locale.data }, options.signal)
    if (!body.success) return body
    const title = this.parsed(() => parseNodeJsonResult(body.data))
    if (!title.success) return title
    return title.data ? ok(title.data) : fail('No title with this id', { kind: 'notFound' })
  }

  private choose(candidates: JustWatchTitle[], options: JustWatchTitleOptions): JustWatchTitle | null {
    const ofKind = candidates.filter((title) => !options.objectType || title.objectType === options.objectType)
    if (options.tmdbId !== undefined || options.imdbId !== undefined) {
      return (
        ofKind.find(
          (title) =>
            (options.tmdbId !== undefined && title.externalIds.tmdbId === options.tmdbId) ||
            (options.imdbId !== undefined && title.externalIds.imdbId === options.imdbId),
        ) ?? null
      )
    }
    const close = ofKind.filter((title) => title.similarity >= this.minSimilarity)
    const inYear =
      options.year === undefined
        ? close
        : close.filter(
            (title) => title.originalReleaseYear !== null && Math.abs(title.originalReleaseYear - options.year!) <= 1,
          )
    return [...inYear].sort((a, b) => b.similarity - a.similarity)[0] ?? null
  }

  private searchVariables(
    searchKey: string,
    locale: { country: string; language: string },
    objectType: ObjectType | undefined,
    first = 10,
  ) {
    return {
      ...locale,
      first: Math.min(Math.max(Math.trunc(first) || 10, 1), 100),
      filter: { searchQuery: searchKey, ...(objectType && { objectTypes: [objectType] }) },
    }
  }

  private localeOf(options: JustWatchLocale): Result<{ country: string; language: string }> {
    const country = (options.country ?? this.country).toUpperCase()
    const language = (options.language ?? this.language).toLowerCase()
    if (!/^[A-Z]{2}$/.test(country)) return fail(`Not a country code: "${country}"`, { kind: 'input' })
    if (!/^[a-z]{2}$/.test(language)) return fail(`Not a language code: "${language}"`, { kind: 'input' })
    return ok({ country, language })
  }

  /**
   * Sends one GraphQL document and answers with the body. Fetching and parsing
   * are kept apart: collapsing them into one `try` is what lets a change of
   * shape report itself as a fetch failure.
   */
  private async post(
    operationName: string,
    query: string,
    variables: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Result<string>> {
    try {
      const response = await this.http.request(
        JustWatchService.GRAPHQL_URL,
        { method: 'POST', headers: REQUEST_HEADERS, body: JSON.stringify({ operationName, query, variables }) },
        signal,
      )
      if (!response.ok) {
        throw new HttpError(`${operationName} request failed with status ${response.status}`, response.status)
      }
      return ok(await response.text())
    } catch (error) {
      this.logger.error(`JustWatch ${operationName} request failed:`, error)
      return failFrom(error, SUBJECT)
    }
  }

  private parsed<T>(read: () => T): Result<T> | Failure {
    try {
      return ok(read())
    } catch (error) {
      this.logger.error('Failed to parse the JustWatch response:', error)
      return failFrom(error, SUBJECT, 'parse')
    }
  }
}

const REQUEST_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
  Referer: JustWatchService.REFERER_HEADER,
}
