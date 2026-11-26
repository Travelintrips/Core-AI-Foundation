import {
  createGpt02ReaderCustodyDbaIssuer, Gpt02DbaCustodianError,
} from "../../artifacts/api-server/src/services/gpt02ReaderCustodyDbaIssuer.js";

type Custodian = Pick<ReturnType<typeof createGpt02ReaderCustodyDbaIssuer>, "issueAndPublish">;
type Output = { stdout: (text: string) => void; stderr: (text: string) => void };

export async function runGpt02ReaderCustodian(
  args: readonly string[] = [],
  issuer: Custodian = createGpt02ReaderCustodyDbaIssuer(),
  output: Output = { stdout: (text) => { process.stdout.write(text); }, stderr: (text) => { process.stderr.write(text); } },
): Promise<number> {
  if (args.length !== 0) {
    output.stderr("GPT02_DBA_CUSTODIAN=BLOCKED code=CUSTODY_DBA_ARGUMENTS_INVALID\n");
    return 1;
  }
  try {
    const result = await issuer.issueAndPublish();
    output.stdout(JSON.stringify({ event: "gpt02_reader_custody_dba_published", ...result }) + "\n");
    return 0;
  } catch (error) {
    const code = error instanceof Gpt02DbaCustodianError ? error.code : "CUSTODY_DBA_UNAVAILABLE";
    output.stderr(`GPT02_DBA_CUSTODIAN=BLOCKED code=${code}\n`);
    return 1;
  }
}

// The host artifact is CJS. Imports in API Vitest never invoke the host entry.
if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  void runGpt02ReaderCustodian(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
