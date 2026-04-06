import { ajv } from './lib/ajv.js';
import jsonlLineSchema from '../schemas/jsonl-line.schema.json' with { type: 'json' };
import manifestSchema from '../schemas/manifest.schema.json' with { type: 'json' };
import deltaLineSchema from '../schemas/delta-line.schema.json' with { type: 'json' };

export interface ValidateFunction {
  (data: unknown): boolean;
  errors?: Array<{
    keyword: string;
    message?: string;
    params: Record<string, unknown>;
    instancePath: string;
  }>;
}

export const validateJsonlLine: ValidateFunction = ajv.compile(jsonlLineSchema);

export const validateManifest: ValidateFunction = ajv.compile(manifestSchema);

export const validateDeltaLine: ValidateFunction = ajv.compile(deltaLineSchema);