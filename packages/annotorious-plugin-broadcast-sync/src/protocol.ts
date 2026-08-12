import type { SpatialAnnotation, SpatialAnnotationTarget } from '@annotorious/core-spatial';

/**
 * The wire protocol `attachAnnotationSync` (sync.ts) speaks over any
 * `SyncTransport`. One message type per `Store`/`DraftStore` change kind -
 * `annotation-upsert` deliberately covers both create and update, mirroring
 * `Store.upsertAnnotation`/`bulkUpsertAnnotations`, which already treat them
 * uniformly by annotation id.
 */
export type SyncMessage =

  /** This peer's in-progress shape changed (or was cleared, if `target` is undefined). **/
  | { type: 'draft', peerId: string, target: SpatialAnnotationTarget | undefined }

  /** An annotation was created or updated. **/
  | { type: 'annotation-upsert', peerId: string, annotation: SpatialAnnotation }

  | { type: 'annotation-delete', peerId: string, id: string }

  /** Sent once, on attach - asks existing peers to reply with their current state. **/
  | { type: 'hello', peerId: string }

  /** Reply to `hello`: a full snapshot, for a newly-joined peer to catch up on annotations that already existed. **/
  | { type: 'sync', peerId: string, annotations: SpatialAnnotation[] }

  /** Sent on `beforeunload` - lets other peers clear this peer's draft immediately instead of leaving a ghost shape. **/
  | { type: 'goodbye', peerId: string };
