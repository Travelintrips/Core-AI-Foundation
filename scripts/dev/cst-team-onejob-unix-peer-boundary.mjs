/**
 * Advisory contract only: the Linux pathname socket filesystem identity
 * expected BEFORE any real CST-DEV one-job broker is considered.
 *
 * A green filesystem result is NOT SO_PEERCRED, egress ACL, a database
 * connection, a release approval or an attestation of the running process.
 * No privileged calls, container mutation, network, credentials or dispatch.
 */
export const ONEJOB_SOCKET_DIRECTORY = "/run/cst-onejob-dev-db";
export const ONEJOB_SOCKET_PATH = ONEJOB_SOCKET_DIRECTORY + "/pg-pooler.sock";
export const ONEJOB_CANDIDATE = "cst-core-onejob-dev-candidate";
export const ONEJOB_NETWORK = "cst-core-onejob-dev-net";

function numericIdentity(value) {
  if (typeof value !== "string" || !/^[1-9][0-9]*:[1-9][0-9]*$/.test(value))
    return null;
  const [uid,gid]=value.split(":").map(Number);
  if (![uid,gid].every(x=>Number.isSafeInteger(x) && x>0 && x<=60000))
    return null;
  return {uid,gid};
}
function filesystemMode(value) {
  return Number.isSafeInteger(value) && value>=0
    ? value & 0o777 : null;
}

/** Read-only projection of independently collected Docker/FS observations.
 * Synthetic inputs can test this function but can never authorize live work.
 */
export function projectCstOneJobUnixPeerBoundary(input={}) {
  const candidate=input.candidate??{};
  const broker=input.broker??{};
  const mount=input.mount??{};
  const directory=input.directory??{};
  const socket=input.socket??{};
  const reasons=[];
  const requireCheck=(pass,reason)=>{if(pass!==true)reasons.push(reason);};
  const candidateId=numericIdentity(candidate.user);
  const brokerId=numericIdentity(broker.user);
  requireCheck(candidate.name===ONEJOB_CANDIDATE &&
    candidate.networkMode===ONEJOB_NETWORK &&
    candidateId!==null && candidate.privileged===false &&
    candidate.readonlyRootfs===true &&
    candidate.noNewPrivileges===true &&
    Array.isArray(candidate.capDrop) &&
    candidate.capDrop.some(x=>typeof x==="string"&&x.toUpperCase()==="ALL") &&
    Array.isArray(candidate.capAdd) && candidate.capAdd.length===0 &&
    candidate.pidMode!=="host" && candidate.ipcMode!=="host",
    "CANDIDATE_NONROOT_SANDBOX_NOT_VERIFIED");
  requireCheck(brokerId!==null && broker.privileged===false &&
    broker.noNewPrivileges===true && broker.readonlyRootfs===true &&
    Array.isArray(broker.capDrop) &&
    broker.capDrop.some(x=>typeof x==="string"&&x.toUpperCase()==="ALL") &&
    Array.isArray(broker.capAdd) && broker.capAdd.length===0 &&
    broker.networkMode!=="host",
    "BROKER_NONROOT_SANDBOX_NOT_VERIFIED");
  requireCheck(candidateId!==null && brokerId!==null &&
    candidateId.uid!==brokerId.uid && candidateId.gid===brokerId.gid,
    "DISTINCT_UID_SHARED_DEDICATED_GID_REQUIRED");
  requireCheck(mount.type==="bind" && mount.source===ONEJOB_SOCKET_DIRECTORY &&
    mount.destination===ONEJOB_SOCKET_DIRECTORY && mount.readonly===true,
    "SOCKET_DIRECTORY_EXACT_READONLY_MOUNT_REQUIRED");
  requireCheck(brokerId!==null && directory.isDirectory===true &&
    directory.isSymlink===false && directory.uid===brokerId.uid &&
    directory.gid===brokerId.gid &&
    filesystemMode(directory.mode)===0o750,
    "SOCKET_PARENT_OWNER_MODE_INVALID");
  requireCheck(brokerId!==null && socket.isSocket===true &&
    socket.isSymlink===false && socket.path===ONEJOB_SOCKET_PATH &&
    socket.uid===brokerId.uid && socket.gid===brokerId.gid &&
    filesystemMode(socket.mode)===0o660,
    "SOCKET_OWNER_MODE_INVALID");
  return {
    mode:"PATHNAME_DAC_METADATA_ONLY_NOT_SO_PEERCRED",
    filesystemBoundaryVerified:reasons.length===0,
    kernelPeerCredentialsVerified:false,
    independentEgressAclVerified:false,
    dedicatedRealDevDbTransportVerified:false,
    operationalAuthority:false,
    blockers:reasons,
  };
}
