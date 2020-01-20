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
    beforeNodeCreate = null,
    loginData = {},
    queryLimit = 100,
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

  let fetchActivity = reporter.activityTimer(`Fetching Strapi Data`)
  fetchActivity.start()

  // Generate a list of promises based on the `contentTypes` option.
  const promises = contentTypes.map(contentType =>
    fetchData({
      apiURL,
      contentType,
      jwtToken,
      queryLimit,
      reporter,
    })
  )

  // Execute the promises.
  let entities = await Promise.all(promises)

  fetchActivity.end()
  fetchActivity = reporter.activityTimer(`Fetching Media Files`)
  fetchActivity.start()

  entities = await normalize.downloadMediaFiles({
    entities,
    apiURL,
    store,
    cache,
    createNode,
    touchNode,
    jwtToken,
  })

  fetchActivity.end()
  fetchActivity = reporter.activityTimer(`Creating graphql nodes`)
  fetchActivity.start()

  contentTypes.forEach((contentType, i) => {
    const items = entities[i]
    items.forEach((item, i) => {
      const node = Node(
        capitalize(contentType),
        beforeNodeCreate ? beforeNodeCreate(item, contentType) : item
      )
      createNode(node)
    })
  })

  fetchActivity.end()
}
