import type { Request, RequestHandler } from 'express';
import type { TaskService } from '../services/task.service.js';
import type { StoredResponse } from '../lib/idempotency.js';

/**
 * Controllers translate HTTP <-> service calls and nothing else: no validation logic (the service
 * owns it) and no storage access. Errors bubble to the central error handler (Express 5 forwards
 * rejected promises automatically).
 */
export function createTasksController(service: TaskService) {
  const list: RequestHandler = (req, res) => {
    res.status(200).json(service.list(req.query));
  };

  const getOne: RequestHandler = (req, res) => {
    res.status(200).json({ data: service.get(req.params.id) });
  };

  /** Returns its response (instead of writing it) so the idempotency layer can store/replay it. */
  const create = (req: Request): StoredResponse => ({
    status: 201,
    body: { data: service.create(req.body, { createdBy: 'user' }) },
  });

  const update: RequestHandler = (req, res) => {
    res.status(200).json({ data: service.update(req.params.id, req.body) });
  };

  const remove: RequestHandler = (req, res) => {
    const deleted = service.delete(req.params.id);
    res.status(200).json({ data: deleted, message: `Task ${deleted.id} deleted` });
  };

  return { list, getOne, create, update, remove };
}
