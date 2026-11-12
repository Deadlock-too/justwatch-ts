import { describe, expect, test } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { JustWatchService, ObjectType, bestOffers, imageUrl, type JustWatchOffer } from '../src'
import { getMatchScore, getSimilarity } from '../src'
import { parseNodeJsonResult, parseSearchJsonResult } from '../src/lib/parser'
import { normalize } from '../src/lib/utils'
import type { FetchLike } from '@deadlock-too/scrape-kit'

const searchFixture = readFileSync('tests/fixtures/search-response.json', 'utf8')
const nodeFixture = readFileSync('tests/fixtures/node-response.json', 'utf8')

/**
 * Reproduces the shape `fetch` gives a socket failure: a bare
 * `TypeError: fetch failed` whose `cause` carries the real errno.
 */
function fetchFailure(code: string): TypeError {
  const cause = Object.assign(new Error(`connect ${code} 127.0.0.1:1`), { code })
  return Object.assign(new TypeError('fetch failed'), { cause })
}

/** A fetch double that never settles until its `init.signal` aborts. */
const hangingFetch: FetchLike = (_input, init) =>
  new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal
    if (!signal) return
    if (signal.aborted) return reject(signal.reason)
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })

type Sent = { url: string; init?: RequestInit; body: any }

function makeService(answer: (body: any) => Response, sent?: Sent[], options = {}) {
  const fetchFn: FetchLike = async (input, init) => {
    const body = JSON.parse(String(init?.body))
    sent?.push({ url: String(input), init, body })
    return answer(body)
  }
  return new JustWatchService({ fetch: fetchFn, retries: 0, country: 'IT', language: 'it', ...options })
}

const json = (value: unknown) => new Response(JSON.stringify(value))
const searching = () => makeService(() => new Response(searchFixture))

describe('JustWatchService – search', () => {
  test('rejects an empty search key', async () => {
    expect(await new JustWatchService().search('')).toEqual({
      success: false,
      error: 'Search key is required',
      kind: 'input',
    })
  })

  test('rejects a country or a language that is not a code', async () => {
    expect(await new JustWatchService().search('Dune', { country: 'Italy' })).toEqual({
      success: false,
      error: 'Not a country code: "ITALY"',
      kind: 'input',
    })
    expect(await new JustWatchService({ language: 'ita' }).search('Dune')).toEqual({
      success: false,
      error: 'Not a language code: "ita"',
      kind: 'input',
    })
  })

  test('posts one GraphQL query in the country and language asked for', async () => {
    const sent: Sent[] = []
    await makeService(() => new Response(searchFixture), sent).search('Il Signore degli Anelli', {
      objectType: ObjectType.Movie,
      first: 3,
      country: 'gb',
      language: 'EN',
    })
    expect(sent).toHaveLength(1)
    expect(sent[0].url).toBe('https://apis.justwatch.com/graphql')
    expect(sent[0].init?.method).toBe('POST')
    expect(sent[0].body.operationName).toBe('SearchTitles')
    expect(sent[0].body.variables).toEqual({
      country: 'GB',
      language: 'en',
      first: 3,
      filter: { searchQuery: 'Il Signore degli Anelli', objectTypes: ['MOVIE'] },
    })
  })

  test('asks for ten titles by default, and never fewer than one or more than a hundred', async () => {
    const sent: Sent[] = []
    const service = makeService(() => new Response(searchFixture), sent)
    await service.search('Dune')
    await service.search('Dune', { first: 0 })
    await service.search('Dune', { first: 500 })
    expect(sent.map((each) => each.body.variables.first)).toEqual([10, 10, 100])
    expect(sent[0].body.variables.filter).toEqual({ searchQuery: 'Dune' })
  })

  test('defaults to the United States in English', async () => {
    const sent: Sent[] = []
    const service = new JustWatchService({
      retries: 0,
      fetch: async (input, init) => {
        sent.push({ url: String(input), init, body: JSON.parse(String(init?.body)) })
        return new Response(searchFixture)
      },
    })
    await service.search('Dune')
    expect(sent[0].body.variables).toMatchObject({ country: 'US', language: 'en' })
  })

  test('returns the titles with their offers, closest name first', async () => {
    const result = await searching().search('Il Signore degli Anelli')
    if (!result.success) throw new Error(result.error)
    expect(result.data.map((title) => title.id)).toEqual(['tm15075', 'tm115982', 'tm44313'])
    const [first] = result.data
    expect(first).toMatchObject({
      objectId: 15075,
      objectType: ObjectType.Movie,
      title: 'Il Signore degli Anelli',
      originalTitle: 'The Lord of the Rings',
      originalReleaseYear: 1978,
      url: 'https://www.justwatch.com/it/film/il-signore-degli-anelli',
      externalIds: { tmdbId: 123, imdbId: 'tt0077869' },
      similarity: 1,
    })
    expect(first.posterUrl).toMatch(/^https:\/\/images\.justwatch\.com\/poster\/\d+\/s332\/.+\.webp$/)
    expect(first.offers[0]).toMatchObject({
      monetizationType: 'FLATRATE',
      package: { name: 'Artiflix', technicalName: expect.any(String), id: expect.any(Number) },
    })
    expect(first.offers[0].package.iconUrl).toMatch(/^https:\/\/images\.justwatch\.com\/icon\/\d+\/s100\/.+\.png$/)
  })

  test('can leave JustWatch’s order untouched', async () => {
    const result = await searching().search('Il Signore degli Anelli', { sortBySimilarity: false })
    if (!result.success) throw new Error(result.error)
    expect(result.data.map((title) => title.id)).toEqual(['tm44313', 'tm15075', 'tm115982'])
  })

  test('matches the original title as well as the translated one', async () => {
    const result = await searching().search('The Lord of the Rings: The Two Towers')
    if (!result.success) throw new Error(result.error)
    expect(result.data[0].id).toBe('tm115982')
    expect(result.data[0].similarity).toBe(1)
  })

  test('leaves out titles below the similarity threshold', async () => {
    const result = await makeService(() => new Response(searchFixture), [], { minSimilarity: 0.99 }).search(
      'Il Signore degli Anelli',
    )
    if (!result.success) throw new Error(result.error)
    expect(result.data.map((title) => title.id)).toEqual(['tm15075'])
  })

  test('searchOne returns the best match, or null', async () => {
    const one = await searching().searchOne('Il Signore degli Anelli')
    expect(one.success && one.data?.id).toBe('tm15075')
    const none = await makeService(() => json({ data: { popularTitles: { edges: [] } } })).searchOne('Nothing')
    expect(none).toEqual({ success: true, data: null })
    const failed = await new JustWatchService().searchOne('')
    expect(failed.success).toBe(false)
  })
})

