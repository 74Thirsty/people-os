import Ajv, { type ErrorObject } from "ajv";
import schema from "../../../schemas/company-config.schema.json";

const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

function format(error: ErrorObject): string {
  const path = error.instancePath || "/";
  return `${path} ${error.message ?? "is invalid"}`;
}

/**
 * Structural validation against the committed universal JSON Schema.
 * Returns an empty array when the document conforms.
 */
export function validateCompanyConfigJsonSchema(input: unknown): string[] {
  if (validate(input)) return [];
  return (validate.errors ?? []).map(format);
}
