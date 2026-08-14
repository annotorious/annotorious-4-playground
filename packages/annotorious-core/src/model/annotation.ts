import type { User } from './user';

export interface Annotation {

  id: string;

  target: AnnotationTarget;

  bodies: AnnotationBody[];

  properties?: {

    [key: string]: any;

  }

}

export interface RuntimeAnnotation extends Omit<Annotation, 'target' | 'bodies'> {

  target: RuntimeAnnotationTarget;

  bodies: RuntimeAnnotationBody[];

}

export interface AnnotationTarget {

  selector: AbstractSelector;

  creator?: User;

  created?: Date;

  updatedBy?: User;

  updated?: Date;

}

export interface RuntimeAnnotationTarget extends AnnotationTarget {

  _annotation: string;

}

export interface AbstractSelector { }

export interface AnnotationBody {

  id?: string;

  purpose?: typeof PurposeValues[number] | string & {};

  value?: any;

  creator?: User;

  created?: Date;

  updatedBy?: User;

  updated?: Date;

}

export interface RuntimeAnnotationBody extends Omit<AnnotationBody, 'id'> {

  id: string;

  _annotation: string;

}

// Pre-defined purposes from https://www.w3.org/TR/annotation-model/#motivation-and-purpose
const PurposeValues = [ 
  'assessing',
  'bookmarking',
  'classifying',
  'commenting',
  'describing',
  'editing',
  'highlighting',
  'identifying',
  'linking',
  'moderating',
  'questioning',
  'replying',
  'tagging'
] as const;