describe('JustWatchService – getTitle', () => {
  test('rejects an empty search key and a bad locale', async () => {
    expect((await new JustWatchService().getTitle('')).success).toBe(false)
    expect(await new JustWatchService().getTitle('Dune', { country: '1' })).toMatchObject({ kind: 'input' })
  })

  test('takes the title with the TMDB id asked for, whatever its name', async () => {
    const result = await searching().getTitle('Lord of the Rings', { tmdbId: 121, objectType: ObjectType.Movie })
    expect(result.success && result.data.id).toBe('tm115982')
  })

  test('takes the title with the IMDb id asked for', async () => {
    const result = await searching().getTitle('Lord of the Rings', { imdbId: 'tt0120737' })
    expect(result.success && result.data.id).toBe('tm44313')
  })

  test('never takes a namesake for a title with an id it does not carry', async () => {
    expect(await searching().getTitle('Il Signore degli Anelli', { tmdbId: 999 })).toEqual({
      success: false,
      error: 'No matching title found',
      kind: 'notFound',
    })
    // A TMDB id is only unique within a kind: a series with the same number is not this film.
    expect(await searching().getTitle('Il Signore degli Anelli', { tmdbId: 123, objectType: ObjectType.Show })).toEqual(
      expect.objectContaining({ kind: 'notFound' }),
    )
  })

  test('without an id, takes the closest name, in the year asked for', async () => {
    const closest = await searching().getTitle('Il Signore degli Anelli')
    expect(closest.success && closest.data.id).toBe('tm15075')
    const inYear = await searching().getTitle('Il Signore degli Anelli', { year: 2002 })
    expect(inYear.success && inYear.data.id).toBe('tm115982')
    const noYear = await searching().getTitle('Il Signore degli Anelli', { year: 1950 })
    expect(noYear).toMatchObject({ kind: 'notFound' })
  })

  test('a title without a year is not taken for one in a year', async () => {
    const answer = JSON.parse(searchFixture)
    for (const edge of answer.data.popularTitles.edges) edge.node.content.originalReleaseYear = null
    const result = await makeService(() => json(answer)).getTitle('Il Signore degli Anelli', { year: 2001 })
    expect(result).toMatchObject({ kind: 'notFound' })
  })

  test('passes a failed search on whole', async () => {
    const result = await makeService(() => new Response('', { status: 503 })).getTitle('Dune', { tmdbId: 1 })
    expect(result).toEqual({
      success: false,
      error: 'SearchTitles request failed with status 503',
      kind: 'http',
      status: 503,
    })
  })

  test('reports a search it cannot read as parse', async () => {
    const result = await makeService(() => json({ data: { popularTitles: null } })).getTitle('Dune')
    expect(result).toMatchObject({ success: false, kind: 'parse' })
  })
})

