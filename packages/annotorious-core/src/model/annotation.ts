import type { User } from './user';

export interface Annotation {

  id: string;

  // Small difference in spirit to W3C thinking: annotations always
  // have ONE target. Annotating multiple shapes is something you'd handle
  // inside the selector, which is media-dependent and entirely extensible.
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

export interface AbstractSelector { }

export interface RuntimeAnnotationTarget extends AnnotationTarget {

  // Internally, targets always point back to their parent
  // annotation. The store will enforce consistency, even if users
  // pass in an invalid value here.
  _annotation: string;

}

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

  // Interally, bodies always have an ID (because there are multiple per annotation)
  id: string;

  // Points back to parent - same as for targets
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