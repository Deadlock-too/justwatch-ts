// Verifies the published ESM entrypoint loads and exports the public API.
import assert from 'node:assert'
import { HttpError, JustWatchService, ObjectType, ScraperError, bestOffers, imageUrl } from '../dist/index.mjs'

assert.strictEqual(typeof JustWatchService, 'function')
assert.strictEqual(typeof new JustWatchService().search, 'function')
assert.strictEqual(typeof new JustWatchService().getTitle, 'function')
assert.strictEqual(typeof new JustWatchService().getTitleById, 'function')
assert.strictEqual(ObjectType.Movie, 'MOVIE')
assert.deepStrictEqual(bestOffers([]), [])
assert.strictEqual(imageUrl('/i/{profile}/x.{format}', 's100'), 'https://images.justwatch.com/i/s100/x.webp')
assert.ok(new HttpError('boom', 403) instanceof ScraperError)
assert.strictEqual(new HttpError('boom', 403).status, 403)
console.log('ESM smoke test passed')
