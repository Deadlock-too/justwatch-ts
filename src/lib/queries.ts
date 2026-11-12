/**
 * The two GraphQL documents sent to JustWatch. Both ask for the same fields of
 * a title, so the parser reads one shape whichever way the title was found.
 */

const TITLE_FIELDS = `
  id
  objectId
  objectType
  content(country: $country, language: $language) {
    title
    originalTitle
    originalReleaseYear
    fullPath
    posterUrl
    externalIds { tmdbId imdbId }
  }
  offers(country: $country, platform: WEB) {
    monetizationType
    presentationType
    standardWebURL
    deeplinkURL(platform: WEB)
    retailPrice(language: $language)
    retailPriceValue
    currency
    availableToTime
    elementCount
    package { packageId clearName technicalName shortName icon }
  }
`

export const SEARCH_QUERY = `query SearchTitles($country: Country!, $language: Language!, $first: Int!, $filter: TitleFilter) {
  popularTitles(country: $country, first: $first, filter: $filter) {
    edges { node { ${TITLE_FIELDS} } }
  }
}`

export const NODE_QUERY = `query GetTitle($id: ID!, $country: Country!, $language: Language!) {
  node(id: $id) { ... on MovieOrShow { ${TITLE_FIELDS} } }
}`
