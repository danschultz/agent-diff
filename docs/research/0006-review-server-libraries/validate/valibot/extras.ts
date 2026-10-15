import { toJsonSchema } from '@valibot/to-json-schema';
import { AddComment } from './schemas.ts';
console.log(JSON.stringify(toJsonSchema(AddComment)));
