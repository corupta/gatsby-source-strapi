import axios from 'axios'
import { isObject, startsWith, forEach, includes } from 'lodash'
import pluralize from 'pluralize'

module.exports = async ({
  apiURL,
  contentType,
  singleType,
  jwtToken,
  queryLimit,
  reporter,
}) => {
  // Define API endpoint.
  let apiBase = singleType
    ? `${apiURL}/${singleType}`
    : `${apiURL}/${pluralize(contentType)}`

  const apiEndpoint = `${apiBase}?_limit=${queryLimit}`

  reporter.info(`Starting to fetch data from Strapi - ${apiEndpoint}`)

  // Set authorization token
  let fetchRequestConfig = {}
  if (jwtToken !== null) {
    fetchRequestConfig.headers = {
      Authorization: `Bearer ${jwtToken}`,
    }
  }

  const documents = await axios(apiEndpoint, fetchRequestConfig).catch(
    error => {
      reporter.info(`Error when fetching via ${apiEndpoint} ${error.message}`)
      throw error
    }
  )

  // Make sure response is an array for single type instances
  const response = Array.isArray(documents.data)
    ? documents.data
    : [documents.data]

  // Map and clean data.
  return response.map(item => clean(item))
}

/**
 * Remove fields starting with `_` symbol.
 *
 * @param {object} item - Entry needing clean
 * @returns {object} output - Object cleaned
 */
const clean = item => {
  forEach(item, (value, key) => {
    if (startsWith(key, `__`)) {
      delete item[key]
    } else if (startsWith(key, `_`)) {
      delete item[key]
      item[key.slice(1)] = value
    } else if (includes(key, '__')) {
      let [name, locale] = key.split('__')
      if (!item[name]) {
        item[name] = []
      }
      item[name].push({
        value,
        locale,
      })
      delete item[key]
    } else if (isObject(value)) {
      item[key] = clean(value)
    }
  })

  return item
}