describe('JustWatchService – getTitleById', () => {
  test('rejects anything that is not a JustWatch id, and a bad locale', async () => {
    expect(await new JustWatchService().getTitleById('120')).toEqual({
      success: false,
      error: 'A JustWatch id such as "tm44313" is required',
      kind: 'input',
    })
    expect(await new JustWatchService().getTitleById(undefined as unknown as string)).toMatchObject({ kind: 'input' })
    expect(await new JustWatchService().getTitleById('tm1', { language: 'x' })).toMatchObject({ kind: 'input' })
  })

  test('reads one title by its node id', async () => {
    const sent: Sent[] = []
    const result = await makeService(() => new Response(nodeFixture), sent).getTitleById('ts320458')
    expect(sent[0].body).toMatchObject({
      operationName: 'GetTitle',
      variables: { id: 'ts320458', country: 'IT', language: 'it' },
    })
    if (!result.success) throw new Error(result.error)
    expect(result.data).toMatchObject({
      id: 'ts320458',
      objectType: ObjectType.Show,
      title: 'Scissione',
      externalIds: { tmdbId: 95396 },
      similarity: 1,
    })
    expect(result.data.offers.map((offer) => offer.presentationType)).toContain('4K')
  })

  test('an id JustWatch does not know is notFound, even with its resolver’s error beside it', async () => {
    const unknown = { errors: [{ message: 'resolver.findMergedTitle: out of range' }], data: { node: null } }
    expect(await makeService(() => json(unknown)).getTitleById('tm99999999999')).toEqual({
      success: false,
      error: 'No title with this id',
      kind: 'notFound',
    })
    // A node that is not a film or a series comes back as an empty object.
    expect(await makeService(() => json({ data: { node: {} } })).getTitleById('tm1')).toMatchObject({
      kind: 'notFound',
    })
  })

  test('passes a failed request on whole', async () => {
    const result = await makeService(() => new Response('', { status: 500 })).getTitleById('tm1')
    expect(result).toMatchObject({ kind: 'http', status: 500 })
  })

  test('reports a node it cannot read as parse', async () => {
    const result = await makeService(() => json({ data: { node: { objectType: 'MOVIE' } } })).getTitleById('tm1')
    expect(result).toMatchObject({ success: false, kind: 'parse' })
  })
})

/**
 * The point of these is the `kind`, not the fact of failure: a consumer has to
 * be able to tell "JustWatch is down" from "JustWatch changed and broke this
 * library" without matching on wording.
 */
describe('JustWatchService – failure classification', () => {
  test('a refused connection reports transport', async () => {
    const service = new JustWatchService({
      retries: 0,
      fetch: async () => {
        throw fetchFailure('ECONNREFUSED')
      },
    })
    expect(await service.search('Dune')).toEqual({
      success: false,
      error: 'Could not reach JustWatch (network error)',
      kind: 'transport',
    })
  })

  test('an elapsed deadline reports timeout', async () => {
    const service = new JustWatchService({ retries: 0, timeout: 5, fetch: hangingFetch })
    expect(await service.search('Dune')).toMatchObject({ success: false, kind: 'timeout' })
  })

  test('the caller’s own signal reports aborted', async () => {
    const service = new JustWatchService({ retries: 0, fetch: hangingFetch })
    const controller = new AbortController()
    const promise = service.search('Dune', { signal: controller.signal })
    controller.abort()
    expect(await promise).toMatchObject({ success: false, kind: 'aborted' })
  })

  test('a rejected query reports http with its status', async () => {
    const result = await makeService(() => new Response('{"errors":[]}', { status: 422 })).search('Dune')
    expect(result).toMatchObject({ kind: 'http', status: 422 })
  })

  test('a body that is not JSON reports parse', async () => {
    const result = await makeService(() => new Response('<html>')).search('Dune')
    expect(result).toEqual({
      success: false,
      error: 'Failed to parse the JustWatch response as JSON',
      kind: 'parse',
    })
  })

  test('GraphQL errors instead of data report parse, naming JustWatch’s message', async () => {
    const result = await makeService(() =>
      json({ errors: [null, {}, { message: 'Cannot query field "x"' }], data: null }),
    ).search('Dune')
    expect(result).toEqual({
      success: false,
      error: 'JustWatch refused the query: Cannot query field "x" (the API may have changed)',
      kind: 'parse',
    })
  })

  test('a response with neither data nor errors reports parse', async () => {
    const result = await makeService(() => json({})).search('Dune')
    expect(result).toEqual({
      success: false,
      error: 'Unexpected JustWatch response: missing "data" (the API may have changed)',
      kind: 'parse',
    })
  })
})

