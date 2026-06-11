import type { Annotation } from './annotation';

export type Filter<T extends Annotation = Annotation> = (annotation: T) => boolean;