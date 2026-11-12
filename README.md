# justwatch-ts

[![GitHub](https://img.shields.io/github/license/Deadlock-too/justwatch-ts)](https://github.com/Deadlock-too/justwatch-ts)
[![npm](https://img.shields.io/npm/v/justwatch-ts)](https://www.npmjs.com/package/justwatch-ts)
[![npm](https://img.shields.io/npm/dt/justwatch-ts)](https://www.npmjs.com/package/justwatch-ts)
[![CI](https://github.com/Deadlock-too/justwatch-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/Deadlock-too/justwatch-ts/actions/workflows/ci.yml)

A TypeScript library for finding where a film or a series can be watched, from JustWatch: in which country, on which service, included in a subscription, free, rented or bought, with a direct link to the service's own page.

It is the sibling of my [howlongtobeat-ts](https://github.com/Deadlock-too/howlongtobeat-ts) and [metacritic-ts](https://github.com/Deadlock-too/metacritic-ts), and shares their networking, their result type and their failure kinds through [`@deadlock-too/scrape-kit`](https://github.com/Deadlock-too/scrape-kit).

> ⚠️ **Disclaimer:** This library uses JustWatch's undocumented GraphQL API. It is not an official API and is not affiliated with nor endorsed by JustWatch GmbH in any way. JustWatch can change or close it without notice. Please use it responsibly, cache what it answers, and do not overload JustWatch's servers. Use at your own risk.

## Features

- Search films and series by name, in any country and language JustWatch covers
- Find one title by its TMDB or IMDb id, so a well-known namesake is never taken for it
- Every offer with a direct link to the service, its price, quality and the date it leaves
- `bestOffers()` to keep one offer per service, the best quality, in the order a person wants them
- Resilient networking: configurable timeouts, retries with backoff, `429` handling, an injectable `fetch` and `AbortSignal` support
- Failures carry a machine-readable `kind`, so you can tell a JustWatch outage from a change that broke this library
- Fully typed, with a discriminated-union result type and zero `console` noise

## Installation

```bash
npm install justwatch-ts
```

Requires Node.js 18 or newer (the library uses the global `fetch`). Ships both ESM and CommonJS builds.

## Usage

```typescript
import { JustWatchService, ObjectType, bestOffers } from 'justwatch-ts'

const justwatch = new JustWatchService({ country: 'IT', language: 'it' })

// Find a title by its TMDB id. The search key only finds the candidates, so it
// can be the translated or the original name. A TMDB id is only unique within a
// kind: pass the kind with it.
const severance = await justwatch.getTitle('Severance', { tmdbId: 95396, objectType: ObjectType.Show })
if (severance.success) {
  for (const offer of bestOffers(severance.data.offers)) {
    console.log(offer.monetizationType, offer.package.name, offer.priceText ?? '', offer.url)
  }
}

// Search, with the offers of every title found.
const results = await justwatch.search('Il Signore degli Anelli', { objectType: ObjectType.Movie })
if (results.success) {
  console.log(results.data.map((title) => `${title.title} (${title.originalReleaseYear})`))
}

// Another country for one call.
await justwatch.getTitle('Dune: Part Two', {
  tmdbId: 693134,
  objectType: ObjectType.Movie,
  country: 'US',
  language: 'en',
})

// JustWatch's own id, for a caller that kept it.
await justwatch.getTitleById('tm44313')
```

### Handling failures

Every failure carries an optional `kind` alongside `error`. Branch on `kind` — `error` is prose for humans and its wording may change between releases.

| `kind`      | What happened                                                | Where the fix lives |
| ----------- | ------------------------------------------------------------ | ------------------- |
| `input`     | Arguments rejected: an empty key, a bad country or language  | your call site      |
| `transport` | The round trip never completed — DNS, refused, reset, TLS    | the network         |
| `timeout`   | The per-request deadline elapsed                             | the network         |
| `aborted`   | Your `AbortSignal` fired                                     | your call site      |
| `http`      | JustWatch answered with a non-2xx status (see `status`)      | JustWatch           |
| `parse`     | The response could not be understood, or the query refused   | this library        |
| `notFound`  | No title carries the id, or none is close enough to the name | nobody              |
| `unknown`   | Could not be attributed to any of the above                  | —                   |

`search` itself never reports `notFound`: a search matching nothing succeeds with an empty array, and `searchOne` succeeds with `null`. `getTitle` and `getTitleById` report it, because they promise one title.

### Configuration

```typescript
import { JustWatchService, consoleLogger } from 'justwatch-ts'

const justwatch = new JustWatchService({
  country: 'IT', // ISO 3166-1 alpha-2 (default: US)
  language: 'it', // ISO 639-1 (default: en)
  minSimilarity: 0.5, // min similarity (0–1) for a name match, clamped
  timeout: 30_000, // per-request timeout in ms
  retries: 2, // retry attempts on transient failures / 429 / 5xx
  logger: consoleLogger, // opt in to diagnostic logging (default: silent)
  // fetch: myCustomFetch,  // inject a custom fetch (proxy, undici agent, …)
})
```

## API

### `JustWatchService`

- `constructor(options?: JustWatchOptions)` — `ScraperOptions` (`timeout`, `retries`, `retryDelay`, `fetch`, `userAgents`, `logger`, `minSimilarity`) plus `country` and `language`.
- `search(searchKey, options?): Promise<SearchResult>` — `options` is `{ objectType?, first?, sortBySimilarity?, country?, language?, signal? }`. Titles below `minSimilarity`, compared with both the translated and the original name, are left out.
- `searchOne(searchKey, options?): Promise<SearchEntryResult>` — the best match of `search`, or `null`.
- `getTitle(searchKey, options?): Promise<TitleResult>` — `options` is `{ tmdbId?, imdbId?, objectType?, year?, first?, country?, language?, signal? }`. With an id, the title carrying it among the search's answers and no other; without, the closest name, in `year` (one either side) when given.
- `getTitleById(id, options?): Promise<TitleResult>` — `id` is JustWatch's (`tm…` for a film, `ts…` for a series).

### `JustWatchTitle`

`id`, `objectId`, `objectType`, `title`, `originalTitle`, `originalReleaseYear`, `url` (its page on justwatch.com), `posterUrl` and `posterTemplate`, `externalIds` (`{ tmdbId, imdbId }`), `offers` and `similarity`.

### `JustWatchOffer`

`monetizationType` (`FLATRATE`, `FREE`, `ADS`, `RENT`, `BUY`, `CINEMA`, `FAST`, or a newer kind passed through), `presentationType` (`SD`, `HD`, `4K`, …), `url` (the service's page), `deeplinkUrl`, `price`, `priceText`, `currency`, `availableTo`, `elementCount` (a series' seasons), and `package`: `{ id, name, technicalName, shortName, iconUrl, iconTemplate }`.

A link is whatever JustWatch has for the service. Most go straight to the title on the service; a few services only have their home page, and a few are partner links that redirect.

### Helpers

- `bestOffers(offers)` — one offer per service and way of paying, the best quality (then the cheapest) kept: included, free, with ads, rented, bought, cinema, cheapest first.
- `imageUrl(template, profile, format?)` — a poster or an icon at a size: posters `s166`, `s332`, `s592`, `s718`; icons `s100`; format `webp` (default), `jpg` or `png`.

## Development

```bash
git clone https://github.com/Deadlock-too/justwatch-ts.git
cd justwatch-ts
npm install

npm run build            # build with tsdown
npm test                 # unit tests
npm run test:integration # live API tests (hit JustWatch)
npm run test:coverage    # unit tests with coverage
npm run lint             # eslint
npm run format           # prettier
```

Releases are managed with [Changesets](https://github.com/changesets/changesets): run `npm run changeset` to record a change; the release workflow publishes to npm once the generated version PR is merged.

## Issues, Questions & Discussions

If you found a bug, report it creating an [issue](https://github.com/Deadlock-too/justwatch-ts/issues/new). If you need a new feature, or want to discuss the current implementation, consider opening a [discussion](https://github.com/Deadlock-too/justwatch-ts/discussions/) or proposing a change with a [Pull Request](https://github.com/Deadlock-too/justwatch-ts/pulls).

## License

This project is licensed under the MIT License - see the [LICENSE](https://github.com/Deadlock-too/justwatch-ts/blob/main/LICENSE) file for details.