describe('parser', () => {
  const titleWith = (node: Record<string, unknown>) =>
    JSON.stringify({
      data: { popularTitles: { edges: [{ node: { id: 'tm1', objectId: 1, objectType: 'MOVIE', ...node } }] } },
    })

  test('a title without content is a change of shape', () => {
    expect(() => parseSearchJsonResult(titleWith({ content: null }), 'x', 0)).toThrow(/missing "id" or "content"/)
    expect(() => parseSearchJsonResult(JSON.stringify({ data: { popularTitles: { edges: [{}] } } }), 'x', 0)).toThrow(
      /missing "id" or "content"/,
    )
  })

  test('fills what JustWatch left out with nulls, and drops offers nobody could follow', () => {
    const [title] = parseSearchJsonResult(
      titleWith({
        content: { title: 'Bare', externalIds: null },
        offers: [
          { monetizationType: 'FREE', presentationType: 'HD', standardWebURL: null, package: { packageId: 1 } },
          { monetizationType: 'FREE', presentationType: 'HD', standardWebURL: 'https://a.example', package: null },
          {
            monetizationType: 'FREE',
            presentationType: 'HD',
            standardWebURL: 'https://b.example',
            package: { packageId: 2, clearName: 'B', technicalName: 'b', shortName: 'bbb', icon: null },
          },
        ],
      }),
      'Bare',
      0,
    )
    expect(title).toMatchObject({
      originalTitle: null,
      originalReleaseYear: null,
      url: null,
      posterUrl: null,
      posterTemplate: null,
      externalIds: { tmdbId: null, imdbId: null },
    })
    expect(title.offers).toEqual([
      {
        monetizationType: 'FREE',
        presentationType: 'HD',
        url: 'https://b.example',
        deeplinkUrl: null,
        price: null,
        priceText: null,
        currency: null,
        availableTo: null,
        elementCount: 0,
        package: { id: 2, name: 'B', technicalName: 'b', shortName: 'bbb', iconUrl: null, iconTemplate: null },
      },
    ])
  })

  test('reads a rental’s price and how long it stays', () => {
    const [title] = parseSearchJsonResult(
      titleWith({
        content: { title: 'Priced' },
        offers: [
          {
            monetizationType: 'RENT',
            presentationType: '_4K',
            standardWebURL: 'https://c.example/rent',
            deeplinkURL: 'https://c.example/watch',
            retailPrice: '3,99 €',
            retailPriceValue: 3.99,
            currency: 'EUR',
            availableToTime: '2027-01-01T00:00:00Z',
            elementCount: 2,
            package: {
              packageId: 3,
              clearName: 'C',
              technicalName: 'c',
              shortName: 'ccc',
              icon: '/icon/3/{profile}/c.{format}',
            },
          },
        ],
      }),
      'Priced',
      0,
    )
    expect(title.offers[0]).toMatchObject({
      presentationType: '4K',
      deeplinkUrl: 'https://c.example/watch',
      price: 3.99,
      priceText: '3,99 €',
      currency: 'EUR',
      availableTo: '2027-01-01T00:00:00Z',
      elementCount: 2,
      package: {
        iconUrl: 'https://images.justwatch.com/icon/3/s100/c.png',
        iconTemplate: '/icon/3/{profile}/c.{format}',
      },
    })
  })

  test('a body of null is a change of shape', () => {
    expect(() => parseSearchJsonResult('null', 'x', 0)).toThrow(/missing "data"/)
  })

  test('a title without offers has none', () => {
    const [title] = parseSearchJsonResult(titleWith({ content: { title: 'X' }, offers: null }), 'X', 0)
    expect(title.offers).toEqual([])
  })

  test('a node answer is a title, or null', () => {
    expect(parseNodeJsonResult(nodeFixture)?.id).toBe('ts320458')
    expect(parseNodeJsonResult(JSON.stringify({ data: { node: null } }))).toBeNull()
  })
})

