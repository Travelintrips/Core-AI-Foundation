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
      items: { type: "string" },
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
            type: "object",
            description:
              "One Proposal Contract V1 edit operation. Exact operation fields are validated server-side.",
          },
        },
      },
    },
  },
};
