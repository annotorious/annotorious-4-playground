import { customAlphabet } from 'nanoid';

export interface User {

  id: string;

  name?: string;

  avatar?: string;

}

export const createAnonymousUser = () => {
  const nanoid = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_', 20);
  return { id: nanoid() }
}