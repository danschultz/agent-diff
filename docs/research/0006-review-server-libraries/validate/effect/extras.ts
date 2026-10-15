import { Schema } from 'effect';
import { AddComment } from './schemas.ts';
console.log(JSON.stringify(Schema.toJsonSchemaDocument(AddComment)));
console.log(
  'standard schema after toStandardSchemaV1:',
  '~standard' in Schema.toStandardSchemaV1(AddComment),
);
