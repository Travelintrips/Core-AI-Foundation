import { z } from "zod";

const MAX_ALLOWED_FILES = 12;
const MAX_OPERATIONS = 24;
const MAX_SUMMARY_CHARS = 2_000;
const MAX_RATIONALE_CHARS = 2_000;
const MAX_MATCH_CHARS = 12_000;
const MAX_CONTENT_CHARS = 16_000;
const MAX_TOTAL_OPERATION_CHARS = 64_000;

const SHA1_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

const SENSITIVE_BASENAME_PATTERNS = [
  /^\.env(?:\..+)?$/i,
  /^\.npmrc$/i,
  /^\.pypirc$/i,
  /^\.netrc$/i,
  /^credentials?(?:\..+)?$/i,
  /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/i,
  /^service[-_.]?account(?:\..+)?$/i,
  /^secrets?(?:\..+)?$/i,
  /^tokens?(?:\..+)?$/i,
  /^vault(?:\..+)?$/i,
];

const SENSITIVE_EXTENSIONS = new Set([
  ".cer",
  ".crt",
  ".der",
  ".jks",
  ".key",
  ".keystore",
  ".p12",
  ".pfx",
  ".pem",
]);

export const LOCAL_CODING_AI_PROPOSAL_VERSION = 1 as const;

function isSafeRepositoryPath(value: string): boolean {
  const segments = value.split("/");
  const basename = segments.at(-1) ?? "";
  const lower = basename.toLowerCase();
  const dot = lower.lastIndexOf(".");
  const extension = dot >= 0 ? lower.slice(dot) : "";

  if (
    value.trim() !== value ||
    !value ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.endsWith("/") ||
    segments.some((segment) => !segment || segment === "." || segment === "..") ||
    segments.some((segment) => segment.toLowerCase() === ".git")
  ) {
    return false;
  }

  if (
    SENSITIVE_BASENAME_PATTERNS.some((pattern) => pattern.test(basename)) ||
    SENSITIVE_EXTENSIONS.has(extension) ||
    /(?:^|[-_.])(secret|credential|private[-_.]?key|access[-_.]?token)(?:[-_.]|$)/i.test(lower)
  ) {
    return false;
  }

  return true;
}

const repositoryPathSchema = z
  .string()
  .min(1)
  .max(500)
  .refine(isSafeRepositoryPath, {
    message: "OUT_OF_SCOPE: path must be a canonical non-sensitive repository-relative file",
  });

const allowedFilesSchema = z
  .array(repositoryPathSchema)
  .min(1)
  .max(MAX_ALLOWED_FILES)
  .superRefine((files, ctx) => {
    if (new Set(files).size !== files.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "allowedFiles must not contain duplicates",
      });
    }
  });

const expectedOccurrencesSchema = z.number().int().min(1).max(16);

const replaceTextOperationSchema = z
  .object({
    type: z.literal("replace_text"),
    file: repositoryPathSchema,
    oldText: z.string().min(1).max(MAX_MATCH_CHARS),
    newText: z.string().max(MAX_CONTENT_CHARS),
    expectedOccurrences: expectedOccurrencesSchema,
  })
  .strict()
  .superRefine((operation, ctx) => {
    if (operation.oldText === operation.newText) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "replace_text must not be a no-op",
      });
    }
  });

const insertBeforeOperationSchema = z
  .object({
    type: z.literal("insert_before"),
    file: repositoryPathSchema,
    anchor: z.string().min(1).max(MAX_MATCH_CHARS),
    content: z.string().min(1).max(MAX_CONTENT_CHARS),
    expectedOccurrences: expectedOccurrencesSchema,
  })
  .strict();

const insertAfterOperationSchema = z
  .object({
    type: z.literal("insert_after"),
    file: repositoryPathSchema,
    anchor: z.string().min(1).max(MAX_MATCH_CHARS),
    content: z.string().min(1).max(MAX_CONTENT_CHARS),
    expectedOccurrences: expectedOccurrencesSchema,
  })
  .strict();

