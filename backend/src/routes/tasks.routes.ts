import { Router } from 'express';
import type { TaskService } from '../services/task.service.js';
import type { IdempotencyStore } from '../lib/idempotency.js';
import { createTasksController } from '../controllers/tasks.controller.js';
import { idempotent } from '../middleware/idempotency.js';

export function createTasksRouter(deps: { taskService: TaskService; idempotencyStore: IdempotencyStore }): Router {
  const controller = createTasksController(deps.taskService);
  const router = Router();

  router.get('/', controller.list);
  router.post('/', idempotent(deps.idempotencyStore, controller.create));
  router.get('/:id', controller.getOne);
  // PUT is naturally idempotent (same body -> same state) and DELETE is idempotent in effect,
  // so only POST needs an Idempotency-Key to be safe against retries.
  router.put('/:id', controller.update);
  router.delete('/:id', controller.remove);

  return router;
}
