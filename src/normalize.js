const { createRemoteFileNode } = require(`gatsby-source-filesystem`)

const extractFields = async (
  apiURL,
  store,
  cache,
  createNode,
  createNodeId,
  touchNode,
  auth,
  item,
  key = 'localFile'
) => {
  // image fields have a mime property among other
  // maybe should find a better test
  if (item && item.hasOwnProperty('mime')) {
    let fileNodeID
    // using field on the cache key for multiple image field
    const mediaDataCacheKey = `strapi-media-${item.id}-${key}`
    const cacheMediaData = await cache.get(mediaDataCacheKey)
    const itemUpdatedAt = item.updatedAt || item.updated_at

    // If we have cached media data and it wasn't modified, reuse
    // previously created file node to not try to redownload
    if (cacheMediaData && itemUpdatedAt === cacheMediaData.updatedAt) {
      fileNodeID = cacheMediaData.fileNodeID
      touchNode({ nodeId: cacheMediaData.fileNodeID })
    }

    // If we don't have cached data, download the file
    if (!fileNodeID) {
      try {
        // full media url
        const source_url = `${item.url.startsWith('http') ? '' : apiURL}${
          item.url
        }`
        const fileNode = await createRemoteFileNode({
          url: source_url,
          store,
          cache,
          createNode,
          createNodeId,
          auth,
        })

        // If we don't have cached data, download the file
        if (fileNode) {
          fileNodeID = fileNode.id

          await cache.set(mediaDataCacheKey, {
            fileNodeID,
            updatedAt: itemUpdatedAt,
          })
        }
      } catch (e) {
        // Ignore
      }
    }

    if (fileNodeID) {
      if (key !== 'localFile') {
        return fileNodeID
      }

      item.localFile___NODE = fileNodeID
    }
  } else if (Array.isArray(item)) {
    await Promise.all(
      item.map(async f =>
        extractFields(
          apiURL,
          store,
          cache,
          createNode,
          createNodeId,
          touchNode,
          auth,
          f
        )
      )
    )
  } else if (item && typeof item === 'object') {
    for (const key of Object.keys(item)) {
      const field = item[key]

      const fileNodeID = await extractFields(
        apiURL,
        store,
        cache,
        createNode,
        createNodeId,
        touchNode,
        auth,
        field,
        key
      )

      if (fileNodeID) {
        item[`${key}___NODE`] = fileNodeID
      }
    }
  }
}

// Downloads media from image type fields
exports.downloadMediaFiles = async ({
  entities,
  types,
  apiURL,
  store,
  cache,
  createNode,
  createNodeId,
  touchNode,
  jwtToken: auth,
  fetchActivity,
  reporter,
  concurrentMediaDownloadsPerType,
}) =>
  Promise.all(
    entities.map(async (entity, index) => {
      const type = types[index]
      const subfetchActivity = reporter.createProgress(
        `Fetching Media Files of ${type}`,
        entity.length,
        0,
        { parentSpan: fetchActivity.span }
      )
      subfetchActivity.start()
      let itemIndex = 0
      const next = async () => {
        if (itemIndex >= entity.length) {
          return
        }
        const item = entity[itemIndex]
        ++itemIndex
        await extractFields(
          apiURL,
          store,
          cache,
          createNode,
          createNodeId,
          touchNode,
          auth,
          item
        )
        subfetchActivity.tick()
        return next()
      }
      const promises = []
      for (let i = 0; i < concurrentMediaDownloadsPerType; ++i) {
        promises.push(next())
      }
      await Promise.all(promises)
      subfetchActivity.done()
      fetchActivity.tick()
      return entity
    })
  )
