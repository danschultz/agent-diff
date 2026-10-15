import { check } from './schemas.ts';
const el = document.querySelector('#input') as HTMLTextAreaElement;
document.body.textContent = JSON.stringify(check(JSON.parse(el.value)));
