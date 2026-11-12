import { beforeAll, describe, expect, jest, test } from '@jest/globals'
import { JustWatchService, ObjectType, bestOffers } from '../src'

// These hit the live JustWatch API, so they need more headroom than Jest's 5s
// default. As in metacritic-ts, this has to live here rather than as a
// project-level `testTimeout`, which Jest resolves but does not apply.
jest.setTimeout(30_000)

// These tests hit the live JustWatch API. They run only via the scheduled CI
// workflow (`npm run test:integration`), not as part of `npm test`.
//
// One service instance is shared across the suite to keep the request volume
// as low as the suite allows. The titles are long-lived ones whose ids cannot
// change; where they stream is not asserted, since that changes every month.
let service: JustWatchService

beforeAll(() => {
  service = new JustWatchService({ country: 'IT', language: 'it' })
})

describe('Integration – JustWatchService search', () => {
  test('searches films in Italian', async () => {
    const result = await service.search('Il Signore degli Anelli', { objectType: ObjectType.Movie })
    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error)

    const fellowship = result.data.find((title) => title.externalIds.tmdbId === 120)
    expect(fellowship).toBeDefined()
    expect(fellowship!.objectType).toBe(ObjectType.Movie)
    expect(fellowship!.originalReleaseYear).toBe(2001)
    expect(fellowship!.externalIds.imdbId).toBe('tt0120737')
    expect(fellowship!.url).toMatch(/^https:\/\/www\.justwatch\.com\/it\//)
  })

  test('returns an empty result set for an unknown title', async () => {
    const result = await service.search('ThisTitleDoesNotExistAndShouldNotBeFoundAnywhere')
    expect(result).toEqual({ success: true, data: [] })
  })
})

describe('Integration – JustWatchService getTitle', () => {
  test('finds a series by its TMDB id, under its Italian name', async () => {
    const result = await service.getTitle('Severance', { tmdbId: 95396, objectType: ObjectType.Show })
    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error)
    expect(result.data.id).toBe('ts320458')
    expect(result.data.objectType).toBe(ObjectType.Show)

    // Every offer that is kept links somewhere a person can go.
    for (const offer of bestOffers(result.data.offers)) {
      expect(offer.url).toMatch(/^https?:\/\//)
      expect(offer.package.name.length).toBeGreaterThan(0)
    }
  })

  test('fails when no title carries the id', async () => {
    const result = await service.getTitle('Il Signore degli Anelli', { tmdbId: 1, objectType: ObjectType.Movie })
    expect(result).toEqual({ success: false, error: 'No matching title found', kind: 'notFound' })
  })
})

describe('Integration – JustWatchService getTitleById', () => {
  test('reads a film by JustWatch’s own id', async () => {
    const result = await service.getTitleById('tm44313')
    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error)
    expect(result.data.externalIds.tmdbId).toBe(120)
  })

  test('an id JustWatch does not know is notFound', async () => {
    const result = await service.getTitleById('tm99999999999')
    expect(result).toMatchObject({ success: false, kind: 'notFound' })
  })
})

describe('Integration – failure classification', () => {
  test('a real elapsed deadline classifies as timeout, not as a parse failure', async () => {
    const impatient = new JustWatchService({ timeout: 1, retries: 0 })
    const result = await impatient.search('Dune')
    expect(result.success).toBe(false)
    if (result.success) throw new Error('expected failure')
    expect(result.kind).toBe('timeout')
    expect(result.error).toBe('The JustWatch request timed out')
  })

  test('a real caller abort classifies as aborted', async () => {
    const controller = new AbortController()
    const promise = service.search('Dune', { signal: controller.signal })
    controller.abort()
    const result = await promise
    expect(result.success).toBe(false)
    if (result.success) throw new Error('expected failure')
    expect(result.kind).toBe('aborted')
  })
})
