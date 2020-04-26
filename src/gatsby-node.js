import axios from 'axios'
import fetchData from './fetch'
import { Node } from './nodes'
import { capitalize } from 'lodash'
import normalize from './normalize'

exports.sourceNodes = async (
  { store, boundActionCreators, cache, reporter },
  {
    apiURL = 'http://localhost:1337',
    contentTypes = [],
    preprocessNodes = null,
    loginData = {},
    queryLimit = 100,
    concurrentMediaDownloadsPerType = 50,
  }
) => {
  const { createNode, touchNode } = boundActionCreators
  let jwtToken = null

  // Check if loginData is set.
  if (
    loginData.hasOwnProperty('identifier') &&
    loginData.identifier.length !== 0 &&
    loginData.hasOwnProperty('password') &&
    loginData.password.length !== 0
  ) {
    const authenticationActivity = reporter.activityTimer(
      `Authenticate Strapi User`
    )
    authenticationActivity.start()

    // Define API endpoint.
    const loginEndpoint = `${apiURL}/auth/local`

    // Make API request.
    try {
      const loginResponse = await axios.post(loginEndpoint, loginData)

      if (loginResponse.hasOwnProperty('data')) {
        jwtToken = loginResponse.data.jwt
      }
    } catch (e) {
      reporter.panic('Strapi authentication error: ' + e)
    }

    authenticationActivity.end()
  }

  let fetchActivity = reporter.createProgress(
    `Fetching Strapi Data`,
    contentTypes.length
  )
  fetchActivity.start()

  // Generate a list of promises based on the `contentTypes` option.
  const promises = contentTypes.map(async contentType => {
    const entity = await fetchData({
      apiURL,
      contentType,
      jwtToken,
      queryLimit,
      reporter,
    })
    fetchActivity.tick()
    return entity
  })

  // Execute the promises.
  let entities = await Promise.all(promises)

  fetchActivity.done()
  fetchActivity = reporter.createProgress(
    `Fetching Media Files of All Types`,
    entities.length
  )
  fetchActivity.start()

  entities = await normalize.downloadMediaFiles({
    entities,
    contentTypes,
    apiURL,
    store,
    cache,
    createNode,
    touchNode,
    jwtToken,
    fetchActivity,
    reporter,
    concurrentMediaDownloadsPerType,
  })

  fetchActivity.done()
  fetchActivity = reporter.createProgress(
    `Creating graphql nodes of All Types`,
    contentTypes.length
  )
  fetchActivity.start()

  const allEntities = contentTypes.reduce(
    (acc, contentType, i) => ({
      ...acc,
      [contentType]: entities[i],
    }),
    {}
  )

  if (preprocessNodes) {
    preprocessNodes(allEntities)
  }

  contentTypes.forEach((contentType, i) => {
    const items = allEntities[contentType]
    const subfetchActivity = reporter.createProgress(
      `Creating graphql nodes for ${contentType}`,
      items.length,
      0,
      { parentSpan: fetchActivity.span }
    )
    subfetchActivity.start()
    items.forEach((item, i) => {
      const node = Node(capitalize(contentType), item)
      createNode(node)
      subfetchActivity.tick()
    })
    subfetchActivity.done()
    fetchActivity.tick()
  })

  fetchActivity.done()
}
