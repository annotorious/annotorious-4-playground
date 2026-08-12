/** Fixed author id for this session's own in-progress drawing, as opposed to a remote collaborator's - see DraftStore. **/
export const LOCAL_AUTHOR_ID = '__local__';

const DRAFT_ANNOTATION_PREFIX = '__annotorious-draft__';

/** Fixed (per-author) id for an in-progress annotation target, styled distinctly and never confused with a real annotation. **/
export const draftAnnotationId = (authorId: string): string => `${DRAFT_ANNOTATION_PREFIX}:${authorId}`;

export const isDraftAnnotationId = (id: string): boolean => id.startsWith(DRAFT_ANNOTATION_PREFIX);
