import axios from 'axios'
import fetchData from './fetch'
import { Node } from './nodes'
import { capitalize } from 'lodash'
import normalize from './normalize'
import authentication from './authentication'

exports.sourceNodes = async (
  { actions, cache, reporter, getNode, getNodes },
  {
    apiURL = 'http://localhost:1337',
    contentTypes = [],
    singleTypes = [],
    preprocessNodes = null,
    loginData = {},
    queryLimit = 100,
  }
) => {
  const { createNode, deleteNode, touchNode } = actions

  // Authentication function
  let jwtToken = await authentication({ loginData, reporter, apiURL })

  // Start activity, Strapi data fetching
  let fetchActivity = reporter.createProgress(
    `Fetching Strapi Data`,
    contentTypes.length + singleTypes.length
  )
  fetchActivity.start()

  // Generate a list of promises based on the `contentTypes` option.
  const contentTypePromises = contentTypes.map(async contentType => {
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

  // Generate a list of promises based on the `singleTypes` option.
  const singleTypePromises = singleTypes.map(async singleType => {
    const entity = await fetchData({
      apiURL,
      singleType,
      jwtToken,
      queryLimit,
      reporter,
    })
    fetchActivity.tick()
    return entity
  })

  // Execute the promises
  let entities = await Promise.all([
    ...contentTypePromises,
    ...singleTypePromises,
  ])

  const types = [...contentTypes, ...singleTypes]

  fetchActivity.done()
  fetchActivity = reporter.createProgress(
    `Fetching Media Files of All Types`,
    entities.length
  )
  fetchActivity.start()

  // Creating files
  entities = await normalize.downloadMediaFiles({
    entities,
    types,
    apiURL,
    cache,
    createNode,
    touchNode,
    jwtToken,
    fetchActivity,
    reporter,
  })

  fetchActivity.done()
  fetchActivity = reporter.createProgress(
    `Creating graphql nodes of All Types`,
    contentTypes.length
  )
  fetchActivity.start()

  const allEntities = types.reduce(
    (acc, type, i) => ({
      ...acc,
      [type]: entities[i],
    }),
    {}
  )

  if (preprocessNodes) {
    preprocessNodes(allEntities)
  }

  // new created nodes
  let newNodes = []

  // Fetch existing strapi nodes
  const existingNodes = getNodes().filter(
    n => n.internal.owner === `gatsby-source-strapi`
  )

  // Touch each one of them
  existingNodes.forEach(n => {
    touchNode({ nodeId: n.id })
  })

  // Merge single and content types and retrieve create nodes
  types.forEach((type, i) => {
    const items = allEntities[type]
    const subfetchActivity = reporter.createProgress(
      `Creating graphql nodes for ${type}`,
      items.length,
      0,
      { parentSpan: fetchActivity.span }
    )
    subfetchActivity.start()
    items.forEach((item, i) => {
      const node = Node(capitalize(type), item)
      // Adding new created nodes in an Array
      newNodes.push(node)

      // Create nodes
      createNode(node)
      subfetchActivity.tick()
    })
    subfetchActivity.done()
    fetchActivity.tick()
  })

  // Make a diff array between existing nodes and new ones
  const diff = existingNodes.filter(
    ({ id: id1 }) => !newNodes.some(({ id: id2 }) => id2 === id1)
  )

  // Delete diff nodes
  diff.forEach(data => {
    deleteNode({ node: getNode(data.id) })
  })

  fetchActivity.done()
}
