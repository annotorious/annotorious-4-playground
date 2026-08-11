import { v4 as uuidv4 } from 'uuid';
import type { Annotation, AnnotationBody } from '../model/annotation';
import type { User } from '../model/user';

/**
 * Returns all users listed as creators or updaters in any part of this annotation.
 */
export const getContributors = (annotation: Annotation): User[] => {
  const { creator, updatedBy } = annotation.target;

  const bodyContributors = annotation.bodies.reduce((users, body) => ([
    ...users,
    ...([body.creator, body.updatedBy].filter(Boolean) as User[])
  ]), [] as User[]);

  return [creator, updatedBy, ...bodyContributors].filter(Boolean) as User[];
}

type HasTime = { created?: string | Date; updated?: string | Date };

/**
 * Converts any string dates in the given annotation(-like) object to proper Date objects.
 */
export const reviveDates = <A extends Annotation = Annotation>(annotation: any): A => {
  const revive = <T extends HasTime>(obj: T): T => {
    const revived = { ...obj };

    if (obj.created && typeof obj.created === 'string')
      revived.created = new Date(obj.created);

    if (obj.updated && typeof obj.updated === 'string')
      revived.updated = new Date(obj.updated);

    return revived;
  }

  return {
    ...annotation,
    bodies: (annotation.bodies || []).map(revive),
    target: revive(annotation.target)
  } as A;
}

/** Shorthand/helper for creating a new annotation body. **/
export const createBody = (
  annotationOrId: string | Annotation,
  payload: { [key: string]: any },
  created?: Date,
  creator?: User
): AnnotationBody => ({
  id: uuidv4(),
  annotation: typeof annotationOrId === 'string' ? annotationOrId : annotationOrId.id,
  created: created || new Date(),
  creator,
  ...payload
} as AnnotationBody);
