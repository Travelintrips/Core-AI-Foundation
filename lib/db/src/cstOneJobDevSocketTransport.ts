/**
 * CST-DEV one-job model pilot: opt-in raw PostgreSQL-over-local-Unix-socket
 * stream. The host/username in the original connection string remain the
 * authoritative Supabase project identity and TLS SNI/hostname verification.
 *
 * This does not provide a broker, create a credential, or authorize pilot use.
 * The fixed socket must be independently provisioned under an approved ACL.
 * Never enable it for the ordinary DEV runtime or any PROD runtime.
 */
import { Socket } from "node:net";

const PROJECT = "xssrfshdrtdfupgqwfdw";
const POOLER = "aws-0-ap-southeast-2.pooler.supabase.com";
export const CST_ONEJOB_DEV_SOCKET_PATH = "/run/cst-onejob-dev-db/pg-pooler.sock";

function deny(code: string): never {
  throw new Error("CST_DEV_ONEJOB_SOCKET_" + code);
}

/** Uses a fixed path in the application; tests may inject their own mock path. */
export function makeOneJobUnixSocketStream(
  path: string = CST_ONEJOB_DEV_SOCKET_PATH,
): () => Socket {
  return () => {
    const socket = new Socket();
    // Capture the real overloaded connect() before replacing the method that
    // node-postgres calls with (port, host). The physical stream is always UDS;
    // the original approved pooler host remains in the PG config for TLS SNI.
    const connectUnix = socket.connect.bind(socket) as
      (options: { path: string }) => Socket;
    socket.connect = ((_port: number, _host: string) =>
      connectUnix({ path })) as typeof socket.connect;
    return socket;
  };
}

export function createCstDevOneJobSocketOptions(
  connectionString: string,
  env: NodeJS.ProcessEnv = process.env,
): { ssl: { rejectUnauthorized: true }; stream: () => Socket } | undefined {
  const flag = env["CST_TEAM_DEV_DB_SOCKET_TRANSPORT_ENABLED"];
  if (flag === undefined || flag === "" || flag === "false") return undefined;
  if (flag !== "true") deny("FLAG_INVALID");

  if (env["APP_ENV"] !== "development" ||
      env["NODE_ENV"] !== "development" ||
      env["CST_TEAM_DEV_SCOPED_MODEL_CLAIM_ENABLED"] !== "true" ||
      Boolean(env["SUPABASE_PROD_DATABASE_URL"])) {
    deny("ENVIRONMENT_DENIED");
  }
  const configuredProject = env["SUPABASE_URL_DEV"];
  if (configuredProject !== "https://" + PROJECT + ".supabase.co") {
    deny("PROJECT_IDENTITY_DENIED");
  }
  const jobId = Number(env["CST_TEAM_DEV_APPROVED_JOB_ID"]);
  if (!Number.isSafeInteger(jobId) || jobId <= 0 || jobId === 482 ||
      !/^cst-dev-dell-onejob-[0-9]{8}-[0-9a-f]{8}$/.test(
        env["CST_TEAM_DEV_APPROVED_WORKER_NAME"] ?? "",
      )) {
    deny("ONE_JOB_BINDING_DENIED");
  }
  let url: URL;
  try { url = new URL(connectionString); }
  catch { deny("DSN_FORMAT_DENIED"); }
  // The original pooler hostname MUST remain in the connection string. This
  // preserves both the existing DEV project check and pg TLS SNI. Never use
  // a localhost/Unix-path DSN to make the project-ref guard pass.
  if (!["postgres:", "postgresql:"].includes(url.protocol) ||
      url.hostname !== POOLER || url.port !== "6543" ||
      url.pathname !== "/postgres" || url.search !== "" || url.hash !== "") {
    deny("POOLER_DESTINATION_DENIED");
  }
  const user = decodeURIComponent(url.username);
  if (!/^cst_team_model_pilot_[0-9]{8}_[a-f0-9]{8}\.xssrfshdrtdfupgqwfdw$/.test(user) ||
      !url.password || decodeURIComponent(url.password).length < 24) {
    deny("DEDICATED_LOGIN_DENIED");
  }
  if (env["PGSSLMODE"] || env["PGSSLKEY"] || env["PGSSLCERT"]) {
    deny("TLS_OVERRIDE_DENIED");
  }
  // No rejectUnauthorized:false, sslmode=require/no-verify, insecure CA,
  // caller-supplied host/socket target, or implicit external network fallback.
  return {
    ssl: { rejectUnauthorized: true },
    stream: makeOneJobUnixSocketStream(),
  };
}
