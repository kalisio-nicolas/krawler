import _ from 'lodash'
import chai from 'chai'
import chailint from 'chai-lint'
import path, { dirname } from 'path'
import fs from 'fs-extra'
import fsStore from 'fs-blob-store'
import mongo from 'mongodb'
import { feathers } from '@feathersjs/feathers'
import socketio from '@feathersjs/socketio'
import { memory } from '@feathersjs/memory'
import mongodb from 'feathers-mongodb'
import { hooks as pluginHooks } from '../lib/index.js'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const { MongoClient } = mongo
const { util, expect } = chai

const inputStore = fsStore({ path: path.join(__dirname, 'data') })
const geojson = fs.readJsonSync(path.join(inputStore.path, 'geojson.json'))

function createTests (servicePath, feathersHook, options = {}) {
  it(`creates objects using service ${servicePath}`, async () => {
    feathersHook.type = 'after'
    feathersHook.result = feathersHook.data
    feathersHook.result.data = geojson
    await pluginHooks.callFeathersServiceMethod({
      service: servicePath,
      method: 'create',
      transform: {
        omit: ['properties.prop2']
      }
    })(feathersHook)
    const service = feathersHook.data.client.service(servicePath)
    const results = await service.find({ query: {} })
    expect(results.length).to.equal(3)
    expect(results[0].properties).toExist()
    expect(results[0].properties.prop0).to.equal('value0')
    expect(results[0].properties.prop2).beUndefined()
  })
  // Let enough time to proceed
    .timeout(5000)

  it(`reads objects using service ${servicePath}`, async () => {
    await pluginHooks.callFeathersServiceMethod({
      service: servicePath,
      method: 'find',
      query: {
        $skip: 1,
        $limit: 2
      },
      transform: {
        omit: ['properties.prop0']
      }
    })(feathersHook)
    const results = feathersHook.result.data
    expect(results.length).to.equal(2)
    expect(results[0].id).to.equal(2)
    expect(results[0].properties).toExist()
    expect(results[0].properties.prop0).beUndefined()
    expect(results[0].properties.prop1).to.equal(0)
    expect(results[1].id).to.equal(3)
    expect(results[1].properties).toExist()
    expect(results[0].properties.prop0).beUndefined()
  })
  // Let enough time to proceed
    .timeout(5000)

  it(`updates objects using service ${servicePath} and data as option`, async () => {
    await pluginHooks.callFeathersServiceMethod({
      service: servicePath,
      method: 'patch',
      data: { properties: 'value1' },
      id: null,
      query: {}
    })(feathersHook)
    const service = feathersHook.data.client.service(servicePath)
    const results = await service.find({ query: {} })
    expect(results.length).to.equal(3)
    results.forEach(result => {
      expect(result.properties).to.equal('value1')
    })
  })
  // Let enough time to proceed
    .timeout(5000)

  it(`updates objects using service ${servicePath} and data as item`, async () => {
    feathersHook.data.data = { properties: 'value2' }
    await pluginHooks.callFeathersServiceMethod({
      service: servicePath,
      method: 'patch',
      id: null,
      query: {}
    })(feathersHook)
    const service = feathersHook.data.client.service(servicePath)
    const results = await service.find({ query: {} })
    expect(results.length).to.equal(3)
    results.forEach(result => {
      expect(result.properties).to.equal('value2')
    })
  })
  // Let enough time to proceed
    .timeout(5000)

  it(`updates objects using service ${servicePath} and multiple data as item`, async () => {
    feathersHook.data.data = [{ id: 1, properties: 'value1' }, { id: 2, properties: 'value1' }, { id: 3, properties: 'value1' }]
    await pluginHooks.callFeathersServiceMethod({
      service: servicePath,
      method: 'patch',
      id: null,
      query: { id: '<%= id %>' }
    })(feathersHook)
    const service = feathersHook.data.client.service(servicePath)
    const results = await service.find({ query: {} })
    expect(results.length).to.equal(3)
    results.forEach(result => {
      expect(result.properties).to.equal('value1')
    })
  })
  // Let enough time to proceed
    .timeout(5000)

  it(`deletes objects using service ${servicePath}`, async () => {
    await pluginHooks.callFeathersServiceMethod({
      service: servicePath,
      method: 'remove',
      id: null,
      query: {}
    })(feathersHook)
    const service = feathersHook.data.client.service(servicePath)
    const results = await service.find({ query: {} })
    expect(results.length).to.equal(0)
  })
  // Let enough time to proceed
    .timeout(5000)

  if (options.upsert) {
    it(`upserts objects using service ${servicePath} and multiple data as item`, async () => {
      feathersHook.data.data = [{ id: 1, properties: 'value1' }, { id: 2, properties: 'value1' }, { id: 3, properties: 'value1' }]
      await pluginHooks.callFeathersServiceMethod({
        service: servicePath,
        method: 'patch',
        id: null,
        query: { id: '<%= id %>', upsert: true }
      })(feathersHook)
      const service = feathersHook.data.client.service(servicePath)
      const results = await service.find({ query: {} })
      expect(results.length).to.equal(3)
      results.forEach(result => {
        expect(result.properties).to.equal('value1')
      })
    })
    // Let enough time to proceed
      .timeout(5000)
  }

  it(`deletes objects using service ${servicePath} and query`, async () => {
    await pluginHooks.callFeathersServiceMethod({
      service: servicePath,
      method: 'remove',
      id: null,
      query: { properties: 'value1' }
    })(feathersHook)
    const service = feathersHook.data.client.service(servicePath)
    const results = await service.find({ query: {} })
    expect(results.length).to.equal(0)
  })
  // Let enough time to proceed
    .timeout(5000)
}

