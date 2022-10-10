import _ from 'lodash'
import makeDebug from 'debug'
import Service from './service.js'
import { getStore } from '../utils.js'
import defaultJobGenerators from '../jobs/index.js'

const debug = makeDebug('krawler:jobs')

class JobsService extends Service {
  constructor (options = {}) {
    super(defaultJobGenerators)
    this.tasksService = options.tasksService || 'tasks'
    this.storesService = options.storesService || 'stores'
  }

  setup (app, path) {
    super.setup(app, path)
    this.tasksService = app.service(this.tasksService)
    this.storesService = app.service(this.storesService)
  }

  async create (data, params = {}) {
    let { type, id, options, taskTemplate, tasks } = data
    // Ensure a default empty template that could be used to store shared information for tasks, e.g. DB client
    if (!taskTemplate) {
      taskTemplate = data.taskTemplate = {}
    }
    // When running as API options and task template are memorized when initializing
    // Use these default values if not provided in job payload
    if (this.jobOptions) options = _.merge(options || {}, this.jobOptions)
    if (this.taskTemplate) taskTemplate = _.merge(taskTemplate, this.taskTemplate)
    let store
    // If a store is found at job level it will be forwarded to all tasks
    // as params so that they don't have to seek for output store
    try {
      store = await getStore(this.storesService, params, data)
    } catch (error) {
      // Otherwise each task should specify its output store
    }

    // The task template ID is used as a template string for the task ID
    let idCompiler
    if (taskTemplate.id) {
      idCompiler = _.template(taskTemplate.id)
    }
    debug('Launching job with following template', taskTemplate)

    tasks = tasks.map(task => {
      // ID is templated on his own to have access to the job ID as well
      const taskWithoutId = _.omit(task, ['id'])
      const newTask = {}
      // Create a new task with compiled ID
      if (idCompiler) {
        newTask.id = idCompiler(Object.assign({ jobId: data.id, taskId: task.id }, taskWithoutId))
      }
      // When there is nothing to interpolate the returned ID is empty
      if (!newTask.id) newTask.id = task.id
      // Then affect object
      _.merge(newTask, taskWithoutId)
      return newTask
    })
    // Always default to async if no type given
    // ID have already been templated here to have access to the job ID as well so remove it
    return this.generate(type || 'async', options, store, tasks, id, _.omit(taskTemplate, ['id']))
  }

  async remove (id, params = {}) {
    const store = await getStore(this.storesService, params, params.query || {})

    return new Promise((resolve, reject) => {
      // Remove output data
      debug('Removing data for job ' + id + ' from store')
      store.remove(id, error => {
        // Continue cleanup on error
        if (error) {
          console.error(error)
          // reject(error)
          // return
        }

        resolve()
      })
    })
  }
}

export default function init (options) {
  return new JobsService(options)
}

init.Service = JobsService
