declare module 'ajv' {
  export interface ValidateFunction {
    (data: unknown): boolean;
    errors?: Array<{
      keyword: string;
      message?: string;
      params: Record<string, unknown>;
      instancePath: string;
    }>;
  }

  export interface AjvInstance {
    compile(schema: unknown): ValidateFunction;
  }

  const Ajv: new (options?: unknown) => AjvInstance;
  export default Ajv;
}

declare module 'ajv-formats' {
  function addFormats(ajv: unknown): void;
  export default addFormats;
}