import * as z from 'zod';
import { AddComment } from './schemas.ts';
console.log(JSON.stringify(z.toJSONSchema(AddComment)));