const deleteTextOperationSchema = z
  .object({
    type: z.literal("delete_text"),
    file: repositoryPathSchema,
    text: z.string().min(1).max(MAX_MATCH_CHARS),
    expectedOccurrences: expectedOccurrencesSchema,
  })
  .strict();

export const localCodingAiProposalOperationSchema = z.discriminatedUnion("type", [
  replaceTextOperationSchema,
  insertBeforeOperationSchema,
  insertAfterOperationSchema,
  deleteTextOperationSchema,
]);

const capabilitiesSchema = z
  .object({
    shellCommand: z.literal(false),
    networkRequest: z.literal(false),
    commit: z.literal(false),
    push: z.literal(false),
    merge: z.literal(false),
    secretAccess: z.literal(false),
    envAccess: z.literal(false),
  })
  .strict();

const proposalBodySchema = z
  .object({
    summary: z.string().min(1).max(MAX_SUMMARY_CHARS),
    rationale: z.string().min(1).max(MAX_RATIONALE_CHARS),
    operations: z
      .array(localCodingAiProposalOperationSchema)
      .min(1)
      .max(MAX_OPERATIONS),
  })
  .strict()
  .superRefine((proposal, ctx) => {
    let totalChars = 0;
    for (const operation of proposal.operations) {
      if (operation.type === "replace_text") {
        totalChars += operation.oldText.length + operation.newText.length;
      } else if (
        operation.type === "insert_before" ||
        operation.type === "insert_after"
      ) {
        totalChars += operation.anchor.length + operation.content.length;
      } else {
        totalChars += operation.text.length;
      }
    }

    if (totalChars > MAX_TOTAL_OPERATION_CHARS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "LIMIT_EXCEEDED: aggregate operation content exceeds " +
          MAX_TOTAL_OPERATION_CHARS +
          " characters",
      });
    }
  });

export const localCodingAiProposalV1Schema = z
  .object({
    version: z.literal(LOCAL_CODING_AI_PROPOSAL_VERSION),
    taskId: z.string().min(1).max(200),
    packageHash: z.string().regex(SHA256_RE),
    baseHeadSha: z.string().regex(SHA1_RE),
    currentPatchSha256: z.string().regex(SHA256_RE),
    allowedFiles: allowedFilesSchema,
    capabilities: capabilitiesSchema,
    proposal: proposalBodySchema,
  })
  .strict();

const localCodingAiProposalBindingSchema = z
  .object({
    taskId: z.string().min(1).max(200),
    packageHash: z.string().regex(SHA256_RE),
    baseHeadSha: z.string().regex(SHA1_RE),
    currentPatchSha256: z.string().regex(SHA256_RE),
    allowedFiles: allowedFilesSchema,
  })
  .strict();

export type LocalCodingAiProposalBinding = z.infer<
  typeof localCodingAiProposalBindingSchema
>;
export type LocalCodingAiProposalOperation = z.infer<
  typeof localCodingAiProposalOperationSchema
>;
export type LocalCodingAiProposalV1 = z.infer<
  typeof localCodingAiProposalV1Schema
>;

export type LocalCodingAiProposalContractErrorKind =
  | "MALFORMED_JSON"
  | "INVALID_SCHEMA"
  | "BINDING_MISMATCH"
  | "OUT_OF_SCOPE"
  | "LIMIT_EXCEEDED";

export class LocalCodingAiProposalContractError extends Error {
  constructor(
    message: string,
    readonly kind: LocalCodingAiProposalContractErrorKind,
  ) {
    super(message);
    this.name = "LocalCodingAiProposalContractError";
  }
}