describe('krawler:hooks:feathers', () => {
  let mongoClient, app, server

  before(async () => {
    chailint(chai, util)
    mongoClient = await MongoClient.connect('mongodb://127.0.0.1:27017/krawler-test')
    app = feathers()
      .configure(socketio({ path: '/ws' }))
      .use('geojson-memory', memory({ multi: true }))
      .use('geojson-mongodb', mongodb({ multi: true, Model: mongoClient.db('krawler-test').collection('geojson') }))
    // Add required hook to manage upsert
    app.service('geojson-mongodb').hooks({
      before: {
        patch: (hook) => { _.set(hook, 'params.mongodb', { upsert: _.get(hook, 'params.query.upsert', false) }) }
      }
    })
    server = await app.listen(4000)
  })

  const feathersOptions = {
    origin: 'http://localhost:4000',
    transport: 'websocket',
    path: '/ws'
  }

  const feathersHook = {
    type: 'before',
    data: {},
    params: {}
  }

  it('connect to Feathers', async () => {
    await pluginHooks.connectFeathers(feathersOptions)(feathersHook)
    expect(feathersHook.data.client).toExist()
    expect(feathersHook.data.client.service('/geojson')).toExist()
  })
  // Let enough time to proceed
    .timeout(5000)

  it('connect to Feathers again', async () => {
    const result = await pluginHooks.connectFeathers(feathersOptions)(feathersHook).then(ok => ok, no => no)
    expect(result).to.be.equal(feathersHook)
  })

  createTests('geojson-memory', feathersHook)
  createTests('geojson-mongodb', feathersHook, { upsert: true })

  it('disconnect from Feathers', async () => {
    // Cleanup
    await pluginHooks.disconnectFeathers()(feathersHook)
    expect(feathersHook.data.client).beUndefined()
  })
  // Let enough time to proceed
    .timeout(5000)

  it('disconnect from Feathers again', async () => {
    const result = await pluginHooks.disconnectFeathers()(feathersHook).then(ok => ok, no => no)
    expect(result).to.be.equal(feathersHook)
  })

  // Cleanup
  after(async () => {
    await server.close()
    await mongoClient.close()
  })
})
