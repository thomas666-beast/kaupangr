/**
 * Append a single row to sync_queue.
 * Must be called inside the same transaction as the entity write.
 */
export function enqueue(db, entity, entityId, op, payload) {
  db.prepare(
    `INSERT INTO sync_queue (entity, entity_id, op, payload)
     VALUES (?, ?, ?, ?)`
  ).run(entity, entityId, op, JSON.stringify(payload));
}
