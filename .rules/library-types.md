# Using a library's types

When code passes a value to a library, or receives one from it, type it with the
type the library exports. Follow these steps whenever you write such code.

## Steps

1. Find the type the library exports for the value, such as oRPC's `Interceptor`
   and `StandardHandlerInterceptorOptions` for a handler interceptor. Look in
   the package's `.d.ts` files, including its subpath exports, such as
   `@orpc/server/standard`.
2. Import that type by name. Don't write the type out by hand, and don't derive
   it from another type, such as `NonNullable<Options['interceptors']>[number]`.
   A hand-written type drifts from the library's when the library changes, and a
   derived one hides what the type is.
3. If the type comes from a package the workspace doesn't depend on yet, such as
   `@orpc/shared`, add it to that workspace's `dependencies` at the same exact
   version as the library's other packages.
4. If the library doesn't export a type for the value, derive it, and say in a
   comment which type you looked for.
