import * as z from 'zod/mini';
import { AddComment } from './schemas.ts';
console.log(JSON.stringify(z.toJSONSchema(AddComment)));