function toContractError(error: z.ZodError): LocalCodingAiProposalContractError {
  const message = error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") + ": " : "";
      return path + issue.message;
    })
    .join("; ");

  if (message.includes("OUT_OF_SCOPE:")) {
    return new LocalCodingAiProposalContractError(message, "OUT_OF_SCOPE");
  }
  if (
    message.includes("LIMIT_EXCEEDED:") ||
    error.issues.some((issue) => issue.code === z.ZodIssueCode.too_big)
  ) {
    return new LocalCodingAiProposalContractError(message, "LIMIT_EXCEEDED");
  }
  return new LocalCodingAiProposalContractError(message, "INVALID_SCHEMA");
}

function exactStringArray(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export function validateLocalCodingAiProposalV1(
  value: unknown,
  binding: LocalCodingAiProposalBinding,
): LocalCodingAiProposalV1 {
  const parsedBinding = localCodingAiProposalBindingSchema.safeParse(binding);
  if (!parsedBinding.success) {
    throw toContractError(parsedBinding.error);
  }

  const parsed = localCodingAiProposalV1Schema.safeParse(value);
  if (!parsed.success) {
    throw toContractError(parsed.error);
  }

  const proposal = parsed.data;
  const expected = parsedBinding.data;

  if (
    proposal.taskId !== expected.taskId ||
    proposal.packageHash !== expected.packageHash ||
    proposal.baseHeadSha !== expected.baseHeadSha ||
    proposal.currentPatchSha256 !== expected.currentPatchSha256 ||
    !exactStringArray(proposal.allowedFiles, expected.allowedFiles)
  ) {
    throw new LocalCodingAiProposalContractError(
      "AI proposal does not match the approved handoff binding",
      "BINDING_MISMATCH",
    );
  }

  const allowed = new Set(expected.allowedFiles);
  for (const operation of proposal.proposal.operations) {
    if (!allowed.has(operation.file)) {
      throw new LocalCodingAiProposalContractError(
        "AI proposal operation targets a file outside allowedFiles: " +
          operation.file,
        "OUT_OF_SCOPE",
      );
    }
  }

  return proposal;
}

export function parseLocalCodingAiProposalV1(
  rawOutput: string,
  binding: LocalCodingAiProposalBinding,
): LocalCodingAiProposalV1 {
  if (typeof rawOutput !== "string") {
    throw new LocalCodingAiProposalContractError(
      "AI proposal output must be a string containing one JSON object",
      "MALFORMED_JSON",
    );
  }

  const trimmed = rawOutput.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    throw new LocalCodingAiProposalContractError(
      "AI proposal output must be raw JSON only; markdown/code fences are not accepted",
      "MALFORMED_JSON",
    );
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(trimmed) as unknown;
  } catch {
    throw new LocalCodingAiProposalContractError(
      "AI proposal output is not valid JSON",
      "MALFORMED_JSON",
    );
  }

  return validateLocalCodingAiProposalV1(decoded, binding);
}

export type LocalCodingAiProposalValidationResult =
  | { success: true; data: LocalCodingAiProposalV1 }
  | { success: false; error: LocalCodingAiProposalContractError };

export function safeParseLocalCodingAiProposalV1(
  rawOutput: string,
  binding: LocalCodingAiProposalBinding,
): LocalCodingAiProposalValidationResult {
  try {
    return {
      success: true,
      data: parseLocalCodingAiProposalV1(rawOutput, binding),
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof LocalCodingAiProposalContractError
          ? error
          : new LocalCodingAiProposalContractError(
              error instanceof Error ? error.message : String(error),
              "INVALID_SCHEMA",
            ),
    };
  }
}

export const localCodingAiProposalContractLimits = Object.freeze({
  maxAllowedFiles: MAX_ALLOWED_FILES,
  maxOperations: MAX_OPERATIONS,
  maxSummaryChars: MAX_SUMMARY_CHARS,
  maxRationaleChars: MAX_RATIONALE_CHARS,
  maxMatchChars: MAX_MATCH_CHARS,
  maxContentChars: MAX_CONTENT_CHARS,
  maxTotalOperationChars: MAX_TOTAL_OPERATION_CHARS,
});
