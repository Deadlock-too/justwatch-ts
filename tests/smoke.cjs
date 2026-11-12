// Verifies the published CommonJS entrypoint loads and exports the public API.
const assert = require('node:assert')
const { HttpError, JustWatchService, ObjectType, ScraperError, bestOffers, imageUrl } = require('../dist/index.cjs')

assert.strictEqual(typeof JustWatchService, 'function')
assert.strictEqual(typeof new JustWatchService().search, 'function')
assert.strictEqual(typeof new JustWatchService().getTitle, 'function')
assert.strictEqual(typeof new JustWatchService().getTitleById, 'function')
assert.strictEqual(ObjectType.Movie, 'MOVIE')
assert.deepStrictEqual(bestOffers([]), [])
assert.strictEqual(imageUrl('/i/{profile}/x.{format}', 's100'), 'https://images.justwatch.com/i/s100/x.webp')
assert.ok(new HttpError('boom', 403) instanceof ScraperError)
assert.strictEqual(new HttpError('boom', 403).status, 403)
console.log('CJS smoke test passed')
