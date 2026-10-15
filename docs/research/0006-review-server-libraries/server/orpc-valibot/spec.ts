import { OpenAPIGenerator } from '@orpc/openapi';
import { experimental_ValibotToJsonSchemaConverter as ValibotToJsonSchemaConverter } from '@orpc/valibot';
import { contract } from './contract.ts';

const generator = new OpenAPIGenerator({
  schemaConverters: [new ValibotToJsonSchemaConverter()],
});
const spec = await generator.generate(contract, {
  info: { title: 'agent-diff', version: '0.0.0' },
  servers: [{ url: '/api' }],
});
console.log(Object.keys(spec.paths ?? {}).join('\n'));
console.log(
  JSON.stringify(
    spec.paths?.['/review-sessions/{id}/comments']?.post?.responses?.['201'],
  ).slice(0, 300),
);
