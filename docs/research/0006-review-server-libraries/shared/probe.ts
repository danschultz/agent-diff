// Fails to compile when passed a value typed `any`, to find responses that
// only type-check because a client returns `any`.
export function notAny<T>(value: 0 extends 1 & T ? never : T): T {
  return value;
}