const PACKAGES = ['prime', 'apple', 'chili', 'cinema', 'pluto', 'rai', 'newcomer', 'netflix', 'now']

const offer = (
  name: string,
  monetizationType: string,
  presentationType: string,
  price: number | null = null,
): JustWatchOffer => ({
  monetizationType,
  presentationType,
  url: `https://${name}.example/${monetizationType}/${presentationType}`,
  deeplinkUrl: null,
  price,
  priceText: null,
  currency: 'EUR',
  availableTo: null,
  elementCount: 0,
  package: {
    id: PACKAGES.indexOf(name),
    name,
    technicalName: name,
    shortName: name,
    iconUrl: null,
    iconTemplate: null,
  },
})

describe('bestOffers', () => {
  test('keeps one offer per service and way of paying, the best quality', () => {
    const best = bestOffers([
      offer('prime', 'FLATRATE', 'SD'),
      offer('prime', 'FLATRATE', '4K'),
      offer('prime', 'FLATRATE', 'HD'),
    ])
    expect(best.map((each) => each.presentationType)).toEqual(['4K'])
  })

  test('at the same quality, the cheaper one', () => {
    const best = bestOffers([
      offer('apple', 'RENT', 'HD', 4.99),
      offer('apple', 'RENT', 'HD', 3.99),
      offer('apple', 'RENT', 'HD'),
    ])
    expect(best.map((each) => each.price)).toEqual([3.99])
  })

  test('included first, then free, with ads, rented and bought, cheapest first, the unknown last', () => {
    const best = bestOffers([
      offer('cinema', 'CINEMA', 'HD'),
      offer('apple', 'BUY', 'HD', 9.99),
      offer('chili', 'RENT', 'HD', 4.99),
      offer('apple', 'RENT', 'HD', 3.99),
      offer('pluto', 'ADS', 'SD'),
      offer('rai', 'FREE', 'HD'),
      offer('newcomer', 'SOMETHING', 'CANVAS'),
      offer('netflix', 'FLATRATE', 'HD'),
    ])
    expect(best.map((each) => `${each.monetizationType} ${each.package.name}`)).toEqual([
      'FLATRATE netflix',
      'FREE rai',
      'ADS pluto',
      'RENT apple',
      'RENT chili',
      'BUY apple',
      'CINEMA cinema',
      'SOMETHING newcomer',
    ])
  })
})

describe('bestOffers – edges', () => {
  test('an offer without a price never wins over one with a price, whichever comes first', () => {
    const best = bestOffers([offer('now', 'RENT', 'HD'), offer('now', 'RENT', 'HD', 2.99)])
    expect(best.map((each) => each.price)).toEqual([2.99])
  })

  test('a quality it does not know ranks below SD', () => {
    const best = bestOffers([
      offer('now', 'FREE', 'CANVAS'),
      offer('now', 'FREE', 'SD'),
      offer('now', 'FREE', 'CANVAS'),
    ])
    expect(best.map((each) => each.presentationType)).toEqual(['SD'])
  })

  test('services included alike keep the order they came in', () => {
    const best = bestOffers([offer('netflix', 'FLATRATE', 'HD'), offer('prime', 'FLATRATE', 'HD')])
    expect(best.map((each) => each.package.name)).toEqual(['netflix', 'prime'])
  })
})

describe('utils', () => {
  test('imageUrl fills a template at a size and format', () => {
    expect(imageUrl('/poster/1/{profile}/x.{format}', 's592')).toBe('https://images.justwatch.com/poster/1/s592/x.webp')
    expect(imageUrl('/icon/2/{profile}/n.{format}', 's100', 'png')).toBe(
      'https://images.justwatch.com/icon/2/s100/n.png',
    )
  })

  test('re-exports the similarity primitives', () => {
    expect(getSimilarity('Dune', 'Dune')).toBe(1)
    expect(getMatchScore('Dune: Part Two', 'Dune')).toBeGreaterThan(0.5)
    expect(normalize('Pokémon')).toBe('pokemon')
  })
})
