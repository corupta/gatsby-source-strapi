const { createRemoteFileNode } = require(`gatsby-source-filesystem`)

const extractFields = async (
  reporter,
  apiURL,
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
      // full media url
      const source_url = `${item.url.startsWith('http') ? '' : apiURL}${
        item.url
      }`
      try {
        const fileNode = await createRemoteFileNode({
          url: source_url,
          cache,
          createNode,
          createNodeId,
          auth,
          reporter,
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
        reporter.error(`Failed to fetch file from ${source_url} ${e}`)
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
    return await Promise.all(
      item.map(async f =>
        extractFields(
          reporter,
          apiURL,
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
    return await Promise.all(
      Object.keys(item).map(async key => {
        const field = item[key]

        const fileNodeID = await extractFields(
          reporter,
          apiURL,
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
      })
    )
  }
}

// Downloads media from image type fields
exports.downloadMediaFiles = async ({
  entities,
  types,
  apiURL,
  cache,
  createNode,
  createNodeId,
  touchNode,
  jwtToken: auth,
  fetchActivity,
  reporter,
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
      await Promise.all(
        entity.map(async item => {
          await extractFields(
            reporter,
            apiURL,
            cache,
            createNode,
            createNodeId,
            touchNode,
            auth,
            item
          )
          subfetchActivity.tick()
        })
      )
      subfetchActivity.done()
      fetchActivity.tick()
      return entity
    })
  )
