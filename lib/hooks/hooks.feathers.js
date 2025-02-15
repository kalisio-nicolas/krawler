import _ from 'lodash'
import feathers from '@feathersjs/client'
import io from 'socket.io-client'
import fetch from 'node-fetch'
import makeDebug from 'debug'
// import { getItems } from 'feathers-hooks-common'
import { template, templateObject, templateQueryObject, transformJsonObject, getChunks } from '../utils.js'

const debug = makeDebug('krawler:hooks:feathers')

// Connect to the feathers API
export function connectFeathers (options = {}) {
  return async function (hook) {
    const item = hook.data // getItems(hook)
    let client = _.get(item, options.clientPath || 'client')
    if (client) {
      debug('Already connected to Feathers for ' + item.id)
      return hook
    }
    debug('Connecting to Feathers for ' + item.id)
    if (options.distributed) {
      // If we use distributed services then the client is the app itself
      client = hook.app
    } else {
      client = feathers()
      if (options.transport === 'websocket') {
        const socket = io(options.origin, {
          transports: ['websocket'],
          path: options.path
        })
        client.configure(feathers.socketio(socket))
      } else {
        client.configure(feathers.rest(options.origin).fetch(fetch))
      }
      if (options.authentication) {
        client.configure(feathers.authentication({
          path: options.authentication.path || '/authentication'
        }))
        client.authenticate(_.omit(options.authentication, ['path']))
      }
    }
    _.set(item, options.clientPath || 'client', client)
    debug('Connected to Feathers for ' + item.id)
    return hook
  }
}

// Disconnect from the API
export function disconnectFeathers (options = {}) {
  return async function (hook) {
    const item = hook.data // getItems(hook)
    const client = _.get(item, options.clientPath || 'client')
    if (_.isNil(client)) {
      debug('Already disconnected from Feathers for ' + item.id)
      return hook
    }

    debug('Disconnecting from Feathers for ' + item.id)
    // If authenticated disconnect
    if (typeof client.logout === 'function') await client.logout()
    _.unset(item, options.clientPath || 'client')
    debug('Disconnected from Feathers for ' + item.id)
    return hook
  }
}

function isReadOperation (methodName) {
  return ['find', 'get'].includes(methodName)
}

function isUpdateOperation (methodName) {
  return ['patch', 'update'].includes(methodName)
}

function isDataOperation (methodName) {
  return ['create', 'patch', 'update'].includes(methodName)
}

function templateParams (item, options) {
  // Either we have the complete params object or only the query shortcut
  const templatedQuery = templateQueryObject(item,
    _.get(options, 'params.query', _.get(options, 'query', {})))
  // Avoid templating the special query object already managed above
  const params = (options.params ? templateObject(item, _.omit(options.params, ['query'])) : {})
  params.query = templatedQuery
  return params
}

// Perform a service operation
export function callFeathersServiceMethod (options = {}) {
  return async function (hook) {
    const item = hook.data // getItems(hook)
    const client = _.get(item, options.clientPath || 'client')
    if (_.isNil(client)) {
      throw new Error('You must be connected to Feathers before using the \'callFeathersServiceMethod\' hook')
    }

    const serviceName = template(item, _.get(options, 'service', _.snakeCase(item.id)))
    const methodName = template(item, _.get(options, 'method', 'find'))
    const service = client.service(serviceName)
    const id = _.has(options, 'id') ? options.id : item.id
    // Defines the data object from options or as hook item chunks
    let data
    if (options.data) {
      data = templateObject(item, options.data)
    } else if (isDataOperation(methodName)) {
      // For write operations allow transform before write by passing transform options for chunking
      data = getChunks(hook, options)
      // Take care that for single data we need to extract transformed item from first chunks
      if ((data.length === 1) && (data[0].length === 1)) data = data[0][0]
      // Only create supports chunks
      else if (methodName !== 'create') data = _.flatten(data)
    }
    // For multi-patch/update params will be based on individual data
    let params
    if (!isUpdateOperation(methodName) || !Array.isArray(data)) params = templateParams(item, options)
    let json
    switch (methodName) {
      case 'find':
        debug(`Performing ${methodName} on service ${serviceName} with`, params)
        json = await service[methodName](params)
        break
      case 'get':
        debug(`Performing ${methodName} on service ${serviceName} with`, id, params)
        json = await service[methodName](id, params)
        break
      case 'remove':
        debug(`Performing ${methodName} on service ${serviceName} with`, id, params)
        json = await service[methodName](id, params)
        break
      case 'patch':
      case 'update':
        if (!Array.isArray(data)) {
          debug(`Performing ${methodName} on service ${serviceName} with`, id, data, params)
          json = await service[methodName](id, data, params)
        } else { // Manage multiple items and associated results, in this case id should be null
          json = []
          for (let i = 0; i < data.length; ++i) {
            // In this case we allow templating based on individual items
            params = templateParams(data[i], options)
            debug(`Performing ${methodName} on service ${serviceName} with`, id, data[i], params)
            const result = await service[methodName](id, data[i], params)
            json.push(result)
          }
        }
        break
      case 'create':
      default: // Should manage custom methods
        if (!Array.isArray(data)) {
          debug(`Performing ${methodName} on service ${serviceName} with`, data, params)
          json = await service[methodName](data, params)
        } else { // Manage chunks and associated results
          json = []
          for (let i = 0; i < data.length; ++i) {
            debug(`Performing ${methodName} on service ${serviceName} with`, data[i], params)
            let results = await service[methodName](data[i], params)
            // Manage pagination
            if (results.data) results = results.data
            json = json.concat(results)
          }
        }
        break
    }
    // Manage pagination for find or multi patch/update/remove
    if (json.data) json = json.data
    debug(`${methodName} on service ${serviceName} returned ${json.length} results`)
    // Allow transform after read
    if (isReadOperation(methodName) && options.transform) {
      const templatedTransform = templateObject(item, options.transform)
      json = transformJsonObject(json, templatedTransform)
    }
    // Except if explicitely defined otherwise read operations store results while write operations do not
    const updateResult = (_.has(options, 'updateResult') ? _.get(options, 'updateResult') : isReadOperation(methodName))
    if (updateResult) _.set(hook, options.dataPath || 'result.data', json)

    return hook
  }
}
