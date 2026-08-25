/**
 * Express middleware factory: validates req.body against a zod schema before
 * the route handler runs, returning a clean 400 with field-level detail on
 * failure instead of letting a malformed request reach Postgres as a raw,
 * unhelpful constraint-violation error.
 *
 * @param {import('zod').ZodSchema} schema
 */
export function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: "Invalid request body",
        details: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }
    req.body = result.data; // stripped/coerced to the schema's shape
    next();
  };
}
