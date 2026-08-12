import type { Annotation } from './annotation';

export interface FormatAdapter<A extends Annotation, T extends unknown> {

  parse(serialized: T): ParseResult<A>;

  parseAll?(serialized: unknown[]): { parsed: A[], failed: T[] };

  serialize(core: A): T;

}

export interface ParseResult<A extends Annotation> {

  parsed?: A;
  
  error?: Error;

}

export const serializeAll = 
  <A extends Annotation, T extends unknown>(adapter: FormatAdapter<A, T>) =>
    (annotations: A[]) => annotations.map(a => adapter.serialize(a));

export const parseAll =
  <A extends Annotation, T extends unknown>(adapter: FormatAdapter<A, T>) =>
    (serialized: T[]) => {
      const parsed: A[] = [];
      const failed: T[] = [];

      for (const next of serialized) {
        const result = adapter.parse(next);
        if (result.error) failed.push(next);
        else if (result.parsed) parsed.push(result.parsed);
      }

      return { parsed, failed };
    };
  