const occurrenceSchema = {
  type: "integer",
  minimum: 1,
  maximum: 16,
} as const;

const fileSchema = {
  type: "string",
  description: "Repository-relative file path. Server-side binding to allowedFiles remains authoritative.",
} as const;

const operationSchemas = [
  {
    type: "object",
    additionalProperties: false,
    required: ["type", "file", "oldText", "newText", "expectedOccurrences"],
    properties: {
      type: { type: "string", enum: ["replace_text"] },
      file: fileSchema,
      oldText: { type: "string" },
      newText: { type: "string" },
      expectedOccurrences: occurrenceSchema,
    },
  },
  {
    type: "object",
    additionalProperties: false,
    required: ["type", "file", "anchor", "content", "expectedOccurrences"],
    properties: {
      type: { type: "string", enum: ["insert_before"] },
      file: fileSchema,
      anchor: { type: "string" },
      content: { type: "string" },
      expectedOccurrences: occurrenceSchema,
    },
  },
  {
    type: "object",
    additionalProperties: false,
    required: ["type", "file", "anchor", "content", "expectedOccurrences"],
    properties: {
      type: { type: "string", enum: ["insert_after"] },
      file: fileSchema,
      anchor: { type: "string" },
      content: { type: "string" },
      expectedOccurrences: occurrenceSchema,
    },
  },
  {
    type: "object",
    additionalProperties: false,
    required: ["type", "file", "text", "expectedOccurrences"],
    properties: {
      type: { type: "string", enum: ["delete_text"] },
      file: fileSchema,
      text: { type: "string" },
      expectedOccurrences: occurrenceSchema,
    },
  },
  {
    type: "object",
    additionalProperties: false,
    required: ["type", "file", "content"],
    properties: {
      type: { type: "string", enum: ["create_file"] },
      file: fileSchema,
      content: { type: "string" },
    },
  },
] as const;

export const localCodingAiProposalV1JsonSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "version",
    "taskId",
    "packageHash",
    "baseHeadSha",
    "currentPatchSha256",
    "allowedFiles",
    "capabilities",
    "proposal",
  ],
  properties: {
    version: { type: "integer", enum: [1] },
    taskId: { type: "string" },
    packageHash: { type: "string" },
    baseHeadSha: { type: "string" },
    currentPatchSha256: { type: "string" },
    allowedFiles: {
      type: "array",
      minItems: 1,
      maxItems: 12,
      items: fileSchema,
    },
    capabilities: {
      type: "object",
      additionalProperties: false,
      required: [
        "shellCommand",
        "networkRequest",
        "commit",
        "push",
        "merge",
        "secretAccess",
        "envAccess",
      ],
      properties: {
        shellCommand: { type: "boolean", description: "Must be false." },
        networkRequest: { type: "boolean", description: "Must be false." },
        commit: { type: "boolean", description: "Must be false." },
        push: { type: "boolean", description: "Must be false." },
        merge: { type: "boolean", description: "Must be false." },
        secretAccess: { type: "boolean", description: "Must be false." },
        envAccess: { type: "boolean", description: "Must be false." },
      },
    },
    proposal: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "rationale", "operations"],
      properties: {
        summary: { type: "string" },
        rationale: { type: "string" },
        operations: {
          type: "array",
          minItems: 1,
          maxItems: 24,
          items: {
            oneOf: operationSchemas,
          },
        },
      },
    },
  },
};
