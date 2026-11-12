import { getMatchScore, ScraperError } from '@deadlock-too/scrape-kit'
import {
  GraphQLResponse,
  JustWatchOffer,
  JustWatchTitle,
  ObjectType,
  RawNodeData,
  RawOffer,
  RawSearchData,
  RawTitle,
} from './types'
import { imageUrl, SITE_HOST } from './utils'

/** Every title a search answered, scored against the key, those below `minSimilarity` left out. */
export function parseSearchJsonResult(
  jsonString: string,
  searchKey: string,
  minSimilarity: number,
  sortBySimilarity: boolean = true,
): JustWatchTitle[] {
  const data = dataOf<RawSearchData>(parse(jsonString))
  const edges = data.popularTitles?.edges
  if (!Array.isArray(edges)) {
    throw new ScraperError(
      'Unexpected JustWatch search response: missing "popularTitles.edges" (the API may have changed)',
    )
  }

  const titles: JustWatchTitle[] = []
  for (const edge of edges) {
    const title = mapTitle(edge.node, searchKey)
    if (title.similarity < minSimilarity) continue
    titles.push(title)
  }
  return sortBySimilarity ? titles.sort((a, b) => b.similarity - a.similarity) : titles
}

/** Every title a search answered, whatever their names: the ones a lookup by id chooses among. */
export function parseSearchCandidates(jsonString: string, searchKey: string): JustWatchTitle[] {
  return parseSearchJsonResult(jsonString, searchKey, 0, false)
}

/** The title a node lookup answered, or `null` when JustWatch has no such title. */
export function parseNodeJsonResult(jsonString: string): JustWatchTitle | null {
  const response = parse<RawNodeData>(jsonString)
  // An id JustWatch does not know comes back as a null node, sometimes with an
  // error beside it from deep in its resolver; neither is a change of shape.
  if (response.data && response.data.node === null) return null
  const node = dataOf<RawNodeData>(response).node
  if (!node || !node.objectType) return null
  return mapTitle(node, null)
}

function mapTitle(node: RawTitle | undefined, searchKey: string | null): JustWatchTitle {
  if (!node || typeof node.id !== 'string' || !node.content) {
    throw new ScraperError('Unexpected JustWatch title: missing "id" or "content" (the API may have changed)')
  }
  const content = node.content
  const tmdbId = Number(content.externalIds?.tmdbId)
  return {
    id: node.id,
    objectId: node.objectId,
    objectType: node.objectType as ObjectType,
    title: content.title,
    originalTitle: content.originalTitle ?? null,
    originalReleaseYear: content.originalReleaseYear ?? null,
    url: content.fullPath ? SITE_HOST + content.fullPath : null,
    posterUrl: content.posterUrl ? imageUrl(content.posterUrl, 's332') : null,
    posterTemplate: content.posterUrl ?? null,
    externalIds: {
      tmdbId: Number.isInteger(tmdbId) && tmdbId > 0 ? tmdbId : null,
      imdbId: content.externalIds?.imdbId || null,
    },
    offers: (node.offers ?? []).flatMap(mapOffer),
    similarity:
      searchKey === null
        ? 1
        : Math.max(
            getMatchScore(content.title, searchKey),
            content.originalTitle ? getMatchScore(content.originalTitle, searchKey) : 0,
          ),
  }
}

/** An offer, or none when JustWatch gave it no link or no service: nothing a person could follow. */
function mapOffer(offer: RawOffer): JustWatchOffer[] {
  const pack = offer.package
  if (!pack || !offer.standardWebURL) return []
  return [
    {
      monetizationType: offer.monetizationType,
      presentationType: offer.presentationType === '_4K' ? '4K' : offer.presentationType,
      url: offer.standardWebURL,
      deeplinkUrl: offer.deeplinkURL || null,
      price: offer.retailPriceValue ?? null,
      priceText: offer.retailPrice ?? null,
      currency: offer.currency ?? null,
      availableTo: offer.availableToTime ?? null,
      elementCount: offer.elementCount ?? 0,
      package: {
        id: pack.packageId,
        name: pack.clearName,
        technicalName: pack.technicalName,
        shortName: pack.shortName,
        iconUrl: pack.icon ? imageUrl(pack.icon, 's100', 'png') : null,
        iconTemplate: pack.icon ?? null,
      },
    },
  ]
}

function parse<T>(jsonString: string): GraphQLResponse<T> {
  try {
    return JSON.parse(jsonString) as GraphQLResponse<T>
  } catch (error) {
    throw new ScraperError('Failed to parse the JustWatch response as JSON', error)
  }
}

/** The `data` of a response, or the GraphQL errors that came instead, named. */
function dataOf<T>(response: GraphQLResponse<T>): T {
  if (response?.data) return response.data
  const message = response?.errors?.map((error) => error?.message).find(Boolean)
  throw new ScraperError(
    message
      ? `JustWatch refused the query: ${message} (the API may have changed)`
      : 'Unexpected JustWatch response: missing "data" (the API may have changed)',
  )
}
